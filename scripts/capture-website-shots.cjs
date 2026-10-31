// Captures the product screenshots for najdagent.si from the real desktop app, in the default Najd Gold theme, in Arabic
// and English. Isolated test profile with a fake provider key (tests/electron-harness.cjs answers the model); nothing
// touches the owner's data. Writes 1440x900 PNGs to release/qa-website-shots/<name>-<lang>.png.
// Usage: node scripts/capture-website-shots.cjs   (then convert them into the website with Pillow, see the website README)
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { launch, stop, evaluate, click, waitFor } = require('../tests/electron-ui-smoke.cjs')

const output = path.resolve(__dirname, '../release/qa-website-shots')
const notes = {
  en: ['q3-sales-notes.md', '# Q3 sales notes\n\nRevenue SAR 4.2M, up 18% on Q2.\nRiyadh led all regions; Jeddah grew fastest.\nPlan: hire two more people in Jeddah.\n'],
  ar: ['مبيعات-الربع-الثالث.md', '# ملاحظات مبيعات الربع الثالث\n\nالإيرادات 4.2 مليون ريال بزيادة 18% عن الربع الثاني.\nالرياض الأعلى بين المناطق، وجدة الأسرع نموًا.\nالخطة: توظيف شخصين إضافيين في جدة.\n'],
}
const prompts = {
  en: 'Summarize the Q3 sales notes in my workspace into a short report',
  ar: 'لخّص ملاحظات مبيعات الربع الثالث في مساحة العمل في تقرير قصير',
}
const memories = {
  en: [['Writing style', 'I prefer short, direct answers with bullet points.'], ['Work', 'Monthly reports go to the sales team every first Sunday.']],
  ar: [['أسلوب الكتابة', 'أفضّل الإجابات القصيرة المباشرة بنقاط.'], ['العمل', 'التقارير الشهرية تُرسل لفريق المبيعات أول أحد من كل شهر.']],
}

async function capture(language) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'najd-desktop-test-'))
  const workspace = path.join(root + '-documents', 'NAJD')
  await fs.mkdir(workspace, { recursive: true })
  await fs.writeFile(path.join(workspace, notes[language][0]), notes[language][1])
  let instance
  try {
    instance = await launch(root)
    const client = instance.client
    const run = async expression => {
      const result = await client.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
      if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails))
      return result.result.value
    }
    const shot = async name => {
      await new Promise(resolve => setTimeout(resolve, 700))
      const image = await client.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
      await fs.writeFile(path.join(output, `${name}-${language}.png`), Buffer.from(image.data, 'base64'))
    }
    const exists = selector => evaluate(client, `document.querySelector(${JSON.stringify(selector)}) !== null`)
    const type = async (selector, text) => {
      await click(client, selector)
      await client.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', modifiers: 2, windowsVirtualKeyCode: 65 })
      await client.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', modifiers: 2, windowsVirtualKeyCode: 65 })
      await client.send('Input.insertText', { text })
    }
    const section = async id => {
      if (!await exists('.settings-nav')) await click(client, '.sidebar-link[aria-label]')
      await click(client, `.settings-nav-item[data-section="${id}"]`)
      await waitFor(async () => await evaluate(client, `document.querySelector('.settings-nav-item[data-section="${id}"]').classList.contains('active')`))
      await evaluate(client, 'document.querySelector(".settings-scroll") && (document.querySelector(".settings-scroll").scrollTop = 0)')
    }

    await client.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
    // The app saves its own preferences right after it starts, so set them until the Najd Gold theme is really applied.
    const preferences = `localStorage.setItem('najd.preferences.v1',JSON.stringify({language:${JSON.stringify(language)},theme:'najd',fontScale:1,design:4})); localStorage.setItem('najd.welcome.v1','force')`
    for (let attempt = 0; attempt < 5; attempt++) {
      await waitFor(() => exists('#prompt'))
      await run(preferences)
      await client.send('Page.reload')
      await waitFor(() => exists('[data-welcome=connect]'))
      if (await evaluate(client, `document.documentElement.dataset.theme === 'najd' && document.documentElement.lang === ${JSON.stringify(language)}`)) break
      if (attempt === 4) throw new Error('The Najd Gold theme did not apply')
    }
    // First-run welcome, as a new user sees it before connecting a model.
    await waitFor(async () => !/لم تُفحص|Not checked/.test(await evaluate(client, `document.querySelector('[data-check=parts]')?.innerText || ''`)), 15000).catch(() => {})
    await shot('welcome')
    await click(client, '[data-welcome=later]')

    await run(`(async()=>{await window.najdProviders.saveKey('openai-api','sk-najd-API-TEST-KEY');const l=await window.najdProviders.limits();await window.najdProviders.setLimits({...l.policy,maxOutputTokens:1024,maxCloudAttempts:100});await window.najdProviders.testModel('openai-api','gpt-6.1-sol');localStorage.setItem('najd.provider.v1','openai-api');localStorage.setItem('najd.models.v2',JSON.stringify({'openai-api':'gpt-6.1-sol'}));return true})()`)
    await client.send('Page.reload')
    await waitFor(() => exists('#prompt'))
    await shot('hero')

    await click(client, '#prompt')
    await client.send('Input.insertText', { text: '/' })
    await waitFor(() => exists('#slash-menu'))
    await shot('commands')
    await client.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 })
    await client.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 })

    // Settings first: a pending approval locks the memory editor.
    await section('skills')
    await type('.settings-area input[type="search"], .settings-area input[placeholder]', 'design')
    await shot('skills')
    await section('plugins'); await shot('plugins')
    await section('atlas'); await shot('atlas')
    await section('memory')
    for (const [title, text] of memories[language]) {
      await waitFor(async () => await exists('[data-memory=title]') && !await evaluate(client, 'document.querySelector("[data-memory=title]").disabled'))
      await type('[data-memory=title]', title)
      await type('[data-memory=text]', text)
      const count = await evaluate(client, 'document.querySelectorAll(".memory-note").length')
      await click(client, '[data-memory="save"]')
      await waitFor(async () => await evaluate(client, `document.querySelectorAll(".memory-note").length > ${count}`))
    }
    await evaluate(client, 'document.querySelector(".memory-note")?.scrollIntoView({block:"center"})')
    await shot('memory')

    await client.send('Page.reload')
    await waitFor(() => exists('#prompt'))
    await click(client, '#prompt')
    await client.send('Input.insertText', { text: prompts[language] })
    await click(client, '.send-button')
    await waitFor(() => exists('.approval-card'), 30000)
    await shot('approvals')
  } finally {
    if (instance) await stop(instance)
    const resolved = path.resolve(root)
    if (!resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(resolved).startsWith('najd-desktop-test-')) throw new Error('Unsafe cleanup')
    for (const directory of [resolved, resolved + '-documents']) await fs.rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 }).catch(() => {})
  }
}

async function main() {
  await fs.mkdir(output, { recursive: true })
  for (const language of process.argv.slice(2).length ? process.argv.slice(2) : ['en', 'ar']) await capture(language)
  console.log('PASS: website screenshots captured in ' + output)
}

main().catch(error => { console.error(error); process.exitCode = 1 })
