// Owned output logs (M2-005/M2-009/M2-R2-002/M2-R3-001..003): following nextOffset returns every retained byte
// exactly once, long lines continue on the next page, pages never split a character, the host's trim record is
// honoured (including a trim interrupted by the writer's death), tail reports anything it leaves out, and other
// conversations cannot read a log. tests/process-host-smoke.cjs covers trimming by the real host while reading.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { createExecLogs } = require('../electron/exec-logs.cjs')

const setup = (conversationId, kind = 'python') => {
  const logs = createExecLogs({ directory: fs.mkdtempSync(path.join(os.tmpdir(), 'najd-logs-')) })
  return { logs, log: logs.createExternal({ conversationId, kind }) }
}
async function pageAll(logs, logId, conversationId, maxBytes, from = 0) {
  let offset = from, pages = 0, sawContinue = false, first = null
  while (offset !== null && pages < 3000) {
    const page = await logs.read({ logId, offset, conversationId, maxBytes })
    if (first === null) first = page.offset
    assert.ok(Buffer.byteLength(page.text) <= maxBytes, 'a page stays within its byte budget')
    assert.ok(page.text.split('\n').every(line => line.length <= 2000))
    assert.ok(!page.text.includes('�'), 'no broken characters')
    if (page.lineContinues) sawContinue = true
    assert.ok(page.nextOffset === null || page.nextOffset > page.offset, 'each page makes progress')
    offset = page.nextOffset; pages++
  }
  return { first, sawContinue }
}
// Reassembles the bytes the pages cover (offset to nextOffset) from the retained file.
async function covered(logs, logId, conversationId, maxBytes, file, trimmedBefore = 0) {
  const data = fs.readFileSync(file)
  let offset = 0, out = []
  while (offset !== null) {
    const page = await logs.read({ logId, offset, conversationId, maxBytes })
    const end = page.nextOffset ?? trimmedBefore + data.length
    out.push(data.subarray(page.offset - trimmedBefore, end - trimmedBefore)); offset = page.nextOffset
  }
  return Buffer.concat(out).toString('utf8')
}

test('paging returns the whole log, including a line longer than a page and multi-byte text', async () => {
  const { logs, log } = setup('conv-x')
  const content = 'start\n' + 'B'.repeat(5000) + '\n' + 'مرحبا بالعالم 😀 '.repeat(400) + '\nend line\n'
  fs.writeFileSync(log.file, content)
  for (const maxBytes of [8192, 1000, 37]) {
    const result = await pageAll(logs, log.logId, 'conv-x', maxBytes)
    assert.equal(await covered(logs, log.logId, 'conv-x', maxBytes, log.file), content, 'maxBytes ' + maxBytes)
    if (maxBytes === 8192) assert.ok(result.sawContinue, 'the 5,000-character line continues on the next page')
  }
  await assert.rejects(logs.read({ logId: log.logId, offset: 0, conversationId: 'conv-other' }), { code: 'NOT_FOUND' })
})

test('a page shows exactly the bytes it covers', async () => {
  const { logs, log } = setup('conv-y', 'process')
  fs.writeFileSync(log.file, 'a\r\nb\n' + 'C'.repeat(2500))
  const one = await logs.read({ logId: log.logId, offset: 0, conversationId: 'conv-y' })
  assert.equal(one.text, 'a\nb\n' + 'C'.repeat(2000)); assert.equal(one.lineContinues, true); assert.equal(one.nextOffset, 5 + 2000)
  const two = await logs.read({ logId: log.logId, offset: one.nextOffset, conversationId: 'conv-y' })
  assert.equal(two.text, 'C'.repeat(500)); assert.equal(two.nextOffset, null)
})

