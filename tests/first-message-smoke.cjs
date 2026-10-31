// A message typed and sent the moment NAJD opens (owner report: text typed right after an update was not received).
// Isolated profile and fixture model; the app is really closed and reopened, then the first message is typed with
// Input.insertText (the same path as typing or pasting) and sent with Enter as early as the page allows.
// Usage: npm run build && node tests/first-message-smoke.cjs [--packaged]
const assert = require('node:assert/strict')
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os')
const { launch, stop, evaluate, click, waitFor } = require('./electron-ui-smoke.cjs')

const READY = `(() => { const send = document.querySelector('.send-button:not(.stop)'); return { prompt: !!document.querySelector('#prompt'),
  newChat: !!document.querySelector('.new-chat') && !document.querySelector('.new-chat').disabled, users: document.querySelectorAll('.message.user').length,
  draft: document.querySelector('#prompt')?.value || '', notice: document.querySelector('.composer-queued')?.textContent || '' } })()`

async function setup(root) {
  const instance = await launch(root)
  const client = instance.client
  await waitFor(async () => await evaluate(client, '!!document.querySelector("#prompt")'))
  const result = await client.send('Runtime.evaluate', { awaitPromise: true, returnByValue: true, expression: `(async()=>{await window.najdProviders.saveKey('openai-api','sk-najd-API-TEST-KEY');
    await window.najdProviders.testModel('openai-api','gpt-6.1-sol');localStorage.setItem('najd.provider.v1','openai-api');localStorage.setItem('najd.models.v2',JSON.stringify({'openai-api':'gpt-6.1-sol'}));
    localStorage.setItem('najd.welcome.v1','1');return true})()` })
  assert.ok(!result.exceptionDetails, JSON.stringify(result.exceptionDetails))
  await stop(instance)
}

// Opens NAJD, and as soon as the composer exists types text and presses Enter; records what the page showed meanwhile.
async function earlySend(root, text, { pressAt = 'first-frame' } = {}) {
  const started = Date.now()
  const instance = await launch(root)
  const client = instance.client
  const timeline = []
  try {
    await waitFor(async () => await evaluate(client, '!!document.querySelector("#prompt")'), 30000)
    timeline.push({ at: Date.now() - started, ...(await evaluate(client, READY)) })
    if (pressAt === 'after-ready') await waitFor(async () => (await evaluate(client, READY)).newChat, 30000)
    await click(client, '#prompt')
    await client.send('Input.insertText', { text })
    await client.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
    await client.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
    timeline.push({ at: Date.now() - started, event: 'enter', ...(await evaluate(client, READY)) })
    // The earlier chat reopens on launch, so "sent" means this exact text is shown as a user message, exactly once.
    const copies = `[...document.querySelectorAll(".message.user")].filter(m => m.innerText.includes(${JSON.stringify(text)})).length`
    let sent = false
    try { await waitFor(async () => await evaluate(client, copies) > 0, 15000); sent = true } catch {}
    await new Promise(resolve => setTimeout(resolve, 1500))
    const final = await evaluate(client, READY)
    timeline.push({ at: Date.now() - started, event: 'end', ...final })
    return { sent, final, timeline, copies: await evaluate(client, copies) }
  } finally { await stop(instance) }
}

async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'najd-desktop-test-'))
  try {
    await setup(root)
    const results = []
    for (const [index, pressAt] of ['first-frame', 'first-frame', 'after-ready'].entries()) {
      const text = 'first message proof ' + index + ' نص عربي'
      const outcome = await earlySend(root, text, { pressAt })
      results.push({ pressAt, sent: outcome.sent, timeline: outcome.timeline })
      assert.ok(outcome.sent, 'the first message was sent: ' + JSON.stringify(outcome.timeline))
      assert.equal(outcome.copies, 1, 'the exact text was sent once, not twice')
      assert.equal(outcome.final.draft, '', 'nothing left behind in the composer')
    }
    console.log(JSON.stringify(results, null, 1))
    console.log('PASS: a message typed and sent the moment NAJD opens is sent once, with its exact text (3 relaunches).')
  } finally { await fs.rm(root, { recursive: true, force: true }).catch(() => {}) }
}

main().catch(error => { console.error(error); process.exitCode = 1 })
