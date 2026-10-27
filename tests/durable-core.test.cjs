const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { createNajdCore } = require('../electron/najd-core.cjs')
const { createActionJournal } = require('../electron/action-journal.cjs')
const wait = async predicate => { for (let i = 0; i < 200; i++) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 5)) }; throw Error('Task did not settle') }
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'najd-durable-test-'))
  t.after(async () => {
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(root).startsWith('najd-durable-test-')) throw Error('Unsafe cleanup')
    await fs.rm(root, { recursive: true, force: true })
  })
  return path.join(root, 'actions.json')
}
test('core persists approval and execution claim before dispatch, then requires a verified result', async t => {
  const filePath = await fixture(t), journal = createActionJournal({ filePath })
  let executions = 0
  const core = createNajdCore({ journal, verifyTool: async () => true, tool: async () => {
    executions++
    assert.equal(JSON.parse(await fs.readFile(filePath)).actions[0].state, 'EXECUTING')
    return 'verified output'
  } })
  const request = { text: '/windows chrome', intentId: 'durable-intent' }
  const task = core.startTask(request)
  await wait(() => core.getTask(task.id).state === 'WAITING_APPROVAL')
  assert.equal(JSON.parse(await fs.readFile(filePath)).actions[0].state, 'AWAITING_APPROVAL')
  const approval = core.getTask(task.id).approvalId
  core.respondApproval(approval, 'ALLOW_ONCE')
  assert.throws(() => core.respondApproval(approval, 'ALLOW_ONCE'), { code: 'CONFLICT' })
  await wait(() => core.getTask(task.id).state === 'COMPLETED')
  await core.flush()
  assert.equal(JSON.parse(await fs.readFile(filePath)).actions[0].state, 'COMPLETED')
  const restarted = createNajdCore({ journal: createActionJournal({ filePath }), tool: async () => { executions++; return 'unexpected' } })
  const replay = restarted.startTask(request)
  await wait(() => restarted.getTask(replay.id).state === 'FAILED')
  assert.equal(restarted.getTask(replay.id).errorCode, 'ACTION_REPLAY_BLOCKED')
  assert.equal(executions, 1)
})
test('cancellation during a persisted claim never dispatches its executor', async t => {
  const filePath = await fixture(t), journal = createActionJournal({ filePath })
  let release, claimed
  const blocked = new Promise(resolve => { release = resolve })
  const reached = new Promise(resolve => { claimed = resolve })
  const core = createNajdCore({ journal: { ...journal, claim: async id => {
    const result = await journal.claim(id); claimed(); await blocked; return result
  } }, tool: async () => assert.fail('Cancelled claim must not execute') })
  const task = core.startTask({ text: '/windows chrome', intentId: 'cancel-persisted-claim' })
  await wait(() => core.getTask(task.id).state === 'WAITING_APPROVAL')
  core.respondApproval(core.getTask(task.id).approvalId, 'ALLOW_ONCE')
  await reached
  core.cancelTask(task.id)
  release()
  await core.flush()
  assert.equal(core.getTask(task.id).state, 'CANCELLED')
  assert.equal(JSON.parse(await fs.readFile(filePath)).actions[0].state, 'CANCELLED')
})

test('unverified execution and a restarted interrupted action cannot replay', async t => {
  const filePath = await fixture(t), journal = createActionJournal({ filePath })
  const core = createNajdCore({ journal, tool: async () => 'No verifier proof' })
  const request = { text: '/windows edge', intentId: 'unverified' }
  const task = core.startTask(request)
  await wait(() => core.getTask(task.id).state === 'WAITING_APPROVAL')
  core.respondApproval(core.getTask(task.id).approvalId, 'ALLOW_ONCE')
  await wait(() => core.getTask(task.id).state === 'UNKNOWN_EFFECT')
  await core.flush()
  assert.equal(JSON.parse(await fs.readFile(filePath)).actions[0].state, 'UNKNOWN_EFFECT')
  const restarted = createNajdCore({ journal: createActionJournal({ filePath }), tool: async () => assert.fail('must not replay') })
  const replay = restarted.startTask(request)
  await wait(() => restarted.getTask(replay.id).state === 'UNKNOWN_EFFECT')
})
test('denial and cancellation while durable preparation is pending cannot resurrect approval or dispatch', async t => {
  const filePath = await fixture(t), journal = createActionJournal({ filePath })
  let release
  const blocked = new Promise(resolve => { release = resolve })
  const core = createNajdCore({ journal: { ...journal, prepare: async intent => { await blocked; return journal.prepare(intent) } }, tool: async () => assert.fail('cancelled effect') })
  const task = core.startTask({ text: '/windows chrome', intentId: 'cancel-preparation' })
  await new Promise(resolve => setImmediate(resolve))
  core.cancelTask(task.id)
  release()
  await wait(() => !core.hasActiveTasks())
  await core.flush()
  assert.equal(core.getTask(task.id).state, 'CANCELLED')
  assert.equal(JSON.parse(await fs.readFile(filePath)).actions[0].state, 'CANCELLED')
  const deniedCore = createNajdCore({ journal, tool: async () => assert.fail('denied effect') })
  const denied = deniedCore.startTask({ text: '/windows edge', intentId: 'deny-durable' })
  await wait(() => deniedCore.getTask(denied.id).state === 'WAITING_APPROVAL')
  deniedCore.respondApproval(deniedCore.getTask(denied.id).approvalId, 'DENY')
  await wait(() => deniedCore.getTask(denied.id).state === 'FAILED')
  await deniedCore.flush()
  assert.equal(JSON.parse(await fs.readFile(filePath)).actions.at(-1).state, 'DENIED')
})
test('read-only legacy approvals stay independent and journal failures block effects', async t => {
  const filePath = await fixture(t)
  await fs.writeFile(filePath, '{broken')
  let calls = 0
  const core = createNajdCore({ journal: createActionJournal({ filePath }), tool: async () => { calls++; return 'text' } })
  const read = core.startTask({ text: '/read fixture.txt', intentId: 'legacy-read' })
  await wait(() => core.getTask(read.id).state === 'WAITING_APPROVAL')
  core.respondApproval(core.getTask(read.id).approvalId, 'ALLOW_ONCE')
  await wait(() => core.getTask(read.id).state === 'COMPLETED')
  const action = core.startTask({ text: '/windows chrome', intentId: 'corrupt-journal' })
  await wait(() => core.getTask(action.id).state === 'FAILED')
  assert.equal(core.getTask(action.id).errorCode, 'JOURNAL_CORRUPT')
  assert.equal(calls, 1)
  assert.equal(await fs.readFile(filePath, 'utf8'), '{broken')
})

