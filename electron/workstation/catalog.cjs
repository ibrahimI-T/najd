// Workstation catalog: packaged seed + every configured remote registry, with installation and readiness kept separate from visibility.
// Remote sources are owner-added; there is no default endpoint. Their metadata describes a package and never grants a permission.
const fs = require('node:fs/promises')
const path = require('node:path')
const { createHash, randomUUID } = require('node:crypto')
const { replaceFile } = require('../atomic-file.cjs')
const { createRegistryClient, capabilityState } = require('../workstation-registry.cjs')
const seed = require('./seed.cjs')
const { OFFICIAL_MARKET_URL } = require('./official-market.cjs')

const error = code => Object.assign(new Error(code), { code })
const CATEGORIES = ['featured', 'productivity', 'finance', 'academic', 'marketing', 'engineering', 'creative', 'creativity-design', '3d', 'developer-tools', 'research', 'legal', 'personal']
const MAX_SOURCES = 16, MAX_PAGE_BYTES = 2 * 1024 * 1024, PAGE_TIMEOUT = 15000

function compareVersions(a, b) {
  const parts = value => String(value).split(/[-+]/)[0].split('.').map(Number)
  const left = parts(a), right = parts(b)
  for (let i = 0; i < 3; i++) if ((left[i] || 0) !== (right[i] || 0)) return (left[i] || 0) < (right[i] || 0) ? -1 : 1
  return 0
}

// HTTPS, or plain HTTP on this computer only (a local registry). Addresses with credentials are refused.
function normalizeSource(value) {
  let url
  try { url = new URL(String(value).trim()) } catch { throw error('REGISTRY_SOURCE_INVALID') }
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) || url.username || url.password || url.hash) throw error('REGISTRY_SOURCE_INVALID')
  url.search = ''
  return url.href.replace(/\/+$/, '')
}

// One page of a remote registry: GET <source>/catalog?category=&cursor=, bounded in time and size, no redirects.
function httpPage(source, fetchImpl) {
  return async ({ category, cursor }) => {
    const url = new URL(source + '/catalog')
    url.searchParams.set('category', category)
    if (cursor) url.searchParams.set('cursor', cursor)
    const response = await fetchImpl(url, { redirect: 'error', signal: AbortSignal.timeout(PAGE_TIMEOUT), headers: { accept: 'application/json' } })
    if (!response.ok) throw error('REGISTRY_HTTP_' + response.status)
    const text = await response.text()
    if (text.length > MAX_PAGE_BYTES) throw error('REGISTRY_PAGE_TOO_LARGE')
    return JSON.parse(text)
  }
}

