// The agent finds and adds what it is missing (owner request 2026-10-20): skills from GitHub and MCP servers from the
// official MCP Registry. Searches are read-only. Installing asks the user in chat first; an MCP install is never
// answered automatically, in any access mode (najd-core ALWAYS_ASK). The card shows the exact package NAJD will run.
// - Skills are guidance only (external-skills.cjs): SKILL.md text, hash-pinned; their scripts are never run.
// - MCP servers: a registry stdio npm package is installed with NAJD's own Node and npm (--ignore-scripts) and started
//   with NAJD Node; a PyPI package is installed with NAJD's uv (--no-build, wheels only) and started from its launcher;
//   a remote (HTTP) server is reached through the mcp-remote bridge, installed the same way as an npm package.
//   Secrets a server needs are never invented: the user adds them in Settings.
const fsp = require('node:fs/promises'), path = require('node:path')
const { execFile } = require('node:child_process')
const { createHash } = require('node:crypto')
const fail = code => Object.assign(new Error(code), { code })

const REGISTRY = 'https://registry.modelcontextprotocol.io/v0/servers'
const BRIDGE = 'mcp-remote'
// Where good skills are published; the search also looks across GitHub.
const SKILL_SOURCES = [
  { name: 'Anthropic skills', url: 'https://github.com/anthropics/skills' },
  { name: 'OpenAI skills', url: 'https://github.com/openai/skills' },
  { name: 'Awesome Claude Skills', url: 'https://github.com/ComposioHQ/awesome-claude-skills' }
]
// The researched developer pack and connectors (docs/research/2026-10-18-agent-capabilities, M4, R-053): suggested when a
// search is about what they do, with the exact source or the registry search that finds them. A suggestion installs nothing;
// installing still goes through najd_extension_install and the owner's approval.
const RECOMMENDED = [
  { kind: 'mcp', title: 'Context7', use: 'current documentation of the exact library version while coding', search: 'context7', words: ['docs', 'documentation', 'library', 'api', 'coding', 'code', 'framework', 'context7'] },
  { kind: 'mcp', title: 'GitHub', use: 'repositories, issues, pull requests and Actions (needs the user\'s GitHub token)', search: 'github', words: ['github', 'repo', 'repository', 'issue', 'issues', 'pull', 'actions'] },
  { kind: 'mcp', title: 'Playwright', use: 'repeatable browser automation and web tests', search: 'playwright', words: ['browser', 'playwright', 'web test', 'e2e', 'automation', 'scrape'] },
  { kind: 'mcp', title: 'Chrome DevTools', use: 'console, network and performance traces of a web page under development', search: 'chrome devtools', words: ['devtools', 'console', 'performance', 'network', 'debug web'] },
  { kind: 'mcp', title: 'Notion', use: 'pages and databases in the user\'s Notion (needs the user\'s Notion token)', search: 'notion', words: ['notion', 'notes', 'wiki'] },
  { kind: 'mcp', title: 'Figma', use: 'reading designs from the user\'s Figma files (needs the user\'s Figma token)', search: 'figma', words: ['figma', 'design', 'mockup'] },
  { kind: 'skill', title: 'Superpowers', use: 'planning, debugging, test-driven development and verification workflows', repository: 'https://github.com/obra/superpowers', words: ['debug', 'debugging', 'plan', 'planning', 'test', 'tdd', 'workflow', 'review'] },
  { kind: 'skill', title: 'Vercel agent skills', use: 'React performance and web interface review', repository: 'https://github.com/vercel-labs/agent-skills', words: ['react', 'next', 'frontend', 'web ui', 'performance'] },
  { kind: 'skill', title: 'Anthropic skills', use: 'frontend design, document skills and building MCP servers (licence per skill)', repository: 'https://github.com/anthropics/skills', words: ['design', 'frontend', 'document', 'mcp', 'skill'] }
]
const recommendedFor = (query, kind) => {
  const text = String(query || '').toLowerCase()
  return RECOMMENDED.filter(item => item.kind === kind && item.words.some(word => text.includes(word))).slice(0, 4)
    .map(({ words, ...item }) => ({ ...item, note: item.kind === 'mcp' ? 'search the registry for "' + item.search + '" and install the official server' : 'this repository holds several skills: pick the one you need and install only its folder URL (https://github.com/owner/repo/tree/branch/path), never the whole repository' }))
}
const PACKAGE_NAME = /^(@[a-z0-9][a-z0-9._-]{0,100}\/)?[a-z0-9][a-z0-9._-]{0,100}$/i
const VERSION = /^[0-9A-Za-z][0-9A-Za-z.+-]{0,63}$/
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/
const short = (text, max) => String(text || '').replace(/\s+/g, ' ').trim().slice(0, max)

