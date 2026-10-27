const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { createChannelGateway, chunks } = require('../electron/channel-gateway.cjs')

const OWNER = 111, OTHER = 222
const msg = (chat, text, extra = {}) => ({ message: { chat: { id: chat, type: 'private' }, from: { id: chat, first_name: 'Owner' }, text, date: Math.floor(Date.now() / 1000), ...extra } })

async function setup(t, over = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'najd-channels-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const sent = [], answered = [], edited = [], actions = []
  const api = {
    sendMessage: async (chatId, text, extra) => { sent.push({ chatId, text, extra }); return { message_id: sent.length } },
    editMessageText: async (chatId, id, text) => { edited.push({ chatId, id, text }) }, answerCallbackQuery: async (id, text) => { answered.push({ id, text }) },
    sendChatAction: async (chatId, action) => { actions.push([chatId, action]) }, getMe: async () => ({ username: 'najd_test_bot' }), setMyCommands: async () => {}, getUpdates: async () => []
  }
  const tasks = new Map(), started = [], responded = [], cancelled = []
  const core = {
    startTask: request => { const task = { id: 'task-' + (started.length + 1), state: 'RUNNING', output: null, errorCode: null, approvalId: null, proposedTool: null, proposedInput: null }; started.push(request); tasks.set(task.id, task); over.onStart?.(task, request); return { ...task } },
    getTask: id => ({ ...tasks.get(id), unreadNotes: [...(tasks.get(id).notes || [])] }),
    addNote: (id, text) => { const task = tasks.get(id); if (['COMPLETED', 'FAILED', 'CANCELLED', 'UNKNOWN_EFFECT'].includes(task.state)) throw Object.assign(new Error('CONFLICT'), { code: 'CONFLICT' }); (task.notes ||= []).push(text) }, respondApproval: (id, decision) => { if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error('INVALID'); responded.push([id, decision]); for (const task of tasks.values()) if (task.approvalId === id) { task.state = 'RUNNING'; task.approvalId = null } },
    cancelTask: id => { cancelled.push(id); tasks.get(id).state = 'CANCELLED' }
  }
  const sessions = {
    sessions: new Map(),
    createSession: async () => { const session = { id: 'session-' + (sessions.sessions.size + 1), messages: [] }; sessions.sessions.set(session.id, session); return session },
    getSession: async id => { const session = sessions.sessions.get(id); if (!session) throw new Error('NF'); return structuredClone(session) },
    appendMessage: async (id, role, text) => { sessions.sessions.get(id).messages.push({ role, text }) },
    listSessions: async () => [...sessions.sessions.values()].map(({ id, title, updatedAt, messages }) => ({ id, title, updatedAt: updatedAt || '2026-10-01T00:00:00.000Z', messageCount: messages.length }))
  }
  let key = null
  const tokenStore = { readKey: async () => key, status: async () => ({ saved: !!key }), saveKey: async value => { key = value }, clearKey: async () => { key = null } }
  const activity = []
  const providers = over.providers || { catalog: async () => [{ id: 'openai-api', name: 'OpenAI API', kind: 'cloud', configured: true }, { id: 'ollama', name: 'Ollama', kind: 'local', configured: true }, { id: 'lmstudio', name: 'LM Studio', kind: 'local', configured: true }, { id: 'union', name: 'Union', kind: 'union', configured: true }],
    models: async id => { if (id === 'lmstudio') throw Object.assign(new Error('x'), { code: 'PROVIDER_ERROR' }); return id === 'ollama' ? [{ id: 'qwen3:8b', label: 'qwen3:8b' }, { id: 'llama4:16x17b', label: 'llama4' }] : [{ id: 'gpt-6.1-sol', label: 'GPT-6.1 Sol' }] } }
  const gateway = createChannelGateway({ core, sessions, providers, readImage: over.readImage || null, importImage: over.importImage || null, removeImage: over.removeImage || null, albumWaitMs: over.albumWaitMs || 30, filePath: path.join(directory, 'channels.json'), tokenStore, makeApi: ({ token }) => { if (token === 'BAD') throw Object.assign(new Error('x'), { code: 'INVALID_TOKEN' }); return api }, pollMs: 5, approvalTimeoutMs: over.approvalTimeoutMs || 60000, onActivity: value => activity.push(value) })
  t.after(() => gateway.dispose())
  gateway._setApi(api)
  return { gateway, sent, answered, edited, started, responded, cancelled, tasks, sessions, activity, actions, api, directory, tokenStore, core }
}

async function pair(gateway, chat = OWNER) {
  await gateway.configure({ provider: 'openai-api', model: 'gpt-6.1-sol', accessMode: 'ask', language: 'en' })
  gateway._setApi(gateway._api)
  const { code } = gateway.startPairing()
  await gateway._handle(msg(chat, '/pair ' + code))
}

test('an unpaired or non-private chat cannot give orders; stale messages are ignored', async t => {
  const { gateway, sent, started } = await setup(t)
  await gateway._handle(msg(OTHER, 'delete everything'))
  await gateway._handle(msg(OTHER, 'again'))
  assert.equal(sent.length, 1, 'one notice per ten minutes'); assert.match(sent[0].text, /not paired/)
  await gateway._handle({ message: { chat: { id: OWNER, type: 'group' }, from: { id: OWNER }, text: 'hello', date: Math.floor(Date.now() / 1000) } })
  await gateway._handle(msg(OTHER, '/pair 123456', { date: Math.floor(Date.now() / 1000) - 3600 }))
  assert.equal(started.length, 0); assert.equal(sent.length, 1)
})

test('pairing: needs the open one-time code, five tries, single use, and expires', async t => {
  const { gateway, sent } = await setup(t)
  await gateway._handle(msg(OWNER, '/pair 123456'))
  assert.match(sent.at(-1).text, /not open/)
  const first = gateway.startPairing()
  assert.equal(first.code.length, 6)
  await gateway._handle(msg(OWNER, '/pair 000000')); assert.match(sent.at(-1).text, /not valid/)
  await gateway._handle(msg(OWNER, '/pair ' + first.code)); assert.match(sent.at(-1).text, /Paired/)
  assert.deepEqual((await gateway.status()).allowed.map(item => item.chatId), [OWNER])
  await gateway._handle(msg(OTHER, '/pair ' + first.code)); assert.match(sent.at(-1).text, /not open/, 'a code works once')
  const second = gateway.startPairing()
  for (let i = 0; i < 5; i++) await gateway._handle(msg(OTHER, '/pair 000001'))
  await gateway._handle(msg(OTHER, '/pair ' + second.code)); assert.match(sent.at(-1).text, /not open/, 'five wrong tries close pairing')
  assert.equal((await gateway.status()).allowed.length, 1)
  assert.equal(JSON.stringify(await gateway.status()).includes(second.code), false, 'a closed code is not reported')
})

