const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { spawn, execFile } = require('node:child_process')
const { promisify } = require('node:util')

if (process.versions.electron) {
  const { app } = require('electron')
  const directory = process.env.NAJD_INSTANCE_PROFILE
  if (!directory || !path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(directory).startsWith('najd-instance-')) throw new Error('Invalid fixture')
  app.setPath('userData', directory); app.setPath('sessionData', directory)
  app.once('browser-window-created', (event, window) => window.webContents.once('did-finish-load', () => process.send({ ready: true })))
  process.on('message', message => { if (message === 'stop') app.quit() })
  require('../electron/main.cjs')
} else {
  async function main() {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'najd-instance-'))
    const children = [], timers = []
    function launch() {
      const child = spawn(require('electron'), [__filename], { cwd: path.resolve(__dirname, '..'), windowsHide: true,
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'], env: { ...process.env, NAJD_INSTANCE_PROFILE: directory } })
      const closed = new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve) })
      let observedReady = false
      const ready = new Promise(resolve => child.on('message', value => { if (value.ready) { observedReady = true; resolve() } }))
      const instance = { child, closed, ready, observedReady: () => observedReady }; children.push(instance); return instance
    }
    function deadline(promise, ms) {
      return Promise.race([promise, new Promise((resolve, reject) => timers.push(setTimeout(() => reject(new Error('Instance proof timed out')), ms)))])
    }
    try {
      const first = launch()
      await deadline(first.ready, 30000)
      const second = launch()
      assert.equal(await deadline(second.closed, 10000), 0)
      assert.equal(second.observedReady(), false)
      assert.equal(first.child.exitCode, null)
      first.child.send('stop')
      assert.equal(await deadline(first.closed, 45000), 0)
      console.log('PASS: second source Electron instance exits before services start; primary profile owner stays alive and exits normally.')
    } finally {
      for (const timer of timers) clearTimeout(timer)
      for (const { child } of children) if (child.exitCode === null && child.pid) await promisify(execFile)(path.join(process.env.SystemRoot, 'System32/taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 8000 }).catch(() => {})
      if (children.every(({ child }) => child.exitCode !== null)) await fs.rm(directory, { recursive: true, force: true })
    }
  }
  main().catch(error => { console.error(error); process.exitCode = 1 })
}
