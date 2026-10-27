// A gateway that is still starting never holds up NAJD's own host tools (owner live test 2026-10-25: a first Python run waited
// 80 s for it). Real host, isolated state; the gateway link is a stub that says "still starting", then refuses.
const assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const { createWindowsNode } = require('../electron/windows-node.cjs')

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'najd-host-gateway-'))
  const calls = []
  const node = createWindowsNode({ runtimeRoot: path.resolve(__dirname, '../.runtimes'), stateRoot: path.join(root, 'state'),
    nodeConnection: async () => { calls.push(Date.now()); throw Object.assign(new Error('GATEWAY_STARTING'), { code: 'GATEWAY_STARTING' }) } })
  try {
    const started = Date.now()
    const apps = await node.discoverApps()
    const seconds = (Date.now() - started) / 1000
    assert.ok(Array.isArray(apps) && apps.length === 5, 'the host answers')
    assert.equal(calls.length, 1, 'the gateway was asked once')
    assert.ok(seconds < 20, `the host was ready in ${seconds.toFixed(1)} s without waiting for the gateway`)
    await node.stop()
    await node.discoverApps()
    assert.equal(calls.length, 2, 'the next host start tries the gateway again')
    console.log(`PASS: host ready in ${seconds.toFixed(1)} s while the gateway was starting; the next start asked the gateway again.`)
  } finally {
    await node.stop().catch(() => {})
    fs.rmSync(root, { recursive: true, force: true })
  }
}
main().catch(failure => { console.error(failure); process.exit(1) })
