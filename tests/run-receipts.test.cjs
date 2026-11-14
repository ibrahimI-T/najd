const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { createRunReceipts } = require('../electron/run-receipts.cjs')
const { createNajdCore } = require('../electron/najd-core.cjs')

const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'najd-receipts-'))
const receipt = (total, profile = 'coding') => ({ outcome: 'completed', profile, toolsets: ['core', 'files'], toolCalls: 2,
  usage: { input: total - 10, output: 10, total, cached: null, modelCalls: 2, partial: false }, request: { instructionsBytes: 900, toolsBytes: 2000, turnBytes: 50, historyBytes: 400, images: 0 } })

test('receipts are idempotent per run, bound to their conversation and survive a restart', async () => {
  const filePath = path.join(temp(), 'run-receipts.json')
  const store = createRunReceipts({ filePath })
  assert.equal(await store.record({ runId: 'run-1', conversationId: 'conv-a', state: 'COMPLETED', receipt: receipt(110) }), true)
  assert.equal(await store.record({ runId: 'run-1', conversationId: 'conv-a', state: 'COMPLETED', receipt: receipt(999) }), false)
  await store.record({ runId: 'run-2', conversationId: 'conv-a', state: 'CANCELLED', receipt: { ...receipt(50, 'design'), outcome: 'cancelled', usage: { input: null, output: 5, total: null, cached: 32, modelCalls: 1, partial: true } } })
  await store.record({ runId: 'run-3', conversationId: 'conv-b', state: 'COMPLETED', receipt: receipt(70) })
  const again = createRunReceipts({ filePath })
  const totals = await again.totals('conv-a')
  assert.deepEqual(totals, { runs: 2, input: 100, output: 15, total: 110, cached: 32, modelCalls: 3, toolCalls: 4, partial: true, tools: {}, skills: [] })
  assert.equal(await again.lastProfile('conv-a'), 'design')
  assert.equal((await again.list('conv-b')).length, 1)
  await assert.rejects(again.record({ runId: '../x', conversationId: 'conv-a', receipt: receipt(1) }), { code: 'INVALID_INPUT' })
})

test('a corrupt receipts file is preserved, not overwritten', async () => {
  const dir = temp(), filePath = path.join(dir, 'run-receipts.json')
  fs.writeFileSync(filePath, '{not json')
  const store = createRunReceipts({ filePath })
  assert.deepEqual(await store.list('conv-a'), [])
  assert.equal(store.corrupt(), true)
  assert.ok(fs.readdirSync(dir).some(name => name.startsWith('run-receipts.json.corrupt-')))
})

test('the core records the receipt of a failed model run for its conversation', async () => {
  const recorded = []
  const core = createNajdCore({ onReceipt: entry => recorded.push(entry), model: async () => {
    throw Object.assign(new Error('BUDGET_EXCEEDED'), { code: 'BUDGET_EXCEEDED', receipt: { ...receipt(300), outcome: 'budget' } })
  } })
  const task = core.startTask({ text: 'write a long script', intentId: 'b'.repeat(32), provider: 'ollama', conversationId: 'conv-z', profile: 'coding' })
  for (let i = 0; i < 50 && !['FAILED', 'COMPLETED'].includes(core.getTask(task.id).state); i++) await new Promise(resolve => setTimeout(resolve, 10))
  await new Promise(resolve => setTimeout(resolve, 10))
  const done = core.getTask(task.id)
  assert.equal(done.state, 'FAILED'); assert.equal(done.receipt.outcome, 'budget'); assert.equal(done.conversationId, 'conv-z')
  assert.equal(recorded.length, 1); assert.equal(recorded[0].conversationId, 'conv-z'); assert.equal(recorded[0].runId, task.id)
  assert.throws(() => core.startTask({ text: 'x', intentId: 'c'.repeat(32), provider: 'ollama', conversationId: '../../etc' }), { code: 'INVALID_INPUT' })
})

