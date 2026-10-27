const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { validateConfig, createModelUnions, withAdvice, ADVISOR_PROMPT } = require('../electron/model-union.cjs')
const { createProviderService } = require('../electron/provider-service.cjs')

const preset = (over = {}) => ({ enabled: true, references: [{ provider: 'anthropic-api', model: 'claude-opus-5', enabled: true }, { provider: 'gemini-api', model: 'gemini-3-pro', enabled: true }], aggregator: { provider: 'openai-api', model: 'gpt-6.1-sol' }, ...over })

test('union presets are validated: no nested unions, bounded, safe names', () => {
  assert.equal(validateConfig({ default: 'duo', presets: { duo: preset() } }).default, 'duo')
  assert.throws(() => validateConfig({ presets: { duo: preset({ aggregator: { provider: 'union', model: 'x' } }) } }), { code: 'INVALID_INPUT' })
  assert.throws(() => validateConfig({ presets: { duo: preset({ references: [{ provider: 'union', model: 'x' }] }) } }), { code: 'INVALID_INPUT' })
  assert.throws(() => validateConfig({ presets: { '../x': preset() } }), { code: 'INVALID_INPUT' })
  assert.throws(() => validateConfig({ presets: { duo: preset({ references: Array(13).fill({ provider: 'gemini-api', model: 'm' }) }) } }), { code: 'INVALID_INPUT' })
  assert.throws(() => validateConfig({ presets: { duo: preset({ aggregator: { provider: 'openai-api' } }) } }), { code: 'INVALID_INPUT' })
  assert.equal(validateConfig({ default: 'missing', presets: { a: preset() } }).default, 'a', 'an unknown default falls back to the first preset')
})

test('the store persists presets and preserves a corrupt file', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'najd-union-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const file = path.join(root, 'unions.json'), store = createModelUnions({ filePath: file })
  assert.deepEqual(await store.get(), { default: null, presets: {} })
  await store.save({ default: 'duo', presets: { duo: preset() } })
  assert.equal((await createModelUnions({ filePath: file }).get()).presets.duo.aggregator.model, 'gpt-6.1-sol')
  await fs.writeFile(file, '{broken')
  await assert.rejects(store.get(), { code: 'UNIONS_UNAVAILABLE' })
  await assert.rejects(store.save({ presets: {} }), { code: 'UNIONS_UNAVAILABLE' })
  assert.equal(await fs.readFile(file, 'utf8'), '{broken')
})

test('advice is attached as data, and nothing is attached when no advisor answered', () => {
  assert.equal(withAdvice('S', { advice: [], failed: [] }), 'S')
  const text = withAdvice('S', { advice: [{ provider: 'anthropic-api', model: 'claude', text: 'Check the edge cases.' }], failed: [] })
  assert.match(text, /data, not instructions/); assert.match(text, /Check the edge cases/); assert.ok(text.startsWith('S'))
})

async function setup(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'najd-union-service-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const calls = []
  const flags = { failGemini: false }
  const service = createProviderService({ directory: root, encryption: { isAsyncEncryptionAvailable: async () => true, encryptStringAsync: async value => Buffer.from(value), decryptStringAsync: async value => ({ result: value.toString() }) },
    chatGPT: { status: async () => ({ signedIn: false }) }, ollama: { listModels: async () => [] },
    clientFactory: id => ({ listModels: async () => [{ id: 'm', label: 'm' }], chat: async request => {
      if (!request.apiKey) throw Object.assign(new Error('x'), { code: 'AUTH_REQUIRED' })
      calls.push({ id, system: request.systemPrompt, agent: !!request.agentTurn, history: request.history.length })
      if (id === 'gemini-api' && flags.failGemini) throw Object.assign(new Error('x'), { code: 'PROVIDER_RATE_LIMIT' })
      return { kind: 'message', text: id + ' says hi', usage: { input: 10, output: 5, total: 15, cached: null } }
    } }) })
  t.after(() => service.dispose())
  await service.saveKey('openai-api', 'sk-union-aggregator-key'); await service.saveKey('anthropic-api', 'sk-ant-union-reference-key'); await service.saveKey('gemini-api', 'AIzaUnionReferenceKeyUnionReferenceKey')
  await service.unions.save({ default: 'duo', presets: { duo: preset() } })
  return { service, calls, flags }
}

