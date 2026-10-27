const assert = require('node:assert/strict')
const { spawn } = require('node:child_process')
const fs = require('node:fs/promises')
const net = require('node:net')
const os = require('node:os')
const path = require('node:path')

const electron = require('electron')
const harness = path.join(__dirname, 'electron-harness.cjs')
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))

async function freePort() {
  const server = net.createServer()
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  await new Promise(resolve => server.close(resolve))
  return port
}

async function waitForPage(port) {
  // Up to ~60 s: a loaded or low-memory machine can take 30 s+ to open the first window.
  for (let attempt = 0; attempt < 600; attempt++) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`)
      const pages = await response.json()
      const page = pages.find(item => item.type === 'page' && item.title === 'NAJD AGENT')
      if (page) return page
    } catch { /* Electron may still be starting. */ }
    await pause(100)
  }
  throw new Error('NAJD window did not open')
}

async function connect(url) {
  const socket = new WebSocket(url)
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener('error', reject, { once: true })
  })
  let nextId = 0
  const pending = new Map()
  socket.addEventListener('close', () => {
    for (const waiter of pending.values()) { clearTimeout(waiter.timer); waiter.reject(new Error('CDP connection closed')) }
    pending.clear()
  })
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data)
    if (message.method === 'Page.javascriptDialogOpening') {
      void send('Page.handleJavaScriptDialog', { accept: true })
    }
    const waiter = pending.get(message.id)
    if (waiter) {
      pending.delete(message.id)
      clearTimeout(waiter.timer)
      if (message.error) waiter.reject(new Error(message.error.message))
      else waiter.resolve(message.result)
    }
  })
  function send(method, params = {}) {
    const id = ++nextId
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)) }, 10000)
      pending.set(id, { resolve, reject, timer })
      socket.send(JSON.stringify({ id, method, params }))
    })
  }
  await send('Page.enable')
  return { send, close: () => socket.close() }
}

async function evaluate(client, expression) {
  const result = await client.send('Runtime.evaluate', { expression, returnByValue: true })
  if (result.exceptionDetails) throw new Error('Renderer evaluation failed')
  return result.result.value
}

async function click(client, selector) {
  // A real user activates NAJD before clicking. CDP input alone does not
  // restore Windows foreground ownership after a separate app closes.
  await client.send('Page.bringToFront')
  // Layout can still grow just after an action (async receipts, expanding groups), so
  // scroll and verify a few times before declaring the control covered.
  let rect
  // GitHub's Windows runners are slower and have a small screen: expanding groups can take a few seconds to settle.
  for (let attempt = 0; attempt < (process.env.CI ? 20 : 4); attempt++) {
    await evaluate(client, `document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' })`)
    // Nested scrolling and scroll snapping can settle after scrollIntoView.
    await client.send('Runtime.evaluate', { expression: 'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))', awaitPromise: true })
    rect = await evaluate(client, `(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element) return null;
      const box = element.getBoundingClientRect();
      const x=box.left+box.width/2, y=box.top+box.height/2;
      const top=document.elementFromPoint(x,y);
      return { x, y, hit:element.contains(top), top: top ? top.tagName + '.' + String(top.className).slice(0,60) : null };
    })()`)
    if (!rect || rect.hit) break
    await pause(150)
  }
  if (!rect) throw new Error(`Missing control: ${selector}`)
  if (!rect.hit) throw new Error(`Control is clipped or covered: ${selector} (topmost: ${rect.top} at ${Math.round(rect.x)},${Math.round(rect.y)})`)
  await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: rect.x, y: rect.y, button: 'left', clickCount: 1 })
  await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rect.x, y: rect.y, button: 'left', clickCount: 1 })
}

// The same checks, with more time on slower CI machines.
async function waitFor(predicate, timeoutMs = process.env.CI ? 30000 : 10000) {
  for (let attempt = 0; attempt < Math.ceil(timeoutMs / 100); attempt++) {
    if (await predicate()) return
    await pause(100)
  }
  throw new Error('Timed out waiting for UI state')
}

// Denied Windows requests leave no allowed windows-apps/windows-demo entry in the activity log.
async function assertNoAllowedWindowsAction(root) {
  const activity = await fs.readFile(path.join(root, 'najd-data', 'activity-log.jsonl'), 'utf8').catch(() => '')
  const allowed = activity.split('\n').filter(Boolean).map(line => JSON.parse(line)).filter(row => ['windows-apps', 'windows-demo'].includes(row.reason) && row.decision === 'allowed')
  assert.deepEqual(allowed, [])
}

// Back to the size the run started with: the window's own size, or on CI the fixed desktop size set at launch.
async function resetViewport(client) {
  if (process.env.CI) await client.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 860, deviceScaleFactor: 1, mobile: false })
  else await client.send('Emulation.clearDeviceMetricsOverride')
}

async function launch(root) {
  const port = await freePort()
  const process = spawn(electron, [harness], {
    cwd: path.join(__dirname, '..'), windowsHide: true, stdio: 'ignore',
    env: { ...global.process.env, NAJD_TEST_USER_DATA: root, NAJD_TEST_DEBUG_PORT: String(port), NAJD_TEST_PACKAGED: global.process.argv.includes('--packaged') ? '1' : '0', NAJD_TEST_OUTPUT_CAP: '1024' }
  })
  try {
    const page = await waitForPage(port)
    const client = await connect(page.webSocketDebuggerUrl)
    // CI runners have a small, variable screen: the page gets a fixed ordinary desktop size there so these flows do not
    // depend on it. Narrow layouts are checked on purpose by capabilities-ui-smoke (360 to 1440 px).
    if (global.process.env.CI) await client.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 860, deviceScaleFactor: 1, mobile: false })
    return { process, client }
  } catch (error) { process.kill(); throw error }
}

