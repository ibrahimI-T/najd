// Real NAJD desktop host (M2c): background commands run contained in a Job object. Covers output to the owned log,
// stop of the whole family, a descendant started by the command, and abrupt death of the host (which must end
// every process it contained). Uses only temporary folders and processes this test starts itself.
// Usage: node tests/process-host-smoke.cjs   (needs the host built: node scripts/build-windows-node.cjs)
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { createWindowsNode } = require('../electron/windows-node.cjs')
const { createExecLogs } = require('../electron/exec-logs.cjs')

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const alive = pid => { try { process.kill(pid, 0); return true } catch { return false } }
async function waitFor(check, ms = 10000) { for (const end = Date.now() + ms; Date.now() < end;) { if (await check()) return true; await sleep(200) } return false }
const ps = script => execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', windowsHide: true }).trim()

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'najd-process-host-'))
  const node = createWindowsNode({ runtimeRoot: path.resolve(__dirname, '../.runtimes'), stateRoot: path.join(root, 'state'), testHooks: true })
  const pids = []
  try {
    // 1. Output reaches the owned log; stop ends the command.
    const log1 = path.join(root, 'one.log')
    const one = await node.invokeProcess('najd.process.start', { command: "1..600 | ForEach-Object { 'tick ' + $_; Start-Sleep -Milliseconds 100 }", cwd: root, log: log1 })
    assert.equal(one.contained, true); pids.push(one.pid)
    assert.ok(await waitFor(() => fs.existsSync(log1) && /tick 3/.test(fs.readFileSync(log1, 'utf8'))), 'output reached the log')
    const listed = await node.invokeProcess('najd.process.list', {})
    assert.equal(listed.find(item => item.id === one.id).running, true)
    const stopped = await node.invokeProcess('najd.process.stop', { id: one.id })
    assert.equal(stopped.familyClosed, true)
    assert.ok(await waitFor(() => !alive(one.pid)), 'stopped command ended')
    await assert.rejects(node.invokeProcess('najd.process.stop', { id: one.id }), { code: 'NOT_FOUND' })

    // 1b. A command that finishes on its own is listed as ended with its exit code (read through NAJD's own handle).
    const quick = await node.invokeProcess('najd.process.start', { command: "'done'; exit 3", cwd: root, log: path.join(root, 'quick.log') })
    let ended = null
    assert.ok(await waitFor(async () => { ended = (await node.invokeProcess('najd.process.list', {})).find(item => item.id === quick.id); return ended && !ended.running }), 'finished command listed')
    assert.equal(ended.exitCode, 3); assert.equal(ended.rootExited, true)
    await node.invokeProcess('najd.process.stop', { id: quick.id })

    // 1b2. PowerShell failures end with a nonzero code; a clean command ends with 0 (M2-R8-002).
    const exitOf = async command => {
      const run = await node.invokeProcess('najd.process.start', { command, cwd: root, log: path.join(root, 'exit-' + Math.random().toString(36).slice(2) + '.log') })
      let item = null
      assert.ok(await waitFor(async () => { item = (await node.invokeProcess('najd.process.list', {})).find(entry => entry.id === run.id); return item && !item.running }), 'finished: ' + command)
      await node.invokeProcess('najd.process.stop', { id: run.id })
      return item.exitCode
    }
    assert.notEqual(await exitOf("Write-Error 'failed'"), 0)
    assert.notEqual(await exitOf("throw 'boom'"), 0)
    assert.equal(await exitOf("'fine'"), 0)
    assert.equal(await exitOf("cmd /c exit 4"), 4)

    // 1b3. Cancelling a task sends "cancel" to the host: whether it lands during a request or just after one, the host
    // answers, keeps running and keeps serving; background commands are not affected (M2-R11-002).
    for (let i = 0; i < 5; i++) {
      const controller = new AbortController()
      const listing = node.invokeHost('najd.process.list', {}, 5000, { signal: controller.signal })
      setImmediate(() => controller.abort())
      const outcome = await listing.then(value => Array.isArray(value) ? 'answered' : 'odd', error => error.code)
      assert.ok(['answered', 'CANCELLED'].includes(outcome), outcome)
    }
    assert.ok(Array.isArray(await node.invokeProcess('najd.process.list', {})), 'the host still serves after cancels')
    // Deterministic: a start held just before its effect (test pause) and cancelled meanwhile does not run, and the
    // host keeps serving (M2-R12-001).
    const heldMarker = path.join(root, 'held-should-not-exist.txt')
    const holdController = new AbortController()
    const held = node.invokeHost('najd.process.start', { command: "'ran' | Set-Content -LiteralPath '" + heldMarker.replace(/'/g, "''") + "'", cwd: root,
      log: path.join(root, 'held.log'), testPauseMs: 2000 }, 20000, { signal: holdController.signal })
    setTimeout(() => holdController.abort(), 400)
    await assert.rejects(held, error => error.code === 'CANCELLED' && error.toolError === true)
    await sleep(1500)
    assert.equal(fs.existsSync(heldMarker), false, 'the cancelled start did not run')
    assert.ok(Array.isArray(await node.invokeProcess('najd.process.list', {})), 'the host still serves')

    // 1c. The environment arrives as a native block: a long value works, only what NAJD sent (plus what Windows
    // needs) is present, and the host's own variables (such as DOTNET_ROOT) are not inherited (M2-R3-006).
    const log3 = path.join(root, 'env.log')
    const long = 'L'.repeat(7900)
    const envRun = await node.invokeProcess('najd.process.start', { cwd: root, log: log3, env: { NAJD_SMOKE: 'ok', NAJD_LONG: long },
      command: "'smoke=' + $env:NAJD_SMOKE; 'long=' + $env:NAJD_LONG.Length; 'host=' + [string]$env:DOTNET_ROOT; 'root=' + [bool]$env:SystemRoot" })
    assert.ok(await waitFor(async () => !(await node.invokeProcess('najd.process.list', {})).find(item => item.id === envRun.id).running), 'env command finished')
    const envText = fs.readFileSync(log3, 'utf8')
    assert.match(envText, /smoke=ok/); assert.match(envText, /long=7900/); assert.match(envText, /host=\r?\n/); assert.match(envText, /root=True/)
    await node.invokeProcess('najd.process.stop', { id: envRun.id })

    // 1d. Output past 5 MB is trimmed by the host while NAJD reads it: pages never break characters, offsets only
    // move forward, the kept part starts on a whole character and the newest output is kept (M2-R3-001/002).
    const logs = createExecLogs({ directory: path.join(root, 'logs') })
    const big = logs.createExternal({ conversationId: 'smoke', kind: 'process' })
    const bigRun = await node.invokeProcess('najd.process.start', { cwd: root, log: big.file,
      command: "$row = ('😀مرحبا' * 900); for ($i = 0; $i -lt 700; $i++) { 'row ' + $i + ' ' + $row }; 'END'" })
    let offset = 0, previous = -1, pages = 0
    for (let running = true; running;) {
      running = !!(await node.invokeProcess('najd.process.list', {})).find(item => item.id === bigRun.id)?.running
      for (let page; (page = await logs.read({ logId: big.logId, offset, conversationId: 'smoke' })) && page.nextOffset !== null; pages++) {
        assert.ok(!page.text.includes('\ufffd'), 'no broken characters while trimming')
        assert.ok(page.offset >= previous, 'offsets move forward'); previous = page.offset; offset = page.nextOffset
        if (pages % 200 === 199) break
      }
    }
    const meta = JSON.parse(fs.readFileSync(big.file + '.meta', 'utf8'))
    assert.ok(meta.trimmedBefore > 0 && meta.pending === undefined, 'trimmed and finished: ' + JSON.stringify(meta))
    const kept = fs.readFileSync(big.file)
    assert.notEqual(kept[0] & 0xc0, 0x80, 'the kept part starts on a whole character')
    assert.ok(kept.length <= 5 * 1024 * 1024, 'the log ends within its bound (M2-R4-005)')
    const lastPage = await logs.tail({ logId: big.logId, conversationId: 'smoke', lines: 1 })
    assert.equal(lastPage.text, 'END')
    await node.invokeProcess('najd.process.stop', { id: bigRun.id })

    // 2. A descendant the command starts is inside the job too; abrupt host death ends both.
    const log2 = path.join(root, 'two.log')
    const two = await node.invokeProcess('najd.process.start', { cwd: root, log: log2,
      command: "$child = Start-Process -FilePath powershell.exe -ArgumentList '-NoProfile','-Command','Start-Sleep 120' -WindowStyle Hidden -PassThru; 'child ' + $child.Id; Start-Sleep 120" })
    pids.push(two.pid)
    assert.ok(await waitFor(() => /child \d+/.test(fs.existsSync(log2) ? fs.readFileSync(log2, 'utf8') : '')), 'child started')
    const childPid = Number(/child (\d+)/.exec(fs.readFileSync(log2, 'utf8'))[1]); pids.push(childPid)
    assert.ok(alive(two.pid) && alive(childPid))
    // Find the host this test started (a direct child of this Node process) and kill it without a tree kill.
    const hostPid = Number(ps(`(Get-CimInstance Win32_Process | Where-Object { $_.ParentProcessId -eq ${process.pid} -and $_.CommandLine -like '*Najd.WindowsNode.dll*' } | Select-Object -First 1).ProcessId`))
    assert.ok(hostPid > 0, 'host process found')
    execFileSync('taskkill', ['/PID', String(hostPid), '/F'], { windowsHide: true, stdio: 'ignore' })
    assert.ok(await waitFor(() => !alive(two.pid) && !alive(childPid), 15000), 'abrupt host death ended the command and its descendant')
    // 3b. Shutdown while a start is held before its effect: the request is cancelled and the host exits (M2-R12-003).
    const closing = createWindowsNode({ runtimeRoot: path.resolve(__dirname, '../.runtimes'), stateRoot: path.join(root, 'state-closing'), testHooks: true })
    await closing.invokeProcess('najd.process.list', {})
    const closingMarker = path.join(root, 'closing-should-not-exist.txt')
    const inFlight = closing.invokeHost('najd.process.start', { command: "'ran' | Set-Content -LiteralPath '" + closingMarker.replace(/'/g, "''") + "'", cwd: root,
      log: path.join(root, 'closing.log'), testPauseMs: 2000 })
    await sleep(400)
    await closing.stop()
    await assert.rejects(inFlight)
    await sleep(2000)
    assert.equal(fs.existsSync(closingMarker), false, 'nothing ran after the shutdown'); assert.equal(closing.isRunning(), false)

    // 4. A request queued when the companion is disconnected neither starts the host nor runs (M2-R5-001).
    const later = createWindowsNode({ runtimeRoot: path.resolve(__dirname, '../.runtimes'), stateRoot: path.join(root, 'state-later') })
    const marker = path.join(root, 'should-not-exist.txt')
    const queued = later.invokeHost('najd.process.start', { command: "'ran' | Set-Content -LiteralPath '" + marker.replace(/'/g, "''") + "'", cwd: root, log: path.join(root, 'queued.log') })
    later.stop()
    await assert.rejects(queued, error => error.code === 'CANCELLED' && error.dispatched === false)
    await sleep(1500)
    assert.equal(fs.existsSync(marker), false); assert.equal(later.isRunning(), false)
    console.log('Process host smoke passed: owned log, family stop, exit codes (including PowerShell failures), cancel without ending the host, environment block, trimming while reading, descendant containment, abrupt host death and disconnect of queued requests.')
  } finally {
    await node.stop().catch(() => {})
    for (const pid of pids) if (alive(pid)) { try { execFileSync('taskkill', ['/PID', String(pid), '/F'], { stdio: 'ignore' }) } catch {} }
    // A file can stay locked briefly by an exiting process or antivirus; leftovers in TEMP are not a test failure.
    try { fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 }) } catch (error) { console.warn('cleanup left', root, error.code) }
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
