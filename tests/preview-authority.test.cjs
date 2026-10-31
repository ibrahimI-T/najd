// Preview interaction authority (owner review 2026-10-31): a mocked call with a click on a localhost page reached the
// preview executor while requestApproval was never asked. These tests drive the real runtime and the real preview
// service; only the Electron window is a fake that records which steps reached the page.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const { createAgentRuntime } = require('../electron/agent-runtime.cjs')
const { createWebPreview } = require('../electron/web-preview.cjs')

// A fake preview window: the page "moves" to redirectTo after loading when asked, and every step sent to it is recorded.
function fakePreview({ redirectTo = null, stepDelayMs = 0, onStep = () => {} } = {}) {
  const sent = []
  let opened = 0
  const createSession = async () => {
    opened++
    let url = ''
    const handlers = {}
    const webContents = {
      id: opened, on: () => {}, once: (name, fn) => { handlers[name] = fn },
      getURL: () => url, insertCSS: async () => {}, capturePage: async () => ({}),
      executeJavaScript: async code => {
        const match = /^\(\(step\) => [\s\S]*\)\((\{[\s\S]*\})\)$/.exec(code)
        if (match) { const item = JSON.parse(match[1]); sent.push(item); onStep(item); if (stepDelayMs) await new Promise(resolve => setTimeout(resolve, stepDelayMs)); return item.kind === 'read' || item.kind === 'expect' ? { ok: true, value: '3' } : { ok: true } }
        return { title: 'Fixture', text: 'Count 0', height: 600, overflowX: false }
      }
    }
    const window = { webContents, destroy: () => {}, loadURL: async value => { url = redirectTo || value; setTimeout(() => handlers['did-finish-load']?.(), 0) } }
    return { window, release: async () => {}, screenshot: async () => ({}) }
  }
  return { sent, sessions: () => opened, createSession }
}

function service(fake, root) {
  return createWebPreview({ createSession: fake.createSession, isPublicUrl: () => true, resolveFile: async file => file, baseDirectory: root, prepareImage: async () => 'data:image/png;base64,AA', timeoutMs: 8000 })
}

// One model turn per call; returns each tool result the model received and every approval request.
async function drive(webPreview, calls, { approve = 'ALLOW_ONCE', signal } = {}) {
  const approvals = [], outputs = []
  const runtime = createAgentRuntime({ catalog: { search: async () => [], details: async () => ({}), summary: async () => '' }, library: { list: async () => [] }, webPreview })
  const queue = calls.map((args, index) => ({ kind: 'agent-tools', calls: [{ name: 'najd_web_preview', arguments: JSON.stringify({ width: 800, fullPage: false, ...args }), call_id: 'p' + index }], items: [] }))
  let result, failure
  try {
    result = await runtime.run({ request: { text: 'Test the page buttons.', conversationId: 'preview' }, signal,
      requestApproval: async (tool, input) => { approvals.push({ tool, input: structuredClone(input) }); return typeof approve === 'function' ? approve(tool, input) : approve },
      respond: async ({ input }) => {
        const last = input.at(-1)
        if (last?.type === 'function_call_output') outputs.push(JSON.parse(last.output))
        return queue.shift() || { kind: 'message', text: 'done' }
      } })
  } catch (error) { failure = error }
  return { approvals, outputs, result, failure }
}

const temp = t => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'najd-preview-authority-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir }
const clicks = JSON.stringify([{ click: '#add' }, { click: '#add' }, { click: '#add' }, { expect: '#count', text: '3' }])

test('a read-only localhost preview asks for nothing and sends no interaction', async () => {
  const fake = fakePreview()
  const { approvals, outputs } = await drive(service(fake), [{ target: 'http://localhost:5173/', steps: JSON.stringify([{ read: '#count' }]) }])
  assert.equal(approvals.length, 0)
  assert.equal(outputs[0].status, 'captured'); assert.deepEqual(fake.sent.map(item => item.kind), ['read'])
})

test('clicks on a localhost page wait for approval of that exact address and steps, and run once when approved', async () => {
  const fake = fakePreview()
  const { approvals, outputs } = await drive(service(fake), [{ target: 'http://127.0.0.1:5173/app', steps: clicks }])
  assert.equal(approvals.length, 1)
  assert.equal(approvals[0].tool, 'najd-web-preview'); assert.equal(approvals[0].input.path, 'http://127.0.0.1:5173/app')
  assert.match(approvals[0].input.summary, /1\. click "#add"\n2\. click "#add"\n3\. click "#add"\n4\. expect "#count" = "3"/)
  assert.equal(fake.sent.filter(item => item.kind === 'click').length, 3, 'each approved click is sent exactly once')
  assert.equal(outputs[0].stepsPassed, true)
})

