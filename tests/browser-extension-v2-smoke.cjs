// Real-browser acceptance of NAJD Browser 2.0 (browser-extension-v2): Microsoft Edge with a temporary profile, the unpacked extension,
// paired through its panel, driven through the real NAJD bridge on a local fixture site. Covers: protocol hello and loaded version, an
// owned tab, observation from the accessibility tree, a link followed and its destination verified, a stale observation refused, a
// harmless form typed and submitted, attaching the exact tab the owner opened, refusing to navigate an attached tab, and the tab list.
const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), http = require('node:http')
const { createBrowserBridge } = require('../electron/browser-bridge.cjs')
const { edge, sleep, launch, pairThroughPanel, cdp } = require('./helpers/edge-extension.cjs')
const { createBrowserTools } = require('../electron/browser-tools.cjs')
const { createActionJournal } = require('../electron/action-journal.cjs')

const site = {
  '/results': '<!doctype html><title>Results - gold</title><h1>Results</h1><a href="/first">Gold price today</a><a href="/second">Second result</a>',
  '/first': '<!doctype html><title>Gold price today</title><p>Gold 24k: 490 SAR</p><a href="/signup">Sign up</a>',
  '/signup': '<!doctype html><title>Sign up</title><form onsubmit="event.preventDefault();document.title=\'Submitted \'+document.querySelector(\'#email\').value"><label for="email">Email</label><input id="email" type="email"><label for="pw">Password</label><input id="pw" type="password"><button type="submit">Join</button></form>',
  '/order': '<!doctype html><title>Order</title><form action="/done" onsubmit="event.preventDefault();document.title=\'Ordered\'"><label for="n">Customer name</label><input id="n" type="text"><button type="submit">Submit order</button></form>',
  '/postform': '<!doctype html><title>Post form</title><form method="post" action="/echo"><label for="c">Customer name</label><input id="c" name="custname" type="text"><button type="submit">Send</button></form>',
  '/echo.json': '{"form": {"custname": "NAJD Test"}}',
  '/echo.txt': 'plain text reply: custname=NAJD Test',
  '/popup': '<!doctype html><title>Popup links</title><a href="/first" target="_blank">Open in a new tab</a>',
  '/owner': '<!doctype html><title>Owner page</title><p>Opened by the owner</p><a href="/first">Go</a>'
}

