// Read-only adapter for the public compatible-plugin catalog. Package bytes still pass through NAJD's digest,
// archive, executable and manifest checks before installation; catalog metadata never grants a permission.
const fs = require('node:fs/promises')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { replaceFile } = require('../atomic-file.cjs')
const { najdId, rebrand } = require('./compat-names.cjs')

const OFFICIAL_MARKET_URL = 'https://api.kimi.com/coding/v1/plugins/marketplace'
const SHA256 = /^[a-f0-9]{64}$/i, VERSION = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/
const MAX_BYTES = 4 * 1024 * 1024, TIMEOUT = 20000
const error = code => Object.assign(new Error(code), { code })
const text = (value, limit) => typeof value === 'string' ? value.slice(0, limit) : ''
const platformName = value => value === 'win32' ? 'windows' : value === 'darwin' ? 'macos' : value === 'linux' ? 'linux' : value

function clean(raw, platform) {
  if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string' || !VERSION.test(raw.version || '') || !SHA256.test(raw.sha256sum || '')) return null
  let url
  try { url = new URL(raw.source) } catch { return null }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) return null
  const supported = !Array.isArray(raw.platforms) || raw.platforms.length === 0 || raw.platforms.includes(platformName(platform)) || raw.platforms.includes('cloud')
  const desktop = !Array.isArray(raw.clients) || raw.clients.length === 0 || raw.clients.includes('desktop')
  if (!supported || !desktop) return null
  const official = raw.distribution?.category === 'official'
  const description = rebrand(text(raw.shortDescription || raw.description || raw.longDescription, 500))
  return {
    id: najdId(raw.id), sourceId: raw.id, version: raw.version, kind: 'plugin', layer: 'marketplace',
    displayName: rebrand(text(raw.displayName, 120) || raw.id), description,
    publisher: { name: official ? 'NAJD Official Compatible' : text(raw.distribution?.publisher, 80) || 'Compatible Marketplace' },
    categories: [official ? 'featured' : 'developer-tools'], permissions: [], needs: [],
    packageUrl: url.href, sha256: raw.sha256sum.toLowerCase(), packageFormat: 'compatible-plugin',
    source: OFFICIAL_MARKET_URL, ...(Number.isSafeInteger(raw.downloads) ? { downloads: raw.downloads } : {})
  }
}

function createOfficialCompatibleMarket({ directory, fetchImpl = globalThis.fetch, platform = process.platform }) {
  if (!path.isAbsolute(directory || '') || typeof fetchImpl !== 'function') throw error('INVALID_INPUT')
  const filename = path.join(directory, 'official-market.json')
  async function snapshot() {
    try {
      const value = JSON.parse(await fs.readFile(filename, 'utf8'))
      return value?.version === 1 && Array.isArray(value.entries) ? value : { version: 1, entries: [] }
    } catch { return { version: 1, entries: [] } }
  }
  async function sync() {
    try {
      const response = await fetchImpl(OFFICIAL_MARKET_URL, { redirect: 'error', signal: AbortSignal.timeout(TIMEOUT), headers: { accept: 'application/json' } })
      if (!response.ok) throw error('MARKET_HTTP_' + response.status)
      const body = await response.text()
      if (body.length > MAX_BYTES) throw error('MARKET_TOO_LARGE')
      const parsed = JSON.parse(body)
      if (!Array.isArray(parsed.plugins)) throw error('MARKET_BAD_RESPONSE')
      const entries = [...new Map(parsed.plugins.map(item => clean(item, platform)).filter(Boolean).map(item => [item.id + '@' + item.version, item])).values()]
      await fs.mkdir(directory, { recursive: true })
      const temporary = filename + '.' + randomUUID() + '.tmp'
      const saved = { version: 1, syncedAt: new Date().toISOString(), entries }
      await fs.writeFile(temporary, JSON.stringify(saved) + '\n', { flag: 'wx' })
      await replaceFile(temporary, filename)
      return { state: 'online', entries, pagesRead: 1, syncedAt: saved.syncedAt }
    } catch (reason) {
      const cached = await snapshot()
      return { state: 'offline', entries: cached.entries, pagesRead: 0, syncedAt: cached.syncedAt || null, code: reason.code || 'MARKET_FAILED' }
    }
  }
  return { snapshot, sync }
}

module.exports = { createOfficialCompatibleMarket, OFFICIAL_MARKET_URL }