test('a paired chat runs a task with the configured model and access mode, and the conversation is saved', async t => {
  const ctx = await setup(t, { onStart: (task, request) => { task.state = 'COMPLETED'; task.output = 'Answer to: ' + request.text } })
  const { gateway, sent, started, sessions, activity } = ctx
  gateway._api = ctx.api
  await pair(gateway)
  await gateway._handle(msg(OWNER, 'What is on my desktop?'))
  assert.equal(started.length, 1); assert.equal(started[0].provider, 'openai-api'); assert.equal(started[0].modelName, 'gpt-6.1-sol'); assert.equal(started[0].accessMode, 'ask')
  assert.equal(started[0].history.at(-1).text, 'What is on my desktop?'); assert.match(started[0].intentId, /^[0-9a-f-]{36}$/)
  assert.equal(sent.at(-1).text, 'Answer to: What is on my desktop?')
  const session = [...sessions.sessions.values()][0]
  assert.deepEqual(session.messages.map(item => item.role), ['user', 'assistant']); assert.ok(session.messages[0].text.startsWith('\u{1F4F1}'))
  assert.ok(activity.length >= 2)
  await gateway._handle(msg(OWNER, 'And the downloads?'))
  assert.equal(started[1].history.length, 3, 'the earlier turn is part of the history'); assert.equal(started[1].conversationId, started[0].conversationId)
  await gateway._handle(msg(OWNER, '/new'))
  await gateway._handle(msg(OWNER, 'fresh start'))
  assert.notEqual(started[2].conversationId, started[0].conversationId); assert.equal(started[2].history.length, 1)
})

test('an unconfigured channel, a busy task, /stop, /status and failures are reported', async t => {
  let mode = 'hang'
  const ctx = await setup(t, { onStart: task => { if (mode === 'fail') { task.state = 'FAILED'; task.errorCode = 'PROVIDER_ERROR' } if (mode === 'unknown') { task.state = 'UNKNOWN_EFFECT'; task.output = 'Maybe done' } } })
  const { gateway, sent, started, cancelled } = ctx
  await gateway._handle(msg(OWNER, '/pair 1')) // not paired yet: a notice only
  gateway._api = ctx.api
  await gateway.configure({ provider: null, model: null }); gateway._setApi(ctx.api)
  gateway.startPairing(); const { code } = gateway.startPairing(); await gateway._handle(msg(OWNER, '/pair ' + code))
  await gateway._handle(msg(OWNER, 'hello')); assert.match(sent.at(-1).text, /no model selected/); assert.equal(started.length, 0)
  await gateway.configure({ provider: 'openai-api', model: 'gpt-6.1-sol' }); gateway._setApi(ctx.api)
  const running = gateway._handle(msg(OWNER, 'long task'))
  await new Promise(resolve => setTimeout(resolve, 30))
  // A second message joins the running task (2026-10-24) instead of being turned away.
  await gateway._handle(msg(OWNER, 'second')); assert.match(sent.at(-1).text, /adding this to the current task/)
  await gateway._handle(msg(OWNER, '/status')); assert.match(sent.at(-1).text, /A task is running/)
  await gateway._handle(msg(OWNER, '/stop')); assert.deepEqual(cancelled, ['task-1'])
  await running; assert.match(sent.at(-1).text, /stopped/)
  await gateway._handle(msg(OWNER, '/stop')); assert.match(sent.at(-1).text, /Nothing is running/)
  mode = 'fail'; await gateway._handle(msg(OWNER, 'will fail')); assert.match(sent.at(-1).text, /PROVIDER_ERROR/)
  mode = 'unknown'; await gateway._handle(msg(OWNER, 'unsure')); assert.match(sent.at(-1).text, /Maybe done[\s\S]*could not be confirmed/)
})

test('approvals are asked in the chat with Allow / Deny; only the paired chat can answer, once; silence denies', async t => {
  const approvalId = 'a1b2c3d4-0000-4000-8000-000000000001'
  const ctx = await setup(t, { approvalTimeoutMs: 80, onStart: task => { task.state = 'WAITING_APPROVAL'; task.approvalId = approvalId; task.proposedTool = 'najd-files-write'; task.proposedInput = { path: 'C:/w/out.txt', summary: 'Write out.txt' } } })
  const { gateway, sent, responded, answered, edited, tasks } = ctx
  gateway._api = ctx.api
  await pair(gateway)
  const running = gateway._handle(msg(OWNER, 'write a file'))
  await new Promise(resolve => setTimeout(resolve, 40))
  const card = sent.find(item => item.extra?.reply_markup)
  assert.ok(card, 'an approval card was sent'); assert.match(card.text, /najd-files-write/)
  const [allow, deny] = card.extra.reply_markup.inline_keyboard[0]
  assert.equal(allow.callback_data, `a:${approvalId}:y`); assert.equal(deny.callback_data, `a:${approvalId}:n`)
  await gateway._handle({ callback_query: { id: 'q0', from: { id: OTHER }, data: allow.callback_data, message: { chat: { id: OTHER }, text: card.text } } })
  assert.deepEqual(responded, [], 'another chat cannot answer')
  await gateway._handle({ callback_query: { id: 'q1', from: { id: OWNER }, data: allow.callback_data, message: { chat: { id: OWNER }, message_id: 1, text: card.text } } })
  assert.deepEqual(responded, [[approvalId, 'ALLOW_ONCE']]); assert.equal(answered.at(-1).text, 'Allowed.'); assert.match(edited.at(-1).text, /Allowed\./)
  await gateway._handle({ callback_query: { id: 'q2', from: { id: OWNER }, data: allow.callback_data, message: { chat: { id: OWNER }, text: card.text } } })
  assert.equal(responded.length, 1, 'the same card cannot be used twice'); assert.equal(answered.at(-1).text, 'That request is no longer waiting.')
  tasks.get('task-1').state = 'COMPLETED'; tasks.get('task-1').output = 'done'
  await running
  // Silence: a second approval that nobody answers is denied after the timeout.
  const second = gateway._handle(msg(OWNER, 'another'))
  await new Promise(resolve => setTimeout(resolve, 200))
  assert.deepEqual(responded.at(-1), [approvalId, 'DENY']); assert.match(sent.at(-1).text, /No answer in time/)
  tasks.get('task-2').state = 'CANCELLED'; await second
})

