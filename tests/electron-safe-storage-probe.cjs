// T40 diagnostic: inspect safeStorage state in an isolated userData dir.
// Usage: NAJD_PROBE_DIR=<abs path> NAJD_PROBE_MODE=<write|read> node tests/electron-safe-storage-probe.cjs
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { app, safeStorage } = require('electron')

const root = path.resolve(process.env.NAJD_PROBE_DIR || '')
if (!root.startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Probe dir must be inside the OS temp dir')
app.setPath('userData', root)
app.setPath('sessionData', root)

app.whenReady().then(async () => {
  const file = path.join(root, 'probe.json')
  const report = {
    backend: safeStorage.getSelectedStorageBackend ? safeStorage.getSelectedStorageBackend() : 'n/a',
    syncAvailable: safeStorage.isEncryptionAvailable(),
    asyncAvailable: await safeStorage.isAsyncEncryptionAvailable()
  }
  if (process.env.NAJD_PROBE_MODE === 'write') {
    const encrypted = await safeStorage.encryptStringAsync('sk-kimi-kill-probe')
    fs.writeFileSync(file, JSON.stringify({ version: 1, kimiCode: encrypted.toString('base64') }))
    const sync = safeStorage.encryptString('sync-probe')
    fs.writeFileSync(file + '.sync', sync.toString('base64'))
    report.wrote = true
    const waitMs = Number(process.env.NAJD_PROBE_WAIT_MS || 0)
    if (waitMs > 0) {
      console.log('PROBE ' + JSON.stringify(report))
      setTimeout(() => { console.log('PROBE wait-done'); app.exit(0) }, waitMs)
      return
    }
  } else {
    try {
      const record = JSON.parse(fs.readFileSync(file, 'utf8'))
      const { result } = await safeStorage.decryptStringAsync(Buffer.from(record.kimiCode, 'base64'))
      report.asyncDecrypt = result
    } catch (error) { report.asyncDecryptError = String(error) }
    try {
      report.syncDecrypt = safeStorage.decryptString(Buffer.from(fs.readFileSync(file + '.sync', 'utf8'), 'base64'))
    } catch (error) { report.syncDecryptError = String(error) }
    try {
      const localState = JSON.parse(fs.readFileSync(path.join(root, 'Local State'), 'utf8'))
      report.localStateOsCrypt = Object.keys(localState.os_crypt || {})
      report.appBound = !!localState.os_crypt?.app_bound_encrypted_key
    } catch (error) { report.localStateError = String(error) }
  }
  console.log('PROBE ' + JSON.stringify(report))
  app.exit(0)
})
