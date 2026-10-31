// Desktop tools (M2d) with a fake host: approvals, snapshot binding, sensitive fields and run isolation.
// tests/desktop-host-smoke.cjs drives a real WinForms window through the real NAJD desktop host.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { createDesktopTools } = require('../electron/desktop-tools.cjs')
const { createActionJournal } = require('../electron/action-journal.cjs')

function fakeHost({ staleOnAct = false } = {}) {
  const calls = []
  return { calls, async invokeHost(name, args) {
    calls.push([name, args])
    if (name === 'najd.desktop.windows') return [{ window: '101', title: 'Order form', process: 'app', pid: 7, created: 99 }]
    if (name === 'najd.desktop.read') return { title: 'Order form', elements: [
      { id: '42.1', name: 'Full name', role: 'edit', controlType: 50004, automationId: 'name', enabled: true, value: '', sensitive: false, key: 'key-full-name' },
      { id: '42.2', name: 'Card number', role: 'edit', controlType: 50004, automationId: 'card', enabled: true, value: null, sensitive: true },
      { id: '42.3', name: 'Submit', role: 'button', controlType: 50000, automationId: 'go', enabled: true, value: null, sensitive: false }] }
    if (name === 'najd.desktop.act') { if (staleOnAct) throw Object.assign(new Error('STALE_TARGET'), { code: 'STALE_TARGET', toolError: true, dispatched: true }); return { verified: true, value: args.text } }
    if (name === 'najd.desktop.open') return { opened: true }
  } }
}
const setup = options => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'najd-desktop-'))
  const host = fakeHost(options)
  const journal = createActionJournal({ filePath: path.join(root, 'actions.json') })
  return { host, journal, tools: createDesktopTools({ host, journal, verifyMs: 300, resolveReadable: input => { if (input.includes('..')) throw Object.assign(new Error('PATH_NOT_ALLOWED'), { code: 'PATH_NOT_ALLOWED' }); return path.join(root, input) } }) }
}

test('a window is read from a fresh list and one approval per run; acts need their own approval', async () => {
  const { tools, host } = setup()
  const cards = []
  const ctx = { runId: 'run-1', requestApproval: async tool => { cards.push(tool); return 'ALLOW_ONCE' } }
  // An id no open window has is refused with directions; a listed window is found without a separate list call
  // (owner live test 2026-10-31), and reading it still needs its approval.
  await assert.rejects(tools.read({ window: '999' }, ctx), { code: 'NOT_FOUND', hint: /najd_desktop_windows/ })
  assert.deepEqual(cards, [])
  const first = await tools.read({ window: '101' }, ctx)
  await tools.read({ window: '101' }, ctx)
  assert.deepEqual(cards, ['najd-desktop-read'])
  assert.deepEqual(first.elements.map(item => item.id), ['e1', 'e2', 'e3'])
  assert.equal(first.elements[1].sensitive, true); assert.equal('value' in first.elements[1], false)
  const typed = await tools.act({ window: '101', element: 'e1', action: 'setValue', text: 'Ibrahim' }, ctx)
  assert.equal(typed.status, 'done'); assert.deepEqual(cards, ['najd-desktop-read', 'najd-desktop-act'])
  // The window is read again after the action, without another approval, and the action is sent once.
  assert.deepEqual(typed.after.elements.map(item => item.id), ['e1', 'e2', 'e3'])
  assert.equal(host.calls.filter(([name]) => name === 'najd.desktop.act').length, 1)
  const sent = host.calls.find(([name]) => name === 'najd.desktop.act')[1]
  assert.deepEqual([sent.element, sent.name, sent.automationId, sent.controlType, sent.pid, sent.created, sent.key, sent.title], ['42.1', 'Full name', 'name', 50004, 7, '99', 'key-full-name', 'Order form'])
})

