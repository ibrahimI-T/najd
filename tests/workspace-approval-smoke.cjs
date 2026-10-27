const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { launch, stop, evaluate, click, waitFor } = require('./electron-ui-smoke.cjs')

async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'najd-desktop-test-'))
  const target = path.join(root + '-documents', 'NAJD', 'smoke', 'out.txt')
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
    for (const decision of ['deny', 'allow']) {
      await click(client, '#prompt')
      await client.send('Input.insertText', { text: 'workspace write fixture: write the file using the terminal command if needed' })
      await click(client, '.send-button')
      await waitFor(async () => await evaluate(client, '!!document.querySelector(".approval-card")')).catch(async error => { console.error(await evaluate(client, 'document.body.innerText')); throw error })
      const card = await evaluate(client, 'document.querySelector(".approval-card").textContent')
      assert.ok(card.includes('out.txt') && card.includes('APPROVED-CONTENT'), 'approval must show target and content: ' + card)
      await assert.rejects(fs.stat(target), 'nothing may be written before approval')
      await click(client, decision === 'deny' ? '.approval-deny' : '.approval-allow')
      const expected = decision === 'deny' ? 'Workspace write declined' : 'Workspace write verified'
      await waitFor(async () => await evaluate(client, `Array.from(document.querySelectorAll(".message.assistant")).some(m=>m.textContent.includes(${JSON.stringify(expected)}))`))
      if (decision === 'deny') await assert.rejects(fs.stat(target), 'denial must leave the file absent')
    }
    assert.equal(await fs.readFile(target, 'utf8'), 'APPROVED-CONTENT')
    const library = await run('window.najdLibrary.list()')
    assert.equal(library.length, 1); assert.equal(library[0].origin, 'artifact'); assert.equal(library[0].name, 'out.txt')
    assert.equal((await run('window.najdLibrary.search("APPROVED")'))[0].id, library[0].id)
    const recovery = JSON.parse(await fs.readFile(path.join(root, 'najd-data', 'actions.json'), 'utf8'))
    assert.deepEqual(recovery.actions.map(item => item.state).sort(), ['COMPLETED', 'DENIED'])
    console.log('PASS: model write proposal pauses in chat with exact target/content, denial leaves no file, approval writes once and journals completion.')
  } finally {
    if (instance) await stop(instance)
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(root).startsWith('najd-desktop-test-')) throw Error('Unsafe cleanup')
    await fs.rm(root, { recursive: true, force: true })
    await fs.rm(root + '-documents', { recursive: true, force: true })
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
