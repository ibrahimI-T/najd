const { test } = require('node:test')
const assert = require('node:assert/strict')
const { collectHealth } = require('../electron/workstation/health.cjs')
test('a broken optional probe preserves other real health results', async () => {
  const result = await collectHealth({ windows: async () => { throw Error('unavailable') }, web: async () => ({ ready: true }), procedures: async () => ['guide'] })
  assert.equal(result.web.ready, true)
  assert.deepEqual(result.procedures, ['guide'])
  assert.equal(result.windows.ready, false)
  assert.equal(result.windows.reason, 'HEALTH_CHECK_FAILED:windows')
})

const { workstationHealth } = require('../electron/workstation/health.cjs')
test('workstation health accepts synchronous sources and a failing source affects only its own keys (0.10.33 audit)', async () => {
  const health = await workstationHealth({ procedures: ['najd-humanizer'], officePack: async () => { throw Error('pack missing') }, browserBridge: () => ({ paired: true, connected: false }),
    gateway: () => ({ state: 'healthy' }), windowsInstalled: async () => true, webAvailable: async () => false, mediaServices: async () => [], mcpTools: async () => [] })
  assert.equal(health.scheduler.ready, true)
  assert.equal(health.canvas.ready, true)
  assert.equal(health.gateway.ready, true)
  assert.equal(health.office.ready, false)
  assert.equal(health.browser.installed, true)
  assert.equal(health.windows.ready, true)
  assert.equal(health.web.ready, false)
  assert.deepEqual(health.procedures, ['najd-humanizer'])
})
test('a gateway status that throws synchronously leaves the other keys ready', async () => {
  const health = await workstationHealth({ officePack: () => ({ state: 'ready' }), browserBridge: () => null, gateway: () => { throw Error('down') }, windowsInstalled: () => false,
    webAvailable: () => true, mediaServices: () => ['openai-images'], mcpTools: () => [{ serverName: 'github' }] })
  assert.equal(health.gateway.ready, false)
  assert.equal(health.office.ready, true)
  assert.equal(health.web.ready, true)
  assert.equal(health.media.ready, true)
  assert.equal(health['github-account'].ready, true)
  assert.equal(health.mcp.ready, true)
})

test('3D readiness follows the installed Blender (R-080)', async () => {
  const base = { officePack: () => null, browserBridge: () => null, gateway: () => null, windowsInstalled: () => false, webAvailable: () => false, mediaServices: () => [], mcpTools: () => [] }
  assert.equal((await workstationHealth({ ...base, blender: () => true }))['3d-runtime'].ready, true)
  const missing = await workstationHealth({ ...base, blender: () => false })
  assert.equal(missing['3d-runtime'].ready, false); assert.equal(missing['3d-runtime'].reason, 'BLENDER_NOT_INSTALLED')
})

test('Android app building readiness follows the installed SDK (R-080)', async () => {
  const base = { officePack: () => null, browserBridge: () => null, gateway: () => null, windowsInstalled: () => false, webAvailable: () => false, mediaServices: () => [], mcpTools: () => [] }
  assert.equal((await workstationHealth({ ...base, android: () => true }))['mobile-toolchain'].ready, true)
  assert.equal((await workstationHealth({ ...base, android: () => false }))['mobile-toolchain'].reason, 'ANDROID_SDK_NOT_FOUND')
})
