// Real Electron composer: a pasted picture and a file dropped through Chromium's drag pipeline
// are imported into the library, shown as chips (picture with thumbnail) and reach the model.
const assert = require('node:assert/strict')
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os')
const { launch, stop, evaluate, click, waitFor } = require('./electron-ui-smoke.cjs')
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=='

async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'najd-desktop-test-'))
  const dropped = path.join(root + '-imports', 'dropped-notes.md')
  await fs.mkdir(root + '-imports'); await fs.writeFile(dropped, '# Dropped\nDROPPED-DOCUMENT-CONTENT')
  let instance
  try {
    instance = await launch(root)
    const client = instance.client
    const run = async expression => {
      const result = await client.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
      assert.ok(!result.exceptionDetails, JSON.stringify(result.exceptionDetails)); return result.result.value
    }
    await run(`(async()=>{await window.najdProviders.saveKey('openai-api','sk-najd-API-TEST-KEY');const l=await window.najdProviders.limits();await window.najdProviders.setLimits({...l.policy,maxOutputTokens:1024,maxCloudAttempts:100});
      localStorage.setItem('najd.provider.v1','openai-api');localStorage.setItem('najd.models.v2',JSON.stringify({'openai-api':'gpt-6.1-sol'}));return true})()`)
    await client.send('Page.reload')
    await waitFor(async () => await evaluate(client, 'document.querySelector(".composer-models select")?.value==="gpt-6.1-sol"'))
    // Paste a picture.
    await run(`(()=>{const bytes=Uint8Array.from(atob('${PNG}'),c=>c.charCodeAt(0));const data=new DataTransfer();data.items.add(new File([bytes],'shot.png',{type:'image/png'}));
      document.querySelector('#prompt').dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));return true})()`)
    // A picture is a preview tile (its name only as a tooltip) with its own remove button.
    await waitFor(async () => await evaluate(client, '!!document.querySelector(".attachment-tile img")'), 30000)
    assert.match(await evaluate(client, 'document.querySelector(".attachment-tile").title'), /Pasted image/)
    assert.equal(await evaluate(client, '!!document.querySelector(".attachment-tile .attachment-tile-remove")'), true)
    // Drop a real file.
    const box = await run('(()=>{const r=document.querySelector(".composer").getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()')
    for (const type of ['dragEnter', 'dragOver', 'drop']) await client.send('Input.dispatchDragEvent', { type, x: box.x, y: box.y, data: { items: [], files: [dropped], dragOperationsMask: 1 } })
    await waitFor(async () => await evaluate(client, 'Array.from(document.querySelectorAll(".attachment-chip")).some(c=>c.textContent.includes("dropped-notes.md"))'), 30000)
      .catch(async error => { console.error('state:', await evaluate(client, 'document.querySelectorAll(".attachment-chip").length + " chips; notice=" + (document.querySelector(".notice")?.textContent||"none") + "; dragging=" + !!document.querySelector(".composer.dragging")')); throw error })
    // Send: the picture must arrive as vision input.
    await click(client, '#prompt')
    await client.send('Input.insertText', { text: 'image fixture: what is in this picture' })
    await click(client, '.send-button')
    await waitFor(async () => await evaluate(client, 'Array.from(document.querySelectorAll(".message.assistant")).some(m=>m.textContent.includes("Picture received as vision input."))'), 60000)
    const kinds = (await run('window.najdLibrary.list()')).map(item => item.kind).sort()
    assert.deepEqual(kinds, ['image', 'text'])
    // The sent message shows the picture itself, not its file name.
    await waitFor(async () => await evaluate(client, '!!document.querySelector(".message.user .sent-picture img")'), 20000)
    console.log('PASS: pasted picture (preview tile) and dropped document were imported and attached; the picture reached the selected model as vision input and shows in the sent message.')
  } finally {
    if (instance) await stop(instance)
    for (const dir of [root, root + '-imports', root + '-documents']) await fs.rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