function createExtensions({ fetchImpl = fetch, skills, mcpServers, plugins = null, root, getNode, getNpmCli, getEngine, run = defaultRun }) {
  async function json(url, signal) {
    const response = await fetchImpl(url, { signal, headers: { accept: 'application/json', 'user-agent': 'NAJD-AGENT' } })
    if (!response.ok) throw fail(response.status === 403 || response.status === 429 ? 'PROVIDER_RATE_LIMIT' : 'SERVICE_UNAVAILABLE')
    return response.json()
  }
  const latestOnly = rows => (Array.isArray(rows) ? rows : []).filter(row => row?._meta?.['io.modelcontextprotocol.registry/official']?.isLatest !== false)
  const registrySearch = (query, signal) => json(REGISTRY + '?search=' + encodeURIComponent(query) + '&limit=60&version=latest', signal).then(data => latestOnly(data?.servers))

  // How NAJD can run a registry entry: a stdio npm package, then PyPI, then a remote URL that needs no headers.
  function packageOf(server) {
    const packages = (Array.isArray(server?.packages) ? server.packages : []).filter(item => (item?.transport?.type || 'stdio') === 'stdio' &&
      ['npm', 'pypi'].includes(item.registryType) && PACKAGE_NAME.test(item.identifier || '') && (!item.version || VERSION.test(item.version)))
    return packages.find(item => item.registryType === 'npm') || packages[0] || null
  }
  function remoteOf(server) {
    return (Array.isArray(server?.remotes) ? server.remotes : []).find(remote => ['streamable-http', 'sse'].includes(remote?.type) &&
      /^https:\/\/[^\s{}"]{1,500}$/.test(remote.url || '') && !(remote.headers || []).some(header => header?.isRequired)) || null
  }
  const needsOf = item => (Array.isArray(item?.environmentVariables) ? item.environmentVariables : [])
    .filter(variable => ENV_NAME.test(variable?.name || '') && variable.isRequired && !variable.default)
    .map(variable => ({ name: variable.name, secret: !!variable.isSecret, description: short(variable.description, 200) }))

  async function searchMcp(query, signal) {
    return (await registrySearch(query, signal)).map(row => {
      const server = row.server || {}, item = packageOf(server), remote = !item && remoteOf(server)
      return { name: short(server.name, 200), description: short(server.description, 300), version: short(server.version, 40),
        repository: short(server.repository?.url, 300), installable: !!(item || remote),
        package: item ? item.registryType + ':' + item.identifier : remote ? 'remote:' + remote.url.slice(0, 200) : null,
        needs: item ? needsOf(item) : [], ...(item || remote ? {} : { note: 'Needs headers or a package type NAJD cannot run; the user can add it in Settings.' }) }
    }).sort((a, b) => (Number(b.installable && !b.needs.length) - Number(a.installable && !a.needs.length))).slice(0, 15)
  }

  async function searchSkills(query, signal) {
    const q = encodeURIComponent(query + ' skill SKILL.md')
    const data = await json('https://api.github.com/search/repositories?q=' + q + '&sort=stars&order=desc&per_page=10', signal)
    const repos = (Array.isArray(data?.items) ? data.items : []).map(repo => ({ name: short(repo.full_name, 140), url: short(repo.html_url, 300),
      description: short(repo.description, 300), stars: Number(repo.stargazers_count) || 0, updated: short(repo.pushed_at, 30) }))
    return { repositories: repos, curatedSources: SKILL_SOURCES, recommended: recommendedFor(query, 'skill'),
      // Repositories are for finding skills; installing one takes that skill's folder URL (C44-02).
      note: 'These repositories are for finding skills. Install one skill with najd_extension_install kind "skill" and the folder URL of that skill (https://github.com/owner/repo/tree/branch/path). A repository URL installs and enables every skill in it: use it only when the user asked for all of them.' }
  }

  async function installSkill(url, signal) {
    if (typeof url !== 'string' || !/^https:\/\/(github\.com|raw\.githubusercontent\.com)\//i.test(url) || url.length > 500) throw fail('INVALID_INPUT')
    const rows = await skills.install(url, signal)
    // Enabling honours the same cancel; what was installed before a cancel is reported truthfully.
    const enabled = []
    for (const row of rows) {
      if (signal?.aborted) return { status: 'cancelled', installed: rows.map(item => item.id), enabled, note: 'Installed but not all enabled; nothing else was changed.' }
      await skills.setEnabled(row.id, true, signal)
      enabled.push(row.id)
    }
    return { status: 'installed', skills: rows.map(row => ({ id: row.id, name: row.name, description: short(row.description, 200), compatibility: row.compatibility })),
      note: 'Enabled. Read one with najd_skills_read before following it.' }
  }

  // Launch arguments from the registry entry (NAJD-R04). Positional and named package arguments with a fixed value or a
  // default are used; one that needs a value only the user knows makes the server "needs_user_input". runtimeArguments
  // configure npx/uvx, which NAJD replaces with its own runtimes, so they are not used; any other runtime is unsupported.
  function argumentsOf(item) {
    const args = [], needs = []
    for (const arg of Array.isArray(item.packageArguments) ? item.packageArguments : []) {
      const value = arg?.value ?? arg?.default
      const label = short(arg?.name || arg?.valueHint || 'argument', 60)
      const unresolved = typeof value === 'string' && /\{[^}]+\}/.test(value)
      if (arg?.type === 'named') {
        if (typeof arg.name !== 'string' || !/^-{1,2}[A-Za-z0-9][A-Za-z0-9_.-]{0,60}$/.test(arg.name)) return { unsupported: true }
        if (value === undefined && !arg.valueHint) { args.push(arg.name); continue }
        if (value === undefined || unresolved) { if (arg.isRequired) needs.push({ name: label, secret: !!arg.isSecret, description: short(arg.description, 200) }); continue }
        args.push(arg.name, String(value).slice(0, 400))
      } else if (arg?.type === 'positional') {
        if (value === undefined || unresolved) { if (arg.isRequired) needs.push({ name: label, secret: !!arg.isSecret, description: short(arg.description, 200) }); continue }
        args.push(String(value).slice(0, 400))
      } else return { unsupported: true }
    }
    if (args.some(arg => /[\x00\r\n]/.test(arg))) return { unsupported: true }
    return { args, needs }
  }
  const EXACT = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/
  // Requires-Python (PEP 440) checked against NAJD's full Python version, e.g. 3.14.7 (R8-003, R9-002):
  // release segments compared with zero padding, ".*" prefix matches for == and !=, and ~= as ">= V, == V minus its
  // last segment .*". Anything that cannot be read is not trusted.
  function requiresPythonAllows(spec, version) {
    if (spec === undefined || spec === null || String(spec).trim() === '') return true
    if (!Array.isArray(version) || version.length < 3) return false
    const compare = (a, b) => { for (let i = 0; i < Math.max(a.length, b.length); i++) { const d = (a[i] || 0) - (b[i] || 0); if (d) return d } return 0 }
    const prefix = (target, segments) => segments.every((value, index) => (target[index] || 0) === value)
    for (const part of String(spec).split(',').map(text => text.trim()).filter(Boolean)) {
      const match = part.match(/^(===|>=|<=|==|!=|~=|>|<)\s*(\d+(?:\.\d+)*)(\.\*)?$/)
      if (!match) return false
      const [, op, text, star] = match
      const wanted = text.split('.').map(Number)
      if (star && !['==', '!='].includes(op)) return false
      const diff = compare(version, wanted)
      let ok
      if (op === '==' || op === '===') ok = star ? prefix(version, wanted) : diff === 0
      else if (op === '!=') ok = star ? !prefix(version, wanted) : diff !== 0
      else if (op === '>=') ok = diff >= 0
      else if (op === '>') ok = diff > 0
      else if (op === '<=') ok = diff <= 0
      else if (op === '<') ok = diff < 0
      else { if (wanted.length < 2) return false; ok = diff >= 0 && prefix(version, wanted.slice(0, -1)) } // ~=
      if (!ok) return false
    }
    return true
  }
  // Wheels read while planning are kept for the install, by their verified sha256 (a few, newest last).
  const wheelCache = new Map()
  async function downloadWheel(url, sha256, signal) {
    if (wheelCache.has(sha256)) return wheelCache.get(sha256)
    const response = await fetchImpl(url, { signal, headers: { 'user-agent': 'NAJD-AGENT' } })
    if (!response.ok) throw fail('SERVICE_UNAVAILABLE')
    // Read as a stream and stopped the moment it passes the limit, declared length or not (I15-001).
    const limit = 64 * 1024 * 1024
    const length = Number(response.headers?.get?.('content-length'))
    if (length > limit) { try { await response.body?.cancel?.() } catch {} throw fail('UNSUPPORTED_PACKAGE') }
    if (!response.body) throw fail('SERVICE_UNAVAILABLE')
    const chunks = []
    let total = 0
    const reader = response.body.getReader()
    try {
      for (;;) {
        if (signal?.aborted) throw fail('CANCELLED')
        const { done, value } = await reader.read()
        if (done) break
        total += value.length
        if (total > limit) throw fail('UNSUPPORTED_PACKAGE')
        chunks.push(Buffer.from(value))
      }
    } catch (error) { try { await reader.cancel() } catch {} throw error.code ? error : fail('SERVICE_UNAVAILABLE') }
    const bytes = Buffer.concat(chunks, total)
    if (createHash('sha256').update(bytes).digest('hex') !== sha256) throw fail('INTEGRITY_MISMATCH')
    while (wheelCache.size >= 4) wheelCache.delete(wheelCache.keys().next().value)
    return bytes
  }
  // console_scripts from the wheel's entry_points.txt, inflated as a stream and stopped at 64 KB whatever the archive
  // declares, so a crafted wheel cannot expand without bound.
  function consoleScripts(bytes) {
    const { Unzip, UnzipInflate, UnzipPassThrough } = require('fflate')
    const unzip = new Unzip()
    unzip.register(UnzipInflate); unzip.register(UnzipPassThrough)
    const chunks = []
    let size = 0, entries = 0, tooBig = false
    unzip.onfile = file => {
      if (++entries > 20000) { tooBig = true; return }
      if (!/^[^/]+\.dist-info\/entry_points\.txt$/.test(file.name)) return
      file.ondata = (error, chunk) => {
        if (error || tooBig) { tooBig = true; return }
        size += chunk.length
        if (size > 65536) { tooBig = true; try { file.terminate() } catch {} return }
        chunks.push(Buffer.from(chunk))
      }
      file.start()
    }
    for (let offset = 0; offset < bytes.length && !tooBig; offset += 1 << 16) unzip.push(bytes.subarray(offset, Math.min(bytes.length, offset + (1 << 16))), offset + (1 << 16) >= bytes.length)
    if (tooBig) throw fail('UNSUPPORTED_PACKAGE')
    const text = Buffer.concat(chunks).toString('utf8')
    const section = text.split(/^\[/m).find(part => /^console_scripts\]/.test(part)) || ''
    return section.split(/\r?\n/).slice(1).map(line => line.split('=')[0].trim()).filter(script => /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/.test(script))
  }
  // PyPI versions follow PEP 440 (1.2, 1.2.3rc1, 1.2.3.post1), not SemVer (I2-005).
  const PEP440 = /^\d+(\.\d+)*((a|b|rc)\d+)?(\.post\d+)?(\.dev\d+)?$/i
  // An exact npm release and its integrity, resolved before the user is asked (NAJD-R07): tags such as "latest" or a
  // missing version are resolved now, so what is approved is what is installed.
  async function npmRelease(name, version, signal) {
    // A requested version that cannot be read is refused, never replaced by latest.
    if (version && !VERSION.test(version)) throw fail('UNSUPPORTED_PACKAGE')
    const doc = await json('https://registry.npmjs.org/' + name.replace('/', '%2F') + '/' + encodeURIComponent(version || 'latest'), signal)
    const exact = String(doc?.version || ''), integrity = String(doc?.dist?.integrity || '')
    if (doc?.name !== name || !EXACT.test(exact) || !/^sha512-[A-Za-z0-9+/=]{80,100}$/.test(integrity) || version && EXACT.test(version) && exact !== version) throw fail('SERVICE_UNAVAILABLE')
    // The program to run, from the release's own bin before approval (R14-002): the one named after the package,
    // or the only one. Several without a clear one are refused rather than guessed.
    const base = name.split('/').pop()
    const bins = typeof doc.bin === 'string' ? { [base]: doc.bin } : doc.bin && typeof doc.bin === 'object' ? doc.bin : {}
    const names = Object.keys(bins).filter(key => /^[A-Za-z0-9@][A-Za-z0-9._@/-]{0,100}$/.test(key) && typeof bins[key] === 'string')
    const program = names.includes(base) ? base : names.length === 1 ? names[0] : null
    return { version: exact, integrity, program, programPath: program ? bins[program] : null }
  }
  // An exact PyPI release and one wheel of it with its sha256; the wheel itself is downloaded and checked at install.
  async function pypiRelease(name, version, signal) {
    if (version && !PEP440.test(version)) throw fail('UNSUPPORTED_PACKAGE')
    const doc = await json('https://pypi.org/pypi/' + encodeURIComponent(name) + (version ? '/' + encodeURIComponent(version) : '') + '/json', signal)
    const exact = String(doc?.info?.version || '')
    const wheels = (Array.isArray(doc?.urls) ? doc.urls : []).filter(file => file?.packagetype === 'bdist_wheel' && /^https:\/\/files\.pythonhosted\.org\//.test(file.url || '') && /^[a-f0-9]{64}$/.test(file?.digests?.sha256 || ''))
    // A wheel NAJD's own Python can install (R6-003): pure Python first, then a Windows x64 build for exactly this
    // CPython version or a stable-ABI (abi3) build for this version or older. No compatible wheel: refused before approval.
    const engine = getEngine ? await getEngine().catch(() => null) : null
    const found = String(engine?.receiptPython || engine?.python || '').match(/python-(\d+)\.(\d+)\.(\d+)/)
    const fullVersion = found ? found.slice(1, 4).map(Number) : null
    const minor = fullVersion && fullVersion[0] === 3 ? fullVersion[1] : NaN
    const compatible = file => {
      const tags = file.filename.replace(/\.whl$/, '').split('-').slice(-3)
      if (tags.length !== 3) return false
      const [py, abi, platform] = tags
      // Pure Python: py3, or py3N up to NAJD's own minor version (R8-003).
      if (abi === 'none' && platform === 'any') return py.split('.').some(tag => tag === 'py3' || /^py3\d+$/.test(tag) && Number.isInteger(minor) && Number(tag.slice(3)) <= minor)
      if (platform !== 'win_amd64' || !Number.isInteger(minor)) return false
      if (abi === 'cp3' + minor) return py.split('.').includes('cp3' + minor)
      return abi === 'abi3' && py.split('.').some(tag => /^cp3(\d+)$/.test(tag) && Number(tag.slice(3)) <= minor)
    }
    // The release must also accept this Python (Requires-Python), when NAJD knows its version.
    if (!requiresPythonAllows(doc?.info?.requires_python, fullVersion)) throw fail('UNSUPPORTED_PACKAGE')
    const wheel = wheels.find(file => compatible(file) && file.filename.endsWith('-none-any.whl')) || wheels.find(compatible)
    if (!PEP440.test(exact) || !wheel || version && exact.toLowerCase() !== version.toLowerCase()) throw fail(wheel ? 'SERVICE_UNAVAILABLE' : 'UNSUPPORTED_PACKAGE')
    // The program the server runs is read from the wheel itself before approval (R13-002): its console scripts.
    const bytes = await downloadWheel(wheel.url, wheel.digests.sha256, signal)
    const scripts = consoleScripts(bytes)
    const normalized = text => text.toLowerCase().replace(/[-_.]+/g, '-')
    const executable = scripts.find(script => normalized(script) === normalized(name)) || (scripts.length === 1 ? scripts[0] : null)
    if (!executable) throw Object.assign(fail('UNSUPPORTED_PACKAGE'), { detail: scripts.length ? 'Several programs and none named after the package: ' + scripts.slice(0, 8).join(', ') : 'The package declares no program to run.' })
    wheelCache.set(wheel.digests.sha256, bytes)
    return { version: exact, executable, wheel: { url: wheel.url, filename: short(wheel.filename, 200), sha256: wheel.digests.sha256 } }
  }

  // What installing an MCP server will do, shown on the approval card before anything is downloaded.
  async function planMcp(name, signal) {
    if (typeof name !== 'string' || !name.trim() || name.length > 200) throw fail('INVALID_INPUT')
    const server = (await registrySearch(name.trim(), signal)).find(row => row?.server?.name === name.trim())?.server
    if (!server) throw fail('NOT_FOUND')
    const about = { name: server.name, description: short(server.description, 300), repository: short(server.repository?.url, 300) }
    const item = packageOf(server)
    if (item) {
      if (item.runtimeHint && !['npx', 'uvx', 'node', 'python', 'pip'].includes(item.runtimeHint)) return { status: 'unsupported', note: 'This server needs a runtime NAJD does not provide (' + short(item.runtimeHint, 30) + ').' }
      const parsed = argumentsOf(item)
      if (parsed.unsupported) return { status: 'unsupported', note: 'This server has launch arguments NAJD cannot pass safely; the user can add it in Settings > Connections.' }
      const needs = [...needsOf(item), ...parsed.needs]
      if (needs.length) return { status: 'needs_user_input', needs, note: 'This server needs values only the user can provide. Ask the user to add it in Settings > Connections with those values; never invent or ask for secrets in chat.' }
      const env = Object.fromEntries((item.environmentVariables || []).filter(variable => variable?.default && ENV_NAME.test(variable.name)).map(variable => [variable.name, String(variable.default).slice(0, 400)]))
      if (item.registryType === 'npm') {
        const release = await npmRelease(item.identifier, item.version, signal)
        if (!release.program) return { status: 'unsupported', note: 'This package declares several programs and none named after it, or none at all; NAJD will not guess which one to run.' }
        return { status: 'ready', server: about, registryType: 'npm', packageName: item.identifier, version: release.version, integrity: release.integrity, program: release.program, spec: item.identifier + '@' + release.version, env, args: parsed.args }
      }
      const release = await pypiRelease(item.identifier, item.version, signal)
      return { status: 'ready', server: about, registryType: 'pypi', packageName: item.identifier, version: release.version, executable: release.executable, wheel: release.wheel, spec: item.identifier + '==' + release.version, env, args: parsed.args }
    }
    const remote = remoteOf(server)
    if (!remote) return { status: 'unsupported', note: 'This server needs headers or a package type NAJD cannot run; the user can add it in Settings > Connections.' }
    if (/\{[^}]+\}/.test(remote.url)) return { status: 'unsupported', note: 'This remote server needs values in its address; the user can add it in Settings > Connections.' }
    const release = await npmRelease(BRIDGE, null, signal)
    return { status: 'ready', server: about, registryType: 'remote', url: remote.url, packageName: BRIDGE, version: release.version, integrity: release.integrity, program: release.program, spec: BRIDGE + '@' + release.version, env: {}, args: [remote.url] }
  }

  // Installs exactly the approved release, registers and connects it. Cancellation is honoured between every step, in
  // the registration queue and during connection; a server cancelled after registration is removed again (NAJD-R03).
  // Each exact release gets its own folder, named by a digest of its full identity, so two releases (or two packages
  // whose names look alike) never share files (I3-001). Installs of one identity run one at a time; a folder is
  // complete only once its marker is written after verification, and an incomplete one is discarded and redone.
  const installing = new Map()
  function installMcp(plan, signal) {
    const identity = JSON.stringify([plan.registryType, plan.packageName, plan.version, plan.integrity || plan.wheel?.sha256 || ''])
    const digest = createHash('sha256').update(identity).digest('hex').slice(0, 32)
    const previous = installing.get(digest) || Promise.resolve()
    const next = previous.catch(() => {}).then(() => installRelease(plan, signal, digest, identity))
    installing.set(digest, next)
    next.finally(() => { if (installing.get(digest) === next) installing.delete(digest) }).catch(() => {})
    return next
  }
  async function installRelease(plan, signal, digest, identity) {
    const check = () => { if (signal?.aborted) throw fail('CANCELLED') }
    check()
    const folder = path.join(root, plan.registryType === 'pypi' ? 'pypi' : 'npm', digest)
    const marker = path.join(folder, 'najd-release.json')
    if ((await fsp.readFile(marker, 'utf8').catch(() => '')) !== identity) await fsp.rm(folder, { recursive: true, force: true })
    await fsp.mkdir(folder, { recursive: true })
    let command, args
    if (plan.registryType === 'pypi') {
      const engine = await getEngine()
      if (!engine?.uv) throw fail('RUNTIME_NOT_READY')
      // The approved wheel is downloaded and checked against its published sha256 before uv sees it.
      const bytes = await downloadWheel(plan.wheel.url, plan.wheel.sha256, signal)
      check()
      const wheel = path.join(folder, path.basename(plan.wheel.filename))
      await fsp.writeFile(wheel, bytes)
      const bins = path.join(folder, 'bin')
      await run(engine.uv, ['tool', 'install', '--no-build', '--python', engine.python, wheel], { signal, env: { UV_TOOL_DIR: path.join(folder, 'tools'), UV_TOOL_BIN_DIR: bins } })
      check()
      // Exactly the program that was approved, never another one the package also installs.
      const launchers = (await fsp.readdir(bins).catch(() => [])).filter(file => /\.exe$/i.test(file))
      const launcher = launchers.find(file => file.toLowerCase() === String(plan.executable).toLowerCase() + '.exe')
      if (!launcher) throw fail('START_FAILED')
      command = path.join(bins, launcher); args = [...plan.args]
    } else {
      const node = getNode(), npm = getNpmCli()
      if (!node || !npm) throw fail('RUNTIME_NOT_READY')
      await run(node, [npm, 'install', '--prefix', folder, '--ignore-scripts', '--no-audit', '--no-fund', '--omit=dev', '--save-exact', plan.spec], { signal, env: { PATH: path.dirname(node) + path.delimiter + (process.env.PATH || '') } })
      check()
      // What npm installed must be the approved release with the integrity resolved before approval.
      const lock = JSON.parse(await fsp.readFile(path.join(folder, 'package-lock.json'), 'utf8').catch(() => '{}'))
      const locked = lock?.packages?.['node_modules/' + plan.packageName]
      if (locked?.version !== plan.version || locked?.integrity !== plan.integrity) throw fail('INTEGRITY_MISMATCH')
      const home = path.join(folder, 'node_modules', ...plan.packageName.split('/'))
      const manifest = JSON.parse(await fsp.readFile(path.join(home, 'package.json'), 'utf8'))
      if (manifest.version !== plan.version) throw fail('INTEGRITY_MISMATCH')
      // Exactly the approved program, never another bin the package also declares.
      const bin = typeof manifest.bin === 'string' ? (plan.program === plan.packageName.split('/').pop() ? manifest.bin : null) : manifest.bin?.[plan.program]
      if (typeof bin !== 'string') throw fail('START_FAILED')
      const entry = path.resolve(home, bin)
      if (!entry.startsWith(home + path.sep)) throw fail('START_FAILED')
      command = mcpServers.BUNDLED; args = [entry, ...plan.args]
    }
    check()
    // The release is verified: the folder is now complete for this exact identity.
    await fsp.writeFile(marker, identity)
    const added = await mcpServers.add({ name: short(plan.server.name.split('/').pop(), 40) || 'MCP server', command, args, env: plan.env }, { approvedInChat: true, signal })
    if (added?.status !== 'added') return { status: 'cancelled' }
    // A registration interrupted by a cancel or an error is removed again, whatever stage it reached (I2-002).
    let view, kept = false
    try {
      view = await mcpServers.connect(added.server.id, { signal })
      check()
      kept = true
    } finally { if (!kept) await mcpServers.remove(added.server.id).catch(() => {}) }
    return { status: view.state === 'connected' ? 'connected' : 'added', server: added.server.id, state: view.state, error: view.error, release: plan.spec,
      tools: (view.tools || []).slice(0, 40).map(tool => ({ name: tool.name, description: short(tool.description, 160) })),
      note: view.state === 'connected' ? 'Connected. Call its tools with najd_mcp_call.' : 'Added but not connected; the user can retry it in Settings > Connections.' }
  }

  // Plugins (skills + commands + server proposals) from a marketplace or a GitHub address (plugins.cjs).
  const searchPlugins = (query, signal) => plugins ? plugins.search(query, {}, signal) : Promise.resolve([])
  const previewPlugin = (url, signal) => { if (!plugins) throw fail('SERVICE_UNAVAILABLE'); return plugins.preview(url, signal) }
  const installPlugin = (url, signal, options) => { if (!plugins) throw fail('SERVICE_UNAVAILABLE'); return plugins.install(url, signal, options) }
  // A skill NAJD writes from repeated work, after the owner approved it (external-skills.cjs saveLearned).
  async function saveSkill(input, signal) {
    const row = await skills.saveLearned(input || {}, signal)
    return { status: 'saved', skill: { id: row.id, name: row.name, description: short(row.description, 200) }, note: 'Enabled; read it with najd_skills_read when the same kind of task comes again. The owner can disable or remove it in Settings > Skills.' }
  }

  return { requiresPythonAllows, searchMcp, searchSkills, installSkill, saveSkill, recommended: recommendedFor, planMcp, installMcp, searchPlugins, previewPlugin, installPlugin, SKILL_SOURCES }
}

// Installers (npm, uv) and everything they start - git, transports, build helpers - end together (I16-001): a
// cancel or the ten-minute limit ends the whole process tree while its root still holds it, and the promise settles only
// once the root has closed, so the install lock is not released while helpers still run.
function defaultRun(command, args, { signal, env = {}, timeoutMs = 600000 } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(fail('CANCELLED'))
    const { spawn } = require('node:child_process')
    const child = spawn(command, args, { windowsHide: true, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = '', ended = null
    const collect = chunk => { if (output.length < 64 * 1024) output += chunk.toString('utf8') }
    child.stdout.on('data', collect); child.stderr.on('data', collect)
    const endTree = reason => {
      if (ended) return
      ended = reason
      if (process.platform === 'win32' && child.pid) execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {})
      else try { child.kill('SIGKILL') } catch {}
    }
    const onAbort = () => endTree('CANCELLED')
    const timer = setTimeout(() => endTree('INSTALL_FAILED'), timeoutMs)
    signal?.addEventListener('abort', onAbort, { once: true })
    child.on('error', error => { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); reject(Object.assign(fail('INSTALL_FAILED'), { detail: short(error.message, 400) })) })
    child.on('close', code => {
      clearTimeout(timer); signal?.removeEventListener('abort', onAbort)
      if (ended) return reject(Object.assign(fail(ended), { detail: ended === 'CANCELLED' ? 'Cancelled.' : 'Timed out.' }))
      code === 0 ? resolve() : reject(Object.assign(fail('INSTALL_FAILED'), { detail: short(output, 400) }))
    })
  })
}

module.exports = { defaultRun, requiresPythonAllows: (...args) => createExtensions({}).requiresPythonAllows(...args), createExtensions, REGISTRY, SKILL_SOURCES, recommendedFor }
