const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const http = require('node:http')
const path = require('node:path')
const os = require('node:os')
const { zipSync, strToU8 } = require('fflate')
const { launch, stop, evaluate, click, waitFor } = require('./electron-ui-smoke.cjs')

async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'najd-desktop-test-'))
  const archive = Buffer.from(zipSync({ 'repo-main/deploy/SKILL.md': strToU8('---\nname: Fixture Deploy\ndescription: fixture-deploy helper\nlicense: MIT\n---\n# Fixture\nEXTERNAL-SKILL-GUIDANCE') }))
  const server = http.createServer((request, response) => response.end(archive))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${server.address().port}/pack.zip`
  let instance
  try {
    instance = await launch(root)
    const client = instance.client
    const run = async expression => {
      const result = await client.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
      assert.ok(!result.exceptionDetails, JSON.stringify(result.exceptionDetails))
      return result.result.value
    }
    const installed = await run(`window.najdSkills.install(${JSON.stringify(url)})`)
    assert.equal(installed[0].id, 'ext-fixture-deploy'); assert.equal(installed[0].enabled, false)
    await run(`(async()=>{await window.najdProviders.saveKey('openai-api','sk-najd-API-TEST-KEY');
      const l=await window.najdProviders.limits();await window.najdProviders.setLimits({...l.policy,maxOutputTokens:1024,maxCloudAttempts:100});
      localStorage.setItem('najd.provider.v1','openai-api');localStorage.setItem('najd.models.v2',JSON.stringify({'openai-api':'gpt-6.1-sol'}));return true})()`)
    await client.send('Page.reload')
    await waitFor(async () => await evaluate(client, 'document.querySelector(".composer-models select")?.value==="gpt-6.1-sol"'))
    // Disabled skills are not visible to the model; enabling is the user's explicit action.
    const task = prompt => run(`(async()=>{const text=${JSON.stringify(prompt)};let t=await window.najdCore.startTask(text,crypto.randomUUID(),'openai-api','gpt-6.1-sol',[{role:'user',text}],'auto',[]);
      for(let n=0;n<400&&['QUEUED','RUNNING'].includes(t.state);n++){await new Promise(r=>setTimeout(r,25));t=await window.najdCore.getTask(t.id)}return t})()`)
    assert.notEqual((await task('external skill fixture')).state, 'COMPLETED')
    await run(`window.najdSkills.setEnabled('ext-fixture-deploy', true)`)
    const done = await task('external skill fixture')
    assert.equal(done.state, 'COMPLETED', done.errorCode); assert.equal(done.output, 'External skill guidance verified.')
    assert.ok(done.activity.events.some(event => event.tool === 'najd-skills-read' && event.type === 'tool.completed'))
    await stop(instance)
    instance = await launch(root)
    assert.equal((await (async () => { const r = await instance.client.send('Runtime.evaluate', { expression: 'window.najdSkills.list()', awaitPromise: true, returnByValue: true }); return r.result.value })()).find(row => row.id === 'ext-fixture-deploy').enabled, true)
    console.log('PASS: URL/GitHub-style archive install (disabled), enable, selected-model discovery and bounded read, persistence after restart.')
  } finally {
    if (instance) await stop(instance)
    server.close()
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(root).startsWith('najd-desktop-test-')) throw Error('Unsafe cleanup')
    await fs.rm(root, { recursive: true, force: true }); await fs.rm(root + '-documents', { recursive: true, force: true })
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
