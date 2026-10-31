const assert = require('node:assert/strict')
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os')
const { launch, stop, evaluate, waitFor } = require('./electron-ui-smoke.cjs')
async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'najd-desktop-test-'))
  let instance
  try {
    instance = await launch(root)
    const client = instance.client
    await waitFor(async () => evaluate(client, '!!window.najdSessions'))
    const setup = await client.send('Runtime.evaluate', { expression: `(async()=>{
      const s=await window.najdSessions.create();await window.najdSessions.append(s.id,'user','Computer workflow preview');
      localStorage.setItem('najd.profilePins.v1',JSON.stringify({[s.id]:'computer'}));
      localStorage.setItem('najd.sidePanel.v1','open');return s.id;
    })()`, awaitPromise: true, returnByValue: true })
    assert.ok(!setup.exceptionDetails)
    const output = path.resolve(__dirname, '../release/qa-computer-0.10.11')
    await fs.mkdir(output, { recursive: true })
    for (const language of ['en', 'ar']) {
      await evaluate(client, `localStorage.setItem('najd.preferences.v1',JSON.stringify({language:'${language}',theme:'graphite',accent:'#2f8cff',fontScale:1,design:4}))`)
      await client.send('Page.reload')
      await waitFor(async () => evaluate(client, '!!document.querySelector(".profile-workflow")'))
      const state = JSON.parse(await evaluate(client, 'JSON.stringify({text:document.querySelector(".profile-workflow").textContent, width:document.querySelector(".profile-workflow").getBoundingClientRect().width, overflow:document.querySelector(".profile-workflow").scrollWidth>document.querySelector(".profile-workflow").clientWidth})'))
      assert.match(state.text, language === 'en' ? /Observe.*verify/ : /ملاحظة.*التحقق/)
      assert.ok(state.width > 100 && !state.overflow)
      await evaluate(client, 'document.querySelector(".profile-workflow").scrollIntoView({block:"center"})')
      const shot = await client.send('Page.captureScreenshot', { format: 'png' })
      await fs.writeFile(path.join(output, language + '.png'), Buffer.from(shot.data, 'base64'))
    }
    console.log('PASS: computer workflow card renders in both languages without overflow; isolated screenshots saved.')
  } finally {
    if (instance) await stop(instance)
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(root).startsWith('najd-desktop-test-')) throw Error('Unsafe cleanup')
    await fs.rm(root, { recursive: true, force: true, maxRetries: 6, retryDelay: 250 })
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