test('M2-R3-001/002: the host trim record sets absolute offsets; an offset inside a character moves to the next one', async () => {
  const { logs, log } = setup('conv-t')
  fs.writeFileSync(log.file, 'é' + '😀\n'.repeat(10))
  fs.writeFileSync(log.file + '.meta', JSON.stringify({ trimmedBefore: 1000 }))
  const page = await logs.read({ logId: log.logId, offset: 0, conversationId: 'conv-t' })
  assert.equal(page.offset, 1000); assert.equal(page.trimmedBefore, 1000); assert.equal(page.totalBytes, 1000 + 2 + 50)
  const inside = await logs.read({ logId: log.logId, offset: 1003, conversationId: 'conv-t' })
  assert.equal(inside.offset, 1006); assert.ok(!inside.text.includes('�'))
  // A trim the writer did not finish: still larger than the threshold means the content was not cut yet.
  fs.writeFileSync(log.file + '.meta', JSON.stringify({ trimmedBefore: 1000, pending: 4000, kept: fs.statSync(log.file).size }))
  assert.equal((await logs.read({ logId: log.logId, offset: 0, conversationId: 'conv-t' })).offset, 4000)
  // M2-R10-003: a pending trim whose log is neither the old one nor exactly the kept part is not guessed.
  fs.writeFileSync(log.file + '.meta', JSON.stringify({ trimmedBefore: 1000, pending: 4000, kept: 999999 }))
  await assert.rejects(logs.read({ logId: log.logId, offset: 0, conversationId: 'conv-t' }), { code: 'LOG_UNAVAILABLE' })
  fs.writeFileSync(log.file + '.meta', JSON.stringify({ trimmedBefore: 1000, pending: 4000, kept: 999999 }))
  fs.writeFileSync(log.file, Buffer.alloc(5 * 1024 * 1024 + 10, 65))
  assert.equal((await logs.read({ logId: log.logId, offset: 0, conversationId: 'conv-t' })).offset, 1000)
})

test('M2-R3-001: a log held exclusively by its writer is read once the writer lets go', async () => {
  const { logs, log } = setup('conv-l')
  fs.writeFileSync(log.file, 'line\n')
  // Windows only: an exclusive handle (as the host's trim uses) makes NAJD wait instead of reading half-trimmed data.
  if (process.platform !== 'win32') return
  const { spawn } = require('node:child_process')
  const holder = spawn('powershell.exe', ['-NoProfile', '-Command', `$s = [IO.File]::Open('${log.file.replace(/'/g, "''")}', 'Open', 'ReadWrite', 'None'); 'held'; Start-Sleep -Milliseconds 500; $s.Close()`], { windowsHide: true })
  const exited = new Promise(resolve => holder.on('exit', resolve))
  await new Promise(resolve => holder.stdout.on('data', resolve))
  const started = Date.now()
  const page = await logs.read({ logId: log.logId, offset: 0, conversationId: 'conv-l' })
  assert.equal(page.text, 'line\n'); assert.ok(Date.now() - started >= 200, 'waited for the writer')
  await exited
})

test('M2-R3-003: tail reports a shortened long line, an empty excerpt and omitted earlier lines', async () => {
  const { logs, log } = setup('conv-o', 'process')
  fs.writeFileSync(log.file, 'X'.repeat(5000) + '\n')
  const long = await logs.tail({ logId: log.logId, conversationId: 'conv-o', lines: 40, maxBytes: 8192 })
  assert.equal(long.truncated, true); assert.equal(long.lineTruncated, true)
  const tiny = await logs.tail({ logId: log.logId, conversationId: 'conv-o', lines: 40, maxBytes: 10 })
  assert.equal(tiny.text, ''); assert.equal(tiny.truncated, true)
  fs.writeFileSync(log.file, Array.from({ length: 100 }, (_, i) => 'row ' + i).join('\n') + '\n')
  const last = await logs.tail({ logId: log.logId, conversationId: 'conv-o', lines: 3, maxBytes: 8192 })
  assert.equal(last.text, 'row 97\nrow 98\nrow 99'); assert.equal(last.truncated, true)
  assert.equal(last.startOffset, Buffer.byteLength(Array.from({ length: 97 }, (_, i) => 'row ' + i).join('\n') + '\n'))
  const all = await logs.tail({ logId: log.logId, conversationId: 'conv-o', lines: 500, maxBytes: 8192 })
  assert.equal(all.truncated, false); assert.equal(all.startOffset, 0)
})

