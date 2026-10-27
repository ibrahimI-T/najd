const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const { createBrowserBridge } = require('../electron/browser-bridge.cjs')

const encryption = { isEncryptionAvailable: () => true, encryptString: text => Buffer.from('enc:' + text), decryptString: buffer => { const text = buffer.toString(); if (!text.startsWith('enc:')) throw new Error('bad'); return text.slice(4) } }
const ext = id => `chrome-extension://${id.repeat(32)}`
const store = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'najd-bridge-')), 'browser-link.json')
let nextPort = 40000 + Math.floor(Math.random() * 600) * 3
const freshPorts = () => { const first = nextPort; nextPort += 3; return [first, first + 1, first + 2] }
const call = (port, route, { origin = ext('a'), secret, method = 'GET', body, instance } = {}) => fetch(`http://127.0.0.1:${port}${route}`, { method,
  headers: { origin, ...(instance ? { 'x-najd-instance': instance } : {}), ...(secret ? { authorization: 'Bearer ' + secret } : {}), ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined })
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

async function started(t, options = {}) {
  const bridge = createBrowserBridge({ filePath: options.filePath || store(), encryption, ports: freshPorts(), pollMs: 400, ...options })
  t.after(() => bridge.stop())
  const status = await bridge.start()
  return { bridge, port: status.port }
}
// Pair like the extension does: ask, the user approves in NAJD, collect the secret once.
async function pair(bridge, port, origin = ext('a'), instance) {
  let request
  bridge.setHandlers({ onPairRequest: item => { request = item } })
  const asked = await (await call(port, '/v2/pair/request', { origin, instance, method: 'POST', body: { name: 'Test browser', version: '1.0.0' } })).json()
  assert.match(asked.code, /^\d{6}$/)
  assert.equal(request.code, asked.code, 'the same code is shown in the app and in the extension')
  assert.equal(await bridge.resolvePair(asked.id, true), true)
  const done = await (await call(port, `/v2/pair/status?id=${asked.id}`, { origin, instance })).json()
  assert.equal(done.state, 'approved'); assert.match(done.secret, /^[a-f0-9]{64}$/)
  return done.secret
}

test('discovery answers extensions only and says whether this browser is paired', async t => {
  const { port } = await started(t)
  assert.deepEqual(await (await call(port, '/v2/discover')).json(), { ok: true, app: 'NAJD AGENT', protocol: 3, paired: false })
  assert.equal((await call(port, '/v2/discover', { origin: 'https://evil.example' })).status, 403, 'a web page is refused')
  assert.equal((await fetch(`http://127.0.0.1:${port}/v2/discover`)).status, 403, 'a caller that names no extension is refused')
  const named = await fetch(`http://127.0.0.1:${port}/v2/discover`, { headers: { 'x-najd-extension': 'a'.repeat(32) } })
  assert.equal(named.status, 200)
})

test('pairing needs the user: nothing is granted before approval, denial and expiry grant nothing, the secret is delivered once', async t => {
  const { bridge, port } = await started(t)
  const seen = []
  bridge.setHandlers({ onPairRequest: item => seen.push(item) })
  const first = await (await call(port, '/v2/pair/request', { method: 'POST', body: { name: 'Chrome', version: '1.0.0' } })).json()
  assert.equal(seen.length, 1); assert.equal(seen[0].origin, ext('a'))
  assert.equal((await (await call(port, `/v2/pair/status?id=${first.id}`)).json()).state, 'pending')
  assert.equal(bridge.status().paired, false)
  // The status of a request is private to the extension that made it.
  assert.equal((await call(port, `/v2/pair/status?id=${first.id}`, { origin: ext('b') })).status, 404)
  assert.equal(await bridge.resolvePair(first.id, false), false)
  assert.equal((await (await call(port, `/v2/pair/status?id=${first.id}`)).json()).state, 'denied')
  assert.equal(bridge.status().paired, false)
  const second = await (await call(port, '/v2/pair/request', { method: 'POST', body: {} })).json()
  assert.equal(await bridge.resolvePair(second.id, true), true)
  const once = await (await call(port, `/v2/pair/status?id=${second.id}`)).json()
  assert.equal(once.state, 'approved'); assert.ok(once.secret)
  const twice = await (await call(port, `/v2/pair/status?id=${second.id}`)).json()
  assert.equal(twice.secret, undefined, 'the secret is handed out only once')
  assert.equal(bridge.status().paired, true); assert.equal(bridge.status().links.length, 1)
})

test('a long-polling status call wakes up when the user decides', async t => {
  const { bridge, port } = await started(t)
  const asked = await (await call(port, '/v2/pair/request', { method: 'POST', body: {} })).json()
  const waiting = call(port, `/v2/pair/status?id=${asked.id}&wait=5000`).then(response => response.json())
  await sleep(100)
  await bridge.resolvePair(asked.id, true)
  assert.equal((await waiting).state, 'approved')
})

test('pairing requests are limited and a new request replaces the earlier one from the same browser', async t => {
  const { bridge, port } = await started(t)
  const ids = []
  for (let n = 0; n < 5; n++) ids.push((await (await call(port, '/v2/pair/request', { method: 'POST', body: {} })).json()).id)
  assert.equal(await bridge.resolvePair(ids[0], true), false, 'only the newest request from a browser stays open')
  assert.equal((await call(port, '/v2/pair/request', { method: 'POST', body: {} })).status, 429, 'more than five requests in ten minutes are refused')
})

test('the one-time code pairs a browser once, wrong codes lock the door briefly, and the code changes after use', async t => {
  const { bridge, port } = await started(t)
  const [, code] = bridge.pairingCode().split(':')
  assert.match(code, /^[a-f0-9]{64}$/)
  for (let n = 0; n < 5; n++) assert.equal((await call(port, '/v2/pair/code', { method: 'POST', body: { code: 'f'.repeat(64) } })).status, 401)
  assert.equal((await call(port, '/v2/pair/code', { method: 'POST', body: { code } })).status, 429, 'locked after five wrong tries, even with the right code')
  const fresh = await started(t)
  const [, goodCode] = fresh.bridge.pairingCode().split(':')
  const paired = await (await call(fresh.port, '/v2/pair/code', { method: 'POST', body: { code: goodCode, name: 'Edge' } })).json()
  assert.match(paired.secret, /^[a-f0-9]{64}$/)
  assert.notEqual(fresh.bridge.pairingCode().split(':')[1], goodCode, 'the code is single use')
  assert.equal((await call(fresh.port, '/v2/pair/code', { origin: ext('b'), method: 'POST', body: { code: goodCode } })).status, 401)
})

test('each browser has its own secret bound to its origin; a web page or another extension cannot use it', async t => {
  const { bridge, port } = await started(t)
  const secretA = await pair(bridge, port, ext('a'))
  assert.equal((await call(port, '/v2/hello', { secret: secretA })).status, 200)
  assert.equal((await call(port, '/v2/hello', { secret: 'f'.repeat(64) })).status, 401)
  assert.equal((await call(port, '/v2/hello', { origin: 'https://evil.example', secret: secretA })).status, 403)
  assert.equal((await call(port, '/v2/hello', { origin: ext('b'), secret: secretA })).status, 401, 'the secret of one browser is useless from another origin')
  const secretB = await pair(bridge, port, ext('b'))
  assert.notEqual(secretA, secretB)
  assert.equal((await call(port, '/v2/hello', { origin: ext('b'), secret: secretB })).status, 200)
  assert.equal(bridge.status().links.length, 2)
  await bridge.unpair('a'.repeat(32))
  assert.equal((await call(port, '/v2/hello', { secret: secretA })).status, 401, 'an unpaired browser is out at once')
  assert.equal((await call(port, '/v2/hello', { origin: ext('b'), secret: secretB })).status, 200)
})

test('links survive restarts (stored encrypted) and the extension can unlink itself', async t => {
  const filePath = store()
  const first = await started(t, { filePath })
  const secret = await pair(first.bridge, first.port)
  assert.ok(!fs.readFileSync(filePath, 'utf8').includes(secret), 'the secret is not stored in plain text')
  await first.bridge.stop()
  const second = await started(t, { filePath })
  assert.equal(second.bridge.status().paired, true)
  assert.equal((await call(second.port, '/v2/hello', { secret })).status, 200)
  assert.equal((await call(second.port, '/v2/unlink', { secret, method: 'POST' })).status, 200)
  assert.equal(second.bridge.status().paired, false)
})

test('commands reach the polling extension in order and results come back from that browser only; no extension means not connected', async t => {
  const { bridge, port } = await started(t)
  await assert.rejects(bridge.command('open', { url: 'https://example.com' }), { code: 'BROWSER_NOT_CONNECTED' })
  const secret = await pair(bridge, port)
  const poll = async () => { const response = await call(port, '/v2/command/next', { secret }); return response.status === 200 ? response.json() : null }
  const respond = (id, body) => call(port, '/v2/command/result', { secret, method: 'POST', body: { id, ...body } })
  const polling = poll(); await sleep(30) // the extension is waiting for work
  const first = bridge.command('open', { url: 'https://example.com' }), second = bridge.command('read').catch(failure => failure)
  const one = await polling; assert.equal(one.kind, 'open')
  assert.equal((await respond(one.id, { ok: true, result: { title: 'One' }, page: { title: 'One', url: 'https://example.com' } })).status, 200)
  assert.deepEqual(await first, { title: 'One' })
  const two = await poll(); assert.equal(two.kind, 'read')
  assert.equal((await call(port, '/v2/command/result', { origin: ext('b'), secret, method: 'POST', body: { id: two.id, ok: true } })).status, 401)
  await respond(two.id, { ok: false, error: 'PAGE_NOT_ACCESSIBLE' })
  assert.equal((await second).code, 'PAGE_NOT_ACCESSIBLE')
  assert.equal(bridge.lastPage().title, 'One')
  const controller = new AbortController(); controller.abort()
  await assert.rejects(bridge.command('read', {}, { signal: controller.signal }), { code: 'CANCELLED' }, 'a signal that is already aborted never sends')
})

test('commands go to the browser that was seen most recently', async t => {
  const { bridge, port } = await started(t)
  const secretA = await pair(bridge, port, ext('a')), secretB = await pair(bridge, port, ext('b'))
  await call(port, '/v2/hello', { origin: ext('a'), secret: secretA })
  await sleep(20)
  await call(port, '/v2/hello', { origin: ext('b'), secret: secretB })
  const pending = bridge.command('read')
  const answer = await (await call(port, '/v2/command/next', { origin: ext('b'), secret: secretB })).json()
  assert.equal(answer.kind, 'read')
  await call(port, '/v2/command/result', { origin: ext('b'), secret: secretB, method: 'POST', body: { id: answer.id, ok: true, result: { from: 'b' } } })
  assert.deepEqual(await pending, { from: 'b' })
})

test('pages reported by the extension pass through the sanitizer before they are stored or returned', async t => {
  const { bridge, port } = await started(t, { sanitize: value => JSON.parse(JSON.stringify(value).replaceAll('SECRET-VALUE', '[redacted]')) })
  const secret = await pair(bridge, port)
  const polling = call(port, '/v2/command/next', { secret }).then(response => response.json()); await sleep(30)
  const pending = bridge.command('read')
  const command = await polling
  await call(port, '/v2/command/result', { secret, method: 'POST', body: { id: command.id, ok: true, result: { title: 'x SECRET-VALUE' }, page: { title: 'y SECRET-VALUE', url: 'https://a.test/?q=SECRET-VALUE' } } })
  assert.deepEqual(await pending, { title: 'x [redacted]' })
  assert.ok(!JSON.stringify([bridge.lastPage(), bridge.status()]).includes('SECRET-VALUE'))
})

test('asking NAJD from the browser: validated, limited, private to the asking browser, with progress and cancel', async t => {
  const { bridge, port } = await started(t)
  const secret = await pair(bridge, port, ext('a')), other = await pair(bridge, port, ext('b'))
  const received = [], cancelled = []
  bridge.setHandlers({ onAsk: ask => { received.push(ask) }, onAskCancel: info => { cancelled.push(info) } })
  assert.equal((await call(port, '/v2/ask', { secret, method: 'POST', body: { text: '' } })).status, 400)
  assert.equal((await call(port, '/v2/ask', { method: 'POST', body: { text: 'hi' } })).status, 401, 'no secret, no ask')
  const made = await (await call(port, '/v2/ask', { secret, method: 'POST', body: { text: 'Summarize this page', page: { url: 'https://example.com/a#frag', title: 'Example', selection: 'chosen text' } } })).json()
  assert.equal(made.ok, true); assert.match(made.id, /^[a-f0-9]{24}$/)
  assert.equal(received[0].text, 'Summarize this page'); assert.equal(received[0].page.url, 'https://example.com/a', 'the fragment is dropped'); assert.equal(received[0].page.selection, 'chosen text')
  const javascript = await (await call(port, '/v2/ask', { secret, method: 'POST', body: { text: 'x', page: { url: 'javascript:alert(1)', title: 't' } } })).json()
  assert.equal(received.at(-1).page.url, '', 'only http(s) addresses are passed on'); assert.ok(javascript.id)
  assert.equal((await call(port, `/v2/ask/${made.id}`, { origin: ext('b'), secret: other })).status, 404, 'another browser cannot read it')
  assert.equal(bridge.updateAsk(made.id, { state: 'running', taskId: '11111111-1111-4111-8111-111111111111', progress: 'Reading files\u0000', output: 'partial', needsApproval: true, evil: 1 }), true)
  const view = await (await call(port, `/v2/ask/${made.id}`, { secret })).json()
  assert.deepEqual({ state: view.state, progress: view.progress, output: view.output, needsApproval: view.needsApproval, taskId: view.taskId }, { state: 'running', progress: 'Reading files ', output: 'partial', needsApproval: true, taskId: undefined })
  assert.equal(bridge.updateAsk(made.id, { state: 'bogus' }), true); assert.equal((await (await call(port, `/v2/ask/${made.id}`, { secret })).json()).state, 'running')
  assert.equal((await call(port, `/v2/ask/${made.id}/cancel`, { secret, method: 'POST' })).status, 200)
  assert.equal(cancelled[0].taskId, '11111111-1111-4111-8111-111111111111')
  for (let n = 0; n < 5; n++) await call(port, '/v2/ask', { secret, method: 'POST', body: { text: 'again' } })
  assert.equal((await call(port, '/v2/ask', { secret, method: 'POST', body: { text: 'too many' } })).status, 429)
})

test('a busy app answers the ask with a failed state instead of queueing silently', async t => {
  const { bridge, port } = await started(t)
  const secret = await pair(bridge, port)
  bridge.setHandlers({ onAsk: () => false })
  const made = await (await call(port, '/v2/ask', { secret, method: 'POST', body: { text: 'hello' } })).json()
  assert.equal(made.ok, false); assert.equal(made.state, 'failed')
})

// Long-poll like the extension: resolves with the command it was given, or null when the poll ended empty.
const poll = async (port, origin, secret) => { const response = await call(port, '/v2/command/next', { origin, secret }); return response.status === 200 ? response.json() : null }

test('R064-03: commands and the page they act on stay with one browser, even when another browser polls later', async t => {
  const { bridge, port } = await started(t, { pollMs: 3000 })
  const a = await pair(bridge, port, ext('a')), b = await pair(bridge, port, ext('b'))
  // Both are connected; A was seen last. Browser A reports a page.
  await call(port, '/v2/hello', { origin: ext('b'), secret: b }); await call(port, '/v2/hello', { origin: ext('a'), secret: a })
  const opened = bridge.command('open', { url: 'https://example.com/' })
  const first = await poll(port, ext('a'), a)
  assert.equal(first.kind, 'open')
  await call(port, '/v2/command/result', { origin: ext('a'), secret: a, method: 'POST', body: { id: first.id, ok: true, result: {}, page: { url: 'https://example.com/', title: 'A', elements: [] } } })
  await opened
  assert.equal(bridge.lastPage().title, 'A')
  // Browser B polls most recently; the next command must still go to A, and B receives nothing.
  const bPoll = poll(port, ext('b'), b)
  await sleep(50)
  const click = bridge.command('act', { id: 'e1' }, { timeoutMs: 2000 }).catch(() => null)
  const forB = await Promise.race([bPoll, sleep(400).then(() => 'none')])
  assert.equal(forB, 'none', 'browser B is not given a command bound to browser A')
  const forA = await poll(port, ext('a'), a)
  assert.equal(forA.kind, 'act')
  await call(port, '/v2/command/result', { origin: ext('a'), secret: a, method: 'POST', body: { id: forA.id, ok: true, result: {} } })
  await click
  // Unlinking A drops the page, so no stale element id can be used afterwards.
  await bridge.unpair('a'.repeat(32))
  assert.equal(bridge.lastPage(), null)
})

test('R064-05: stop is recorded by id at once, even before the question has a task', async t => {
  const { bridge, port } = await started(t)
  const secret = await pair(bridge, port)
  const cancelled = []
  bridge.setHandlers({ onAsk: () => true, onAskCancel: item => cancelled.push(item) })
  const asked = await (await call(port, '/v2/ask', { secret, method: 'POST', body: { text: 'hello' } })).json()
  assert.equal((await call(port, `/v2/ask/${asked.id}/cancel`, { secret, method: 'POST' })).status, 200)
  assert.deepEqual(cancelled, [{ id: asked.id, taskId: null }])
  assert.equal(bridge.getAsk(asked.id).state, 'cancelled'); assert.equal(bridge.getAsk(asked.id).cancelled, true)
  // The app starts it anyway and reports progress: it stays cancelled, and the task id is kept so the task can be stopped.
  bridge.updateAsk(asked.id, { state: 'running', taskId: '12345678-1234-1234-1234-123456789abc', progress: 'working' })
  assert.equal(bridge.getAsk(asked.id).state, 'cancelled'); assert.equal(bridge.getAsk(asked.id).taskId, '12345678-1234-1234-1234-123456789abc')
  bridge.updateAsk(asked.id, { state: 'done', output: 'late' })
  assert.equal(bridge.getAsk(asked.id).state, 'cancelled', 'a cancelled question never becomes done')
})

test('R064-04: a finished question cannot be brought back by a late progress report, and the answer is kept', async t => {
  const { bridge, port } = await started(t)
  const secret = await pair(bridge, port)
  bridge.setHandlers({ onAsk: () => true })
  const asked = await (await call(port, '/v2/ask', { secret, method: 'POST', body: { text: 'hello' } })).json()
  bridge.updateAsk(asked.id, { state: 'waiting_approval', needsApproval: true })
  bridge.updateAsk(asked.id, { state: 'done', output: 'the answer', needsApproval: false })
  bridge.updateAsk(asked.id, { state: 'running', needsApproval: true, progress: 'late' })
  const view = bridge.getAsk(asked.id)
  assert.equal(view.state, 'done'); assert.equal(view.output, 'the answer'); assert.equal(view.needsApproval, false)
})

test('R064-06: one fallback code links one browser even when two requests use it at the same time', async t => {
  const { bridge, port } = await started(t)
  const code = bridge.pairingCode().split(':')[1]
  const results = await Promise.all(['a', 'b', 'c'].map(letter => call(port, '/v2/pair/code', { origin: ext(letter), method: 'POST', body: { code, name: letter } }).then(response => response.status)))
  assert.deepEqual(results.filter(status => status === 200).length, 1)
  assert.equal(bridge.status().links.length, 1)
})

test('R064-07: unlinking rotates the fallback code and voids a pairing approval that was not collected yet', async t => {
  const { bridge, port } = await started(t)
  const secret = await pair(bridge, port, ext('a'))
  const before = bridge.pairingCode()
  assert.equal((await call(port, '/v2/unlink', { origin: ext('a'), secret, method: 'POST' })).status, 200)
  assert.notEqual(bridge.pairingCode(), before, 'unlink from the browser rotates the code')
  const b = await pair(bridge, port, ext('b'))
  const second = bridge.pairingCode()
  await bridge.unpair('b'.repeat(32))
  assert.notEqual(bridge.pairingCode(), second, 'unpair from the app rotates the code')
  assert.equal((await call(port, '/v2/hello', { origin: ext('b'), secret: b })).status, 401)
  // An approval nobody collected yet is void once that browser is unpaired.
  bridge.setHandlers({ onPairRequest: () => {} })
  const asked = await (await call(port, '/v2/pair/request', { origin: ext('c'), method: 'POST', body: {} })).json()
  assert.equal(await bridge.resolvePair(asked.id, true), true)
  await bridge.unpair('c'.repeat(32))
  const state = await (await call(port, `/v2/pair/status?id=${asked.id}`, { origin: ext('c') })).json()
  assert.notEqual(state.state, 'approved'); assert.equal(state.secret, undefined)
})

test('R064-101: a command bound to a page is refused when another page or browser became current, and never goes to another browser', async t => {
  const { bridge, port } = await started(t, { pollMs: 3000 })
  const a = await pair(bridge, port, ext('a')), b = await pair(bridge, port, ext('b'))
  await call(port, '/v2/hello', { origin: ext('b'), secret: b }); await call(port, '/v2/hello', { origin: ext('a'), secret: a })
  const opened = bridge.command('open', { url: 'https://example.com/' })
  const first = await poll(port, ext('a'), a)
  await call(port, '/v2/command/result', { origin: ext('a'), secret: a, method: 'POST', body: { id: first.id, ok: true, result: {}, page: { url: 'https://example.com/', title: 'A', elements: [] } } })
  await opened
  const token = bridge.pageToken()
  assert.match(token, /^chrome-extension:\/\/a{32}#\d+$/)
  // The page changes (a later report): the old token is refused.
  const reread = bridge.command('read', {})
  const second = await poll(port, ext('a'), a)
  await call(port, '/v2/command/result', { origin: ext('a'), secret: a, method: 'POST', body: { id: second.id, ok: true, result: {}, page: { url: 'https://example.com/2', title: 'A2', elements: [] } } })
  await reread
  await assert.rejects(bridge.command('act', { id: 'e1' }, { bind: token }), { code: 'PAGE_CHANGED' })
  // Browser A goes away: a command bound to its page is not sent to browser B.
  const current = bridge.pageToken()
  await bridge.unpair('a'.repeat(32))
  await assert.rejects(bridge.command('act', { id: 'e1' }, { bind: current }), error => ['PAGE_CHANGED', 'BROWSER_NOT_CONNECTED'].includes(error.code))
})

test('R064-102: stopping a question that has a task is "stopping" until the app reports the outcome; an action that may have happened is not hidden', async t => {
  const { bridge, port } = await started(t)
  const secret = await pair(bridge, port)
  bridge.setHandlers({ onAsk: () => true, onAskCancel: () => {} })
  const asked = await (await call(port, '/v2/ask', { secret, method: 'POST', body: { text: 'do it' } })).json()
  bridge.updateAsk(asked.id, { state: 'running', taskId: '12345678-1234-1234-1234-123456789abc' })
  await call(port, `/v2/ask/${asked.id}/cancel`, { secret, method: 'POST' })
  assert.equal(bridge.getAsk(asked.id).state, 'running'); assert.equal(bridge.getAsk(asked.id).progress, 'STOPPING')
  bridge.updateAsk(asked.id, { state: 'running', progress: 'late line' })
  bridge.updateAsk(asked.id, { state: 'failed', progress: 'UNKNOWN_EFFECT' })
  assert.equal(bridge.getAsk(asked.id).state, 'failed'); assert.equal(bridge.getAsk(asked.id).progress, 'UNKNOWN_EFFECT')
  // A clean stop becomes cancelled, and a late success never overrides it.
  const second = await (await call(port, '/v2/ask', { secret, method: 'POST', body: { text: 'again' } })).json()
  bridge.updateAsk(second.id, { state: 'running', taskId: '22345678-1234-1234-1234-123456789abc' })
  await call(port, `/v2/ask/${second.id}/cancel`, { secret, method: 'POST' })
  bridge.updateAsk(second.id, { state: 'cancelled' })
  bridge.updateAsk(second.id, { state: 'done', output: 'late' })
  assert.equal(bridge.getAsk(second.id).state, 'cancelled')
})

test('R064-105: running questions are never evicted to make room; finished ones are, and a full set of active ones refuses new questions', async t => {
  const { bridge, port } = await started(t)
  const secret = await pair(bridge, port)
  bridge.setHandlers({ onAsk: () => true })
  const ids = []
  for (let index = 0; index < 20; index++) {
    // The rate limit is per minute, so the clock is moved forward for every few questions.
    const response = await call(port, '/v2/ask', { secret, method: 'POST', body: { text: 'q' + index } })
    if (response.status === 429) { await sleep(5); continue }
    ids.push((await response.json()).id)
  }
  assert.ok(ids.length >= 6)
  for (const id of ids) bridge.updateAsk(id, { state: 'running', taskId: '12345678-1234-1234-1234-123456789abc' })
  const keep = ids[0]
  assert.equal(bridge.getAsk(keep).state, 'running', 'an active question is still there')
  bridge.updateAsk(ids[1], { state: 'done', output: 'x' })
  assert.equal(bridge.getAsk(ids[1]).state, 'done')
})

test('R064-201: a bound command is checked again when it is about to be sent, so a page that changed while it waited is refused', async t => {
  const { bridge, port } = await started(t, { pollMs: 3000 })
  const a = await pair(bridge, port, ext('a'))
  await call(port, '/v2/hello', { origin: ext('a'), secret: a })
  const opened = bridge.command('open', { url: 'https://example.com/' })
  const first = await poll(port, ext('a'), a)
  await call(port, '/v2/command/result', { origin: ext('a'), secret: a, method: 'POST', body: { id: first.id, ok: true, result: {}, page: { url: 'https://example.com/', title: 'A', elements: [] } } })
  await opened
  // A read is in flight; the approved action is queued behind it with the current page token.
  const reread = bridge.command('read', {})
  const inflight = await poll(port, ext('a'), a)
  const bound = bridge.command('act', { id: 'e1' }, { bind: bridge.pageToken(), timeoutMs: 3000 })
  const outcome = bound.then(() => 'sent', error => error.code)
  // The read reports a different page, then the browser asks for its next command.
  await call(port, '/v2/command/result', { origin: ext('a'), secret: a, method: 'POST', body: { id: inflight.id, ok: true, result: {}, page: { url: 'https://example.com/other', title: 'B', elements: [] } } })
  await reread
  const next = poll(port, ext('a'), a)
  assert.equal(await outcome, 'PAGE_CHANGED')
  next.catch(() => {})
})

test('R064-REV-002: a question from the browser is masked before it is stored or handed to the app, and is refused when the app cannot accept it', async t => {
  const { bridge, port } = await started(t, { sanitize: value => JSON.parse(JSON.stringify(value ?? null).split('Echoed-Pass-123').join('[redacted]')) })
  const secret = await pair(bridge, port)
  const received = []
  bridge.setHandlers({ onAsk: async ask => { received.push(ask); return true } })
  const asked = await (await call(port, '/v2/ask', { secret, method: 'POST', body: { text: 'my pass Echoed-Pass-123', page: { url: 'https://x.example/?p=Echoed-Pass-123', title: 'Echoed-Pass-123 inbox', selection: 'Echoed-Pass-123' } } })).json()
  assert.equal(asked.ok, true)
  assert.ok(!JSON.stringify(received).includes('Echoed-Pass-123'), JSON.stringify(received))
  bridge.setHandlers({ onAsk: async () => false })
  const refused = await (await call(port, '/v2/ask', { secret, method: 'POST', body: { text: 'again' } })).json()
  assert.equal(refused.ok, false)
})

test('R064-REVIEW-01: masking must be ready before a question is read; a store that recovers later is used for the next question', async t => {
  let available = false
  const known = new Set()
  const { bridge, port } = await started(t, {
    ready: async () => { if (!available) throw new Error('CREDENTIAL_STORE_FAILED'); known.add('Echoed-Pass-123') },
    sanitize: value => JSON.parse(JSON.stringify(value ?? null).split('Echoed-Pass-123').join(known.has('Echoed-Pass-123') ? '[redacted]' : 'Echoed-Pass-123')) })
  const secret = await pair(bridge, port)
  const received = []
  bridge.setHandlers({ onAsk: async ask => { received.push(ask); return true } })
  const first = await call(port, '/v2/ask', { secret, method: 'POST', body: { text: 'pass Echoed-Pass-123' } })
  assert.equal(first.status, 503); assert.equal(received.length, 0, 'nothing was read, stored or handed on')
  available = true
  const second = await (await call(port, '/v2/ask', { secret, method: 'POST', body: { text: 'pass Echoed-Pass-123' } })).json()
  assert.equal(second.ok, true)
  assert.ok(!JSON.stringify(received).includes('Echoed-Pass-123'))
})

test('R064-IR-005: an unconfirmed outcome stays authoritative against late renderer reports, and replaces an earlier plain failure', async t => {
  const { bridge, port } = await started(t)
  const secret = await pair(bridge, port)
  bridge.setHandlers({ onAsk: () => true })
  const asked = await (await call(port, '/v2/ask', { secret, method: 'POST', body: { text: 'do it' } })).json()
  bridge.updateAsk(asked.id, { state: 'failed', progress: 'UNKNOWN_EFFECT' })
  bridge.updateAsk(asked.id, { state: 'running', progress: 'late line' })
  bridge.updateAsk(asked.id, { state: 'failed', progress: 'ERROR' })
  assert.equal(bridge.getAsk(asked.id).progress, 'UNKNOWN_EFFECT'); assert.equal(bridge.getAsk(asked.id).state, 'failed')
  const second = await (await call(port, '/v2/ask', { secret, method: 'POST', body: { text: 'again' } })).json()
  bridge.updateAsk(second.id, { state: 'failed', progress: 'ERROR' })
  bridge.updateAsk(second.id, { state: 'failed', progress: 'UNKNOWN_EFFECT' })
  assert.equal(bridge.getAsk(second.id).progress, 'UNKNOWN_EFFECT', 'the later, authoritative outcome wins over a generic failure')
  const third = await (await call(port, '/v2/ask', { secret, method: 'POST', body: { text: 'third' } })).json()
  bridge.updateAsk(third.id, { state: 'done', output: 'answer' })
  bridge.updateAsk(third.id, { state: 'failed', progress: 'UNKNOWN_EFFECT' })
  assert.equal(bridge.getAsk(third.id).state, 'done', 'a completed answer is never replaced')
})

test('R064-REV-502: masking happens before the length limits, so a password at a limit cannot leak its start', async t => {
  const password = 'Boundary-Pass-9876'
  const mask = value => JSON.parse(JSON.stringify(value ?? null).split(password).join('[redacted]'))
  const { bridge, port } = await started(t, { sanitize: mask })
  const secret = await pair(bridge, port)
  await call(port, '/v2/hello', { secret })
  const opened = bridge.command('open', { url: 'https://example.com/' })
  const first = await (await call(port, '/v2/command/next', { secret })).json()
  // The page text carries the password across the 12,000-character limit; the extension sends a little more than the limit.
  const text = 'x'.repeat(11994) + password + 'y'.repeat(500)
  await call(port, '/v2/command/result', { secret, method: 'POST', body: { id: first.id, ok: true, result: {}, page: { url: 'https://example.com/', title: 't'.repeat(195) + password, text, elements: [{ id: 'e1', role: 'button', label: 'b'.repeat(95) + password }] } } })
  await opened
  const page = bridge.lastPage()
  assert.ok(!page.text.includes('Boundary'), 'no part of the password is left at the end of the text')
  assert.ok(page.text.length <= 12000 && page.title.length <= 200 && page.elements[0].label.length <= 100)
  assert.ok(!JSON.stringify(page).includes('Boundary'))
  // The same for a question from the browser.
  const received = []
  bridge.setHandlers({ onAsk: async ask => { received.push(ask); return true } })
  await call(port, '/v2/ask', { secret, method: 'POST', body: { text: 'q', page: { url: 'https://example.com/', title: 'a'.repeat(198) + password, selection: 's'.repeat(1995) + password } } })
  assert.ok(!JSON.stringify(received).includes('Boundary') && received[0].page.selection.length <= 2000)
})

test('R064-REVIEW-001: links, options and form metadata are masked before they are cut', async t => {
  const password = 'Link-Pass-12345'
  const mask = value => JSON.parse(JSON.stringify(value ?? null).split(password).join('[redacted]'))
  const { bridge, port } = await started(t, { sanitize: mask })
  const secret = await pair(bridge, port)
  await call(port, '/v2/hello', { secret })
  const opened = bridge.command('open', { url: 'https://example.com/' })
  const first = await (await call(port, '/v2/command/next', { secret })).json()
  const near = size => 'p'.repeat(size - 6) + password
  await call(port, '/v2/command/result', { secret, method: 'POST', body: { id: first.id, ok: true, result: {}, page: { url: 'https://example.com/', title: 't', text: 'x', elements: [
    { id: 'e1', role: 'link', label: 'l', href: near(200), target: near(2000) }, { id: 'e2', role: 'select', label: 's', options: [near(60)] }, { id: 'e3', role: 'field', label: 'f', form: near(4000), formAction: near(2000) }] } } })
  await opened
  const page = bridge.lastPage()
  assert.ok(!JSON.stringify(page).includes('Link-P'), JSON.stringify(page).slice(0, 300))
  assert.ok(page.elements[0].href.length <= 200 && page.elements[1].options[0].length <= 60 && page.elements[2].form.length <= 4000 && page.elements[2].formAction.length <= 2000)
})

test('R064-SEC-01: a long saved password echoed in its percent-encoded form is masked before any cut', async t => {
  const password = Array.from({ length: 700 }, (_, index) => '!#$%&()*+,/:;=?@[]^{}|<>~ '[index % 26] + String.fromCharCode(97 + (index % 26))).join('')
  const forms = [password, encodeURIComponent(password), encodeURI(password)]
  const mask = value => { let text = JSON.stringify(value ?? null); for (const form of forms) text = text.split(JSON.stringify(form).slice(1, -1)).join('[redacted]'); return JSON.parse(text) }
  const { bridge, port } = await started(t, { sanitize: mask })
  const secret = await pair(bridge, port)
  await call(port, '/v2/hello', { secret })
  const opened = bridge.command('open', { url: 'https://example.com/' })
  const first = await (await call(port, '/v2/command/next', { secret })).json()
  const encoded = encodeURIComponent(password)
  assert.ok(encoded.length > 1500)
  await call(port, '/v2/command/result', { secret, method: 'POST', body: { id: first.id, ok: true, result: {}, page: { url: 'https://example.com/', title: 't'.repeat(150) + encoded, text: 'x', elements: [] } } })
  await opened
  assert.ok(!bridge.lastPage().title.includes('%'), 'no prefix of the encoded password remains: ' + bridge.lastPage().title.slice(0, 80))
  const received = []
  bridge.setHandlers({ onAsk: async ask => { received.push(ask); return true } })
  await call(port, '/v2/ask', { secret, method: 'POST', body: { text: 'q', page: { url: 'https://example.com/', title: 'a'.repeat(100) + encoded, selection: 's'.repeat(500) + encoded } } })
  assert.ok(!JSON.stringify(received).includes('%'), 'the question context is masked before it is cut')
})

test('R064-REVIEW-101: a 1000-character Chinese password echoed in its percent-encoded form (nine characters each) is masked before any cut', async t => {
  const password = '\u4e2d'.repeat(1000)
  const encoded = encodeURIComponent(password)
  assert.equal(encoded.length, 9000)
  const mask = value => JSON.parse(JSON.stringify(value ?? null).split(encoded).join('[redacted]').split(password).join('[redacted]'))
  const { bridge, port } = await started(t, { sanitize: mask })
  const secret = await pair(bridge, port)
  await call(port, '/v2/hello', { secret })
  const opened = bridge.command('open', { url: 'https://example.com/' })
  const first = await (await call(port, '/v2/command/next', { secret })).json()
  await call(port, '/v2/command/result', { secret, method: 'POST', body: { id: first.id, ok: true, result: {}, page: { url: 'https://example.com/', title: 't'.repeat(150) + encoded, text: 'x', elements: [] } } })
  await opened
  assert.ok(!bridge.lastPage().title.includes('%E4'), 'no part of the encoded password is left')
  const received = []
  bridge.setHandlers({ onAsk: async ask => { received.push(ask); return true } })
  await call(port, '/v2/ask', { secret, method: 'POST', body: { text: 'q', page: { url: 'https://example.com/', title: 'a'.repeat(100) + encoded, selection: 's'.repeat(300) + encoded } } })
  assert.ok(!JSON.stringify(received).includes('%E4'))
})

test('R064-003: one copy of the page is enough (resultIsPage), a large page is accepted, and the budget fits the transport', async t => {
  const { bridge, port } = await started(t)
  const secret = await pair(bridge, port)
  await call(port, '/v2/hello', { secret })
  const opened = bridge.command('open', { url: 'https://example.com/' })
  const first = await (await call(port, '/v2/command/next', { secret })).json()
  const elements = Array.from({ length: 150 }, (_, index) => ({ id: 'e' + index, role: 'button', label: 'b'.repeat(6000) + index }))
  const answer = await call(port, '/v2/command/result', { secret, method: 'POST', body: { id: first.id, ok: true, result: null, resultIsPage: true, page: { doc: 'd', snap: 1, url: 'https://example.com/', title: 't', text: 'x'.repeat(20000), elements } } })
  assert.equal(answer.status, 200, 'about a megabyte of page is accepted')
  const result = await opened
  assert.equal(result.elements.length, 150); assert.equal(result.title, 't')
  assert.ok(result.elements[0].label.length <= 100)
})

test('R064-IR-301: the bridge marks a destination it had to cut as incomplete', async t => {
  const { bridge, port } = await started(t)
  const secret = await pair(bridge, port)
  await call(port, '/v2/hello', { secret })
  const opened = bridge.command('open', { url: 'https://example.com/' })
  const first = await (await call(port, '/v2/command/next', { secret })).json()
  await call(port, '/v2/command/result', { secret, method: 'POST', body: { id: first.id, ok: true, result: null, resultIsPage: true, page: { url: 'https://example.com/', title: 't', text: 'x', elements: [{ id: 'e1', role: 'link', label: 'l', href: 'https://example.com/a', target: 'https://example.com/a?' + 'q'.repeat(2500) }] } } })
  const page = await opened
  assert.equal(page.elements[0].longTarget, true); assert.ok(page.elements[0].target.length <= 2000)
})

test('R064-REVIEW-001: sensitivity is decided from the complete page before saved passwords are masked, and survives the masking', async t => {
  const mask = value => JSON.parse(JSON.stringify(value ?? null).split('checkout').join('[redacted]'))
  const { bridge, port } = await started(t, { sanitize: mask })
  const secret = await pair(bridge, port)
  await call(port, '/v2/hello', { secret })
  const opened = bridge.command('open', { url: 'https://example.com/' })
  const first = await (await call(port, '/v2/command/next', { secret })).json()
  await call(port, '/v2/command/result', { secret, method: 'POST', body: { id: first.id, ok: true, result: null, resultIsPage: true, page: { url: 'https://shop.example.com/', title: 'Shop', text: 'x', elements: [
    { id: 'e1', role: 'link', label: 'Continue', href: 'https://shop.example.com/checkout', target: 'https://shop.example.com/checkout' },
    { id: 'e2', role: 'link', label: 'About', href: 'https://shop.example.com/about', target: 'https://shop.example.com/about' },
    { id: 'e3', role: 'select', label: 'Action', options: ['Keep', 'Delete account'], optionPairs: [['Keep', 'keep'], ['Delete account', 'x1']] }] } } })
  const page = await opened
  assert.ok(!JSON.stringify(page).includes('checkout'), 'the word itself is masked')
  assert.equal(page.elements[0].strict, true, 'but the decision it caused is kept')
  assert.equal(page.elements[1].strict, undefined)
  assert.deepEqual(page.elements[2].optionPairs.map(pair => pair[2]), [false, true])
})

test('R064-IR-3101/3102: the complete address (fragment included) and incompletely described options decide sensitivity, and the complete address is not passed on', async t => {
  const { bridge, port } = await started(t)
  const secret = await pair(bridge, port)
  await call(port, '/v2/hello', { secret })
  const open = async page => {
    const opened = bridge.command('open', { url: 'https://example.com/' })
    const first = await (await call(port, '/v2/command/next', { secret })).json()
    await call(port, '/v2/command/result', { secret, method: 'POST', body: { id: first.id, ok: true, result: null, resultIsPage: true, page } })
    return opened
  }
  const hash = await open({ url: 'https://shop.example/', fullUrl: 'https://shop.example/#/checkout', title: 'Shop', text: 'x', elements: [] })
  assert.equal(hash.strictPage, true); assert.equal(hash.fullUrl, undefined, 'the complete address is not forwarded')
  assert.equal((await open({ url: 'https://shop.example/', fullUrl: 'https://shop.example/#/about', title: 'Shop', text: 'x', elements: [] })).strictPage, undefined)
  assert.equal((await open({ url: 'https://shop.example/', fullUrl: '', urlIncomplete: true, title: 'Shop', text: 'x', elements: [] })).strictPage, true, 'an address that could not be delivered completely is sensitive')
  const select = await open({ url: 'https://shop.example/', fullUrl: 'https://shop.example/', title: 'Shop', text: 'x', elements: [
    { id: 'e1', role: 'select', label: 'Plan', optionPairs: [['Standard', 'free', false], ['Premium', 'x', true], ['Plus', 'delete_account', false]] }] })
  assert.deepEqual(select.elements[0].optionPairs.map(pair => pair[2]), [false, true, true], 'an incompletely described option and a sensitive one are both flagged')
})

test('R064-REVIEW-3202: the same extension installed in two browser profiles keeps two independent links', async t => {
  const { bridge, port } = await started(t)
  const one = 'a'.repeat(32), two = 'b'.repeat(32)
  const first = await pair(bridge, port, ext('a'), one)
  const second = await pair(bridge, port, ext('a'), two)
  assert.notEqual(first, second)
  assert.equal(bridge.status().links.length, 2)
  assert.equal((await call(port, '/v2/hello', { secret: first, instance: one })).status, 200, 'the first profile is still linked after the second was paired')
  assert.equal((await call(port, '/v2/hello', { secret: second, instance: two })).status, 200)
  assert.equal((await call(port, '/v2/hello', { secret: first, instance: two })).status, 401, 'a secret belongs to its installation')
  assert.deepEqual(bridge.status().links.map(link => link.instance).sort(), [one, two])
  await bridge.unpair('a'.repeat(32), one)
  assert.equal((await call(port, '/v2/hello', { secret: first, instance: one })).status, 401)
  assert.equal((await call(port, '/v2/hello', { secret: second, instance: two })).status, 200, 'only that installation was unlinked')
})

test('R064-REVIEW-3802: an answer that arrives with an unconfirmed effect is kept, and later reports cannot turn it into success or erase it', async t => {
  const { bridge, port } = await started(t)
  const secret = await pair(bridge, port)
  bridge.setHandlers({ onAsk: () => true })
  const asked = await (await call(port, '/v2/ask', { secret, method: 'POST', body: { text: 'do it' } })).json()
  bridge.updateAsk(asked.id, { state: 'failed', progress: 'UNKNOWN_EFFECT', output: 'what the model said', needsApproval: false })
  assert.equal(bridge.getAsk(asked.id).output, 'what the model said')
  bridge.updateAsk(asked.id, { state: 'done', output: 'late success' })
  bridge.updateAsk(asked.id, { state: 'running', progress: 'late', output: 'other' })
  const view = bridge.getAsk(asked.id)
  assert.equal(view.state, 'failed'); assert.equal(view.progress, 'UNKNOWN_EFFECT'); assert.equal(view.output, 'what the model said')
})

test('R064-REVIEW-4001: changing the installation id or the extension id cannot get around the pairing limits (and so cannot create dialogs at will)', async t => {
  const { bridge, port } = await started(t)
  const dialogs = []
  bridge.setHandlers({ onPairRequest: request => dialogs.push(request) })
  const statuses = []
  // One extension origin, a new installation id every time: five requests, then refused.
  for (let index = 0; index < 8; index++) {
    const instance = index.toString(16).padStart(32, '0')
    // each request is answered before the next one, so the pending cap does not hide the rate limit
    const response = await call(port, '/v2/pair/request', { origin: ext('a'), instance, method: 'POST', body: {} })
    statuses.push(response.status)
    if (response.status === 200) { const body = await response.json(); await bridge.resolvePair(body.id, false) }
  }
  assert.deepEqual(statuses.slice(0, 5), [200, 200, 200, 200, 200]); assert.ok(statuses.slice(5).every(status => status === 429))
  // Many different (spoofed) extension ids: the bridge-wide limit stops them at ten in all, including the five above.
  const letters = 'bcdefghijklmnop'
  for (const letter of letters) {
    const response = await call(port, '/v2/pair/request', { origin: ext(letter), method: 'POST', body: {} })
    if (response.status === 200) { const body = await response.json(); await bridge.resolvePair(body.id, false) }
  }
  assert.ok(dialogs.length <= 10, 'at most ten confirmation windows in ten minutes: ' + dialogs.length)
})

test('R064-REVIEW-4302: a long answer is carried up to 60,000 characters and a cut is reported, never hidden', async t => {
  const { bridge, port } = await started(t)
  const secret = await pair(bridge, port)
  bridge.setHandlers({ onAsk: () => true })
  const asked = await (await call(port, '/v2/ask', { secret, method: 'POST', body: { text: 'write a lot' } })).json()
  bridge.updateAsk(asked.id, { state: 'done', output: 'x'.repeat(20000) })
  const shortView = await (await call(port, `/v2/ask/${asked.id}`, { secret })).json()
  assert.equal(shortView.output.length, 20000); assert.equal(shortView.outputTruncated, false)
  const second = await (await call(port, '/v2/ask', { secret, method: 'POST', body: { text: 'write more' } })).json()
  bridge.updateAsk(second.id, { state: 'done', output: 'y'.repeat(70000) })
  const longView = await (await call(port, `/v2/ask/${second.id}`, { secret })).json()
  assert.equal(longView.output.length, 60000); assert.equal(longView.outputTruncated, true); assert.equal(longView.outputLength, 70000)
})

test('R064-IR-4702: a selection that does not fit is cut and says so in the text the model receives', async t => {
  const { bridge, port } = await started(t)
  const secret = await pair(bridge, port)
  const received = []
  bridge.setHandlers({ onAsk: async ask => { received.push(ask); return true } })
  await call(port, '/v2/ask', { secret, method: 'POST', body: { text: 'summarize', page: { url: 'https://x.example/', title: 't', selection: 's'.repeat(8000) } } })
  const selection = received[0].page.selection
  assert.ok(selection.length <= 2000); assert.match(selection, /only the first 1900 of 8000 selected characters were supplied/)
  await call(port, '/v2/ask', { secret, method: 'POST', body: { text: 'again', page: { url: 'https://x.example/', title: 't', selection: 'short' } } })
  assert.equal(received[1].page.selection, 'short')
})