test('a denied interaction loads nothing and sends no step', async () => {
  const fake = fakePreview()
  const { approvals, outputs } = await drive(service(fake), [{ target: 'http://localhost:3000/', steps: clicks }], { approve: 'DENY' })
  assert.equal(approvals.length, 1); assert.equal(outputs[0].status, 'denied_by_user')
  assert.equal(fake.sessions(), 0); assert.equal(fake.sent.length, 0)
})

test('without an approval channel a localhost click is refused before any page opens', async () => {
  const fake = fakePreview()
  await assert.rejects(service(fake).capture({ target: 'http://localhost:3000/', steps: clicks }), { code: 'PERMISSION_DENIED' })
  assert.equal(fake.sessions(), 0)
})

test('a page that moved to another origin after approval gets no click', async () => {
  const fake = fakePreview({ redirectTo: 'http://localhost:8080/admin' })
  const { approvals, outputs } = await drive(service(fake), [{ target: 'http://localhost:3000/', steps: clicks }])
  assert.equal(approvals.length, 1)
  assert.equal(fake.sent.length, 0)
  assert.equal(outputs[0].steps[0].error, 'TARGET_CHANGED'); assert.equal(outputs[0].stepsPassed, false)
})

test('the steps that run are the ones approved, even if the request object changes while the approval is open', async () => {
  const fake = fakePreview()
  const preview = service(fake)
  const request = { target: 'http://localhost:3000/', steps: JSON.stringify([{ click: '#safe' }]) }
  const result = await preview.capture(request, { authorize: async ({ steps }) => {
    request.steps = JSON.stringify([{ click: '#delete-everything' }])
    assert.ok(Object.isFrozen(steps) && Object.isFrozen(steps[0]))
    try { steps[0].target = '#delete-everything' } catch {}
    return true
  } })
  assert.equal(result.status, 'captured')
  assert.deepEqual(fake.sent.map(item => item.target), ['#safe'])
})

test('a cancel while steps run sends no further step, and the outcome is reported as uncertain, not retried', async () => {
  const controller = new AbortController()
  const fake = fakePreview({ stepDelayMs: 50, onStep: item => { if (item.kind === 'click') controller.abort() } })
  const preview = service(fake)
  await assert.rejects(preview.capture({ target: 'http://localhost:3000/', steps: clicks }, { signal: controller.signal, authorize: async () => true }),
    error => error.code === 'CANCELLED' && error.effectUnknown === true)
  assert.equal(fake.sent.length, 1, 'only the step already sent ran')
})

test('an interaction that timed out is not sent again when the model repeats it', async () => {
  const fake = fakePreview({ stepDelayMs: 3000 })
  const preview = createWebPreview({ createSession: fake.createSession, isPublicUrl: () => true, resolveFile: async file => file, prepareImage: async () => 'x', timeoutMs: 1500 })
  const call = { target: 'http://localhost:3000/', steps: clicks }
  const { approvals, outputs } = await drive(preview, [call, call])
  assert.equal(outputs[0].error, 'TIMEOUT'); assert.equal(outputs[0].effectUnknown, true)
  assert.equal(outputs[1].error, 'UNKNOWN_EFFECT_NOT_REPEATED')
  assert.equal(approvals.length, 1, 'the repeat was refused before it asked again')
  assert.equal(fake.sent.length, 1)
})

test('a task-written local counter file is tested with clicks without approval, in one call', async t => {
  const root = temp(t)
  fs.writeFileSync(path.join(root, 'counter.html'), '<button id="add">+</button><span id="count">0</span>')
  const fake = fakePreview()
  const { approvals, outputs } = await drive(service(fake, root), [{ target: path.join(root, 'counter.html'), steps: clicks }])
  assert.equal(approvals.length, 0)
  assert.equal(fake.sent.filter(item => item.kind === 'click').length, 3); assert.equal(outputs[0].stepsPassed, true)
})

test('interaction steps on a public site stay refused', async () => {
  const fake = fakePreview()
  const preview = createWebPreview({ createSession: fake.createSession, isPublicUrl: () => true, resolveFile: async file => file, prepareImage: async () => 'x',
    lookup: (_host, _options, callback) => callback(null, [{ address: '93.184.216.34', family: 4 }]) })
  const { approvals, outputs } = await drive(preview, [{ target: 'https://example.com/', steps: clicks }])
  assert.equal(outputs[0].error, 'URL_NOT_ALLOWED'); assert.equal(approvals.length, 0); assert.equal(fake.sent.length, 0)
})

