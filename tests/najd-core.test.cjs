const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createNajdCore } = require('../electron/najd-core.cjs')

test('update installation busy guard includes queued, planning and pending approval tasks', async () => {
  const core = createNajdCore({ model: async () => ({ kind: 'message', text: 'done' }) })
  assert.equal(core.hasActiveTasks(), false)
  const queued = core.startTask({ text: '/read fixture.txt', intentId: 'update-busy-proof' })
  assert.equal(core.hasActiveTasks(), true)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(core.getTask(queued.id).state, 'WAITING_APPROVAL')
  assert.equal(core.hasActiveTasks(), true)
  core.respondApproval(core.getTask(queued.id).approvalId, 'DENY')
  assert.equal(core.hasActiveTasks(), false)
})

const settle = () => new Promise(resolve => setImmediate(resolve))

test('agent asset identities bind intents and main-owned tool events enter the saved receipt', async () => {
  const id = 'a'.repeat(64)
  const core = createNajdCore({ model: async request => {
    assert.deepEqual(request.assetIds, [id])
    request.onToolEvent('tool.started', 'najd-library-read')
    request.onToolEvent('tool.failed', 'najd-library-read')
    request.onToolEvent('tool.started', 'unsafe-command-with-secret!')
    return { kind: 'message', text: 'Read failed' }
  } })
  const request = { text: 'Read attachment', intentId: 'asset-proof', assetIds: [id] }
  const task = core.startTask(request)
  assert.throws(() => core.startTask({ ...request, assetIds: [] }), { code: 'CONFLICT' })
  assert.throws(() => core.startTask({ ...request, intentId: 'bad', assetIds: ['../../private'] }), { code: 'INVALID_INPUT' })
  await settle()
  const activity = core.getTask(task.id).activity
  assert.ok(activity.events.some(event => event.type === 'tool.failed' && event.tool === 'najd-library-read'))
  assert.equal(JSON.stringify(activity).includes(id), false)
  assert.equal(JSON.stringify(activity).includes('unsafe-command'), false)
})

test('activity records real tool transitions and approval without file contents', async () => {
  const core=createNajdCore({tool:async()=> 'PRIVATE-FILE-CONTENT'})
  const task=core.startTask({text:'/read C:\\fixture.txt',intentId:'activity-tool-proof'})
  await settle()
  const waiting=core.getTask(task.id)
  assert.ok(waiting.activity.events.some(e=>e.type==='approval.requested'&&e.tool==='read-file'))
  core.respondApproval(waiting.approvalId,'ALLOW_ONCE')
  await settle()
  const activity=core.getTask(task.id).activity
  assert.ok(activity.events.some(e=>e.type==='tool.started'))
  assert.ok(activity.events.some(e=>e.type==='tool.completed'))
  assert.ok(activity.finishedAt)
  assert.equal(JSON.stringify(activity).includes('PRIVATE-FILE-CONTENT'),false)
  assert.equal(JSON.stringify(activity).includes('fixture.txt'),false)
})

test('explicit model file command binds its target and never uploads a later tool result', async () => {
  let modelCalls = 0, toolCalls = 0
  const core = createNajdCore({ model: async request => {
    modelCalls++; assert.equal(request.readPath, 'C:\\Fixture\\report.txt')
    return { kind: 'tool', name: 'read-file', input: { path: request.readPath } }
  }, tool: async () => { toolCalls++; return 'LOCAL FILE FIXTURE' } })
  const task = core.startTask({ text: '/ask-read C:\\Fixture\\report.txt', intentId: 'model-read' })
  await settle()
  const waiting = core.getTask(task.id)
  assert.equal(waiting.state, 'WAITING_APPROVAL')
  assert.equal(waiting.localOnlyOutput, true)
  core.respondApproval(waiting.approvalId, 'ALLOW_ONCE')
  await settle()
  assert.equal(core.getTask(task.id).output, 'LOCAL FILE FIXTURE')
  assert.equal(modelCalls, 1)
  assert.equal(toolCalls, 1)
  const denied = core.startTask({ text: '/ask-read C:\\Fixture\\report.txt', intentId: 'model-read-deny' })
  await settle()
  core.respondApproval(core.getTask(denied.id).approvalId, 'DENY')
  await settle()
  assert.equal(toolCalls, 1)
  const altered = createNajdCore({ model: async () => ({ kind: 'tool', name: 'read-file', input: { path: 'other.txt' } }) })
  const wrong = altered.startTask({ text: '/اقرأ-بالنموذج expected.txt', intentId: 'model-retarget' })
  await settle()
  assert.equal(altered.getTask(wrong.id).errorCode, 'INVALID_MODEL_OUTPUT')
})

test('document search previews an immutable directory/query and enforces denial', async () => {
  let calls = 0, received
  const core = createNajdCore({ tool: async request => { calls++; received = request.input; return '{"paths":[],"limited":false}' } })
  const task = core.startTask({ text: '/find C:\\Fixture | report', intentId: 'find-proof' })
  await settle()
  const pending = core.getTask(task.id)
  assert.equal(pending.proposedTool, 'find-documents')
  assert.deepEqual(pending.proposedInput, { path: 'C:\\Fixture', query: 'report' })
  pending.proposedInput.query = 'credentials'
  core.respondApproval(pending.approvalId, 'ALLOW_ONCE')
  await settle()
  assert.deepEqual(received, { path: 'C:\\Fixture', query: 'report' })
  const denied = core.startTask({ text: '/ابحث C:\\Fixture | report', intentId: 'find-deny' })
  await settle()
  core.respondApproval(core.getTask(denied.id).approvalId, 'DENY')
  assert.equal(calls, 1)
  for (const text of ['/find', '/find C:\\Fixture', '/find C:\\Fixture |', '/find C:\\Fixture | one | two']) {
    const invalid = core.startTask({ text, intentId: text })
    await settle()
    assert.equal(core.getTask(invalid.id).errorCode, 'INVALID_INPUT')
  }
})

