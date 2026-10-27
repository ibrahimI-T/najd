const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), fsp = require('node:fs/promises'), path = require('node:path'), os = require('node:os')
const { writeZip } = require('../scripts/zip-writer.cjs')
const { createBundleRuntime } = require('../electron/bundle-runtime.cjs')

async function fixture(t, files = { alpha: { 'a.exe': 'A', 'lib/x.txt': 'X' }, beta: { 'b.dll': 'B' } }) {
  const base = await fsp.mkdtemp(path.join(os.tmpdir(), 'najd-bundle-'))
  t.after(() => fsp.rm(base, { recursive: true, force: true }))
  const source = path.join(base, 'resources'); await fsp.mkdir(source)
  const components = []
  for (const [id, entries] of Object.entries(files)) {
    const result = await writeZip(path.join(source, id + '.zip'), Object.entries(entries).map(([relative, text]) => ({ relative, bytes: Buffer.from(text) })))
    components.push({ id, file: id + '.zip', entry: Object.keys(entries)[0], ...result })
  }
  await fsp.writeFile(path.join(source, 'bundle.json'), JSON.stringify({ format: 'najd-runtime-bundle-v2', components }))
  return { base, source, target: path.join(base, 'runtime'), components }
}

test('first run unpacks each component with progress; later starts reuse it without unpacking', async t => {
  const { source, target } = await fixture(t)
  const runtime = createBundleRuntime({ source, target })
  assert.equal(runtime.isReady(), false); assert.equal(runtime.readyDirectory('alpha'), null)
  await runtime.prepare()
  const status = runtime.status()
  assert.equal(status.state, 'ready'); assert.equal(status.done, status.total)
  assert.equal(fs.readFileSync(path.join(runtime.readyDirectory('alpha'), 'lib/x.txt'), 'utf8'), 'X')
  const again = createBundleRuntime({ source, target })
  assert.equal(again.isReady(), true, 'unchanged archives are not unpacked again')
})

test('a changed component unpacks only that component and keeps its old version until the new generation is confirmed healthy', async t => {
  const first = await fixture(t)
  await createBundleRuntime({ source: first.source, target: first.target }).prepare()
  const oldAlpha = createBundleRuntime({ source: first.source, target: first.target }).directory('alpha')
  const second = await fixture(t, { alpha: { 'a.exe': 'A2' }, beta: { 'b.dll': 'B' } })
  const runtime = createBundleRuntime({ source: second.source, target: first.target })
  assert.equal(runtime.readyDirectory('beta') !== null, true, 'unchanged beta reused')
  await runtime.prepare()
  assert.equal(fs.readFileSync(path.join(runtime.readyDirectory('alpha'), 'a.exe'), 'utf8'), 'A2')
  assert.equal(fs.existsSync(oldAlpha), true, 'the previous version is not removed by preparation')
  await runtime.collect()
  assert.equal(fs.existsSync(oldAlpha), true, 'nothing is removed while no generation is recorded as confirmed')
})

test('a damaged archive fails without leaving a usable or partial component; unknown folders are never taken over', async t => {
  const { source, target, components } = await fixture(t)
  const archive = path.join(source, 'alpha.zip'), bytes = fs.readFileSync(archive)
  bytes[bytes.length - 30] ^= 0xff
  fs.writeFileSync(archive, bytes)
  const runtime = createBundleRuntime({ source, target })
  await assert.rejects(runtime.prepare(), { code: 'RUNTIME_ARCHIVE_INVALID' })
  assert.equal(runtime.status().state, 'failed'); assert.equal(runtime.readyDirectory('alpha'), null)
  assert.deepEqual(fs.readdirSync(target).filter(name => name.startsWith('.stage-')), [])
  const foreign = path.join(path.dirname(target), 'foreign'); fs.mkdirSync(foreign); fs.writeFileSync(path.join(foreign, 'keep.txt'), 'x')
  await assert.rejects(createBundleRuntime({ source, target: foreign }).prepare(), { code: 'SETUP_STORE_UNAVAILABLE' })
  assert.equal(fs.readFileSync(path.join(foreign, 'keep.txt'), 'utf8'), 'x')
  assert.ok(components.length)
})

