// Plugins from outside: NAJD can fetch a plugin (a bundle of skills, commands and MCP servers in the common ".claude-plugin" layout) from a GitHub address or from a
// marketplace, show exactly what it contains, and install it so the system knows it.
// - Skills become NAJD skills (written guidance, enabled, hash-pinned; scripts never run), through external-skills.cjs.
// - Commands (commands/*.md prompt templates) become entries of the "/" menu; choosing one only puts its text in the message box for the owner to edit and send.
// - MCP servers in .mcp.json are listed as proposals; they are never started or added here. Adding one goes through the existing native confirmation of the exact command.
// - Hooks and sub-agents are not supported and are reported as such; nothing in a plugin executes on install.
// Sources are GitHub only (https), pinned to a commit when the marketplace gives one. Marketplaces are .claude-plugin/marketplace.json files in GitHub repositories.
const { skillIdOf } = require('./external-skills.cjs')
const { replaceFile } = require('./atomic-file.cjs')
const fs = require('node:fs/promises')
const path = require('node:path')
const { randomUUID, createHash } = require('node:crypto')

const fail = code => Object.assign(new Error(code), { code })
const MAX_FILE = 256 * 1024
const MAX_MARKETPLACE = 8 * 1024 * 1024
const ID = /^[a-z][a-z0-9-]{1,59}$/
const DEFAULT_MARKETPLACES = [{ id: 'claude-plugins-official', name: 'Official plugins', repo: 'anthropics/claude-plugins-official', ref: 'main' }]
const short = (text, max) => String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
const slug = text => String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 59)