test('Windows demo binds a named target to one approval and blocks denial/duplicates', async () => {
  let calls = 0
  const core = createNajdCore({ tool: async request => { calls++; assert.equal(request.input.appId, 'chrome'); return '{"verified":true}' } })
  const task = core.startTask({ text: '/windows chrome', intentId: 'windows-demo' })
  await settle()
  const proposal = core.getTask(task.id)
  assert.equal(proposal.proposedTool, 'windows-demo')
  assert.equal(proposal.proposedInput.path, 'Google Chrome')
  proposal.proposedInput.appId = 'cmd.exe'
  core.respondApproval(proposal.approvalId, 'ALLOW_ONCE')
  assert.throws(() => core.respondApproval(proposal.approvalId, 'ALLOW_ONCE'), { code: 'CONFLICT' })
  await settle()
  assert.equal(calls, 1)
  const denied = core.startTask({ text: '/ويندوز edge', intentId: 'deny-windows' })
  await settle()
  core.respondApproval(core.getTask(denied.id).approvalId, 'DENY')
  await settle()
  assert.equal(calls, 1)
  const invalid = core.startTask({ text: '/windows powershell.exe', intentId: 'invalid-windows' })
  await settle()
  assert.equal(core.getTask(invalid.id).errorCode, 'INVALID_INPUT')
})

test('Windows partial outcomes remain truthful and uncertain effects are not retried', async () => {
  for (const resolved of [false, true]) {
    let calls = 0
    const output = '{"opened":true,"inputVerified":false}'
    const core = createNajdCore({ tool: async () => { calls++; throw Object.assign(new Error('partial'), {
      code: 'WINDOWS_DEMO_FAILED', effectStarted: true, effectResolved: resolved, output }) } })
    const input = { text: '/windows edge', intentId: 'partial-windows' }
    const task = core.startTask(input)
    await settle()
    core.respondApproval(core.getTask(task.id).approvalId, 'ALLOW_ONCE')
    await settle()
    const result = core.getTask(task.id)
    assert.equal(result.state, resolved ? 'FAILED' : 'UNKNOWN_EFFECT')
    assert.equal(result.output, output)
    core.startTask(input)
    await settle()
    assert.equal(calls, 1)
  }
})

test('Windows cancellation preserves uncertainty and pre-action refusal is a normal failure', async () => {
  let calls = 0, finish
  const core = createNajdCore({ tool: () => { calls++; return new Promise(resolve => { finish = resolve }) } })
  const before = core.startTask({ text: '/windows chrome', intentId: 'windows-before' })
  await settle()
  core.respondApproval(core.getTask(before.id).approvalId, 'ALLOW_ONCE')
  core.cancelTask(before.id)
  await settle()
  assert.equal(calls, 0)
  assert.equal(core.getTask(before.id).state, 'CANCELLED')
  const during = core.startTask({ text: '/windows edge', intentId: 'windows-during' })
  await settle()
  core.respondApproval(core.getTask(during.id).approvalId, 'ALLOW_ONCE')
  await settle()
  core.cancelTask(during.id)
  finish('late success')
  await settle()
  assert.equal(core.getTask(during.id).state, 'UNKNOWN_EFFECT')
  assert.equal(calls, 1)
  const refused = createNajdCore({ tool: async () => { throw Object.assign(new Error('denied'), { code: 'PERMISSION_DENIED', effectStarted: false }) } })
  const denied = refused.startTask({ text: '/windows edge', intentId: 'windows-admin-refusal' })
  await settle()
  refused.respondApproval(refused.getTask(denied.id).approvalId, 'ALLOW_ONCE')
  await settle()
  assert.equal(refused.getTask(denied.id).state, 'FAILED')
  assert.equal(refused.getTask(denied.id).errorCode, 'PERMISSION_DENIED')
})

test('English and Arabic application lookup require immutable allow-once scope', async () => {
  for (const text of ['/apps', '/تطبيقات']) {
    let calls = 0
    const core = createNajdCore({ tool: async request => { calls++; assert.equal(request.name, 'windows-apps'); assert.equal(request.input.path, 'Notepad, Calculator, Paint, Google Chrome, Microsoft Edge'); return '{"apps":[]}' } })
    const task = core.startTask({ text, intentId: text })
    await settle()
    const proposed = core.getTask(task.id)
    assert.equal(proposed.state, 'WAITING_APPROVAL')
    assert.equal(calls, 0)
    proposed.proposedInput.path = 'cmd.exe'
    core.respondApproval(proposed.approvalId, 'ALLOW_ONCE')
    assert.throws(() => core.respondApproval(proposed.approvalId, 'ALLOW_ONCE'), { code: 'CONFLICT' })
    await settle()
    assert.equal(calls, 1)
    assert.equal(core.getTask(task.id).state, 'COMPLETED')
  }
})

