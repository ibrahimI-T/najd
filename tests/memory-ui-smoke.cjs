const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { launch, stop, click, evaluate, waitFor } = require('./electron-ui-smoke.cjs')

async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'najd-desktop-test-'))
  let instance
  const marker = 'MEMORY-PRIVATE-ONLY'
  try {
    instance = await launch(root)
    let client = instance.client
    const exists = selector => evaluate(client, `document.querySelector(${JSON.stringify(selector)}) !== null`)
    async function page() {
      if (!await exists('.settings-nav')) await click(client, '.sidebar-link[aria-label]')
      await click(client, '.settings-nav-item:nth-child(8)')
      await waitFor(() => exists('.memory-editor'))
    }
    async function type(selector, text) {
      await waitFor(async () => await exists(selector) && !await evaluate(client, `document.querySelector(${JSON.stringify(selector)}).disabled`))
      await click(client, selector)
      assert.equal(await evaluate(client, `document.activeElement === document.querySelector(${JSON.stringify(selector)})`), true)
      await client.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', modifiers: 2, windowsVirtualKeyCode: 65 })
      await client.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', modifiers: 2, windowsVirtualKeyCode: 65 })
      await client.send('Input.insertText', { text })
      assert.equal(await evaluate(client, `document.querySelector(${JSON.stringify(selector)}).value`), text)
    }
    async function act(name) {
      await waitFor(async () => await exists(`[data-memory="${name}"]`) && !await evaluate(client, `document.querySelector('[data-memory="${name}"]').disabled`))
      await click(client, `[data-memory="${name}"]`)
    }
    await waitFor(() => exists('.sidebar-link[aria-label="الإعدادات"]'))
    await page()
    await waitFor(() => exists('[data-personality=enabled]'))
    // The NAJD soul is enabled by default (owner directive 2026-10-17).
    assert.equal(await evaluate(client, 'document.querySelector("[data-personality=enabled]").checked'), true)
    await type('[data-personality=instructions]', 'PERSONALITY-WARM-FIXTURE: Speak warmly in Saudi Arabic.')
    await click(client, '[data-personality=save]')
    await waitFor(() => exists('.personality-card [role=status]'))
    await type('[data-memory=title]', 'تفضيل محلي')
    await type('[data-memory=text]', marker + ' · original')
    await act('save'); await waitFor(() => exists('.memory-note'))
    await act('edit'); await type('[data-memory=text]', marker + ' · corrected'); await act('save')
    await waitFor(async () => (await evaluate(client, 'document.querySelector(".memory-text").textContent')).includes('corrected'))
    await act('export')
    await waitFor(async () => { try { await fs.access(path.join(root, 'memory-backup.json')); return true } catch { return false } })
    const backup = await fs.readFile(path.join(root, 'memory-backup.json'), 'utf8')
    assert.equal(JSON.parse(backup).notes[0].text, marker + ' · corrected')
    await act('export')
    await waitFor(() => exists('.memory-panel [role=alert]'))
    assert.equal(await fs.readFile(path.join(root, 'memory-backup.json'), 'utf8'), backup)
    await act('edit'); await type('[data-memory=text]', marker + ' · newer correction'); await act('save')
    await waitFor(async () => (await evaluate(client, 'document.querySelector(".memory-text").textContent')).includes('newer correction'))
    await act('import'); await waitFor(() => exists('.memory-panel [role=alert]'))
    assert.ok((await evaluate(client, 'document.querySelector(".memory-text").textContent')).includes('newer correction'))
    await act('delete'); await waitFor(async () => !await exists('.memory-note'))
    await act('import'); await waitFor(() => exists('.memory-note'))
    console.log('PASS: actual Arabic UI create/edit/delete/backup/restore, no-overwrite export and real persisted notes.')

    await stop(instance); instance = null
    instance = await launch(root); client = instance.client
    await waitFor(() => exists('.sidebar-link[aria-label="الإعدادات"]'))
    await page()
    assert.ok((await evaluate(client, 'document.querySelector(".memory-panel").textContent')).includes('corrected'))
    await waitFor(() => exists('[data-personality=enabled]'))
    assert.equal(await evaluate(client, 'document.querySelector("[data-personality=enabled]").checked'), true)
    await act('use')
    await waitFor(() => exists('#prompt'))
    assert.equal(await evaluate(client, 'document.querySelector("#prompt").value'), marker + ' · corrected')
    assert.equal(await evaluate(client, 'document.querySelector(".message-list")'), null)
    // Discard the explicit draft; storing/restoring the note has made no request.
    await click(client, '.new-chat')
    assert.equal(await evaluate(client, 'document.querySelector("#prompt").value'), '')
    const result = await client.send('Runtime.evaluate', { expression: `(async () => {
      await window.najdProviders.saveKey('openai-api','sk-najd-API-TEST-KEY');
      const {policy}=await window.najdProviders.limits();
      await window.najdProviders.setLimits({...policy,maxOutputTokens:1024});
      let task=await window.najdCore.startTask('Explain one simple idea: personality proof',crypto.randomUUID(),'openai-api','gpt-6.1-sol',undefined,'low');
      for(let i=0;i<200&&['QUEUED','RUNNING'].includes(task.state);i++){
        await new Promise(resolve=>setTimeout(resolve,50));task=await window.najdCore.getTask(task.id);
      }
      return {state:task.state,output:task.output,code:task.errorCode};
    })()`, returnByValue: true, awaitPromise: true })
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text)
    assert.deepEqual(result.result.value, { state: 'COMPLETED', output: 'NAJD API test OK', code: null })
    console.log('PASS: memory survives restart; use prepares a draft without sending; unrelated provider request contains no memory.')
    await page(); await click(client, '[data-personality=enabled]'); await click(client, '[data-personality=save]')
    await waitFor(() => exists('.personality-card [role=status]'))
    const disabled = await client.send('Runtime.evaluate', { expression: `(async () => {
      let task=await window.najdCore.startTask('Explain one simple idea: personality disabled proof',crypto.randomUUID(),'openai-api','gpt-6.1-sol',undefined,'low');
      for(let i=0;i<200&&['QUEUED','RUNNING'].includes(task.state);i++){await new Promise(resolve=>setTimeout(resolve,50));task=await window.najdCore.getTask(task.id)}
      return task.state;
    })()`, returnByValue: true, awaitPromise: true })
    assert.equal(disabled.result.value, 'COMPLETED')
    console.log('PASS: editable personality survives restart, reaches selected-provider instructions, and disabling removes it from subsequent requests.')

    await page()
    const screenshots = path.resolve(__dirname, '../release/qa-memory')
    await fs.mkdir(screenshots, { recursive: true })
    for (const language of ['ar', 'en']) {
      await click(client, '.settings-nav-item:first-child')
      await click(client, `.settings-group .setting-row:first-child .segmented button:${language === 'ar' ? 'first' : 'last'}-child`)
      for (const theme of ['dark', 'light']) {
        await click(client, '.settings-nav-item:first-child'); await click(client, `[data-theme=${theme}]`)
        for (const width of [360, 480, 768, 1024, 1440]) {
          await client.send('Emulation.setDeviceMetricsOverride', { width, height: 800, deviceScaleFactor: 1, mobile: false })
          await waitFor(async () => await evaluate(client, `(innerWidth<=680?document.querySelector('.sidebar').getBoundingClientRect().width===0&&Math.abs(document.querySelector('.app-rail').getBoundingClientRect().width-56)<1:Math.abs(document.querySelector('.sidebar').getBoundingClientRect().width-(innerWidth<=1100?228:264))<1)`))
          await page()
          assert.equal(await evaluate(client, `['html','.settings-scroll','.settings-panel'].every(selector=>{const e=document.querySelector(selector);return e.scrollWidth<=e.clientWidth+1})`), true, `${language}/${theme}/${width} memory overflow`)
          if ([360, 1440].includes(width)) {
            await evaluate(client, 'document.querySelector(".settings-scroll").scrollTop=0')
            const capture = await client.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
            await fs.writeFile(path.join(screenshots, `${language}-${theme}-${width}.png`), Buffer.from(capture.data, 'base64'))
          }
        }
      }
    }
    await client.send('Emulation.clearDeviceMetricsOverride')
    await act('delete'); await waitFor(async () => !await exists('.memory-note'))
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(root, 'najd-data/memory.json'), 'utf8')).notes, [])
    console.log('PASS: bilingual memory layout at five requested widths in dark/light; deletion leaves no canonical note.')
    await stop(instance); instance = null
    const primary = path.join(root, 'najd-data/memory.json')
    await fs.writeFile(primary, '{"corrupt":')
    instance = await launch(root); client = instance.client
    await waitFor(() => exists('.sidebar-link[aria-label="Settings"]'))
    await click(client, '.sidebar-link[aria-label="Settings"]'); await click(client, '.settings-nav-item:nth-child(8)')
    await waitFor(() => exists('.memory-panel [role=alert]'))
    assert.equal(await exists('.memory-editor'), false)
    assert.equal(await fs.readFile(primary, 'utf8'), '{"corrupt":')
    console.log('PASS: corrupt memory stays preserved; management UI fails closed without resetting data.')
  } finally {
    if (instance && instance.process.exitCode === null) await stop(instance)
    assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)); assert.match(path.basename(root), /^najd-desktop-test-/)
    await fs.rm(root, { recursive: true, force: true })
  }
}
let completed = false
process.once('beforeExit', () => { if (!completed) { console.error('Memory UI smoke incomplete'); process.exitCode = 1 } })
main().then(() => { completed = true }, error => { completed = true; console.error(error); process.exitCode = 1 })