// A two-version helper: version 1.0.0 is installed and confirmed healthy; version 1.1.0 is then prepared.
async function upgraded(t) {
  const first = await fixture(t)
  const v1 = createBundleRuntime({ source: first.source, target: first.target })
  await v1.prepare(); v1.markPrepared('1.0.0'); await v1.confirmHealthy('1.0.0')
  const second = await fixture(t, { alpha: { 'a.exe': 'A2' }, beta: { 'b.dll': 'B' } })
  const v2 = createBundleRuntime({ source: second.source, target: first.target })
  return { first, second, v1, v2, oldAlpha: v1.directory('alpha') }
}
const next = async (t, target, text) => {
  const bundle = await fixture(t, { alpha: { 'a.exe': text }, beta: { 'b.dll': 'B' } })
  return createBundleRuntime({ source: bundle.source, target })
}

test('update transaction: the last working generation survives until the new one is confirmed healthy', async t => {
  const { v2, oldAlpha } = await upgraded(t)
  await v2.prepare(); v2.markPrepared('1.1.0')
  assert.equal(fs.existsSync(oldAlpha), true, 'v1 components still present while v2 is unconfirmed')
  const plan = v2.rollbackPlan()
  assert.equal(plan.version, '1.0.0'); assert.equal(plan.available, true)
  assert.deepEqual((await v2.collect()).removed, [], 'collect keeps both generations')
  const result = await v2.confirmHealthy('1.1.0')
  assert.deepEqual(result.removed, [], 'nothing older than the previous generation exists yet')
  assert.equal(v2.rollbackPlan().version, '1.0.0', 'after a successful update the old generation stays as the previous one')
  assert.equal(fs.existsSync(oldAlpha), true)
})

test('v1 healthy, v2 never healthy, v3 healthy: v1 is not lost, v2 is removed', async t => {
  const { v2, oldAlpha, first } = await upgraded(t)
  await v2.prepare(); v2.markPrepared('1.1.0')
  const v2Alpha = v2.directory('alpha')
  const v3 = await next(t, first.target, 'A3')
  await v3.prepare(); v3.markPrepared('1.2.0')
  await assert.rejects(v2.confirmHealthy('1.1.0'), { code: 'GENERATION_NOT_CURRENT' })
  const result = await v3.confirmHealthy('1.2.0')
  assert.equal(fs.existsSync(oldAlpha), true, 'v1 was the last working generation and is kept as previous')
  assert.equal(fs.existsSync(v2Alpha), false, 'the never-healthy v2 is removed')
  assert.ok(result.removed.length >= 1)
  assert.equal(v3.rollbackPlan().version, '1.0.0'); assert.equal(v3.rollbackPlan().available, true)
  assert.equal(fs.existsSync(v3.readyDirectory('alpha')), true)
  // v4 healthy: v1 finally goes, v3 becomes the previous generation.
  const v4 = await next(t, first.target, 'A4')
  await v4.prepare(); v4.markPrepared('1.3.0'); await v4.confirmHealthy('1.3.0')
  assert.equal(fs.existsSync(oldAlpha), false); assert.equal(v4.rollbackPlan().version, '1.2.0')
})

test('a failed or interrupted preparation of the new version leaves the previous generation intact and usable', async t => {
  const { second, first, oldAlpha } = await upgraded(t)
  const archive = path.join(second.source, 'alpha.zip'), bytes = fs.readFileSync(archive)
  bytes[bytes.length - 30] ^= 0xff; fs.writeFileSync(archive, bytes)
  const v2 = createBundleRuntime({ source: second.source, target: first.target })
  await assert.rejects(v2.prepare(), { code: 'RUNTIME_ARCHIVE_INVALID' })
  assert.equal(fs.existsSync(oldAlpha), true)
  assert.equal(fs.readFileSync(path.join(oldAlpha, 'a.exe'), 'utf8'), 'A')
  assert.deepEqual(fs.readdirSync(first.target).filter(name => name.startsWith('.stage-')), [])
  assert.throws(() => v2.markPrepared('1.1.0'), { code: 'RUNTIME_NOT_READY' })
  assert.equal(createBundleRuntime({ source: first.source, target: first.target }).isReady(), true, 'the old bundle is still ready')
  // A stage left by a killed process is cleaned on the next preparation.
  fs.mkdirSync(path.join(first.target, '.stage-00000000-0000-0000-0000-000000000000'))
  const later = await next(t, first.target, 'A9'); await later.prepare()
  assert.deepEqual(fs.readdirSync(first.target).filter(name => name.startsWith('.stage-')), [])
})