function createWorkstationCatalog({ directory, probes = async () => ({}), packages = null, localPackages = null, fetchImpl = globalThis.fetch, entries = seed.entries, officialMarket = null }) {
  if (!path.isAbsolute(directory || '')) throw error('INVALID_INPUT')
  const filename = path.join(directory, 'catalog-state.json')
  let queue = Promise.resolve(), remote = [], lastSync = null
  const serial = work => { const result = queue.then(work); queue = result.catch(() => {}); return result }

  async function load() {
    let raw
    try { raw = await fs.readFile(filename, 'utf8') } catch (reason) { if (reason.code === 'ENOENT') return { version: 1, sources: [], disabled: [] }; throw reason }
    try {
      const value = JSON.parse(raw)
      if (value?.version === 1 && Array.isArray(value.sources) && Array.isArray(value.disabled)) return value
    } catch {}
    await fs.rename(filename, filename + '.corrupt-' + Date.now()).catch(() => {}) // kept for inspection, never overwritten
    return { version: 1, sources: [], disabled: [] }
  }
  async function save(state) {
    await fs.mkdir(directory, { recursive: true })
    const temporary = filename + '.' + randomUUID() + '.tmp'
    await fs.writeFile(temporary, JSON.stringify(state) + '\n', { flag: 'wx' })
    await replaceFile(temporary, filename)
  }
  const client = source => createRegistryClient({ directory: path.join(directory, 'registry', createHash('sha256').update(source).digest('hex').slice(0, 24)), categories: CATEGORIES, fetchPage: httpPage(source, fetchImpl) })

  async function view() {
    const [stored, health, installedList, localList] = await Promise.all([load(), probes().catch(() => ({})), packages ? packages.list() : [], localPackages ? localPackages.discover().catch(() => []) : []])
    if (!lastSync) { // first read after start: the offline snapshots of the sources, without touching the network
      const official = officialMarket ? (await officialMarket.snapshot()).entries.map(entry => ({ ...entry, source: OFFICIAL_MARKET_URL })) : []
      const custom = (await Promise.all(stored.sources.map(source => client(source).snapshot().then(value => value.entries.map(entry => ({ ...entry, source })))))).flat()
      remote = [...official, ...custom]
    }
    const installed = new Map(installedList.map(item => [item.id, item]))
    const local = new Map(localList.map(item => [item.id, item]))
    const remoteIds = new Set(remote.map(entry => entry.id))
    const latest = new Map()
    for (const entry of remote) if (!latest.has(entry.id) || compareVersions(latest.get(entry.id), entry.version) < 0) latest.set(entry.id, entry.version)
    for (const entry of localList) if (!latest.has(entry.id) || compareVersions(latest.get(entry.id), entry.version) < 0) latest.set(entry.id, entry.version)
    const disabled = new Set(stored.disabled)
    const shape = entry => {
      const live = entry.probe ? health[entry.probe] : null
      const pack = installed.get(entry.id)
      const localPackage = local.get(entry.id)
      const missing = (entry.needs || []).filter(key => health[key]?.ready !== true)
      // Engine-layer skills and plugins ship with the NAJD engine: present while the engine is healthy (before 0.10.33 they were never "installed").
      const engineLayer = entry.layer === 'gateway' && health.gateway?.ready === true
      const isInstalled = !!pack || (live ? live.installed === true : entry.layer === 'builtin' || engineLayer)
      const procedure = entry.layer !== 'builtin' || !Array.isArray(health.procedures) || health.procedures.includes(entry.id)
      const ready = live ? live.ready === true : missing.length === 0 && procedure && (entry.layer === 'builtin' || engineLayer ? true : !!pack && pack.ready !== false)
      const updateAvailable = !!pack && latest.has(entry.id) && compareVersions(pack.version, latest.get(entry.id)) < 0
      const state = capabilityState({ installed: isInstalled, enabled: pack ? pack.enabled : !disabled.has(entry.id), ready, updateAvailable, quarantined: pack?.quarantined, error: pack?.error })
      const categories = isInstalled ? [...new Set(['installed', ...entry.categories])] : entry.categories.filter(category => category !== 'installed')
      const reason = state === 'NOT_READY' ? (live?.reason || (missing.length ? 'NEEDS:' + missing.join(',') : 'NOT_READY')) : null
      const hasInstallSource = !!entry.packageUrl || !!localPackage
      return { ...entry, categories, version: pack?.version || entry.version, latestVersion: latest.get(entry.id) || null, state, reason,
        packageInstalled: !!pack, manageable: !!pack, canRollback: !!pack?.previousVersion, localImportable: !!localPackage, mcpServers: pack?.mcpServers || [],
        installable: !entry.metadataOnly && entry.layer !== 'builtin' && hasInstallSource }
    }
    const latestRemote = new Map()
    for (const entry of remote) if (!latestRemote.has(entry.id) || compareVersions(latestRemote.get(entry.id).version, entry.version) < 0) latestRemote.set(entry.id, entry)
    const merged = entries.filter(entry => !(entry.metadataOnly && remoteIds.has(entry.id))).map(entry => {
      const market = latestRemote.get(entry.id)
      if (!market) return entry
      latestRemote.delete(entry.id)
      // Local readiness and permission declarations remain authoritative; market metadata supplies only version and package provenance.
      return { ...entry, ...market, layer: entry.layer, permissions: entry.permissions, needs: entry.needs, ...(entry.probe ? { probe: entry.probe } : {}) }
    })
    merged.push(...[...latestRemote.values()].map(entry => ({ ...entry, layer: 'marketplace', permissions: [], needs: [] })))
    const known = new Set(merged.map(entry => entry.id))
    // Compatible packages already present on this computer remain individually reinstallable after removal.
    for (const item of localList) if (!known.has(item.id)) {
      merged.push({ id: item.id, version: item.version, kind: 'skill', layer: 'marketplace', displayName: item.displayName, description: item.description,
        publisher: item.publisher, categories: item.categories?.length ? item.categories : ['personal'], permissions: [], needs: [], localImportable: true })
      known.add(item.id)
    }
    // A package installed from a local file has no catalog row of its own: it appears under Personal.
    for (const pack of installed.values()) if (!known.has(pack.id)) merged.push({ id: pack.id, version: pack.version, kind: pack.kind, layer: 'marketplace', displayName: pack.displayName, description: pack.description, publisher: pack.publisher, categories: ['personal'], permissions: pack.permissions, needs: [] })
    return { state: lastSync?.state || (stored.sources.length || officialMarket ? 'offline' : 'no-source'), syncedAt: lastSync?.at || null, pagesRead: lastSync?.pagesRead || 0, failed: lastSync?.failed || [],
      sources: [...(officialMarket ? [OFFICIAL_MARKET_URL] : []), ...stored.sources], removableSources: stored.sources, entries: merged.map(shape) }
  }

  return {
    list: () => serial(view),
    // Every source is read to the end; a source that fails keeps its previous complete snapshot and is named in `failed`.
    sync: () => serial(async () => {
      const stored = await load()
      const results = await Promise.all([
        ...(officialMarket ? [officialMarket.sync().then(result => ({ ...result, source: OFFICIAL_MARKET_URL })).catch(reason => ({ state: 'offline', entries: [], pagesRead: 0, source: OFFICIAL_MARKET_URL, code: reason.code || 'MARKET_FAILED' }))] : []),
        ...stored.sources.map(source => client(source).sync().then(result => ({ ...result, source })).catch(reason => ({ state: 'offline', entries: [], pagesRead: 0, source, code: reason.code || 'REGISTRY_FAILED' })))
      ])
      remote = results.flatMap(result => result.entries.map(entry => ({ ...entry, source: result.source })))
      lastSync = { at: new Date().toISOString(), state: !results.length ? 'no-source' : results.every(result => result.state === 'online') ? 'online' : 'offline', pagesRead: results.reduce((sum, result) => sum + result.pagesRead, 0), failed: results.filter(result => result.state !== 'online').map(result => result.source) }
      return view()
    }),
    addSource: url => serial(async () => {
      const source = normalizeSource(url), stored = await load()
      if (!stored.sources.includes(source)) { if (stored.sources.length >= MAX_SOURCES) throw error('REGISTRY_TOO_MANY_SOURCES'); stored.sources.push(source); await save(stored) }
      return stored.sources
    }),
    removeSource: url => serial(async () => {
      const stored = await load(); stored.sources = stored.sources.filter(source => source !== url); await save(stored)
      remote = remote.filter(entry => entry.source !== url)
      return stored.sources
    }),
    // Built-in entries are enabled and disabled here; installed packages keep their own switch.
    setEnabled: (id, enabled) => serial(async () => {
      if (!entries.some(entry => entry.id === id && entry.layer === 'builtin')) throw error('NOT_BUILTIN')
      const stored = await load(); stored.disabled = stored.disabled.filter(item => item !== id)
      if (!enabled) stored.disabled.push(id)
      await save(stored); return view()
    })
  }
}

module.exports = { createWorkstationCatalog, normalizeSource, compareVersions, CATEGORIES }