test('long replies are split, and settings and tokens are validated', async t => {
  assert.ok(chunks('x'.repeat(9000)).length >= 3); assert.ok(chunks('a\n'.repeat(5000)).every(part => part.length <= 3800))
  const ctx = await setup(t)
  const { gateway, tokenStore } = ctx
  await assert.rejects(gateway.configure({ provider: 'not-a-provider' }), { code: 'INVALID_INPUT' })
  await assert.rejects(gateway.configure({ accessMode: 'root' }), { code: 'INVALID_INPUT' })
  await assert.rejects(gateway.configure({ model: '../x' }), { code: 'INVALID_INPUT' })
  await assert.rejects(gateway.saveToken('BAD'), { code: 'INVALID_TOKEN' }); assert.equal(await tokenStore.readKey(), null)
  const status = await gateway.saveToken('123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij'); assert.equal(status.tokenSaved, true); assert.equal(status.botName, '@najd_test_bot')
  assert.equal(JSON.stringify(status).includes('ABCDEFGHIJ'), false, 'the token never appears in the status')
  await gateway.stop()
  assert.throws(() => gateway.startPairing(), { code: 'NOT_RUNNING' })
})

test('the polling loop skips the backlog, handles new updates and keeps working through errors', async t => {
  const scripted = [[{ update_id: 5, message: msg(OWNER, 'old order').message }], [], [{ update_id: 7, message: msg(OTHER, 'hello').message }], 'error', []]
  const calls = []
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'najd-channels-loop-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const sent = []
  let index = 0
  const api = { getMe: async () => ({ username: 'b' }), setMyCommands: async () => {}, sendMessage: async (chatId, text) => { sent.push([chatId, text]); return { message_id: 1 } },
    getUpdates: async (offset, signal) => { calls.push(offset); const next = scripted[index++]; if (next === undefined) { await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true })); throw Object.assign(new Error('x'), { code: 'CANCELLED' }) } if (next === 'error') throw Object.assign(new Error('x'), { code: 'NETWORK' }); return next } }
  let key = '123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij'
  const gateway = createChannelGateway({ core: {}, sessions: {}, filePath: path.join(directory, 'c.json'), tokenStore: { readKey: async () => key, status: async () => ({ saved: true }), saveKey: async () => {}, clearKey: async () => {} }, makeApi: () => api, pollMs: 5, longPollSeconds: 1 })
  t.after(() => gateway.dispose())
  await gateway.configure({ enabled: true })
  for (let i = 0; i < 100 && sent.length === 0; i++) await new Promise(resolve => setTimeout(resolve, 20))
  assert.equal(calls[0], -1, 'the backlog is read only to be skipped'); assert.equal(calls[1], 6, 'polling continues after it')
  assert.deepEqual(sent.map(item => item[0]), [OTHER], 'the old order was never handled; the new message from an unpaired chat got only the notice')
  assert.equal((await gateway.status()).state, 'running')
  await gateway.stop(); assert.equal((await gateway.status()).state, 'stopped')
})

test('authorization binds the Telegram user as well as the chat, and revoking cancels work and denies approvals', async t => {
  const approvalId = 'a1b2c3d4-0000-4000-8000-000000000009'
  const ctx = await setup(t, { onStart: task => { task.state = 'WAITING_APPROVAL'; task.approvalId = approvalId; task.proposedTool = 'najd-files-delete'; task.proposedInput = { path: 'C:/w/x' } } })
  const { gateway, sent, started, responded, cancelled } = ctx
  gateway._api = ctx.api
  await pair(gateway)
  // The same chat id from a different Telegram user is not the owner.
  await gateway._handle({ message: { chat: { id: OWNER, type: 'private' }, from: { id: 999, first_name: 'Impostor' }, text: 'delete everything', date: Math.floor(Date.now() / 1000) } })
  assert.equal(started.length, 0)
  const running = gateway._handle(msg(OWNER, 'delete the file'))
  await new Promise(resolve => setTimeout(resolve, 40))
  const card = sent.find(item => item.extra?.reply_markup)
  await gateway._handle({ callback_query: { id: 'x', from: { id: 999 }, data: card.extra.reply_markup.inline_keyboard[0][0].callback_data, message: { chat: { id: OWNER }, text: 'x' } } })
  assert.deepEqual(responded, [], 'a different user cannot press the owner buttons')
  await gateway.unpair(OWNER)
  assert.deepEqual(responded.at(-1), [approvalId, 'DENY'], 'unpairing denies the pending approval'); assert.deepEqual(cancelled, ['task-1'], 'and cancels the running task')
  await running
  const before = started.length
  await gateway._handle(msg(OWNER, 'hello again')); assert.equal(started.length, before, 'an unpaired chat starts nothing')
})

test('a message the core refuses is not saved, and the conversation sent along stays bounded', async t => {
  const ctx = await setup(t)
  const { gateway, sessions, started, core } = ctx
  gateway._api = ctx.api
  await pair(gateway)
  let refuse = true
  const real = core.startTask
  core.startTask = request => { if (refuse) throw Object.assign(new Error('INVALID_INPUT'), { code: 'INVALID_INPUT' }); return real(request) }
  await gateway._handle(msg(OWNER, 'rejected message'))
  assert.equal([...sessions.sessions.values()].flatMap(session => session.messages).length, 0, 'a refused message is never stored')
  refuse = false
  const session = [...sessions.sessions.values()][0]
  for (let i = 0; i < 400; i++) session.messages.push({ role: i % 2 ? 'assistant' : 'user', text: 'old ' + i })
  core.startTask = request => { started.push(request); return { id: 'task-x', state: 'COMPLETED', output: 'ok' } }
  core.getTask = () => ({ id: 'task-x', state: 'COMPLETED', output: 'ok' })
  await gateway._handle(msg(OWNER, 'new question'))
  assert.ok(started.at(-1).history.length <= 301, 'the history sent is bounded'); assert.equal(started.at(-1).history.at(-1).text, 'new question')
})

