const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { createDocumentFinder } = require('../electron/document-finder.cjs')

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'najd-find-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  await fs.mkdir(path.join(root, 'nested'))
  await fs.mkdir(path.join(root, 'engines'))
  for (const file of ['nested/Report.txt', 'Report.exe', 'credentials-report.txt', '.env.report.txt', 'engines/Report.txt'])
    await fs.writeFile(path.join(root, file), 'fixture only')
  let roots = [root]
  const entries = []
  const find = createDocumentFinder({ getRoots: () => roots, getProtectedRoots: () => [path.join(root, 'engines')], audit: { record: entry => entries.push(entry) } })
  return { root, entries, revoke: () => { roots = [] }, find: (input = {}, signal) => find({ input: { path: root, query: 'report', ...input }, signal }) }
}

test('filename search finds documents without exposing protected or sensitive names', async t => {
  const f = await fixture(t)
  const result = JSON.parse(await f.find())
  assert.deepEqual(result, { paths: [path.join(f.root, 'nested/Report.txt')], limited: false })
  assert.equal(f.entries.at(-1).action, 'find-documents')
  assert.equal(JSON.stringify(f.entries).includes('fixture only'), false)
})

test('search rejects outside roots, invalid queries, cancellation and revoked grants', async t => {
  const f = await fixture(t)
  await assert.rejects(f.find({ path: path.dirname(f.root) }), { code: 'PATH_NOT_ALLOWED' })
  await assert.rejects(f.find({ path: path.join(f.root, 'engines') }), { code: 'SENSITIVE_FILE' })
  await assert.rejects(f.find({ query: '' }), { code: 'INVALID_INPUT' })
  await assert.rejects(f.find({}, AbortSignal.abort()), { code: 'CANCELLED' })
  f.revoke()
  await assert.rejects(f.find(), { code: 'NO_ROOTS' })
})

test('junctions do not escape search roots or reveal protected engine names', async t => {
  const f = await fixture(t)
  const outside = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'najd-find-outside-'))
  t.after(() => fs.rm(outside, { recursive: true, force: true }))
  await fs.writeFile(path.join(outside, 'Report-secret.txt'), 'fixture')
  await fs.symlink(outside, path.join(f.root, 'alias'), process.platform === 'win32' ? 'junction' : 'dir')
  await fs.symlink(path.join(f.root, 'engines'), path.join(f.root, 'engine-alias'), process.platform === 'win32' ? 'junction' : 'dir')
  assert.equal(JSON.parse(await f.find()).paths.length, 1)
  await assert.rejects(f.find({ path: path.join(f.root, 'alias') }), { code: 'PATH_NOT_ALLOWED' })
  await assert.rejects(f.find({ path: path.join(f.root, 'engine-alias') }), { code: 'SENSITIVE_FILE' })
})

test('search bounds results and rechecks revoked scope before returning', async t => {
  const f = await fixture(t)
  for (let i = 0; i < 14; i++) await fs.writeFile(path.join(f.root, `report-${i}.md`), 'fixture')
  const result = JSON.parse(await f.find())
  assert.equal(result.paths.length, 12)
  assert.equal(result.limited, true)
  let checks = 0
  const finder = createDocumentFinder({ getRoots: () => ++checks < 3 ? [f.root] : [] })
  await assert.rejects(finder({ input: { path: f.root, query: 'report' } }), { code: 'NO_ROOTS' })
})

test('search reports depth limits and excludes hidden directories even as explicit targets', async t => {
  const f = await fixture(t)
  await fs.mkdir(path.join(f.root, 'one/two/three/four'), { recursive: true })
  await fs.mkdir(path.join(f.root, '.private'))
  await fs.writeFile(path.join(f.root, 'one/two/three/four/deep.txt'), 'fixture')
  assert.deepEqual(JSON.parse(await f.find({ query: 'deep' })), { paths: [], limited: true })
  await assert.rejects(f.find({ path: path.join(f.root, '.private') }), { code: 'SENSITIVE_FILE' })
  const finder = createDocumentFinder({ getRoots: () => [f.root], audit: { record() { throw new Error('fixture logging failure') } } })
  assert.ok(JSON.parse(await finder({ input: { path: f.root, query: 'report' } })).paths.length > 0)
})
