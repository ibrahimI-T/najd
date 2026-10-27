const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { createActionJournal } = require('../electron/action-journal.cjs')

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'najd-journal-test-'))
  t.after(async () => {
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(root).startsWith('najd-journal-test-')) throw Error('Unsafe cleanup')
    await fs.rm(root, { recursive: true, force: true })
  })
  const filePath = path.join(root, 'actions.json')
  return { filePath, journal: createActionJournal({ filePath }) }
}
const intent = { intentId: 'owned-intent', operation: 'files.patch', target: 'Selected project document', changeHash: 'a'.repeat(64) }

test('journal binds exact intent, nonce and one durable execution claim', async t => {
  const { journal, filePath } = await fixture(t)
  const record = await journal.prepare(intent)
  assert.equal(record.state, 'AWAITING_APPROVAL')
  assert.equal((await journal.prepare(intent)).id, record.id)
  await assert.rejects(journal.prepare({ ...intent, changeHash: 'b'.repeat(64) }), { code: 'CONFLICT' })
  await assert.rejects(journal.decide(record.id, 'wrong', 'ALLOW_ONCE'), { code: 'CONFLICT' })
  await journal.decide(record.id, record.nonce, 'ALLOW_ONCE')
  const claims = await Promise.allSettled([journal.claim(record.id), journal.claim(record.id)])
  assert.equal(claims.filter(item => item.status === 'fulfilled').length, 1)
  assert.equal(JSON.parse(await fs.readFile(filePath)).actions[0].state, 'EXECUTING')
  await journal.finish(record.id, true)
  assert.equal((await journal.get(record.id)).state, 'COMPLETED')
  await assert.rejects(journal.claim(record.id), { code: 'CONFLICT' })
})

test('restart rotates pending consent and converts interrupted effects into uncertainty', async t => {
  const { journal, filePath } = await fixture(t)
  const pending = await journal.prepare(intent)
  await journal.decide(pending.id, pending.nonce, 'ALLOW_ONCE')
  const running = await journal.prepare({ ...intent, intentId: 'running' })
  await journal.decide(running.id, running.nonce, 'ALLOW_ONCE')
  await journal.claim(running.id)
  const reopened = createActionJournal({ filePath })
  const restored = await reopened.get(pending.id)
  assert.equal(restored.state, 'AWAITING_APPROVAL')
  assert.notEqual(restored.nonce, pending.nonce)
  assert.equal((await reopened.get(running.id)).state, 'UNKNOWN_EFFECT')
  await assert.rejects(reopened.decide(pending.id, pending.nonce, 'ALLOW_ONCE'), { code: 'CONFLICT' })
  await assert.rejects(reopened.claim(running.id), { code: 'CONFLICT' })
})

test('denial and cancellation never permit execution; unverified outcomes remain uncertain', async t => {
  const { journal } = await fixture(t)
  const denied = await journal.prepare(intent)
  await journal.decide(denied.id, denied.nonce, 'DENY')
  await assert.rejects(journal.claim(denied.id), { code: 'CONFLICT' })
  const cancelled = await journal.prepare({ ...intent, intentId: 'cancelled' })
  await journal.cancel(cancelled.id)
  assert.equal((await journal.get(cancelled.id)).state, 'CANCELLED')
  const uncertain = await journal.prepare({ ...intent, intentId: 'uncertain' })
  await journal.decide(uncertain.id, uncertain.nonce, 'ALLOW_ONCE')
  await journal.claim(uncertain.id)
  await journal.finish(uncertain.id, false)
  assert.equal((await journal.get(uncertain.id)).state, 'UNKNOWN_EFFECT')
})

test('journal rejects unexpected fields/operations and preserves corruption', async t => {
  const { journal, filePath } = await fixture(t)
  await assert.rejects(journal.prepare({ ...intent, command: 'PRIVATE-COMMAND' }), { code: 'INVALID_INPUT' })
  await assert.rejects(journal.prepare({ ...intent, operation: 'arbitrary.run' }), { code: 'INVALID_INPUT' })
  await journal.prepare(intent)
  await fs.writeFile(filePath, '{broken')
  await assert.rejects(createActionJournal({ filePath }).prepare(intent), { code: 'JOURNAL_CORRUPT' })
  assert.equal(await fs.readFile(filePath, 'utf8'), '{broken')
})
