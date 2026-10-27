const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { createOpenClawGateway } = require('../electron/openclaw-gateway.cjs')
const pins = require('../electron/runtime-pins.json')

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'najd-gateway-test-'))
  t.after(async () => {
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unsafe cleanup path')
    await fs.rm(root, { recursive: true, force: true })
  })
  return { root, runtimeRoot: path.join(root, 'runtimes'), stateRoot: path.join(root, 'state') }
}

test('missing runtime reports not installed without exposing paths or tokens', async t => {
  const options = await fixture(t)
  const gateway = createOpenClawGateway(options)
  await assert.rejects(gateway.start(), { code: 'NOT_INSTALLED' })
  assert.equal(gateway.status().state, 'not_installed')
  assert.equal(gateway.status().verifiedAt, null)
  assert.deepEqual(Object.keys(gateway.status()).sort(), ['engine', 'errorCode', 'instanceId', 'state', 'verifiedAt', 'version'])
  assert.ok(!JSON.stringify(gateway.status()).includes(options.root))
  await gateway.stop()
  assert.equal(gateway.status().state, 'stopped')
})

test('invalid pinned metadata fails closed and preserves the existing runtime', async t => {
  const options = await fixture(t)
  const nodeRoot = path.join(options.runtimeRoot, `node-v${pins.node.version}-win-x64`)
  const packageRoot = path.join(options.runtimeRoot, `openclaw-runtime-${pins.openclaw.version}`)
  await fs.mkdir(path.join(packageRoot, 'node_modules/openclaw'), { recursive: true })
  await fs.mkdir(nodeRoot, { recursive: true })
  await fs.writeFile(path.join(nodeRoot, 'node.exe'), 'untrusted runtime fixture')
  await fs.writeFile(path.join(nodeRoot, 'najd-runtime.json'), JSON.stringify({ version: 'wrong' }))
  await fs.writeFile(path.join(packageRoot, 'package-lock.json'), '{}')
  await fs.writeFile(path.join(packageRoot, 'node_modules/openclaw/package.json'), '{}')
  const gateway = createOpenClawGateway(options)
  await assert.rejects(gateway.start(), { code: 'INCOMPATIBLE_RUNTIME' })
  assert.equal(gateway.status().state, 'failed')
  assert.equal(await fs.readFile(path.join(nodeRoot, 'node.exe'), 'utf8'), 'untrusted runtime fixture')
})