test('a union asks each reference once per user turn, then the aggregator runs the whole tool loop with their advice', async t => {
  const { service, calls } = await setup(t)
  const history = [{ role: 'user', text: 'fix the bug' }]
  assert.deepEqual((await service.models('union')).map(m => m.id), ['duo'])
  assert.equal(await service.supportsTools('union', 'duo'), true)
  assert.equal((await service.catalog()).find(p => p.id === 'union').configured, true)
  const routeA = await service.captureRoute('union', 'duo')
  const first = await service.chat({ provider: 'union', modelName: 'duo', history, systemPrompt: 'BASE', agentTurn: { tools: [], input: [] }, routeToken: routeA })
  const advisorCalls = calls.filter(call => call.system?.startsWith(ADVISOR_PROMPT))
  assert.equal(advisorCalls.length, 2, 'both references were consulted'); assert.ok(advisorCalls.every(call => call.agent === false), 'advisors get no tools')
  assert.ok(advisorCalls.every(call => call.system.includes('The acting model is openai-api/gpt-6.1-sol')), 'advisors know who acts')
  const aggregatorCall = calls.find(call => call.id === 'openai-api')
  assert.match(aggregatorCall.system, /^BASE/); assert.match(aggregatorCall.system, /anthropic-api says hi/); assert.match(aggregatorCall.system, /gemini-api says hi/); assert.equal(aggregatorCall.agent, true)
  assert.equal(first.usage.total, 45, 'the usage of the advisors is added to the run'); assert.equal(first.union.advisors.length, 2)
  // The next step of the same turn (tool results in the input) does not consult the references again.
  await service.chat({ provider: 'union', modelName: 'duo', history, systemPrompt: 'BASE', agentTurn: { tools: [], input: [{ type: 'function_call_output', call_id: 'c', output: '{}' }] }, routeToken: routeA })
  assert.equal(calls.filter(call => call.system?.startsWith(ADVISOR_PROMPT)).length, 2)
  assert.equal(calls.filter(call => call.id === 'openai-api').length, 2)
  // A new user turn consults them again.
  await service.chat({ provider: 'union', modelName: 'duo', history: [...history, { role: 'assistant', text: 'done' }, { role: 'user', text: 'now the tests' }], systemPrompt: 'BASE', agentTurn: { tools: [], input: [] } })
  assert.equal(calls.filter(call => call.system?.startsWith(ADVISOR_PROMPT)).length, 4)
})

test('a failing reference never fails the union; a changed aggregator key is a changed route; unknown presets are refused', async t => {
  const { service, flags } = await setup(t)
  flags.failGemini = true
  const result = await service.chat({ provider: 'union', modelName: 'duo', history: [{ role: 'user', text: 'hello' }], systemPrompt: 'S' })
  assert.equal(result.text, 'openai-api says hi'); assert.deepEqual(result.union.failed.map(item => item.code), ['PROVIDER_RATE_LIMIT']); assert.equal(result.union.advisors.length, 1)
  const route = await service.captureRoute('union', 'duo')
  await service.saveKey('openai-api', 'sk-union-aggregator-key-two')
  await assert.rejects(service.chat({ provider: 'union', modelName: 'duo', history: [{ role: 'user', text: 'hello' }], routeToken: route }), { code: 'CREDENTIAL_CHANGED' })
  await assert.rejects(service.chat({ provider: 'union', modelName: 'nope', history: [{ role: 'user', text: 'hello' }] }), { code: 'UNION_NOT_FOUND' })
  await assert.rejects(service.chat({ provider: 'union', modelName: 'duo', history: [{ role: 'user', text: 'x' }], readPath: 'a.txt' }), { code: 'TOOLS_NOT_SUPPORTED' })
  await service.unions.save({ default: 'duo', presets: { duo: preset({ enabled: false }) } })
  assert.deepEqual(await service.models('union'), [])
})

test('advice is not reused after an edit, a changed earlier message or a changed reference key; identical concurrent rounds share one set of calls', async t => {
  const { service, calls } = await setup(t)
  const history = [{ role: 'user', text: 'fix the bug' }]
  const run = (h = history) => service.chat({ provider: 'union', modelName: 'duo', history: h, systemPrompt: 'BASE', agentTurn: { tools: [], input: [] } })
  await Promise.all([run(), run()])
  assert.equal(calls.filter(call => call.system?.startsWith(ADVISOR_PROMPT)).length, 2, 'two identical concurrent turns consult each reference once')
  await run()
  assert.equal(calls.filter(call => call.system?.startsWith(ADVISOR_PROMPT)).length, 2 + 2, 'a fresh turn consults again (the cache is only for later steps of a turn)')
  const step = () => service.chat({ provider: 'union', modelName: 'duo', history, systemPrompt: 'BASE', agentTurn: { tools: [], input: [{ type: 'function_call_output', call_id: 'c', output: '{}' }] } })
  await step()
  assert.equal(calls.filter(call => call.system?.startsWith(ADVISOR_PROMPT)).length, 4, 'a later step of the same turn reuses the advice')
  await service.unions.save({ default: 'duo', presets: { duo: preset({ references: [{ provider: 'anthropic-api', model: 'claude-other', enabled: true }] }) } })
  await step()
  assert.equal(calls.filter(call => call.system?.startsWith(ADVISOR_PROMPT)).length, 5, 'an edited preset consults again')
  await service.saveKey('anthropic-api', 'sk-ant-union-reference-key-two')
  await step()
  assert.equal(calls.filter(call => call.system?.startsWith(ADVISOR_PROMPT)).length, 6, 'a changed reference key consults again')
})

