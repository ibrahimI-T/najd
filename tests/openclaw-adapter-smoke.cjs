const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const processes = require('node:child_process')
const originalSpawn = processes.spawn
let ownedChild
processes.spawn = (...args) => {
  const child = originalSpawn(...args)
  if (args[1]?.[0]?.endsWith('openclaw-launcher.cjs')) ownedChild = child
  return child
}
const { createOpenClawGateway } = require('../electron/openclaw-gateway.cjs')
processes.spawn = originalSpawn

async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'najd-gateway-adapter-'))
  const gateway = createOpenClawGateway({ runtimeRoot: path.resolve(__dirname, '../.runtimes'), stateRoot: root })
  try {
    const first = gateway.start()
    assert.equal(gateway.start(), first)
    await first
    assert.equal(gateway.status().state, 'healthy')
    assert.ok(gateway.status().verifiedAt)
    assert.equal((await gateway.health()).state, 'healthy')
    const config = JSON.parse(await fs.readFile(path.join(root, 'najd-openclaw.json'), 'utf8'))
    assert.equal(config.gateway.bind, 'loopback')
    assert.deepEqual(config.tools.deny, ['*'])
    assert.ok(!JSON.stringify(config).includes('token":"'))
    const crashed = new Promise(resolve => ownedChild.once('close', resolve))
    ownedChild.kill('SIGKILL')
    await crashed
    assert.equal(gateway.status().state, 'failed')
    await gateway.start()
    assert.equal(gateway.status().state, 'healthy')
    const restartedConfig = JSON.parse(await fs.readFile(path.join(root, 'najd-openclaw.json'), 'utf8'))
    const stopped = gateway.stop()
    assert.equal(gateway.stop(), stopped)
    await stopped
    assert.equal(gateway.status().state, 'stopped')
    await assert.rejects(fetch(`http://127.0.0.1:${restartedConfig.gateway.port}/healthz`))
    const cancelled = assert.rejects(gateway.start(), { code: 'CANCELLED' })
    await gateway.stop()
    await cancelled
    assert.equal(gateway.status().state, 'stopped')
    console.log('Real adapter authentication, scoped config, crash/restart, startup cancellation, IPC shutdown and listener closure passed.')
  } finally {
    await gateway.stop()
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unsafe adapter cleanup path')
    await fs.rm(root, { recursive: true, force: true })
  }
}
main().catch(error => { console.error(error.code || error.message); process.exitCode = 1 })
