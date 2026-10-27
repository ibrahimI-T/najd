// Real Electron first run with the installer's packed bundle: the chat shows component
// preparation progress, the composer stays usable, and once ready the selected-model
// path reaches original Hermes web_extract from the unpacked engine.
//   node tests/first-run-smoke.cjs build/bundle/najd-runtime-packed
const assert = require('node:assert/strict')
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os')
const { launch, stop, evaluate, click, waitFor } = require('./electron-ui-smoke.cjs')

async function main() {
  process.env.NAJD_DEV_BUNDLE = path.resolve(process.argv[2])
  delete process.env.NAJD_DEV_AGENT_CORE
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'najd-desktop-test-'))
  let instance
  try {
    instance = await launch(root)
    const client = instance.client
    const run = async expression => {
      const result = await client.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
      assert.ok(!result.exceptionDetails, JSON.stringify(result.exceptionDetails)); return result.result.value
    }
    await waitFor(async () => await evaluate(client, '!!document.querySelector(".runtime-banner progress")'), 30000)
    const banner = await evaluate(client, 'document.querySelector(".runtime-banner").textContent')
    assert.match(banner, /%/)
    assert.equal(await evaluate(client, 'document.querySelector("#prompt").disabled'), false, 'chat stays usable during preparation')
    const started = Date.now()
    await waitFor(async () => (await run('window.najdRuntime.status()')).state === 'ready', 900000)
    const seconds = Math.round((Date.now() - started) / 1000)
    await waitFor(async () => await evaluate(client, '!document.querySelector(".runtime-banner")'), 10000)
    await run(`(async()=>{await window.najdProviders.saveKey('openai-api','sk-najd-API-TEST-KEY');
      const l=await window.najdProviders.limits();await window.najdProviders.setLimits({...l.policy,maxOutputTokens:1024,maxCloudAttempts:100});
      localStorage.setItem('najd.provider.v1','openai-api');localStorage.setItem('najd.models.v2',JSON.stringify({'openai-api':'gpt-6.1-sol'}));return true})()`)
    await client.send('Page.reload')
    await waitFor(async () => await evaluate(client, 'document.querySelector(".composer-models select")?.value==="gpt-6.1-sol"'))
    await click(client, '#prompt')
    await client.send('Input.insertText', { text: 'web research fixture' })
    await click(client, '.send-button')
    await waitFor(async () => await evaluate(client, 'Array.from(document.querySelectorAll(".message.assistant")).some(m=>m.textContent.includes("Web extraction verified."))'), 120000)
    await stop(instance)
    instance = await launch(root)
    await waitFor(async () => (await (async () => { const r = await instance.client.send('Runtime.evaluate', { expression: 'window.najdRuntime.status()', awaitPromise: true, returnByValue: true }); return r.result.value })())?.state === 'ready', 15000)
    console.log(`PASS: first run showed progress in chat while usable, finished in ~${seconds}s, web tools then worked from the unpacked engine, and a restart was ready immediately.`)
  } finally {
    if (instance) await stop(instance)
    await fs.rm(root, { recursive: true, force: true }).catch(() => {}); await fs.rm(root + '-documents', { recursive: true, force: true }).catch(() => {})
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
