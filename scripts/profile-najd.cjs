// Profile one packaged NAJD instance (PERF-1).
// Usage: node scripts/profile-najd.cjs --label before|after [--version 0.9.0] [--idle 180]
// - Isolated profile (--user-data-dir temp) and isolated LOCALAPPDATA component cache; never the owner's data.
// - 1 s Win32_Process poll: ownership registry keyed by (pid, creation time) + sampled CPU; memory gauges every 5 s.
// - Phases: startup, idle-visible, transition-minimize, idle-minimized, transition-restore, task (/apps), shutdown.
//   Only idle-visible, idle-minimized and task are measured; system counters are kept separate.
// - Exit 0 only for a valid run: exact root identity, continuous samples, gateway healthy, visibility held at both
//   phase boundaries, task COMPLETED, fresh exit evidence, no leftovers, owner cache untouched, no recorded problem.
// - Refuses to run while NAJD is already running or another profiler run holds the lock.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os')
const { spawn, execFileSync } = require('node:child_process')
const { preflight } = require('./host-preflight.cjs')
const { connect, waitForPage, freePort } = require('../tests/electron-ui-smoke.cjs')

const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, index, list) => (value.startsWith('--') ? [...pairs, [value.slice(2), list[index + 1]]] : pairs), []))
const project = path.resolve(__dirname, '..')
const version = args.version || require('../package.json').version
const label = (args.label || 'run').replace(/[^a-z0-9-]/gi, '')
const idleSeconds = Number(args.idle || 180)
const root = path.join(project, 'release', version, 'win-unpacked')
const exe = path.join(root, 'NAJD AGENT.exe')
const isolatedLocal = path.join(project, '.runtimes', 'profile', 'localappdata')
const out = path.join(project, '.runtimes', 'profile', `${label}-${new Date().toISOString().replace(/[:.]/g, '-')}`)
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const ncpu = os.cpus().length
const fileTimeToMs = ft => ft / 10000 - 11644473600000
const ps = script => execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', windowsHide: true, timeout: 60000 })

function ownerRuntimeListing() {
  const dir = path.join(process.env.LOCALAPPDATA, 'NAJD AGENT', 'runtime')
  try { return fs.readdirSync(dir).map(name => ({ name, mtime: fs.statSync(path.join(dir, name)).mtime.toISOString() })) } catch { return [] }
}
function componentsReady() {
  const bundle = JSON.parse(fs.readFileSync(path.join(root, 'resources', 'najd-runtime', 'bundle.json'), 'utf8'))
  return bundle.components.every(row => {
    const dir = path.join(isolatedLocal, 'NAJD AGENT', 'runtime', row.id + '-' + Buffer.from(row.sha512, 'base64').toString('hex').slice(0, 12))
    try { return JSON.parse(fs.readFileSync(path.join(dir, '.najd-component.json'), 'utf8')).sha512 === row.sha512 && fs.existsSync(path.join(dir, row.entry)) } catch { return false }
  })
}
// Current creation time of a pid (FILETIME), or null when it no longer exists. Used right before any kill.
function currentCreation(pid) {
  try { const value = ps(`$p = Get-CimInstance Win32_Process -Filter "ProcessId=${Number(pid)}"; if ($p) { $p.CreationDate.ToFileTimeUtc() }`).trim(); return value ? Number(value) : null } catch { return null }
}
// Kill one verified process only (no /T): the pid must still belong to the registered process.
function killVerified(entry) {
  if (currentCreation(entry.pid) !== entry.created) return false
  try { execFileSync('taskkill', ['/PID', String(entry.pid), '/F'], { stdio: 'ignore' }); return true } catch { return false }
}
// Minimize/restore the app's main window as Windows does (Electron's CDP has no window-state domain).
// Acts only on the verified launched process: its creation time must still match.
function windowState(pid, created, action) {
  if (currentCreation(pid) !== created) throw new Error('launched process identity changed')
  const code = action === 'minimize' ? 6 : action === 'restore' ? 9 : 0 // SW_MINIMIZE / SW_RESTORE / query only
  const ok = ps(`Add-Type -Namespace Najd -Name W -MemberDefinition '[DllImport("user32.dll")] public static extern bool ShowWindow(System.IntPtr h, int c); [DllImport("user32.dll")] public static extern bool IsIconic(System.IntPtr h);'; $h = (Get-Process -Id ${Number(pid)}).MainWindowHandle; if ($h -ne 0) { if (${code}) { [void][Najd.W]::ShowWindow($h, ${code}); Start-Sleep -Milliseconds 300 }; 'ok ' + [Najd.W]::IsIconic($h) }`).trim()
  if (!ok.startsWith('ok ')) throw new Error('main window not found for ' + action)
  return ok.slice(3) === 'True'
}
// Electron role from the command line (--type=renderer|gpu-process|utility …); no --type means the main process.
function roleOf(commandLine) {
  const type = /--type=([a-z-]+)/.exec(commandLine || '')?.[1]
  if (!type) return 'main'
  const sub = /--utility-sub-type=([\w.]+)/.exec(commandLine)?.[1]
  return sub ? `${type}:${sub.split('.').at(-1)}` : type
}

