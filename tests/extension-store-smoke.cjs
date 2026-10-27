// The STORE build of the extension in real Microsoft Edge (temporary profile): website access is optional there, so until the user
// allows it the panel asks for it and browsing commands are refused with SITE_ACCESS_NEEDED (which NAJD turns into a clear message).
// Also writes the store screenshots (1280x800, English and Arabic) to release/extension/screenshots. Usage: npm run smoke:extension-store
const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), os = require('node:os')
const { createBrowserBridge } = require('../electron/browser-bridge.cjs')
const { createBrowserTools } = require('../electron/browser-tools.cjs')
const { edge, sleep, launch } = require('./helpers/edge-extension.cjs')

const shots = path.resolve('release/extension/screenshots')
const TEXT = {
  en: [['Connect your browser to NAJD in one click', 'NAJD finds the app on your computer. You confirm the same six-digit code in NAJD. The link stays on your computer.'],
    ['Confirm the code in the NAJD window', 'The code in the extension must match the code NAJD shows you. Only then is the browser linked.'],
    ['Allow NAJD to work on websites, once', 'NAJD works only in its own tab group, and only when you ask. Passwords stay protected.'],
    ['Ask NAJD from any page', 'Select text, right-click, or type a question. NAJD works on it and reports back here.']],
  ar: [['اربط متصفحك بنجد بضغطة واحدة', 'يجد نجد التطبيق على جهازك، وتؤكد الرمز المكوّن من 6 أرقام في نجد. الربط نفسه يبقى على جهازك.'],
    ['أكّد الرمز في نافذة نجد', 'يجب أن يتطابق الرمز في الإضافة مع الرمز الذي يعرضه نجد. عندها فقط يُربط المتصفح.'],
    ['اسمح لنجد بالعمل على المواقع، مرة واحدة', 'يعمل نجد داخل مجموعة تبويباته فقط، وعندما تطلب منه. كلمات المرور تبقى محمية.'],
    ['اسأل نجد من أي صفحة', 'حدّد نصًا، أو اضغط بالزر الأيمن، أو اكتب سؤالك. ينجز نجد المهمة ويخبرك هنا.']]
}

async function session(language, debugPort, bridgePorts) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'najd-store-smoke-'))
  const bridge = createBrowserBridge({ filePath: path.join(dir, 'link.json'), encryption: { isEncryptionAvailable: () => false }, ports: bridgePorts })
  await bridge.start()
  const browser = await launch({ debugPort, store: true, language })
  return { bridge, browser, dir }
}

async function main() {
  if (!edge) { console.log('SKIP: Microsoft Edge not found'); return }
  fs.mkdirSync(shots, { recursive: true })
  for (const [language, debugPort, ports] of [['en', 39236, [38231, 38232]], ['ar', 39237, [38241, 38242]]]) {
    const { bridge, browser, dir } = await session(language, debugPort, ports)
    try {
      const capture = async (name, index) => {
        const page = await browser.openComposed(TEXT[language][index][0], TEXT[language][index][1])
        await sleep(1200)
        const data = await page.send('Page.captureScreenshot', { format: 'png' })
        fs.writeFileSync(path.join(shots, `${language}-${name}.png`), Buffer.from(data.result.data, 'base64'))
        page.close()
      }
      const panel = await browser.openPanel()
      const uiLanguage = await panel.eval('chrome.i18n.getUILanguage()')
      if (language === 'ar') assert.match(uiLanguage, /^ar/, 'the Arabic run really uses the Arabic UI language: ' + uiLanguage)
      assert.equal(await panel.eval('document.documentElement.dir'), language === 'ar' ? 'rtl' : 'ltr')
      await capture('1-connect', 0)

      // Pairing stays pending until the user decides; the code is shown in the extension meanwhile.
      let pending = null
      bridge.setHandlers({ onPairRequest: request => { pending = request } })
      await panel.eval(`chrome.storage.local.set({ najdPorts: [${bridge.status().port}] }).then(() => true)`)
      await panel.eval("document.getElementById('connect').click(); true")
      for (let i = 0; i < 40 && !pending; i++) await sleep(250)
      assert.ok(pending, 'NAJD received the request')
      for (let i = 0; i < 20 && (await panel.eval("document.getElementById('view-pairing').hidden")); i++) await sleep(250)
      assert.equal((await panel.eval("document.getElementById('pair-code').textContent")).replace(/\s/g, ''), pending.code, 'the same code on both sides')
      await capture('2-confirm-code', 1)
      assert.equal(bridge.status().paired, false, 'nothing is linked before the user allows it')
      await bridge.resolvePair(pending.id, true)
      for (let i = 0; i < 60 && !bridge.status().connected; i++) await sleep(250)
      assert.equal(bridge.status().connected, true)

      // Website access is optional in the store build: the panel asks for it and browsing is refused until it is granted.
      for (let i = 0; i < 20 && (await panel.eval("document.getElementById('site-access').hidden")); i++) await sleep(250)
      assert.equal(await panel.eval("document.getElementById('site-access').hidden"), false, 'the panel asks for website access')
      assert.equal(await panel.eval("chrome.permissions.contains({ origins: ['https://*/*', 'http://*/*'] })"), false)
      await assert.rejects(bridge.command('open', { url: 'https://example.com/' }, { timeoutMs: 20000 }), { code: 'SITE_ACCESS_NEEDED' })
      const page = { url: 'https://example.com/', title: 'x', elements: [], text: '', scroll: { y: 0 } }
      const tools = createBrowserTools({ bridge: { status: () => ({ connected: true }), lastPage: () => page, command: (...args) => bridge.command(...args) }, allowUrl: () => true })
      const result = await tools.run({ action: 'open', target: 'https://example.com/', text: '', submit: false }, { requestApproval: async () => 'ALLOW_ONCE' })
      assert.equal(result.status, 'site_access_needed'); assert.match(result.note, /Allow on all sites/)
      await capture('3-site-access', 2)

      // An answer in the panel (what the owner sees after asking from any page).
      bridge.setHandlers({ onAsk: ask => { setImmediate(() => bridge.updateAsk(ask.id, { state: 'done', output: language === 'ar' ? 'لخّصتُ الصفحة: ثلاث نقاط رئيسية عن أسعار المصابيح.' : 'Summary of the page: three key points about lamp prices.' })); return true } })
      await panel.eval("(() => { document.getElementById('ask-text').value = " + JSON.stringify(language === 'ar' ? 'لخّص هذه الصفحة' : 'Summarize this page') + "; document.getElementById('include-page').checked = false; document.getElementById('ask-form').requestSubmit(); return true })()")
      for (let i = 0; i < 30 && !(await panel.eval("document.getElementById('answer-output').textContent")); i++) await sleep(250)
      await capture('4-ask', 3)
      panel.close()
    } finally { await bridge.stop(); await browser.stop(); fs.rmSync(dir, { recursive: true, force: true }) }
  }
  console.log('PASS: store build in real Edge (en and ar): pairing needs the user and shows the same code on both sides, website access is optional (panel asks, commands refused with SITE_ACCESS_NEEDED and explained to the model). Screenshots in ' + shots)
}
main().catch(error => { console.error(error); process.exitCode = 1 })