test('an approval card shows the full preview, and an approval too long to show is denied instead of cut', async t => {
  const approvalId = 'a1b2c3d4-0000-4000-8000-00000000000a'
  const ctx = await setup(t, { onStart: task => { task.state = 'WAITING_APPROVAL'; task.approvalId = approvalId; task.proposedTool = 'mcp-call'; task.proposedInput = { summary: 'Call tool', preview: 'target=https://example.org/ ' + 'copy file '.repeat(90) + 'END-OF-ARGS' } } })
  const { gateway, sent, responded } = ctx
  gateway._api = ctx.api
  await pair(gateway)
  const running = gateway._handle(msg(OWNER, 'run it'))
  await new Promise(resolve => setTimeout(resolve, 60))
  assert.match(sent.find(item => item.extra?.reply_markup).text, /END-OF-ARGS/, 'the whole preview is shown')
  await gateway.unpair(OWNER); await running
  const big = await setup(t, { onStart: task => { task.state = 'WAITING_APPROVAL'; task.approvalId = approvalId; task.proposedTool = 'mcp-call'; task.proposedInput = { preview: 'arg value '.repeat(900) } } })
  big.gateway._api = big.api
  await pair(big.gateway)
  const bigRun = big.gateway._handle(msg(OWNER, 'run it'))
  await new Promise(resolve => setTimeout(resolve, 60))
  await big.gateway.unpair(OWNER); await bigRun
  assert.deepEqual(big.responded.at(-1), [approvalId, 'DENY']); assert.ok(!big.sent.some(item => item.extra?.reply_markup))
})

test('/stop reaches a request that is still preparing, a replacement token restarts the channel, and a failed backlog request never lets old messages through', async t => {
  const ctx = await setup(t)
  const { gateway, sessions, started, sent } = ctx
  gateway._api = ctx.api
  await pair(gateway)
  const slow = sessions.getSession
  let release
  sessions.getSession = async id => { await new Promise(resolve => { release = resolve }); return slow(id) }
  sessions.sessions.set('session-9', { id: 'session-9', messages: [] })
  await gateway.configure({ provider: 'openai-api', model: 'gpt-6.1-sol' })
  const settings = JSON.parse(await fs.readFile(path.join(ctx.directory, 'channels.json'), 'utf8'))
  settings.telegram.sessions[OWNER] = 'session-9'; await fs.writeFile(path.join(ctx.directory, 'channels.json'), JSON.stringify(settings))
  const pending = gateway._handle(msg(OWNER, 'start something'))
  await new Promise(resolve => setTimeout(resolve, 30))
  await gateway._handle(msg(OWNER, '/stop'))
  assert.match(sent.at(-1).text, /Stopped/)
  release(); await pending
  assert.equal(started.length, 0, 'the stopped request never started')
})

test('a request being dispatched while its chat is unpaired never starts a task', async t => {
  const ctx = await setup(t)
  const { gateway, started } = ctx
  gateway._api = ctx.api
  await pair(gateway)
  const settingsBefore = JSON.parse(await fs.readFile(path.join(ctx.directory, 'channels.json'), 'utf8')).telegram
  await gateway.unpair(OWNER)
  // A handler that already read the old allowed list reaches the start step after the removal.
  await gateway._handleWith(msg(OWNER, 'late order').message, settingsBefore)
  assert.equal(started.length, 0)
})

test('a request with anything to mask is denied instead of shown, because the owner must approve exactly what runs', async t => {
  const approvalId = 'a1b2c3d4-0000-4000-8000-00000000000b'
  const ctx = await setup(t, { onStart: task => { task.state = 'WAITING_APPROVAL'; task.approvalId = approvalId; task.proposedTool = 'najd-run-command'; task.proposedInput = { command: "$env:TOKEN=('x'); Remove-Item C:/work/important.txt" } } })
  ctx.gateway._api = ctx.api
  await pair(ctx.gateway)
  const running = ctx.gateway._handle(msg(OWNER, 'clean up'))
  await new Promise(resolve => setTimeout(resolve, 60))
  assert.deepEqual(ctx.responded.at(-1), [approvalId, 'DENY']); assert.ok(!ctx.sent.some(item => item.extra?.reply_markup), 'no Allow button')
  await ctx.gateway.unpair(OWNER); await running
})

test('indented previews are shown whole, and an action shown only in part is denied', async t => {
  const approvalId = 'a1b2c3d4-0000-4000-8000-00000000000c'
  const pretty = JSON.stringify({ path: 'C:/work/notes.txt', mode: ['read', 'list'], nested: { depth: 2 } }, null, 2)
  const shown = await setup(t, { onStart: task => { task.state = 'WAITING_APPROVAL'; task.approvalId = approvalId; task.proposedTool = 'najd-mcp-call'; task.proposedInput = { summary: 'Run a tool', preview: pretty } } })
  shown.gateway._api = shown.api
  await pair(shown.gateway)
  const first = shown.gateway._handle(msg(OWNER, 'go'))
  await new Promise(resolve => setTimeout(resolve, 60))
  const card = shown.sent.find(item => item.extra?.reply_markup)
  assert.ok(card, 'pretty-printed arguments get an Allow button'); assert.ok(card.text.includes(pretty), 'with the indentation intact')
  await shown.gateway.unpair(OWNER); await first
  const partial = await setup(t, { onStart: task => { task.state = 'WAITING_APPROVAL'; task.approvalId = approvalId; task.proposedTool = 'najd-files-write'; task.proposedInput = { path: 'C:/w/a.ps1', summary: 'Overwrite (5000 characters)', preview: 'harmless start', truncated: true } } })
  partial.gateway._api = partial.api
  await pair(partial.gateway)
  const second = partial.gateway._handle(msg(OWNER, 'go'))
  await new Promise(resolve => setTimeout(resolve, 60))
  assert.deepEqual(partial.responded.at(-1), [approvalId, 'DENY']); assert.ok(!partial.sent.some(item => item.extra?.reply_markup))
  await partial.gateway.unpair(OWNER); await second
})

