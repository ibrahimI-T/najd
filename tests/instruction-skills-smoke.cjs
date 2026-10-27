const assert = require('node:assert/strict')
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os')
const { launch, stop, evaluate, click, waitFor } = require('./electron-ui-smoke.cjs')
async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'najd-desktop-test-'))
  let instance
  try {
    instance = await launch(root)
    let client = instance.client
    async function run(expression) {
      const result = await client.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
      assert.ok(!result.exceptionDetails, JSON.stringify(result.exceptionDetails))
      return result.result.value
    }
    const rows = await run('window.najdSkills.list()')
    // 107 upstream skills and the NAJD Office design guide; Windows-suitable guidance starts enabled, macOS-only guidance
    // does not (owner live test 2026-10-19).
    assert.equal(rows.length, 109)
    assert.equal(rows.some(row => row.body), false)
    assert.equal(rows.filter(row => /^apple-|^imsg|^bear-notes$/.test(row.name)).some(row => row.enabled), false)
    const skill = rows.find(row => row.source === 'hermes' && row.name === 'systematic-debugging')
    await click(client, '.sidebar-link[aria-label="الإعدادات"]')
    await click(client, '.settings-nav-item:nth-child(6)')
    // Install and manage tools sit in a folded section below the catalog.
    await click(client, 'details.catalog-manage > summary')
    await waitFor(async () => await evaluate(client, '!!document.querySelector(".upstream-skill-search")'))
    await click(client, '.upstream-skill-search')
    await client.send('Input.insertText', { text: 'systematic-debugging' })
    const button = `[data-instruction-skill="${skill.id}"] button`
    await waitFor(async () => await evaluate(client, `!!document.querySelector(${JSON.stringify(button)})`))
    if (!skill.enabled) await click(client, button)
    await waitFor(async () => await evaluate(client, `document.querySelector(${JSON.stringify(button)})?.getAttribute('aria-pressed')==='true'`))
    await run(`(async()=>{await window.najdProviders.saveKey('openai-api','sk-najd-API-TEST-KEY');const l=await window.najdProviders.limits();await window.najdProviders.setLimits({...l.policy,maxOutputTokens:1024,maxCloudAttempts:100});return true})()`)
    async function model(provider) {
      return run(`(async()=>{const text='upstream skill fixture';let t=await window.najdCore.startTask(text,crypto.randomUUID(),${JSON.stringify(provider)},'gpt-6.1-sol',[{role:'user',text}],'auto');for(let n=0;n<400&&['QUEUED','RUNNING'].includes(t.state);n++){await new Promise(r=>setTimeout(r,20));t=await window.najdCore.getTask(t.id)}return t})()`)
    }
    const api = await model('openai-api')
    assert.equal(api.state, 'COMPLETED', api.errorCode)
    assert.equal(api.output, 'Original Hermes debugging guidance verified.')
    assert.ok(api.activity.events.some(event => event.type === 'tool.completed' && event.tool === 'najd-skills-read'))
    assert.equal(JSON.stringify(api.activity).includes('# Systematic Debugging'), false)
    await stop(instance); instance = undefined
    instance = await launch(root); client = instance.client
    assert.equal((await run('window.najdSkills.list()')).find(row => row.id === skill.id).enabled, true)
    await run('window.najdChatGPT.start()')
    await waitFor(async () => (await run('window.najdChatGPT.status()')).signedIn)
    const subscription = await model('chatgpt')
    assert.equal(subscription.state, 'COMPLETED', subscription.errorCode)
    assert.equal(subscription.output, api.output)
    await run(`window.najdSkills.setEnabled(${JSON.stringify(skill.id)},false)`)
    assert.equal((await run('window.najdSkills.list()')).find(row => row.id === skill.id).enabled, false)
    if (process.argv.includes('--native')) {
      // Cold managed startup can exceed one CDP evaluation's 10s reply timeout.
      // Observe its real result separately; do not replace native readiness with a fixture.
      await run("void(window.najdMcp.connect('najd-windows-native').then(value=>{window.__nativeResult=value},error=>{window.__nativeResult={state:'failed',error:String(error)}}))")
      await waitFor(async () => await evaluate(client, '!!window.__nativeResult'), 90000)
      const connected = await run('window.__nativeResult')
      assert.equal(connected.state, 'connected', JSON.stringify(connected))
      const started = await run(`(()=>{const text='connected apps fixture';return window.najdCore.startTask(text,crypto.randomUUID(),'openai-api','gpt-6.1-sol',[{role:'user',text}],'auto')})()`)
      await waitFor(async () => !['QUEUED','RUNNING'].includes((await run(`window.najdCore.getTask(${JSON.stringify(started.id)})`)).state), 90000)
      const native = await run(`window.najdCore.getTask(${JSON.stringify(started.id)})`)
      assert.equal(native.state, 'COMPLETED', native.errorCode)
      assert.equal(native.output, 'Native connected read result verified.')
      assert.ok(native.activity.events.some(event => event.type === 'tool.completed' && event.tool === 'najd-connections-apps'))
      await run("window.najdMcp.disconnect('najd-windows-native')")
      console.log('PASS: selected API fixture drives actual authenticated native MCP discovery and receives its result; no app opened. Native source runtime only.')
    }
    console.log('PASS: 107 attributed bundled skills, actual settings toggle, API/subscription discovery/schema/original-guidance loops, actual activity, disable and process restart. Fixture inference; no executable dependency claim.')
  } finally {
    if (instance) await stop(instance)
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(root).startsWith('najd-desktop-test-')) throw Error('Unsafe cleanup')
    await fs.rm(root, { recursive: true, force: true })
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