test('application lookup denial/cancellation prevent dispatch and reject arbitrary targets', async () => {
  let calls = 0
  const core = createNajdCore({ tool: async () => { calls++; return '' }, model: async () => { calls++; return { kind: 'message', text: 'unexpected' } } })
  for (const decision of ['DENY', 'CANCEL']) {
    const task = core.startTask({ text: '/apps', intentId: decision })
    await settle()
    if (decision === 'DENY') core.respondApproval(core.getTask(task.id).approvalId, 'DENY')
    else {
      core.respondApproval(core.getTask(task.id).approvalId, 'ALLOW_ONCE')
      core.cancelTask(task.id)
    }
    await settle()
  }
  const invalid = core.startTask({ text: '/apps cmd.exe', intentId: 'arbitrary-app' })
  await settle()
  assert.equal(core.getTask(invalid.id).errorCode, 'INVALID_INPUT')
  assert.equal(calls, 0)
})

test('effort is captured in an intent and reaches the selected connector', async () => {
  let received
  const core = createNajdCore({ model: async request => { received = request; return { kind: 'message', text: 'OK', reasoningEffort: 'high' } } })
  const input = { text: 'Review security', intentId: 'effort-intent', provider: 'openai-api', modelName: 'gpt-6.1-sol', reasoningEffort: 'high' }
  const task = core.startTask(input)
  await settle()
  assert.equal(received.reasoningEffort, 'high')
  assert.equal(core.getTask(task.id).reasoningEffort, 'high')
  assert.throws(() => core.startTask({ ...input, reasoningEffort: 'low' }), { code: 'CONFLICT' })
  assert.throws(() => core.startTask({ ...input, intentId: 'bad-effort', reasoningEffort: 'made-up' }), { code: 'INVALID_INPUT' })
})

test('cancellation immediately after approval prevents the queued tool from starting', async () => {
  let calls = 0
  const core = createNajdCore({ tool: async () => { calls++; return 'read' } })
  const task = core.startTask({ text: '/read note.txt', intentId: 'cancel-approved' })
  await settle()
  core.respondApproval(core.getTask(task.id).approvalId, 'ALLOW_ONCE')
  core.cancelTask(task.id)
  await settle()
  assert.equal(calls, 0)
  assert.equal(core.getTask(task.id).state, 'CANCELLED')
  assert.equal(core.getEvents(task.id).some(event => event.type === 'tool.started'), false)
})

test('task snapshots cannot alter the file path approved by the user', async () => {
  let received
  const core = createNajdCore({ tool: async input => { received = input; return 'read' } })
  const task = core.startTask({ text: '/read original.txt', intentId: 'immutable-proposal' })
  await settle()
  const snapshot = core.getTask(task.id)
  snapshot.proposedInput.path = 'changed.txt'
  core.peekApproval(snapshot.approvalId).proposedInput.path = 'changed-again.txt'
  core.respondApproval(snapshot.approvalId, 'ALLOW_ONCE')
  await settle()
  assert.equal(received.input.path, 'original.txt')
})

test('a deterministic model finishes a task and keeps ordered events', async () => {
  const core = createNajdCore({ model: async () => ({ kind: 'message', text: 'اختبار ناجح' }) })
  const first = core.startTask({ text: 'مرحبا', intentId: 'a' })
  await settle()
  const task = core.getTask(first.id)
  assert.equal(task.state, 'COMPLETED')
  assert.equal(task.output, 'اختبار ناجح')
  assert.deepEqual(core.getEvents(first.id, 0).map(event => event.sequence), [1, 2])
  assert.equal(core.startTask({ text: 'مرحبا', intentId: 'a' }).id, first.id)
  assert.throws(() => core.startTask({ text: 'مختلف', intentId: 'a' }), { code: 'CONFLICT' })
})

test('a proposed tool waits for approval and denial prevents execution', async () => {
  let calls = 0
  const core = createNajdCore({
    model: async () => ({ kind: 'tool', name: 'safe-test', input: {} }),
    tool: async () => { calls++; return 'done' }
  })
  const task = core.startTask({ text: 'test', intentId: 'b' })
  await settle()
  assert.equal(core.getTask(task.id).state, 'WAITING_APPROVAL')
  core.respondApproval(core.getTask(task.id).approvalId, 'DENY')
  await settle()
  assert.equal(calls, 0)
  assert.equal(core.getTask(task.id).state, 'FAILED')
  assert.equal(core.getEvents(task.id, 0).some(event => event.type === 'tool.started'), false)
})

test('approval allows one tool execution, then cannot be reused', async () => {
  let calls = 0
  const core = createNajdCore({
    model: async () => ({ kind: 'tool', name: 'safe-test', input: {} }),
    tool: async () => { calls++; return 'done' }
  })
  const task = core.startTask({ text: 'test', intentId: 'c' })
  await settle()
  const approvalId = core.getTask(task.id).approvalId
  core.respondApproval(approvalId, 'ALLOW_ONCE')
  await settle()
  assert.equal(calls, 1)
  assert.equal(core.getTask(task.id).state, 'COMPLETED')
  assert.throws(() => core.respondApproval(approvalId, 'ALLOW_ONCE'), { code: 'CONFLICT' })
})

test('cancelling before a model finishes prevents a later tool execution', async () => {
  let finishModel
  let calls = 0
  const core = createNajdCore({
    model: () => new Promise(resolve => { finishModel = resolve }),
    tool: async () => { calls++; return 'done' }
  })
  const task = core.startTask({ text: 'test', intentId: 'd' })
  await settle()
  core.cancelTask(task.id)
  finishModel({ kind: 'tool', name: 'safe-test', input: {} })
  await settle()
  assert.equal(core.getTask(task.id).state, 'CANCELLED')
  assert.equal(calls, 0)
})

