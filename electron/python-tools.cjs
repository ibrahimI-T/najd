// najd_python_run (docs/AGENT-PLATFORM-M2-PLAN.md, M2b): runs model-written Python with the managed engine's
// interpreter only (never a system Python), after an in-chat approval that shows the complete code (M2-R01). It runs
// inside the desktop host's Job object, so timeout, cancellation or a crash end Python and anything it started
// (M2-R05). Journaled (prepare → decide → claim → finish), 120 s limit, scrubbed environment, bounded excerpt with the
// full output in an owned log, and files created in the working folder reported as outputs.
const fsp = require('node:fs/promises')
const path = require('node:path')
const { createHash, randomUUID } = require('node:crypto')
const fail = code => Object.assign(new Error(code), { code })
const sha = value => createHash('sha256').update(value).digest('hex')
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
// The approval card shows up to 4,000 characters; longer code is refused rather than partly shown (M2-R01).
const TIMEOUT_MS = 120000, MAX_CODE = 4000
// Host answers that prove the command never ran; anything else after dispatch may have run (M2-R2-003).
const NOT_STARTED = new Set(['INVALID_INPUT', 'PROCESS_LIMIT', 'START_REFUSED', 'CANCELLED', 'WINDOWS_NODE_NOT_INSTALLED', 'NOT_CONNECTED', 'ADMIN_NOT_ALLOWED', 'PATH_NOT_ALLOWED'])