// ---------- remote control (2026-10-24) ----------
const { randomUUID } = require('node:crypto')
const press = (chat, data) => ({ callback_query: { id: 'cb-' + data, data, from: { id: chat }, message: { chat: { id: chat }, message_id: 1, text: '' } } })
const settle = () => new Promise(resolve => setTimeout(resolve, 40))

test('the QR link pairs too: /start with the code works like /pair', async t => {
  const { gateway, api, sent } = await setup(t)
  gateway._api = api
  await gateway.configure({ language: 'en' })
  gateway._setApi(api)
  const { code } = gateway.startPairing()
  await gateway._handle(msg(OWNER, '/start ' + code))
  assert.match(sent.at(-1).text, /Paired/)
})

test('/chats lists recent conversations, opening one recaps it and the next message continues it', async t => {
  const { gateway, api, sent, sessions, started } = await setup(t, { onStart: task => { task.state = 'COMPLETED'; task.output = 'ok' } })
  gateway._api = api
  await pair(gateway)
  const desk = randomUUID()
  sessions.sessions.set(desk, { id: desk, title: 'Quarterly report', updatedAt: '2026-10-20T00:00:00.000Z', messages: [{ role: 'user', text: 'Draft the report' }, { role: 'assistant', text: 'Here is the draft. password: hunter2-secret-value' }] })
  await gateway._handle(msg(OWNER, '/chats'))
  const menu = sent.at(-1)
  assert.match(menu.text, /recent conversations/)
  assert.deepEqual(menu.extra.reply_markup.inline_keyboard.map(row => row[0].callback_data), ['o:' + desk])
  await gateway._handle(press(OWNER, 'o:' + desk))
  assert.match(sent.at(-1).text, /Opened: Quarterly report/); assert.match(sent.at(-1).text, /Draft the report/)
  assert.doesNotMatch(sent.at(-1).text, /hunter2/, 'secrets in the recap are masked')
  await gateway._handle(msg(OWNER, 'add a summary'))
  assert.equal(started.at(-1).conversationId, desk)
  assert.deepEqual(started.at(-1).history.slice(0, 2).map(item => item.text), ['Draft the report', 'Here is the draft. password: hunter2-secret-value'])
  // A chat that is not paired cannot open anything.
  await gateway._handle(press(OTHER, 'o:' + desk))
  assert.ok(!sent.some(item => item.chatId === OTHER && /Opened/.test(item.text)))
})

test('/model picks a connected provider then one of its models; unions and unknown choices are not offered', async t => {
  const { gateway, api, sent } = await setup(t)
  gateway._api = api
  await pair(gateway)
  await gateway._handle(msg(OWNER, '/model'))
  assert.deepEqual(sent.at(-1).extra.reply_markup.inline_keyboard.map(row => row[0].callback_data), ['p:openai-api', 'p:ollama'])
  await gateway._handle(press(OWNER, 'p:ollama'))
  const buttons = sent.at(-1).extra.reply_markup.inline_keyboard.flat()
  assert.deepEqual(buttons.map(button => button.callback_data), ['m:0', 'm:1'])
  await gateway._handle(press(OWNER, 'm:1'))
  assert.match(sent.at(-1).text, /ollama \/ llama4:16x17b/)
  const status = await gateway.status()
  assert.equal(status.provider, 'ollama'); assert.equal(status.model, 'llama4:16x17b')
  await gateway._handle(press(OWNER, 'm:1'))
  assert.match(sent.at(-1).text, /no longer waiting/, 'a menu is used once')
  const count = sent.length
  await gateway._handle(press(OWNER, 'p:not-a-provider'))
  assert.equal(sent.length, count, 'an unknown provider is ignored')
})

