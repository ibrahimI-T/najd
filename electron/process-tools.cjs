// Background commands for the agent (docs/AGENT-PLATFORM-M2-PLAN.md, M2c): najd_process_start/list/output/stop.
// The NAJD desktop host runs each command contained in a Job object (it ends with the host, even on a crash).
// Read-only allowlisted commands start directly; anything else needs an in-chat approval and is journaled.
// Ids given to the model are lifecycle start ids; output and stop work only for processes NAJD started in this
// session for the same conversation, while the list also reports how earlier sessions' commands ended.
const { createHash, randomUUID } = require('node:crypto')
const fail = code => Object.assign(new Error(code), { code })
const sha = value => createHash('sha256').update(value).digest('hex')
// Host refusals that prove nothing ran (M2-R11).
// The command may have run: the error says so and names what to inspect before trying again (M2-R3-005).
const uncertain = (record, log) => Object.assign(fail('PROCESS_FAILED'), { effectUnknown: true, startId: record.startId, logId: log.logId })
const REFUSED = new Set(['INVALID_INPUT', 'PROCESS_LIMIT', 'NOT_FOUND', 'CANCELLED', 'WINDOWS_NODE_NOT_INSTALLED', 'START_REFUSED', 'NOT_CONNECTED', 'ADMIN_NOT_ALLOWED', 'PATH_NOT_ALLOWED'])

