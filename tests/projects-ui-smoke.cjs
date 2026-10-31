// Projects and @ mentions through the real desktop app (isolated profile; owner request 2026-10-31): a project is
// created from the sidebar, given instructions, and a chat started from it is assigned to it; the @ menu lists
// earlier chats and inserts the chosen title; a new chat starts with no attachments or activity of the previous one.
// Usage: npm run build && node tests/projects-ui-smoke.cjs [screenshot-folder]
const assert = require('node:assert/strict')
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os')
const { launch, stop, click, evaluate, waitFor } = require('./electron-ui-smoke.cjs')

async function main() {
  const out = process.argv[2] ? path.resolve(process.argv[2]) : null
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'najd-desktop-test-'))
  let instance
  try {
    instance = await launch(root)
    const client = instance.client
    const run = async expression => { const result = await client.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); assert.ok(!result.exceptionDetails, JSON.stringify(result.exceptionDetails)); return result.result.value }
    const shot = async name => { if (!out) return; await fs.mkdir(out, { recursive: true }); const { data } = await client.send('Page.captureScreenshot', { format: 'png' }); await fs.writeFile(path.join(out, name + '.png'), Buffer.from(data, 'base64')) }
    // Two earlier chats.
    await run(`(async()=>{for(const [title,text] of [['مطعم نجد','سو لي موقع لمطعم نجد'],['Budget 2026','Plan my budget']]){const s=await window.najdSessions.create();await window.najdSessions.append(s.id,'user',text);await window.najdSessions.append(s.id,'assistant','ok: '+title)}})()`)
    // The sidebar reads the list when the window loads.
    await client.send('Page.reload')
    await new Promise(resolve => setTimeout(resolve, 3000))
    await waitFor(async () => { try { return await evaluate(client, 'document.querySelectorAll(".session-row").length') >= 2 } catch { return false } }, 30000)
      .catch(async error => { console.error('rows:', await evaluate(client, 'document.querySelectorAll(".session-row").length').catch(e => e.message), await run('window.najdSessions.list()').then(r => JSON.stringify(r).slice(0, 300))); throw error })
    // A project from the sidebar.
    await click(client, '.sidebar-add')
    await waitFor(async () => await evaluate(client, '!!document.querySelector(".project-create input")'))
    await client.send('Input.insertText', { text: 'موقع المطعم' })
    await click(client, '.project-create button[type=submit]')
    await waitFor(async () => await evaluate(client, '!!document.querySelector(".project-view")'))
    await click(client, '.project-card textarea')
    await client.send('Input.insertText', { text: 'اكتب بالعربي واستخدم ألوان الهوية الذهبية.' })
    await click(client, '.project-card .browser-action')
    await waitFor(async () => (await evaluate(client, 'document.querySelector(".project-status")?.textContent || ""')).length > 0)
    const saved = await run('window.najdProjects.list()')
    assert.equal(saved.length, 1); assert.equal(saved[0].name, 'موقع المطعم'); assert.match(saved[0].instructions, /ألوان الهوية/)
    assert.equal(await evaluate(client, 'getComputedStyle(document.querySelector(".chat-content")).display'), 'none', 'the project page replaces the chat')
    await shot('project-view')
    // A new chat in the project shows the project badge; the @ menu lists the earlier chats.
    await click(client, '.project-new-chat')
    await waitFor(async () => await evaluate(client, '!!document.querySelector(".composer-project")'))
    await click(client, '#prompt')
    await client.send('Input.insertText', { text: 'كمل من @مطع' })
    await waitFor(async () => await evaluate(client, '!!document.querySelector(".mention-menu")'))
    const listed = await evaluate(client, '[...document.querySelectorAll(".mention-menu .slash-label")].map(e=>e.textContent)')
    assert.deepEqual(listed, ['سو لي موقع لمطعم نجد'])
    await shot('mention-menu')
    await client.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
    await client.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
    await waitFor(async () => (await evaluate(client, 'document.querySelector("#prompt").value')) === 'كمل من @سو لي موقع لمطعم نجد ')
    assert.equal(await evaluate(client, '!!document.querySelector(".mention-menu")'), false)
    // A new chat outside the project starts clean: no badge, empty composer, no side-panel activity.
    await click(client, '.new-chat')
    await waitFor(async () => (await evaluate(client, 'document.querySelector("#prompt").value')) === '')
    assert.equal(await evaluate(client, '!!document.querySelector(".composer-project")'), false)
    assert.equal(await evaluate(client, 'document.querySelectorAll(".attachment-chip").length'), 0)
    console.log('PASS: a project is created and saved from the sidebar, its page replaces the chat, a chat started there carries the project, the @ menu lists earlier chats and inserts the title, and a new chat starts clean')
  } finally {
    if (instance) await stop(instance).catch(() => {})
    for (const dir of [root, root + '-documents']) await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 }).catch(() => {})
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