test('work on the computer stays on the computer unless its request asks for Telegram; then the answer arrives, the channel\'s own tasks never', async t => {
  const { gateway, api, sent, sessions, tasks } = await setup(t)
  gateway._api = api
  await pair(gateway)
  const desk = randomUUID(), other = randomUUID()
  sessions.sessions.set(desk, { id: desk, title: 'Website', messages: [] })
  sessions.sessions.set(other, { id: other, title: 'Budget', messages: [] })
  await gateway._handle(press(OWNER, 'o:' + desk))
  const before = sent.length
  // Not asked: nothing, even for the conversation the chat follows.
  tasks.set('desk-0', { id: 'desk-0', state: 'RUNNING', output: null, conversationId: desk })
  gateway.taskChanged({ taskId: 'desk-0', conversationId: desk }); await settle()
  tasks.get('desk-0').state = 'COMPLETED'; tasks.get('desk-0').output = 'done quietly'
  gateway.taskChanged({ taskId: 'desk-0', conversationId: desk }); await settle()
  tasks.set('desk-q', { id: 'desk-q', state: 'FAILED', errorCode: 'MODEL_NOT_CONFIGURED', conversationId: other })
  gateway.taskChanged({ taskId: 'desk-q', conversationId: other }); await settle()
  assert.equal(sent.length, before, 'no start, finish or failure notice')
  // Asked ("send it to me on Telegram"): the following chat gets the whole answer, once, with no start notice.
  tasks.set('desk-1', { id: 'desk-1', state: 'RUNNING', output: null, conversationId: desk, channelNotice: true })
  gateway.taskChanged({ taskId: 'desk-1', conversationId: desk }); await settle()
  assert.equal(sent.length, before)
  tasks.get('desk-1').state = 'COMPLETED'; tasks.get('desk-1').output = 'The site is ready.\n' + 'x'.repeat(400)
  gateway.taskChanged({ taskId: 'desk-1', conversationId: desk }); await settle()
  gateway.taskChanged({ taskId: 'desk-1', conversationId: desk }); await settle()
  assert.equal(sent.length, before + 1)
  assert.match(sent.at(-1).text, /Finished on the computer: Website/); assert.ok(sent.at(-1).text.includes('x'.repeat(400)), 'the whole answer')
  // Another conversation nobody follows: every paired chat, with the answer and a button to open it.
  tasks.set('desk-2', { id: 'desk-2', state: 'COMPLETED', output: 'y'.repeat(500), conversationId: other, channelNotice: true })
  gateway.taskChanged({ taskId: 'desk-2', conversationId: other }); await settle()
  assert.match(sent.at(-1).text, /Finished on the computer: Budget/); assert.ok(sent.at(-1).text.includes('y'.repeat(500)))
  assert.equal(sent.at(-1).extra.reply_markup.inline_keyboard[0][0].callback_data, 'o:' + other)
  // The channel's own task is never told as work on the computer.
  await gateway._handle(press(OWNER, 'o:' + other))
  const own = sent.length
  const run = gateway._handle(msg(OWNER, 'hello'))
  await settle()
  const ownId = [...tasks.keys()].find(id => id.startsWith('task-'))
  tasks.get(ownId).channelNotice = true
  gateway.taskChanged({ taskId: ownId, conversationId: other }); await settle()
  tasks.get(ownId).state = 'COMPLETED'; tasks.get(ownId).output = 'own answer'
  await run
  gateway.taskChanged({ taskId: ownId, conversationId: other }); await settle()
  assert.equal(sent.slice(own).filter(item => /on the computer/.test(item.text)).length, 0)
  assert.equal(sent.slice(own).filter(item => item.text === 'own answer').length, 1)
})
test('a permission request on the computer is relayed with buttons and, unanswered, withdrawn without denying it', async t => {
  const { gateway, api, sent, sessions, tasks, responded } = await setup(t, { approvalTimeoutMs: 150 })
  gateway._api = api
  await pair(gateway)
  const desk = randomUUID(), approvalId = randomUUID()
  sessions.sessions.set(desk, { id: desk, title: 'Cleanup', messages: [] })
  tasks.set('desk-9', { id: 'desk-9', state: 'WAITING_APPROVAL', approvalId, proposedTool: 'najd-files-delete', proposedInput: { path: 'C:/w/old.txt', summary: 'Delete one file' }, conversationId: desk, channelNotice: true })
  gateway.taskChanged({ taskId: 'desk-9', conversationId: desk }); await settle()
  assert.match(sent.at(-2).text, /"Cleanup" on the computer is waiting for your permission/)
  assert.deepEqual(sent.at(-1).extra.reply_markup.inline_keyboard[0].map(button => button.callback_data), [`a:${approvalId}:y`, `a:${approvalId}:n`])
  await new Promise(resolve => setTimeout(resolve, 250))
  assert.equal(responded.length, 0, 'not denied on timeout: the owner may answer in the app')
  // Answered from the phone in a second request.
  const second = randomUUID()
  tasks.set('desk-10', { id: 'desk-10', state: 'WAITING_APPROVAL', approvalId: second, proposedTool: 'najd-files-delete', proposedInput: { path: 'C:/w/b.txt', summary: 'Delete' }, conversationId: desk, channelNotice: true })
  gateway.taskChanged({ taskId: 'desk-10', conversationId: desk }); await settle()
  await gateway._handle(press(OWNER, `a:${second}:y`))
  assert.deepEqual(responded.at(-1), [second, 'ALLOW_ONCE'])
})

test('a reply with a library picture arrives formatted, then as a photo; a picture that cannot be read is skipped', async t => {
  const picture = 'b'.repeat(64)
  const photos = []
  const { gateway, api, sent } = await setup(t, { onStart: task => { task.state = 'COMPLETED'; task.output = `**Here** is your screen.\n\n![](najd-library://${picture})\n\n![](najd-library://${'c'.repeat(64)})\n\n![](najd-library://${'e'.repeat(64)})`; task.images = [picture, 'c'.repeat(64)] },
    // 'c' cannot be read; 'e' can be read but this task did not save it, so it is never sent (C1-01).
    readImage: async id => { if (id === 'c'.repeat(64)) throw new Error('NOT_FOUND'); return 'data:image/jpeg;base64,' + Buffer.from('jpeg-bytes').toString('base64') } })
  api.sendPhoto = async (chatId, bytes, options) => { photos.push({ chatId, bytes: bytes.toString(), mime: options.mime }) }
  gateway._api = api
  await pair(gateway)
  await gateway._handle(msg(OWNER, 'send me a screenshot'))
  assert.equal(sent.at(-1).text, '<b>Here</b> is your screen.'); assert.equal(sent.at(-1).extra.parse_mode, 'HTML')
  assert.deepEqual(photos, [{ chatId: OWNER, bytes: 'jpeg-bytes', mime: 'image/jpeg' }])
})

// ---------- professional channel (owner feedback 2026-10-24) ----------
test('a permission card speaks the reply language, offers "allow for this task" on agent steps, and leaves the chat once answered', async t => {
  const approvalId = randomUUID()
  const { gateway, api, sent, responded } = await setup(t, { onStart: task => { task.state = 'WAITING_APPROVAL'; task.approvalId = approvalId; task.viaAgent = true; task.proposedTool = 'najd-screen-capture'; task.proposedInput = { summary: 'Take one screenshot', path: 'Your whole primary screen' } } })
  const deleted = []
  api.deleteMessage = async (chatId, messageId) => { deleted.push([chatId, messageId]) }
  gateway._api = api
  await pair(gateway)
  await gateway.configure({ language: 'ar' })
  gateway._setApi(api)
  const run = gateway._handle(msg(OWNER, 'صور الشاشة'))
  await settle(); await settle()
  const card = sent.find(item => item.extra?.reply_markup?.inline_keyboard?.flat().some(button => button.callback_data === `a:${approvalId}:t`))
  assert.ok(card, 'three choices for an agent step')
  assert.match(card.text, /يطلب نجد إذنك/); assert.match(card.text, /لقطة شاشة/); assert.match(card.text, /الوصف: Take one screenshot/); assert.match(card.text, /الهدف: Your whole primary screen/)
  await gateway._handle(press(OWNER, `a:${approvalId}:t`))
  assert.deepEqual(responded.at(-1), [approvalId, 'ALLOW_TASK'])
  assert.deepEqual(deleted, [[OWNER, card.message_id ?? sent.indexOf(card) + 1]], 'the answered card is removed')
  await gateway.unpair(OWNER); await run
})