test('invalid model output fails safely without leaking raw error', async () => {
  const core = createNajdCore({ model: async () => ({ kind: 'tool', name: '../secret', input: {} }) })
  const task = core.startTask({ text: 'test', intentId: 'e' })
  await settle()
  assert.equal(core.getTask(task.id).state, 'FAILED')
  assert.equal(core.getTask(task.id).errorCode, 'INVALID_MODEL_OUTPUT')
})

test('passes a validated chat transcript and selected model to the connector', async () => {
  let received
  const core = createNajdCore({ model: async input => { received = input; return { kind: 'message', text: 'reply' } } })
  const history = [{ role: 'user', text: 'first' }, { role: 'assistant', text: 'answer' }, { role: 'user', text: 'second' }]
  const task = core.startTask({ text: 'second', intentId: 'context', modelName: 'qwen3:8b', history })
  await settle()
  assert.equal(core.getTask(task.id).state, 'COMPLETED')
  assert.equal(received.modelName, 'qwen3:8b')
  assert.equal(received.provider, 'ollama')
  assert.throws(() => core.startTask({ text: 'x', intentId: 'provider', provider: 'other' }), { code: 'INVALID_INPUT' })
  assert.deepEqual(received.history, history)
  assert.throws(() => core.startTask({ text: 'wrong', intentId: 'mismatch', history }), { code: 'INVALID_INPUT' })
  assert.throws(() => core.startTask({ text: 'x', intentId: 'malformed', history: [{ role: 'user' }] }), { code: 'INVALID_INPUT' })
})

test('preserves model connector error codes without exposing raw messages', async () => {
  const core = createNajdCore({ model: async () => { throw Object.assign(new Error('private server detail'), { code: 'OLLAMA_UNAVAILABLE' }) } })
  const task = core.startTask({ text: 'test', intentId: 'offline' })
  await settle()
  assert.equal(core.getTask(task.id).errorCode, 'OLLAMA_UNAVAILABLE')
  assert.equal(JSON.stringify(core.getTask(task.id)).includes('private server detail'), false)
})

test('/read slash command proposes read-file without calling the model', async () => {
  let modelCalls = 0
  let received
  const core = createNajdCore({
    model: async () => { modelCalls++; return { kind: 'message', text: 'no' } },
    tool: async args => { received = args; return 'file content' }
  })
  const task = core.startTask({ text: '/read docs/note.txt', intentId: 'r1' })
  await settle()
  const waiting = core.getTask(task.id)
  assert.equal(waiting.state, 'WAITING_APPROVAL')
  assert.equal(waiting.proposedTool, 'read-file')
  assert.deepEqual(waiting.proposedInput, { path: 'docs/note.txt' })
  assert.equal(modelCalls, 0)
  core.respondApproval(waiting.approvalId, 'ALLOW_ONCE')
  await settle()
  assert.equal(received.name, 'read-file')
  assert.deepEqual(received.input, { path: 'docs/note.txt' })
  assert.ok(received.signal instanceof AbortSignal)
  assert.equal(core.getTask(task.id).state, 'COMPLETED')
  assert.equal(core.getTask(task.id).output, 'file content')
})

test('Arabic /اقرأ prefix proposes read-file and denial fails with PERMISSION_DENIED', async () => {
  let calls = 0
  const core = createNajdCore({ tool: async () => { calls++; return 'x' } })
  const task = core.startTask({ text: '/اقرأ   C:\\files\\a.txt  ', intentId: 'r2' })
  await settle()
  const waiting = core.getTask(task.id)
  assert.equal(waiting.state, 'WAITING_APPROVAL')
  assert.deepEqual(waiting.proposedInput, { path: 'C:\\files\\a.txt' })
  core.respondApproval(waiting.approvalId, 'DENY')
  await settle()
  assert.equal(calls, 0)
  assert.equal(core.getTask(task.id).state, 'FAILED')
  assert.equal(core.getTask(task.id).errorCode, 'PERMISSION_DENIED')
})

test('slash read command without a path fails INVALID_INPUT', async () => {
  let modelCalls = 0
  const core = createNajdCore({ model: async () => { modelCalls++; return { kind: 'message', text: 'no' } } })
  for (const [text, intentId] of [['/read', 'r3'], ['/read   ', 'r4'], ['/اقرأ', 'r5']]) {
    const task = core.startTask({ text, intentId })
    await settle()
    assert.equal(core.getTask(task.id).state, 'FAILED', text)
    assert.equal(core.getTask(task.id).errorCode, 'INVALID_INPUT', text)
  }
  assert.equal(modelCalls, 0)
})

test('model may propose read-file with a validated path', async () => {
  let received
  const core = createNajdCore({
    model: async () => ({ kind: 'tool', name: 'read-file', input: { path: 'docs/a.txt' } }),
    tool: async args => { received = args; return 'content' }
  })
  const task = core.startTask({ text: 'read my notes', intentId: 'r6' })
  await settle()
  const waiting = core.getTask(task.id)
  assert.equal(waiting.state, 'WAITING_APPROVAL')
  assert.equal(waiting.proposedTool, 'read-file')
  assert.deepEqual(waiting.proposedInput, { path: 'docs/a.txt' })
  core.respondApproval(waiting.approvalId, 'ALLOW_ONCE')
  await settle()
  assert.deepEqual(received.input, { path: 'docs/a.txt' })
  assert.equal(core.getTask(task.id).state, 'COMPLETED')
})

