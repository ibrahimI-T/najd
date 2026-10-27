// The sidebar's community card in the real desktop app (isolated profile): the wide Discord button over the website and the
// author's credit, in Arabic and English, in Najd Gold and graphite. The buttons are not clicked: they open the default browser.
const assert = require('node:assert/strict')
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os')
const { launch, stop, evaluate, waitFor } = require('./electron-ui-smoke.cjs')
async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'najd-desktop-test-'))
  const shots = path.resolve('release/qa-community-' + require('../package.json').version)
  await fs.mkdir(shots, { recursive: true })
  let instance
  try {
    instance = await launch(root)
    const client = instance.client
    const run = async expression => { const result = await client.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); assert.ok(!result.exceptionDetails, JSON.stringify(result.exceptionDetails)); return result.result.value }
    await client.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 860, deviceScaleFactor: 2, mobile: false })
    assert.equal(await run(`typeof window.najdLinks?.open`), 'function', 'the link opener is exposed')
    for (const [language, theme] of [['ar', 'graphite'], ['en', 'graphite'], ['ar', 'najd']]) {
      await run(`localStorage.setItem('najd.preferences.v1',JSON.stringify({language:${JSON.stringify(language)},theme:${JSON.stringify(theme)},accent:'#2f8cff',fontScale:1,design:4}))`)
      await client.send('Page.reload')
      await waitFor(async () => await evaluate(client, '!!document.querySelector(".community-join")'))
      await new Promise(resolve => setTimeout(resolve, 600))
      const box = await run(`(() => { const a = document.querySelector('aside').getBoundingClientRect(), c = document.querySelector('.community').getBoundingClientRect(), p = document.querySelector('.privacy-mini').getBoundingClientRect(), j = document.querySelector('.community-join').getBoundingClientRect(), chips = [...document.querySelectorAll('.community-chip')].map(e => e.getBoundingClientRect())
        return { aside: [a.left, a.width, a.bottom], community: [c.left, c.top, c.width, c.height], privacyTop: p.top, join: [j.width, j.height], chips: chips.map(r => [r.left, r.top, r.width]), text: document.querySelector('.community').innerText } })()`)
      // Bottom-left of the sidebar, the wide button on top and the two smaller ones side by side under it.
      assert.ok(box.community[0] < 330 && box.community[1] + box.community[3] <= box.privacyTop + 1, JSON.stringify(box))
      assert.equal(box.chips.length, 2); assert.ok(Math.abs(box.chips[0][1] - box.chips[1][1]) < 1 && box.chips[0][1] > box.community[1] + box.join[1] - 1)
      assert.ok(box.join[1] > 40 && box.join[0] > box.chips[0][2] * 1.8, 'the community button is the large, wide one')
      // The sidebar shows the real whole-computer state (green when on).
      const on = await run(`window.najdFiles.wholeComputer().then(value => value.wholeComputer)`)
      await waitFor(async () => await evaluate(client, `document.querySelector('.privacy-mini').dataset.control === ${JSON.stringify(on ? 'on' : 'off')}`))
      const label = await run(`document.querySelector('.privacy-mini').innerText`)
      assert.equal(label.trim(), language === 'ar' ? (on ? 'التحكم بكامل الكمبيوتر مفعّل' : 'التحكم بكامل الكمبيوتر غير مفعّل') : (on ? 'Whole-computer control is on' : 'Whole-computer control is off'))
      assert.match(box.text, /najdagent\.si/); assert.match(box.text, /@fm\.1/); assert.match(box.text, language === 'ar' ? /انضم إلى المجتمع/ : /Join the community/)
      await fs.writeFile(path.join(shots, `community-${language}-${theme}.png`), Buffer.from((await client.send('Page.captureScreenshot', { format: 'png', clip: { x: Math.max(0, box.aside[0]), y: box.community[1] - 220, width: box.aside[1], height: box.aside[2] - box.community[1] + 220, scale: 1 } })).data, 'base64'))
      await fs.writeFile(path.join(shots, `full-${language}-${theme}.png`), Buffer.from((await client.send('Page.captureScreenshot', { format: 'png' })).data, 'base64'))
    }
    // Turned off in this isolated profile, the label changes and loses the green.
    await run(`localStorage.setItem('najd.preferences.v1',JSON.stringify({language:'ar',theme:'graphite',accent:'#2f8cff',fontScale:1,design:4}))`)
    await run(`window.najdFiles.wholeComputer(false)`); await client.send('Page.reload')
    await waitFor(async () => await evaluate(client, `document.querySelector('.privacy-mini')?.dataset.control === 'off'`))
    assert.equal((await run(`document.querySelector('.privacy-mini').innerText`)).trim(), 'التحكم بكامل الكمبيوتر غير مفعّل')
    await new Promise(resolve => setTimeout(resolve, 600))
    const off = await run(`(() => { const a = document.querySelector('aside').getBoundingClientRect(), c = document.querySelector('.community').getBoundingClientRect(); return [a.left, a.width, a.bottom, c.top] })()`)
    await fs.writeFile(path.join(shots, 'community-ar-graphite-off.png'), Buffer.from((await client.send('Page.captureScreenshot', { format: 'png', clip: { x: Math.max(0, off[0]), y: off[3] - 40, width: off[1], height: off[2] - off[3] + 40, scale: 1 } })).data, 'base64'))
    console.log('PASS: community card (ar/en, Najd Gold/graphite): wide Discord button over the website and the author credit, bottom-left. Screenshots in ' + shots)
  } finally {
    if (instance) await stop(instance)
    const resolved = path.resolve(root)
    if (!resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(resolved).startsWith('najd-desktop-test-')) throw Error('Unsafe cleanup')
    for (const dir of [resolved, resolved + '-documents']) await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 }).catch(() => {})
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
