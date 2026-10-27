const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { createMemoryStore, readMemoryBackup } = require('../electron/memory-store.cjs')

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'najd-memory-test-'))
  t.after(async () => {
    assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep))
    assert.match(path.basename(directory), /^najd-memory-test-/)
    await fs.rm(directory, { recursive: true, force: true })
  })
  const filePath = path.join(directory, 'memory.json')
  return { directory, filePath, store: createMemoryStore(filePath) }
}

test('local notes survive restart and correction/deletion never touches session or credential stores', async t => {
  const { filePath, directory, store } = await fixture(t)
  await fs.writeFile(path.join(directory, 'sessions.json'), 'session sentinel')
  await fs.writeFile(path.join(directory, 'credentials.json'), 'credential sentinel')
  const note = await store.save({ title: 'Preference', text: 'Use concise replies.' })
  assert.deepEqual(await createMemoryStore(filePath).list(), [note])
  const edited = await store.save({ id: note.id, title: 'Corrected', text: 'Use detailed replies.' })
  assert.equal(edited.createdAt, note.createdAt)
  assert.equal(edited.text, 'Use detailed replies.')
  assert.deepEqual(await createMemoryStore(filePath).list(), [edited])
  await store.remove(note.id)
  assert.deepEqual(await createMemoryStore(filePath).list(), [])
  assert.equal(await fs.readFile(path.join(directory, 'sessions.json'), 'utf8'), 'session sentinel')
  assert.equal(await fs.readFile(path.join(directory, 'credentials.json'), 'utf8'), 'credential sentinel')
})

test('concurrent note writes serialize without losing records and callers cannot mutate stored state', async t => {
  const { store } = await fixture(t)
  await Promise.all(Array.from({ length: 12 }, (_, i) => store.save({ title: 'Note ' + i, text: 'Private local content' })))
  const notes = await store.list()
  assert.equal(notes.length, 12)
  notes[0].text = 'Modified caller object'
  assert.equal((await store.list())[0].text, 'Private local content')
})

test('backup restores only its own schema, is idempotent and refuses conflicting content atomically', async t => {
  const { store } = await fixture(t)
  const note = await store.save({ title: 'Original', text: 'A local note.' })
  const backup = await store.exportSnapshot()
  const target = (await fixture(t)).store
  await target.importSnapshot(backup)
  await target.importSnapshot(backup)
  assert.deepEqual(await target.list(), [note])
  await target.save({ id: note.id, title: note.title, text: 'A newer corrected note.' })
  await assert.rejects(target.importSnapshot(backup), { code: 'MEMORY_CONFLICT' })
  assert.equal((await target.list())[0].text, 'A newer corrected note.')
  await assert.rejects(target.importSnapshot(JSON.stringify({ version: 1, credentials: ['not a memory backup'] })), { code: 'INVALID_INPUT' })
})

test('new input, malformed backup, unsupported versions and oversized import refuse without saving', async t => {
  const { store } = await fixture(t)
  for (const input of [{ title: '', text: 'x' }, { title: 'x', text: '' }, { title: 'x', text: 'x'.repeat(100001) },
    { title: 'x', text: 'x', provider: 'cloud' }, { id: 'bad', title: 'x', text: 'x' }]) {
    await assert.rejects(store.save(input), { code: 'INVALID_INPUT' })
  }
  for (const value of ['not json', JSON.stringify({ format: 'najd-memory', version: 2, notes: [] }), ' '.repeat(64 * 1024 * 1024 + 1)]) {
    await assert.rejects(store.importSnapshot(value), { code: 'INVALID_INPUT' })
  }
  assert.deepEqual(await store.list(), [])
})

test('corrupt, unknown-version and oversized primary records are preserved and fail closed', async t => {
  for (const value of ['{"broken":', JSON.stringify({ format: 'najd-memory', version: 2, notes: [] }), ' '.repeat(524289)]) {
    const { filePath, store } = await fixture(t)
    await fs.writeFile(filePath, value)
    await assert.rejects(store.list(), { code: 'MEMORY_STORE_UNAVAILABLE' })
    await assert.rejects(store.save({ title: 'Do not reset', text: 'Preserve original bytes.' }), { code: 'MEMORY_STORE_UNAVAILABLE' })
    assert.equal(await fs.readFile(filePath, 'utf8'), value)
  }
})