test('the preview network rules still only read: no other loopback port and no form posts', async () => {
  const fake = fakePreview()
  let during = null
  const preview = createWebPreview({ createSession: fake.createSession, isPublicUrl: () => true, resolveFile: async file => file, timeoutMs: 8000,
    prepareImage: async () => { during = await Promise.all([['http://localhost:3000/x.js', 'GET'], ['http://localhost:3000/form', 'POST'], ['http://localhost:8080/', 'GET'], ['http://127.0.0.1:3000/', 'GET']]
      .map(([url, method]) => preview.allowRequest(1, url, method))); return 'x' } })
  await preview.capture({ target: 'http://localhost:3000/', steps: JSON.stringify([{ click: '#add' }]) }, { authorize: async () => true })
  assert.deepEqual(during, [true, false, false, false], 'same origin reads only, while the capture is live')
  assert.equal(await preview.allowRequest(1, 'http://localhost:3000/'), false, 'nothing after the capture ends')
})

test('a file:/// address of a local file is the same file, under the same folder rules', async t => {
  const root = temp(t)
  fs.writeFileSync(path.join(root, 'page.html'), '<p>hi</p>')
  const fake = fakePreview()
  const preview = service(fake, root)
  const url = require('node:url').pathToFileURL(path.join(root, 'page.html')).href
  assert.equal((await preview.capture({ target: url, steps: '' })).status, 'captured')
  await assert.rejects(preview.capture({ target: 'file://server/share/page.html', steps: '' }), { code: 'URL_NOT_ALLOWED' })
})

// Independent review of 0.10.17: a failure after the interaction loop (page text, screenshot, image processing, a cancel or
// the deadline) must not make clicks already sent to a server look safe to repeat.
test('a failure after approved clicks were sent keeps the effect unknown, and the model cannot resend them', async () => {
  for (const stage of ['image', 'cancel']) {
    const controller = new AbortController()
    const fake = fakePreview()
    const preview = createWebPreview({ createSession: fake.createSession, isPublicUrl: () => true, resolveFile: async file => file, timeoutMs: 8000,
      prepareImage: async () => { if (stage === 'cancel') { controller.abort(); await new Promise(resolve => setTimeout(resolve, 50)) } throw Object.assign(new Error('CAPTURE_FAILED'), { code: 'CAPTURE_FAILED' }) } })
    await assert.rejects(preview.capture({ target: 'http://localhost:3000/', steps: clicks }, { signal: controller.signal, authorize: async () => true }),
      error => error.effectUnknown === true && (stage === 'cancel' ? error.code === 'CANCELLED' : error.code === 'CAPTURE_FAILED'))
    assert.equal(fake.sent.filter(item => item.kind === 'click').length, 3)
  }
  const fake = fakePreview()
  const preview = createWebPreview({ createSession: fake.createSession, isPublicUrl: () => true, resolveFile: async file => file, timeoutMs: 8000,
    prepareImage: async () => { throw Object.assign(new Error('CAPTURE_FAILED'), { code: 'CAPTURE_FAILED' }) } })
  const call = { target: 'http://localhost:3000/', steps: clicks }
  const { approvals, outputs } = await drive(preview, [call, call])
  assert.equal(outputs[0].effectUnknown, true); assert.equal(outputs[1].error, 'UNKNOWN_EFFECT_NOT_REPEATED')
  assert.equal(approvals.length, 1); assert.equal(fake.sent.filter(item => item.kind === 'click').length, 3, 'three clicks, not six')
})

test('a failure after only file-page clicks or reads is an ordinary failure (nothing left the page)', async t => {
  const root = temp(t)
  fs.writeFileSync(path.join(root, 'counter.html'), '<button id="add">+</button>')
  const fake = fakePreview()
  const preview = createWebPreview({ createSession: fake.createSession, isPublicUrl: () => true, resolveFile: async file => file, baseDirectory: root, timeoutMs: 8000,
    prepareImage: async () => { throw Object.assign(new Error('CAPTURE_FAILED'), { code: 'CAPTURE_FAILED' }) } })
  await assert.rejects(preview.capture({ target: path.join(root, 'counter.html'), steps: clicks }), error => error.code === 'CAPTURE_FAILED' && !error.effectUnknown)
})