test('a photo sent to the bot is downloaded, kept in the library and given to the model with its caption', async t => {
  const { gateway, api, sent, started, sessions } = await setup(t, { onStart: task => { task.state = 'COMPLETED'; task.output = 'A rainbow over a lake.' },
    importImage: async (name, bytes) => { assert.equal(bytes.toString(), 'jpeg-bytes'); assert.match(name, /^Telegram photo .+\.jpg$/); return { id: 'a'.repeat(64), name } } })
  api.downloadFile = async fileId => { assert.equal(fileId, 'BIG-file-id-0000'); return { bytes: Buffer.from('jpeg-bytes'), path: 'photos/x.jpg' } }
  gateway._api = api
  await pair(gateway)
  await gateway._handle({ message: { chat: { id: OWNER, type: 'private' }, from: { id: OWNER }, date: Math.floor(Date.now() / 1000), caption: 'وش ذي',
    photo: [{ file_id: 'small-file-id-000', file_size: 100 }, { file_id: 'BIG-file-id-0000', file_size: 5000 }] } })
  assert.deepEqual(started.at(-1).assetIds, ['a'.repeat(64)]); assert.equal(started.at(-1).text, 'وش ذي')
  const saved = [...sessions.sessions.values()].at(-1).messages[0]
  assert.equal(saved.role, 'user')
  assert.match(sent.at(-1).text, /rainbow/)
  // Too large: refused before downloading.
  await gateway._handle({ message: { chat: { id: OWNER, type: 'private' }, from: { id: OWNER }, date: Math.floor(Date.now() / 1000), photo: [{ file_id: 'huge-file-id-0000', file_size: 11 * 1024 * 1024 }] } })
  assert.match(sent.at(-1).text, /larger than 10 MB/)
})

test('the recap of an opened conversation names its pictures instead of showing a masked library address', async t => {
  const { gateway, api, sent, sessions } = await setup(t)
  gateway._api = api
  await pair(gateway)
  const desk = randomUUID()
  sessions.sessions.set(desk, { id: desk, title: 'Screen', messages: [{ role: 'user', text: 'screenshot please' }, { role: 'assistant', text: `Here it is.\n\n![](najd-library://${'b'.repeat(64)})` }] })
  await gateway._handle(press(OWNER, 'o:' + desk))
  assert.doesNotMatch(sent.at(-1).text, /redacted|najd-library/); assert.match(sent.at(-1).text, /Here it is\. \u{1F5BC}/u)
})

test('a photo is not downloaded while the chat is busy or without a model, and one whose task never starts is removed (C5-02)', async t => {
  const downloads = [], removed = []
  const photo = (id = 'photo-file-id-000') => ({ message: { chat: { id: OWNER, type: 'private' }, from: { id: OWNER }, date: Math.floor(Date.now() / 1000), photo: [{ file_id: id, file_size: 100 }] } })
  const { gateway, api, sent } = await setup(t, { importImage: async name => ({ id: 'd'.repeat(64), name }), removeImage: async id => { removed.push(id) } })
  api.downloadFile = async fileId => { downloads.push(fileId); return { bytes: Buffer.from('x'), path: 'p.jpg' } }
  gateway._api = api
  await pair(gateway)
  // No model chosen: refused before downloading.
  await gateway.configure({ provider: null, model: null })
  gateway._setApi(api)
  await gateway._handle(photo())
  assert.equal(downloads.length, 0); assert.match(sent.at(-1).text, /no model/)
  // A task is already running in this chat: refused before downloading.
  await gateway.configure({ provider: 'openai-api', model: 'gpt-6.1-sol' })
  gateway._setApi(api)
  const busy = gateway._handle(msg(OWNER, 'a long task'))
  await settle()
  await gateway._handle(photo())
  assert.equal(downloads.length, 0); assert.match(sent.at(-1).text, /still working/)
  await gateway.unpair(OWNER); await busy
  // The chat was unpaired while the picture downloaded: its task never starts, so the picture is removed.
  await pair(gateway)
  api.downloadFile = async fileId => { downloads.push(fileId); await gateway.unpair(OWNER); return { bytes: Buffer.from('x'), path: 'p.jpg' } }
  await gateway._handle(photo('photo-file-id-111'))
  assert.deepEqual(downloads, ['photo-file-id-111']); assert.deepEqual(removed, ['d'.repeat(64)])
})

test('a text sent while a photo downloads waits its turn: the photo keeps the chat and is worked on (C6-01)', async t => {
  const removed = []
  const { gateway, api, sent, started } = await setup(t, { onStart: task => { task.state = 'COMPLETED'; task.output = 'ok' },
    importImage: async name => ({ id: 'e'.repeat(64), name }), removeImage: async id => { removed.push(id) } })
  let release
  api.downloadFile = async () => { await new Promise(resolve => { release = resolve }); return { bytes: Buffer.from('x'), path: 'p.jpg' } }
  gateway._api = api
  await pair(gateway)
  const photo = gateway._handle({ message: { chat: { id: OWNER, type: 'private' }, from: { id: OWNER }, date: Math.floor(Date.now() / 1000), caption: 'what is this', photo: [{ file_id: 'photo-file-id-222', file_size: 100 }] } })
  while (!release) await settle()
  await gateway._handle(msg(OWNER, 'a text in between'))
  assert.match(sent.at(-1).text, /still working/, 'the text is told to wait')
  release(); await photo
  assert.equal(started.length, 1); assert.equal(started[0].text, 'what is this'); assert.deepEqual(started[0].assetIds, ['e'.repeat(64)])
  assert.deepEqual(removed, [], 'the photo is kept')
})

