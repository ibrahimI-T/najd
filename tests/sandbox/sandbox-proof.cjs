// Clean-recipient installer proof in Windows Sandbox (disposable; never touches the real installation).
// Usage: node tests/sandbox/sandbox-proof.cjs clean|upgrade [from] [to]
// Writes results to .runtimes/sandbox-proof/<mode>-<time>/ and waits for the Sandbox run to finish.
const fs = require('node:fs'), path = require('node:path'), { spawn } = require('node:child_process')
const project = path.resolve(__dirname, '../..')
const [mode = 'clean', from = '0.8.2', to = require('../../package.json').version] = process.argv.slice(2)
if (!['clean', 'upgrade'].includes(mode)) throw new Error('mode must be clean or upgrade')
for (const v of mode === 'upgrade' ? [from, to] : [to]) fs.accessSync(path.join(project, 'release', v, `NAJD-AGENT-Setup-${v}.exe`))
const out = path.join(project, '.runtimes', 'sandbox-proof', `${mode}-${new Date().toISOString().replace(/[:.]/g, '-')}`)
fs.mkdirSync(out, { recursive: true })
// Map hard links to just the installers, never the whole release folder (a mapped folder stays locked
// while the Sandbox runs, which blocks the next build).
const installers = out + '-installers' // outside the writable results mapping
for (const v of mode === 'upgrade' ? [from, to] : [to]) {
  const name = `NAJD-AGENT-Setup-${v}.exe`; fs.mkdirSync(path.join(installers, v), { recursive: true })
  fs.linkSync(path.join(project, 'release', v, name), path.join(installers, v, name))
}
const map = (host, guest, readOnly) => `<MappedFolder><HostFolder>${host}</HostFolder><SandboxFolder>${guest}</SandboxFolder><ReadOnly>${readOnly}</ReadOnly></MappedFolder>`
const wsb = `<Configuration>
<Networking>Disable</Networking><vGPU>Disable</vGPU><MemoryInMB>8192</MemoryInMB>
<MappedFolders>${map(installers, 'C:\\najd\\release', true)}${map(__dirname, 'C:\\najd\\scripts', true)}${map(out, 'C:\\najd\\out', false)}</MappedFolders>
<LogonCommand><Command>powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\\najd\\scripts\\run-in-sandbox.ps1 -Mode ${mode} -From ${from} -To ${to}</Command></LogonCommand>
</Configuration>`
const file = path.join(out, 'najd-proof.wsb'); fs.writeFileSync(file, wsb)
console.log('results:', out)
const wsbExe = path.join(process.env.LOCALAPPDATA, 'Microsoft', 'WindowsApps', 'wsb.exe')
const command = `powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\\najd\\scripts\\run-in-sandbox.ps1 -Mode ${mode} -From ${from} -To ${to}`
// wsb.exe is an app execution alias: existsSync reports false for it, lstat does not.
const hasWsb = () => { try { fs.lstatSync(wsbExe); return true } catch { return false } }
const sleep = ms => new Promise(r => setTimeout(r, ms))
// Preferred: the wsb CLI (start, open the session window, wait for the user session, run the script).
// The .wsb LogonCommand path is the fallback; it sometimes never runs on this host.
async function launch() {
  if (!hasWsb()) return spawn('cmd.exe', ['/c', 'start', '', file], { detached: true, stdio: 'ignore' }).unref()
  const { execFileSync } = require('node:child_process')
  const id = execFileSync(wsbExe, ['start', '--config', wsb.replace(/<LogonCommand>[\s\S]*<\/LogonCommand>/, '')], { encoding: 'utf8' }).match(/[0-9a-f-]{36}/)[0]
  spawn(wsbExe, ['connect', '--id', id], { detached: true, stdio: 'ignore' }).unref()
  for (let i = 0; i < 60; i++) {
    try { execFileSync(wsbExe, ['exec', '--id', id, '-r', 'ExistingLogin', '-c', 'cmd.exe /c exit 0'], { stdio: 'ignore' }); break } catch { await sleep(5000) }
  }
  spawn(wsbExe, ['exec', '--id', id, '-r', 'ExistingLogin', '-c', command], { detached: true, stdio: 'ignore' }).unref()
}
// Close the disposable Sandbox when done (wsb.exe ships with the Store version of Windows Sandbox).
function stopSandboxes(quiet) {
  if (!hasWsb()) return quiet || console.log('finished; close the Sandbox window')
  const { execFileSync } = require('node:child_process')
  for (const id of execFileSync(wsbExe, ['list'], { encoding: 'utf8' }).match(/[0-9a-f-]{36}/g) || []) execFileSync(wsbExe, ['stop', '--id', id])
  if (!quiet) console.log('finished; Sandbox closed')
}
stopSandboxes(true); launch()
let started = Date.now(), attempts = 1
const timer = setInterval(() => {
  if (fs.existsSync(path.join(out, 'done.txt'))) { clearInterval(timer); console.log(fs.readFileSync(path.join(out, 'steps.txt'), 'utf8')); stopSandboxes() }
  // Retry a fresh Sandbox if the script never started inside it.
  else if (!fs.existsSync(path.join(out, 'steps.txt')) && Date.now() - started > 6 * 60 * 1000 && attempts < 3) { attempts++; console.log('script did not start; relaunching Sandbox'); stopSandboxes(true); launch(); started = Date.now() }
  else if (Date.now() - started > 60 * 60 * 1000) { clearInterval(timer); console.log('timed out; see', out); process.exitCode = 1 }
}, 5000)
