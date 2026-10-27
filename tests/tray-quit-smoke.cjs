// Background mode end to end in a real Electron process (isolated profile): closing the window hides it and keeps NAJD running; "Quit completely" (app.quit, what the tray
// menu calls) then ends the whole process tree in bounded time. Usage: node tests/tray-quit-smoke.cjs
const assert = require('node:assert/strict')
const path = require('node:path'), os = require('node:os'), fs = require('node:fs/promises')
const { spawn, execFile } = require('node:child_process')
const { promisify } = require('node:util')

async function child() {
  const { app, BrowserWindow } = require('electron')
  const directory = process.env.NAJD_TRAY_PROFILE
  assert.ok(directory && path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(directory).startsWith('najd-tray-'))
  app.setPath('userData', directory); app.setPath('sessionData', directory)
  const send = message => { try { process.send(message) } catch {} }
  app.once('browser-window-created', (event, window) => {
    window.webContents.once('did-finish-load', async () => {
      await new Promise(resolve => setTimeout(resolve, Number(process.env.NAJD_TRAY_WAIT) || 3000))
      window.close()
      await new Promise(resolve => setTimeout(resolve, 1500))
      send({ step: 'closed', visible: window.isVisible(), destroyed: window.isDestroyed(), windows: BrowserWindow.getAllWindows().length })
      await new Promise(resolve => setTimeout(resolve, 2500))
      send({ step: 'quitting', at: Date.now() })
      app.quit()
    })
  })
  if (process.env.NAJD_TRAY_HANG === '1') {
    // A service whose stop never finishes: the quit watchdog must still end the process.
    const tools = require('../electron/hermes-tools.cjs'), original = tools.createHermesTools
    tools.createHermesTools = (...args) => ({ ...original(...args), stop: () => new Promise(() => {}) })
  }
  require('../electron/main.cjs')
}

async function parent() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'najd-tray-'))
  let proc, closedInfo = null, quittingAt = null
  // Optional: an already unpacked component cache (copied, never the owner's data) so the engine can run before the quit.
  if (process.env.NAJD_TRAY_RUNTIME_SOURCE) await fs.cp(process.env.NAJD_TRAY_RUNTIME_SOURCE, path.join(directory, 'najd-runtime'), { recursive: true })
  try {
    proc = spawn(require('electron'), [__filename], { cwd: path.resolve(__dirname, '..'), windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'], env: { ...process.env, NAJD_TRAY_PROFILE: directory } })
    proc.on('message', message => { if (message.step === 'closed') closedInfo = message; if (message.step === 'quitting') quittingAt = message.at })
    const exited = new Promise(resolve => proc.once('exit', code => resolve({ code, at: Date.now() })))
    const result = await Promise.race([exited, new Promise(resolve => setTimeout(() => resolve(null), 120000))])
    assert.ok(closedInfo, 'the window close was observed')
    assert.equal(closedInfo.visible, false, 'closing the window hides it')
    assert.equal(closedInfo.destroyed, false, 'the window survives so the app keeps running')
    assert.ok(result, 'the process must exit after "Quit completely" (it was still running 90 s later)')
    console.log(`PASS: closing hid the window and kept NAJD running; quit completely ended the process in ${Math.round((result.at - quittingAt) / 1000)} s (exit code ${result.code}).`)
  } finally {
    if (proc && proc.exitCode === null) await promisify(execFile)(path.join(process.env.SystemRoot, 'System32/taskkill.exe'), ['/PID', String(proc.pid), '/T', '/F']).catch(() => {})
    await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }).catch(() => {})
  }
}
if (process.versions.electron) child().catch(() => { process.exitCode = 1; require('electron').app.quit() })
else parent().catch(error => { console.error(error.message); process.exitCode = 1 })
