// Lifecycle records of NAJD background commands (docs/AGENT-PLATFORM-M2-PLAN.md, M2-003/M2-006/M2-008).
// Two provenance variants: "approved" starts link to their journal action; "direct" read-only starts carry a
// generated start id and the allowlist classification, with no approval claim. A start is reserved before the host
// runs anything and confirmed with the host's acknowledgement (M2-R10). Records of live or uncertain jobs are never
// dropped (M2-R13). Every record is validated when the file is loaded; an invalid file is kept aside (M2-R12).
const fs = require('node:fs/promises')
const { replaceFile } = require('./atomic-file.cjs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const FORMAT = 'najd-process-lifecycle-v1', MAX = 500, MAX_FILE = 2 * 1024 * 1024
const fail = code => Object.assign(new Error(code), { code })
const STATES = new Set(['starting', 'running', 'exited', 'stopped', 'ended-with-session', 'unknown', 'failed'])
const TERMINAL = new Set(['exited', 'stopped', 'ended-with-session', 'failed'])
const id = value => typeof value === 'string' && /^[A-Za-z0-9-]{1,80}$/.test(value)
const nullableId = value => value === null || id(value)

function validRecord(item) {
  return item && typeof item === 'object' && id(item.startId) && id(item.sessionId) && STATES.has(item.state) &&
    (item.provenance?.kind === 'approved' ? typeof item.provenance.actionId === 'string' && item.provenance.actionId.length <= 120 :
      item.provenance?.kind === 'direct' && item.provenance.classification === 'read') &&
    nullableId(item.conversationId) && nullableId(item.runId) && typeof item.command === 'string' && item.command.length <= 300 &&
    (item.hostId === null || typeof item.hostId === 'string' && item.hostId.length <= 64) && (item.logId === null || typeof item.logId === 'string') &&
    typeof item.contained === 'boolean' && Number.isFinite(item.startedAt)
}

// onEnded(logId) is told when a record that owns a log reaches a final state, so its log can be retained like an ended one.
function createProcessLifecycle({ filePath, sessionId = randomUUID(), onEnded = null }) {
  if (!path.isAbsolute(filePath || '')) throw fail('INVALID_INPUT')
  let records = null, loading = null, queue = Promise.resolve()
  const serial = work => { const next = queue.then(work); queue = next.catch(() => {}); return next }
  // The file is replaced only after it was read, found missing, or moved aside when invalid. Any other read failure
  // (busy, access refused) or a failed move leaves the store unloaded: the call fails with LIFECYCLE_UNAVAILABLE and
  // the next one tries again, so earlier records are never overwritten by an empty list (M2-R31-002).
  const load = () => records ? Promise.resolve(records) : (loading ||= (async () => {
    try {
      let text
      try {
        const stat = await fs.stat(filePath)
        text = stat.size > MAX_FILE ? null : await fs.readFile(filePath, 'utf8')
      } catch (error) {
        if (error?.code === 'ENOENT') { records = []; return records }
        throw fail('LIFECYCLE_UNAVAILABLE')
      }
      let data = null
      try { data = text === null ? null : JSON.parse(text) } catch {}
      if (data?.format !== FORMAT || !Array.isArray(data.records) || !data.records.every(validRecord) ||
          new Set(data.records.map(item => item.startId)).size !== data.records.length) {
        await fs.rename(filePath, filePath + '.corrupt-' + Date.now()).catch(() => { throw fail('LIFECYCLE_UNAVAILABLE') })
        records = []; return records
      }
      records = data.records
      return records
    } finally { loading = null }
  })())
  async function commit(next) {
    const temp = filePath + '.tmp-' + process.pid
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(temp, JSON.stringify({ format: FORMAT, records: next }))
    // Retried briefly while Windows holds the file (atomic-file.cjs).
    await replaceFile(temp, filePath)
    records = next
  }
  // Only finished records are pruned; live or uncertain ones are kept (M2-R13).
  const prune = list => {
    if (list.length <= MAX) return list
    const removable = list.filter(item => TERMINAL.has(item.state)).slice(0, list.length - MAX).map(item => item.startId)
    return list.filter(item => !removable.includes(item.startId))
  }
  let reconcileWanted = false, reconciled = false
  async function reconcile() {
    const current = await load()
    let changed = 0
    const next = current.map(item => {
      if (item.sessionId === sessionId || !['running', 'starting'].includes(item.state)) return item
      changed++
      return { ...item, state: item.state === 'running' && item.contained ? 'ended-with-session' : 'unknown', updatedAt: Date.now() }
    })
    if (changed) await commit(next)
    reconciled = true
    return changed
  }
  const ready = async () => { if (reconcileWanted && !reconciled) await reconcile(); return load() }
  const update = (startId, change) => serial(async () => {
    const current = await ready()
    const record = current.find(item => item.startId === startId)
    if (!record) throw fail('NOT_FOUND')
    await commit(current.map(item => item.startId === startId ? { ...item, ...change, updatedAt: Date.now() } : item))
    if (TERMINAL.has(change.state) && record.logId && typeof onEnded === 'function') { try { onEnded(record.logId) } catch {} }
  })
  return {
    sessionId,
    // Reserved before anything runs; refused when retention could no longer keep every live record.
    reserve({ provenance, conversationId = null, runId = null, command, logId }) {
      if (!['approved', 'direct'].includes(provenance?.kind) || (provenance.kind === 'approved' && typeof provenance.actionId !== 'string') ||
          (provenance.kind === 'direct' && provenance.classification !== 'read')) return Promise.reject(fail('INVALID_INPUT'))
      const record = { startId: randomUUID(), sessionId, provenance: provenance.kind === 'approved' ? { kind: 'approved', actionId: provenance.actionId } : { kind: 'direct', classification: 'read' },
        conversationId: nullableId(conversationId) ? conversationId : null, runId: nullableId(runId) ? runId : null, command: String(command || '').slice(0, 300),
        hostId: null, pid: null, created: null, contained: false, logId: logId || null, state: 'starting', exitCode: null, startedAt: Date.now(), updatedAt: Date.now() }
      return serial(async () => {
        const current = await ready()
        if (current.filter(item => !TERMINAL.has(item.state)).length >= MAX) throw fail('PROCESS_LIMIT')
        await commit(prune([...current, record]))
        return { ...record }
      })
    },
    confirm: (startId, { hostId, pid, created, contained }) => update(startId, { hostId: String(hostId).slice(0, 64), pid: Number.isInteger(pid) ? pid : null,
      created: typeof created === 'string' ? created.slice(0, 32) : null, contained: contained === true, state: 'running' }),
    failed: startId => update(startId, { state: 'failed' }),
    unknown: startId => update(startId, { state: 'unknown' }),
    exited: (startId, exitCode) => update(startId, { state: 'exited', exitCode: Number.isInteger(exitCode) ? exitCode : null }),
    stopped: startId => update(startId, { state: 'stopped' }),
    // After a restart: earlier sessions' live records ended with their contained job, or are honestly unknown. If the
    // file cannot be read at startup, this runs before the first later use that can read it (M2-R31-002).
    reconcileStartup: () => serial(async () => { reconcileWanted = true; return reconcile() }),
    list: async (filter = {}) => (await serial(ready)).filter(item => (!filter.sessionOnly || item.sessionId === sessionId) &&
      (filter.conversationId === undefined || item.conversationId === filter.conversationId)).map(item => ({ ...item })),
    get: async startId => { const item = (await serial(ready)).find(record => record.startId === startId); return item ? { ...item } : null },
    states: STATES
  }
}
module.exports = { createProcessLifecycle }
