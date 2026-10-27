const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createMcpConnectors } = require('../electron/mcp-connectors.cjs')
const id = 'najd-windows-native'

test('connected read adapter permits only fixed app discovery and rejects stale results', async () => {
  let receipt = null, release
  const manager = createMcpConnectors({ node: { mcpReceipt: () => receipt,
    connect: async () => { receipt = { protocolVersion: '2024-11-05', tools: ['system.which'] } }, stop: async () => { receipt = null },
    discoverApps: async () => new Promise(resolve => { release = resolve }) } })
  await assert.rejects(manager.readApps(), { code: 'NOT_CONNECTED' })
  await manager.connect(id)
  const result = manager.readApps()
  await new Promise(resolve => setImmediate(resolve))
  await manager.disconnect(id)
  release([{ id: 'chrome' }])
  await assert.rejects(result, { code: 'NOT_CONNECTED' })
})

test('connected read adapter returns fixed app discovery without opening apps', async () => {
  let receipt = null, calls = 0
  const manager = createMcpConnectors({ node: { mcpReceipt: () => receipt,
    connect: async () => { receipt = { protocolVersion: '2024-11-05', tools: ['system.which'] } },
    discoverApps: async () => { calls++; return [{ id: 'chrome', found: true }] } } })
  await manager.connect(id)
  assert.deepEqual(await manager.readApps(), { apps: [{ id: 'chrome', found: true }] })
  const controller = new AbortController(); controller.abort()
  await assert.rejects(manager.readApps(controller.signal), { code: 'CANCELLED' })
  assert.equal(calls, 1)
  assert.equal(manager.call, undefined)
})

test('MCP manager shares native lifecycle and exposes no configurable executable or direct action surface', async () => {
  let receipt = null, starts = 0, stops = 0
  const manager = createMcpConnectors({ node: { mcpReceipt: () => receipt, connect: async () => {
    starts++; receipt = { protocolVersion: '2024-11-05', tools: ['system.which', 'najd.windows.demo'] }; return receipt
  }, stop: async () => { stops++; receipt = null } } })
  assert.equal(manager.list()[0].state, 'disconnected')
  assert.throws(() => manager.connect('arbitrary-command'), { code: 'INVALID_INPUT' })
  const first = manager.connect(id), second = manager.connect(id)
  assert.equal(first, second)
  assert.equal((await first).state, 'connected')
  assert.equal(starts, 1)
  assert.equal(manager.list()[0].executableConfigurable, false)
  assert.equal(manager.call, undefined)
  const a = manager.disconnect(id), b = manager.disconnect(id)
  assert.equal(a, b)
  await a
  assert.equal(stops, 1)
  assert.equal((await manager.connect(id)).state, 'connected')
  receipt = null // Worker crash cannot leave a stale connected status.
  assert.equal(manager.list()[0].state, 'disconnected')
})

test('MCP manager propagates missing runtime and rejects stale startup after disconnect', async () => {
  let finish
  const manager = createMcpConnectors({ node: { mcpReceipt: () => null,
    connect: () => new Promise(resolve => { finish = resolve }), stop: async () => {} } })
  const connecting = manager.connect(id)
  const rejected = assert.rejects(connecting, { code: 'CANCELLED' })
  await manager.disconnect(id)
  finish()
  await rejected
  assert.equal(manager.list()[0].state, 'disconnected')
  const missing = createMcpConnectors({ node: { mcpReceipt: () => null, connect: async () => { throw Object.assign(new Error(), { code: 'WINDOWS_NODE_NOT_INSTALLED' }) } } })
  await assert.rejects(missing.connect(id), { code: 'WINDOWS_NODE_NOT_INSTALLED' })
  assert.equal(missing.list()[0].state, 'failed')
})

test('the companion connects at startup unless the user disconnected it; missing companion stays disconnected', async () => {
  let receipt = null, saved = null, connects = 0
  const node = { mcpReceipt: () => receipt, connect: async () => { connects++; receipt = { protocolVersion: '2024-11-05', tools: ['system.which'] } }, stop: async () => { receipt = null } }
  const preference = { get: async () => saved, set: async value => { saved = value } }
  const first = createMcpConnectors({ node, preference })
  assert.equal((await first.resume()).state, 'connected'); assert.equal(saved, true)
  await first.disconnect(id); assert.equal(saved, false)
  const second = createMcpConnectors({ node, preference })
  assert.equal((await second.resume()).state, 'disconnected'); assert.equal(connects, 1, 'a user who disconnected is not reconnected')
  const missing = createMcpConnectors({ node: { mcpReceipt: () => null, connect: async () => { throw Object.assign(new Error('x'), { code: 'WINDOWS_NODE_NOT_INSTALLED' }) } }, preference: { get: async () => null, set: async () => {} } })
  assert.equal((await missing.resume()).state, 'disconnected')
})

test('M2-R7-001: desktop work is allowed only while the user allows the companion, across restarts', async () => {
  let saved = null, receipt = null
  const node = { mcpReceipt: () => receipt, connect: async () => { receipt = { protocolVersion: '2024-11-05', tools: [] } }, stop: async () => { receipt = null } }
  const preference = { get: async () => saved, set: async value => { saved = value } }
  const first = createMcpConnectors({ node, preference })
  assert.equal(first.allowed(), false, 'not before the saved choice is known')
  await first.resume()
  assert.equal(first.allowed(), true)
  await first.disconnect(id)
  assert.equal(first.allowed(), false); assert.equal(saved, false)
  const afterRestart = createMcpConnectors({ node, preference })
  await afterRestart.resume()
  assert.equal(afterRestart.allowed(), false, 'a disconnect holds across restarts')
  await afterRestart.connect(id)
  assert.equal(afterRestart.allowed(), true)
})

