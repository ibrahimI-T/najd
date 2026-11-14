// How an answer is presented in the real desktop app (Vue renderer, isolated profile): Markdown (bold, lists, a table), highlighted code blocks
// with Copy and Open, the composer staying inside the window at the five requested widths in both languages, and no stray footer notes.
// Rewritten for the Vue renderer (docs/OPUS-BLOCKERS.md B-003); the old checks for Mermaid, prompt boxes and the "jump to latest" button belonged to
// the removed React chat and have no Vue counterpart. Usage: npm run smoke:chat
const assert = require('node:assert/strict')
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os')
const { launch, stop, evaluate, click, waitFor } = require('./electron-ui-smoke.cjs')

async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'najd-desktop-test-'))
  let instance
  try {
    instance = await launch(root)
    const client = instance.client
    async function run(expression) {
      const result = await client.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
      assert.ok(!result.exceptionDetails, JSON.stringify(result.exceptionDetails))
      return result.result.value
    }
    const markdown = '**Fixture answer**\n\n- First\n- Second\n\n```html\n<div dir="rtl">NAJD fixture</div>\n```\n\n| Name | Value |\n| --- | --- |\n| Alpha | 1 |\n| Beta | 2 |\n'
    const sessionId = await run(`(async()=>{const s=await window.najdSessions.create();await window.najdSessions.append(s.id,'user','Presentation fixture');await window.najdSessions.append(s.id,'assistant',${JSON.stringify(markdown)});return s.id})()`)
    const ready = () => waitFor(async () => await evaluate(client, 'document.querySelector("[data-shell=workstation]")?.dataset.renderer === "vue" && !!document.querySelector("#prompt")'), 60000)
    await client.send('Page.reload'); await ready()
    for (const language of ['ar', 'en']) {
      if ((await run('document.documentElement.lang')) !== language) {
        await run(`document.querySelector('[data-nav="account"]').click()`)
        await waitFor(async () => await evaluate(client, '!!document.querySelector(".n-account + .w-menu")'))
        await run(`document.querySelector('[data-account-language]').click()`)
        await waitFor(async () => (await run('document.documentElement.lang')) === language)
        await ready()
      }
      await client.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
      // Open the saved conversation from the rail.
      await waitFor(async () => await evaluate(client, '!!document.querySelector(".n-session .n-row")'))
      await click(client, '.n-session .n-row')
      await waitFor(async () => await evaluate(client, '!!document.querySelector(".c-body .code-block")'))
      assert.equal(await evaluate(client, '!!document.querySelector(".c-body strong") && !!document.querySelector(".c-body .c-table table") && document.querySelectorAll(".c-body li").length === 2'), true, language + ': bold, list and table are rendered')
      assert.equal(await evaluate(client, 'document.querySelectorAll(".c-body .c-table tbody tr").length'), 2)
      assert.equal(await evaluate(client, 'document.querySelector(".c-body .code-block").dataset.fence'), 'html')
      assert.ok((await evaluate(client, 'document.querySelector(".c-body .code-block pre").textContent')).includes('NAJD fixture'))
      // The raw HTML of the answer is never injected as markup.
      assert.equal(await evaluate(client, 'document.querySelectorAll(".c-body div[dir=rtl]").length'), 0, 'html in an answer stays text')
      // Copy puts the block's source on the clipboard.
      await run('Object.defineProperty(navigator,"clipboard",{configurable:true,value:{writeText:async text=>{window.__fixtureCopied=text}}})')
      await click(client, '.c-body .code-block [data-copy]')
      await waitFor(async () => (await run('window.__fixtureCopied')) === '<div dir="rtl">NAJD fixture</div>')
      // Save writes the block's exact source to the file chosen in the save dialog (the harness's dialog picks export-fixture.txt).
      await fs.rm(path.join(root, 'export-fixture.txt'), { force: true })
      await click(client, '.c-body .code-block [data-save]')
      await waitFor(async () => { try { return (await fs.readFile(path.join(root, 'export-fixture.txt'), 'utf8')) === '<div dir="rtl">NAJD fixture</div>' } catch { return false } })
      // Open sends the block to the workbench.
      await click(client, '.c-body .code-block [data-open]')
      await waitFor(async () => await evaluate(client, '!!document.querySelector("iframe[sandbox]") || [...document.querySelectorAll("[role=tab]")].some(tab => /html/i.test(tab.textContent))'))
      // No footer notes under the composer.
      assert.equal(await evaluate(client, 'document.querySelectorAll(".composer-note,.composer-info").length'), 0)
      // The composer stays inside the window at every requested width.
      for (const width of [360, 480, 768, 1024, 1440]) {
        await client.send('Emulation.setDeviceMetricsOverride', { width, height: width === 768 ? 600 : 850, deviceScaleFactor: 1, mobile: false })
        await new Promise(resolve => setTimeout(resolve, 250))
        const geometry = await evaluate(client, `(()=>{const c=document.querySelector('[data-composer]').getBoundingClientRect();return {visible:c.bottom<=innerHeight+1&&c.top>=0,inside:c.left>=-1&&c.right<=innerWidth+1,overflow:document.documentElement.scrollWidth>innerWidth+1}})()`)
        assert.deepEqual(geometry, { visible: true, inside: true, overflow: false }, language + ' ' + width + ' ' + JSON.stringify(geometry))
      }
    }
    assert.ok(sessionId)
    console.log('PASS (Vue): saved answer renders bold, list, table and a highlighted code block in both languages; html in an answer stays text; Copy puts the exact source on the clipboard; Save writes it to a file; Open reaches the workbench; no footer notes; the composer stays inside the window at 360, 480, 768, 1024 and 1440 px.')
  } finally {
    if (instance) await stop(instance)
    const resolved = path.resolve(root)
    if (!resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(resolved).startsWith('najd-desktop-test-')) throw Error('Unsafe fixture cleanup')
    await fs.rm(resolved, { recursive: true, force: true })
  }
}
main().catch(e => { console.error(e); process.exitCode = 1 })
