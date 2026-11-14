// Shared helper for the real-browser checks: Microsoft Edge with a temporary profile (never the user's) and the unpacked NAJD extension.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const { spawn, execFileSync } = require('node:child_process')
const { storeManifest } = require('../../scripts/extension-checks.cjs')

// NAJD_TEST_BROWSER=chrome runs the same checks in Google Chrome (temporary profile); the default is Microsoft Edge.
const CHROME = process.env.NAJD_TEST_BROWSER === 'chrome'
// NAJD_TEST_BROWSER_PATH runs the same checks in a browser at that path (for example Chrome for Testing, which still honours --load-extension).
const edge = (CHROME ? [process.env.NAJD_TEST_BROWSER_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe', path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe')]
  : ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe']).filter(Boolean).find(file => fs.existsSync(file))
const extension = path.join(__dirname, '..', '..', 'browser-extension-v2')
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

async function cdp(url) {
  const ws = new WebSocket(url); let id = 0; const waits = new Map()
  ws.onmessage = event => { const message = JSON.parse(event.data); waits.get(message.id)?.(message); waits.delete(message.id) }
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject })
  const send = (method, params = {}) => new Promise(resolve => { const n = ++id; waits.set(n, resolve); ws.send(JSON.stringify({ id: n, method, params })) })
  return { close: () => ws.close(), send,
    // Evaluates in the page and returns its value (awaiting promises).
    eval: async expression => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result?.result?.value }
}

// A temporary copy of the extension (never the repository folder): the store build (website access optional) or the development one,
// plus a page that frames the side panel on a 1280x800 canvas for store screenshots (it is not part of the shipped package).
function prepareExtension({ store = false, source = null } = {}) {
  const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'najd-ext-copy-'))
  fs.cpSync(source || extension, copy, { recursive: true })
  if (store) fs.writeFileSync(path.join(copy, 'manifest.json'), JSON.stringify(storeManifest(JSON.parse(fs.readFileSync(path.join(source || extension, 'manifest.json'), 'utf8')))))
  fs.writeFileSync(path.join(copy, 'compose.html'), `<!doctype html><meta charset="utf-8"><body style="margin:0;width:1280px;height:800px;overflow:hidden;background:radial-gradient(circle at 20% 10%,#1d1d21,#0b0b0c);color:#f2f2f2;font-family:'Segoe UI',system-ui,sans-serif;display:flex;align-items:center;justify-content:space-between;gap:56px;padding:0 72px;box-sizing:border-box"><div style="flex:1"><h1 id="h" style="font-size:46px;line-height:1.25;margin:0 0 18px"></h1><p id="p" style="font-size:21px;line-height:1.6;color:#a0a0a0;margin:0"></p></div><iframe src="sidepanel.html" style="width:420px;height:704px;border:1px solid #303030;border-radius:16px;background:#111;flex:none"></iframe></body>`)
  return copy
}

async function launch({ debugPort, store = false, language = null, source }) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'najd-edge-profile-'))
  const copy = prepareExtension({ store, ...(source ? { source } : {}) })
  const browser = spawn(edge, [`--user-data-dir=${profile}`, `--remote-debugging-port=${debugPort}`, `--load-extension=${copy}`, `--disable-extensions-except=${copy}`,
    ...(language ? [`--lang=${language}`] : []), '--no-first-run', '--no-default-browser-check', '--disable-features=msEdgeSidebarV2,DisableLoadExtensionCommandLineSwitch',
    // Branded Chrome no longer honours --load-extension: the unpacked extension is loaded through the DevTools pipe instead.
    ...(CHROME ? ['--remote-debugging-pipe', '--enable-unsafe-extension-debugging'] : []), 'about:blank'], { stdio: CHROME ? ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] : 'ignore' })
  if (CHROME) { browser.stdio[4].on('data', () => {}); browser.stdio[3].write(JSON.stringify({ id: 1, method: 'Extensions.loadUnpacked', params: { path: copy } }) + '\0') }
  let worker
  for (let i = 0; i < 80 && !worker; i++) {
    await sleep(250)
    const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`).catch(() => null))?.json().catch(() => null) || []
    worker = targets.find(target => target.type === 'service_worker' && target.url.endsWith('/service-worker.js'))
  }
  if (!worker) throw new Error('extension service worker did not start (Edge refused --load-extension)')
  const extensionId = new URL(worker.url).host
  async function openPanel() {
    const created = await (await fetch(`http://127.0.0.1:${debugPort}/json/new?chrome-extension://${extensionId}/sidepanel.html`, { method: 'PUT' })).json()
    const panel = await cdp(created.webSocketDebuggerUrl)
    for (let i = 0; i < 40; i++) { if (await panel.eval("!!document.getElementById('status-text')?.textContent")) break; await sleep(250) }
    // The fixture pages of the tests are on this computer: allowed for the test profile only (extension-private storage).
    await panel.eval('chrome.storage.local.set({ najdAllowLocal: true }).then(() => true)')
    return panel
  }
  // The panel framed on a 1280x800 canvas with a headline, for store screenshots.
  async function openComposed(headline, text) {
    const created = await (await fetch(`http://127.0.0.1:${debugPort}/json/new?chrome-extension://${extensionId}/compose.html`, { method: 'PUT' })).json()
    const page = await cdp(created.webSocketDebuggerUrl)
    await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false })
    await sleep(800)
    await page.eval(`document.documentElement.dir = ${JSON.stringify(language === 'ar' ? 'rtl' : 'ltr')}; document.getElementById('h').textContent = ${JSON.stringify(headline)}; document.getElementById('p').textContent = ${JSON.stringify(text)}; true`)
    return page
  }
  const stop = async () => {
    try { execFileSync('taskkill', ['/PID', String(browser.pid), '/T', '/F'], { stdio: 'ignore' }) } catch {}
    // Browser processes that left the launched tree (a tab opened by a page can get its own process) are found by this run's profile folder,
    // so no test browser outlives its run (they kept the debug port busy and made the next run talk to an old browser).
    try { execFileSync('powershell.exe', ['-NoProfile', '-Command', `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${path.basename(profile)}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`], { stdio: 'ignore', timeout: 20000 }) } catch {}
    await sleep(1500)
    for (const dir of [profile, copy]) fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 })
  }
  return { profile, extensionId, openPanel, openComposed, stop, debugPort, copy }
}

// Pair like a user: press Connect in the extension; the NAJD side (here: the bridge handler) confirms the same code.
async function pairThroughPanel(bridge, panel, { approve = true } = {}) {
  let seen = null
  bridge.setHandlers({ onPairRequest: request => { seen = request; setImmediate(() => bridge.resolvePair(request.id, approve)) } })
  // Search only this test bridge (a real NAJD on the usual ports must never receive a test pairing request).
  await panel.eval(`chrome.storage.local.set({ najdPorts: [${bridge.status().port}] }).then(() => true)`)
  await panel.eval("document.getElementById('connect').click(); true")
  for (let i = 0; i < 80 && !bridge.status().paired && approve; i++) await sleep(250)
  return seen
}

module.exports = { edge, extension, sleep, cdp, launch, pairThroughPanel }