test('M2-R8-004: a disconnect during the startup read of the saved choice is not undone by startup', async () => {
  let receipt = null, releaseRead, saved = null
  const node = { mcpReceipt: () => receipt, connect: async () => { receipt = { protocolVersion: '2024-11-05', tools: [] } }, stop: async () => { receipt = null } }
  const preference = { get: () => new Promise(resolve => { releaseRead = () => resolve(null) }), set: async value => { saved = value } }
  const manager = createMcpConnectors({ node, preference })
  const resuming = manager.resume()
  await manager.disconnect(id)
  releaseRead()
  await resuming
  assert.equal(manager.allowed(), false); assert.equal(saved, false); assert.equal(manager.list()[0].state, 'disconnected')
})

test('M2-R30-001: the off choice is saved even when stopping fails, a failed save is reported, and writes keep their order', async () => {
  const id = 'najd-windows-native'
  let saved = true, failStop = true, failSave = false
  const order = []
  let releaseOn
  const preference = { get: async () => saved, set: async value => {
    if (value === true) await new Promise(resolve => { releaseOn = resolve })
    if (failSave) throw new Error('disk')
    order.push(value); saved = value } }
  const node = { mcpReceipt: () => null, connect: async () => {}, stop: async () => { if (failStop) throw new Error('stuck') } }
  const manager = createMcpConnectors({ node, preference })
  await assert.rejects(manager.disconnect(id), { code: 'WINDOWS_NODE_FAILED' })
  assert.equal(saved, false, 'the off choice survives a host that would not stop')
  assert.equal((await createMcpConnectors({ node, preference }).resume()).state !== 'connected', true)
  failStop = false; failSave = true
  await assert.rejects(manager.disconnect(id), { code: 'PREFERENCE_SAVE_FAILED' })
  failSave = false
  const connecting = manager.connect(id)
  await new Promise(resolve => setImmediate(resolve))
  const off = manager.disconnect(id)
  releaseOn?.()
  await connecting.catch(() => {}); await off
  assert.equal(saved, false, 'a later disconnect is not overwritten by an earlier connect')
  assert.equal(order.at(-1), false)
})

test('M2-R31-003: the saved companion choice fails closed and is written atomically', async () => {
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
  const { createConnectorPreference } = require('../electron/connector-preference.cjs')
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'najd-connector-pref-')), filePath = path.join(root, 'connectors.json')
  const preference = createConnectorPreference({ filePath })
  assert.equal(await preference.get(), null, 'first run: no choice yet')
  await preference.set(false); assert.equal(await preference.get(), false)
  await preference.set(true); assert.equal(await preference.get(), true)
  assert.deepEqual(fs.readdirSync(root), ['connectors.json'], 'no temporary file is left behind')
  fs.writeFileSync(filePath, '{"windowsNative":')
  assert.equal(await preference.get(), false, 'a damaged choice reads as off')
  assert.ok(fs.readdirSync(root).some(name => name.startsWith('connectors.json.corrupt-')), 'the damaged file is kept aside')
  assert.equal(await preference.get(), false, 'and stays off after it was moved aside')
  fs.rmSync(filePath); fs.mkdirSync(filePath)
  assert.equal(await preference.get(), false, 'an unreadable choice reads as off')
  let connects = 0
  const node = { mcpReceipt: () => null, connect: async () => { connects++ }, stop: async () => {} }
  for (const get of [async () => false, async () => { throw new Error('busy') }]) {
    const manager = createMcpConnectors({ node, preference: { get, set: async () => {} } })
    await manager.resume(); assert.equal(manager.allowed(), false)
  }
  assert.equal(connects, 0, 'startup never connects on an off or unreadable choice')
})

test('M2-R32-001: a failed or interrupted recovery of a damaged choice leaves it off across restarts', async () => {
  const fs = require('node:fs'), fsp = require('node:fs/promises'), os = require('node:os'), path = require('node:path')
  const { createConnectorPreference } = require('../electron/connector-preference.cjs')
  for (const broken of ['copyFile', 'rename']) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'najd-connector-recover-')), filePath = path.join(root, 'connectors.json')
    fs.writeFileSync(filePath, '{"windowsNative":')
    const failing = { ...fsp, [broken]: async () => { throw new Error('interrupted') } }
    assert.equal(await createConnectorPreference({ filePath, fs: failing }).get(), false, broken + ' failure reads as off')
    assert.equal(fs.readFileSync(filePath, 'utf8'), '{"windowsNative":', 'the damaged original stays in place')
    assert.equal(fs.readdirSync(root).some(name => name.includes('.tmp-')), false, 'no temporary file is left')
    let connects = 0
    const manager = createMcpConnectors({ node: { mcpReceipt: () => null, connect: async () => { connects++ }, stop: async () => {} },
      preference: createConnectorPreference({ filePath }) })
    await manager.resume()
    assert.equal(connects, 0, 'the next start stays off')
    assert.equal(JSON.parse(fs.readFileSync(filePath, 'utf8')).windowsNative, false, 'a later successful recovery writes an explicit off')
    assert.ok(fs.readdirSync(root).some(name => name.startsWith('connectors.json.corrupt-')))
  }
})