test('interrupted temporary snapshots are ignored and failed atomic replacement preserves the primary', async t => {
  const { filePath, store } = await fixture(t)
  const note = await store.save({ title: 'Before interruption', text: 'Canonical content' })
  const before = await fs.readFile(filePath, 'utf8')
  await fs.writeFile(filePath + '.interrupted.tmp', '{"partial":')
  assert.deepEqual(await createMemoryStore(filePath).list(), [note])
  const originalRename = fs.rename
  fs.rename = async (from, to) => {
    if (to === filePath) throw Object.assign(new Error('Fixture replacement failure'), { code: 'EPERM' })
    return originalRename(from, to)
  }
  try { await assert.rejects(store.save({ id: note.id, title: note.title, text: 'Uncommitted replacement' }), { code: 'MEMORY_STORE_UNAVAILABLE' }) }
  finally { fs.rename = originalRename }
  // Reject a directory occupying the primary path; never replace it with empty state.
  const blocked = path.join(path.dirname(filePath), 'blocked.json')
  await fs.mkdir(blocked)
  await assert.rejects(createMemoryStore(blocked).save({ title: 'x', text: 'x' }), { code: 'MEMORY_STORE_UNAVAILABLE' })
  assert.equal(await fs.readFile(filePath, 'utf8'), before)
  assert.equal(await fs.readFile(filePath + '.interrupted.tmp', 'utf8'), '{"partial":')
})

test('capacity is bounded and invalid duplicate/timestamp records cannot be imported', async t => {
  const { filePath } = await fixture(t)
  const store = createMemoryStore(filePath, { maxNotes: 50 }) // the real capacity is 5000; a small one keeps this test fast
  for (let i = 0; i < 50; i++) await store.save({ title: 'Note ' + i, text: 'Local' })
  await assert.rejects(store.save({ title: 'Excess', text: 'No silent eviction' }), { code: 'MEMORY_LIMIT' })
  const snapshot = JSON.parse(await store.exportSnapshot())
  snapshot.notes[1] = snapshot.notes[0]
  await assert.rejects(store.importSnapshot(JSON.stringify(snapshot)), { code: 'INVALID_INPUT' })
  snapshot.notes = [{ ...snapshot.notes[0], createdAt: 'not a date' }]
  await assert.rejects(store.importSnapshot(JSON.stringify(snapshot)), { code: 'INVALID_INPUT' })
  assert.equal((await store.list()).length, 50)
})

test('clock rollback does not corrupt imported notes and backup file reads stay bounded and UTF-8 strict', async t => {
  const { store, filePath, directory } = await fixture(t)
  await store.save({ title: 'Future note', text: 'Still editable' })
  const snapshot = JSON.parse(await store.exportSnapshot())
  snapshot.notes[0].createdAt = snapshot.notes[0].updatedAt = '2099-01-01T00:00:00.000Z'
  await store.remove(snapshot.notes[0].id)
  await store.importSnapshot(JSON.stringify(snapshot))
  await store.save({ id: snapshot.notes[0].id, title: 'Corrected', text: 'Clock moved back' })
  assert.equal((await store.list())[0].updatedAt, '2099-01-01T00:00:00.000Z')
  assert.equal(JSON.parse(await readMemoryBackup(filePath)).notes.length, 1)
  const bad = path.join(directory, 'bad.json')
  await fs.writeFile(bad, Buffer.from([0xff, 0xfe]))
  await assert.rejects(readMemoryBackup(bad), { code: 'INVALID_INPUT' })
  await fs.writeFile(bad, ' '.repeat(524289))
  await assert.rejects(readMemoryBackup(bad), { code: 'INVALID_INPUT' })
  await assert.rejects(readMemoryBackup(directory), { code: 'INVALID_INPUT' })
})