test('sensitive fields are refused before any approval; denial does nothing; stale targets need a fresh read', async () => {
  const { tools, host } = setup({ staleOnAct: true })
  const cards = []
  const ctx = { runId: 'run-2', requestApproval: async tool => { cards.push(tool); return tool === 'najd-desktop-read' ? 'ALLOW_ONCE' : 'DENY' } }
  await tools.windows({}, ctx); await tools.read({ window: '101' }, ctx)
  const refused = await tools.act({ window: '101', element: 'e2', action: 'setValue', text: '4111 1111 1111 1111' }, ctx)
  assert.equal(refused.error, 'SENSITIVE_FIELD'); assert.deepEqual(cards, ['najd-desktop-read'])
  const denied = await tools.act({ window: '101', element: 'e3', action: 'invoke', text: '' }, ctx)
  assert.equal(denied.status, 'denied_by_user'); assert.equal(host.calls.some(([name]) => name === 'najd.desktop.act'), false)
  const allow = { ...ctx, requestApproval: async () => 'ALLOW_ONCE' }
  await assert.rejects(tools.act({ window: '101', element: 'e3', action: 'invoke', text: '' }, allow), { code: 'STALE_TARGET' })
  // The stale snapshot is dropped: acting again without a new read is refused.
  await assert.rejects(tools.act({ window: '101', element: 'e3', action: 'invoke', text: '' }, allow), { code: 'STALE_TARGET' })
})

test('reads belong to their run; unknown elements and actions are refused; open validates files', async () => {
  const { tools } = setup()
  const allow = runId => ({ runId, requestApproval: async () => 'ALLOW_ONCE' })
  await tools.windows({}, allow('run-a')); await tools.read({ window: '101' }, allow('run-a'))
  await assert.rejects(tools.act({ window: '101', element: 'e1', action: 'invoke', text: '' }, allow('run-b')), { code: 'STALE_TARGET' })
  await assert.rejects(tools.act({ window: '101', element: 'e9', action: 'invoke', text: '' }, allow('run-a')), { code: 'STALE_TARGET' })
  await assert.rejects(tools.act({ window: '101', element: 'e1', action: 'drag', text: '' }, allow('run-a')), { code: 'INVALID_INPUT' })
  assert.equal((await tools.open({ target: 'notepad' }, allow('run-a'))).status, 'opened')
  await assert.rejects(tools.open({ target: '../secret.txt' }, allow('run-a')), { code: 'PATH_NOT_ALLOWED' })
})

test('M2e: a screenshot reaches a vision model as an image, never as text; models without vision do not get the tool', async () => {
  const { createAgentRuntime } = require('../electron/agent-runtime.cjs')
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'najd-capture-'))
  const host = { async invokeHost(name, args) {
    if (name === 'najd.desktop.windows') return [{ window: '7', title: 'Report', process: 'excel', pid: 3, created: '99' }]
    if (name === 'najd.screen.capture') { fs.writeFileSync(args.output, Buffer.from('89504e470d0a1a0a', 'hex')); return { output: args.output, width: 640, height: 480 } }
  } }
  const desktop = createDesktopTools({ host, resolveReadable: input => input, captureDirectory: root, saveToLibrary: async () => ({ id: 'c'.repeat(64) }) })
  const library = { list: async () => [], read: async () => ({}), search: async () => [] }
  const call = (name, args, id) => ({ kind: 'agent-tools', calls: [{ name, arguments: JSON.stringify(args), call_id: id }], items: [{ type: 'function_call', name, arguments: JSON.stringify(args), call_id: id }] })
  const runtime = createAgentRuntime({ catalog: { search: async () => [], details: async () => ({}) }, library, desktop })
  let turn = 0, seen = null
  // The office profile preloads desktop control (design loads it on demand since M3 kept design within the tool budget).
  await runtime.run({ request: { text: 'صمم لي شعار', vision: true, profile: 'office' }, requestApproval: async () => 'ALLOW_ONCE', respond: async request => {
    if (turn === 0) { turn++; assert.ok(request.tools.some(tool => tool.name === 'najd_desktop_windows')); return call('najd_desktop_windows', {}, 'w') }
    if (turn === 1) { turn++; return call('najd_tools_load', { toolset: 'screen', unload: '' }, 'l') }
    if (turn === 2) { turn++; return call('najd_screen_capture', { window: '7' }, 's') }
    seen = request.input
    return { kind: 'message', text: 'I can see it.' }
  } })
  const toolOutput = seen.find(item => item.type === 'function_call_output' && item.call_id === 's')
  assert.doesNotMatch(toolOutput.output, /base64/)
  const image = seen.at(-1)
  assert.equal(image.content[1].type, 'input_image'); assert.match(image.content[1].image_url, /^data:image\/png;base64,/)
  // Without vision the screenshot toolset is offered too (2026-10-24: the owner asked a text-only model for a screenshot and it wrote a
  // script instead); the picture is then shown to the owner, never sent to the model (see agent-platform-review).
  await runtime.run({ request: { text: 'صمم لي شعار', vision: false, profile: 'office' }, respond: async request => {
    assert.match(request.instructions, /Loaded toolsets: [^.]*desktop/)
    assert.match(request.instructions, /najd_tools_load: [^.]*screen/)
    return { kind: 'message', text: 'ok' }
  } })
})