// Files under the working folder, breadth first and bounded (depth and entries); links and junctions are not
// followed. complete is false when a bound was reached, so the result says discovery was partial (M2-R2-004).
const MAX_DEPTH = 4, MAX_ENTRIES = 2000
async function listFiles(directory) {
  const files = new Map()
  let seen = 0, complete = true
  const queue = [[directory, 0]]
  while (queue.length) {
    const [folder, depth] = queue.shift()
    // A folder or file that cannot be inspected makes the inventory incomplete rather than silently smaller (M2-R27-002).
    const entries = await fsp.readdir(folder, { withFileTypes: true }).catch(() => { complete = false; return [] })
    for (const entry of entries) {
      if (++seen > MAX_ENTRIES) return { files, complete: false }
      const full = path.join(folder, entry.name)
      if (entry.isDirectory()) { if (depth + 1 < MAX_DEPTH) queue.push([full, depth + 1]); else complete = false; continue }
      if (!entry.isFile()) continue
      const stat = await fsp.lstat(full).catch(() => { complete = false; return null })
      if (stat?.isFile()) files.set(full, stat.mtimeMs + ':' + stat.size)
    }
  }
  return { files, complete }
}
// Files created or changed since the snapshot (at most 20 listed).
async function changedFiles(directory, before) {
  const after = await listFiles(directory)
  const changed = [...after.files.keys()].filter(name => before.files.get(name) !== after.files.get(name))
  return { files: changed.slice(0, 20), filesComplete: before.complete && after.complete && changed.length <= 20 }
}
const quote = value => "'" + String(value).replace(/'/g, "''") + "'"
// NAJD's fixed bootstrap for runs with the Office and design pack (M3-004): the approved script stays unchanged and
// is compiled on its own by runpy, so __future__ imports, __file__, __name__ == '__main__', exit codes and tracebacks
// behave as when it runs directly. Paths arrive as arguments, never formatted into code.
// The NAJD Office kit (najd_office, M3-7) is added after the pack so the model can import it.
const BOOTSTRAP = 'import runpy, site, sys\npack, kit, script = sys.argv[1], sys.argv[2], sys.argv[3]\nsite.addsitedir(pack)\nif kit:\n    sys.path.append(kit)\nsys.argv = [script]\nrunpy.run_path(script, run_name="__main__")\n'

// adopt: hands a Python family that could not be seen closed to the background-process records, so it stays listable
// and stoppable (M2-R5-002); returns its process id.
// pack: the Office and design pack (office-pack.cjs) or null; a run with a ready pack holds a lease on it until the
// host reports the run's job closed (M3-003).
function createPythonTools({ getPython, host, checkFolder, createFolder, stateRoot, logs, journal, timeoutMs = TIMEOUT_MS, hostReady = async () => true, adopt = null, pack = null, kitPath = '' }) {
  if (typeof getPython !== 'function' || typeof host?.invokeHost !== 'function' || typeof checkFolder !== 'function' || !path.isAbsolute(stateRoot || '')) throw fail('INVALID_INPUT')
  // Private folders kept for families not seen closed: folder -> host job id (M2-R6-003).
  const retained = new Map()
  return {
    available: async () => !!await getPython().catch(() => null) && await hostReady().catch(() => false),
    async run({ code, cwd }, { requestApproval, signal, conversationId = null, runId = null, maxBytes = 8192 }) {
      if (typeof code !== 'string' || !code.trim() || code.includes('\0')) throw fail('INVALID_INPUT')
      if (code.length > MAX_CODE) return { status: 'refused', error: 'CODE_TOO_LONG', note: `Keep each run under ${MAX_CODE} characters so the user can see all of it; split the work or write a file first and run it.` }
      const python = await getPython().catch(() => null)
      if (!python) throw fail('RUNTIME_NOT_READY')
      const folder = await checkFolder(typeof cwd === 'string' ? cwd : '')
      if (typeof requestApproval !== 'function') throw fail('PERMISSION_DENIED')
      const action = journal ? await journal.prepare({ intentId: sha(randomUUID()).slice(0, 48), operation: 'python.run',
        target: ('Python in ' + folder.absolute).replace(/[\x00-\x1f]+/g, ' ').slice(0, 1000), changeHash: sha(JSON.stringify([folder.absolute, code])) }) : null
      let decision
      try { decision = await requestApproval('najd-python-run', { path: folder.absolute, cwd: folder.absolute,
        summary: 'Run this Python code on your computer (120 s limit)' + (folder.exists ? '' : '; its folder will be created') + '. It can read and change files the program can reach.' +
          (pack?.describe().state === 'ready' ? ' Office and design pack: available.' : ''), preview: code }) }
      catch (failure) { if (action) await journal.cancel(action.id).catch(() => {}); throw failure }
      if (decision !== 'ALLOW_ONCE') { if (action) await journal.decide(action.id, action.nonce, 'DENY'); return { status: 'denied_by_user', note: 'The code was not run.' } }
      if (action) await journal.decide(action.id, action.nonce, 'ALLOW_ONCE')
      if (signal?.aborted) { if (action) await journal.cancel(action.id); throw fail('CANCELLED') }
      // The folder must still be allowed, and be the same folder, now that the code is about to run (M2-R14-003).
      const still = await checkFolder(typeof cwd === 'string' ? cwd : '').catch(() => null)
      if (!still || still.absolute !== folder.absolute) { if (action) await journal.cancel(action.id).catch(() => {}); throw fail('PATH_NOT_ALLOWED') }
      // A private folder in protected application data holds the script and the interpreter's own state. A folder kept
      // for a family not seen closed is removed only once the host no longer runs that family; folders left by earlier
      // sessions (whose host and jobs ended with them) are removed a day later (M2-R6-003).
      const runs = path.join(stateRoot, 'python-runs')
      let hosted = null
      if (retained.size) { const list = await host.invokeHost('najd.process.list', {}).catch(() => null); hosted = Array.isArray(list) ? list : null }
      for (const entry of await fsp.readdir(runs, { withFileTypes: true }).catch(() => [])) {
        const old = path.join(runs, entry.name)
        if (!entry.isDirectory()) continue
        if (retained.has(old)) {
          if (hosted && !hosted.some(item => item.id === retained.get(old) && item.running)) { await fsp.rm(old, { recursive: true, force: true }).catch(() => {}); retained.delete(old) }
          continue
        }
        if (Date.now() - ((await fsp.stat(old).catch(() => null))?.mtimeMs ?? Date.now()) > 86400000) await fsp.rm(old, { recursive: true, force: true }).catch(() => {})
      }
      const home = path.join(runs, randomUUID())
      const script = path.join(home, 'main.py')
      // Every step before the code is sent is one unit: if any fails, nothing ran, so the journal entry is cancelled
      // (or finished as failed once claimed) and the private folder and log are released (M2-R15-004, M2-R16-003).
      let claimed = false, before, log = null, lease = null
      try {
        await fsp.mkdir(path.join(home, 'Roaming'), { recursive: true }); await fsp.mkdir(path.join(home, 'Local'), { recursive: true })
        await fsp.writeFile(script, code)
        lease = pack ? await pack.acquire().catch(() => null) : null
        if (lease) await fsp.writeFile(path.join(home, 'najd_bootstrap.py'), BOOTSTRAP)
        if (action) { await journal.claim(action.id); claimed = true }
        if (!folder.exists) await createFolder(folder.absolute)
        before = await listFiles(folder.absolute)
        log = logs.createExternal({ conversationId, runId, kind: 'python' })
      } catch (failure) {
        lease?.release()
        await fsp.rm(home, { recursive: true, force: true }).catch(() => {})
        if (log) logs.release?.(log.logId)
        if (action) await (claimed ? journal.finish(action.id, 'failed') : journal.cancel(action.id)).catch(() => {})
        throw fail(['PATH_NOT_ALLOWED', 'NOT_FOUND'].includes(failure?.code) ? failure.code : 'RUNTIME_NOT_READY')
      }
      const env = { HOME: home, USERPROFILE: home, APPDATA: path.join(home, 'Roaming'), LOCALAPPDATA: path.join(home, 'Local'), TEMP: home, TMP: home,
        PYTHONUTF8: '1', PYTHONDONTWRITEBYTECODE: '1', PYTHONIOENCODING: 'utf-8', PYTHONNOUSERSITE: '1',
        // Charts render without a display, and matplotlib's font cache stays in the run's private folder.
        MPLBACKEND: 'Agg', MPLCONFIGDIR: path.join(home, 'mpl') }
      const launch = lease ? quote(path.join(home, 'najd_bootstrap.py')) + ' ' + quote(lease.sitePackages) + ' ' + quote(kitPath || '') + ' ' + quote(script) : quote(script)
      // -I ignores PYTHON* variables, so UTF-8 mode is set with -X utf8: output in any language is written as UTF-8,
      // which the host decodes as UTF-8 (M2-R6-002).
      let started, receiving = null
      try { started = await host.invokeHost('najd.process.start', { command: '& ' + quote(python) + ' -I -B -X utf8 ' + launch, cwd: folder.absolute, log: log.file, env, timeoutMs }, 20000,
        { signal, onDispatch: instance => { receiving = instance }, check: async () => (await checkFolder(typeof cwd === 'string' ? cwd : '').catch(() => null))?.absolute === folder.absolute ? null : 'PATH_NOT_ALLOWED' }) }
      catch (failure) {
        await fsp.rm(home, { recursive: true, force: true }).catch(() => {})
        const refused = failure?.dispatched === false || failure?.toolError && NOT_STARTED.has(failure.code)
        // A run that never started gives its lease back; one that may have run keeps it for this session.
        if (refused) lease?.release()
        if (action) await journal.finish(action.id, refused ? 'failed' : false).catch(() => {})
        // It may have run: its output stays addressable (M2-R5-006).
        if (!refused) throw Object.assign(fail('PROCESS_FAILED'), { effectUnknown: true, logId: log.logId, ...await changedFiles(folder.absolute, before) })
        throw fail(failure?.code === 'CANCELLED' ? 'CANCELLED' : ['PROCESS_LIMIT', 'NOT_CONNECTED', 'ADMIN_NOT_ALLOWED', 'PATH_NOT_ALLOWED'].includes(failure?.code) ? failure.code : 'RUNTIME_NOT_READY')
      }
      lease?.bind(started.id)
      // Wait for the whole family to end, bounded; timeout or cancellation terminates the job (M2-R05).
      let outcome = 'running', exitCode = null
      // The host ends the job at the deadline itself; this later local deadline only covers a host that stopped
      // answering (M2-R16-002).
      const deadline = Date.now() + timeoutMs + 10000
      while (outcome === 'running') {
        if (signal?.aborted) { outcome = 'cancelled'; break }
        if (Date.now() > deadline) { outcome = 'timeout'; break }
        await sleep(200)
        const list = await host.invokeHost('najd.process.list', {}, 20000, { signal }).catch(() => null)
        const live = Array.isArray(list) ? list.find(item => item.id === started.id) : null
        if (live?.timedOut) { outcome = 'timeout' }
        else if (live && !live.running) { outcome = 'finished'; exitCode = live.exitCode }
        else if (Array.isArray(list) && !live) { outcome = 'lost' }
      }
      // A job the host no longer lists was closed (the host forgets a job only after its family closed, and a host
      // that went away took its jobs with it).
      let familyClosed = true, processId = null
      if (outcome === 'timeout' || outcome === 'cancelled') familyClosed = (await host.invokeHost('najd.process.stop', { id: started.id }).catch(() => null))?.familyClosed === true
      else if (outcome === 'finished') await host.invokeHost('najd.process.stop', { id: started.id }).catch(() => {}) // release the finished job
      // A family not seen closed stays NAJD's: it is listed with the background processes and can be stopped again;
      // its private folder is kept until then (M2-R5-002).
      if (!familyClosed && typeof adopt === 'function')
        processId = await adopt({ hostId: started.id, pid: started.pid, created: started.created, logId: log.logId, conversationId, runId, actionId: action?.id || null, instance: receiving }).catch(() => null)
      // The pack is released once the family is closed; an adopted family keeps it until the host stops running it.
      if (familyClosed) { lease?.release(); logs.finished?.(log.logId) }
      if (familyClosed) await fsp.rm(home, { recursive: true, force: true }).catch(() => {})
      else retained.set(home, started.id)
      // A run stopped by timeout or cancellation may have changed things already: its effect is unknown.
      // Files it produced are reported in every case, after it has stopped (M2-R2-004).
      const changed = await changedFiles(folder.absolute, before)
      // The outcome is reported even when the journal cannot be saved (M2-R5-003).
      let journalWarning = false
      const record = async outcomeValue => { if (action) await journal.finish(action.id, outcomeValue).catch(() => { journalWarning = true }) }
      if (outcome !== 'finished') {
        await record(false)
        // Its effect is unknown; its output stays readable through logId (M2-R4-003).
        throw Object.assign(fail(outcome === 'cancelled' ? 'CANCELLED' : outcome === 'timeout' ? 'TIMEOUT' : 'PROCESS_FAILED'),
          { effectUnknown: true, familyClosed, logId: log.logId, ...(processId ? { startId: processId } : {}), ...(journalWarning ? { journalWarning: true } : {}), ...changed })
      }
      await record(exitCode === 0 ? true : 'failed')
      // The run is over: failing to read its output must not hide that it ran, its exit code or its files (M2-R7-003).
      const page = await logs.read({ logId: log.logId, offset: 0, conversationId, maxBytes }).catch(failure => ({ failed: failure?.code || 'READ_FAILED' }))
      const output = page.failed ? { output: '', outputUnavailable: page.failed, note: 'The output could not be read now; try najd_log_read with logId.' }
        : { output: page.text, truncated: page.nextOffset !== null, totalBytes: page.totalBytes, nextOffset: page.nextOffset }
      return { status: 'finished', exitCode, ...output, logId: log.logId, ...changed, ...(journalWarning ? { journalWarning: true } : {}) }
    }
  }
}
module.exports = { createPythonTools }
