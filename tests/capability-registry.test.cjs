const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { randomUUID } = require('node:crypto')
const { createNajdCore } = require('../electron/najd-core.cjs')
const { createFileTool } = require('../electron/file-tools.cjs')
const { createCapabilityRegistry } = require('../electron/capability-registry.cjs')
const pause = () => new Promise(resolve => setTimeout(resolve, 10))

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'najd-capabilities-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const file = path.join(root, 'document.txt')
  await fs.writeFile(file, 'ACTUAL APPROVED DOCUMENT')
  let registry, effects = 0
  const read = createFileTool({ getRoots: () => [root] })
  const core = createNajdCore({ authorizeTool: id => registry.authorize(id), tool: request => { effects++; return read(request) } })
  registry = createCapabilityRegistry({ directory: path.join(root, 'capabilities'), core })
  return { root, file, core, registry, effects: () => effects }
}
async function state(core, task) {
  const deadline = Date.now() + 2000
  do {
    await pause(); task = core.getTask(task.id)
    if (!['QUEUED', 'RUNNING'].includes(task.state)) return task
  } while (Date.now() < deadline)
  assert.fail('Capability task did not settle within the bounded fixture deadline')
}

test('install/enable/run/deny/allow/disable/remove reuses real core approval and filesystem scope', async t => {
  const { registry, core, file, effects } = await fixture(t)
  const id = 'najd-read-document'
  assert.equal((await registry.list()).length, 3)
  // Built-in skills start installed and enabled until the user changes them; runs still need approval.
  assert.ok((await registry.list()).every(row => row.installed && row.enabled))
  await registry.install(id)
  await registry.setEnabled(id, false)
  await assert.rejects(registry.run(id, { path: file }, randomUUID()), { code: 'PERMISSION_DENIED' })
  await registry.setEnabled(id, true)
  let task = await registry.run(id, { path: file }, randomUUID())
  task = await state(core, task)
  assert.equal(task.state, 'WAITING_APPROVAL')
  assert.equal(effects(), 0)
  core.respondApproval(task.approvalId, 'DENY')
  assert.equal(core.getTask(task.id).errorCode, 'PERMISSION_DENIED')
  assert.equal(effects(), 0)
  task = await registry.run(id, { path: file }, randomUUID())
  task = await state(core, task)
  core.respondApproval(task.approvalId, 'ALLOW_ONCE')
  task = await state(core, task)
  assert.equal(task.state, 'COMPLETED')
  assert.equal(task.output, 'ACTUAL APPROVED DOCUMENT')
  assert.equal(effects(), 1)
  await registry.setEnabled(id, false)
  await assert.rejects(registry.run(id, { path: file }, randomUUID()), { code: 'PERMISSION_DENIED' })
  await registry.remove(id)
  assert.equal((await registry.list()).find(item => item.id === id).installed, false)
})

test('disable/update revoke pending approvals; repeated install never resets enabled state', async t => {
  const { registry, core, file, effects } = await fixture(t)
  const id = 'najd-read-document'
  await registry.install(id)
  await registry.setEnabled(id, true)
  await registry.install(id)
  assert.equal((await registry.list())[0].enabled, true)
  for (const operation of [() => registry.setEnabled(id, false), () => registry.update(id), () => registry.remove(id)]) {
    await registry.install(id)
    await registry.setEnabled(id, true)
    const task = await state(core, await registry.run(id, { path: file }, randomUUID()))
    await operation()
    assert.equal(core.getTask(task.id).state, 'CANCELLED')
    assert.throws(() => core.respondApproval(task.approvalId, 'ALLOW_ONCE'))
    assert.equal(effects(), 0)
  }
})

test('restart preserves version lock; corrupt and changed records are preserved and fail closed', async t => {
  const { registry, core, root, file } = await fixture(t)
  const id = 'najd-read-document', directory = path.join(root, 'capabilities'), filename = path.join(directory, 'registry.json')
  await registry.install(id)
  await registry.setEnabled(id, true)
  const restarted = createCapabilityRegistry({ directory, core })
  assert.equal((await restarted.list())[0].enabled, true)
  const record = JSON.parse(await fs.readFile(filename, 'utf8'))
  record.installed[id].digest = '0'.repeat(64)
  await fs.writeFile(filename, JSON.stringify(record))
  assert.equal((await restarted.list())[0].updateRequired, true)
  await assert.rejects(restarted.run(id, { path: file }, randomUUID()), { code: 'PERMISSION_DENIED' })
  await restarted.setEnabled(id, false)
  await assert.rejects(restarted.setEnabled(id, true), { code: 'CAPABILITY_UPDATE_REQUIRED' })
  await restarted.update(id)
  assert.equal((await restarted.list())[0].enabled, false)
  await fs.writeFile(filename, '{broken')
  await assert.rejects(restarted.list(), { code: 'CAPABILITY_STORE_UNAVAILABLE' })
  await assert.rejects(restarted.install(id), { code: 'CAPABILITY_STORE_UNAVAILABLE' })
  assert.equal(await fs.readFile(filename, 'utf8'), '{broken')
})

test('catalog never accepts arbitrary source, executable, extra inputs or line-injected commands', async t => {
  const { registry, file } = await fixture(t)
  await assert.rejects(registry.install('../untrusted'), { code: 'INVALID_INPUT' })
  const id = 'najd-read-document'
  await registry.install(id); await registry.setEnabled(id, true)
  await assert.rejects(registry.run(id, { path: file, command: 'arbitrary' }, randomUUID()), { code: 'INVALID_INPUT' })
  await assert.rejects(registry.run(id, { path: file + '\n/apps' }, randomUUID()), { code: 'INVALID_INPUT' })
})

test('revocation after approval but before dispatch still prevents the actual file read', async t => {
  const { registry, core, file, effects } = await fixture(t)
  const id = 'najd-read-document'
  await registry.install(id); await registry.setEnabled(id, true)
  const task = await state(core, await registry.run(id, { path: file }, randomUUID()))
  // Queue revocation before the asynchronous dispatch authorization can enter the registry.
  const revoked = registry.setEnabled(id, false)
  core.respondApproval(task.approvalId, 'ALLOW_ONCE')
  await revoked; await pause()
  assert.equal(core.getTask(task.id).state, 'CANCELLED')
  assert.equal(effects(), 0)
})

test('oversized capability storage fails closed without replacing the original record', async t => {
  const { registry, root } = await fixture(t)
  const filename = path.join(root, 'capabilities/registry.json')
  await registry.install('najd-list-apps')
  await fs.writeFile(filename, 'x'.repeat(65537))
  await assert.rejects(registry.list(), { code: 'CAPABILITY_STORE_UNAVAILABLE' })
  assert.equal((await fs.stat(filename)).size, 65537)
})