async function verifyUx(instance) {
  const client = instance.client
  const screenshots = path.resolve(__dirname, '..', process.env.NAJD_QA_DIR || 'release/qa-phase07')
  await fs.mkdir(screenshots, { recursive: true })
  const originalRatio = await evaluate(client, 'devicePixelRatio')
  await click(client, '.legal-toggle')
  await waitFor(async () => (await evaluate(client, 'document.querySelector(".legal-card pre")?.textContent || ""')).includes('OpenClaw Foundation'))
  const legal = await evaluate(client, 'document.querySelector(".legal-card pre").textContent')
  assert.ok(legal.includes('Nous'))
  assert.ok(legal.includes('Roman'))
  assert.equal(legal.includes('sk-najd-'), false)
  await click(client, '.legal-toggle')
  await click(client, '[data-scale="1.25"]')
  await waitFor(async () => await evaluate(client, 'devicePixelRatio') > originalRatio * 1.2)
  for (const language of ['ar', 'en']) {
    await click(client, `.settings-group .setting-row:first-child .segmented button:${language === 'ar' ? 'first' : 'last'}-child`)
    assert.equal(await evaluate(client, 'document.documentElement.dir'), language === 'ar' ? 'rtl' : 'ltr')
    for (const theme of ['dark', 'light', 'navy', 'system']) {
      await click(client, `button[data-theme="${theme}"]`)
      for (const [width, height] of [[1280, 800], [960, 640], [760, 560]]) {
        await client.send('Emulation.setDeviceMetricsOverride', { width: Math.round(width / 1.25), height: Math.round(height / 1.25), deviceScaleFactor: 1, mobile: false })
        assert.equal(await evaluate(client, 'document.documentElement.scrollWidth <= innerWidth + 1'), true, `${language}/${theme}/${width} overflow`)
        assert.equal(await evaluate(client, 'document.querySelector(".settings-panel").scrollWidth <= document.querySelector(".settings-panel").clientWidth + 1'), true, `${language}/${theme}/${width} panel overflow`)
        assert.equal(await evaluate(client, 'document.querySelector(".settings-scroll").clientHeight > 100'), true)
        if ((theme === 'dark' || theme === 'light') && width === 1280) {
          await evaluate(client, 'document.querySelector(".interface-size").scrollIntoView({block:"center"})')
          const capture = await client.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
          await fs.writeFile(path.join(screenshots, `${language}-${theme}-125-controls.png`), Buffer.from(capture.data, 'base64'))
        }
      }
      if (theme === 'dark' || theme === 'light') {
        await evaluate(client, 'document.querySelector(".settings-scroll").scrollTop = 0')
        const capture = await client.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
        await fs.writeFile(path.join(screenshots, `${language}-${theme}-125.png`), Buffer.from(capture.data, 'base64'))
      }
    }
  }
  await resetViewport(client)
  await click(client, '[data-scale="1"]')
  await click(client, 'button[data-theme="dark"]')
  await click(client, '.settings-group .setting-row:first-child .segmented button:first-child')
  console.log('PASS: real zoom, full attribution, both directions, four themes and three bounded viewports; fixture-only screenshots saved.')
  return originalRatio
}