function createProcessTools({ host, lifecycle, logs, journal, classifyCommand, checkFolder, createFolder, workspace, executionEnv = () => ({}), available = () => true }) {
  if (typeof host?.invokeHost !== 'function' || !lifecycle || !logs || typeof classifyCommand !== 'function' || typeof checkFolder !== 'function') throw fail('INVALID_INPUT')
  const sameConversation = (record, conversationId) => record && record.sessionId === lifecycle.sessionId && (record.conversationId || null) === (conversationId || null)
  // Host jobs started in this session whose lifecycle record could not be confirmed: startId -> host id (M2-R4-001).
  const untracked = new Map()
  // Adopted Python families whose record could not be saved at all: kept for this session only, owned by their
  // conversation, and resolved by list, output and stop like saved records (M2-R6-001).
  const unsaved = new Map()
  const getRecord = async id => unsaved.get(id) || await lifecycle.get(id)
  // Starts of unknown outcome that NAJD cannot reach, tied to the host process that received them: once that process
  // is confirmed ended, so are their jobs, and they are recorded stopped; what they did stays unknown in the journal
  // (M2-R25-002).
  const unknownStarts = new Map()
  async function settleUnknown() {
    for (const [startId, instance] of [...unknownStarts]) {
      if (!host.instanceEnded?.(instance)) continue
      if (unsaved.has(startId)) { Object.assign(unsaved.get(startId), { state: 'exited', exitCode: null }); untracked.delete(startId); unknownStarts.delete(startId); continue }
      if (await lifecycle.stopped(startId).then(() => true, () => false)) { unknownStarts.delete(startId); untracked.delete(startId) }
    }
  }
  const envFor = () => { const env = executionEnv(); return Object.fromEntries(Object.entries(env).filter(([name, value]) => /^[A-Za-z_][A-Za-z0-9_()]{0,63}$/.test(name) && typeof value === 'string' && value.length <= 8000).slice(0, 80)) }

  async function start({ command, cwd }, { requestApproval, signal, conversationId = null, runId = null }) {
    if (typeof command !== 'string' || !command.trim() || command.length > 4000 || command.includes('\0')) throw fail('INVALID_INPUT')
    const folder = await checkFolder(typeof cwd === 'string' ? cwd : '')
    const classification = classifyCommand(command)
    let action = null
    if (classification !== 'read') {
      if (typeof requestApproval !== 'function') throw fail('PERMISSION_DENIED')
      action = journal ? await journal.prepare({ intentId: sha(randomUUID()).slice(0, 48), operation: 'process.start',
        target: (folder.absolute + ' :: ' + command).replace(/[\x00-\x1f]+/g, ' ').slice(0, 1000), changeHash: sha(JSON.stringify([folder.absolute, command])) }) : null
      let decision
      try { decision = await requestApproval('najd-process-start', { path: folder.absolute, cwd: folder.absolute, command,
        summary: 'Start a background PowerShell command' + (folder.exists ? '' : ' (its folder will be created)') + '. It keeps running until it finishes or is stopped; NAJD stops it when NAJD closes.' }) }
      catch (failure) { if (action) await journal.cancel(action.id).catch(() => {}); throw failure }
      if (decision !== 'ALLOW_ONCE') { if (action) await journal.decide(action.id, action.nonce, 'DENY'); return { status: 'denied_by_user', note: 'Nothing was started.' } }
      if (action) await journal.decide(action.id, action.nonce, 'ALLOW_ONCE')
    } else if (!folder.exists && folder.absolute !== workspace) throw fail('NOT_FOUND') // direct starts never create folders
    if (signal?.aborted) { if (action) await journal.cancel(action.id); throw fail('CANCELLED') }
    // The folder must still be allowed, and be the same folder, now that it is about to run (a grant removed while
    // the approval was pending means nothing runs) (M2-R14-003).
    const still = await checkFolder(typeof cwd === 'string' ? cwd : '').catch(() => null)
    if (!still || still.absolute !== folder.absolute) { if (action) await journal.cancel(action.id).catch(() => {}); throw fail('PATH_NOT_ALLOWED') }
    // Reserved before anything runs (M2-R10): a failure to record means nothing is started.
    // Nothing has run yet: a failure to allocate the log or reserve the record cancels the approval and releases
    // the log (M2-R16-003).
    let log = null, record
    try {
      log = logs.createExternal({ conversationId, runId, kind: 'process' })
      record = await lifecycle.reserve({ provenance: action ? { kind: 'approved', actionId: action.id } : { kind: 'direct', classification: 'read' }, conversationId, runId, command, logId: log.logId })
    } catch (failure) {
      if (log) logs.release?.(log.logId)
      if (action) await journal.cancel(action.id).catch(() => {})
      throw fail(failure?.code === 'PROCESS_LIMIT' ? 'PROCESS_LIMIT' : 'PROCESS_FAILED')
    }
    // Preparation that fails after the reservation (journal claim, creating the folder) ends it as failed: nothing was
    // sent, so nothing is left "starting" (M2-R15-004).
    let claimed = false
    try {
      if (action) { await journal.claim(action.id); claimed = true }
      if (!folder.exists) await createFolder(folder.absolute)
    } catch (failure) {
      await lifecycle.failed(record.startId).catch(() => {})
      logs.release?.(log.logId)
      if (action) await (claimed ? journal.finish(action.id, 'failed') : journal.cancel(action.id)).catch(() => {})
      throw fail(['PATH_NOT_ALLOWED', 'NOT_FOUND'].includes(failure?.code) ? failure.code : 'PROCESS_FAILED')
    }
    let started, receiving = null
    const stillAllowed = async () => (await checkFolder(typeof cwd === 'string' ? cwd : '').catch(() => null))?.absolute === folder.absolute ? null : 'PATH_NOT_ALLOWED'
    try { started = await host.invokeHost('najd.process.start', { command, cwd: folder.absolute, log: log.file, env: envFor() }, 20000, { signal, check: stillAllowed, onDispatch: instance => { receiving = instance } }) }
    catch (failure) {
      const refused = failure?.dispatched === false || failure?.toolError && REFUSED.has(failure.code)
      // Tied to the process that received it before anything else is awaited (M2-R26-001).
      if (!refused && !failure?.hostTerminated && Number.isInteger(receiving)) unknownStarts.set(record.startId, receiving)
      // The host was ended after the request was sent: whatever it started ended with its jobs. The record ends as
      // stopped; whether the command did something first stays unknown in the journal and the error (M2-R24-002).
      await (refused ? lifecycle.failed(record.startId) : failure?.hostTerminated ? lifecycle.stopped(record.startId) : lifecycle.unknown(record.startId)).catch(() => {})
      if (action) await journal.finish(action.id, refused ? 'failed' : false).catch(() => {})
      if (!refused) throw Object.assign(uncertain(record, log), failure?.hostTerminated ? { familyClosed: true } : {})
      throw fail(failure?.code === 'CANCELLED' ? 'CANCELLED' : ['INVALID_INPUT', 'PROCESS_LIMIT', 'NOT_FOUND', 'NOT_CONNECTED', 'ADMIN_NOT_ALLOWED', 'PATH_NOT_ALLOWED'].includes(failure?.code) ? failure.code : 'PROCESS_FAILED')
    }
    if (started?.contained !== true || typeof started.id !== 'string') {
      // The host must confirm containment; otherwise stop it and report an uncertain outcome.
      // Kept reachable by its host id so it can still be stopped, and deletion waits for it (M2-R24-002).
      if (typeof started?.id === 'string') untracked.set(record.startId, started.id)
      if (Number.isInteger(receiving)) unknownStarts.set(record.startId, receiving)
      const stoppedUncontained = typeof started?.id === 'string' ? await host.invokeHost('najd.process.stop', { id: started.id }).catch(() => null) : null
      if (stoppedUncontained?.familyClosed === true) { untracked.delete(record.startId); await lifecycle.stopped(record.startId).catch(() => {}) }
      else await lifecycle.unknown(record.startId).catch(() => {})
      if (action) await journal.finish(action.id, false).catch(() => {})
      throw uncertain(record, log)
    }
    try { await lifecycle.confirm(record.startId, { hostId: started.id, pid: started.pid, created: started.created, contained: true }) }
    catch {
      // It ran but could not be recorded. Stopping it does not undo what it already did, so the outcome is unknown;
      // the host identity is kept for this session so it can still be listed and stopped (M2-R4-001).
      untracked.set(record.startId, started.id)
      if (Number.isInteger(receiving)) unknownStarts.set(record.startId, receiving)
      const stopped = await host.invokeHost('najd.process.stop', { id: started.id }).catch(() => null)
      // Seen closed: the record ends as stopped (what it did before stays unknown in the journal and the error); the host
      // id is dropped only once that is saved. Otherwise it stays unknown and stoppable (M2-R9-004).
      if (stopped?.familyClosed === true) { if (await lifecycle.stopped(record.startId).then(() => true, () => false)) untracked.delete(record.startId) }
      else await lifecycle.unknown(record.startId).catch(() => {})
      if (action) await journal.finish(action.id, false).catch(() => {})
      throw Object.assign(uncertain(record, log), { familyClosed: stopped?.familyClosed === true })
    }
    // It is running: a journal that cannot be saved does not hide that (M2-R5-003).
    let journalWarning = false
    if (action) await journal.finish(action.id, true).catch(() => { journalWarning = true })
    return { status: 'started', id: record.startId, logId: log.logId, contained: true, ...(journalWarning ? { journalWarning: true } : {}),
      note: 'Running in the background. Read its output with najd_process_output; stop it with najd_process_stop.' }
  }

  // Refreshes this session's live records from the host; liveness follows the whole job family (M2-R06).
  async function refresh() {
    await settleUnknown()
    const running = (await lifecycle.list({ sessionOnly: true })).filter(record => record.state === 'running')
    const memory = [...unsaved.values()].filter(record => record.state === 'running')
    if (!running.length && !memory.length) return
    let hosted = null
    try { hosted = host.isRunning?.() === false ? [] : await host.invokeHost('najd.process.list', {}) } catch { hosted = null }
    if (!Array.isArray(hosted)) return // unknown right now; keep the records as they are
    for (const record of memory) {
      const live = hosted.find(item => item.id === record.hostId)
      if (!live || !live.running) Object.assign(record, { state: 'exited', exitCode: live ? live.exitCode : null })
    }
    for (const record of running) {
      const live = hosted.find(item => item.id === record.hostId)
      if (!live) await lifecycle.exited(record.startId, null).catch(() => {}) // the host ended, and its jobs ended with it
      else if (!live.running) await lifecycle.exited(record.startId, live.exitCode).catch(() => {})
    }
  }

  return {
    available,
    start,
    // This conversation's commands; earlier sessions are listed with how they ended (M2-R14) but cannot be read or stopped.
    async list(_args, { conversationId = null } = {}) {
      await refresh()
      const records = [...await lifecycle.list({ conversationId: conversationId || null }), ...[...unsaved.values()].filter(record => record.conversationId === (conversationId || null))]
      // Everything of this session that may still run is always listed; finished history is limited to the newest 20
      // and what was left out is counted (M2-R7-004).
      const live = records.filter(record => record.sessionId === lifecycle.sessionId && ['starting', 'running', 'unknown'].includes(record.state))
      const history = records.filter(record => !live.includes(record))
      const shown = [...live, ...history.slice(-20)]
      return { processes: shown.map(record => ({ id: record.startId, command: record.command, state: record.state, exitCode: record.exitCode,
          // Earlier-session records keep their logId so their saved output can still be read (not controlled) (M2-R23-001).
          ...(record.sessionId !== lifecycle.sessionId ? { previousSession: true } : {}), ...(record.logId ? { logId: record.logId } : {}) })),
        ...(history.length > 20 ? { olderHistoryOmitted: history.length - 20 } : {}) }
    },
    async output({ id, tail }, { conversationId = null, maxBytes = 8192 } = {}) {
      const record = typeof id === 'string' ? await getRecord(id) : null
      if (!sameConversation(record, conversationId) || !record.logId) throw fail('NOT_FOUND')
      await refresh()
      const page = await logs.tail({ logId: record.logId, conversationId, lines: Number.isInteger(tail) && tail > 0 ? tail : 40, maxBytes })
      const current = await getRecord(id)
      return { id, state: current.state, exitCode: current.exitCode, output: page.text, lines: page.lines, logId: record.logId, totalBytes: page.totalBytes,
        // Whenever something is not shown (earlier lines, a shortened line, or nothing fitting the budget), the full
        // output can be paged from the start of the retained log (M2-R3-003).
        ...(page.truncated ? { earlierOutput: { logId: record.logId, offset: 0, shownFrom: page.startOffset, ...(page.lineTruncated ? { lineTruncated: true } : {}),
          note: 'Not all output is shown; page it with najd_log_read from offset.' } } : {}) }
    },
    // Deleting a conversation first ends the commands it started in this session, since nothing else could reach
    // them afterwards. Returns how many could not be shown closed; the conversation is then kept (M2-R13-002).
    async endConversation(conversationId) {
      await refresh()
      const records = [...await lifecycle.list({ sessionOnly: true, conversationId: conversationId || null }),
        ...[...unsaved.values()].filter(record => record.conversationId === (conversationId || null))]
      let open = 0
      for (const record of records) {
        // A start still in progress (no host answer recorded yet) may yet run: it blocks deletion (M2-R14-001).
        if (record.state === 'starting' && !untracked.has(record.startId)) { open++; continue }
        // A start whose outcome is unknown and that NAJD cannot reach may still run: it blocks deletion until it is
        // shown closed (M2-R24-002).
        if (record.state === 'unknown' && !untracked.has(record.startId) && !unsaved.has(record.startId)) { open++; continue }
        const reachable = record.state === 'running' || untracked.has(record.startId) || (unsaved.has(record.startId) && unsaved.get(record.startId).state === 'running')
        if (!reachable) continue
        const result = await this.stop({ id: record.startId }, { conversationId }).catch(() => null)
        if (result?.familyClosed !== true) open++
      }
      return { open }
    },
    // A Python run whose family was not seen closed after its timeout or cancellation becomes a background process of
    // this session and conversation, so it can be listed, read and stopped again (M2-R5-002).
    // If saving fails, it is still addressable for this session (M2-R6-001).
    async adopt({ hostId, pid, created, logId, conversationId = null, runId = null, actionId, instance = null }) {
      if (typeof hostId !== 'string' || typeof actionId !== 'string') throw fail('INVALID_INPUT')
      let record
      try { record = await lifecycle.reserve({ provenance: { kind: 'approved', actionId }, conversationId, runId, command: 'Python run (stopping)', logId }) }
      catch {
        const id = 'unsaved-' + require('node:crypto').randomUUID()
        if (Number.isInteger(instance)) unknownStarts.set(id, instance)
        unsaved.set(id, { startId: id, sessionId: lifecycle.sessionId, conversationId: conversationId || null, command: 'Python run (stopping)', logId: logId || null,
          hostId, state: 'running', exitCode: null })
        return id
      }
      try { await lifecycle.confirm(record.startId, { hostId, pid, created, contained: true }) }
      catch { untracked.set(record.startId, hostId); if (Number.isInteger(instance)) unknownStarts.set(record.startId, instance); await lifecycle.unknown(record.startId).catch(() => {}) }
      return record.startId
    },
    // Ends only a process NAJD started in this session for this conversation (a direct effect on NAJD's own work).
    // It is recorded as stopped only when the host confirms its whole family closed; otherwise the host keeps tracking
    // it and the stop can be repeated (M2-R4-002).
    async stop({ id }, { conversationId = null, signal } = {}) {
      const record = typeof id === 'string' ? await getRecord(id) : null
      if (!sameConversation(record, conversationId)) throw fail('NOT_FOUND')
      await refresh()
      const current = await getRecord(id)
      const hostId = current.state === 'running' ? current.hostId : untracked.get(id)
      // Nothing left to stop: a family that ended (seen by refresh or an earlier stop) is reported closed (M2-R14-002).
      if (!hostId) return { id, status: current.state, ...(['exited', 'stopped', 'ended-with-session'].includes(current.state) ? { familyClosed: true } : {}) }
      let result
      try { result = await host.invokeHost('najd.process.stop', { id: hostId }, 20000, { signal }) }
      catch (failure) { if (failure?.code !== 'NOT_FOUND') throw fail(failure?.code === 'CANCELLED' ? 'CANCELLED' : 'PROCESS_FAILED') }
      if (result && result.familyClosed !== true)
        return { id, status: 'stopping', familyClosed: false, note: 'Termination was requested but is not confirmed yet; check najd_process_list or stop it again.' }
      unknownStarts.delete(id)
      if (unsaved.has(id)) { unsaved.delete(id); untracked.delete(id); return { id, status: 'stopped', familyClosed: true } }
      // Closed: the record ends as stopped whatever it said before (running, starting or unknown). Whether the command
      // had already done something stays recorded in the action journal. If saving fails, the host id is kept so the
      // stop can be repeated (M2-R8-003).
      const wasUncertain = current.state !== 'running'
      try { await lifecycle.stopped(id) } catch { untracked.set(id, hostId); return { id, status: 'stopped', familyClosed: true, recordWarning: true } }
      untracked.delete(id)
      return { id, status: 'stopped', familyClosed: true, ...(wasUncertain ? { effectUnknown: true, note: 'It is stopped; what it did before stopping is not known.' } : {}) }
    }
  }
}
module.exports = { createProcessTools }