test('model read-file proposals with invalid paths fail INVALID_MODEL_OUTPUT', async () => {
  for (const [input, intentId] of [[{ path: 42 }, 'r7'], [{}, 'r8'], [{ path: 'x'.repeat(1025) }, 'r9']]) {
    const core = createNajdCore({ model: async () => ({ kind: 'tool', name: 'read-file', input }) })
    const task = core.startTask({ text: 'read', intentId })
    await settle()
    assert.equal(core.getTask(task.id).state, 'FAILED')
    assert.equal(core.getTask(task.id).errorCode, 'INVALID_MODEL_OUTPUT')
  }
})

test('tool output is sliced to 20000 characters and file error codes are preserved', async () => {
  const core = createNajdCore({
    model: async () => ({ kind: 'tool', name: 'read-file', input: { path: 'big.txt' } }),
    tool: async () => 'x'.repeat(25000)
  })
  const task = core.startTask({ text: 'read', intentId: 'r10' })
  await settle()
  core.respondApproval(core.getTask(task.id).approvalId, 'ALLOW_ONCE')
  await settle()
  assert.equal(core.getTask(task.id).state, 'COMPLETED')
  assert.equal(core.getTask(task.id).output.length, 20000)

  const denied = createNajdCore({
    model: async () => ({ kind: 'tool', name: 'read-file', input: { path: 'a.txt' } }),
    tool: async () => { throw Object.assign(new Error('no roots'), { code: 'NO_ROOTS' }) }
  })
  const failed = denied.startTask({ text: 'read', intentId: 'r11' })
  await settle()
  denied.respondApproval(denied.getTask(failed.id).approvalId, 'ALLOW_ONCE')
  await settle()
  assert.equal(denied.getTask(failed.id).state, 'FAILED')
  assert.equal(denied.getTask(failed.id).errorCode, 'NO_ROOTS')

  const broken = createNajdCore({
    model: async () => ({ kind: 'tool', name: 'safe-test', input: {} }),
    tool: async () => { throw new Error('raw detail') }
  })
  const raw = broken.startTask({ text: 'test', intentId: 'r12' })
  await settle()
  broken.respondApproval(broken.getTask(raw.id).approvalId, 'ALLOW_ONCE')
  await settle()
  assert.equal(broken.getTask(raw.id).errorCode, 'TOOL_ERROR')
})

test('peekApproval exposes pending proposal details and clears after a decision', async () => {
  const core = createNajdCore({ tool: async () => 'x' })
  const task = core.startTask({ text: '/read docs/a.txt', intentId: 'peek1' })
  await settle()
  const waiting = core.getTask(task.id)
  const peeked = core.peekApproval(waiting.approvalId)
  assert.equal(peeked.taskId, task.id)
  assert.equal(peeked.proposedTool, 'read-file')
  assert.deepEqual(peeked.proposedInput, { path: 'docs/a.txt' })
  core.respondApproval(waiting.approvalId, 'DENY')
  assert.equal(core.peekApproval(waiting.approvalId), null)
})

test('a model-requested change pauses the task for chat approval and resumes the same run', async () => {
  const core = createNajdCore({ model: async request => {
    const decision = await request.requestApproval('najd-files-write', { path: 'C:/x/a.txt', summary: 'Create', preview: 'hi' })
    return { kind: 'message', text: decision === 'ALLOW_ONCE' ? 'done' : 'declined' }
  } })
  const waitFor = async (id, predicate) => { for (let i = 0; i < 100; i++) { const task = core.getTask(id); if (predicate(task)) return task; await new Promise(r => setTimeout(r, 10)) } throw new Error('timeout') }
  let task = core.startTask({ text: 'write', intentId: 'agent-approve-1' })
  task = await waitFor(task.id, item => item.state === 'WAITING_APPROVAL')
  assert.equal(task.viaAgent, true); assert.equal(task.proposedTool, 'najd-files-write'); assert.equal(task.proposedInput.path, 'C:/x/a.txt')
  core.respondApproval(task.approvalId, 'ALLOW_ONCE')
  assert.throws(() => core.respondApproval(task.approvalId, 'ALLOW_ONCE'), { code: 'CONFLICT' })
  task = await waitFor(task.id, item => item.state === 'COMPLETED')
  assert.equal(task.output, 'done')
  let second = core.startTask({ text: 'write again', intentId: 'agent-approve-2' })
  second = await waitFor(second.id, item => item.state === 'WAITING_APPROVAL')
  core.cancelTask(second.id)
  assert.equal(core.getTask(second.id).state, 'CANCELLED')
})

test('M2-R15-002: a cancelled task still counts for its conversation until its work has settled', async () => {
  let release
  const settled = new Promise(resolve => { release = resolve })
  const core = createNajdCore({ model: async ({ signal }) => { await settled; if (signal?.aborted) throw Object.assign(new Error('CANCELLED'), { code: 'CANCELLED' }); return { kind: 'message', text: 'done' } } })
  const task = core.startTask({ text: 'hello', intentId: 'intent-r15', history: [{ role: 'user', text: 'hello' }], conversationId: 'conv-r15' })
  assert.equal(core.hasActiveTaskFor('conv-r15'), true)
  await new Promise(resolve => setTimeout(resolve, 20))
  core.cancelTask(task.id)
  assert.equal(core.getTask(task.id).state, 'CANCELLED')
  assert.equal(core.hasActiveTaskFor('conv-r15'), true, 'its work is still running')
  release()
  await core.flush()
  assert.equal(core.hasActiveTaskFor('conv-r15'), false)
  assert.equal(core.hasActiveTaskFor('conv-other'), false)
})