test('M2-R01: text longer than the approval card can show is refused before asking', async () => {
  const { tools, host } = setup()
  const cards = []
  const ctx = { runId: 'run-long', requestApproval: async tool => { cards.push(tool); return 'ALLOW_ONCE' } }
  await tools.windows({}, ctx); await tools.read({ window: '101' }, ctx)
  const refused = await tools.act({ window: '101', element: 'e1', action: 'setValue', text: 'z'.repeat(1201) }, ctx)
  assert.equal(refused.error, 'TEXT_TOO_LONG'); assert.deepEqual(cards, ['najd-desktop-read'])
  assert.equal(host.calls.some(([name]) => name === 'najd.desktop.act'), false)
})

test('M2-R2-006: a call without its run is refused, and ending a run drops what it read', async () => {
  const { tools } = setup()
  await assert.rejects(tools.windows({}, {}), { code: 'INVALID_INPUT' })
  const ctx = { runId: 'run-end', requestApproval: async () => 'ALLOW_ONCE' }
  await tools.windows({}, ctx); await tools.read({ window: '101' }, ctx)
  tools.endRun('run-end')
  // What the ended run read and was allowed is gone: reading again needs a new approval.
  let asked = 0
  await tools.read({ window: '101' }, { ...ctx, requestApproval: async () => { asked++; return 'DENY' } })
  assert.equal(asked, 1)
})

test('M2-R3-005: a lost answer after sending an action is an unknown effect, not a refusal', async () => {
  const { tools, host, journal } = setup()
  const ctx = { runId: 'run-lost', requestApproval: async () => 'ALLOW_ONCE' }
  await tools.windows({}, ctx); await tools.read({ window: '101' }, ctx)
  const original = host.invokeHost
  host.invokeHost = async (name, args, ...rest) => { if (name === 'najd.desktop.act') throw Object.assign(new Error('WINDOWS_NODE_FAILED'), { code: 'WINDOWS_NODE_FAILED', dispatched: true }); return original(name, args, ...rest) }
  await assert.rejects(tools.act({ window: '101', element: 'e3', action: 'invoke', text: '' }, ctx), error => error.code === 'DESKTOP_ACTION_FAILED' && error.effectUnknown === true)
  assert.ok((await journal.list()).some(item => /UNKNOWN/i.test(item.state)))
})

test('M2-R4-004: the screenshot shown to the model always fits its image limit', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'najd-capture-big-'))
  const host = { invokeHost: async (name, args) => { if (name === 'najd.screen.capture') { fs.writeFileSync(args.output, Buffer.alloc(3 * 1024 * 1024, 7)); return { width: 1280, height: 720 } } } }
  const ctx = { runId: 'run-big', requestApproval: async () => 'ALLOW_ONCE' }
  const plain = createDesktopTools({ host, resolveReadable: input => input, captureDirectory: root })
  const tooBig = await plain.capture({}, ctx)
  assert.equal(tooBig.imageUrl, undefined); assert.match(tooBig.note, /too large/)
  const seen = []
  const prepared = createDesktopTools({ host, resolveReadable: input => input, captureDirectory: root, prepareForModel: async (_bytes, limit) => { seen.push(limit); return 'data:image/jpeg;base64,AAAA' } })
  const small = await prepared.capture({}, ctx)
  assert.equal(small.imageUrl, 'data:image/jpeg;base64,AAAA'); assert.ok(seen[0] < 3 * 1024 * 1024)
})

