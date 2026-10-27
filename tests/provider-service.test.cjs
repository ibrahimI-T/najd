const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { createProviderService } = require('../electron/provider-service.cjs')

test('agent continuation counts tool context and refuses a replaced credential route', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'najd-route-test-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  let calls = 0
  const service = createProviderService({ directory, encryption: { isAsyncEncryptionAvailable: async () => true,
    encryptStringAsync: async value => Buffer.from(value), decryptStringAsync: async bytes => ({ result: bytes.toString() }) },
    chatGPT: {}, ollama: {}, clientFactory: () => ({ chat: async () => { calls++; return { kind: 'message', text: 'Done' } } }) })
  t.after(() => service.dispose())
  await service.saveKey('openai-api', 'sk-fixture-first-key')
  const routeToken = await service.captureRoute('openai-api')
  const request = { provider: 'openai-api', modelName: 'gpt-6.1-sol', history: [{ role: 'user', text: 'Read' }], routeToken,
    agentTurn: { tools: [], input: [] } }
  await service.chat(request)
  await service.saveKey('openai-api', 'sk-fixture-second-key')
  await assert.rejects(service.chat(request), { code: 'CREDENTIAL_CHANGED' })
  assert.equal(calls, 1)
  // No usage limits: a large input is not refused by NAJD (the model's own window decides).
  await service.saveKey('openai-api', 'sk-fixture-first-key')
  const fresh = { ...request, routeToken: await service.captureRoute('openai-api'), agentTurn: { tools: [], input: ['x'.repeat(5000000)] } }
  await service.chat(fresh)
  assert.equal(calls, 2)
})

test('main-owned system context counts against the input budget on local and selected cloud routes', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'najd-hermes-budget-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  let calls = 0, cloudCalls = 0
  const service = createProviderService({ directory, encryption: { isAsyncEncryptionAvailable: async () => false }, chatGPT: { chat: async request => {
    cloudCalls++; assert.equal(request.systemPrompt, 's'.repeat(980)); return { kind: 'message', text: 'cloud style' }
  } }, ollama: { chat: async request => {
    calls++; assert.equal(request.systemPrompt, 's'.repeat(980)); return { kind: 'message', text: 'plan' }
  } } })
  t.after(() => service.dispose())
  const request = { provider: 'ollama', modelName: 'fixture', systemPrompt: 's'.repeat(980), history: [{ role: 'user', text: 'Plan' }] }
  assert.equal((await service.chat(request)).text, 'plan')
  assert.equal((await service.chat({ ...request, provider: 'chatgpt' })).text, 'cloud style')
  await assert.rejects(service.chat({ ...request, systemPrompt: '' }), { code: 'INVALID_INPUT' })
  await assert.rejects(service.chat({ ...request, readPath: 'C:\\fixture.txt' }), { code: 'INVALID_INPUT' })
  assert.equal(calls, 1)
  assert.equal(cloudCalls, 1)
  assert.equal((await service.limits()).cloudAttempts, 1)
})

test('there are no usage limits: concurrent requests, repeated cloud attempts and large inputs all go through', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'najd-provider-nolimits-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  let calls = 0, release
  const gate = new Promise(resolve => { release = resolve })
  const service = createProviderService({ directory: root, encryption: {
    isAsyncEncryptionAvailable: async () => true, encryptStringAsync: async value => Buffer.from(value),
    decryptStringAsync: async value => ({ result: value.toString() })
  }, ollama: { chat: async () => ({ kind: 'message', text: 'local' }) }, clientFactory: () => ({ chat: async ({ history, readPath }) => {
    calls++
    if (readPath === undefined) await gate
    return { kind: 'message', text: 'cloud' }
  } }) })
  await service.saveKey('openai-api', 'sk-najd-FAKE-LIMITS')
  const request = { provider: 'openai-api', modelName: 'test-model', history: [{ role: 'user', text: 'fixture' }] }
  await assert.rejects(service.chat({ ...request, provider: 'anthropic-api', readPath: 'fixture.txt' }), { code: 'TOOLS_NOT_SUPPORTED' })
  const parallel = [service.chat(request), service.chat(request), service.chat(request), service.chat(request)]
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.equal((await service.limits()).activeRequests, 4, 'four requests run at the same time')
  release()
  await Promise.all(parallel)
  for (let i = 0; i < 150; i++) await service.chat(request)
  await service.chat({ ...request, history: [{ role: 'user', text: 'x'.repeat(3000000) }] })
  assert.equal(calls, 155)
  assert.equal((await service.limits()).cloudAttempts, 155, 'attempts are only counted, never capped')
  assert.equal((await service.limits()).policy.maxCloudAttempts, 0)
  assert.equal((await service.setLimits({ maxCloudAttempts: 1 })).policy.maxCloudAttempts, 0, 'limits cannot be set')
  service.dispose()
})

