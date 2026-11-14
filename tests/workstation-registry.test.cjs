// Workstation registry client: every category is read until nextCursor is null, entries are deduplicated by package ID + version
// with category membership kept, an offline snapshot is cached, and package manifests are validated before any install plan.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { createRegistryClient, validateManifest, capabilityState } = require('../electron/workstation-registry.cjs')

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'najd-ws-registry-'))
const item = (id, version = '1.0.0') => ({ id, version, displayName: id, publisher: { name: 'NAJD' }, kind: 'skill' })
// pages: { category: [[items...], [items...]] } served by cursor "p<n>".
const source = pages => async ({ category, cursor }) => {
  const list = pages[category] || [], index = cursor ? Number(cursor.slice(1)) : 0
  return { items: list[index] || [], nextCursor: index + 1 < list.length ? 'p' + (index + 1) : null }
}

test('sync follows every cursor page of every category and keeps category membership', async () => {
  const client = createRegistryClient({ directory: tmp(), fetchPage: source({
    featured: [[item('aa'), item('bb')], [item('cc')], [item('dd')]],
    finance: [[item('bb'), item('ee')]]
  }), categories: ['featured', 'finance'] })
  const result = await client.sync()
  assert.equal(result.state, 'online')
  assert.deepEqual(result.entries.map(entry => entry.id).sort(), ['aa', 'bb', 'cc', 'dd', 'ee'])
  assert.deepEqual(result.entries.find(entry => entry.id === 'bb').categories.sort(), ['featured', 'finance'])
  assert.equal(result.pagesRead, 4)
})

test('the same package ID with a different version is a separate entry; identical ones are deduplicated', async () => {
  const client = createRegistryClient({ directory: tmp(), categories: ['featured'], fetchPage: source({ featured: [[item('aa', '1.0.0'), item('aa', '1.0.0'), item('aa', '1.1.0')]] }) })
  assert.equal((await client.sync()).entries.length, 2)
})

test('a repeating cursor or an endless registry stops with a bounded error instead of looping', async () => {
  const loop = createRegistryClient({ directory: tmp(), categories: ['featured'], fetchPage: async () => ({ items: [item('aa')], nextCursor: 'same' }) })
  await assert.rejects(loop.sync(), { code: 'REGISTRY_CURSOR_LOOP' })
  let n = 0
  const endless = createRegistryClient({ directory: tmp(), categories: ['featured'], maxPages: 5, fetchPage: async () => ({ items: [item('xx' + n++)], nextCursor: 'c' + n }) })
  await assert.rejects(endless.sync(), { code: 'REGISTRY_TOO_MANY_PAGES' })
})

test('when the registry is unreachable the cached snapshot is served and marked offline', async () => {
  const directory = tmp()
  await createRegistryClient({ directory, categories: ['featured'], fetchPage: source({ featured: [[item('aa')]] }) }).sync()
  const offline = createRegistryClient({ directory, categories: ['featured'], fetchPage: async () => { throw new Error('network') } })
  const result = await offline.sync()
  assert.equal(result.state, 'offline')
  assert.deepEqual(result.entries.map(entry => entry.id), ['aa'])
})

test('a partially failed sync never replaces the previous good snapshot', async () => {
  const directory = tmp()
  await createRegistryClient({ directory, categories: ['featured'], fetchPage: source({ featured: [[item('aa')]] }) }).sync()
  let call = 0
  const flaky = createRegistryClient({ directory, categories: ['featured'], fetchPage: async () => { if (call++ === 0) return { items: [item('zz')], nextCursor: 'p1' }; throw new Error('drop') } })
  assert.equal((await flaky.sync()).state, 'offline')
  assert.deepEqual((await flaky.snapshot()).entries.map(entry => entry.id), ['aa'])
})

test('malformed remote entries are dropped and remote metadata cannot grant permissions', async () => {
  const client = createRegistryClient({ directory: tmp(), categories: ['featured'], fetchPage: source({ featured: [[item('good'), { id: '../bad', version: '1.0.0' }, { id: 'noversion' }, { ...item('sneaky'), permissions: ['all'], granted: true }]] }) })
  const result = await client.sync()
  assert.deepEqual(result.entries.map(entry => entry.id).sort(), ['good', 'sneaky'])
  assert.equal(result.entries.find(entry => entry.id === 'sneaky').permissions, undefined)
  assert.equal(result.entries.find(entry => entry.id === 'sneaky').granted, undefined)
})

const manifest = () => ({ schemaVersion: 1, id: 'najd-pdf', displayName: 'PDF', version: '1.0.0', publisher: { name: 'NAJD' }, description: 'PDF tools',
  categories: ['productivity'], permissions: [], dependencies: [], compatibility: { os: ['win32'], arch: ['x64'], minNajd: '0.10.0' },
  integrity: { sha256: 'a'.repeat(64) }, license: { spdx: 'MIT' } })

test('manifest validation accepts a complete manifest and rejects unsafe or incomplete ones', () => {
  assert.equal(validateManifest(manifest()).ok, true)
  for (const mutate of [m => { m.id = '../x' }, m => { m.schemaVersion = 2 }, m => { m.integrity.sha256 = 'zz' }, m => { delete m.compatibility }, m => { m.version = 'latest' }, m => { m.permissions = 'all' }]) {
    const bad = manifest(); mutate(bad)
    assert.equal(validateManifest(bad).ok, false)
  }
})

test('capability state separates catalog visibility, installation and readiness', () => {
  assert.equal(capabilityState({ installed: false }), 'NOT_INSTALLED')
  assert.equal(capabilityState({ installed: true, enabled: true, ready: true }), 'AVAILABLE')
  assert.equal(capabilityState({ installed: true, enabled: true, ready: false }), 'NOT_READY')
  assert.equal(capabilityState({ installed: true, enabled: false, ready: true }), 'DISABLED')
  assert.equal(capabilityState({ installed: true, enabled: true, ready: true, updateAvailable: true }), 'UPDATE_AVAILABLE')
  assert.equal(capabilityState({ installed: true, quarantined: true }), 'QUARANTINED')
  assert.equal(capabilityState({ installing: true }), 'INSTALLING')
  assert.equal(capabilityState({ installed: true, error: true }), 'ERROR')
})
