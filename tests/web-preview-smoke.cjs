// Real Electron check of najd_web_preview's renderer: a workspace HTML file and a local dev server are rendered
// offscreen at desktop and phone widths, console errors and sideways scrolling are reported, other schemes are refused,
// and containment holds for redirects, page resources and symlinked index files (NAJD-R01/R02/R05).
// Run: electron tests/web-preview-smoke.cjs [output-folder]
const { app, BrowserWindow, session, nativeImage } = require('electron')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http')
const assert = require('node:assert/strict')
const { createWebPreview } = require('../electron/web-preview.cjs')
const { previewSessionFactory } = require('../electron/web-preview-session.cjs')
const { publicUrl } = require('../electron/agent-runtime.cjs')

// NAJD's main window keeps the app alive; here nothing else does while preview windows come and go.
app.on('window-all-closed', () => {})
app.whenReady().then(async () => {
  const out = process.argv.find((arg, index) => index > 1 && !arg.startsWith('-') && !arg.endsWith('.cjs'))
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'najd-preview-')))
  const outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'najd-preview-outside-')))
  fs.writeFileSync(path.join(outside, 'secret.html'), '<title>SECRET</title><h1>outside</h1>')
  fs.writeFileSync(path.join(outside, 'secret.css'), 'body{background:red}')
  const html = '<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>مطعم نجد</title><style>body{margin:0;font-family:Segoe UI,Tahoma;background:#10131a;color:#f3efe6}' +
    'header{padding:64px 24px;background:linear-gradient(135deg,#1f2a44,#3b2f1e)}h1{font-size:48px;margin:0}section{padding:32px 24px;height:900px}.wide{width:1600px;height:20px;background:#c9a24a}</style></head>' +
    '<body><header><h1>مطعم نجد</h1><p>أطباق نجدية أصيلة</p></header><section><div class="wide"></div></section><script>console.error("demo failure")</script></body></html>'
  fs.writeFileSync(path.join(root, 'index.html'), html)
  // A page that tries to pull a file from outside the allowed folder.
  fs.writeFileSync(path.join(root, 'leak.html'), `<title>leak</title><link rel="stylesheet" href="${require('node:url').pathToFileURL(path.join(outside, 'secret.css')).href}"><p>x</p>` +
    `<script>addEventListener('load',()=>{document.title=getComputedStyle(document.body).backgroundColor})</script>`)
  fs.mkdirSync(path.join(root, 'linked'))
  let linked = true
  try { fs.symlinkSync(path.join(outside, 'secret.html'), path.join(root, 'linked', 'index.html'), 'file') } catch { linked = false }
  const server = http.createServer((req, res) => {
    if (req.url === '/away') { res.writeHead(302, { location: 'http://192.168.1.1/admin' }); return res.end() }
    if (req.url === '/store') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end('<title>store</title><script>localStorage.setItem("k","kept");document.cookie="c=1"</script>') }
    if (req.url === '/read') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end('<title>read</title><script>document.title="read:"+(localStorage.getItem("k")||"none")+":"+(document.cookie||"none")</script>') }
    if (req.url === '/hero') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end('<title>hero</title><style>body{margin:0}.hero{height:100vh;background:#123}.foot{height:300px;background:#c9a24a}</style><div class=hero></div><div class=foot></div><script>addEventListener("load",()=>{document.title="hero:"+document.querySelector(".hero").offsetHeight})</script>') }
    if (req.url === '/poster') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(`<title>poster</title><img src="http://127.0.0.1:${otherPort}/pixel"><script>fetch('/delete-everything', { method: 'POST', body: 'x' }).catch(() => {}); fetch('http://127.0.0.1:${otherPort}/admin', { method: 'DELETE' }).catch(() => {}); fetch('http://127.0.0.1:${otherPort}/read').catch(() => {}); try { new WebSocket('ws://127.0.0.1:${port}/hmr') } catch {}</script>`) }
    if (req.url === '/rtc') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(`<title>rtc</title><script>try { const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:127.0.0.1:${stunPort}' }, { urls: 'turn:127.0.0.1:${turnPort}?transport=tcp', username: 'u', credential: 'p' }] }); pc.createDataChannel('x'); pc.createOffer().then(offer => pc.setLocalDescription(offer)).catch(() => {}) } catch {}</script>`) }
    if (req.url === '/hang') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end('<title>hang</title><script>setTimeout(()=>{for(;;){}},50)</script>') }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(html.replace('class="wide"', 'class="ok"'))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  // R7-001: another local service that a previewed page must not reach, and writes the page must not make.
  const hits = { other: 0, writes: 0 }
  const other = http.createServer((_req, res) => { hits.other++; res.end('x') })
  await new Promise(resolve => other.listen(0, '127.0.0.1', resolve))
  const otherPort = other.address().port
  server.on('request', req => { if (!['GET', 'HEAD'].includes(req.method)) hits.writes++ })
  // R11-001: a local STUN (UDP) and TURN (TCP) endpoint that a previewed page must not reach through WebRTC.
  const rtc = { udp: 0, tcp: 0 }
  const stun = require('node:dgram').createSocket('udp4'); stun.on('message', () => rtc.udp++)
  await new Promise(resolve => stun.bind(0, '127.0.0.1', resolve))
  const turn = require('node:net').createServer(socket => { rtc.tcp++; socket.destroy() })
  await new Promise(resolve => turn.listen(0, '127.0.0.1', resolve))
  const stunPort = stun.address().port, turnPort = turn.address().port
  // R8-001: a WebSocket to the previewed server itself is never opened.
  server.on('upgrade', (_req, socket) => { hits.sockets = (hits.sockets || 0) + 1; socket.destroy() })
  const resolveFile = async input => {
    const full = path.resolve(root, input)
    let real
    try { real = fs.realpathSync(full) } catch { real = full }
    if (!(real + path.sep).toLowerCase().startsWith((root + path.sep).toLowerCase()) && real.toLowerCase() !== root.toLowerCase()) throw Object.assign(new Error('x'), { code: 'PATH_NOT_ALLOWED' })
    return real
  }
  const preview = createWebPreview({
    createSession: previewSessionFactory({ BrowserWindow, session, nativeImage, preview: () => preview }),
    isPublicUrl: url => !!publicUrl(url), resolveFile, baseDirectory: root, timeoutMs: 8000,
    prepareImage: async image => 'data:image/jpeg;base64,' + image.toJPEG(80).toString('base64')
  })
  try {
    const desktop = await preview.capture({ target: root, width: 1440, fullPage: true })
    assert.equal(desktop.title, 'مطعم نجد'); assert.ok(desktop.pageHeight > 900); assert.equal(desktop.height, desktop.pageHeight)
    assert.deepEqual(desktop.consoleErrors, ['demo failure']); assert.equal(desktop.horizontalOverflow, true)
    const phone = await preview.capture({ target: `http://127.0.0.1:${port}/`, width: 390 })
    assert.equal(phone.width, 390); assert.equal(phone.horizontalOverflow, false); assert.match(phone.imageUrl, /^data:image\/jpeg;base64,/)
    await assert.rejects(preview.capture({ target: 'file:///C:/Windows/win.ini' }), { code: 'URL_NOT_ALLOWED' })
    await assert.rejects(preview.capture({ target: 'https://localhost/' }), { code: 'URL_NOT_ALLOWED' })
    await assert.rejects(preview.capture({ target: '../../outside' }), { code: 'PATH_NOT_ALLOWED' })
    // R01: a redirect to a private address is cancelled before it leaves the session.
    await assert.rejects(preview.capture({ target: `http://127.0.0.1:${port}/away` }), { code: 'PAGE_NOT_ACCESSIBLE' })
    // R01/R02: a page resource outside the allowed folder is not loaded.
    const leak = await preview.capture({ target: path.join(root, 'leak.html') })
    assert.notEqual(leak.title, 'rgb(255, 0, 0)', 'the outside stylesheet must not apply')
    // R02: an index.html that links outside the allowed folder is refused.
    if (linked) await assert.rejects(preview.capture({ target: path.join(root, 'linked') }), { code: 'PATH_NOT_ALLOWED' })
    // R05: a page stuck in a loop cannot hold the capture past its deadline, and a cancel is honoured.
    const started = Date.now()
    await assert.rejects(preview.capture({ target: `http://127.0.0.1:${port}/hang` }), { code: 'TIMEOUT' })
    assert.ok(Date.now() - started < 15000)
    const controller = new AbortController(); controller.abort()
    await assert.rejects(preview.capture({ target: root }, { signal: controller.signal }), { code: 'CANCELLED' })
    // I2-007: nothing a page stores survives into the next capture.
    await preview.capture({ target: `http://127.0.0.1:${port}/store` })
    assert.equal((await preview.capture({ target: `http://127.0.0.1:${port}/read` })).title, 'read:none:none')
    // I2-006: a full-page picture keeps the viewport, so a 100vh hero stays one screen tall and the footer is included.
    const hero = await preview.capture({ target: `http://127.0.0.1:${port}/hero`, width: 800, fullPage: true })
    assert.equal(hero.title, 'hero:900'); assert.equal(hero.pageHeight, 1200); assert.equal(hero.height, 1200)
    const heroImage = nativeImage.createFromDataURL(hero.imageUrl).getSize()
    assert.equal(heroImage.height, 1200)
    // I2-001: a public https page loads through NAJD's pinned connection (needs internet).
    let online = true
    try { const page = await preview.capture({ target: 'https://example.com/' }); assert.match(page.title, /Example Domain/) } catch (error) { if (['PAGE_NOT_ACCESSIBLE', 'URL_NOT_ALLOWED', 'TIMEOUT'].includes(error.code)) online = false; else throw error }
    // R7-001: no write to the previewed server, and nothing at all reaches another local service.
    await preview.capture({ target: `http://127.0.0.1:${port}/poster` })
    assert.deepEqual(hits, { other: 0, writes: 0 }); assert.equal(hits.sockets, undefined)
    // R11-001: WebRTC reaches neither the local STUN server (UDP) nor the TURN server (TCP).
    await preview.capture({ target: `http://127.0.0.1:${port}/rtc` })
    await new Promise(resolve => setTimeout(resolve, 3000))
    assert.deepEqual(rtc, { udp: 0, tcp: 0 })
    // Owner live test 2026-10-31: a static counter page is tested by its buttons, not only rendered.
    fs.writeFileSync(path.join(root, 'counter.html'), '<!doctype html><title>Counter</title><p>Count: <span id="count">0</span></p><input id="step" value="1">' +
      '<button id="inc">Increment</button><button onclick="document.getElementById(\'count\').textContent=0">Reset</button><button disabled>Off</button>' +
      '<script>inc.onclick=()=>{count.textContent=Number(count.textContent)+Number(step.value)}</script>')
    const counter = await preview.capture({ target: path.join(root, 'counter.html'), width: 390, steps: JSON.stringify([{ click: '#inc' }, { click: 'Increment' }, { expect: '#count', text: '2' },
      { fill: '#step', text: '5' }, { click: '#inc' }, { read: '#count' }, { click: 'Reset' }, { expect: '#count', text: '0' }, { expect: '#count', text: '9' }, { click: 'Missing' }, { click: 'Off' }]) })
    assert.deepEqual(counter.steps.map(item => [item.ok, item.value ?? item.error ?? null]), [[true, null], [true, null], [true, '2'], [true, '5'], [true, null], [true, '7'], [true, null], [true, '0'], [false, '0'], [false, 'ELEMENT_NOT_FOUND'], [false, 'ELEMENT_DISABLED']])
    assert.equal(counter.stepsPassed, false); assert.match(counter.text, /Count: 0/)
    await assert.rejects(preview.capture({ target: 'https://example.com/', steps: '[{"click":"a"}]' }), { code: 'URL_NOT_ALLOWED' })
    await assert.rejects(preview.capture({ target: root, steps: 'not json' }), { code: 'INVALID_INPUT' })
    if (out) for (const [name, shot] of [['desktop', desktop], ['phone', phone]]) fs.writeFileSync(path.join(out, `preview-${name}.jpg`), Buffer.from(shot.imageUrl.split(',')[1], 'base64'))
    console.log('PASS: web preview renders files and local servers at desktop and phone widths, reports console errors and sideways scrolling, refuses other schemes,' +
      ` private redirects, outside resources${linked ? ', symlinked index files' : ''}, stops looping pages and cancelled captures, blocks writes, other local services and WebRTC, isolates storage per capture, captures full pages without resizing` + (online ? ', loads public https through pinned connections' : ' (offline: public https not checked)'))
  } catch (error) { console.error(error); process.exitCode = 1 }
  finally { server.close(); other.close(); stun.close(); turn.close(); app.quit() }
})
