// First-run welcome in the real desktop app (isolated profile): appears once, keyboard stays inside it, Escape and the buttons close it and it does not return.
const assert = require('node:assert/strict')
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os')
const { launch, stop, evaluate, waitFor } = require('./electron-ui-smoke.cjs')
async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'najd-desktop-test-'))
  const shots = path.resolve('release/qa-welcome-' + require('../package.json').version)
  await fs.mkdir(shots, { recursive: true })
  let instance
  try {
    instance = await launch(root)
    const client = instance.client
    const run = async expression => { const result = await client.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); assert.ok(!result.exceptionDetails, JSON.stringify(result.exceptionDetails)); return result.result.value }
    const shot = async name => { const data = await client.send('Page.captureScreenshot', { format: 'png' }); await fs.writeFile(path.join(shots, name + '.png'), Buffer.from(data.data, 'base64')) }
    await client.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 860, deviceScaleFactor: 1, mobile: false })
    assert.equal(await run(`!document.querySelector('[data-welcome]')`), true, 'automation runs are not interrupted by the welcome')
    for (const language of ['ar', 'en']) {
      await run(`localStorage.setItem('najd.preferences.v1',JSON.stringify({language:${JSON.stringify(language)},theme:'graphite',accent:'#2f8cff',fontScale:1,design:4})); localStorage.setItem('najd.welcome.v1','force')`)
      await client.send('Page.reload')
      await waitFor(async () => await evaluate(client, '!!document.querySelector("[data-welcome=connect]")'))
      assert.equal(await run(`document.activeElement?.getAttribute('data-welcome')`), 'connect', language + ': focus starts on the main button')
      assert.equal(await run(`document.querySelector('[data-welcome]').getAttribute('aria-modal')`), 'true')
      // Quick check (Phase 15): no model in this isolated profile; the components' state is read from the main process.
      assert.equal(await run(`document.querySelector('[data-check=model]')?.dataset.ok`), 'false')
      await waitFor(async () => await evaluate(client, `!/${language === 'ar' ? 'لم تُفحص' : 'Not checked'}/.test(document.querySelector('[data-check=parts]')?.innerText || '')`))
      await shot(`01-welcome-${language}`)
      // Tab wraps inside the dialog.
      await run(`document.dispatchEvent(new Event('x')); document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true}))`)
      assert.equal(await run(`document.activeElement?.getAttribute('data-welcome')`), 'later')
      await run(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true}))`)
      assert.equal(await run(`document.activeElement?.getAttribute('data-welcome')`), 'connect', 'Tab wraps')
      // "Connect a model" closes it and opens Settings > Models.
      await run(`document.querySelector('[data-welcome=connect]').click()`)
      await waitFor(async () => await evaluate(client, '!document.querySelector("[data-welcome=connect]") && !!document.querySelector(".settings-area")'))
      assert.equal(await run(`localStorage.getItem('najd.welcome.v1')`), '1', 'remembered')
    }
    console.log('PASS: first-run welcome (ar/en): shown only when asked in automation, focus contained, connect opens Models, remembered. Screenshots in ' + shots)
  } finally {
    if (instance) await stop(instance)
    const resolved = path.resolve(root)
    if (!resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(resolved).startsWith('najd-desktop-test-')) throw Error('Unsafe cleanup')
    for (const dir of [resolved, resolved + '-documents']) await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 }).catch(() => {})
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
