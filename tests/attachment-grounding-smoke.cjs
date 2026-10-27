const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { launch, stop, evaluate, click, waitFor } = require('./electron-ui-smoke.cjs')

async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'najd-desktop-test-'))
  const imports = root + '-imports'
  let instance
  try {
    await fs.mkdir(imports)
    await fs.writeFile(path.join(imports, 'report.md'), '# Master plan\nGROUNDING-PLAN-MILESTONE: durable recovery before desktop tools\n')
    instance = await launch(root)
    let client = instance.client
    const run = async expression => {
      const result = await client.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
      assert.ok(!result.exceptionDetails, JSON.stringify(result.exceptionDetails))
      return result.result.value
    }
    await run(`(async()=>{
      await window.najdProviders.saveKey('openai-api','sk-najd-API-TEST-KEY');
      const l=await window.najdProviders.limits();await window.najdProviders.setLimits({...l.policy,maxOutputTokens:1024,maxCloudAttempts:100});
      localStorage.setItem('najd.provider.v1','openai-api');localStorage.setItem('najd.models.v2',JSON.stringify({'openai-api':'gpt-6.1-sol'}));return true
    })()`)
    await client.send('Page.reload')
    await waitFor(async () => await evaluate(client, 'document.querySelector(".composer-models select")?.value==="gpt-6.1-sol"'))
    await click(client, '.attach-button')
    assert.equal(await evaluate(client, '!!document.querySelector(".library-open") && !document.querySelector(".library-items")'), true)
    await click(client, '.attachment-popover .model-refresh')
    await waitFor(async () => await evaluate(client, 'document.querySelector(".attachment-chips")?.textContent.includes("report.md")'))
    await click(client, '.attach-button')
    await click(client, '#prompt')
    await client.send('Input.insertText', { text: 'grounding fixture: summarize this plan' })
    await click(client, '.send-button')
    await waitFor(async () => await evaluate(client, 'document.querySelector(".message.assistant")?.textContent.includes("Grounded plan:")'))
    const receipt = await run('(async()=>{const l=await window.najdSessions.list();const s=await window.najdSessions.get(l[0].id);return s.messages.at(-1)})()')
    assert.ok(receipt.activity.events.some(event => event.tool === 'najd-library-read' && event.type === 'tool.completed'))
    assert.equal(JSON.stringify(receipt.activity).includes('GROUNDING-PLAN-MILESTONE'), false)
    await stop(instance); instance = undefined
    instance = await launch(root); client = instance.client
    await waitFor(async () => await evaluate(client, '!!document.querySelector(".message-attachments")'))
    await run('window.najdChatGPT.start()')
    await waitFor(async () => (await run('window.najdChatGPT.status()')).signedIn)
    const task = await run(`(async()=>{
      const a=await window.najdLibrary.list(),text='grounding fixture: summarize the attached plan';
      let t=await window.najdCore.startTask(text,crypto.randomUUID(),'chatgpt','gpt-6.1-sol',[
        {role:'user',text:'Write an HTML page'}, {role:'assistant',text:'Old unrelated HTML instructions: save index.html'}, {role:'user',text}
      ],'auto',[a[0].id]);
      for(let n=0;n<400&&['QUEUED','RUNNING'].includes(t.state);n++){await new Promise(r=>setTimeout(r,20));t=await window.najdCore.getTask(t.id)}return t
    })()`)
    assert.equal(task.state, 'COMPLETED', task.errorCode)
    assert.equal(task.output, 'Grounded plan: durable recovery before desktop tools.')
    const dispatches = (await fs.readFile(path.join(root, 'grounding-dispatch.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse)
    assert.equal(dispatches.length, 2)
    assert.ok(dispatches.every(item => item.grounded && item.calls === 0))
    console.log('PASS: Markdown composer import, grounded first-request plain answers via API and subscription, unrelated HTML history, persisted library/restart and actual local-read receipt. Fixture providers only.')
  } finally {
    if (instance) await stop(instance)
    for (const directory of [root, imports]) {
      if (!path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(directory).startsWith('najd-desktop-test-')) throw Error('Unsafe cleanup')
      await fs.rm(directory, { recursive: true, force: true })
    }
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
