const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { zipSync, strToU8 } = require('fflate')
const { minimalPdf } = require('./fixtures/library-documents.cjs')
const { launch, stop, evaluate, click, waitFor } = require('./electron-ui-smoke.cjs')

async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'najd-desktop-test-'))
  const imports = root + '-imports'
  let instance
  try {
    await fs.mkdir(imports)
    await fs.writeFile(path.join(imports, 'report.docx'), zipSync({ 'word/document.xml': strToU8('<w:document><w:p><w:r><w:t>LIBRARY-OWNED-DOCUMENT</w:t></w:r></w:p></w:document>') }))
    await fs.writeFile(path.join(imports, 'report.pdf'), minimalPdf('LIBRARY-OWNED-PDF'))
    instance = await launch(root)
    let client = instance.client
    async function run(expression) {
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
    await click(client, '.attachment-popover .model-refresh')
    await waitFor(async () => await evaluate(client, 'document.querySelectorAll(".attachment-chips button").length===2'), 30000)
    assert.equal(await evaluate(client, 'document.querySelector(".attachment-chips").textContent.includes("report.docx")'), true)
    await click(client, '.attach-button')
    await click(client, '#prompt')
    await client.send('Input.insertText', { text: 'library agent fixture' })
    await click(client, '.send-button')
    await waitFor(async () => await evaluate(client, 'document.querySelector(".message.assistant")?.textContent.includes("NAJD library tool result verified")'))
    const result = await run(`(async()=>{const sessions=await window.najdSessions.list();const s=await window.najdSessions.get(sessions[0].id);if(s.messages[0].attachments.length!==2)throw Error('Attachments not captured by composer');return s.messages.at(-1)})()`)
    assert.equal(result.text, 'NAJD library tool result verified')
    assert.ok(result.activity.events.some(event => event.tool === 'najd-library-read' && event.type === 'tool.completed'))
    assert.equal(result.activity.events.some(event => event.type.startsWith('approval.')), false)
    assert.equal(JSON.stringify(result.activity).includes('LIBRARY-OWNED-DOCUMENT'), false)
    await stop(instance)
    instance = await launch(root)
    client = instance.client
    await waitFor(async () => await evaluate(client, '!!document.querySelector(".message-attachments")'))
    assert.equal(await evaluate(client, 'document.querySelector(".message-attachments").textContent'), 'report.docxreport.pdf')
    assert.equal((await run('window.najdLibrary.list()')).length, 2)
    await click(client, '.task-activity .act-toggle')
    assert.equal(await evaluate(client, 'document.querySelector(".task-activity").textContent.includes("najd-library-read")'), true)
    await click(client, '.attach-button')
    await click(client, '.library-open')
    await waitFor(async () => await evaluate(client, 'document.querySelectorAll(".library-items label").length===2'))
    const output = path.resolve('release/qa-library-agent')
    await fs.mkdir(output, { recursive: true })
    const shot = await client.send('Page.captureScreenshot', { format: 'png' })
    await fs.writeFile(path.join(output, 'library-restart.png'), Buffer.from(shot.data, 'base64'))
    await run('window.najdChatGPT.start()')
    await waitFor(async () => (await run('window.najdChatGPT.status()')).signedIn)
    const subscription = await run(`(async()=>{const a=await window.najdLibrary.list(),text='library agent fixture';
      let t=await window.najdCore.startTask(text,crypto.randomUUID(),'chatgpt','gpt-6.1-sol',[{role:'user',text}],'auto',[a[0].id]);
      for(let n=0;n<300&&['QUEUED','RUNNING'].includes(t.state);n++){await new Promise(r=>setTimeout(r,20));t=await window.najdCore.getTask(t.id)}return t})()`)
    assert.equal(subscription.state, 'COMPLETED', subscription.errorCode)
    assert.equal(subscription.output, 'NAJD library tool result verified')
    console.log('PASS: actual composer attachments/PDF+DOCX extraction, API and subscription schema/read/result loops, no per-read approval, real activity and full process restart.')
  } finally {
    if (instance) await stop(instance)
    for (const directory of [root, imports]) {
      if (!path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(directory).startsWith('najd-desktop-test-')) throw Error('Unsafe cleanup')
      await fs.rm(directory, { recursive: true, force: true })
    }
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