test('M2-R4-006: a page never holds more than its budget; a character that does not fit is reported, not split', async () => {
  const { logs, log } = setup('conv-b')
  fs.writeFileSync(log.file, 'abcd😀')
  const one = await logs.read({ logId: log.logId, offset: 0, conversationId: 'conv-b', maxBytes: 1 })
  assert.equal(one.text, 'a'); assert.equal(one.nextOffset, 1)
  const tight = await logs.read({ logId: log.logId, offset: 4, conversationId: 'conv-b', maxBytes: 2 })
  assert.equal(tight.text, ''); assert.equal(tight.insufficientBudget, true); assert.equal(tight.nextOffset, 4)
  const fits = await logs.read({ logId: log.logId, offset: 4, conversationId: 'conv-b', maxBytes: 4 })
  assert.equal(fits.text, '😀'); assert.equal(fits.nextOffset, null)
})

test('M2-R5-004: an unreadable trim record makes the log unavailable instead of resetting its offsets', async () => {
  const { logs, log } = setup('conv-m')
  fs.writeFileSync(log.file, 'kept\n')
  fs.writeFileSync(log.file + '.meta', '{"trimmedBef')
  await assert.rejects(logs.read({ logId: log.logId, offset: 0, conversationId: 'conv-m' }), { code: 'LOG_UNAVAILABLE' })
  await assert.rejects(logs.tail({ logId: log.logId, conversationId: 'conv-m' }), { code: 'LOG_UNAVAILABLE' })
  fs.writeFileSync(log.file + '.meta', '{"trimmedBefore":500}')
  assert.equal((await logs.read({ logId: log.logId, offset: 0, conversationId: 'conv-m' })).offset, 500)
})

test('M2-R7-005: shortened lines keep emoji whole, and tail never shows a half-written character', async () => {
  const { logs, log } = setup('conv-e', 'process')
  fs.writeFileSync(log.file, 'a'.repeat(1999) + '😀tail\n')
  const long = await logs.tail({ logId: log.logId, conversationId: 'conv-e' })
  assert.ok(!/[\ud800-\udbff](?![\udc00-\udfff])/.test(long.text), 'no lone high surrogate'); assert.equal(long.lineTruncated, true)
  const emoji = Buffer.from('😀')
  fs.writeFileSync(log.file, Buffer.concat([Buffer.from('done\n'), emoji.subarray(0, 2)])) // the writer is mid-character
  const partial = await logs.tail({ logId: log.logId, conversationId: 'conv-e' })
  assert.equal(partial.text, 'done'); assert.ok(!partial.text.includes('�')); assert.equal(partial.startOffset, 0)
})

test('M2-R11-001: a trim committed after NAJD opened the old log does not lend its offset to the old file', async () => {
  const fsp = require('node:fs/promises')
  const { logs, log } = setup('conv-g', 'process')
  fs.writeFileSync(log.file, 'old-1\nold-2\n')
  fs.writeFileSync(log.file + '.meta', JSON.stringify({ trimmedBefore: 0 }))
  const original = fsp.readFile
  let swapped = false
  // Between NAJD opening the log and reading its record, the host swaps in a trimmed log and commits its record.
  fsp.readFile = async (file, ...rest) => {
    if (!swapped && String(file).endsWith('.meta')) {
      swapped = true
      fs.unlinkSync(log.file) // the old file stays readable through NAJD's open handle
      fs.writeFileSync(log.file, 'new-9\n')
      fs.writeFileSync(log.file + '.meta', JSON.stringify({ trimmedBefore: 5000 }))
    }
    return original.call(fsp, file, ...rest)
  }
  try {
    const page = await logs.read({ logId: log.logId, offset: 0, conversationId: 'conv-g' })
    assert.ok(swapped, 'the swap happened during the read')
    // Either the old file with its old offset, or (after starting over) the new file with the new one: never mixed.
    assert.equal(page.offset, 5000); assert.equal(page.text, 'new-9\n')
  } finally { fsp.readFile = original }
})

test('M2-R17-003: a log whose files cannot be written leaves nothing behind; release removes an allocated log', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'najd-logs-'))
  const logs = createExecLogs({ directory })
  const original = fs.writeFileSync
  fs.writeFileSync = (file, ...rest) => { if (String(file).endsWith('.meta')) throw Object.assign(new Error('EACCES'), { code: 'EACCES' }); return original(file, ...rest) }
  try { assert.throws(() => logs.createExternal({ conversationId: 'c', kind: 'process' }), { code: 'EACCES' }) } finally { fs.writeFileSync = original }
  assert.deepEqual(fs.readdirSync(directory), [], 'no partial files')
  const log = logs.createExternal({ conversationId: 'c', kind: 'process' })
  logs.release(log.logId)
  // Only the ownership registry remains (M2-R22-002).
  assert.deepEqual(fs.readdirSync(directory).filter(name => name !== 'owners.json'), []); assert.equal(logs.owner(log.logId), null)
})

