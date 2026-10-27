// Installed-layout proof: the gateway, desktop host and engine start from the NAJD bundle
// (build/bundle/najd-runtime or an installed resources/najd-runtime) using NAJD's own
// adapters, with temporary state and no developer .runtimes paths.
//   node tests/bundle-smoke.cjs build/bundle/najd-runtime
const assert = require('node:assert/strict')
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os')
const { createOpenClawGateway } = require('../electron/openclaw-gateway.cjs')
const { createWindowsNode } = require('../electron/windows-node.cjs')
const { checkComponent } = require('../electron/runtime-health.cjs')

async function main() {
  const bundle = path.resolve(process.argv[2])
  const info = JSON.parse(await fs.readFile(path.join(bundle, 'bundle.json'), 'utf8'))
  assert.equal(info.format, 'najd-runtime-bundle-v1')
  const unused = path.join(os.tmpdir(), 'najd-no-dev-runtimes-' + process.pid) // must never be read
  const state = await fs.mkdtemp(path.join(os.tmpdir(), 'najd-bundle-smoke-'))
  const gateway = createOpenClawGateway({ runtimeRoot: unused, stateRoot: path.join(state, 'gateway'),
    layout: { nodeRoot: path.join(bundle, 'node'), node: path.join(bundle, 'node/najd-gateway.exe'), container: path.join(bundle, 'gateway') } })
  const desktop = createWindowsNode({ runtimeRoot: unused, stateRoot: path.join(state, 'desktop'),
    layout: { dotnetRoot: path.join(bundle, 'dotnet'), entry: path.join(bundle, 'desktop-host/Najd.WindowsNode.dll') } })
  try {
    assert.equal(await checkComponent({ component: { id: 'agent-core', version: '1.0.0' }, directory: path.join(bundle, 'engine') }), true, 'engine health')
    await gateway.start()
    const status = gateway.status()
    assert.ok(['healthy', 'degraded'].includes(status.state), JSON.stringify(status))
    const apps = await desktop.discoverApps()
    assert.ok(Array.isArray(apps) && apps.length === 5, JSON.stringify(apps))
    console.log(`PASS: bundled engine healthy, gateway ${status.state} from najd-gateway.exe, desktop host discovered ${apps.length} app locations; no developer runtime paths.`)
  } finally {
    await desktop.stop().catch(() => {}); await gateway.stop().catch(() => {})
    await fs.rm(state, { recursive: true, force: true }).catch(() => {})
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