const MONITOR = `
$ErrorActionPreference = 'SilentlyContinue'
$i = 0
while ($true) {
  $t0 = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  $p = @(Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,CreationDate,Name,KernelModeTime,UserModeTime,WorkingSetSize,PrivatePageCount,HandleCount,ThreadCount)
  # A failed or empty snapshot is reported as such; it must never look like "every process exited".
  if ($p.Count -lt 2) { [Console]::Out.WriteLine((@{ t = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds(); err = 1 } | ConvertTo-Json -Compress)); [Console]::Out.Flush(); $i++; Start-Sleep -Milliseconds 1000; continue }
  $rows = @(foreach ($x in $p) { ,@($x.ProcessId, $x.ParentProcessId, $(if ($x.CreationDate) { $x.CreationDate.ToFileTimeUtc() } else { 0 }), $x.Name, ([int64]$x.KernelModeTime + [int64]$x.UserModeTime), [int64]$x.WorkingSetSize, [int64]$x.PrivatePageCount, $x.HandleCount, $x.ThreadCount) })
  $line = @{ t = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds(); t0 = $t0; p = $rows }
  if ($i % 5 -eq 0) {
    $c = (Get-Counter '\\Memory\\Pool Nonpaged Bytes','\\Memory\\Pool Paged Bytes','\\Memory\\Available MBytes','\\Memory\\Committed Bytes').CounterSamples
    $line.s = @([int64]$c[0].CookedValue, [int64]$c[1].CookedValue, [int64]$c[2].CookedValue, [int64]$c[3].CookedValue)
  }
  [Console]::Out.WriteLine(($line | ConvertTo-Json -Compress -Depth 4))
  [Console]::Out.Flush()
  $i++
  Start-Sleep -Milliseconds 1000
}`