test('rollback is offered only when the whole previous generation is intact: marker identity, entry file and every folder', async t => {
  const { v2, oldAlpha } = await upgraded(t)
  await v2.prepare(); v2.markPrepared('1.1.0')
  assert.equal(v2.rollbackPlan().available, true)
  const marker = path.join(oldAlpha, '.najd-component.json'), original = fs.readFileSync(marker, 'utf8')
  // A marker that still exists but names another component or digest is not accepted.
  fs.writeFileSync(marker, JSON.stringify({ id: 'alpha', sha512: Buffer.alloc(64, 1).toString('base64') }))
  assert.equal(v2.rollbackPlan().available, false); assert.equal(v2.rollbackPlan().missing.length, 1)
  fs.writeFileSync(marker, original); assert.equal(v2.rollbackPlan().available, true)
  // A missing entry file (partly deleted folder) is not accepted either.
  fs.rmSync(path.join(oldAlpha, 'a.exe'))
  assert.equal(v2.rollbackPlan().available, false)
  fs.writeFileSync(path.join(oldAlpha, 'a.exe'), 'A'); fs.rmSync(marker)
  assert.equal(v2.rollbackPlan().available, false, 'a missing marker is reported, not offered')
})

test('an unreadable or malformed generation record is preserved, blocks any removal and never breaks startup', async t => {
  const { v2, oldAlpha, first } = await upgraded(t)
  const record = path.join(first.target, '.najd-generations.json')
  const good = fs.readFileSync(record, 'utf8')
  await v2.prepare()
  for (const text of ['{not json', JSON.stringify({ ...JSON.parse(good), current: { version: 'x', components: [] } }),
    JSON.stringify({ ...JSON.parse(good), lastGood: { version: '1.0.0', components: [{ folder: 'alpha-aaaaaaaaaaaa', entry: 'a' }, { folder: 'alpha-aaaaaaaaaaaa', entry: 'a' }] } }),
    JSON.stringify({ ...JSON.parse(good), previous: { version: '1.0.0', components: [{ folder: '../escape', entry: 'a' }] } })]) {
    fs.writeFileSync(record, text)
    assert.throws(() => v2.markPrepared('1.1.0'), { code: 'GENERATIONS_UNREADABLE' })
    assert.deepEqual(await v2.collect(), { removed: [], skipped: 'GENERATIONS_UNREADABLE' })
    assert.equal(fs.readFileSync(record, 'utf8'), text, 'the record is left in place for inspection')
    assert.equal(v2.rollbackPlan().available, false)
  }
  assert.equal(fs.existsSync(oldAlpha), true)
  assert.equal(v2.isReady(), true)
})

test('a damaged folder of the same content name is repaired by setting it aside, never by deleting before the new one is in place', async t => {
  const { first, v1 } = await upgraded(t)
  const folder = v1.directory('alpha')
  fs.rmSync(path.join(folder, 'a.exe'))
  const again = createBundleRuntime({ source: first.source, target: first.target })
  assert.equal(again.isReady(), false, 'a folder without its entry is not ready')
  await again.prepare()
  assert.equal(fs.readFileSync(path.join(folder, 'a.exe'), 'utf8'), 'A')
  assert.deepEqual(fs.readdirSync(first.target).filter(name => name.startsWith('.stage-')), [])
})

test('record entries that escape the component folder are rejected as an unreadable record', async t => {
  const { v2, first } = await upgraded(t)
  const record = path.join(first.target, '.najd-generations.json')
  const good = JSON.parse(fs.readFileSync(record, 'utf8'))
  for (const entry of ['../x', '/abs/x', 'C:/x', 'a//b', './a']) {
    good.lastGood.components[0].entry = entry
    fs.writeFileSync(record, JSON.stringify(good))
    assert.equal(v2.rollbackPlan().available, false, entry)
    assert.equal(v2.generations().error, 'GENERATIONS_UNREADABLE', entry)
  }
})