test('M2-R7-002: an action sent without an observed change is reported as possibly done', async () => {
  const { tools, host } = setup()
  const ctx = { runId: 'run-unverified', requestApproval: async () => 'ALLOW_ONCE' }
  await tools.windows({}, ctx); await tools.read({ window: '101' }, ctx)
  const original = host.invokeHost
  host.invokeHost = async (name, args, ...rest) => name === 'najd.desktop.act' ? { verified: false, changed: false } : original(name, args, ...rest)
  const result = await tools.act({ window: '101', element: 'e3', action: 'invoke', text: '' }, ctx)
  assert.equal(result.status, 'unverified'); assert.equal(result.effectUnknown, true); assert.match(result.note, /may still have happened/)
})

test('M2-R8-005: a large window is read in parts within the budget, with ids valid across parts', async () => {
  const many = Array.from({ length: 300 }, (_, i) => ({ id: '9.' + i, name: 'Field ' + i + ' ' + 'x'.repeat(100), role: 'edit', controlType: 50004, automationId: 'f' + i, enabled: true, value: 'v'.repeat(200), sensitive: false, key: 'k' + i }))
  const host = { calls: [], async invokeHost(name, args) {
    this.calls.push(name)
    if (name === 'najd.desktop.windows') return [{ window: '5', title: 'Big form', process: 'app', pid: 3, created: '1' }]
    if (name === 'najd.desktop.read') return { title: 'Big form', elements: many }
    if (name === 'najd.desktop.act') return { verified: true, value: args.text }
  } }
  const tools = createDesktopTools({ host, resolveReadable: input => input })
  const ctx = { runId: 'run-big-read', requestApproval: async () => 'ALLOW_ONCE', maxChars: 8000 }
  await tools.windows({}, ctx)
  const first = await tools.read({ window: '5', from: 0 }, ctx)
  assert.ok(JSON.stringify(first).length <= 8000 + 300); assert.equal(first.truncated, true); assert.equal(first.total, 300)
  let seen = first.elements.length, next = first.nextFrom, parts = 1
  while (next) { const part = await tools.read({ window: '5', from: next }, ctx); seen += part.elements.length; next = part.nextFrom; parts++ }
  assert.equal(seen, 300); assert.ok(parts > 1)
  assert.equal(host.calls.filter(name => name === 'najd.desktop.read').length, 1, 'later parts reuse the same snapshot')
  const typed = await tools.act({ window: '5', element: 'e300', action: 'setValue', text: 'ok' }, ctx)
  assert.equal(typed.status, 'done')
})

