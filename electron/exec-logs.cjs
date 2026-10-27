// Output logs of Python runs and NAJD-started processes (docs/AGENT-PLATFORM-M2-PLAN.md, M2-005/M2-009).
// The full output is kept in a NAJD-owned file in protected application data, written by the desktop host. The host
// keeps it bounded by cutting the oldest part (offsets stay absolute; the bytes cut are recorded in "<log>.meta"),
// the model receives a bounded excerpt, and najd_log_read pages the rest. Each log belongs to one conversation.
const fs = require('node:fs')
const { replaceFileSync } = require('./atomic-file.cjs')
const fsp = require('node:fs/promises')
const path = require('node:path')
const { randomBytes } = require('node:crypto')
const fail = code => Object.assign(new Error(code), { code })
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const TRIM_THRESHOLD = 5 * 1024 * 1024, MAX_LINE = 2000, MAX_PAGE = 8192
const validId = value => typeof value === 'string' && /^[A-Za-z0-9-]{1,80}$/.test(value)

// A model-visible excerpt: every line capped, the whole capped by bytes; a budget of 0 gives nothing (M2-R15).
// truncated: lines were dropped for the byte budget; lineTruncated: a line was shortened (M2-R3-003).
function excerpt(text, maxBytes) {
  const limit = Math.max(0, Math.min(MAX_PAGE, Math.floor(maxBytes)))
  let lineTruncated = false
  // A cut never splits a surrogate pair (an emoji) in two (M2-R7-005).
  const cut = line => { const code = line.charCodeAt(MAX_LINE - 1); return line.slice(0, code >= 0xd800 && code <= 0xdbff ? MAX_LINE - 1 : MAX_LINE) }
  const lines = String(text).split(/\r?\n/).map(line => { if (line.length <= MAX_LINE) return line; lineTruncated = true; return cut(line) + ' …[line truncated]' })
  let out = '', used = 0
  for (const line of lines) {
    const piece = (out ? '\n' : '') + line, size = Buffer.byteLength(piece)
    if (used + size > limit) return { text: out, truncated: true, lineTruncated }
    out += piece; used += size
  }
  return { text: out, truncated: false, lineTruncated }
}

// Length of the leading part of a buffer that ends on a complete UTF-8 character.
function utf8Boundary(bytes) {
  for (let back = 1; back <= Math.min(4, bytes.length); back++) {
    const byte = bytes[bytes.length - back]
    if ((byte & 0xc0) === 0x80) continue // continuation byte
    const size = byte >= 0xf0 ? 4 : byte >= 0xe0 ? 3 : byte >= 0xc0 ? 2 : 1
    return size > back ? bytes.length - back : bytes.length
  }
  return bytes.length
}
// Continuation bytes at the start of a buffer (a read that began inside a character).
const leadingContinuation = bytes => { let skip = 0; while (skip < Math.min(3, bytes.length) && (bytes[skip] & 0xc0) === 0x80) skip++; return skip }

const REGISTRY_FORMAT = 'najd-exec-logs-v1', MAX_LOGS = 2000
const MAX_TOTAL_BYTES = 512 * 1024 * 1024, MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000
const validLogId = value => typeof value === 'string' && /^log-[a-f0-9]{18}$/.test(value)

