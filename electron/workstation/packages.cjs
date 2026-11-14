// NAJD package manager (spec 4.6): stage -> hash/provenance -> archive and executable scan -> manifest -> dependency plan -> permission
// preview -> atomic install -> health check -> activate -> rollback on failure. Nothing inside a package runs here, at any step.
const fs = require('node:fs/promises')
const path = require('node:path')
const { createHash, randomUUID } = require('node:crypto')
const { unzipSync } = require('fflate')
const { replaceFile } = require('../atomic-file.cjs')
const { validateManifest } = require('../workstation-registry.cjs')
const { compareVersions } = require('./catalog.cjs')

const error = (code, detail) => Object.assign(new Error(code), { code }, detail ? { detail } : {})
const MANIFEST = 'najd-package.json'
const MAX_ARCHIVE = 64 * 1024 * 1024, MAX_ENTRIES = 2000, MAX_TOTAL = 256 * 1024 * 1024, MAX_FILE = 64 * 1024 * 1024
const EXECUTABLE = /\.(exe|dll|msi|bat|cmd|ps1|psm1|vbs|vbe|wsf|scr|com|cpl|node|sys|jar|lnk)$/i
const PLAN_LIFETIME = 10 * 60 * 1000
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
const safeEntry = name => typeof name === 'string' && name.length < 400 && !name.includes('\0') && !name.includes('\\') && !name.startsWith('/') && !/^[a-zA-Z]:/.test(name) && !name.split('/').some(part => part === '..' || part === '.')

// The digest a manifest declares covers every file but the manifest itself, in sorted order.
function payloadDigest(files) {
  return sha256(Object.keys(files).filter(name => name !== MANIFEST).sort().map(name => name + '\0' + sha256(files[name]) + '\n').join(''))
}

function readArchive(bytes) {
  if (bytes.length > MAX_ARCHIVE) throw error('PACKAGE_TOO_LARGE')
  let count = 0, total = 0, bad = false
  let raw
  try {
    // fflate inflates into a buffer of the declared size, so the sizes checked here also bound what is produced.
    raw = unzipSync(bytes, { filter: file => {
      count++; total += file.originalSize
      if (count > MAX_ENTRIES || total > MAX_TOTAL || file.originalSize > MAX_FILE || !safeEntry(file.name)) { bad = true; return false }
      return !file.name.endsWith('/')
    } })
  } catch { throw error('PACKAGE_ARCHIVE_INVALID') }
  if (bad) throw error('PACKAGE_ARCHIVE_INVALID')
  return raw
}

function inspect(bytes, { expectedSha256, appVersion, platform, arch, installedIds }) {
  const archiveSha256 = sha256(bytes)
  if (expectedSha256 && expectedSha256 !== archiveSha256) throw error('PACKAGE_DIGEST_MISMATCH')
  const files = readArchive(bytes)
  if (!files[MANIFEST]) throw error('PACKAGE_MANIFEST_MISSING')
  let manifest
  try { manifest = JSON.parse(Buffer.from(files[MANIFEST]).toString('utf8')) } catch { throw error('PACKAGE_MANIFEST_INVALID') }
  const checked = validateManifest(manifest)
  if (!checked.ok) throw error('PACKAGE_MANIFEST_INVALID', checked.problems)
  if (manifest.integrity.sha256 !== payloadDigest(files)) throw error('PACKAGE_DIGEST_MISMATCH')
  if (!manifest.compatibility.os.includes(platform) || !manifest.compatibility.arch.includes(arch) || compareVersions(appVersion, manifest.compatibility.minNajd) < 0) throw error('PACKAGE_INCOMPATIBLE')
  const executables = Object.keys(files).filter(name => EXECUTABLE.test(name))
  if (executables.length && !manifest.permissions.some(permission => permission?.id === 'execute')) throw error('PACKAGE_UNDECLARED_EXECUTABLE', executables.slice(0, 20))
  for (const skill of manifest.skills || []) if (!safeEntry(String(skill)) || !files[skill + '/SKILL.md']) throw error('PACKAGE_SKILL_MISSING', [skill])
  const dependencies = manifest.dependencies.map(item => ({ ...item, satisfied: item?.kind === 'package' ? installedIds.has(item.id) : null }))
  return { files, manifest, archiveSha256, executables, dependencies }
}