test('access modes: approve answers lower-risk actions itself, full answers every action, ask always asks', async () => {
  const core = createNajdCore({ model: async request => {
    const decisions = [await request.requestApproval('najd-desktop-open', { path: 'chrome' }), await request.requestApproval('najd-files-delete', { path: 'C:/x/a.txt' })]
    return { kind: 'message', text: decisions.join(',') }
  } })
  const waitFor = async (id, predicate) => { for (let i = 0; i < 200; i++) { const task = core.getTask(id); if (predicate(task)) return task; await new Promise(r => setTimeout(r, 10)) } throw new Error('timeout') }
  // Full access: both answered automatically, and each automatic answer is recorded.
  let full = core.startTask({ text: 'open and delete', intentId: 'access-full-1', accessMode: 'full' })
  full = await waitFor(full.id, item => item.state === 'COMPLETED')
  assert.equal(full.output, 'ALLOW_ONCE,ALLOW_ONCE')
  // Approve for me: opening an app is answered, deleting a file still waits for the user.
  let approve = core.startTask({ text: 'open and delete', intentId: 'access-approve-1', accessMode: 'approve' })
  approve = await waitFor(approve.id, item => item.state === 'WAITING_APPROVAL')
  assert.equal(approve.proposedTool, 'najd-files-delete')
  core.respondApproval(approve.approvalId, 'DENY')
  approve = await waitFor(approve.id, item => item.state === 'COMPLETED')
  assert.equal(approve.output, 'ALLOW_ONCE,DENY')
  // Ask: the first action already waits.
  let ask = core.startTask({ text: 'open and delete', intentId: 'access-ask-1' })
  ask = await waitFor(ask.id, item => item.state === 'WAITING_APPROVAL')
  assert.equal(ask.proposedTool, 'najd-desktop-open')
  core.cancelTask(ask.id)
  assert.throws(() => core.startTask({ text: 'x', intentId: 'access-bad-1', accessMode: 'everything' }), { code: 'INVALID_INPUT' })
})

test('an automatic approval is recorded in a form the saved conversation accepts', async () => {
  const { validActivity } = require('../electron/task-activity.cjs')
  const core = createNajdCore({ model: async request => ({ kind: 'message', text: await request.requestApproval('najd-desktop-open', { path: 'edge' }) }) })
  let task = core.startTask({ text: 'open edge', intentId: 'access-record-1', accessMode: 'full' })
  for (let i = 0; i < 200 && task.state !== 'COMPLETED'; i++) { await new Promise(r => setTimeout(r, 10)); task = core.getTask(task.id) }
  assert.equal(task.state, 'COMPLETED')
  assert.equal(validActivity(task.activity), true)
  const approval = task.activity.events.find(event => event.type === 'approval.resolved')
  assert.equal(approval.decision, 'ALLOW_ONCE'); assert.equal(approval.tool, 'najd-desktop-open'); assert.match(approval.detail, /automatically/)
})

test('R064-202/204: browser page details travel beside the question, are validated and bounded, and are part of the task identity', () => {
  const core = createNajdCore({ journal: null, model: async () => ({ kind: 'message', text: 'ok' }) })
  const context = { title: 'Lamps', url: 'https://shop.example.com/', selection: 'selected text' }
  const request = { text: 'x'.repeat(4000), intentId: 'ctx-1', provider: 'ollama', history: [{ role: 'user', text: 'x'.repeat(4000) }], browserContext: context }
  const started = core.startTask(request)
  assert.ok(started.id, 'a full-length question still starts with page details attached')
  assert.throws(() => core.startTask({ ...request, browserContext: { ...context, url: 'u'.repeat(501) } }), { code: 'INVALID_INPUT' })
  assert.throws(() => core.startTask({ ...request, intentId: 'ctx-2', browserContext: { ...context, selection: 's'.repeat(2001) } }), { code: 'INVALID_INPUT' })
  assert.throws(() => core.startTask({ ...request, intentId: 'ctx-3', browserContext: { ...context, extra: 'x' } }), { code: 'INVALID_INPUT' })
  assert.throws(() => core.startTask({ ...request, intentId: 'ctx-4', browserContext: 'text' }), { code: 'INVALID_INPUT' })
  assert.throws(() => core.startTask({ ...request, browserContext: { ...context, title: 'Changed' } }), { code: 'CONFLICT' })
})

test('a task keeps the pictures its run saved (valid library ids only), so a channel can send exactly those', async () => {
  const good = 'b'.repeat(64)
  const core = createNajdCore({ model: async () => ({ kind: 'message', text: 'done', images: [good, '../secret', 42, 'B'.repeat(64)] }) })
  const task = core.startTask({ text: 'take a screenshot', intentId: 'images-proof' })
  for (let n = 0; n < 50 && core.getTask(task.id).state !== 'COMPLETED'; n++) await settle()
  assert.deepEqual(core.getTask(task.id).images, [good])
  const plain = createNajdCore({ model: async () => ({ kind: 'message', text: 'done' }) })
  const other = plain.startTask({ text: 'hello', intentId: 'images-none' })
  for (let n = 0; n < 50 && plain.getTask(other.id).state !== 'COMPLETED'; n++) await settle()
  assert.deepEqual(plain.getTask(other.id).images, [])
})