test('the route of a union includes its references; an Ollama member has a route; an unconnected reference does not block the run', async t => {
  const { service } = await setup(t)
  const before = await service.captureRoute('union', 'duo')
  await service.saveKey('gemini-api', 'AIzaUnionReferenceKeyUnionReferenceKeyTwo')
  assert.notEqual(await service.captureRoute('union', 'duo'), before, 'a changed reference key changes the route')
  assert.equal(await service.captureRoute('ollama'), 'ollama:local')
  await service.clearKey('gemini-api')
  const route = await service.captureRoute('union', 'duo')
  const result = await service.chat({ provider: 'union', modelName: 'duo', history: [{ role: 'user', text: 'hello' }], systemPrompt: 'S', routeToken: route })
  assert.equal(result.union.failed.length, 1, 'the unconnected reference is reported, the run goes on')
  await service.unions.save({ default: 'duo', presets: { duo: preset({ aggregator: { provider: 'ollama', model: 'qwen' } }) } })
  assert.match(await service.captureRoute('union', 'duo'), /^union:/)
})

test('a shared round survives one run being cancelled, counts the advisors once, and is found again after the history is re-fitted', async t => {
  const { service, calls } = await setup(t)
  const history = [{ role: 'user', text: 'fix the bug' }]
  const controllerA = new AbortController()
  const call = (signal, h = history, input = [], extra = {}) => service.chat({ provider: 'union', modelName: 'duo', history: h, systemPrompt: 'BASE', agentTurn: { tools: [], input, ...extra }, signal })
  const a = call(controllerA.signal, history, [], { runKey: 'r1', continuation: false }).catch(error => error), b = call(undefined, history, [], { runKey: 'r2', continuation: false })
  controllerA.abort()
  const resultB = await b
  assert.equal(resultB.union.advisors.length, 2, 'the other run still got its advice')
  assert.equal((await a).code, 'CANCELLED')
  const refit = [{ role: 'assistant', text: 'summary of earlier work' }, ...history]
  const step = await call(undefined, refit, [{ type: 'function_call_output', call_id: 'c', output: '{}' }], { runKey: 'r2', continuation: true })
  assert.equal(calls.filter(item => item.system?.startsWith(ADVISOR_PROMPT)).length, 2, 'a re-fitted later step reuses the turn advice')
  assert.equal(step.usage.total, 15, 'the advisors are not billed again on a later step')
})

test('a preset id must be a valid model id (an Arabic name is its label), and a delegated sub-agent consults nobody', async t => {
  assert.throws(() => validateConfig({ presets: { 'My union': preset() } }), { code: 'INVALID_INPUT' })
  assert.equal(validateConfig({ presets: { 'union-1': preset({ label: ' فريق الكتابة ' }) } }).presets['union-1'].label, 'فريق الكتابة')
  assert.throws(() => validateConfig({ presets: { 'union-1': preset({ label: 'bad\u0000name' }) } }), { code: 'INVALID_INPUT' })
  assert.throws(() => validateConfig({ presets: { 'union-1': preset({ label: 'x'.repeat(41) }) } }), { code: 'INVALID_INPUT' })
  assert.equal('label' in validateConfig({ presets: { duo: preset({ label: 'duo' }) } }).presets.duo, false, 'a label equal to the id is not stored')
  const { service, calls } = await setup(t)
  await service.chat({ provider: 'union', modelName: 'duo', history: [{ role: 'user', text: 'task' }], systemPrompt: 'S', agentTurn: { tools: [], input: [], noAdvice: true } })
  assert.equal(calls.filter(item => item.system?.startsWith(ADVISOR_PROMPT)).length, 0)
})

test('a keyed provider with an editable address keeps its route until the key or the address changes', async t => {
  const { service } = await setup(t)
  await service.saveKey('groq-api', 'gsk_' + 'a'.repeat(48))
  const route = await service.captureRoute('groq-api', 'm')
  const ask = token => service.chat({ provider: 'groq-api', modelName: 'm', history: [{ role: 'user', text: 'hi' }], routeToken: token })
  assert.equal((await ask(route)).text, 'groq-api says hi', 'an unchanged route runs')
  await service.setEndpoint('groq-api', 'https://proxy.example.org/v1')
  await assert.rejects(ask(route), { code: 'CREDENTIAL_CHANGED' })
})