function createWorkstationPackages({ directory, appVersion, platform = process.platform, arch = process.arch, onChange = () => {}, beforeChange = async () => {}, fetchImpl = globalThis.fetch, health = async () => ({ ok: true }) }) {
  if (!path.isAbsolute(directory || '')) throw error('INVALID_INPUT')
  const stateFile = path.join(directory, 'packages.json'), root = path.join(directory, 'installed'), staging = path.join(directory, 'staging')
  const plans = new Map()
  let queue = Promise.resolve()
  const serial = work => { const result = queue.then(work); queue = result.catch(() => {}); return result }

  async function load() {
    let raw
    try { raw = await fs.readFile(stateFile, 'utf8') } catch (reason) { if (reason.code === 'ENOENT') return { version: 1, packages: {} }; throw reason }
    try { const value = JSON.parse(raw); if (value?.version === 1 && value.packages && typeof value.packages === 'object') return value } catch {}
    await fs.rename(stateFile, stateFile + '.corrupt-' + Date.now()).catch(() => {})
    return { version: 1, packages: {} }
  }
  async function save(state) {
    await fs.mkdir(directory, { recursive: true })
    const temporary = stateFile + '.' + randomUUID() + '.tmp'
    await fs.writeFile(temporary, JSON.stringify(state, null, 1) + '\n', { flag: 'wx' })
    await replaceFile(temporary, stateFile)
  }
  const folder = (id, version) => path.join(root, id, version)
  const shape = row => ({ id: row.id, version: row.version, previousVersion: row.previous || null, enabled: row.enabled, kind: row.manifest.skills?.length && !(Array.isArray(row.manifest.mcpServers) ? row.manifest.mcpServers.length : row.manifest.mcpServers) ? 'skill' : 'plugin', displayName: row.manifest.displayName, description: row.manifest.description,
    publisher: row.manifest.publisher, permissions: row.manifest.permissions, mcpServers: require('./mcp-declarations.cjs').mcpDeclarations(Object.fromEntries((Array.isArray(row.manifest.mcpServers) ? row.manifest.mcpServers : []).map(item => [item.name, item]))), ready: row.ready !== false, installedAt: row.installedAt, source: row.source })

  async function prepare(bytes, source, expectedSha256) {
    const state = await load()
    const { manifest, archiveSha256, executables, dependencies } = inspect(bytes, { expectedSha256, appVersion, platform, arch, installedIds: new Set(Object.keys(state.packages)) })
    const planId = randomUUID()
    plans.set(planId, { bytes, source, expectedSha256: archiveSha256, createdAt: Date.now() })
    for (const [id, plan] of plans) if (Date.now() - plan.createdAt > PLAN_LIFETIME) plans.delete(id)
    const current = state.packages[manifest.id]
    return { planId, id: manifest.id, version: manifest.version, currentVersion: current?.version || null, displayName: manifest.displayName, description: manifest.description, publisher: manifest.publisher, permissions: manifest.permissions, dependencies, executables, license: manifest.license, archiveSha256, source }
  }

  async function install(planId) {
    const plan = plans.get(planId)
    if (!plan) throw error('PLAN_EXPIRED')
    plans.delete(planId)
    const state = await load()
    const { files, manifest } = inspect(plan.bytes, { expectedSha256: plan.expectedSha256, appVersion, platform, arch, installedIds: new Set(Object.keys(state.packages)) })
    const stage = path.join(staging, randomUUID())
    const target = folder(manifest.id, manifest.version)
    const current = state.packages[manifest.id]
    try {
      for (const [name, data] of Object.entries(files)) {
        const destination = path.join(stage, ...name.split('/'))
        await fs.mkdir(path.dirname(destination), { recursive: true })
        await fs.writeFile(destination, data, { flag: 'wx' })
      }
      const result = await health({ manifest, directory: stage }).catch(() => ({ ok: false }))
      if (!result.ok) throw error('PACKAGE_HEALTH_FAILED')
      await fs.mkdir(path.dirname(target), { recursive: true })
      await fs.rm(target, { recursive: true, force: true })
      await fs.rename(stage, target)
      state.packages[manifest.id] = { id: manifest.id, version: manifest.version, previous: current && current.version !== manifest.version ? current.version : current?.previous || null, enabled: current ? current.enabled : true, manifest, ready: manifest.dependencies.every(item => item.kind !== 'package' || state.packages[item.id]), installedAt: new Date().toISOString(), source: plan.source }
      await save(state)
    } catch (reason) {
      await fs.rm(stage, { recursive: true, force: true }).catch(() => {})
      throw reason
    }
    onChange()
    return shape(state.packages[manifest.id])
  }

  // A package's skills, for the one skill surface: only enabled packages, and read from the installed copy.
  async function skills() {
    const state = await load(), rows = []
    for (const row of Object.values(state.packages)) if (row.enabled && row.ready !== false) for (const skill of row.manifest.skills || [])
      rows.push({ packageId: row.id, id: skill.split('/').pop(), directory: path.join(folder(row.id, row.version), ...skill.split('/')) })
    return rows
  }

  return {
    list: () => serial(async () => Object.values((await load()).packages).map(shape)),
    skills: () => serial(skills),
    // Rows for the skill surface; the procedure is read from the installed copy only when selected.
    skillRows: () => serial(async () => {
      const rows = []
      for (const item of await skills()) {
        const body = await fs.readFile(path.join(item.directory, 'SKILL.md'), 'utf8').catch(() => '')
        const field = key => (new RegExp('^' + key + ': (.+)$', 'm').exec(body) || [])[1] || ''
        rows.push({ id: item.id, name: field('name') || item.id, description: field('description').slice(0, 400), source: 'package:' + item.packageId, sourceRevision: null, relativePath: item.id + '/SKILL.md', platforms: null, license: 'package', digest: sha256(body), enabled: true, mode: 'instructions', dependenciesReady: false, external: true })
      }
      return rows
    }),
    readSkill: (id, offset = 0, limit = 8000) => serial(async () => {
      const item = (await skills()).find(row => row.id === id)
      if (!item) throw error('NOT_FOUND')
      const body = await fs.readFile(path.join(item.directory, 'SKILL.md'), 'utf8')
      const start = Math.max(0, Number(offset) || 0), text = body.slice(start, start + Math.min(20000, Number(limit) || 8000))
      return { id, offset: start, text, hasMore: start + text.length < body.length }
    }),
    planFromBytes: (bytes, source, expectedSha256) => serial(() => prepare(bytes, source, expectedSha256)),
    planFromFile: filePath => serial(async () => {
      const stat = await fs.lstat(filePath)
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_ARCHIVE) throw error('PACKAGE_ARCHIVE_INVALID')
      return prepare(await fs.readFile(filePath), 'file:' + path.basename(filePath))
    }),
    // A marketplace package: the registry's digest is required, so what was listed is what is planned.
    planFromUrl: (url, expectedSha256, packageFormat) => serial(async () => {
      if (!/^[a-f0-9]{64}$/.test(expectedSha256 || '')) throw error('PACKAGE_DIGEST_REQUIRED')
      const parsed = new URL(url)
      if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw error('PACKAGE_SOURCE_INVALID')
      const response = await fetchImpl(parsed, { redirect: 'follow', signal: AbortSignal.timeout(120000) })
      if (!response.ok) throw error('PACKAGE_DOWNLOAD_FAILED')
      const bytes = new Uint8Array(await response.arrayBuffer())
      if (sha256(bytes) !== expectedSha256) throw error('PACKAGE_DIGEST_MISMATCH')
      const payload = packageFormat === 'compatible-plugin' ? require('./local-package-importer.cjs').convertCompatibleArchive(bytes, parsed.href) : bytes
      return prepare(payload, parsed.href)
    }),
    install: planId => serial(() => install(planId)),
    setEnabled: (id, enabled) => serial(async () => {
      const state = await load(), row = state.packages[id]
      if (!row) throw error('PACKAGE_NOT_INSTALLED')
      await beforeChange(id, enabled ? 'enable' : 'disable')
      row.enabled = !!enabled; await save(state); onChange(); return shape(row)
    }),
    // Back to the version kept by the last update; the newer copy stays on disk until the next install of it.
    rollback: id => serial(async () => {
      const state = await load(), row = state.packages[id]
      if (!row?.previous) throw error('PACKAGE_NO_PREVIOUS')
      const manifest = JSON.parse(await fs.readFile(path.join(folder(id, row.previous), MANIFEST), 'utf8'))
      state.packages[id] = { ...row, version: row.previous, previous: row.version, manifest }
      await save(state); onChange(); return shape(state.packages[id])
    }),
    remove: id => serial(async () => {
      const state = await load()
      if (!state.packages[id]) return false
      await beforeChange(id, 'remove')
      delete state.packages[id]; await save(state)
      await fs.rm(path.join(root, id), { recursive: true, force: true }).catch(() => {})
      onChange(); return true
    })
  }
}

module.exports = { createWorkstationPackages, payloadDigest, MANIFEST }