async function main() {
  const gate = preflight()
  console.log(`preflight: available ${gate.availableMB} MB, commit ${Math.round(gate.ratio * 100)}% -> ${gate.ok ? 'OK' : 'BLOCKED'}`)
  if (!gate.ok) { console.error('Host preflight failed: ' + gate.reasons.join('; ')); process.exitCode = 1; return }
  if (!fs.existsSync(exe)) throw new Error('Packaged build not found: ' + exe)
  fs.mkdirSync(out, { recursive: true })
  const ownerBefore = ownerRuntimeListing()

  const registry = new Map() // `${pid}@${created}` -> entry
  const system = [] // [t, systemHandles, nonpaged, paged, availableMB, committed]
  const phases = [], notes = {}, problems = [], ambiguous = []
  let monitor = null, monitorExited = false, monitorStopping = false, child = null, rootPid = null, lines = 0
  let alive = new Map(), aliveAt = 0, profile = null, client = null, failure = null, failedSnapshots = 0, rootFallbackKill = false
  let rootCreated = null, childExited = false, lockFile = null
  const sampleTimes = [], unproven = [], unprovenSeen = new Map() // key -> snapshots in which it was seen
  const mark = name => { const now = Date.now(); if (phases.length) phases.at(-1).end = now; phases.push({ name, start: now }) }
  const resolveRoles = () => {
    const pending = [...registry.values()].filter(entry => entry.name === 'NAJD AGENT.exe' && !entry.role && alive.has(entry.key))
    if (!pending.length) return
    try {
      const rows = JSON.parse(ps(`@(Get-CimInstance Win32_Process -Filter "${pending.map(entry => 'ProcessId=' + entry.pid).join(' or ')}" | Select-Object ProcessId, CommandLine, @{n='C';e={$_.CreationDate.ToFileTimeUtc()}}) | ConvertTo-Json -Compress`) || '[]')
      for (const row of [].concat(rows)) { const entry = registry.get(row.ProcessId + '@' + row.C); if (entry) entry.role = roleOf(row.CommandLine) }
    } catch {}
  }

  try {
    // One profiler run at a time (shared isolated cache), and exactly one NAJD instance: refuse, never close it.
    fs.mkdirSync(path.dirname(isolatedLocal), { recursive: true })
    const lockPath = path.join(path.dirname(isolatedLocal), 'profile.lock')
    try { fs.writeFileSync(lockPath, String(process.pid), { flag: 'wx' }); lockFile = lockPath }
    catch { throw new Error('another profiler run holds ' + lockPath + ' (remove it only if no run is active)') }
    const running = ps(`@(Get-Process -Name 'NAJD AGENT' -ErrorAction SilentlyContinue).Count`).trim()
    if (running !== '0') throw new Error(`NAJD is already running (${running} process(es)); close it before profiling`)

    if (!componentsReady()) {
      console.log('Preparing the isolated component cache (one time, not profiled)...')
      fs.mkdirSync(isolatedLocal, { recursive: true })
      // Bounded; on timeout only the exact spawned process is stopped (through its live handle).
      const code = await new Promise(resolve => {
        const prep = spawn(exe, ['--najd-prepare-runtime', '--silent'], { env: { ...process.env, LOCALAPPDATA: isolatedLocal }, stdio: 'ignore' })
        const timer = setTimeout(() => { problems.push('component preparation exceeded 15 minutes'); try { prep.kill() } catch {} }, 15 * 60 * 1000)
        prep.once('exit', value => { clearTimeout(timer); resolve(value) })
        prep.once('error', () => { clearTimeout(timer); resolve(-1) })
      })
      if (code !== 0 || !componentsReady()) throw new Error('Isolated component cache could not be prepared (exit ' + code + ')')
    }

    // ---- monitor: ownership registry and samples ----
    monitor = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', MONITOR], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] })
    const onMonitorEnd = () => { if (!monitorStopping && !monitorExited) problems.push('process monitor stopped unexpectedly'); monitorExited = true }
    monitor.once('exit', onMonitorEnd)
    monitor.once('error', onMonitorEnd)
    let buffer = ''
    monitor.stdout.setEncoding('utf8')
    monitor.stdout.on('data', chunk => {
      buffer += chunk
      let index
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index).trim(); buffer = buffer.slice(index + 1)
        if (!line) continue
        let sample; try { sample = JSON.parse(line) } catch { continue }
        lines++
        if (sample.err || !Array.isArray(sample.p) || !sample.p.length) { failedSnapshots++; continue }
        // t0 is taken before the (non-atomic) enumeration: a process listed in this snapshot was alive at some
        // moment >= t0, so t0 is the only safe "seen alive" time for ancestry proofs.
        const t = sample.t, t0 = sample.t0 || 0, rows = sample.p
        alive = new Map(rows.map(row => [row[0] + '@' + row[2], row])); aliveAt = t
        sampleTimes.push(t)
        const pid4 = rows.find(row => row[0] === 4)
        if (sample.s) system.push([t, pid4 ? pid4[7] : null, ...sample.s])
        for (const entry of registry.values()) if (alive.has(entry.key)) entry.lastSeen = t0
        if (rootPid && rootCreated && !registry.size) {
          const row = rows.find(r => r[0] === rootPid && r[2] === rootCreated)
          if (row) { const key = row[0] + '@' + row[2]; registry.set(key, { key, pid: row[0], created: row[2], createdMs: fileTimeToMs(row[2]), name: row[3], parent: null, firstSeen: t, lastSeen: t0, cpu: [], mem: [] }) }
        }
        // A child is owned only with proof: a registered process with its parent pid, created before it, was
        // still seen alive at or after the child's creation. A live process's pid cannot be reused, so no
        // other process can have held that pid in between. Anything unprovable stays unowned (never killed).
        let added = true
        while (added && registry.size) {
          added = false
          for (const row of rows) {
            const key = row[0] + '@' + row[2]
            if (registry.has(key) || !row[2]) continue
            const createdMs = fileTimeToMs(row[2])
            const candidates = [...registry.values()].filter(entry => entry.pid === row[1] && entry.createdMs <= createdMs)
            const parents = candidates.filter(entry => entry.lastSeen >= createdMs)
            if (parents.length === 1) { registry.set(key, { key, pid: row[0], created: row[2], createdMs, name: row[3], parent: parents[0].key, firstSeen: t, lastSeen: t0, cpu: [], mem: [] }); added = true }
            else if (parents.length > 1 && !ambiguous.includes(key)) ambiguous.push(key)
            else if (!parents.length && candidates.length && !unproven.includes(key)) unproven.push(key)
          }
        }
        for (const key of unproven) if (!registry.has(key) && alive.has(key)) unprovenSeen.set(key, (unprovenSeen.get(key) || 0) + 1)
        for (const entry of registry.values()) {
          const row = alive.get(entry.key)
          if (!row) continue
          entry.cpu.push([t, row[4]])
          if (sample.s) entry.mem.push([t, row[5], row[6], row[7], row[8]])
        }
      }
    })
    for (let i = 0; i < 30 && lines === 0 && !monitorExited; i++) await sleep(500)
    if (!lines) throw new Error('process monitor did not start')

    // Resources can change while preparing: check again right before the measured launch.
    const second = preflight()
    if (!second.ok) throw new Error('Host preflight failed before launch: ' + second.reasons.join('; '))

    profile = fs.mkdtempSync(path.join(os.tmpdir(), 'najd-profile-user-'))
    const port = await freePort()
    mark('startup')
    child = spawn(exe, ['--user-data-dir=' + profile, '--remote-debugging-port=' + port], { env: { ...process.env, LOCALAPPDATA: isolatedLocal }, stdio: 'ignore' })
    child.once('error', error => { failure = failure || error })
    child.once('exit', () => { childExited = true })
    rootPid = child.pid
    // Node holds the child's process handle until its exit is processed, so this pid cannot be reused yet:
    // the creation time read now is the exact identity of the process we spawned.
    rootCreated = rootPid ? currentCreation(rootPid) : null
    if (!rootCreated) throw new Error('could not establish the launched process identity')
    const page = await waitForPage(port)
    client = await connect(page.webSocketDebuggerUrl)
    const ev = async expression => {
      const result = await client.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || 'evaluate failed')
      return result.result?.value
    }
    let gateway
    for (let i = 0; i < 180; i++) { gateway = await ev('window.najdGateway.status()'); if (['healthy', 'failed', 'not_installed'].includes(gateway?.state)) break; await sleep(1000) }
    notes.startupSeconds = (Date.now() - phases[0].start) / 1000
    notes.gateway = gateway?.state + (gateway?.errorCode ? ' ' + gateway.errorCode : '')
    if (gateway?.state !== 'healthy') problems.push('gateway not healthy at startup: ' + notes.gateway)
    resolveRoles()

    // Measured idle phases cover only the confirmed state; transitions are separate, labelled phases.
    // The app's own view: page visibility combined with the main-process window state (najdWindow).
    const visibility = () => ev("document.visibilityState === 'visible' && !(window.najdWindow && window.najdWindow.isHidden()) ? 'visible' : 'hidden'")
    const waitVisibility = async wanted => { for (let i = 0; i < 20; i++) { if (await visibility() === wanted) return true; await sleep(500) } return false }
    mark('idle-visible')
    notes.visibleState = await visibility()
    await sleep(idleSeconds * 1000)
    notes.visibleStateEnd = await visibility()
    if (notes.visibleState !== 'visible' || notes.visibleStateEnd !== 'visible') problems.push(`idle-visible phase was not visible throughout: ${notes.visibleState} → ${notes.visibleStateEnd}`)
    resolveRoles()

    mark('transition-minimize')
    // The minimized phase is defined by the OS window state (IsIconic) at both boundaries, so builds with and
    // without the app's own window-state signal are measured under the same condition. The app's view is noted.
    notes.iconicAfterMinimize = windowState(rootPid, rootCreated, 'minimize')
    await waitVisibility('hidden') // give the app up to 10 s to react; not required
    const hidden = windowState(rootPid, rootCreated, 'query')
    mark('idle-minimized')
    notes.minimizedState = hidden ? 'hidden' : 'visible'
    notes.appViewMinimized = await visibility()
    await sleep(idleSeconds * 1000)
    notes.minimizedStateEnd = windowState(rootPid, rootCreated, 'query') ? 'hidden' : 'visible'
    notes.appViewMinimizedEnd = await visibility()
    if (notes.minimizedState !== 'hidden' || notes.minimizedStateEnd !== 'hidden') problems.push(`idle-minimized phase was not hidden throughout: ${notes.minimizedState} → ${notes.minimizedStateEnd}`)
    mark('transition-restore')
    windowState(rootPid, rootCreated, 'restore')
    const restoreStart = Date.now()
    // A restored window may sit behind other windows; Chromium then reports it occluded ("hidden"), which
    // correctly keeps polling paused. Restore is proven by the main-process window state instead.
    let restored = false
    for (let i = 0; i < 20 && !restored; i++) { restored = await ev('!(window.najdWindow && window.najdWindow.isHidden())'); if (!restored) await sleep(500) }
    notes.restoredVisible = restored
    notes.restoreSeconds = (Date.now() - restoreStart) / 1000
    notes.restorePage = await ev("document.visibilityState + '/' + (window.najdWindow ? window.najdWindow.isHidden() : 'n/a')")
    if (!notes.restoredVisible) problems.push('main process still reports the window hidden after restore: ' + notes.restorePage)
    await sleep(1500)

    // Tool task in short CDP calls; Node polls with explicit deadlines.
    mark('task')
    const taskId = await ev("window.najdCore.startTask('/apps', crypto.randomUUID(), 'ollama').then(t => t.id)")
    const taskState = () => ev(`window.najdCore.getTask(${JSON.stringify(taskId)}).then(t => ({ state: t.state, approvalId: t.approvalId, error: t.errorCode }))`)
    let task = await taskState()
    for (let deadline = Date.now() + 60000; ['QUEUED', 'RUNNING'].includes(task.state) && Date.now() < deadline;) { await sleep(500); task = await taskState() }
    if (task.state === 'WAITING_APPROVAL') {
      await ev(`window.najdCore.respondApproval(${JSON.stringify(task.approvalId)}, 'ALLOW_ONCE').then(t => t.state)`)
      task = await taskState()
      for (let deadline = Date.now() + 120000; ['QUEUED', 'RUNNING'].includes(task.state) && Date.now() < deadline;) { await sleep(500); task = await taskState() }
    }
    notes.task = task.state + (task.error ? ':' + task.error : '')
    if (task.state !== 'COMPLETED') problems.push('task did not complete: ' + notes.task)
    resolveRoles()
    await sleep(5000)

    mark('shutdown')
    await client.send('Runtime.evaluate', { expression: 'setTimeout(() => window.close(), 50); true' }).catch(() => {})
  } catch (error) { failure = failure || error }
  finally {
    try { client?.close() } catch {}
    if (!phases.length || phases.at(-1).name !== 'shutdown') mark('shutdown')
    // Shutdown: wait up to 30 s for every registered process to exit, then kill verified leftovers only.
    // "Exited" needs a fresh, successful snapshot taken after the check started (failed snapshots never count).
    const remaining = () => [...registry.values()].filter(entry => alive.has(entry.key))
    const shutdownCheck = Date.now()
    for (const deadline = Date.now() + 30000; Date.now() < deadline && (remaining().length || aliveAt <= shutdownCheck) && !monitorExited;) await sleep(500)
    notes.shutdownEvidenceFresh = aliveAt > shutdownCheck && !monitorExited
    if (!notes.shutdownEvidenceFresh) problems.push('no fresh process snapshot after shutdown; exit of NAJD processes is unproven')
    if (!registry.size && rootPid) {
      problems.push('root process was never registered by the monitor')
      // Only the exact spawned process, through Node's live handle; never by pid alone.
      if (child && !childExited) { try { rootFallbackKill = child.kill() } catch {} }
      if (rootFallbackKill) problems.push('root process needed fallback termination')
    }
    notes.shutdownSeconds = (Date.now() - phases.at(-1).start) / 1000
    notes.leftovers = remaining().map(entry => ({ pid: entry.pid, name: entry.name, role: entry.role || null, killed: killVerified(entry) }))
    phases.at(-1).end = Date.now()
    await sleep(1500)
    monitorStopping = true
    try { monitor?.kill() } catch {}
    try { if (monitor?.pid && !monitorExited) execFileSync('taskkill', ['/PID', String(monitor.pid), '/F'], { stdio: 'ignore' }) } catch {}
    // A profile that cannot be removed (a surviving child or antivirus lock) is kept and reported, never fatal.
    if (profile) try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }) } catch (error) { problems.push(`temporary profile kept (${error.code || error.message}): ${profile}`) }
    if (lockFile) try { fs.unlinkSync(lockFile) } catch {}
  }
  const ownerAfter = ownerRuntimeListing()

  // ---- analysis (also written for a failed run, marked invalid) ----
  const entries = [...registry.values()]
  const keyOf = entry => `${entry.name}${entry.role ? ' (' + entry.role + ')' : ''} #${entry.pid}`
  const report = { label, version, ncpu, idleSeconds, valid: false, failure: failure ? String(failure.message || failure) : null, problems, notes,
    ownerRuntimeUnchanged: JSON.stringify(ownerBefore) === JSON.stringify(ownerAfter), ownerBefore, ownerAfter, ambiguousAncestry: ambiguous, phases: [] }
  const mb = value => Math.round(value / 1048576)
  for (const phase of phases) {
    const seconds = Math.max(1, (phase.end - phase.start) / 1000)
    const perProcess = {}, perRole = {}
    let cpu100ns = 0
    for (const entry of entries) {
      // Only intervals with both snapshots inside the phase count; an interval crossing a boundary is not
      // assigned to either phase (boundary gaps are bounded by the continuity check below). A process
      // created inside the phase contributes its CPU since creation from its first snapshot.
      let previous = null, sum = 0
      for (const [t, value] of entry.cpu) {
        if (t < phase.start) continue
        if (t > phase.end) break
        sum += Math.max(0, previous === null ? (entry.createdMs >= phase.start ? value : 0) : value - previous)
        previous = value
      }
      if (!sum) continue
      cpu100ns += sum
      perProcess[keyOf(entry)] = sum
      const role = entry.name === 'NAJD AGENT.exe' ? 'electron ' + (entry.role || 'unknown') : entry.name
      perRole[role] = (perRole[role] || 0) + sum
    }
    const pct = value => Math.round(value / 1e7 / seconds / ncpu * 1000) / 10
    // Peak: the busiest interval between consecutive successful snapshots (tree total, % of all logical processors).
    const times = sampleTimes.filter(t => t >= phase.start && t <= phase.end)
    let peak = 0
    for (let i = 1; i < times.length; i++) {
      const interval = (times[i] - times[i - 1]) / 1000
      let delta = 0
      for (const entry of entries) {
        const a = entry.cpu.find(([t]) => t === times[i - 1]), b = entry.cpu.find(([t]) => t === times[i])
        if (a && b) delta += Math.max(0, b[1] - a[1])
      }
      if (interval > 0) peak = Math.max(peak, delta / 1e7 / interval / ncpu * 100)
    }
    const gaps = times.slice(1).map((t, i) => t - times[i])
    const memTimes = [...new Set(entries.flatMap(entry => entry.mem.filter(([t]) => t >= phase.start && t <= phase.end).map(([t]) => t)))].sort((a, b) => a - b)
    const totals = memTimes.map(time => entries.reduce((sum, entry) => { const m = entry.mem.find(([t]) => t === time); return m ? { ws: sum.ws + m[1], priv: sum.priv + m[2], handles: sum.handles + m[3], threads: sum.threads + m[4], count: sum.count + 1 } : sum }, { ws: 0, priv: 0, handles: 0, threads: 0, count: 0 }))
    const sys = system.filter(([t]) => t >= phase.start && t <= phase.end)
    const handles = totals.length ? { start: totals[0].handles, end: totals.at(-1).handles, growthPercent: Math.round((totals.at(-1).handles - totals[0].handles) / Math.max(1, totals[0].handles) * 1000) / 10 } : null
    // Per-process handle change inside the phase, so growth names the responsible process.
    const handleDeltas = Object.fromEntries(entries.map(entry => {
      const inPhase = entry.mem.filter(([t]) => t >= phase.start && t <= phase.end)
      return inPhase.length > 1 ? [keyOf(entry), inPhase.at(-1)[3] - inPhase[0][3]] : null
    }).filter(Boolean).filter(([, delta]) => delta !== 0).sort((a, b) => b[1] - a[1]))
    if (handles && phase.name.startsWith('idle') && handles.growthPercent > 5) problems.push(`NAJD handle growth ${handles.growthPercent}% in ${phase.name} (> 5%); largest: ${Object.entries(handleDeltas).slice(0, 3).map(([n, d]) => n + ' +' + d).join(', ')}`)
    // Measured phases need continuous evidence: enough successful snapshots and no long gaps.
    if (['idle-visible', 'idle-minimized', 'task'].includes(phase.name)) {
      const expected = Math.floor(seconds * 0.4) // one snapshot per ~1.5-2 s (CIM query + 1 s pause)
      if (times.length < Math.max(3, expected)) problems.push(`${phase.name}: only ${times.length} process snapshots for ${Math.round(seconds)} s`)
      if (gaps.length && Math.max(...gaps) > 5000) problems.push(`${phase.name}: sampling gap of ${Math.round(Math.max(...gaps) / 1000)} s`)
      if (!totals.length) problems.push(`${phase.name}: no memory samples for the NAJD tree`)
    }
    report.phases.push({ name: phase.name, seconds: Math.round(seconds), cpuPercent: pct(cpu100ns),
      cpuPeakPercent: Math.round(peak * 10) / 10,
      cpuOneCorePercent: Math.round(cpu100ns / 1e7 / seconds * 10000) / 100, snapshots: times.length, handleDeltas,
      cpuByRolePercent: Object.fromEntries(Object.entries(perRole).map(([name, value]) => [name, pct(value)]).sort((a, b) => b[1] - a[1])),
      cpuByProcessPercent: Object.fromEntries(Object.entries(perProcess).map(([name, value]) => [name, pct(value)]).sort((a, b) => b[1] - a[1])),
      workingSetMB: totals.length ? { avg: mb(totals.reduce((s, x) => s + x.ws, 0) / totals.length), peak: mb(Math.max(...totals.map(x => x.ws))) } : null,
      privateMB: totals.length ? { avg: mb(totals.reduce((s, x) => s + x.priv, 0) / totals.length), peak: mb(Math.max(...totals.map(x => x.priv))) } : null,
      handles, threads: totals.length ? { start: totals[0].threads, end: totals.at(-1).threads } : null,
      processes: totals.length ? { min: Math.min(...totals.map(x => x.count)), max: Math.max(...totals.map(x => x.count)) } : null,
      system: sys.length ? { systemHandles: [sys[0][1], sys.at(-1)[1]], nonpagedMB: [mb(sys[0][2]), mb(sys.at(-1)[2])], pagedMB: [mb(sys[0][3]), mb(sys.at(-1)[3])], availableMBMin: Math.min(...sys.map(x => x[4])), committedMB: [mb(sys[0][5]), mb(sys.at(-1)[5])] } : null })
  }
  report.processesSeen = entries.length
  report.withoutCpuSample = entries.filter(entry => entry.cpu.length === 0).map(keyOf)
  if (notes.leftovers?.length) problems.push('leftover processes after shutdown: ' + JSON.stringify(notes.leftovers))
  if (!report.ownerRuntimeUnchanged) problems.push("owner's runtime cache listing changed")
  // Continuity over the whole measured timeline (idle-visible start to task end), boundaries included.
  const measured = phases.filter(phase => ['idle-visible', 'idle-minimized', 'task'].includes(phase.name))
  if (measured.length === 3) {
    const from = measured[0].start, to = measured.at(-1).end
    const points = [from, ...sampleTimes.filter(t => t > from && t < to), to]
    const worst = Math.max(...points.slice(1).map((t, i) => t - points[i]))
    report.maxSamplingGapSeconds = Math.round(worst / 100) / 10
    if (worst > 5000) problems.push(`sampling gap of ${report.maxSamplingGapSeconds} s in the measured timeline`)
    for (const phase of measured) for (const edge of [phase.start, phase.end]) {
      const nearest = Math.min(...sampleTimes.map(t => Math.abs(t - edge)))
      if (!(nearest <= 5000)) problems.push(`${phase.name}: no snapshot within 5 s of a phase boundary`)
    }
  } else problems.push('measured phases incomplete: ' + measured.map(phase => phase.name).join(', '))
  report.failedSnapshots = failedSnapshots
  const stillUnproven = unproven.filter(key => !registry.has(key))
  report.unprovenAncestry = stillUnproven
  // A short-lived unproven process (seen in < 3 snapshots and gone at the end) is only noted; a longer-lived or
  // surviving one means the measured tree may be incomplete, so the run is invalid.
  const significant = stillUnproven.filter(key => (unprovenSeen.get(key) || 0) >= 3 || alive.has(key))
  if (significant.length) problems.push(`ownership incomplete: ${significant.length} long-lived or surviving process(es) with a NAJD parent pid could not be proven NAJD-owned (not measured, not killed): ${significant.join(', ')}`)
  if (failedSnapshots > 3) problems.push(`${failedSnapshots} failed process snapshots`)
  const rootRegistered = entries.some(entry => entry.pid === rootPid && entry.parent === null)
  const scenarioOk = !failure && notes.gateway === 'healthy' && notes.visibleState === 'visible' && notes.visibleStateEnd === 'visible' &&
    notes.minimizedState === 'hidden' && notes.minimizedStateEnd === 'hidden' && notes.task === 'COMPLETED'
  // Every recorded problem invalidates the run; the checks above add problems for weak or missing evidence.
  report.valid = scenarioOk && rootRegistered && !problems.length && !notes.leftovers?.length && report.ownerRuntimeUnchanged
  fs.writeFileSync(path.join(out, 'samples.json'), JSON.stringify({ registry: entries, system, phases }))
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2))
  const cell = (value, fn) => value ? fn(value) : '-'
  const md = [`# NAJD profile: ${label} (${version}) — ${report.valid ? 'VALID' : 'INVALID'}`, '',
    report.failure ? `Failure: ${report.failure}` : '', problems.length ? 'Problems: ' + problems.join('; ') : 'Problems: none', '',
    `Startup to gateway ${notes.gateway}: ${notes.startupSeconds}s. Visibility: "${notes.visibleState}" / minimized "${notes.minimizedState}". Task: ${notes.task}. Shutdown: ${notes.shutdownSeconds}s.`,
    `Owner runtime cache unchanged: ${report.ownerRuntimeUnchanged}. Processes registered: ${report.processesSeen}; without a CPU sample: ${report.withoutCpuSample.length ? report.withoutCpuSample.join(', ') : 'none'}; ambiguous ancestry skipped: ${ambiguous.length}; unproven ancestry: ${report.unprovenAncestry.length ? report.unprovenAncestry.join(', ') : 'none'}.`, '',
    '## NAJD process tree (sampled CPU at 1 s resolution, % of all logical processors; processes living < 1 s and the last second of exiting processes are not measured)', '',
    '| Phase | Seconds | CPU % avg / peak | CPU % of one core | Working set MB avg/peak | Private MB avg/peak | Handles start → end | Processes |', '|---|---|---|---|---|---|---|---|',
    ...report.phases.map(p => `| ${p.name} | ${p.seconds} | ${p.cpuPercent} / ${p.cpuPeakPercent} | ${p.cpuOneCorePercent} | ${cell(p.workingSetMB, v => v.avg + ' / ' + v.peak)} | ${cell(p.privateMB, v => v.avg + ' / ' + v.peak)} | ${cell(p.handles, v => `${v.start} → ${v.end} (${v.growthPercent}%)`)} | ${cell(p.processes, v => v.min + '–' + v.max)} |`), '',
    'Handle changes by process (non-zero):', '', ...report.phases.map(p => `- ${p.name}: ` + (Object.entries(p.handleDeltas).map(([n, d]) => `${n} ${d > 0 ? '+' : ''}${d}`).join(', ') || 'none')), '',
    'CPU by role (%):', '', ...report.phases.map(p => `- ${p.name}: ` + Object.entries(p.cpuByRolePercent).map(([n, v]) => `${n} ${v}`).join(', ')), '',
    '## System context (host kernel counters; not NAJD)', '',
    '| Phase | System (PID 4) handles | Nonpaged MB | Paged MB | Available MB (min) | Committed MB |', '|---|---|---|---|---|---|',
    ...report.phases.map(p => `| ${p.name} | ${cell(p.system, v => v.systemHandles.join(' → '))} | ${cell(p.system, v => v.nonpagedMB.join(' → '))} | ${cell(p.system, v => v.pagedMB.join(' → '))} | ${cell(p.system, v => v.availableMBMin)} | ${cell(p.system, v => v.committedMB.join(' → '))} |`), ''].join('\n')
  fs.writeFileSync(path.join(out, 'report.md'), md)
  console.log(md)
  console.log('\nSaved: ' + out)
  if (!report.valid) process.exitCode = 1
}
main().catch(error => { console.error(error); process.exitCode = 1 })