function createExecLogs({ directory, maxLogs = MAX_LOGS, maxTotalBytes: totalLimit = MAX_TOTAL_BYTES }) {
  if (!path.isAbsolute(directory || '')) throw fail('INVALID_INPUT')
  const owners = new Map() // logId -> { conversationId, runId, kind, file, created }
  // Logs created in this session may still be written by a running command; only logs of earlier sessions (whose
  // commands ended with them) can be evicted (M2-R23-002).
  const sessionLogs = new Set()
  // Which conversation owns which log is saved beside the logs, so saved output stays readable by its own conversation
  // after NAJD restarts (M2-R22-002). Each entry is checked when loaded; file paths are never taken from the record but
  // derived from the log id; a record that cannot be read is kept aside, not trusted.
  const registry = path.join(directory, 'owners.json')
  // The registry is replaced only once it has been read, or a malformed one has been moved aside. A read that fails for
  // another reason (the file busy, access refused) or a move that fails leaves it unloaded: logs cannot be created or
  // read until a later attempt succeeds, so the saved ownership of earlier logs is never overwritten (M2-R30-002).
  let loaded = false
  function load() {
    if (loaded) return
    let text
    try { text = fs.readFileSync(registry, 'utf8') }
    catch (failure) { if (failure?.code === 'ENOENT') { loaded = true; return } throw fail('LOG_REGISTRY_UNAVAILABLE') }
    let data = null
    try { data = JSON.parse(text) } catch {}
    if (data?.format !== REGISTRY_FORMAT || !Array.isArray(data.logs)) {
      try { fs.renameSync(registry, registry + '.corrupt-' + Date.now()) } catch { throw fail('LOG_REGISTRY_UNAVAILABLE') }
      loaded = true; return
    }
    for (const item of data.logs.slice(-maxLogs)) {
      if (!item || !validLogId(item.logId) || !(item.conversationId === null || validId(item.conversationId)) || !(item.runId === null || validId(item.runId)) ||
          typeof item.kind !== 'string' || item.kind.length > 40 || !Number.isSafeInteger(item.created)) continue
      const file = path.join(directory, item.logId + '.log')
      if (fs.existsSync(file)) owners.set(item.logId, { conversationId: item.conversationId, runId: item.runId, kind: item.kind, file, created: item.created })
    }
    loaded = true
  }
  try { load() } catch {}
  function save() {
    const logs = [...owners].map(([logId, entry]) => ({ logId, conversationId: entry.conversationId, runId: entry.runId, kind: entry.kind, created: entry.created }))
    const temporary = registry + '.tmp'
    fs.writeFileSync(temporary, JSON.stringify({ format: REGISTRY_FORMAT, logs }))
    // Retried briefly while Windows holds the file just written (atomic-file.cjs).
    replaceFileSync(temporary, registry)
  }
  // A log written by another process (the desktop host).
  function createExternal({ conversationId = null, runId = null, kind }) {
    load()
    fs.mkdirSync(directory, { recursive: true })
    const logId = 'log-' + randomBytes(9).toString('hex')
    const entry = { conversationId: validId(conversationId) ? conversationId : null, runId: validId(runId) ? runId : null, kind: String(kind || '').slice(0, 40), file: path.join(directory, logId + '.log'), created: Date.now() }
    // Created whole or not at all: both files are written before the log is registered, and a failure removes what was
    // written (M2-R17-003). The trim record exists from the start, so a missing record can only be the moment the host
    // swaps it in.
    try {
      fs.writeFileSync(entry.file, '')
      fs.writeFileSync(entry.file + '.meta', '{"trimmedBefore":0}')
    } catch (failure) {
      for (const file of [entry.file, entry.file + '.meta']) { try { fs.rmSync(file, { force: true }) } catch {} }
      throw failure
    }
    // Beyond the limit, the oldest logs of earlier sessions make room. If none can, the new log is refused rather than
    // removing one that may still be written. The registry is saved first; files are removed only after that worked.
    const excess = owners.size + 1 - maxLogs
    const evict = excess > 0 ? [...owners].filter(([id]) => !sessionLogs.has(id)).sort((x, y) => x[1].created - y[1].created).slice(0, excess) : []
    if (evict.length < Math.max(0, excess)) {
      for (const file of [entry.file, entry.file + '.meta']) { try { fs.rmSync(file, { force: true }) } catch {} }
      throw fail('LOG_LIMIT')
    }
    for (const [oldId] of evict) owners.delete(oldId)
    owners.set(logId, entry)
    try { save() } catch (failure) {
      owners.delete(logId)
      for (const [oldId, old] of evict) owners.set(oldId, old)
      for (const file of [entry.file, entry.file + '.meta']) { try { fs.rmSync(file, { force: true }) } catch {} }
      throw failure
    }
    sessionLogs.add(logId)
    for (const [, old] of evict) for (const file of [old.file, old.file + '.meta']) { try { fs.rmSync(file, { force: true }) } catch {} }
    return { logId, file: entry.file }
  }
  function owned(logId, conversationId) {
    load()
    const entry = owners.get(logId)
    if (!entry || entry.conversationId !== (validId(conversationId) ? conversationId : null)) throw fail('NOT_FOUND')
    return entry
  }
  // A consistent view: the log is opened first, then the trim record is read. The host swaps a trimmed log in whole
  // (File.Replace) after recording the pending trim with its kept length, so a log with a pending record is either
  // the old one (larger than the threshold) or exactly the kept part; anything else is reported, not guessed
  // (M2-R3-001, M2-R10-003).
  // The trim record must describe the very file that was opened: if the host swapped a trimmed log in after NAJD
  // opened the old one, the record may already speak of the new file, so the read starts over (M2-R11-001).
  async function snapshot(entry) {
    for (let attempt = 0; ; attempt++) {
      const view = await openView(entry)
      if (view.sameFile) { delete view.sameFile; return view }
      await view.handle.close()
      if (attempt >= 20) throw fail('LOG_UNAVAILABLE')
      await sleep(10)
    }
  }
  // The host swaps its trim record in with File.Replace, which renames files: for a moment the record can be busy or
  // missing. Such moments are waited out. The record is written when the log is created, so one still missing or
  // unreadable after that makes the log unavailable rather than being taken as "nothing trimmed" (M2-R12 follow-up).
  async function readMeta(file) {
    for (let attempt = 0; ; attempt++) {
      try { return await fsp.readFile(file, 'utf8') }
      catch (failure) {
        if (attempt >= 20) throw fail('LOG_UNAVAILABLE')
        if (!['ENOENT', 'EBUSY', 'EPERM', 'EACCES'].includes(failure?.code)) throw fail('LOG_UNAVAILABLE')
        await sleep(10)
      }
    }
  }
  async function openView(entry) {
    let handle = null
    for (let attempt = 0; !handle; attempt++) {
      try { handle = await fsp.open(entry.file, 'r') }
      // Busy while the host trims it, or briefly missing while File.Replace swaps the trimmed log in: wait a moment.
      catch (failure) { if (!['EBUSY', 'EPERM', 'EACCES', 'ENOENT'].includes(failure?.code) || attempt >= 40) throw fail('NOT_FOUND'); await sleep(25) }
    }
    try {
      const opened = await handle.stat({ bigint: true })
      const retained = Number(opened.size)
      // No record means nothing was trimmed; a record that cannot be read is not taken as "nothing trimmed", which
      // would misplace every offset, so the log is reported unavailable instead (M2-R5-004).
      let meta = {}
      const raw = await readMeta(entry.file + '.meta')
      if (raw !== null) { try { meta = JSON.parse(raw) } catch { throw fail('LOG_UNAVAILABLE') } if (!meta || typeof meta !== 'object' || !Number.isSafeInteger(meta.trimmedBefore)) throw fail('LOG_UNAVAILABLE') }
      const before = Number.isSafeInteger(meta.trimmedBefore) && meta.trimmedBefore > 0 ? meta.trimmedBefore : 0
      let trimmedBefore = before
      if (Number.isSafeInteger(meta.pending) && meta.pending > before) {
        if (Number.isSafeInteger(meta.kept) && retained === meta.kept) trimmedBefore = meta.pending
        else if (retained <= TRIM_THRESHOLD) throw fail('LOG_UNAVAILABLE')
      }
      // Read after the record: the path must still name the file this handle has open.
      const current = await fsp.stat(entry.file, { bigint: true }).catch(() => null)
      const sameFile = !!current && current.ino === opened.ino && current.dev === opened.dev
      return { handle, trimmedBefore, retained, size: trimmedBefore + retained, sameFile }
    } catch (failure) { await handle.close(); throw failure }
  }
  // A page of a log this conversation owns; offsets are absolute byte offsets into everything ever written.
  async function read({ logId, offset = 0, conversationId = null, maxBytes = MAX_PAGE }) {
    const entry = owned(logId, conversationId)
    const view = await snapshot(entry)
    try {
      const { handle, trimmedBefore, size } = view
      let start = Math.max(Number.isInteger(offset) && offset >= 0 ? offset : 0, trimmedBefore)
      const want = Math.max(0, Math.min(MAX_PAGE, Math.floor(maxBytes)))
      if (!want) return { logId, offset: start, text: '', nextOffset: start < size ? start : null, totalBytes: size, note: 'No room left in this request for more output.' }
      // Three bytes of look-ahead only help skip a character the offset falls inside; the page itself never holds
      // more than want bytes (M2-R4-006).
      const buffer = Buffer.alloc(want + 3)
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, start - trimmedBefore)
      // An offset inside a character moves to the next whole character.
      const skip = leadingContinuation(buffer.subarray(0, bytesRead))
      start += skip
      // A page ends on a line boundary when it can, otherwise on a whole character. A line longer than MAX_LINE ends
      // the page after MAX_LINE characters and the next page continues that same line, so following nextOffset
      // returns every retained byte exactly once (M2-R2-002).
      const available = buffer.subarray(skip, bytesRead)
      let raw = available.subarray(0, want)
      const lastNewline = raw.lastIndexOf(10)
      if (available.length > want && lastNewline > 0) raw = raw.subarray(0, lastNewline + 1)
      else if (raw.length && raw[raw.length - 1] !== 10) raw = raw.subarray(0, utf8Boundary(raw))
      if (!raw.length) return { logId, offset: start, text: '', nextOffset: start < size ? start : null, totalBytes: size,
        ...(available.length ? { insufficientBudget: true, note: 'The next character does not fit in the room left in this request.' } : {}) }
      const parts = raw.toString('utf8').split('\n'), shown = []
      let consumed = 0, lineContinues = false
      for (let index = 0; index < parts.length; index++) {
        const line = parts[index], last = index === parts.length - 1
        if (line.length > MAX_LINE) {
          const code = line.charCodeAt(MAX_LINE - 1), cut = code >= 0xd800 && code <= 0xdbff ? MAX_LINE - 1 : MAX_LINE
          shown.push(line.slice(0, cut)); consumed += Buffer.byteLength(line.slice(0, cut)); lineContinues = true; break
        }
        shown.push(line.replace(/\r$/, '')); consumed += Buffer.byteLength(line) + (last ? 0 : 1)
      }
      if (!lineContinues) consumed = raw.length
      const next = start + consumed
      return { logId, offset: start, text: shown.join('\n'), nextOffset: next < size ? next : null, totalBytes: size,
        ...(lineContinues ? { lineContinues: true, note: 'This line is longer than one page; read from nextOffset for the rest of it.' } : {}),
        ...(start > offset ? { trimmedBefore } : {}) }
    } finally { await view.handle.close() }
  }
  // The last N lines (bounded by bytes) and the offset where they start. truncated is true whenever anything of the
  // retained log is not in text (earlier lines, a shortened line, or lines dropped for the budget), and startOffset
  // is then where najd_log_read continues (M2-R3-003).
  async function tail({ logId, conversationId = null, lines = 40, maxBytes = MAX_PAGE }) {
    const entry = owned(logId, conversationId)
    const view = await snapshot(entry)
    try {
      const { handle, trimmedBefore, retained, size } = view
      const want = Math.max(0, Math.min(MAX_PAGE, Math.floor(maxBytes)))
      const readBytes = Math.min(retained, Math.max(want * 4, 4096), 64 * 1024)
      const buffer = Buffer.alloc(readBytes)
      const { bytesRead } = await handle.read(buffer, 0, readBytes, retained - readBytes)
      // Only whole characters are decoded: a character the writer has not finished yet is left for the next read and
      // offsets are counted up to it (M2-R7-005).
      const whole = buffer.subarray(0, bytesRead)
      const chunk = whole.subarray(leadingContinuation(whole), utf8Boundary(whole))
      const end = size - (whole.length - utf8Boundary(whole))
      const text = chunk.toString('utf8'), endsWithNewline = text.endsWith('\n')
      const all = (endsWithNewline ? text.slice(0, -1) : text).split('\n')
      const count = Math.max(1, Math.min(500, Number.isInteger(lines) && lines > 0 ? lines : 40))
      let picked = all.slice(-count)
      let shown = excerpt(picked.join('\n'), want)
      while (shown.truncated && picked.length > 1) { picked = picked.slice(1); shown = excerpt(picked.join('\n'), want) }
      if (shown.truncated) picked = [] // not even the last line fits the budget
      const startOffset = Math.max(trimmedBefore, end - (picked.length ? Buffer.byteLength(picked.join('\n')) + (endsWithNewline ? 1 : 0) : 0))
      const lineTruncated = picked.length > 0 && shown.lineTruncated
      return { logId, text: picked.length ? shown.text : '', lines: picked.length, startOffset, totalBytes: size,
        truncated: startOffset > trimmedBefore || lineTruncated || (retained > 0 && !picked.length), ...(lineTruncated ? { lineTruncated: true } : {}) }
    } finally { await view.handle.close() }
  }
  // Retention (Phase 14 R2): logs of earlier sessions (and this session's logs whose run has ended, see finished) older
  // than maxAgeMs are removed, then the oldest of them until all logs together fit maxTotalBytes. Logs still being
  // written are never removed here. As in
  // createExternal, the registry is saved first and files are removed only after that worked.
  function prune({ maxTotalBytes = totalLimit, maxAgeMs = MAX_AGE_MS, now = Date.now() } = {}) {
    try { load() } catch { return { removed: 0 } }
    const size = file => { let total = 0; for (const item of [file, file + '.meta']) { try { total += fs.statSync(item).size } catch {} } return total }
    const sizes = new Map([...owners].map(([id, entry]) => [id, size(entry.file)]))
    let total = [...sizes.values()].reduce((sum, value) => sum + value, 0)
    const evict = []
    for (const [id, entry] of [...owners].filter(([id]) => !sessionLogs.has(id)).sort((x, y) => x[1].created - y[1].created)) {
      if (now - entry.created <= maxAgeMs && total <= maxTotalBytes) break
      evict.push([id, entry]); total -= sizes.get(id)
    }
    if (!evict.length) return { removed: 0 }
    for (const [id] of evict) owners.delete(id)
    try { save() } catch { for (const [id, entry] of evict) owners.set(id, entry); return { removed: 0 } }
    for (const [, entry] of evict) for (const file of [entry.file, entry.file + '.meta']) { try { fs.rmSync(file, { force: true }) } catch {} }
    return { removed: evict.length }
  }
  // The run writing this log has ended (its process family is closed): from now on retention may remove it like a log of
  // an earlier session, and the total limit is enforced again (at most once a minute) so a long session stays within it.
  // Logs still being written are bounded by the process limit and the host's per-log trimming (C53-02).
  // Within a minute of the last pass, one trailing pass is scheduled instead, so runs that end close together are still
  // pruned (C54-01).
  let lastPrune = 0, trailing = null
  const prunePass = () => { lastPrune = Date.now(); try { prune() } catch {} }
  function finished(logId) {
    if (!sessionLogs.delete(logId)) return
    const wait = 60000 - (Date.now() - lastPrune)
    if (wait <= 0) { prunePass(); return }
    if (trailing) return
    trailing = setTimeout(() => { trailing = null; prunePass() }, wait)
    trailing.unref?.()
  }
  // A log allocated for a run that never started: forgotten and its files removed (M2-R16-003).
  function release(logId) {
    const entry = owners.get(logId)
    if (!entry) return
    owners.delete(logId)
    for (const file of [entry.file, entry.file + '.meta']) { try { fs.rmSync(file, { force: true }) } catch {} }
    try { save() } catch {}
  }
  // This conversation's saved logs, newest first, so they can be found again after a restart (M2-R23-001).
  // Paged from the newest: from is how many to skip; nextFrom continues, null when there are no more (M2-R24-001).
  function list({ conversationId = null, limit = 30, from = 0 } = {}) {
    load()
    const owner = validId(conversationId) ? conversationId : null
    const all = [...owners].filter(([, entry]) => entry.conversationId === owner).sort((x, y) => y[1].created - x[1].created)
    const start = Number.isInteger(from) && from > 0 ? from : 0, count = Math.max(1, Math.min(100, limit))
    const logs = all.slice(start, start + count)
      .map(([logId, entry]) => { let size = 0; try { size = fs.statSync(entry.file).size } catch {} return { logId, kind: entry.kind, created: new Date(entry.created).toISOString(), retainedBytes: size } })
    return { logs, total: all.length, nextFrom: start + logs.length < all.length ? start + logs.length : null }
  }
  return { createExternal, release, prune, finished, list, read, tail, excerpt, owner: logId => owners.has(logId) ? { ...owners.get(logId) } : null }
}
module.exports = { createExecLogs, excerpt }
