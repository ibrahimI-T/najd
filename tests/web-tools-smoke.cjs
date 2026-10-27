// Selected-model path in the real Electron app: the fixture model calls najd_web_extract,
// NAJD runs original Hermes web_extract from the staged sealed core, and the result
// returns to the model. Requires network and a staged payload.
//   node tests/web-tools-smoke.cjs .runtimes/runtime-packs/agent-core-004
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { launch, stop, evaluate, click, waitFor } = require('./electron-ui-smoke.cjs')

async function main() {
  process.env.NAJD_DEV_AGENT_CORE = path.resolve(process.argv[2])
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'najd-desktop-test-'))
  let instance
  try {
    instance = await launch(root)
    const client = instance.client
    const run = async expression => {
      const result = await client.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
      assert.ok(!result.exceptionDetails, JSON.stringify(result.exceptionDetails))
      return result.result.value
    }
    await run(`(async()=>{await window.najdProviders.saveKey('openai-api','sk-najd-API-TEST-KEY');
      const l=await window.najdProviders.limits();await window.najdProviders.setLimits({...l.policy,maxOutputTokens:1024,maxCloudAttempts:100});
      localStorage.setItem('najd.provider.v1','openai-api');localStorage.setItem('najd.models.v2',JSON.stringify({'openai-api':'gpt-6.1-sol'}));return true})()`)
    await client.send('Page.reload')
    await waitFor(async () => await evaluate(client, 'document.querySelector(".composer-models select")?.value==="gpt-6.1-sol"'))
    await click(client, '#prompt')
    await client.send('Input.insertText', { text: 'web research fixture' })
    await click(client, '.send-button')
    await waitFor(async () => await evaluate(client, 'Array.from(document.querySelectorAll(".message.assistant")).some(m=>m.textContent.includes("Web extraction verified."))'), 120000)
    const message = await run('(async()=>{const s=await window.najdSessions.list();const x=await window.najdSessions.get(s[0].id);return x.messages.at(-1)})()')
    const events = message.activity.events
    assert.ok(events.some(event => event.tool === 'najd-web-extract' && event.type === 'tool.completed' && event.detail === 'https://example.com' || event.tool === 'najd-web-extract' && event.type === 'tool.started' && event.detail === 'https://example.com'))
    assert.equal(events.some(event => event.type.startsWith('approval.')), false, 'read-only web extraction needs no approval')
    console.log('PASS: selected-model call reached original Hermes web_extract in the sealed core; result returned to the model; timeline recorded without approval.')
  } finally {
    if (instance) await stop(instance)
    await fs.rm(root, { recursive: true, force: true }); await fs.rm(root + '-documents', { recursive: true, force: true })
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
