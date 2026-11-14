// The browser screenshot for najdagent.si and the README: a real article page beside the real NAJD side panel answering a question about it.
// Microsoft Edge with a temporary profile and the unpacked extension, paired with an in-test NAJD bridge whose answer is fixed here; the page is a
// local fixture. Writes release/site-shots/page-<lang>.png and panel-<lang>.png; scripts/compose-panel-shot.py puts them side by side.
// Usage: node scripts/capture-panel-shot.cjs [ar] [en]
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), http = require('node:http')
const { createBrowserBridge } = require('../electron/browser-bridge.cjs')
const { sleep, launch, pairThroughPanel, cdp } = require('../tests/helpers/edge-extension.cjs')

const output = path.resolve(__dirname, '../release/site-shots')
const article = {
  en: { title: 'Riyadh Metro opens its last line', body: ['The Riyadh Metro completed its network this week with the opening of Line 6, bringing the system to 176 kilometres and 85 stations across the capital.', 'Trains run every four minutes at peak times. Officials expect 3.6 million trips a day once all lines reach full service.', 'Fares start at 4 riyals for two hours of travel, and the Darb card works on both the metro and the city buses.', 'The authority says park-and-ride sites at six stations will open before the end of the year.'] },
  ar: { title: 'مترو الرياض يفتتح آخر خطوطه', body: ['اكتملت شبكة مترو الرياض هذا الأسبوع بافتتاح الخط السادس، ليصل طول الشبكة إلى 176 كيلومترًا و85 محطة في أنحاء العاصمة.', 'تمر القطارات كل أربع دقائق في أوقات الذروة، ويتوقع المسؤولون 3.6 مليون رحلة يوميًا عند تشغيل جميع الخطوط بكامل طاقتها.', 'تبدأ الأجرة من 4 ريالات لساعتين من التنقل، وتعمل بطاقة درب في المترو والحافلات معًا.', 'وتقول الهيئة إن مواقف «اركن وانطلق» في ست محطات ستفتتح قبل نهاية العام.'] }
}
const question = { en: 'Summarize this page in three points', ar: 'لخّص هذه الصفحة في ثلاث نقاط' }
const answer = {
  en: '**Riyadh Metro is complete**\n\n- Line 6 opened: **176 km** and **85 stations** in total.\n- Trains every **4 minutes** at peak; about **3.6 million** trips a day expected.\n- Fares from **4 SAR** for two hours; the Darb card also works on buses.',
  ar: '**اكتمل مترو الرياض**\n\n- افتُتح الخط السادس: **176 كم** و**85 محطة** إجمالًا.\n- قطار كل **4 دقائق** وقت الذروة، ونحو **3.6 مليون** رحلة يوميًا متوقعة.\n- الأجرة من **4 ريالات** لساعتين، وبطاقة درب تعمل في الحافلات أيضًا.'
}
const page = language => {
  const item = article[language], rtl = language === 'ar'
  return `<!doctype html><html lang="${language}" dir="${rtl ? 'rtl' : 'ltr'}"><meta charset="utf-8"><title>${item.title}</title>
<body style="margin:0;font-family:'Segoe UI',Tahoma,sans-serif;background:#f6f5f2;color:#1d1d1b">
<header style="display:flex;align-items:center;gap:14px;padding:18px 48px;background:#fff;border-bottom:1px solid #e6e3dc"><strong style="font-size:20px;letter-spacing:.02em">${rtl ? 'أخبار المدينة' : 'City News'}</strong><span style="color:#8a857c;font-size:14px">${rtl ? 'النقل · 14 نوفمبر 2026' : 'Transport · 14 November 2026'}</span></header>
<main style="max-width:720px;margin:40px auto;padding:0 32px"><h1 style="font-size:40px;line-height:1.2;margin:0 0 18px">${item.title}</h1>
<div style="height:220px;border-radius:14px;background:linear-gradient(120deg,#2b5876,#4e4376);margin-bottom:28px"></div>
${item.body.map(text => `<p style="font-size:19px;line-height:1.75;margin:0 0 18px">${text}</p>`).join('')}</main></body></html>`
}

async function capture(language, port) {
  const server = http.createServer((request, response) => { response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(page(language)) })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'najd-panel-shot-'))
  const bridge = createBrowserBridge({ filePath: path.join(dir, 'link.json'), encryption: { isEncryptionAvailable: () => true, encryptString: value => Buffer.from(value), decryptString: value => value.toString() }, ports: [39311, 39312] })
  await bridge.start()
  const browser = await launch({ debugPort: port, source: path.join(__dirname, '..', 'browser-extension-v2'), language })
  try {
    const panel = await browser.openPanel()
    await pairThroughPanel(bridge, panel)
    for (let i = 0; i < 60 && !bridge.status().connected; i++) await sleep(250)
    await panel.eval(`chrome.storage.local.set({ najdPanelLanguage: ${JSON.stringify(language)} }).then(() => true)`)
    await panel.eval('location.reload(); true')
    await sleep(1500)
    // The article, opened as the page beside the panel.
    const created = await (await fetch(`http://127.0.0.1:${port}/json/new?${base}/`, { method: 'PUT' })).json()
    const tab = await cdp(created.webSocketDebuggerUrl)
    await tab.send('Emulation.setDeviceMetricsOverride', { width: 1020, height: 860, deviceScaleFactor: 1, mobile: false })
    await sleep(800)
    const asks = []
    bridge.setHandlers({ onAsk: ask => { asks.push(ask) } })
    const reopened = await browser.openPanel()
    await reopened.send('Emulation.setDeviceMetricsOverride', { width: 420, height: 860, deviceScaleFactor: 1, mobile: false })
    await reopened.eval(`chrome.storage.local.set({ najdPanelLanguage: ${JSON.stringify(language)} }).then(() => true)`)
    await reopened.eval('location.reload(); true')
    await sleep(1800)
    await reopened.eval(`(() => { document.getElementById('include-page').checked = true; const box = document.getElementById('ask-text'); box.value = ${JSON.stringify(question[language])}; box.dispatchEvent(new Event('input')); document.getElementById('ask-form').requestSubmit(); return true })()`)
    for (let i = 0; i < 40 && !asks.length; i++) await sleep(250)
    if (!asks.length) throw new Error('the question did not reach the bridge')
    bridge.updateAsk(asks[0].id, { state: 'done', taskId: '44444444-4444-4444-8444-444444444444', output: answer[language], steps: [{ kind: 'page', label: 'page' }] })
    for (let i = 0; i < 40; i++) { await sleep(250); if (await reopened.eval("!!document.querySelector('.answer') && document.querySelector('.answer').textContent.length > 20")) break }
    await sleep(800)
    const write = async (client, name) => { const image = await client.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(output, `${name}-${language}.png`), Buffer.from(image.result.data, 'base64')) }
    await write(tab, 'page')
    await write(reopened, 'panel')
    tab.close(); reopened.close(); panel.close()
  } finally {
    await browser.stop().catch(() => {})
    await bridge.stop().catch(() => {})
    server.closeAllConnections?.(); server.close()
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

async function main() {
  fs.mkdirSync(output, { recursive: true })
  let port = 39261
  for (const language of process.argv.slice(2).length ? process.argv.slice(2) : ['ar', 'en']) await capture(language, port++)
  console.log('PASS: panel screenshots captured in ' + output)
}
main().catch(error => { console.error(error); process.exitCode = 1 })