test('M2-R9-003: repeated screenshots keep only the newest image; with no free image slot none is taken', async () => {
  const { createAgentRuntime } = require('../electron/agent-runtime.cjs')
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'najd-capture-many-'))
  let captures = 0
  const host = { async invokeHost(name, args) {
    if (name === 'najd.desktop.windows') return [{ window: '7', title: 'Report', process: 'excel', pid: 3, created: '99' }]
    if (name === 'najd.screen.capture') { captures++; fs.writeFileSync(args.output, Buffer.from('89504e470d0a1a0a', 'hex')); return { width: 640, height: 480 } }
  } }
  const desktop = createDesktopTools({ host, resolveReadable: input => input, captureDirectory: root })
  const library = { list: async () => [], read: async () => ({}), search: async () => [] }
  const call = (name, args, id) => ({ kind: 'agent-tools', calls: [{ name, arguments: JSON.stringify(args), call_id: id }], items: [{ type: 'function_call', name, arguments: JSON.stringify(args), call_id: id }] })
  const runtime = createAgentRuntime({ catalog: { search: async () => [], details: async () => ({}) }, library, desktop })
  const images = input => input.reduce((count, item) => count + (Array.isArray(item.content) ? item.content.filter(part => part.type === 'input_image').length : 0), 0)
  const steps = [call('najd_desktop_windows', {}, 'w'), call('najd_tools_load', { toolset: 'screen', unload: '' }, 'l'),
    // The window and the whole screen in turn: the same capture five times in a row would be stopped as a loop.
    ...Array.from({ length: 10 }, (_, i) => call('najd_screen_capture', { window: i % 2 ? '' : '7' }, 's' + i))]
  let turn = 0, last = null
  // The office profile preloads desktop control (design loads it on demand since M3 kept design within the tool budget).
  await runtime.run({ request: { text: 'صمم لي شعار', vision: true, profile: 'office' }, requestApproval: async () => 'ALLOW_ONCE', respond: async request => {
    // Ten images from the task itself (as sampled video frames) plus repeated screenshots stay within the limit.
    if (turn === 0) request.input.push({ role: 'user', content: Array.from({ length: 10 }, () => ({ type: 'input_image', image_url: 'data:image/png;base64,AA' })) })
    assert.ok(images(request.input) <= 11, 'ten task images and at most one screenshot'); last = request.input
    return turn < steps.length ? steps[turn++] : { kind: 'message', text: 'done' }
  } })
  assert.equal(captures, 10); assert.equal(images(last), 11)
  // A task whose other images already fill the allowance: refused before asking.
  const full = Array.from({ length: 12 }, () => ({ type: 'input_image', image_url: 'data:image/png;base64,AA' }))
  const asked = []
  const crowded = createAgentRuntime({ catalog: { search: async () => [], details: async () => ({}) }, library, desktop })
  let step = 0, refusal = null
  await crowded.run({ request: { text: 'صمم لي شعار', vision: true }, requestApproval: async tool => { asked.push(tool); return 'ALLOW_ONCE' }, respond: async request => {
    if (step === 0) { request.input.push({ role: 'user', content: full }); step++; return call('najd_desktop_windows', {}, 'w') }
    if (step === 1) { step++; return call('najd_tools_load', { toolset: 'screen', unload: '' }, 'l') }
    if (step === 2) { step++; return call('najd_screen_capture', { window: '7' }, 'x') }
    refusal = JSON.parse(request.input.find(item => item.call_id === 'x' && item.type === 'function_call_output').output)
    return { kind: 'message', text: 'done' }
  } }).catch(() => {})
  assert.equal(refusal?.error, 'IMAGE_LIMIT'); assert.ok(!asked.includes('najd-screen-capture'))
})

test('M2-R13-003: a folder grant removed while approval is pending means the file is not opened', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'najd-open-'))
  const calls = []
  let granted = true
  const host = { invokeHost: async (name, args) => { calls.push([name, args]); return { opened: true } } }
  const tools = createDesktopTools({ host, journal: createActionJournal({ filePath: path.join(root, 'actions.json') }),
    resolveReadable: input => { if (!granted) throw Object.assign(new Error('PATH_NOT_ALLOWED'), { code: 'PATH_NOT_ALLOWED' }); return path.join(root, input) } })
  const result = await tools.open({ target: 'report.pdf' }, { runId: 'run-open', requestApproval: async () => { granted = false; return 'ALLOW_ONCE' } })
  assert.equal(result.error, 'PATH_NOT_ALLOWED'); assert.equal(calls.length, 0)
  granted = true
  assert.equal((await tools.open({ target: 'report.pdf' }, { runId: 'run-open', requestApproval: async () => 'ALLOW_ONCE' })).status, 'opened')
})

test('M2-R15-003: opening a file passes a check that runs when the request leaves the host queue', async () => {
  let granted = true, checked = null
  const host = { invokeHost: async (name, args, _timeout, options) => { checked = await options.check(); if (checked) throw Object.assign(new Error(checked), { code: checked, dispatched: false }); return { opened: true } } }
  const tools = createDesktopTools({ host, resolveReadable: input => { if (!granted) throw Object.assign(new Error('PATH_NOT_ALLOWED'), { code: 'PATH_NOT_ALLOWED' }); return 'C:/granted/' + input } })
  const ctx = { runId: 'run-queue', requestApproval: async () => 'ALLOW_ONCE' }
  assert.equal((await tools.open({ target: 'a.pdf' }, ctx)).status, 'opened'); assert.equal(checked, null)
  const revoking = { invokeHost: async (name, args, _timeout, options) => { granted = false; return host.invokeHost(name, args, _timeout, options) } }
  const queued = createDesktopTools({ host: revoking, resolveReadable: input => { if (!granted) throw Object.assign(new Error('PATH_NOT_ALLOWED'), { code: 'PATH_NOT_ALLOWED' }); return 'C:/granted/' + input } })
  granted = true
  await assert.rejects(queued.open({ target: 'a.pdf' }, ctx), { code: 'PATH_NOT_ALLOWED' })
})