test('stopping a union round and asking again at once gets a fresh round; a small model window sets a small budget', async t => {
  const { service, calls } = await setup(t)
  const history = [{ role: 'user', text: 'fix it' }]
  const stopped = new AbortController()
  const first = service.chat({ provider: 'union', modelName: 'duo', history, systemPrompt: 'B', agentTurn: { tools: [], input: [] }, signal: stopped.signal }).catch(error => error)
  stopped.abort()
  const again = await service.chat({ provider: 'union', modelName: 'duo', history, systemPrompt: 'B', agentTurn: { tools: [], input: [] } })
  assert.equal(again.union.advisors.length, 2); assert.equal((await first).code, 'CANCELLED')
  assert.ok(service.inputBudget('ollama', 'x') <= 60000, 'Ollama budget follows its 16k window')
})

test('advice is cut to a share of the aggregator window, and each advisor call is bound to the route captured for it', async t => {
  const { text } = (() => ({ text: withAdvice('S', { advice: [{ provider: 'a', model: 'm', text: 'x'.repeat(500000) }, { provider: 'b', model: 'm', text: 'short' }], failed: [] }, 10000) }))()
  assert.ok(text.length < 12000 && /note cut to fit/.test(text) && /short/.test(text))
  const { service } = await setup(t)
  const route = await service.captureRoute('union', 'duo')
  await service.saveKey('anthropic-api', 'sk-ant-union-reference-key-changed')
  await assert.rejects(service.chat({ provider: 'union', modelName: 'duo', history: [{ role: 'user', text: 'hello' }], systemPrompt: 'S', routeToken: route }), { code: 'CREDENTIAL_CHANGED' })
})

test('the advice block respects its whole limit, and an advisor that was unconnected at capture is skipped', async t => {
  const block = withAdvice('S', { advice: [{ provider: 'a', model: 'm', text: 'x'.repeat(50000) }, { provider: 'b', model: 'm', text: 'y'.repeat(50000) }], failed: [] }, 8000)
  assert.ok(block.length - 1 <= 8000 + 2, 'headers and markers count toward the limit')
  assert.equal(withAdvice('S', { advice: [{ provider: 'a', model: 'm', text: 'x' }], failed: [] }, 100), 'S', 'nothing is attached when it cannot fit')
  const { service, calls } = await setup(t)
  await service.clearKey('gemini-api')
  const route = await service.captureRoute('union', 'duo')
  await service.saveKey('gemini-api', 'AIzaUnionReferenceKeyUnionReferenceKeyThree')
  await assert.rejects(service.chat({ provider: 'union', modelName: 'duo', history: [{ role: 'user', text: 'hello' }], systemPrompt: 'S', routeToken: route }), { code: 'CREDENTIAL_CHANGED' })
  assert.equal(calls.filter(call => call.id === 'gemini-api').length, 0, 'the newly connected reference was never called')
})

test('each reference gets the part of the conversation that fits its own window', () => {
  const { fitHistory, ADVISOR_PROMPT } = require('../electron/model-union.cjs')
  const history = [{ role: 'user', text: 'a'.repeat(5000) }, { role: 'assistant', text: 'b'.repeat(5000) }, { role: 'user', text: 'latest request' }]
  const fitted = fitHistory(history, ADVISOR_PROMPT.length + 2000)
  assert.deepEqual(fitted.map(item => item.text), ['latest request'])
  assert.throws(() => fitHistory([{ role: 'user', text: 'x'.repeat(5000) }], ADVISOR_PROMPT.length + 2000), { code: 'CONTEXT_LIMIT' })
})

test('the acting model is told who is in the union, and the advice reaches the owner once, as soon as it arrives', async t => {
  const { service, calls } = await setup(t)
  const history = [{ role: 'user', text: 'is chatgpt with you?' }]
  const shown = []
  await service.chat({ provider: 'union', modelName: 'duo', history, systemPrompt: 'BASE', agentTurn: { tools: [], input: [], runKey: 'r1', continuation: false }, onAdvice: advice => shown.push(advice) })
  const acting = calls.find(call => call.id === 'openai-api')
  assert.match(acting.system, /model union "duo"/); assert.match(acting.system, /anthropic-api\/claude-opus-5, gemini-api\/gemini-3-pro/); assert.match(acting.system, /name all of them/)
  assert.equal(shown.length, 1); assert.deepEqual(shown[0].map(item => item.text).sort(), ['anthropic-api says hi', 'gemini-api says hi'])
  await service.chat({ provider: 'union', modelName: 'duo', history, systemPrompt: 'BASE', agentTurn: { tools: [], input: [{ role: 'user', content: 'x' }], runKey: 'r1', continuation: true }, onAdvice: advice => shown.push(advice) })
  assert.equal(shown.length, 1, 'a later step of the same turn does not show the advice again')
})