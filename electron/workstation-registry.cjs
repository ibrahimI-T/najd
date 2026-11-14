// Workstation marketplace client. The remote registry is authoritative, dynamic and untrusted: every category is read page by
// page until nextCursor is null, entries are deduplicated by immutable package ID + version with category membership kept, and the
// last complete result is cached as an offline snapshot. Remote metadata only describes a package; it never grants a permission.
const fs = require('node:fs/promises')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { replaceFile } = require('./atomic-file.cjs')

const error = code => Object.assign(new Error(code), { code })
const ID = /^[a-z][a-z0-9-]{1,63}$/, VERSION = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/, SHA256 = /^[a-f0-9]{64}$/
const CATEGORY = /^[a-z0-9][a-z0-9-]{0,40}$/
const MAX_PAGES = 5000, MAX_ENTRIES = 20000, MAX_SNAPSHOT = 16 * 1024 * 1024
const HARD = new Set(['REGISTRY_CURSOR_LOOP', 'REGISTRY_TOO_MANY_PAGES', 'REGISTRY_TOO_MANY_ENTRIES'])
const text = (value, limit) => typeof value === 'string' ? value.slice(0, limit) : undefined

// Keeps only descriptive, bounded fields. Permissions, grants and unknown fields from the remote side are discarded.
function clean(raw, category) {
  if (!raw || typeof raw !== 'object' || !ID.test(raw.id || '') || !VERSION.test(raw.version || '')) return null
  return {
    id: raw.id, version: raw.version, kind: raw.kind === 'plugin' ? 'plugin' : 'skill',
    displayName: text(raw.displayName, 120) || raw.id, description: text(raw.description, 500),
    publisher: { name: text(raw.publisher?.name, 80) || 'Unknown' },
    downloads: Number.isSafeInteger(raw.downloads) && raw.downloads >= 0 ? raw.downloads : undefined,
    ...(typeof raw.packageUrl === 'string' && raw.packageUrl.startsWith('https://') && raw.packageUrl.length <= 500 && SHA256.test(raw.sha256 || '') ? { packageUrl: raw.packageUrl, sha256: raw.sha256 } : {}),
    categories: [category]
  }
}

function createRegistryClient({ directory, fetchPage, categories, maxPages = MAX_PAGES }) {
  if (!path.isAbsolute(directory || '') || typeof fetchPage !== 'function' || !Array.isArray(categories) || categories.some(c => !CATEGORY.test(c))) throw error('INVALID_INPUT')
  const filename = path.join(directory, 'registry-snapshot.json')
  let queue = Promise.resolve()
  const serial = work => { const result = queue.then(work); queue = result.catch(() => {}); return result }

  async function readSnapshot() {
    try {
      const stat = await fs.lstat(filename)
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_SNAPSHOT) return null
      const value = JSON.parse(await fs.readFile(filename, 'utf8'))
      return value?.version === 1 && Array.isArray(value.entries) ? value : null
    } catch { return null }
  }
  async function writeSnapshot(entries) {
    await fs.mkdir(directory, { recursive: true })
    const temporary = filename + '.' + randomUUID() + '.tmp'
    await fs.writeFile(temporary, JSON.stringify({ version: 1, syncedAt: new Date().toISOString(), entries }) + '\n', { flag: 'wx' })
    await replaceFile(temporary, filename)
  }

  async function readAll() {
    const byKey = new Map(); let pagesRead = 0
    for (const category of categories) {
      const seen = new Set(); let cursor = null
      do {
        if (pagesRead >= maxPages) throw error('REGISTRY_TOO_MANY_PAGES')
        const page = await fetchPage({ category, cursor }); pagesRead++
        if (!page || !Array.isArray(page.items)) throw error('REGISTRY_BAD_PAGE')
        for (const raw of page.items) {
          const entry = clean(raw, category); if (!entry) continue
          const key = entry.id + '@' + entry.version, known = byKey.get(key)
          if (known) { if (!known.categories.includes(category)) known.categories.push(category) } else byKey.set(key, entry)
          if (byKey.size > MAX_ENTRIES) throw error('REGISTRY_TOO_MANY_ENTRIES')
        }
        cursor = page.nextCursor ?? null
        if (cursor !== null) {
          if (typeof cursor !== 'string' || !cursor || cursor.length > 512 || seen.has(cursor)) throw error('REGISTRY_CURSOR_LOOP')
          seen.add(cursor)
        }
      } while (cursor !== null)
    }
    return { entries: [...byKey.values()], pagesRead }
  }

  return {
    snapshot: () => readSnapshot().then(value => value || { version: 1, entries: [] }),
    // A failed or partial sync never replaces the previous complete snapshot; the caller sees state "offline" with that snapshot.
    sync: () => serial(async () => {
      try {
        const { entries, pagesRead } = await readAll()
        await writeSnapshot(entries)
        return { state: 'online', entries, pagesRead }
      } catch (reason) {
        if (HARD.has(reason.code)) throw reason
        const cached = await readSnapshot()
        return { state: 'offline', entries: cached?.entries || [], pagesRead: 0 }
      }
    })
  }
}

// Manifest contract (spec 4.6). Validation only; nothing here executes or installs.
function validateManifest(m) {
  const problems = []
  const arr = (v, name) => { if (!Array.isArray(v)) problems.push(name) }
  if (!m || typeof m !== 'object') return { ok: false, problems: ['manifest'] }
  if (m.schemaVersion !== 1) problems.push('schemaVersion')
  if (!ID.test(m.id || '')) problems.push('id')
  if (!VERSION.test(m.version || '')) problems.push('version')
  if (typeof m.displayName !== 'string' || !m.displayName || m.displayName.length > 120) problems.push('displayName')
  if (typeof m.publisher?.name !== 'string' || !m.publisher.name) problems.push('publisher')
  if (typeof m.description !== 'string') problems.push('description')
  arr(m.categories, 'categories'); arr(m.permissions, 'permissions'); arr(m.dependencies, 'dependencies')
  if (!m.compatibility || !Array.isArray(m.compatibility.os) || !Array.isArray(m.compatibility.arch) || !VERSION.test(m.compatibility.minNajd || '')) problems.push('compatibility')
  if (!SHA256.test(m.integrity?.sha256 || '')) problems.push('integrity')
  if (!m.license || typeof m.license !== 'object') problems.push('license')
  return { ok: problems.length === 0, problems }
}

// Catalog visibility, installation and readiness are separate; this derives the one state shown on a card.
function capabilityState({ installing, installed, enabled, ready, updateAvailable, quarantined, error: failed }) {
  if (installing) return 'INSTALLING'
  if (!installed) return 'NOT_INSTALLED'
  if (quarantined) return 'QUARANTINED'
  if (failed) return 'ERROR'
  if (enabled === false) return 'DISABLED'
  if (ready === false) return 'NOT_READY'
  return updateAvailable ? 'UPDATE_AVAILABLE' : 'AVAILABLE'
}

module.exports = { createRegistryClient, validateManifest, capabilityState }