test('M2-R22-002: after a restart a conversation can still page its saved output; others cannot; a broken registry is kept aside', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'najd-logs-restart-'))
  const before = createExecLogs({ directory })
  const log = before.createExternal({ conversationId: 'conv-a', kind: 'python' })
  fs.writeFileSync(log.file, 'kept output\n')
  const after = createExecLogs({ directory }) // a new NAJD session
  assert.equal((await after.read({ logId: log.logId, offset: 0, conversationId: 'conv-a' })).text, 'kept output\n')
  await assert.rejects(after.read({ logId: log.logId, offset: 0, conversationId: 'conv-b' }), { code: 'NOT_FOUND' })
  fs.writeFileSync(path.join(directory, 'owners.json'), '{"format":')
  const broken = createExecLogs({ directory })
  await assert.rejects(broken.read({ logId: log.logId, offset: 0, conversationId: 'conv-a' }), { code: 'NOT_FOUND' })
  assert.ok(fs.readdirSync(directory).some(name => name.startsWith('owners.json.corrupt-')))
})

test('M2-R23-002: only logs of earlier sessions make room; if none can, the new log is refused; a failed save keeps everything', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'najd-logs-limit-'))
  const first = createExecLogs({ directory, maxLogs: 2 })
  const old1 = first.createExternal({ conversationId: 'c', kind: 'process' }), old2 = first.createExternal({ conversationId: 'c', kind: 'process' })
  const second = createExecLogs({ directory, maxLogs: 2 }) // a later session
  const fresh = second.createExternal({ conversationId: 'c', kind: 'process' })
  assert.equal(fs.existsSync(old1.file), false, 'the oldest earlier-session log made room'); assert.equal(fs.existsSync(old2.file), true)
  second.createExternal({ conversationId: 'c', kind: 'process' }) // evicts old2
  assert.throws(() => second.createExternal({ conversationId: 'c', kind: 'process' }), { code: 'LOG_LIMIT' }, 'this session\'s logs are never evicted')
  assert.equal(fs.existsSync(fresh.file), true)
  // A registry that cannot be saved: the new log is refused and nothing existing is removed.
  const third = createExecLogs({ directory, maxLogs: 2 })
  const before = fs.readdirSync(directory).sort()
  const original = fs.renameSync
  fs.renameSync = () => { throw Object.assign(new Error('EACCES'), { code: 'EACCES' }) }
  try { assert.throws(() => third.createExternal({ conversationId: 'c', kind: 'process' }), { code: 'EACCES' }) } finally { fs.renameSync = original }
  assert.deepEqual(fs.readdirSync(directory).filter(name => !name.endsWith('.tmp')).sort(), before.filter(name => !name.endsWith('.tmp')))
})

test('M2-R24-001: a conversation\'s saved logs are listed page by page, so the oldest can be found after a restart', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'najd-logs-list-'))
  const earlier = createExecLogs({ directory })
  const ids = []
  for (let i = 0; i < 35; i++) { const log = earlier.createExternal({ conversationId: 'conv-many', kind: 'python' }); ids.push(log.logId); await new Promise(resolve => setTimeout(resolve, 2)) }
  const logs = createExecLogs({ directory })
  const first = logs.list({ conversationId: 'conv-many', limit: 30, from: 0 })
  assert.equal(first.logs.length, 30); assert.equal(first.total, 35); assert.equal(first.nextFrom, 30)
  const rest = logs.list({ conversationId: 'conv-many', limit: 30, from: first.nextFrom })
  assert.equal(rest.logs.length, 5); assert.equal(rest.nextFrom, null)
  assert.ok(rest.logs.some(item => item.logId === ids[0]), 'the oldest log is reachable')
  await logs.read({ logId: ids[0], offset: 0, conversationId: 'conv-many' })
})