test('M2-R20-002: the approval card names the control in full; a name too long to show is refused before asking', async () => {
  const longName = 'Delete the quarterly report for the northern region and all of its attachments, then archive ' + 'x'.repeat(60) + ' FINAL'
  const host = { async invokeHost(name) {
    if (name === 'najd.desktop.windows') return [{ window: '9', title: 'Reports', process: 'app', pid: 4, created: '1' }]
    if (name === 'najd.desktop.read') return { title: 'Reports', elements: [
      { id: '1.1', name: longName, role: 'button', controlType: 50000, automationId: 'del', enabled: true, value: null, sensitive: false, key: 'k1', nameTruncated: false },
      { id: '1.2', name: 'y'.repeat(200), role: 'button', controlType: 50000, automationId: 'huge', enabled: true, value: null, sensitive: false, key: 'k2', nameTruncated: true }] }
    if (name === 'najd.desktop.act') return { verified: true }
  } }
  const tools = createDesktopTools({ host, resolveReadable: input => input })
  const cards = []
  const ctx = { runId: 'run-names', requestApproval: async (tool, card) => { cards.push(card); return 'ALLOW_ONCE' } }
  await tools.windows({}, ctx); await tools.read({ window: '9', from: 0 }, ctx)
  await tools.act({ window: '9', element: 'e1', action: 'invoke', text: '' }, ctx)
  assert.ok(cards.at(-1).summary.includes(longName), 'the full name is on the card')
  const asked = cards.length
  const refused = await tools.act({ window: '9', element: 'e2', action: 'invoke', text: '' }, ctx)
  assert.equal(refused.error, 'TARGET_NAME_TOO_LONG'); assert.equal(cards.length, asked)
})

test('M2-R27-001: a window whose title is too long to show in full is listed but cannot be read, acted on or captured', async () => {
  const host = { calls: [], async invokeHost(name) { this.calls.push(name); if (name === 'najd.desktop.windows') return [{ window: '8', title: 'T'.repeat(1200), titleTooLong: true, process: 'app', pid: 2, created: '1' }] } }
  const tools = createDesktopTools({ host, resolveReadable: input => input, captureDirectory: fs.mkdtempSync(path.join(os.tmpdir(), 'najd-long-title-')) })
  const ctx = { runId: 'run-long-title', requestApproval: async () => assert.fail('no approval may be asked') }
  const listed = await tools.windows({}, ctx)
  assert.equal(listed.windows[0].titleTooLong, true)
  await assert.rejects(tools.read({ window: '8', from: 0 }, ctx), { code: 'NOT_FOUND' })
  await assert.rejects(tools.capture({ window: '8' }, ctx), { code: 'NOT_FOUND' })
  assert.ok(host.calls.every(name => name === 'najd.desktop.windows'), 'the window is only listed, never read or captured')
})

test('M2-R28-002: when the host could not read every control, every part of the read says so', async () => {
  const many = Array.from({ length: 40 }, (_, i) => ({ id: '3.' + i, name: 'Item ' + i, role: 'button', controlType: 50000, automationId: 'b' + i, enabled: true, value: null, sensitive: false, key: 'k' + i }))
  const host = { async invokeHost(name) { if (name === 'najd.desktop.windows') return [{ window: '6', title: 'Wide', process: 'app', pid: 2, created: '1' }]; if (name === 'najd.desktop.read') return { title: 'Wide', elements: many, complete: false } } }
  const tools = createDesktopTools({ host, resolveReadable: input => input })
  const ctx = { runId: 'run-wide', requestApproval: async () => 'ALLOW_ONCE', maxChars: 1500 }
  await tools.windows({}, ctx)
  let part = await tools.read({ window: '6', from: 0 }, ctx)
  assert.equal(part.incomplete, true)
  while (part.nextFrom) { part = await tools.read({ window: '6', from: part.nextFrom }, ctx); assert.equal(part.incomplete, true, 'kept on later parts') }
})