test('reconciliation records the owner\'s statement about an unconfirmed action and never starts anything', async t => {
  const filePath = await fixture(t), journal = createActionJournal({ filePath })
  const intent = n => ({ intentId: 'recon-' + n, operation: 'files.write', target: 'chrome', changeHash: 'a'.repeat(64) })
  const unknown = await journal.prepare(intent(1)); await journal.decide(unknown.id, unknown.nonce, 'ALLOW_ONCE'); await journal.claim(unknown.id); await journal.finish(unknown.id, false)
  assert.equal((await journal.get(unknown.id)).state, 'UNKNOWN_EFFECT')
  assert.equal((await journal.reconcile(unknown.id, 'not-done')).state, 'RECONCILED_NOT_DONE')
  await assert.rejects(journal.reconcile(unknown.id, 'done'), { code: 'CONFLICT' }, 'a settled action cannot be settled again')
  const second = await journal.prepare(intent(2)); await journal.decide(second.id, second.nonce, 'ALLOW_ONCE'); await journal.claim(second.id); await journal.finish(second.id, false)
  assert.equal((await journal.reconcile(second.id, 'done')).state, 'RECONCILED_DONE')
  const stale = await journal.prepare(intent(3))
  assert.equal((await journal.reconcile(stale.id, 'dismiss')).state, 'CANCELLED')
  const running = await journal.prepare(intent(4)); await journal.decide(running.id, running.nonce, 'ALLOW_ONCE'); await journal.claim(running.id)
  for (const resolution of ['done', 'not-done', 'dismiss', 'other']) await assert.rejects(journal.reconcile(running.id, resolution), { code: 'CONFLICT' }, 'an executing action cannot be settled by the owner')
  const waiting = await journal.prepare(intent(5))
  for (const resolution of ['done', 'not-done']) await assert.rejects(journal.reconcile(waiting.id, resolution), { code: 'CONFLICT' })
  await assert.rejects(journal.reconcile('not-an-id', 'done'), { code: 'INVALID_INPUT' })
  // The statement survives a restart and the record stays valid.
  const reopened = createActionJournal({ filePath })
  const states = (await reopened.list()).map(record => record.state)
  assert.ok(states.includes('RECONCILED_DONE') && states.includes('RECONCILED_NOT_DONE'))
})

test('a settled intent is never replayed by the core; a fresh intent for the same request proceeds', async t => {
  for (const resolution of ['done', 'not-done']) {
    const filePath = await fixture(t), journal = createActionJournal({ filePath })
    let executions = 0
    const core = createNajdCore({ journal, tool: async () => { executions++; return 'No verifier proof' } })
    const request = { text: '/windows edge', intentId: 'settled-' + resolution }
    const task = core.startTask(request)
    await wait(() => core.getTask(task.id).state === 'WAITING_APPROVAL')
    core.respondApproval(core.getTask(task.id).approvalId, 'ALLOW_ONCE')
    await wait(() => core.getTask(task.id).state === 'UNKNOWN_EFFECT')
    await core.flush()
    const [record] = await createActionJournal({ filePath }).list()
    assert.equal(record.state, 'UNKNOWN_EFFECT')
    await createActionJournal({ filePath }).reconcile(record.id, resolution)
    const restarted = createNajdCore({ journal: createActionJournal({ filePath }), tool: async () => { executions++; return 'No verifier proof' } })
    const replay = restarted.startTask(request)
    await wait(() => restarted.getTask(replay.id).state === 'FAILED')
    assert.equal(restarted.getTask(replay.id).errorCode, 'ACTION_REPLAY_BLOCKED')
    assert.equal(executions, 1, 'the settled action was not dispatched again')
    const fresh = restarted.startTask({ ...request, intentId: 'fresh-' + resolution })
    await wait(() => restarted.getTask(fresh.id).state === 'WAITING_APPROVAL')
    assert.equal(restarted.getTask(fresh.id).state, 'WAITING_APPROVAL', 'a new request asks for approval again')
  }
})