async function main() {
  if (!edge) { console.log('SKIP: Microsoft Edge not found'); return }
  const server = http.createServer((request, response) => {
    // A real form POST: the reply is JSON, like an echo service (the page that follows a submit).
    if (request.method === 'POST' && request.url === '/echo') {
      let body = ''; request.on('data', chunk => { body += chunk }); request.on('end', () => response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ form: Object.fromEntries(new URLSearchParams(body)), method: 'POST' })))
      return
    }
    const page = site[new URL(request.url, 'http://x').pathname]; response.writeHead(page ? 200 : 404, { 'Content-Type': request.url.endsWith('.json') ? 'application/json' : request.url.endsWith('.txt') ? 'text/plain; charset=utf-8' : 'text/html; charset=utf-8' }).end(page || 'not found') })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'najd-bridge-v2-'))
  const bridge = createBrowserBridge({ filePath: path.join(dir, 'link.json'), encryption: { isEncryptionAvailable: () => true, encryptString: value => Buffer.from(value), decryptString: value => value.toString() }, ports: [39301, 39302] })
  await bridge.start()
  const browser = await launch({ debugPort: 39243, source: path.join(__dirname, '..', 'browser-extension-v2') })
  const started = Date.now()
  try {
    const panel = await browser.openPanel()
    const request = await pairThroughPanel(bridge, panel)
    assert.ok(request, 'NAJD received a pairing request')
    for (let i = 0; i < 60 && !bridge.status().connected; i++) await sleep(250)
    assert.equal(bridge.status().connected, true)

    // The panel's language follows the owner's choice (the header button), not only the browser's: Arabic right-to-left, then back.
    const readPanel = () => panel.eval("({ lang: document.documentElement.lang, dir: document.documentElement.dir, label: document.getElementById('lang-label').textContent, tagline: document.querySelector('[data-i18n=tagline]').textContent })")
    const before = await readPanel()
    await panel.eval("document.getElementById('lang').click(); true")
    let after = null
    for (let i = 0; i < 40; i++) { await sleep(250); try { after = await readPanel(); if (after && after.lang !== before.lang) break } catch {} }
    assert.notEqual(after?.lang, before.lang, 'the language switched: ' + JSON.stringify({ before, after }))
    assert.equal(after.dir, after.lang === 'ar' ? 'rtl' : 'ltr')
    assert.notEqual(after.tagline, before.tagline, 'the panel text is in the other language')
    await panel.eval("document.getElementById('lang').click(); true")
    for (let i = 0; i < 40; i++) { await sleep(250); try { const back = await readPanel(); if (back && back.lang === before.lang) break } catch {} }
    assert.equal((await readPanel()).lang, before.lang, 'and back')

    const hello = await bridge.command('hello', {}, { timeoutMs: 15000 })
    assert.deepEqual([hello.protocol, hello.engine], [2, 'cdp'])
    assert.equal(bridge.status().links.find(link => link.connected)?.version, require('../browser-extension-v2/manifest.json').version, 'NAJD sees the version actually loaded')

    // An owned tab: open, observe, follow the first result, verify the destination.
    const results = await bridge.command('open', { url: base + '/results' }, { timeoutMs: 45000 })
    assert.equal(results.title, 'Results - gold')
    const first = results.elements.find(item => item.role === 'link' && item.label === 'Gold price today')
    assert.ok(first?.href?.endsWith('/first'), 'links carry their destination: ' + JSON.stringify(results.elements).slice(0, 600))
    await assert.rejects(bridge.command('click', { id: first.id, expect: { doc: results.doc, snap: '0', role: 'link', label: first.label } }), { code: 'PAGE_CHANGED' })
    const destination = await bridge.command('click', { id: first.id, expect: { doc: results.doc, snap: String(results.snap), role: 'link', label: first.label } }, { timeoutMs: 30000 })
    assert.equal(destination.title, 'Gold price today'); assert.match(destination.text, /490 SAR/); assert.ok(destination.url.endsWith('/first'))

    // A harmless form: typed and submitted; the password field is reported sensitive and refused.
    const signupLink = destination.elements.find(item => item.label === 'Sign up')
    const signup = await bridge.command('click', { id: signupLink.id, expect: { doc: destination.doc, snap: String(destination.snap), role: 'link', label: 'Sign up' } }, { timeoutMs: 30000 })
    const email = signup.elements.find(item => item.role === 'field' && item.label === 'Email'), password = signup.elements.find(item => item.label === 'Password')
    assert.equal(password.sensitive, true)
    await assert.rejects(bridge.command('type', { id: password.id, text: 'x', expect: { doc: signup.doc, snap: String(signup.snap), role: 'field', label: 'Password' } }), { code: 'SENSITIVE_FIELD' })
    const again = await bridge.command('read', {}, { timeoutMs: 30000 })
    const field = again.elements.find(item => item.role === 'field' && item.label === 'Email')
    const submitted = await bridge.command('type', { id: field.id, text: 'test@example.com', submit: true, expect: { doc: again.doc, snap: String(again.snap), role: 'field', label: 'Email' } }, { timeoutMs: 30000 })
    assert.equal(submitted.title, 'Submitted test@example.com')
    void email

    // Pressing Enter in a field submits its form: it is classified like the form's own button. A denied order is not submitted.
    const journal = createActionJournal({ filePath: path.join(dir, 'actions.json') })
    const tools = createBrowserTools({ bridge, journal, allowUrl: () => true })
    const order = await tools.run({ action: 'open', target: base + '/order', text: '', submit: false }, {})
    const nameField = order.page.elements.find(line => /Customer name/.test(line)).split(' ')[0]
    const asked = []
    const denied = await tools.run({ action: 'type', target: nameField, text: 'Test NAJD', submit: true }, { requestApproval: async tool => { asked.push(tool); return 'DENY' } })
    assert.equal(denied.status, 'denied_by_user'); assert.deepEqual(asked, ['najd-browser-sensitive'], 'typing with submit into an order form needs the sensitive approval')
    assert.equal((await bridge.command('read', {}, { timeoutMs: 15000 })).title, 'Order', 'nothing was submitted')

    // The owner's own tab: attached by its exact address, read, never navigated away by NAJD.
    await fetch(`http://127.0.0.1:39243/json/new?${base}/owner`, { method: 'PUT' })
    await sleep(1500)
    const owner = await bridge.command('attach', { url: base + '/owner' }, { timeoutMs: 30000 })
    assert.equal(owner.title, 'Owner page')
    await assert.rejects(bridge.command('back', {}), { code: 'ATTACHED_TAB' })
    const list = await bridge.command('list_tabs', {}, { timeoutMs: 15000 })
    const rows = list.tabs || list
    assert.equal(rows.find(tab => tab.url.endsWith('/owner')).ownership, 'attached')
    assert.equal(rows.find(tab => tab.url.endsWith('/order')).ownership, 'owned')
    await assert.rejects(bridge.command('attach', { url: base + '/missing' }), { code: 'NO_MATCHING_TAB' })
    // A server reply that is not an HTML page (JSON, plain text): its text is readable, so a task can confirm what a form submit returned.
    const json = await bridge.command('open', { url: base + '/echo.json' }, { timeoutMs: 45000 })
    assert.match(json.text, /custname/, 'a JSON reply reads as text: ' + JSON.stringify(json.text))
    const plain = await bridge.command('open', { url: base + '/echo.txt' }, { timeoutMs: 45000 })
    assert.match(plain.text, /custname=NAJD Test/, 'a plain-text reply reads as text: ' + JSON.stringify(plain.text))
    // The page that follows a real form POST reads as text too (live Chrome run: it came back empty after the press).
    const postForm = await bridge.command('open', { url: base + '/postform' }, { timeoutMs: 45000 })
    const customer = postForm.elements.find(item => item.role === 'field' && /Customer name/.test(item.label))
    const typedIn = await bridge.command('type', { id: customer.id, text: 'NAJD Test', submit: false, expect: { doc: postForm.doc, snap: String(postForm.snap), role: 'field', label: customer.label } }, { timeoutMs: 30000 })
    const send = typedIn.elements.find(item => item.role === 'button' && item.label === 'Send')
    const afterPost = await bridge.command('click', { id: send.id, expect: { doc: typedIn.doc, snap: String(typedIn.snap), role: 'button', label: 'Send' } }, { timeoutMs: 30000 })
    assert.ok(afterPost.url.endsWith('/echo'), 'the press navigated to the reply: ' + afterPost.url)
    assert.match(afterPost.text, /custname/, 'the reply of a form POST reads as text: ' + JSON.stringify(afterPost.text))
    const readAgain = await bridge.command('read', {}, { timeoutMs: 15000 })
    assert.match(readAgain.text, /NAJD Test/, 'and a later read of it: ' + JSON.stringify(readAgain.text))
    // A link that opens a new tab (target=_blank) is followed in NAJD's own tab and leaves no extra tab behind (it used to open one per press).
    const tabsBefore = (await bridge.command('list_tabs', {}, { timeoutMs: 15000 })).tabs.length
    const popup = await bridge.command('open', { url: base + '/popup' }, { timeoutMs: 45000 })
    const newTabLink = popup.elements.find(item => item.role === 'link' && /new tab/.test(item.label))
    const followed = await bridge.command('click', { id: newTabLink.id, expect: { doc: popup.doc, snap: String(popup.snap), role: 'link', label: newTabLink.label } }, { timeoutMs: 30000 })
    assert.equal(followed.title, 'Gold price today', 'the new-tab link was followed here: ' + JSON.stringify({ title: followed.title, url: followed.url }))
    assert.equal((await bridge.command('list_tabs', {}, { timeoutMs: 15000 })).tabs.length, tabsBefore, 'no extra tab was left open')
    // The selection button: selecting text on a page shows "Ask NAJD" beside it (nothing is sent until it is pressed); pressing it opens the
    // panel with the selection ready, like right-click > Ask NAJD. Switched off from the panel, it no longer appears.
    await bridge.command('open', { url: base + '/first' }, { timeoutMs: 45000 })
    const targets = await (await fetch(`http://127.0.0.1:${browser.debugPort}/json/list`)).json()
    const pageTarget = targets.find(item => item.type === 'page' && item.url.endsWith('/first'))
    const page = await cdp(pageTarget.webSocketDebuggerUrl)
    const selectAndRelease = async () => {
      const box = await page.eval("(() => { const p = document.querySelector('p'); const range = document.createRange(); range.selectNodeContents(p); const s = getSelection(); s.removeAllRanges(); s.addRange(range); const r = p.getBoundingClientRect(); return { x: r.left + 5, y: r.top + r.height / 2 } })()")
      await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', clickCount: 1 })
      await sleep(400)
    }
    await selectAndRelease()
    let bar = null
    for (let i = 0; i < 10 && !bar; i++) { bar = await page.eval("(() => { const h = document.querySelector('najd-selection-bar'); if (!h) return null; const r = h.getBoundingClientRect(); return { x: r.left + 20, y: r.top + 12 } })()"); if (!bar) await sleep(200) }
    assert.ok(bar, 'the Ask NAJD button appears beside the selection')
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await page.send('Input.dispatchMouseEvent', { type, x: bar.x, y: bar.y, button: 'left', clickCount: type === 'mouseMoved' ? 0 : 1 })
    let chip = false
    for (let i = 0; i < 20 && !chip; i++) { await sleep(250); chip = await panel.eval("!document.getElementById('selection-chip').hidden").catch(() => false) }
    assert.equal(chip, true, 'the panel received the selected text')
    assert.equal(await page.eval("!!document.querySelector('najd-selection-bar')"), false, 'the button went away after use')
    await panel.eval("document.getElementById('selection-bar').click(); true")
    await sleep(500)
    await selectAndRelease()
    assert.equal(await page.eval("!!document.querySelector('najd-selection-bar')"), false, 'switched off: no button')
    await panel.eval("document.getElementById('selection-bar').click(); true")
    page.close()
    // "@" in the panel: typing it lists the other open web tabs; the one picked is read when the question is sent and travels beside it.
    const received = []
    bridge.setHandlers({ onAsk: ask => { received.push(ask) } })
    await panel.eval("(() => { document.getElementById('include-page').checked = false; const box = document.getElementById('ask-text'); box.focus(); box.value = 'compare @Own'; box.setSelectionRange(12, 12); box.dispatchEvent(new Event('input')); return true })()")
    let option = null
    for (let i = 0; i < 20 && !option; i++) { await sleep(250); option = await panel.eval("(() => { const menu = document.getElementById('tab-menu'); if (menu.hidden) return null; return [...menu.querySelectorAll('[role=option]')].map(node => node.textContent) })()") }
    assert.ok(option?.length === 1 && /Owner page/.test(option[0]), 'typing @Own offers the owner tab only: ' + JSON.stringify(option))
    await panel.eval("document.querySelector('#tab-menu [role=option]').click(); true")
    const picked = await panel.eval("({ box: document.getElementById('ask-text').value, chips: [...document.querySelectorAll('#mention-chips .tag span')].map(node => node.textContent), menu: document.getElementById('tab-menu').hidden })")
    assert.deepEqual(picked, { box: 'compare ', chips: ['@ Owner page'], menu: true }, 'the @word left the question and the tab is a chip')
    await panel.eval("document.getElementById('ask-form').requestSubmit(); true")
    for (let i = 0; i < 40 && !received.length; i++) await sleep(250)
    const tabAsk = received.at(-1)
    assert.ok(tabAsk, 'the question reached NAJD')
    assert.equal(tabAsk.text, 'compare')
    assert.ok(tabAsk.page?.tabs?.length === 1 && tabAsk.page.tabs[0].url.endsWith('/owner') && /Opened by the owner/.test(tabAsk.page.tabs[0].text), 'the picked tab travelled with its text: ' + JSON.stringify(tabAsk.page))
    assert.equal(await panel.eval("document.getElementById('mention-chips').hidden"), true, 'the chip is cleared after sending')
    // "/" at the start of the box lists NAJD's skills; choosing one writes the same opening as Use in the app, and nothing is sent.
    bridge.setHandlers({ onSkills: async () => [{ id: 'pdf-tools', name: 'PDF tools', description: 'Read and make PDF files' }, { id: 'xlsx', name: 'Spreadsheets', description: 'Excel files' }] })
    const asksBefore = received.length
    await panel.eval("(() => { const box = document.getElementById('ask-text'); box.focus(); box.value = '/pd'; box.setSelectionRange(3, 3); box.dispatchEvent(new Event('input')); return true })()")
    let skillOptions = null
    for (let i = 0; i < 20 && !skillOptions; i++) { await sleep(250); skillOptions = await panel.eval("(() => { const menu = document.getElementById('tab-menu'); if (menu.hidden) return null; const rows = [...menu.querySelectorAll('[role=option]')].map(node => node.textContent); return rows.length ? rows : null })()") }
    assert.ok(skillOptions?.length === 1 && /PDF tools/.test(skillOptions[0]), 'typing /pd offers the PDF skill only: ' + JSON.stringify(skillOptions))
    await panel.eval("document.querySelector('#tab-menu [role=option]').click(); true")
    const opening = await panel.eval("document.getElementById('ask-text').value")
    assert.ok(opening === 'Use the skill "PDF tools" (pdf-tools) for: ' || opening === 'استخدم مهارة «PDF tools» (pdf-tools) في: ', 'the opening of Use: ' + JSON.stringify(opening))
    await sleep(500)
    assert.equal(received.length, asksBefore, 'choosing a skill sends nothing')
    await panel.eval("(() => { const box = document.getElementById('ask-text'); box.value = ''; box.dispatchEvent(new Event('input')); return true })()")
    // Earlier chats: once the question is answered, "New chat" keeps the closed chat in this session's list, and it can be reopened.
    bridge.updateAsk(tabAsk.id, { state: 'done', taskId: '22222222-2222-4222-8222-222222222222', output: 'The two pages agree.' })
    let answered = false
    for (let i = 0; i < 40 && !answered; i++) { await sleep(250); answered = await panel.eval("document.getElementById('thread').textContent.includes('The two pages agree.') && !document.getElementById('new-ask').disabled") }
    assert.equal(answered, true, 'the answer reached the panel')
    await panel.eval("document.getElementById('new-ask').click(); true")
    await sleep(600)
    assert.equal(await panel.eval("document.getElementById('thread').textContent.includes('The two pages agree.')"), false, 'a new chat is empty')
    await panel.eval("document.getElementById('history').click(); true")
    let earlier = null
    for (let i = 0; i < 20 && !earlier; i++) { await sleep(250); earlier = await panel.eval("(() => { const menu = document.getElementById('history-menu'); if (menu.hidden) return null; const rows = [...menu.querySelectorAll('button[data-chat]')].map(node => node.textContent); return rows.length ? rows : null })()") }
    assert.ok(earlier?.length === 1 && /compare/.test(earlier[0]), 'the closed chat is listed: ' + JSON.stringify(earlier))
    await panel.eval("document.querySelector('#history-menu button[data-chat]').click(); true")
    let reopened = false
    for (let i = 0; i < 20 && !reopened; i++) { await sleep(250); reopened = await panel.eval("document.getElementById('thread').textContent.includes('The two pages agree.') && document.getElementById('history-menu').hidden") }
    assert.equal(reopened, true, 'the earlier chat is open again')
    // A picture of the page: pressed in the panel, taken from the page beside it, sent once with the next question as a real JPEG.
    await panel.eval("document.getElementById('capture').click(); true")
    let captured = false
    for (let i = 0; i < 40 && !captured; i++) { await sleep(250); captured = await panel.eval("!document.getElementById('capture-chip').hidden || (!document.getElementById('ask-error').hidden && document.getElementById('ask-error').textContent)") }
    assert.equal(captured, true, 'the picture was taken: ' + JSON.stringify(captured))
    const picturesBefore = received.length
    await panel.eval("(() => { const box = document.getElementById('ask-text'); box.value = 'what is on this page?'; document.getElementById('ask-form').requestSubmit(); return true })()")
    for (let i = 0; i < 40 && received.length === picturesBefore; i++) await sleep(250)
    const pictured = received.at(-1)
    assert.equal(pictured?.text, 'what is on this page?')
    assert.ok(pictured.picture && pictured.picture.name === 'page.jpg' && pictured.picture.bytes[0] === 0xff && pictured.picture.bytes[1] === 0xd8 && pictured.picture.bytes.length > 1000, 'a real JPEG of the page arrived: ' + JSON.stringify({ name: pictured.picture?.name, size: pictured.picture?.bytes?.length }))
    assert.equal(await panel.eval("document.getElementById('capture-chip').hidden"), true, 'the picture is sent once')
    // Self-update: NAJD's folder now holds a newer extension (here the test copy's manifest version is raised, as a NAJD update rewrites it).
    // While a question is still being answered the extension waits; once nothing is in progress it reloads itself into the new version and
    // the bridge sees that version, with no Reload press (owner's browsers stayed two to six versions behind on 2026-11-14).
    const manifestPath = path.join(browser.copy, 'manifest.json')
    const shipped = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    const next = shipped.version.split('.').map(Number).map((part, index) => index === 2 ? part + 1 : part).join('.')
    fs.writeFileSync(manifestPath, JSON.stringify({ ...shipped, version: next }, null, 2))
    const waitingState = await panel.eval("chrome.runtime.sendMessage({ type: 'najd:check-update' }).then(reply => reply?.state || null)")
    assert.equal(waitingState, 'waiting', 'a question still being answered (the picture question) holds the reload')
    bridge.updateAsk(pictured.id, { state: 'done', taskId: '33333333-3333-4333-8333-333333333333', output: 'A page about gold.' })
    for (let i = 0; i < 40; i++) { await sleep(250); if (await panel.eval("document.getElementById('thread').textContent.includes('A page about gold.')")) break }
    await panel.eval("chrome.runtime.sendMessage({ type: 'najd:check-update' }).catch(() => null); true").catch(() => {})
    let reloadedVersion = null
    for (let i = 0; i < 120 && reloadedVersion !== next; i++) { await sleep(250); reloadedVersion = bridge.status().links.find(link => link.connected)?.version || null }
    assert.equal(reloadedVersion, next, 'the extension reloaded itself into the newer version and reconnected')
    console.log(`PASS: NAJD Browser 2.0 in ${process.env.NAJD_TEST_BROWSER === 'chrome' ? 'Chrome' : 'Edge'} (temporary profile): protocol 2 and loaded version ${require('../browser-extension-v2/manifest.json').version}; owned tab opened, link followed and destination verified; stale observation refused; sensitive field refused; harmless form submitted; Enter in an order form classified as the order and refused when denied; owner tab attached by exact address and protected from navigation; tab list shows ownership; reloads itself into a newer copy when idle. ${Math.round((Date.now() - started) / 1000)} s`)
  } finally {
    await browser.stop().catch(() => {})
    await bridge.stop().catch(() => {})
    server.closeAllConnections?.(); server.close()
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
