// Closing the main window quits NAJD even while the desktop pet is shown (UI crawl 2026-11-09: the pet window kept the app running
// with no way to reach it). Isolated test profile; nothing of the owner's is touched.
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { launch, stop, evaluate, waitFor } = require('./electron-ui-smoke.cjs')

async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'najd-desktop-test-'))
  const instance = await launch(root)
  try {
    await waitFor(async () => await evaluate(instance.client, 'document.querySelector("[data-shell=workstation]")?.dataset.renderer === "vue"'), 60000)
    const turned = await instance.client.send('Runtime.evaluate', { expression: '(async () => { const s = await window.najdWorkstation.systemSet({ pet: true }); return !!s.pet })()', awaitPromise: true, returnByValue: true })
    if (turned.result?.value !== true) throw new Error('the desktop pet did not turn on: ' + JSON.stringify(turned.exceptionDetails?.exception?.description || turned.result).slice(0, 300))
    await new Promise(resolve => setTimeout(resolve, 1500))
    const began = Date.now()
    await stop(instance) // closes the main window and requires a normal exit within 30 s
    console.log('PASS: with the desktop pet shown, closing the main window quit NAJD normally in ' + Math.round((Date.now() - began) / 1000) + ' s.')
  } finally { await fs.rm(root, { recursive: true, force: true }).catch(() => {}) }
}
main().catch(error => { console.error('FAIL:', error.message); process.exit(1) })
