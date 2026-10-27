// Real Electron path: attach a PNG through the composer, NAJD decodes and re-encodes it
// with Chromium's codecs, and the selected model (fixture server) receives it as vision input.
const assert = require('node:assert/strict')
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os')
const { launch, stop, evaluate, click, waitFor } = require('./electron-ui-smoke.cjs')
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=='

async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'najd-desktop-test-'))
  await fs.mkdir(root + '-imports')
  await fs.writeFile(path.join(root + '-imports', 'photo.png'), Buffer.from(PNG, 'base64'))
  let instance
  try {
    instance = await launch(root)
    const client = instance.client
    const run = async expression => {
      const result = await client.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
      assert.ok(!result.exceptionDetails, JSON.stringify(result.exceptionDetails)); return result.result.value
    }
    await run(`(async()=>{await window.najdProviders.saveKey('openai-api','sk-najd-API-TEST-KEY');
      const l=await window.najdProviders.limits();await window.najdProviders.setLimits({...l.policy,maxOutputTokens:1024,maxCloudAttempts:100});
      localStorage.setItem('najd.provider.v1','openai-api');localStorage.setItem('najd.models.v2',JSON.stringify({'openai-api':'gpt-6.1-sol'}));return true})()`)
    await client.send('Page.reload')
    await waitFor(async () => await evaluate(client, 'document.querySelector(".composer-models select")?.value==="gpt-6.1-sol"'))
    await click(client, '.attach-button')
    await click(client, '.attachment-popover .model-refresh')
    await waitFor(async () => await evaluate(client, 'document.querySelector(".attachment-chips")?.textContent.includes("photo.png")'), 30000)
    await click(client, '.attach-button')
    await click(client, '#prompt')
    await client.send('Input.insertText', { text: 'image fixture: describe this picture' })
    await click(client, '.send-button')
    await waitFor(async () => await evaluate(client, 'Array.from(document.querySelectorAll(".message.assistant")).some(m=>m.textContent.includes("Picture received as vision input."))'), 60000)
    const library = await run('window.najdLibrary.list()')
    assert.equal(library[0].kind, 'image')
    console.log('PASS: composer image attachment decoded/re-encoded in main and delivered to the selected model as vision input.')
  } finally {
    if (instance) await stop(instance)
    for (const dir of [root, root + '-imports', root + '-documents']) await fs.rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