test('catalog verification survives restart, clears on rejection/replacement, and never exposes keys', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'najd-providers-'))
  t.after(() => fs.rm(root, { force: true, recursive: true }))
  let rejected = false, pendingReply = null, entered = null
  const options = { directory: root, encryption: {
    isAsyncEncryptionAvailable: async () => true,
    encryptStringAsync: async text => Buffer.from(`sealed:${text}`),
    decryptStringAsync: async bytes => ({ result: bytes.toString().slice(7) })
  }, chatGPT: { status: async () => ({ signedIn: false, verified: false, activeId: null }) },
  ollama: { listModels: async () => [] }, clientFactory: () => ({
    listModels: async () => [{ id: 'test-model', label: 'Test' }],
    chat: async () => { entered?.(); if (pendingReply) await pendingReply; if (rejected) throw Object.assign(new Error('PRIVATE RESPONSE'), { code: 'AUTH_REQUIRED' }); return { kind: 'message', text: 'OK' } }
  }) }
  const service = createProviderService(options)
  assert.throws(() => service.resolveReasoning('unregistered', 'test-model', 'Hello', 'auto'), { code: 'INVALID_INPUT' })
  assert.throws(() => service.resolveReasoning('openai-api', {}, 'Hello', 'auto'), { code: 'INVALID_INPUT' })
  await assert.rejects(service.chat({ provider: 'openai-api', modelName: 'test-model', history: {} }), { code: 'INVALID_INPUT' })
  await assert.rejects(service.models('kimi-code'), { code: 'AUTH_REQUIRED' })
  await service.saveKey('openai-api', 'sk-najd-FAKE-CREDENTIAL')
  const pick = async instance => (await instance.catalog()).find(p => p.id === 'openai-api')
  assert.equal((await pick(service)).verified, false)
  await service.testModel('openai-api', 'test-model')
  assert.equal((await pick(createProviderService(options))).verified, true)
  assert.equal(JSON.stringify(await service.catalog()).includes('FAKE-CREDENTIAL'), false)
  rejected = true
  await assert.rejects(service.testModel('openai-api', 'test-model'), { code: 'AUTH_REQUIRED' })
  assert.equal((await pick(service)).verified, false)
  await service.saveKey('openai-api', 'sk-najd-REPLACEMENT')
  assert.equal((await pick(service)).verified, false)
  await assert.rejects(service.saveKey('minimax-plan', 'sk-najd-REPLACEMENT'), { code: 'INVALID_INPUT' })
  rejected = false
  let release
  pendingReply = new Promise(resolve => { release = resolve })
  const started = new Promise(resolve => { entered = resolve })
  const late = service.testModel('openai-api', 'test-model')
  const lateCheck = assert.rejects(late, { code: 'CANCELLED' })
  await started
  await service.saveKey('openai-api', 'sk-najd-NEXT-CREDENTIAL')
  release()
  await lateCheck
  assert.equal((await pick(service)).verified, false)
  await service.clearKey('openai-api')
  assert.equal((await pick(service)).configured, false)
})

test('listed models carry their context window and runs can look it up', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'najd-providers-'))
  t.after(() => fs.rm(root, { force: true, recursive: true }))
  const service = createProviderService({ directory: root, encryption: {
    isAsyncEncryptionAvailable: async () => true,
    encryptStringAsync: async text => Buffer.from(`sealed:${text}`),
    decryptStringAsync: async bytes => ({ result: bytes.toString().slice(7) })
  }, chatGPT: { status: async () => ({ signedIn: false, verified: false, activeId: null }) },
  ollama: { listModels: async () => ['qwen'] }, clientFactory: () => ({
    listModels: async () => [{ id: 'big', label: 'Big', contextWindow: 400000 }, { id: 'plain', label: 'Plain' }, { id: 'odd', label: 'Odd', contextWindow: -5 }],
    chat: async () => ({ kind: 'message', text: 'OK' })
  }) })
  await service.saveKey('openai-api', 'sk-najd-FAKE-CREDENTIAL')
  assert.deepEqual((await service.models('openai-api')).map(m => m.contextWindow), [400000, null, null])
  assert.equal(service.contextWindow('openai-api', 'big'), 400000)
  assert.equal(service.contextWindow('kimi-code', 'k3-256k'), 256000)
  assert.equal((await service.models('ollama'))[0].contextWindow, 16384)
  assert.equal(service.contextWindow('ollama', 'anything'), 16384)
})