async function stop(instance) {
  if (instance.process.exitCode !== null) { assert.equal(instance.process.exitCode, 0); instance.client.close(); return }
  const exited = new Promise(resolve => instance.process.once('exit', resolve))
  // Page.close can close the debugger before sending its response. The
  // acceptance condition is normal process exit, independently of that reply.
  void instance.client.send('Page.close').catch(() => {})
  let timer
  // Managed Gateway shutdown has three bounded 8-second phases (grace,
  // owned-tree fallback, final exit). Wait for that existing contract.
  try { assert.equal(await Promise.race([exited, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Electron did not quit normally')), 30000) })]), 0) }
  finally { clearTimeout(timer) }
  instance.client.close()
}

async function verifyRealLocal(instance, root, fixtures) {
  const client = instance.client, model = process.env.NAJD_REAL_OLLAMA_MODEL
  assert.match(model || '', /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/)
  await click(client, '.sidebar-link[aria-label="الإعدادات"]')
  await click(client, '.settings-nav-item:nth-child(7)')
  await click(client, '.browser-actions .browser-action')
  await waitFor(async () => await evaluate(client, 'document.querySelector(".root-path") !== null'))
  await click(client, '.settings-nav-item:nth-child(2)')
  await waitFor(async () => await evaluate(client, 'document.querySelector("[data-provider=ollama] select")?.options.length > 1'))
  await evaluate(client, `(() => { const select = document.querySelector('[data-provider=ollama] select'); select.value = ${JSON.stringify(model)}; select.dispatchEvent(new Event('change', {bubbles:true})); })()`)
  await click(client, '[data-provider=ollama] [data-action=test]')
  await waitFor(async () => (await evaluate(client, 'document.querySelector("[data-provider=ollama]").innerText')).includes('نجح طلب حقيقي إلى هذا النموذج'), 120000)
  await click(client, '[data-provider=ollama] [data-action=activate]')
  await click(client, '.topbar-back')
  await click(client, '#prompt')
  await client.send('Input.insertText', { text: 'Calculate 17 + 25. Reply with the number only.' })
  await click(client, '.send-button')
  const file = path.join(root, 'najd-data/sessions.json')
  await waitFor(async () => {
    try { const messages = JSON.parse(await fs.readFile(file, 'utf8')).sessions[0]?.messages || []; return messages.at(-1)?.role === 'assistant' && /42/.test(messages.at(-1).text) }
    catch (error) { if (error.code === 'ENOENT') return false; throw error }
  }, 120000)
  for (const decision of ['DENY', 'ALLOW_ONCE']) {
    await click(client, '#prompt')
    await client.send('Input.insertText', { text: `/ask-read ${path.join(fixtures, 'model-tool.txt')}` })
    await click(client, '.send-button')
    await waitFor(async () => await evaluate(client, 'document.querySelector(".approval-card") !== null || document.querySelector(".notice") !== null'), 120000)
    if (!await evaluate(client, 'document.querySelector(".approval-card") !== null')) {
      console.error('Real UI synthetic tool diagnostic: ' + (await fs.readFile(path.join(root, 'local-tool-diagnostic.jsonl'), 'utf8')).slice(-4096))
      assert.fail('Real UI model did not produce the required proposal')
    }
    await click(client, decision === 'DENY' ? '.approval-deny' : '.approval-allow')
    if (decision === 'DENY') {
      await waitFor(async () => await evaluate(client, 'document.querySelector(".approval-card") === null'))
      assert.equal(await evaluate(client, 'document.querySelector(".local-file-preview")'), null)
    } else await waitFor(async () => (await evaluate(client, 'document.querySelector(".local-file-preview")?.textContent || ""')).includes('MODEL-TOOL-LOCAL-ONLY'))
  }
  assert.equal((await fs.readFile(file, 'utf8')).includes('MODEL-TOOL-LOCAL-ONLY'), false)
  const limits = await client.send('Runtime.evaluate', { expression: 'window.najdProviders.limits()', awaitPromise: true, returnByValue: true })
  assert.equal(limits.result.value.cloudAttempts, 0)
  console.log('PASS: real Ollama source UI model selection, inference test/conversation, exact-file proposal deny/allow, real private preview and zero cloud attempts.')
}

async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'najd-desktop-test-'))
  const fixtures = path.join(root, 'read-fixtures')
  await fs.mkdir(fixtures)
  await fs.writeFile(path.join(fixtures, 'long.txt'), 'READ-FIXTURE '.repeat(3000))
  await fs.writeFile(path.join(fixtures, 'model-tool.txt'), 'MODEL-TOOL-LOCAL-ONLY')
  let instance
  let originalRatio
  try {
    instance = await launch(root)
    await waitFor(async () => await evaluate(instance.client, 'document.querySelector(".sidebar-link[aria-label=\\"الإعدادات\\"]") !== null'))
    if (process.argv.includes('--local-real')) { await verifyRealLocal(instance, root, fixtures); return }
    await click(instance.client, '.sidebar-link[aria-label="الإعدادات"]')
    await click(instance.client, '.settings-nav-item:last-child')
    await waitFor(async () => await evaluate(instance.client, 'document.querySelector(".gateway-status") !== null'))
    const expectedGateway = !process.argv.includes('--packaged') && require('node:fs').existsSync(path.join(__dirname, '../.runtimes/openclaw-runtime-2026.10.3/node_modules/openclaw/openclaw.mjs')) ? 'healthy' : 'not_installed'
    await waitFor(async () => {
      const result = await instance.client.send('Runtime.evaluate', { expression: 'window.najdGateway.status()', awaitPromise: true, returnByValue: true })
      return result.result.value.state === expectedGateway
    }, 60000)
    await waitFor(async () => await evaluate(instance.client, 'document.querySelector(".gateway-status").textContent.includes("' + (expectedGateway === 'healthy' ? 'تم التحقق' : 'غير جاهزة') + '")'))
    const gatewayState = await instance.client.send('Runtime.evaluate', { expression: 'window.najdGateway.status()', awaitPromise: true, returnByValue: true })
    assert.deepEqual(Object.keys(gatewayState.result.value).sort(), ['engine', 'errorCode', 'instanceId', 'state', 'verifiedAt', 'version'])
    await click(instance.client, '.settings-nav-item:first-child')
    if (process.argv.includes('--ux')) originalRatio = await verifyUx(instance)
    await click(instance.client, '.settings-group .setting-row:first-child .segmented button:last-child')
    await click(instance.client, '.settings-nav-item:last-child')
    await waitFor(async () => (await evaluate(instance.client, 'document.body.innerText')).includes('NAJD primary engine'))
    await click(instance.client, '.settings-nav-item:first-child')
    await click(instance.client, '.settings-group .setting-row:first-child .segmented button:first-child')
    await click(instance.client, '.settings-nav-item:nth-child(2)')
    await waitFor(async () => await evaluate(instance.client, 'document.querySelectorAll(".provider-group").length === 3'))
    // No usage limits exist: nothing to configure, and the fixed policy is unlimited.
    assert.equal(await evaluate(instance.client, 'document.querySelector("[data-limit], [data-action=save-limits]")'), null)
    const policyReceipt = await instance.client.send('Runtime.evaluate', { expression: 'window.najdProviders.limits()', awaitPromise: true, returnByValue: true })
    assert.equal(policyReceipt.result.value.policy.maxCloudAttempts, 0)
    assert.equal(policyReceipt.result.value.policy.maxInputChars, 0)
    await click(instance.client, '[data-group="subscription"] summary')
    assert.equal(await evaluate(instance.client, 'document.querySelectorAll("[data-group=subscription] [data-choice]").length'), 5)
    await click(instance.client, '[data-group="subscription"] [data-choice="kimi-code"]')
    await click(instance.client, '[data-provider="kimi-code"] input[type="password"]')
    await instance.client.send('Input.insertText', { text: 'sk-kimi-test-only' })
    await click(instance.client, '[data-provider="kimi-code"] [data-action="save"]')
    const credentialFile = path.join(root, 'najd-data', 'credentials.json')
    await waitFor(async () => {
      try { return (await fs.readFile(credentialFile, 'utf8')).includes('kimiCode') }
      catch { return false }
    })
    assert.equal((await fs.readFile(credentialFile, 'utf8')).includes('sk-kimi-test-only'), false)
    await waitFor(async () => await evaluate(instance.client, 'document.querySelector("[data-provider=kimi-code] input").value === ""'))
    assert.equal(await evaluate(instance.client, 'document.querySelector(".connection-receipt .verified") === null'), true)
    await click(instance.client, '[data-group="api"] summary')
    assert.equal(await evaluate(instance.client, 'document.querySelectorAll("[data-group=api] [data-choice]").length'), 30)
    await instance.client.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' })
    await instance.client.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape' })
    assert.equal(await evaluate(instance.client, 'document.querySelector("[data-group=api] details").open'), false)
    assert.equal(await evaluate(instance.client, 'document.activeElement === document.querySelector("[data-group=api] summary")'), true)
    await click(instance.client, '.topbar-back')
    await click(instance.client, '#prompt')
    await instance.client.send('Input.insertText', { text: 'NAJD isolated session smoke' })
    await waitFor(async () => await evaluate(instance.client, 'document.querySelector(".send-button")?.disabled') === false)
    await click(instance.client, '.send-button')
    await waitFor(async () => (await evaluate(instance.client, 'document.body.innerText')).includes('NAJD isolated session smoke'))
    const file = path.join(root, 'najd-data', 'sessions.json')
    await waitFor(async () => {
      try { return (JSON.parse(await fs.readFile(file, 'utf8')).sessions[0]?.messages[0]?.text === 'NAJD isolated session smoke') }
      catch { return false }
    })
    await click(instance.client, '.sidebar-link[aria-label="الإعدادات"]')
    await click(instance.client, '.settings-nav-item:nth-child(7)')
    await click(instance.client, '.browser-action')
    await waitFor(async () => await evaluate(instance.client, 'document.querySelector(".root-path") !== null'))
    await click(instance.client, '.topbar-back')
    await click(instance.client, '#prompt')
    await instance.client.send('Input.insertText', { text: `/read ${path.join(fixtures, 'long.txt')}` })
    await click(instance.client, '.send-button')
    await waitFor(async () => await evaluate(instance.client, 'document.querySelector(".approval-allow") !== null'))
    assert.equal(await evaluate(instance.client, 'document.querySelector(".new-chat").disabled'), true)
    assert.equal(await evaluate(instance.client, 'document.querySelector(".send-button").disabled'), true)
    await click(instance.client, '.approval-allow')
    await waitFor(async () => (await evaluate(instance.client, 'document.body.innerText')).includes('عُرض الجزء الأول'))
    const savedRead = JSON.parse(await fs.readFile(file, 'utf8')).sessions[0].messages.at(-1)
    assert.equal(savedRead.role, 'assistant')
    assert.ok(savedRead.text.length <= 20000)
    assert.ok(savedRead.text.includes('READ-FIXTURE'))
    await click(instance.client, '#prompt')
    await instance.client.send('Input.insertText', { text: `/ابحث ${fixtures} | long` })
    await click(instance.client, '.send-button')
    await waitFor(async () => (await evaluate(instance.client, 'document.querySelector(".approval-card")?.innerText || ""')).includes('long'))
    await click(instance.client, '.approval-deny')
    await waitFor(async () => (await evaluate(instance.client, 'document.body.innerText')).includes('لم يتم البحث عن المستندات'))
    await click(instance.client, '#prompt')
    await instance.client.send('Input.insertText', { text: `/find ${fixtures} | long` })
    await click(instance.client, '.send-button')
    await waitFor(async () => await evaluate(instance.client, 'document.querySelector(".approval-allow") !== null'))
    await click(instance.client, '.approval-allow')
    await waitFor(async () => (await evaluate(instance.client, 'document.body.innerText')).includes('نتائج البحث بأسماء المستندات:'))
    const foundMessages = JSON.parse(await fs.readFile(file, 'utf8')).sessions[0].messages
    // Results are canonical paths (Windows runners expose TEMP through an 8.3 short alias).
    assert.ok(foundMessages.at(-1).text.includes(path.join(require('node:fs').realpathSync.native(fixtures), 'long.txt')))
    assert.equal(foundMessages.at(-1).text.includes('READ-FIXTURE'), false)
    // This is a metadata lookup, not a claim that an app-open action works.
    await click(instance.client, '#prompt')
    await instance.client.send('Input.insertText', { text: '/تطبيقات' })
    await click(instance.client, '.send-button')
    await waitFor(async () => (await evaluate(instance.client, 'document.querySelector(".approval-card")?.innerText || document.body.innerText')).includes('لن يفتحها'))
    await click(instance.client, '.approval-deny')
    await waitFor(async () => (await evaluate(instance.client, 'document.body.innerText')).includes('لم يتم التحقق من التطبيقات'))
    // The Windows companion may be connected at startup (owner default); a denial must still allow no Windows action.
    await assertNoAllowedWindowsAction(root)
    await click(instance.client, '.sidebar-link[aria-label="الإعدادات"]')
    await click(instance.client, '.settings-nav-item:nth-child(7)')
    await click(instance.client, '.windows-permissions .browser-action:nth-child(2)')
    assert.equal(await evaluate(instance.client, 'document.querySelector("#prompt").value'), '/windows chrome')
    assert.equal(await evaluate(instance.client, 'document.querySelector(".approval-card")'), null)
    // The Windows companion may be connected at startup (owner default); a denial must still allow no Windows action.
    await assertNoAllowedWindowsAction(root)
    await click(instance.client, '.send-button')
    await waitFor(async () => await evaluate(instance.client, 'document.querySelector(".approval-deny") !== null'))
    await click(instance.client, '.approval-deny')
    await waitFor(async () => (await evaluate(instance.client, 'document.body.innerText')).includes('لم يُشغَّل اختبار Windows'))
    // The Windows companion may be connected at startup (owner default); a denial must still allow no Windows action.
    await assertNoAllowedWindowsAction(root)
    const nativeHost = await fs.access(path.join(__dirname, '../.runtimes/windows-node-host/Najd.WindowsNode.dll')).then(() => true, () => false)
    // Release gates set NAJD_TEST_REQUIRE_NATIVE_HOST so the native checks can never be skipped silently for want of the host.
    if (!process.argv.includes('--packaged') && !nativeHost && process.env.NAJD_TEST_REQUIRE_NATIVE_HOST === '1') throw new Error('The Windows node host is not built (npm run build:windows-node); release gates need the native checks')
    if (!process.argv.includes('--packaged') && nativeHost) {
      await click(instance.client, '#prompt')
      await instance.client.send('Input.insertText', { text: '/apps' })
      await click(instance.client, '.send-button')
      await waitFor(async () => await evaluate(instance.client, 'document.querySelector(".approval-allow") !== null'))
      await click(instance.client, '.approval-allow')
      await waitFor(async () => (await evaluate(instance.client, 'document.body.innerText')).includes('نتيجة البحث عن التطبيقات'))
      assert.ok((await evaluate(instance.client, 'document.body.innerText')).includes('Notepad: موجود'))
      // Hosted CI runners have no interactive desktop to put a window in the foreground, so Windows refuses the input
      // (PERMISSION_DENIED). The release workflow says so explicitly; the evidence records it, and the native /apps check above still runs.
      const noInteractiveDesktop = process.env.NAJD_TEST_NO_INTERACTIVE_DESKTOP === '1'
      if (process.argv.includes('--provider-only')) console.log('SKIP: interactive native app demonstrations in this provider-focused run; full desktop smoke retains both strict checks.')
      else if (noInteractiveDesktop) console.log('SKIP: interactive native app demonstrations (NAJD_TEST_NO_INTERACTIVE_DESKTOP=1, no interactive desktop on this machine).')
      for (const app of process.argv.includes('--provider-only') || noInteractiveDesktop ? [] : ['chrome', 'edge']) {
        const before = await evaluate(instance.client, 'document.body.innerText.split("اكتمل اختبار Windows وتحققت كل الخطوات.").length')
        await click(instance.client, '#prompt')
        await instance.client.send('Input.insertText', { text: `/windows ${app}` })
        await click(instance.client, '.send-button')
        await waitFor(async () => (await evaluate(instance.client, 'document.body.innerText')).includes('نافذة اختبار مستقلة'))
        await click(instance.client, '.approval-allow')
        try {
          await waitFor(async () => (await evaluate(instance.client, 'document.body.innerText.split("اكتمل اختبار Windows وتحققت كل الخطوات.").length')) > before, 45000)
        } catch (error) {
          const fixtureMessages = JSON.parse(await fs.readFile(file, 'utf8')).sessions[0].messages
          console.error(`Native ${app} fixture outcome: ${fixtureMessages.at(-1)?.text?.slice(0, 1000)}`)
          throw error
        }
        console.log(`PASS: approved ${app} window, native UIA input, process-family closure and fixture cleanup`)
      }
    }
    await click(instance.client, '.sidebar-link[aria-label="الإعدادات"]')
    await click(instance.client, '.settings-nav-item:first-child')
    await click(instance.client, '.settings-group .setting-row:first-child .segmented button:last-child')
    await click(instance.client, '.topbar-back')
    await click(instance.client, '#prompt')
    await instance.client.send('Input.insertText', { text: '/apps' })
    await click(instance.client, '.send-button')
    await waitFor(async () => (await evaluate(instance.client, 'document.body.innerText')).includes('It will not open them'))
    await click(instance.client, '.approval-deny')
    await waitFor(async () => (await evaluate(instance.client, 'document.body.innerText')).includes('Applications were not checked'))
    await click(instance.client, '#prompt')
    await instance.client.send('Input.insertText', { text: `/find ${fixtures} | long` })
    await click(instance.client, '.send-button')
    await waitFor(async () => (await evaluate(instance.client, 'document.querySelector(".approval-card")?.innerText || ""')).includes('Contents are not read'))
    await click(instance.client, '.approval-deny')
    await waitFor(async () => (await evaluate(instance.client, 'document.body.innerText')).includes('Documents were not searched'))
    await click(instance.client, '#prompt')
    await instance.client.send('Input.insertText', { text: '/windows edge' })
    await click(instance.client, '.send-button')
    await waitFor(async () => (await evaluate(instance.client, 'document.querySelector(".approval-card")?.innerText || ""')).includes('separate test window'))
    await click(instance.client, '.approval-deny')
    await waitFor(async () => (await evaluate(instance.client, 'document.body.innerText')).includes('The Windows test did not run'))
    await click(instance.client, '.sidebar-link[aria-label="Settings"]')
    await click(instance.client, '.settings-nav-item:first-child')
    await click(instance.client, '.settings-group .setting-row:first-child .segmented button:first-child')
    await click(instance.client, '.topbar-back')
    await click(instance.client, '.sidebar-link[aria-label="الإعدادات"]')
    await click(instance.client, '.settings-nav-item:nth-child(2)')
    await click(instance.client, '[data-group="subscription"] summary')
    await click(instance.client, '[data-group="subscription"] [data-choice="chatgpt"]')
    await click(instance.client, '.chatgpt-card .subscription-actions button')
    const modelSelector = JSON.stringify('.chatgpt-card select[aria-label="نماذج حسابك"]')
    await waitFor(async () => await evaluate(instance.client, `document.querySelector(${modelSelector})?.options.length > 1`))
    await evaluate(instance.client, `(() => { const model = document.querySelector(${modelSelector}); model.value = "gpt-6.1-sol"; model.dispatchEvent(new Event("change", { bubbles: true })); })()`)
    await click(instance.client, '.chatgpt-card button[aria-pressed]')
    await click(instance.client, '.chatgpt-card button[aria-label="اختبار النموذج"]')
    await waitFor(async () => (await evaluate(instance.client, 'document.querySelector(".chatgpt-card").innerText')).includes('نجح طلب حقيقي'))
    await waitFor(async () => await evaluate(instance.client, 'document.querySelector(".connection-receipt .verified")?.innerText === "تم الربط"'))
    if (global.process.argv.includes('--capture')) {
      const capture = async name => {
        await pause(200)
        const shot = await instance.client.send('Page.captureScreenshot', { format: 'png' })
        await fs.writeFile(path.join(__dirname, '..', 'release', name), Buffer.from(shot.data, 'base64'))
      }
      await fs.mkdir(path.join(__dirname, '..', 'release'), { recursive: true })
      await click(instance.client, '[data-group="subscription"] summary')
      await capture('subscriptions-ar.png')
      await click(instance.client, '[data-group="subscription"] summary')
      await click(instance.client, '.settings-nav-item:first-child')
      await click(instance.client, '.segmented[aria-label="لغة التطبيق"] button:last-child')
      await click(instance.client, '.settings-nav-item:nth-child(2)')
      await waitFor(async () => (await evaluate(instance.client, 'document.querySelector(".chatgpt-card").innerText')).includes('Continue with ChatGPT'))
      await waitFor(async () => await evaluate(instance.client, 'document.querySelector(".chatgpt-card select[aria-label=\\"Your account models\\"]")?.options.length > 1'))
      await click(instance.client, '[data-group="subscription"] summary')
      await capture('subscriptions-en.png')
      await instance.client.send('Emulation.setDeviceMetricsOverride', { width: 800, height: 720, deviceScaleFactor: 1, mobile: false })
      await capture('subscriptions-en-narrow.png')
      assert.equal(await evaluate(instance.client, 'document.documentElement.scrollWidth <= document.documentElement.clientWidth'), true)
      await resetViewport(instance.client)
      await click(instance.client, '[data-group="subscription"] summary')
      await click(instance.client, '.settings-nav-item:first-child')
      await click(instance.client, '.segmented[aria-label="App language"] button:first-child')
      await click(instance.client, '.settings-nav-item:nth-child(2)')
    }
    const chatGPTFile = path.join(root, 'najd-data', 'chatgpt.json')
    assert.equal((await fs.readFile(chatGPTFile, 'utf8')).includes('NAJD-TEST-ACCESS'), false)
    await click(instance.client, '.topbar-back')
    // The thinking slider shows one stop per level the model supports (five for the fixture model).
    await waitFor(async () => await evaluate(instance.client, 'document.querySelector(".effort-trigger") && !document.querySelector(".effort-trigger").disabled'))
    await click(instance.client, '.effort-trigger')
    await waitFor(async () => await evaluate(instance.client, 'document.querySelectorAll(".effort-stop").length === 5'))
    await click(instance.client, '.effort-trigger')
    await click(instance.client, '#prompt')
    await instance.client.send('Input.insertText', { text: 'Debug this race condition: NAJD ChatGPT fixture prompt' })
    await waitFor(async () => (await evaluate(instance.client, 'document.querySelector(".effort-trigger").textContent')).includes('قوي'))
    if (global.process.argv.includes('--capture')) {
      const shot = await instance.client.send('Page.captureScreenshot', { format: 'png' })
      await fs.writeFile(path.join(__dirname, '..', 'release/composer-ar.png'), Buffer.from(shot.data, 'base64'))
    }
    await click(instance.client, '.send-button')
    assert.equal(await evaluate(instance.client, 'Array.from(document.querySelectorAll(".composer-models select")).every(s => s.disabled)'), true)
    await waitFor(async () => (await evaluate(instance.client, 'document.body.innerText')).includes('NAJD subscription test OK'))
    // Anchored composer: messages scroll independently; the composer never leaves the view.
    assert.equal(await evaluate(instance.client, '!!document.querySelector(".chat-scroll")'), true)
    assert.equal(await evaluate(instance.client, 'getComputedStyle(document.querySelector(".chat-content")).overflowY'), 'hidden')
    assert.equal(await evaluate(instance.client, 'document.querySelector(".composer-wrap").getBoundingClientRect().bottom <= innerHeight'), true)
    // Access selector: three explicit options, all enforced by the core and selectable, persisted.
    await click(instance.client, '.access-menu summary')
    assert.equal(await evaluate(instance.client, 'document.querySelectorAll("[data-access]").length'), 3)
    assert.equal(await evaluate(instance.client, 'document.querySelector("[data-access=full]").disabled'), false)
    assert.equal(await evaluate(instance.client, 'document.querySelector("[data-access=approve]").disabled'), false)
    assert.equal(await evaluate(instance.client, 'document.querySelector("[data-access=ask]").disabled'), false)
    await click(instance.client, '[data-access=ask]')
    assert.equal(await evaluate(instance.client, 'localStorage.getItem("najd.access-mode.v1")'), 'ask')
    // Physical order stays access-left / send-right in Arabic, and the send button is circular.
    assert.equal(await evaluate(instance.client, 'document.querySelector(".access-menu").getBoundingClientRect().left < document.querySelector(".send-button").getBoundingClientRect().left'), true)
    assert.equal(await evaluate(instance.client, '(() => { const b = document.querySelector(".send-button"); return parseFloat(getComputedStyle(b).borderTopLeftRadius) >= b.getBoundingClientRect().width / 2 - 1 })()'), true)
    for (const decision of ['DENY', 'ALLOW_ONCE']) {
      await click(instance.client, '#prompt')
      await instance.client.send('Input.insertText', { text: `/ask-read ${path.join(fixtures, 'model-tool.txt')}` })
      await click(instance.client, '.send-button')
      await waitFor(async () => (await evaluate(instance.client, 'document.querySelector(".approval-card")?.innerText || ""')).includes('النموذج اقترح قراءة الملف المحدد'))
      await click(instance.client, decision === 'DENY' ? '.approval-deny' : '.approval-allow')
      if (decision === 'DENY') {
        await waitFor(async () => await evaluate(instance.client, 'document.querySelector(".approval-card") === null'))
        assert.equal(await evaluate(instance.client, 'document.querySelector(".local-file-preview")'), null)
      } else {
        await waitFor(async () => (await evaluate(instance.client, 'document.querySelector(".local-file-preview")?.textContent || ""')).includes('MODEL-TOOL-LOCAL-ONLY'))
        assert.equal((await fs.readFile(file, 'utf8')).includes('MODEL-TOOL-LOCAL-ONLY'), false)
      }
    }
    await click(instance.client, '.sidebar-link[aria-label="الإعدادات"]')
    await click(instance.client, '.settings-nav-item:nth-child(2)')
    await click(instance.client, '[data-group="api"] summary')
    await click(instance.client, '[data-group="api"] [data-choice="openai-api"]')
    await click(instance.client, '[data-provider="openai-api"] input[type="password"]')
    await instance.client.send('Input.insertText', { text: 'sk-najd-API-TEST-KEY' })
    await click(instance.client, '[data-provider="openai-api"] [data-action="save"]')
    await waitFor(async () => await evaluate(instance.client, 'document.querySelector("[data-provider=openai-api] select")?.options.length > 1'))
    await evaluate(instance.client, '(() => { const s = document.querySelector("[data-provider=openai-api] select"); s.value = "gpt-6.1-sol"; s.dispatchEvent(new Event("change", { bubbles: true })); })()')
    assert.equal(await evaluate(instance.client, 'document.querySelector(".connection-receipt .verified") === null'), true)
    await click(instance.client, '[data-provider="openai-api"] [data-action="test"]')
    await waitFor(async () => await evaluate(instance.client, 'document.querySelector(".connection-receipt .verified") !== null'))
    assert.equal((await fs.readFile(path.join(root, 'najd-data/openai-api.json'), 'utf8')).includes('sk-najd-API-TEST-KEY'), false)
    await click(instance.client, '[data-provider="openai-api"] [data-action="activate"]')
    await click(instance.client, '.topbar-back')
    await click(instance.client, '.effort-trigger')
    await waitFor(async () => await evaluate(instance.client, 'document.querySelector(".effort-track") !== null'))
    await evaluate(instance.client, '(() => { const track = document.querySelector(".effort-track"); track.focus(); track.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true })); })()')
    await waitFor(async () => await evaluate(instance.client, 'localStorage.getItem("najd.effort.v1") === "max"'))
    await click(instance.client, '.effort-trigger')
    assert.equal(await evaluate(instance.client, 'localStorage.getItem("najd.effort.v1")'), 'max')
    await click(instance.client, '#prompt')
    await instance.client.send('Input.insertText', { text: 'NAJD API manual effort fixture prompt' })
    await click(instance.client, '.send-button')
    await waitFor(async () => (await evaluate(instance.client, 'document.body.innerText')).includes('NAJD API test OK'))
    // Export: the stubbed Save dialog returns a fixture path; a repeat export must refuse to overwrite.
    await click(instance.client, '.topbar-export')
    const exportFile = path.join(root, 'export-fixture.txt')
    await waitFor(async () => { try { return (await fs.readFile(exportFile, 'utf8')).includes('NAJD API test OK') } catch { return false } })
    await click(instance.client, '.topbar-export')
    await waitFor(async () => (await evaluate(instance.client, 'document.querySelector(".export-feedback")?.textContent || ""')).includes('يوجد ملف'))
    // Search: typing filters the session list and shows a bounded snippet; clearing restores it.
    await click(instance.client, '.session-search input')
    await instance.client.send('Input.insertText', { text: 'manual effort' })
    await waitFor(async () => await evaluate(instance.client, 'document.querySelectorAll(".session-open").length') === 1)
    await waitFor(async () => await evaluate(instance.client, '(document.querySelector(".session-snippet")?.textContent || "").includes("manual effort")'))
    await evaluate(instance.client, '(() => { const i = document.querySelector(".session-search input"); const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set; set.call(i, ""); i.dispatchEvent(new Event("input", { bubbles: true })); })()')
    await waitFor(async () => await evaluate(instance.client, 'document.querySelector(".session-snippet") === null'))
    if (process.argv.includes('--ux')) {
      await click(instance.client, '.sidebar-link[aria-label="الإعدادات"]')
      await click(instance.client, '.settings-nav-item:first-child')
      await click(instance.client, '[data-scale="1.15"]')
    }
    await stop(instance)
    instance = await launch(root)
    await waitFor(async () => (await evaluate(instance.client, 'document.querySelector(".effort-trigger")?.textContent || ""')).includes('أقصى'))
    assert.equal(await evaluate(instance.client, 'localStorage.getItem("najd.effort.v1")'), 'max')
    assert.equal(await evaluate(instance.client, 'document.querySelector(".local-file-preview")'), null)
    if (process.argv.includes('--ux')) {
      await waitFor(async () => await evaluate(instance.client, 'devicePixelRatio') > originalRatio * 1.1)
      assert.equal(await evaluate(instance.client, 'JSON.parse(localStorage.getItem("najd.preferences.v1")).fontScale'), 1.15)
    }
    await waitFor(async () => (await evaluate(instance.client, 'document.body.innerText')).includes('NAJD isolated session smoke'))
    const proof = await instance.client.send('Runtime.evaluate', { expression: 'window.najdProviders.catalog().then(list => list.find(p => p.id === "openai-api"))', awaitPromise: true, returnByValue: true })
    assert.equal(proof.result.value.verified, true, JSON.stringify(proof.result.value))
    const accountProof = await instance.client.send('Runtime.evaluate', { expression: 'window.najdProviders.catalog().then(list => list.find(p => p.id === "chatgpt"))', awaitPromise: true, returnByValue: true })
    assert.equal(accountProof.result.value.verified, true, JSON.stringify(accountProof.result.value))
    assert.equal(await evaluate(instance.client, 'document.querySelectorAll(".session-open").length'), 1)
    await click(instance.client, '.session-delete')
    await waitFor(async () => await evaluate(instance.client, 'document.querySelectorAll(".session-open").length') === 0)
    assert.deepEqual(JSON.parse(await fs.readFile(file, 'utf8')).sessions, [])
    console.log('Desktop smoke passed: grouped providers, focus/Escape, encrypted keys, scoped files, ChatGPT/API model/test/chat, Auto/manual effort, export/overwrite-refusal, search, restart, reopen, delete')
  } catch (error) {
    // On a failure, say what the window showed (CI has no screen to look at).
    if (instance && instance.process.exitCode === null) {
      const state = await evaluate(instance.client, `JSON.stringify({ size: [innerWidth, innerHeight], focused: document.activeElement?.className || document.activeElement?.tagName, notice: document.querySelector(".notice")?.innerText || null, section: document.querySelector("#section-title")?.innerText || null, text: (document.querySelector(".settings-panel") || document.body).innerText.slice(0, 1200) })`).catch(() => null)
      console.error("UI state at failure:", state)
    }
    throw error
  } finally {
    if (instance && instance.process.exitCode === null) await stop(instance)
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unsafe test cleanup path')
    await fs.rm(root, { recursive: true, force: true })
  }
}

module.exports = { launch, stop, click, evaluate, waitFor, connect, freePort, waitForPage }
if (require.main === module) {
  let completed = false
  process.once('beforeExit', () => { if (!completed) { console.error('Desktop smoke did not reach completion'); process.exitCode = 1 } })
  main().then(() => { completed = true }, error => { completed = true; console.error(error); process.exitCode = 1 })
}