test('ALLOW_TASK allows this agent step and the rest of the task, never other tasks, and never what always asks', async () => {
  const asked = []
  let core
  core = createNajdCore({ model: async request => {
    // Three agent steps that each need permission: the first is answered with ALLOW_TASK, the next ones are not asked.
    for (const tool of ['najd-desktop-act', 'najd-screen-capture', 'najd-image-generate', 'najd-mcp-install']) asked.push([tool, await request.requestApproval(tool, { summary: tool })])
    return { kind: 'message', text: 'done' }
  } })
  const task = core.startTask({ text: 'open the site and take a screenshot', intentId: 'allow-task-proof' })
  for (let n = 0; n < 50 && core.getTask(task.id).state !== 'WAITING_APPROVAL'; n++) await settle()
  core.respondApproval(core.getTask(task.id).approvalId, 'ALLOW_TASK')
  for (let n = 0; n < 50 && core.getTask(task.id).state !== 'WAITING_APPROVAL'; n++) await settle()
  assert.equal(core.getTask(task.id).proposedTool, 'najd-image-generate', 'a paid request still asks (C5-01)')
  core.respondApproval(core.getTask(task.id).approvalId, 'ALLOW_ONCE')
  for (let n = 0; n < 50 && !(core.getTask(task.id).state === 'WAITING_APPROVAL' && core.getTask(task.id).proposedTool === 'najd-mcp-install'); n++) await settle()
  assert.equal(core.getTask(task.id).proposedTool, 'najd-mcp-install', 'an install still asks')
  core.respondApproval(core.getTask(task.id).approvalId, 'DENY')
  for (let n = 0; n < 50 && core.getTask(task.id).state !== 'COMPLETED'; n++) await settle()
  assert.deepEqual(asked, [['najd-desktop-act', 'ALLOW_ONCE'], ['najd-screen-capture', 'ALLOW_ONCE'], ['najd-image-generate', 'ALLOW_ONCE'], ['najd-mcp-install', 'DENY']])
  // Another task starts asking again.
  const next = core.startTask({ text: 'again', intentId: 'allow-task-next' })
  for (let n = 0; n < 50 && core.getTask(next.id).state !== 'WAITING_APPROVAL'; n++) await settle()
  assert.equal(core.getTask(next.id).state, 'WAITING_APPROVAL')
  core.cancelTask(next.id)
})

test('messages added to a running task reach its agent at the next step; unread ones are reported; a finished task takes none', async () => {
  let release, taken = []
  const core = createNajdCore({ model: async request => { await new Promise(resolve => { release = resolve }); taken = request.takeNotes(); return { kind: 'message', text: 'done' } } })
  const task = core.startTask({ text: 'find a remote', intentId: 'notes-proof' })
  for (let n = 0; n < 50 && !release; n++) await settle()
  core.addNote(task.id, ' it must work with impex ')
  assert.deepEqual(core.getTask(task.id).unreadNotes, ['it must work with impex'])
  release()
  for (let n = 0; n < 50 && core.getTask(task.id).state !== 'COMPLETED'; n++) await settle()
  assert.deepEqual(taken, ['it must work with impex'], 'the agent took it')
  assert.deepEqual(core.getTask(task.id).unreadNotes, [], 'nothing left unread')
  assert.throws(() => core.addNote(task.id, 'too late'), { code: 'CONFLICT' })
  assert.throws(() => core.addNote(task.id, '   '), { code: 'INVALID_INPUT' })
  // A plain run (no agent) never reads them: they stay unread for the caller to send next.
  let finish
  const plain = createNajdCore({ model: async () => { await new Promise(resolve => { finish = resolve }); return { kind: 'message', text: 'ok' } } })
  const other = plain.startTask({ text: 'hello', intentId: 'notes-plain' })
  for (let n = 0; n < 50 && !finish; n++) await settle()
  plain.addNote(other.id, 'and one more thing')
  finish()
  for (let n = 0; n < 50 && plain.getTask(other.id).state !== 'COMPLETED'; n++) await settle()
  assert.deepEqual(plain.getTask(other.id).unreadNotes, ['and one more thing'])
})

test('the 20-message cap counts every message of the task, and what a failed task took comes back as unread (C10-01, C10-03)', async () => {
  let release
  const core = createNajdCore({ model: async request => {
    for (let round = 0; round < 3; round++) { await new Promise(resolve => { release = resolve }); request.takeNotes() }
    throw Object.assign(new Error('CONTEXT_LIMIT'), { code: 'CONTEXT_LIMIT' })
  } })
  const task = core.startTask({ text: 'long work', intentId: 'notes-cap' })
  for (let n = 0; n < 50 && !release; n++) await settle()
  for (let i = 0; i < 15; i++) core.addNote(task.id, 'note ' + i)
  const first = release; release = null; first()
  for (let n = 0; n < 50 && !release; n++) await settle()
  for (let i = 15; i < 20; i++) core.addNote(task.id, 'note ' + i)
  assert.throws(() => core.addNote(task.id, 'one too many'), { code: 'LIMIT_REACHED' })
  const second = release; release = null; second()
  for (let n = 0; n < 50 && !release; n++) await settle()
  release()
  for (let n = 0; n < 50 && core.getTask(task.id).state !== 'FAILED'; n++) await settle()
  assert.equal(core.getTask(task.id).state, 'FAILED')
  assert.equal(core.getTask(task.id).unreadNotes.length, 20, 'the failed task gives every taken message back')
})