test('an album (several photos with one caption) is one request with all its pictures, not a busy reply', async t => {
  let n = 0
  const { gateway, api, sent, started } = await setup(t, { albumWaitMs: 40, onStart: task => { task.state = 'COMPLETED'; task.output = 'Found it.' },
    importImage: async name => ({ id: String(++n).repeat(64).slice(0, 64), name }) })
  api.downloadFile = async () => ({ bytes: Buffer.from('x'), path: 'p.jpg' })
  gateway._api = api
  await pair(gateway)
  const part = (fileId, caption) => ({ message: { chat: { id: OWNER, type: 'private' }, from: { id: OWNER }, date: Math.floor(Date.now() / 1000), media_group_id: 'album1', ...(caption ? { caption } : {}),
    photo: [{ file_id: fileId, file_size: 100 }] } })
  await gateway._handle(part('album-photo-1-id', 'find this remote for impex TVs'))
  await gateway._handle(part('album-photo-2-id'))
  for (let i = 0; i < 50 && !started.length; i++) await new Promise(resolve => setTimeout(resolve, 10))
  await new Promise(resolve => setTimeout(resolve, 30))
  assert.equal(started.length, 1, 'one request')
  assert.equal(started[0].text, 'find this remote for impex TVs')
  assert.deepEqual(started[0].assetIds, ['1'.repeat(64), '2'.repeat(64)])
  assert.ok(!sent.some(item => /still working/.test(item.text)), 'no busy reply for the second picture')
})

test('an album is dropped without downloading when the chat is unpaired during its wait (C8-01)', async t => {
  const downloads = []
  const { gateway, api, started } = await setup(t, { albumWaitMs: 40, importImage: async name => ({ id: 'f'.repeat(64), name }) })
  api.downloadFile = async fileId => { downloads.push(fileId); return { bytes: Buffer.from('x'), path: 'p.jpg' } }
  gateway._api = api
  await pair(gateway)
  await gateway._handle({ message: { chat: { id: OWNER, type: 'private' }, from: { id: OWNER }, date: Math.floor(Date.now() / 1000), media_group_id: 'album2', caption: 'x', photo: [{ file_id: 'album2-photo-id-1', file_size: 100 }] } })
  await gateway.unpair(OWNER)
  await new Promise(resolve => setTimeout(resolve, 120))
  assert.deepEqual(downloads, []); assert.equal(started.length, 0)
})

test('while it works, one message shows what NAJD is doing (search, site, tool) and is deleted when the answer arrives', async t => {
  const events = []
  const { gateway, api, sent, tasks } = await setup(t, { onStart: task => { task.activity = { events } } })
  const edited = [], deleted = []
  api.editMessageText = async (chatId, id, text) => { edited.push(text) }
  api.deleteMessage = async (chatId, id) => { deleted.push(id) }
  gateway._api = api
  await pair(gateway)
  await gateway.configure({ language: 'ar' })
  gateway._setApi(api)
  const run = gateway._handle(msg(OWNER, 'ابحث عن ريموت impex'))
  await settle()
  events.push({ seq: 1, type: 'tool.started', tool: 'najd-web-search', detail: 'impex tv remote' }, { seq: 2, type: 'tool.completed', tool: 'najd-web-search' })
  await new Promise(resolve => setTimeout(resolve, 40))
  const progress = sent.find(item => /نجد يشتغل/.test(item.text))
  assert.ok(progress, 'a progress message appears'); assert.match(progress.text, /يبحث في الإنترنت: impex tv remote/); assert.match(progress.text, /1 خطوة/)
  events.push({ seq: 3, type: 'tool.started', tool: 'najd-web-extract', detail: 'https://www.noon.com/saudi-ar/remote' })
  const task = [...tasks.values()].at(-1)
  task.state = 'COMPLETED'; task.output = 'وجدت روابط.'
  await run
  assert.ok(deleted.includes(progress.message_id ?? sent.indexOf(progress) + 1), 'deleted when the answer arrives')
  assert.equal(sent.at(-1).text, 'وجدت روابط.')
})

test('a message sent while a task works joins it (saved in the conversation, acknowledged); one the task never read becomes the next request', async t => {
  const { gateway, api, sent, started, tasks, sessions } = await setup(t)
  gateway._api = api
  await pair(gateway)
  const run = gateway._handle(msg(OWNER, 'find a TV remote'))
  // Under a loaded test run the task can need more than one turn to start; the follow-up must reach a running task.
  for (let i = 0; i < 50 && started.length < 1; i++) await settle()
  const first = [...tasks.values()].at(-1)
  assert.ok(first, 'the first task started')
  await gateway._handle(msg(OWNER, 'it must work with impex TVs'))
  assert.deepEqual(first.notes, ['it must work with impex TVs'], 'handed to the running task')
  assert.match(sent.at(-1).text, /adding this to the current task/)
  assert.ok(!sent.some(item => /still working/.test(item.text)))
  const saved = [...sessions.sessions.values()].at(-1).messages.map(message => message.text)
  assert.ok(saved.includes('it must work with impex TVs'), 'kept in the conversation')
  // The task ends without reading it (as when it was already writing its last words): a new request follows with that text.
  first.state = 'COMPLETED'; first.output = 'Remotes found.'
  await run
  for (let i = 0; i < 50 && started.length < 2; i++) await settle()
  assert.equal(started.length, 2); assert.equal(started[1].text, 'it must work with impex TVs')
  assert.equal([...sessions.sessions.values()].at(-1).messages.filter(message => message.text === 'it must work with impex TVs').length, 1, 'not saved twice')
  const second = [...tasks.values()].at(-1); second.state = 'COMPLETED'; second.output = 'Impex ones.'
  for (let i = 0; i < 50 && !sent.some(item => item.text === 'Impex ones.'); i++) await settle()
})

test('a message added while a new conversation is still being created is saved once, after the message it follows (C10-02)', async t => {
  const { gateway, api, sessions, tasks } = await setup(t)
  gateway._api = api
  await pair(gateway)
  const create = sessions.createSession
  let release
  sessions.createSession = async () => { await new Promise(resolve => { release = resolve }); return create() }
  const run = gateway._handle(msg(OWNER, 'find a TV remote'))
  while (!release) await settle()
  await gateway._handle(msg(OWNER, 'it must work with impex TVs'))
  release()
  for (let i = 0; i < 50 && !tasks.size; i++) await settle()
  await settle(); await settle()
  const texts = [...sessions.sessions.values()].at(-1).messages.map(message => message.text)
  assert.deepEqual(texts.filter(text => /impex/.test(text)), ['it must work with impex TVs'], 'saved once')
  assert.ok(texts.findIndex(text => /impex/.test(text)) > texts.findIndex(text => /find a TV remote/.test(text)), 'after the message it follows')
  const task = [...tasks.values()].at(-1); task.state = 'COMPLETED'; task.output = 'ok'
  await run
})