test('the context window comes from the model: listed, named, or fixed by NAJD', async () => {
  const { modelWindow, namedWindow } = require('../electron/model-window.cjs')
  assert.equal(modelWindow({ context_window: 272000 }, 'gpt-x'), 272000)
  assert.equal(modelWindow({ inputTokenLimit: 1048576 }, 'gemini-x'), 1048576)
  assert.equal(modelWindow({ context_length: 'big' }, 'k3-256k'), 256000)
  assert.equal(namedWindow('model-1m'), 1000000)
  assert.equal(namedWindow('kimi-for-coding'), null)
  assert.equal(namedWindow('llama3.1:8b'), null)
  assert.equal(modelWindow({ context_window: 12 }, 'tiny'), null)
  const store = createRunReceipts({ filePath: path.join(temp(), 'run-receipts.json') })
  await store.record({ runId: 'run-w', conversationId: 'conv-w', state: 'COMPLETED', receipt: receipt(10), provider: 'kimi-code', modelName: 'k3-256k', contextWindow: 256000 })
  await store.record({ runId: 'run-o', conversationId: 'conv-w', state: 'COMPLETED', receipt: receipt(10), provider: 'ollama', modelName: 'm', contextWindow: 32768 })
  await store.record({ runId: 'run-x', conversationId: 'conv-w', state: 'COMPLETED', receipt: receipt(10), provider: 'zai-api', modelName: 'm', contextWindow: 'huge' })
  assert.deepEqual((await store.list('conv-w')).map(run => run.contextWindow), [256000, 32768, null], 'an Ollama run keeps the window read from Ollama for it (no fixed 16K since 2026-11-09)')
})

test('receipts keep the tools and skills a run used and total them per conversation (usage panel)', async () => {
  const { createRunReceipts } = require('../electron/run-receipts.cjs')
  const dir = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'najd-receipts-tools-'))
  const store = createRunReceipts({ filePath: require('node:path').join(dir, 'r.json') })
  const receipt = (tools, skills) => ({ outcome: 'completed', profile: 'general', toolsets: [], usage: { input: 10, output: 5, total: 15, cached: 0, modelCalls: 1 }, toolCalls: 2, tools, skills })
  await store.record({ runId: 'run-1', conversationId: 'conv-1', state: 'COMPLETED', receipt: receipt({ najd_web_search: 2, 'bad name!': 3 }, ['najd-humanizer', 'bad id with spaces']) })
  await store.record({ runId: 'run-2', conversationId: 'conv-1', state: 'COMPLETED', receipt: receipt({ najd_web_search: 1, najd_files_write: 1 }, ['najd-humanizer', 'my-weekly-report']) })
  const [run] = await store.list('conv-1')
  assert.deepEqual(run.tools, { najd_web_search: 2 })
  assert.deepEqual(run.skills, ['najd-humanizer'])
  const totals = await store.totals('conv-1')
  assert.deepEqual(totals.tools, { najd_web_search: 3, najd_files_write: 1 })
  assert.deepEqual(totals.skills, ['najd-humanizer', 'my-weekly-report'])
  assert.equal(totals.total, 30)
})

test('a tool named like an Object property is counted as a name (review 2026-11-08)', async () => {
  const { createRunReceipts } = require('../electron/run-receipts.cjs')
  const store = createRunReceipts({ filePath: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'najd-receipts-proto-')), 'r.json') })
  const receipt = { outcome: 'completed', profile: 'general', toolsets: [], usage: { modelCalls: 1 }, toolCalls: 1, tools: { constructor: 1, toString: 2 } }
  await store.record({ runId: 'run-a', conversationId: 'conv-p', state: 'COMPLETED', receipt })
  await store.record({ runId: 'run-b', conversationId: 'conv-p', state: 'COMPLETED', receipt })
  assert.deepEqual((await store.totals('conv-p')).tools, { constructor: 2, toString: 4 })
})

test('the context usage log keeps the conversation id, so the side panel finds its context (agent audit 2026-11-08)', async () => {
  const { createContextUsageLog } = require('../electron/context-usage-log.cjs')
  const log = createContextUsageLog({ filePath: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'najd-context-log-')), 'context.jsonl') })
  await log.record({ conversationId: 'f4e1534e-c133-488f-8497-5e2c4183c2e9', tier: 'balanced', instructionsBytes: 350 })
  await log.record({ conversationId: '../bad id', tier: 'balanced' })
  const [good, bad] = await log.recent()
  assert.equal(good.conversationId, 'f4e1534e-c133-488f-8497-5e2c4183c2e9')
  assert.equal(bad.conversationId, null)
})

test('repeatedCalls is stored as a bounded number and left out when zero', async () => {
  const store = createRunReceipts({ filePath: path.join(temp(), 'run-receipts.json') })
  await store.record({ runId: 'run-r1', conversationId: 'conv-r', state: 'COMPLETED', receipt: { ...receipt(10), repeatedCalls: 3 } })
  await store.record({ runId: 'run-r2', conversationId: 'conv-r', state: 'COMPLETED', receipt: { ...receipt(10), repeatedCalls: 'many' } })
  const [first, second] = await store.list('conv-r')
  assert.equal(first.repeatedCalls, 3); assert.equal('repeatedCalls' in second, false)
})