test('M2-R30-002: a registry that cannot be read blocks new logs instead of being overwritten, and loads once it can', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'najd-logs-registry-'))
  const first = createExecLogs({ directory })
  const kept = first.createExternal({ conversationId: 'conv-a', kind: 'python' })
  const registry = path.join(directory, 'owners.json'), saved = fs.readFileSync(registry, 'utf8')
  // A read failure other than "missing" (here the path is a folder, standing in for a busy or refused file).
  fs.rmSync(registry); fs.mkdirSync(registry)
  const blocked = createExecLogs({ directory })
  assert.throws(() => blocked.createExternal({ conversationId: 'conv-b', kind: 'python' }), { code: 'LOG_REGISTRY_UNAVAILABLE' })
  assert.throws(() => blocked.list({ conversationId: 'conv-a' }), { code: 'LOG_REGISTRY_UNAVAILABLE' })
  await assert.rejects(blocked.read({ logId: kept.logId, offset: 0, conversationId: 'conv-a' }), { code: 'LOG_REGISTRY_UNAVAILABLE' })
  assert.equal(fs.statSync(registry).isDirectory(), true, 'nothing replaced the unreadable registry')
  fs.rmdirSync(registry); fs.writeFileSync(registry, saved)
  const added = blocked.createExternal({ conversationId: 'conv-b', kind: 'python' })
  const after = createExecLogs({ directory })
  assert.equal(after.owner(kept.logId).conversationId, 'conv-a', 'the earlier log keeps its owner')
  assert.equal(after.owner(added.logId).conversationId, 'conv-b')
})

test('Phase 14 R2: retention removes old and oversize logs of earlier sessions, never this session\'s', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'najd-logs-'))
  const earlier = createExecLogs({ directory })
  const a = earlier.createExternal({ kind: 'python' }); await new Promise(resolve => setTimeout(resolve, 5))
  const b = earlier.createExternal({ kind: 'python' })
  for (const log of [a, b]) fs.writeFileSync(log.file, 'x'.repeat(100))
  const current = createExecLogs({ directory })
  const c = current.createExternal({ kind: 'python' }); fs.writeFileSync(c.file, 'x'.repeat(100))
  // Size: three logs of about 118 bytes; a cap of 250 removes only the oldest earlier log.
  assert.deepEqual(current.prune({ maxTotalBytes: 250, maxAgeMs: 1e12 }), { removed: 1 })
  assert.equal(fs.existsSync(a.file), false); assert.equal(fs.existsSync(b.file), true); assert.equal(fs.existsSync(c.file), true)
  // Age: everything is "old" an hour from now, but the log of this session stays.
  assert.deepEqual(current.prune({ maxTotalBytes: 1e12, maxAgeMs: 1000, now: Date.now() + 3600000 }), { removed: 1 })
  assert.equal(fs.existsSync(b.file), false); assert.equal(fs.existsSync(c.file), true)
  assert.equal(createExecLogs({ directory }).owner(b.logId), null, 'the registry forgot the removed log')
})

test('C53-02: a log of this session becomes removable once its run has ended', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'najd-logs-'))
  const logs = createExecLogs({ directory })
  const ended = logs.createExternal({ kind: 'process' }), running = logs.createExternal({ kind: 'process' })
  for (const log of [ended, running]) fs.writeFileSync(log.file, 'x'.repeat(100))
  assert.deepEqual(logs.prune({ maxTotalBytes: 0, maxAgeMs: 1e12 }), { removed: 0 }, 'both may still be written')
  logs.finished(ended.logId)
  assert.deepEqual(logs.prune({ maxTotalBytes: 0, maxAgeMs: 1e12 }), { removed: 1 })
  assert.equal(fs.existsSync(ended.file), false); assert.equal(fs.existsSync(running.file), true, 'a running log is never removed')
  logs.finished('log-unknown') // unknown ids are ignored
})

test('C54-01: runs that end within a minute of a pass are pruned by one trailing pass', t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1e12 })
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'najd-logs-'))
  const logs = createExecLogs({ directory, maxTotalBytes: 0 })
  const [a, b, c] = [1, 2, 3].map(() => logs.createExternal({ kind: 'process' }))
  logs.finished(a.logId) // first pass runs now
  assert.equal(fs.existsSync(a.file), false)
  logs.finished(b.logId); logs.finished(c.logId) // within the minute: one pass is scheduled
  assert.equal(fs.existsSync(b.file), true)
  t.mock.timers.tick(60000)
  assert.equal(fs.existsSync(b.file), false); assert.equal(fs.existsSync(c.file), false)
})