test('M2-R29-001: a name or value cut for the model, or by the host, is marked as shortened', async () => {
  const host = { async invokeHost(name) {
    if (name === 'najd.desktop.windows') return [{ window: '4', title: 'Notes', process: 'app', pid: 2, created: '1' }]
    if (name === 'najd.desktop.read') return { title: 'Notes', complete: true, elements: [
      { id: '1', name: 'Body', role: 'edit', controlType: 50004, automationId: 'body', enabled: true, value: 'v'.repeat(300), valueTruncated: true, sensitive: false, key: 'k1' },
      { id: '2', name: 'n'.repeat(150), role: 'text', controlType: 50020, automationId: '', enabled: true, value: null, sensitive: false, key: 'k2' },
      { id: '3', name: 'Short', role: 'edit', controlType: 50004, automationId: 's', enabled: true, value: 'abc', sensitive: false, key: 'k3' }] } } }
  const tools = createDesktopTools({ host, resolveReadable: input => input })
  const ctx = { runId: 'run-cut', requestApproval: async () => 'ALLOW_ONCE' }
  await tools.windows({}, ctx)
  const read = await tools.read({ window: '4', from: 0 }, ctx)
  assert.equal(read.elements[0].valueShortened, true); assert.equal(read.elements[0].value.length, 200)
  assert.equal(read.elements[1].nameShortened, true)
  assert.equal(read.elements[2].valueShortened, undefined); assert.equal(read.elements[2].nameShortened, undefined)
  assert.match(read.shortenedNote, /not available/)
})

test('Phase 12: an opened app is verified by a new window, and reported honestly when none appears', async () => {
  for (const appears of [true, false]) {
    let opened = false
    const host = { async invokeHost(name) {
      if (name === 'najd.desktop.windows') return [{ window: '101', title: 'Old', process: 'x', pid: 1, created: 1 }, ...(opened && appears ? [{ window: '202', title: 'Untitled - Notepad', process: 'notepad', pid: 2, created: 2 }] : [])]
      if (name === 'najd.desktop.open') { opened = true; return { opened: true } }
    } }
    const tools = createDesktopTools({ host, journal: null, verifyMs: 1200, resolveReadable: input => input })
    const result = await tools.open({ target: 'notepad' }, { runId: 'r', requestApproval: async () => 'ALLOW_ONCE' })
    assert.equal(result.status, 'opened')
    if (appears) { assert.equal(result.verified, true); assert.equal(result.title, 'Untitled - Notepad') }
    else { assert.equal(result.verified, false); assert.match(result.note, /no new window appeared/) }
  }
})

test('Phase 12: another app\'s window opening meanwhile is not taken as proof (C48-01)', async () => {
  let opened = false
  const host = { async invokeHost(name) {
    if (name === 'najd.desktop.windows') return [{ window: '101', title: 'Old', process: 'x', pid: 1, created: 1 }, ...(opened ? [{ window: '303', title: 'Inbox - Mail', process: 'olk', pid: 3, created: 3 }] : [])]
    if (name === 'najd.desktop.open') { opened = true; return { opened: true } }
  } }
  const tools = createDesktopTools({ host, journal: null, verifyMs: 1200, resolveReadable: input => input })
  const result = await tools.open({ target: 'notepad' }, { runId: 'r', requestApproval: async () => 'ALLOW_ONCE' })
  assert.equal(result.status, 'opened'); assert.equal(result.verified, false)
  assert.match(result.note, /Inbox - Mail/); assert.match(result.note, /not taken as proof/)
})

test('Phase 12: the app name must appear as whole words, not inside another word (C49-01)', async () => {
  for (const [title, process, verified] of [['Knowledge Base', 'knowledge', false], ['New tab - Microsoft​ Edge', 'msedge', true]]) {
    let opened = false
    const host = { async invokeHost(name) {
      if (name === 'najd.desktop.windows') return opened ? [{ window: '404', title, process, pid: 4, created: 4 }] : []
      if (name === 'najd.desktop.open') { opened = true; return { opened: true } }
    } }
    const tools = createDesktopTools({ host, journal: null, verifyMs: 900, resolveReadable: input => input })
    const result = await tools.open({ target: 'edge' }, { runId: 'r', requestApproval: async () => 'ALLOW_ONCE' })
    assert.equal(result.verified, verified, title)
  }
})