// A GitHub tree address for a source descriptor (a marketplace entry's `source`).
function githubTree(source, marketplace) {
  const tree = (repo, ref, subdirectory) => {
    const match = /^([\w.-]+)\/([\w.-]+?)(?:\.git)?$/.exec(repo)
    if (!match) throw fail('UNSUPPORTED_SOURCE')
    const at = ref || 'HEAD'
    // A commit id, or a ref without a slash: the tree address cannot tell a branch name containing slashes from a folder, so those are not installable.
    if (at !== 'HEAD' && !/^[\w.-]+$/.test(at)) throw fail('UNSUPPORTED_SOURCE')
    // The default branch is never guessed: a folder needs an explicit ref or commit.
    if (at === 'HEAD' && subdirectory) throw fail('UNSUPPORTED_SOURCE')
    return `https://github.com/${match[1]}/${match[2]}` + (at === 'HEAD' ? '' : `/tree/${at}` + (subdirectory ? '/' + subdirectory.replace(/^\.?\//, '') : ''))
  }
  const fromUrl = url => { const m = /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/.exec(String(url)); if (!m) throw fail('UNSUPPORTED_SOURCE'); return m[1] }
  if (typeof source === 'string') {
    if (!source.startsWith('./') || source.includes('..')) throw fail('UNSUPPORTED_SOURCE')
    return tree(marketplace.repo, marketplace.ref, source.slice(2))
  }
  if (!source || typeof source !== 'object') throw fail('UNSUPPORTED_SOURCE')
  const pin = /^[0-9a-f]{40}$/i.test(source.sha || '') ? source.sha : source.ref
  if (source.source === 'github' && typeof source.repo === 'string') return tree(source.repo, pin, source.path || '')
  if (source.source === 'url') return tree(fromUrl(source.url), pin, '')
  if (source.source === 'git-subdir') { if (/\.\.|^\//.test(source.path || '')) throw fail('UNSUPPORTED_SOURCE'); return tree(fromUrl(source.url), pin, source.path || '') }
  throw fail('UNSUPPORTED_SOURCE')
}

// ---- reading a plugin out of its archive ----
function readText(files, name) {
  const bytes = files.get(name)
  if (!bytes) return null
  if (bytes.length > MAX_FILE) return null
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes) } catch { return null }
}
function frontmatterOf(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text)
  if (!match) return { meta: {}, body: text }
  const meta = {}
  for (const line of match[1].split(/\r?\n/)) { const m = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line); if (m) meta[m[1]] = m[2].replace(/^["']|["']$/g, '') }
  return { meta, body: match[2] }
}

// `files` maps a path inside the plugin folder ("commands/x.md") to its bytes.
function readPlugin(files, fallbackName) {
  let manifest = {}
  const manifestText = readText(files, '.claude-plugin/plugin.json')
  if (manifestText) { try { manifest = JSON.parse(manifestText) } catch { throw fail('PLUGIN_INVALID') } }
  const name = slug(manifest.name || fallbackName || '')
  if (!ID.test(name)) throw fail('PLUGIN_INVALID')
  const commands = []
  for (const file of [...files.keys()].filter(file => /^commands\/[^/]+\.md$/.test(file)).sort().slice(0, 100)) {
    const text = readText(files, file)
    if (!text) continue
    const { meta, body } = frontmatterOf(text)
    const command = slug(path.basename(file, '.md'))
    if (!command || !body.trim()) continue
    commands.push({ command, description: short(meta.description, 200), hint: short(meta['argument-hint'], 100), body: body.trim() })
  }
  const servers = []
  const mcpText = readText(files, '.mcp.json')
  if (mcpText) {
    let parsed
    try { parsed = JSON.parse(mcpText) } catch { parsed = null }
    const table = parsed && typeof parsed === 'object' ? (parsed.mcpServers && typeof parsed.mcpServers === 'object' ? parsed.mcpServers : parsed) : {}
    for (const [serverName, entry] of Object.entries(table).slice(0, 50)) {
      if (!entry || typeof entry !== 'object' || !/^[\w .-]{1,60}$/.test(serverName)) continue
      if (typeof entry.command === 'string') servers.push({ name: serverName, kind: 'stdio', command: short(entry.command, 200), args: (Array.isArray(entry.args) ? entry.args : []).map(arg => short(arg, 300)).slice(0, 30),
        envNames: Object.keys(entry.env && typeof entry.env === 'object' ? entry.env : {}).filter(key => /^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(key)).slice(0, 30) })
      else if (typeof entry.url === 'string' && /^https:\/\//.test(entry.url)) servers.push({ name: serverName, kind: 'remote', url: short(entry.url, 300) })
    }
  }
  const unsupported = []
  if ([...files.keys()].some(file => /^hooks\//.test(file))) unsupported.push('hooks')
  if ([...files.keys()].some(file => /^agents\/[^/]+\.md$/.test(file))) unsupported.push('agents')
  return { id: name, name: short(manifest.name || fallbackName, 80), description: short(manifest.description, 400), version: short(manifest.version, 40),
    author: short(typeof manifest.author === 'string' ? manifest.author : manifest.author?.name, 80), commands, servers, unsupported }
}

function createPlugins({ directory, skills, fetchImpl = globalThis.fetch, unzip = require('fflate').unzipSync }) {
  if (!path.isAbsolute(directory || '')) throw fail('INVALID_INPUT')
  const registryPath = path.join(directory, 'plugins.json'), marketsPath = path.join(directory, 'marketplaces.json')
  let queue = Promise.resolve()
  const serial = work => { const result = queue.then(work); queue = result.catch(() => {}); return result }
  async function readJson(file, fallback) {
    try { return JSON.parse(await fs.readFile(file, 'utf8')) } catch (error) { if (error.code === 'ENOENT') return fallback; throw fail('PLUGINS_UNAVAILABLE') }
  }
  async function writeJson(file, value) {
    const temporary = `${file}.${randomUUID()}.tmp`
    try { await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(temporary, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' }); await replaceFile(temporary, file) }
    catch { throw fail('PLUGINS_UNAVAILABLE') } finally { await fs.unlink(temporary).catch(() => {}) }
  }
  const registry = () => readJson(registryPath, { version: 1, plugins: {} })

  // Reads the plugin at a GitHub tree address without installing anything.
  async function inspect(url, signal) {
    const { bytes, source } = await skills.fetchArchive(url, signal)
    let all
    // Only entries inside the requested folder are inflated, with bounds on their number and total size.
    const folder = source.subdirectory ? source.subdirectory.replace(/^\/+|\/+$/g, '') + '/' : ''
    let entries = 0, inflated = 0
    try {
      all = unzip(new Uint8Array(bytes), { filter: file => {
        if (file.size > MAX_FILE || file.originalSize > MAX_FILE) return false
        if (!/(^|\/)(\.claude-plugin\/plugin\.json|\.mcp\.json|commands\/[^/]+\.md|SKILL\.md|hooks\/[^/]+|agents\/[^/]+\.md)$/.test(file.name)) return false
        if (!file.name.slice(file.name.indexOf('/') + 1).startsWith(folder)) return false
        entries++; inflated += file.originalSize
        if (entries > 3000 || inflated > 64 * 1024 * 1024) throw new Error('too large')
        return true
      } })
    } catch { throw fail('PLUGIN_INVALID') }
    // Entries are "<repo>-<ref>/<subdirectory>/<path>"; keep those inside the requested folder, relative to it.
    const prefixEnd = name => name.indexOf('/') + 1
    const base = source.subdirectory ? source.subdirectory.replace(/^\/+|\/+$/g, '') + '/' : ''
    const files = new Map()
    for (const [name, data] of Object.entries(all)) {
      if (name.includes('\0') || name.split('/').includes('..')) continue
      const inner = name.slice(prefixEnd(name))
      if (inner.startsWith(base) && inner.length > base.length) files.set(inner.slice(base.length), data)
    }
    const skillFiles = [...files.keys()].filter(file => /(^|\/)SKILL\.md$/.test(file))
    const found = skillFiles.length
    // The ids the skills will get (the same rule as the skill library), so conflicts are known before anything is written.
    const skillIds = skillFiles.map(file => skillIdOf(Buffer.from(files.get(file)).toString('utf8'))).filter(Boolean)
    const fallback = (source.subdirectory ? source.subdirectory.split('/').pop() : source.label.split('/').pop().split('@')[0])
    const plugin = readPlugin(files, fallback)
    if (!plugin.commands.length && !plugin.servers.length && !found) throw fail('PLUGIN_EMPTY')
    return { ...plugin, skillCount: found, skillIds, sourceUrl: url, sourceLabel: source.label, digest: createHash('sha256').update(bytes).digest('hex'), archive: { bytes, source } }
  }

  // What the owner sees: the plan without the archive itself, with the archive digest the install must match.
  async function preview(url, signal) { const { archive, ...plan } = await inspect(url, signal); return plan }

  // Commands, server proposals and skills all come from ONE archive. With `expectedDigest` (from the preview), an archive that changed in between is refused.
  async function install(url, signal, { expectedDigest = null } = {}) {
    const { archive, ...plugin } = await inspect(url, signal)
    if (expectedDigest && expectedDigest !== plugin.digest) throw fail('PLUGIN_CHANGED')
    // The ownership check, the skill writes and the registry commit are one step in the queue, so two installs can never both pass the check.
    return serial(async () => {
      const state = await registry()
      // A skill id already owned by another plugin is never overwritten.
      const ownedElsewhere = new Set(Object.values(state.plugins).filter(item => item.id !== plugin.id).flatMap(item => item.skills))
      if (plugin.skillIds.some(id => ownedElsewhere.has(id))) throw fail('PLUGIN_CONFLICT')
      const before = state.plugins[plugin.id]?.skills || []
      // A skill the owner installed separately is never replaced by a plugin.
      for (const id of plugin.skillIds) if (!before.includes(id) && typeof skills.has === 'function' && await skills.has(id)) throw fail('PLUGIN_CONFLICT')
      if (signal?.aborted) throw fail('CANCELLED')
      let rows = [], stuck = [], committed = false
      // The ids are reserved for this plugin from now until the registry commit, so no other writer can take or remove them in between.
      for (const id of [...plugin.skillIds, ...before]) reserved.set(id, plugin.id) // incoming and outgoing ids stay reserved through the cleanup below
      const previous = state.plugins[plugin.id] || null
      const owned = ids => [...new Set(ids)]
      try {
        // Ownership of every skill that may be written is recorded BEFORE anything is installed or enabled, so a crash at any later point
        // leaves each skill with its plugin (the entry is marked pending until the commit below).
        state.plugins[plugin.id] = { ...(previous || { id: plugin.id, name: plugin.name, description: plugin.description, version: plugin.version, author: plugin.author, sourceUrl: url, sourceLabel: plugin.sourceLabel,
          installedAt: new Date().toISOString(), digest: '', commands: [], servers: [], unsupported: [] }), skills: owned([...before, ...plugin.skillIds]), pending: true }
        await writeJson(registryPath, state)
        try {
        if (plugin.skillCount) {
          rows = await skills.install(url, signal, archive, { owner: plugin.id, mayReplace: before })
          // Whatever the library wrote must not belong to someone else either (a body the preview could not read).
          if (rows.some(row => ownedElsewhere.has(row.id))) throw fail('PLUGIN_CONFLICT')
          const written = owned([...before, ...plugin.skillIds, ...rows.map(row => row.id)])
          if (written.length !== state.plugins[plugin.id].skills.length) { state.plugins[plugin.id].skills = written; await writeJson(registryPath, state) }
          for (const row of rows) { if (signal?.aborted) break; await skills.setEnabled(row.id, true, signal) }
        }
        if (signal?.aborted) throw fail('CANCELLED')
        state.plugins[plugin.id] = { id: plugin.id, name: plugin.name, description: plugin.description, version: plugin.version, author: plugin.author, sourceUrl: url, sourceLabel: plugin.sourceLabel,
          installedAt: new Date().toISOString(), digest: plugin.digest, skills: [...rows.map(row => row.id), ...before.filter(old => !rows.some(row => row.id === old))], commands: plugin.commands, servers: plugin.servers, unsupported: plugin.unsupported }
        // The first commit already records the skills the new version has AND the ones it drops, so a restart at any point leaves every
        // installed skill with its owner; the dropped ones are released only after they are confirmed gone.
        await writeJson(registryPath, state)
        committed = true
        } catch (error) {
          if (error?.code === 'SKILL_EXISTS') error = fail('PLUGIN_CONFLICT')
          if (committed) throw error
          // Before the commit, a failed or cancelled install leaves no new skill behind (a skill the previous version already had keeps the body it has now).
          // One that cannot be removed keeps its owner and the failure is reported as pending cleanup.
          const failed = []
          // Only skills this very install handed back are removed. A previewed or reserved id proves nothing: the library undoes its own
          // partial writes when it fails, and a skill that appeared separately in the meantime is never touched.
          for (const id of owned(rows.map(row => row.id))) if (!before.includes(id) && !(await dropSkill(id, plugin.id))) failed.push(id)
          try {
            if (previous) state.plugins[plugin.id] = { ...previous, skills: owned([...before, ...failed]) }
            else if (failed.length) state.plugins[plugin.id] = { ...state.plugins[plugin.id], skills: failed, pending: true }
            else delete state.plugins[plugin.id]
            await writeJson(registryPath, state)
          } catch { /* the pending record written first still owns everything */ }
          if (failed.length) throw Object.assign(fail('PLUGIN_CLEANUP_PENDING'), { cause: error, pending: failed })
          throw error
        }
        // After the commit nothing is rolled back: the dropped skills are removed, and one that cannot be removed stays owned and reported.
        const dropped = before.filter(old => !rows.some(row => row.id === old))
        for (const old of dropped) if (!(await dropSkill(old, plugin.id))) stuck.push(old)
        if (dropped.length) {
          state.plugins[plugin.id].skills = [...rows.map(row => row.id), ...stuck]
          try { await writeJson(registryPath, state) } catch { if (!stuck.length) stuck.push(...dropped) } // the bookkeeping stays pending; ownership is still recorded
        }
      } finally { for (const id of [...plugin.skillIds, ...before]) if (reserved.get(id) === plugin.id) reserved.delete(id) }
      if (stuck.length) throw Object.assign(fail('PLUGIN_CLEANUP_PENDING'), { installed: true, pending: stuck })
      return { ...plugin, skills: rows.map(row => ({ id: row.id, name: row.name })), installed: true }
    })
  }

  // skill id -> the plugin that owns it (read without the queue: the skill library asks while an install runs inside it)
  const reserved = new Map()
  const ownedSkills = async () => new Map([...Object.values((await registry()).plugins).flatMap(item => item.skills.map(skill => [skill, item.id])), ...reserved])

  const list = () => serial(async () => Object.values((await registry()).plugins).map(item => ({ id: item.id, name: item.name, description: item.description, version: item.version, author: item.author,
    sourceLabel: item.sourceLabel, installedAt: item.installedAt, skills: item.skills.length, commands: item.commands.length, servers: item.servers, unsupported: item.unsupported })))

  // true when the skill is gone (already absent counts); false when it is still installed.
  const dropSkill = async (skillId, owner) => skills.remove(skillId, { owner }).then(() => true, error => error?.code === 'NOT_FOUND')
  const remove = id => serial(async () => {
    if (!ID.test(id)) throw fail('INVALID_INPUT')
    const state = await registry(), item = state.plugins[id]
    if (!item) throw fail('NOT_FOUND')
    const stuck = []
    for (const skillId of item.skills) if (!(await dropSkill(skillId, id))) stuck.push(skillId)
    // A skill that could not be removed keeps its owner, so it never lingers as active guidance with no plugin behind it.
    if (stuck.length) { state.plugins[id] = { ...item, skills: stuck }; await writeJson(registryPath, state); throw Object.assign(fail('PLUGIN_CLEANUP_PENDING'), { pending: stuck }) }
    delete state.plugins[id]
    await writeJson(registryPath, state)
    return true
  })

  // The "/" menu entries: every command of every installed plugin.
  const commands = () => serial(async () => Object.values((await registry()).plugins).flatMap(item => item.commands.map(command => ({ plugin: item.id, pluginName: item.name,
    command: item.id + '-' + command.command, description: command.description, hint: command.hint, body: command.body }))))

  // ---- marketplaces ----
  const markets = () => serial(async () => {
    const extra = (await readJson(marketsPath, { version: 1, markets: [] })).markets
    return [...DEFAULT_MARKETPLACES, ...extra]
  })
  const addMarketplace = repo => serial(async () => {
    const match = /^(?:https:\/\/github\.com\/)?([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(String(repo).trim())
    if (!match) throw fail('INVALID_INPUT')
    const state = await readJson(marketsPath, { version: 1, markets: [] })
    const id = slug(match[1] + '-' + match[2])
    if (!state.markets.some(item => item.id === id) && !DEFAULT_MARKETPLACES.some(item => item.id === id)) {
      if (state.markets.length >= 50) throw fail('LIMIT_REACHED')
      // The marketplace's real default branch is looked up once, so its folder entries resolve against the revision its catalog was read from.
      const info = await fetchImpl(`https://api.github.com/repos/${match[1]}/${match[2]}`, { signal: AbortSignal.timeout(30000), headers: { 'user-agent': 'NAJD-AGENT', accept: 'application/vnd.github+json' }, redirect: 'error' }).then(response => (response.ok ? response.json() : null)).catch(() => null)
      const branch = typeof info?.default_branch === 'string' && /^[\w.-]+$/.test(info.default_branch) ? info.default_branch : null
      if (!branch) throw fail('NETWORK')
      state.markets.push({ id, name: `${match[1]}/${match[2]}`, repo: `${match[1]}/${match[2]}`, ref: branch })
      await writeJson(marketsPath, state)
    }
    return id
  })
  const removeMarketplace = id => serial(async () => {
    const state = await readJson(marketsPath, { version: 1, markets: [] })
    state.markets = state.markets.filter(item => item.id !== id)
    await writeJson(marketsPath, state)
    return true
  })
  const cache = new Map()
  async function catalogOf(market, signal) {
    const cached = cache.get(market.id)
    if (cached && Date.now() - cached.at < 10 * 60000) return cached.entries
    const url = `https://raw.githubusercontent.com/${market.repo}/${market.ref}/.claude-plugin/marketplace.json`
    let response
    try { response = await fetchImpl(url, { signal: AbortSignal.any([AbortSignal.timeout(30000), ...(signal ? [signal] : [])]), headers: { 'user-agent': 'NAJD-AGENT' }, redirect: 'error' }) } catch { throw fail('DOWNLOAD_FAILED') }
    if (!response.ok) throw fail(response.status === 404 ? 'NOT_FOUND' : 'DOWNLOAD_FAILED')
    const text = await response.text()
    if (text.length > MAX_MARKETPLACE) throw fail('ARCHIVE_TOO_LARGE')
    let data
    try { data = JSON.parse(text) } catch { throw fail('PLUGIN_INVALID') }
    const entries = []
    for (const entry of Array.isArray(data?.plugins) ? data.plugins.slice(0, 2000) : []) {
      if (!entry || typeof entry.name !== 'string') continue
      let sourceUrl = null
      try { sourceUrl = githubTree(entry.source, market) } catch { /* a source NAJD cannot read (not GitHub) is listed but cannot be installed */ }
      entries.push({ market: market.id, name: short(entry.name, 80), description: short(entry.description, 400), category: short(entry.category, 40), author: short(entry.author?.name, 60), homepage: short(entry.homepage, 300), sourceUrl })
    }
    cache.set(market.id, { at: Date.now(), entries })
    return entries
  }
  async function search(query, { market: marketId, limit = 40 } = {}, signal) {
    const all = await markets()
    const chosen = marketId ? all.filter(item => item.id === marketId) : all
    const words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean)
    const results = []
    for (const market of chosen) {
      let entries
      try { entries = await catalogOf(market, signal) } catch (error) { if (error.code === 'CANCELLED') throw error; continue }
      for (const entry of entries) {
        const text = (entry.name + ' ' + entry.description + ' ' + entry.category).toLowerCase()
        if (words.every(word => text.includes(word))) results.push(entry)
      }
    }
    return results.slice(0, Math.max(1, Math.min(200, limit)))
  }

  return { preview, install, ownedSkills, list, remove, commands, markets, addMarketplace, removeMarketplace, search }
}
module.exports = { createPlugins, githubTree, readPlugin, DEFAULT_MARKETPLACES }