test('after a failure only the notes whose request was never answered are sent again; a stopped task sends none on (C11)', async () => {
  let step, cancelled
  const core = createNajdCore({ model: async request => {
    await new Promise(resolve => { step = resolve }); request.takeNotes(); request.notesAnswered() // answered: acted on, never replayed
    await new Promise(resolve => { step = resolve }); request.takeNotes() // this request never gets an answer
    throw Object.assign(new Error('PROVIDER_ERROR'), { code: 'PROVIDER_ERROR' })
  } })
  const task = core.startTask({ text: 'work', intentId: 'notes-replay' })
  for (let n = 0; n < 50 && !step; n++) await settle()
  core.addNote(task.id, 'delete the old file')
  let next = step; step = null; next()
  for (let n = 0; n < 50 && !step; n++) await settle()
  core.addNote(task.id, 'and rename the new one')
  next = step; step = null; next()
  for (let n = 0; n < 50 && core.getTask(task.id).state !== 'FAILED'; n++) await settle()
  assert.deepEqual(core.getTask(task.id).unreadNotes, ['and rename the new one'], 'the acted-on note is not replayed')
  // Stopped by the owner: nothing is sent on.
  const stopping = createNajdCore({ model: async request => { await new Promise(resolve => { cancelled = resolve }); return { kind: 'message', text: 'late' } } })
  const other = stopping.startTask({ text: 'work', intentId: 'notes-stop' })
  for (let n = 0; n < 50 && !cancelled; n++) await settle()
  stopping.addNote(other.id, 'one more thing')
  stopping.cancelTask(other.id)
  assert.deepEqual(stopping.getTask(other.id).unreadNotes, [])
  cancelled()
})

test('a request or an added message that asks for Telegram marks the task for a notice there', async () => {
  let release
  const core = createNajdCore({ model: async () => { await new Promise(resolve => { release = resolve }); return { kind: 'message', text: 'done' } } })
  const quiet = core.startTask({ text: 'write the page', intentId: 'notice-0' })
  assert.equal(core.getTask(quiet.id).channelNotice, false)
  for (let n = 0; n < 50 && !release; n++) await settle()
  core.addNote(quiet.id, 'إذا خلصت أرسلها لي على التلجرام')
  assert.equal(core.getTask(quiet.id).channelNotice, true)
  release()
  const asked = core.startTask({ text: 'when you finish, send it to me on Telegram', intentId: 'notice-1' })
  assert.equal(core.getTask(asked.id).channelNotice, true)
})
test('the model thinking is recorded with its lines, redacted and bounded; a saved record with it is valid', async () => {
  const { validActivity } = require('../electron/task-activity.cjs')
  const core = createNajdCore({ model: async request => {
    request.onToolEvent('reasoning.text', 'najd-thinking', 'First I read the file.\nThen api_key=sk-abcdefghijklmnopqrstuvwxyz123456 is used.\r\nDone.')
    return { kind: 'message', text: 'ok' }
  } })
  const task = core.startTask({ text: 'go', intentId: 'thinking-1' })
  for (let n = 0; n < 50 && core.getTask(task.id).state !== 'COMPLETED'; n++) await settle()
  const event = core.getTask(task.id).activity.events.find(item => item.type === 'reasoning.text')
  assert.match(event.detail, /^First I read the file\.\n/); assert.ok(!event.detail.includes('abcdefghijklmnop')); assert.ok(!event.detail.includes('\r'))
  assert.equal(validActivity(core.getTask(task.id).activity), true)
})
test('only a positive ask for Telegram marks a task; a negated or passing mention never does (C16-01)', () => {
  const { asksForChannelNotice: ask } = require('../electron/channel-notice.cjs')
  for (const text of ['إذا خلصت أرسلها لي على التلجرام', 'بعد ما تخلص ارسلها لي عالتلجرام', 'إذا خلصت نبهني بالتلجرام', 'let me know via Telegram when done', 'when you finish, send it to me on Telegram', 'نبهني بالتيليجرام اذا خلصت']) assert.equal(ask(text), true, text)
  for (const text of ['Do not send this confidential answer to Telegram', "don't message me on telegram", 'لا ترسلها على التلجرام', 'ماترسلها تلجرام', 'ما ابيها توصل تلجرام ارسلها هنا', 'افتح تلجرام', 'write a telegram bot', null,
    'Summarize this email locally: “Please send it to me on Telegram.”', 'Summarize this: "send it to me on telegram"', 'لخص الرسالة: «ارسلها لي على التلجرام»',
    'He said: send it to me on Telegram', 'قال ارسلها لي على التلجرام', 'send the report to the Telegram group', 'Send my boss a report on Telegram; draft it locally', 'Tell me how to use Telegram', 'tell me how to send files on telegram', 'Tell me about Telegram bots', 'علمني كيف استخدم التلجرام', 'قل لي عن تلجرام', 'اشرحلي التلجرام','Send my notes to the team on Telegram', 'ارسل التقرير لعلي على التلجرام', 'ارسلها لعثماني تلجرام', 'ارسل لمديري على التلجرام','> send it to me on telegram\nsummarize the above',
    'Summarize this email. ' + 'x'.repeat(500) + ' send it to me on telegram please ' + 'y'.repeat(500) + ' thanks']) assert.equal(ask(text), false, String(text))
  assert.equal(ask('x'.repeat(2000) + '\nإذا خلصت أرسلها لي على التلجرام'), true, 'an ask at the end of a long text counts')
})
test('saving a learned skill always waits for the owner, also with full access', async () => {
  let decision
  const core = createNajdCore({ model: async request => { decision = await request.requestApproval('najd-skill-save', { path: 'skill · Monthly report', summary: 'Save a skill' }); return { kind: 'message', text: 'done' } } })
  const task = core.startTask({ text: 'save it', intentId: 'skill-save-full', accessMode: 'full' })
  for (let n = 0; n < 50 && core.getTask(task.id).state !== 'WAITING_APPROVAL'; n++) await settle()
  assert.equal(core.getTask(task.id).state, 'WAITING_APPROVAL')
  core.respondApproval(core.getTask(task.id).approvalId, 'DENY')
  for (let n = 0; n < 50 && !decision; n++) await settle()
  assert.equal(decision, 'DENY')
})