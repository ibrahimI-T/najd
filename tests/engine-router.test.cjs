const { test } = require('node:test')
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { createEngineRouter } = require('../electron/engine-router.cjs')
const { createNajdCore } = require('../electron/najd-core.cjs')
const { createHermesAdapter } = require('../electron/hermes.cjs')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')

test('missing or changed Hermes preparation fails before spawn/provider and reports a bounded status', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'najd-hermes-preparation-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  let calls = 0
  const adapter = createHermesAdapter({ root, chat: async () => { calls++ } })
  const request = { text: 'Plan only', provider: 'ollama', modelName: 'fixture' }
  await assert.rejects(adapter.run(request), { code: 'NOT_INSTALLED' })
  assert.equal(adapter.status().state, 'not_installed')
  await fs.mkdir(path.join(root, '.runtimes/hermes'), { recursive: true })
  await fs.writeFile(path.join(root, '.runtimes/hermes/prepared.json'), JSON.stringify({ sourceRevision: '0'.repeat(40) }))
  await assert.rejects(adapter.run(request), { code: 'INCOMPATIBLE_RUNTIME' })
  assert.equal(adapter.status().error, 'INCOMPATIBLE_RUNTIME')
  assert.equal(adapter.status().instanceId, null)
  assert.equal(calls, 0)
  await adapter.stop()
})

test('engine failures remain explicit in the core and repeated intent does not retry', async () => {
  let calls = 0
  const core = createNajdCore({ model: createEngineRouter({ chat: async () => { throw new Error('Wrong engine') },
    hermes: { run: async () => { calls++; throw Object.assign(new Error(), { code: 'NOT_INSTALLED' }) } } }) })
  const request = { intentId: randomUUID(), text: '/hermes Plan only', provider: 'ollama', modelName: 'fixture' }
  const task = core.startTask(request)
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.equal(core.getTask(task.id).errorCode, 'NOT_INSTALLED')
  assert.equal(core.startTask(request).id, task.id)
  assert.equal(calls, 1)
})

test('explicit bilingual Hermes routing captures one engine and never falls back', async () => {
  let normal = 0, planning = 0
  const model = createEngineRouter({ chat: async () => { normal++; return { kind: 'message', text: 'normal' } },
    hermes: { run: async request => { planning++; assert.equal(request.provider, 'ollama'); assert.equal(request.text, 'Plan only'); return { kind: 'message', text: 'plan' } } } })
  for (const command of ['hermes', 'هيرمس']) {
    const request = { text: `/${command} Plan only`, provider: 'ollama', modelName: 'fixture' }
    assert.equal((await model(request)).text, 'plan')
  }
  assert.equal(normal, 0)
  assert.equal(planning, 2)
  await assert.rejects(model({ text: '/hermes', modelName: 'fixture' }), { code: 'INVALID_INPUT' })
  const denied = createEngineRouter({ chat: async () => { normal++ }, hermes: { run: async () => { throw Object.assign(new Error(), { code: 'TOOLS_NOT_SUPPORTED' }) } } })
  await assert.rejects(denied({ text: '/hermes Plan', provider: 'chatgpt', modelName: 'fixture' }), { code: 'TOOLS_NOT_SUPPORTED' })
  assert.equal(normal, 0)
})

test('core deduplicates the routed intent and never executes a planning request as a file action', async () => {
  let calls = 0, effects = 0
  const core = createNajdCore({ model: createEngineRouter({ chat: async () => { throw new Error('Wrong engine') },
    hermes: { run: async request => { calls++; assert.match(request.text, /^\/read/); return { kind: 'message', text: 'No device action' } } } }),
    tool: async () => { effects++ } })
  const request = { intentId: randomUUID(), text: '/hermes /read C:\\private.txt', provider: 'ollama', modelName: 'fixture' }
  const task = core.startTask(request)
  assert.equal(core.startTask(request).id, task.id)
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.equal(core.getTask(task.id).state, 'COMPLETED')
  assert.equal(calls, 1)
  assert.equal(effects, 0)
})
