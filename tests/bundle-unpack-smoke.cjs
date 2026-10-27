// Real archives from the installer bundle: first-run unpack with progress into a fresh
// store, then the engine, gateway and desktop host start from the unpacked folders.
//   node tests/bundle-unpack-smoke.cjs build/bundle/najd-runtime-packed
const assert = require('node:assert/strict')
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os')
const { createBundleRuntime } = require('../electron/bundle-runtime.cjs')
const { createOpenClawGateway } = require('../electron/openclaw-gateway.cjs')
const { createWindowsNode } = require('../electron/windows-node.cjs')
const { checkComponent } = require('../electron/runtime-health.cjs')
async function main() {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'najd-unpack-'))
  const runtime = createBundleRuntime({ source: path.resolve(process.argv[2]), target: path.join(base, 'runtime') })
  let gateway, desktop
  try {
    const started = Date.now(), seen = new Set()
    const timer = setInterval(() => { const s = runtime.status(); seen.add(s.component); process.stdout.write(`\r${s.component || ''} ${Math.round(s.done / s.total * 100)}%   `) }, 1000)
    await runtime.prepare().finally(() => clearInterval(timer))
    const seconds = Math.round((Date.now() - started) / 1000)
    assert.equal(runtime.status().state, 'ready'); assert.ok(seen.size > 1, 'progress reported per component')
    const dir = id => runtime.readyDirectory(id)
    assert.equal(await checkComponent({ component: { id: 'agent-core', version: '1.0.0' }, directory: dir('engine') }), true)
    gateway = createOpenClawGateway({ runtimeRoot: path.join(base, 'unused'), stateRoot: path.join(base, 'gw'),
      layout: { nodeRoot: dir('node'), node: path.join(dir('node'), 'najd-gateway.exe'), container: dir('gateway') } })
    await gateway.start()
    assert.ok(['healthy', 'degraded'].includes(gateway.status().state))
    desktop = createWindowsNode({ runtimeRoot: path.join(base, 'unused'), stateRoot: path.join(base, 'desk'),
      layout: { dotnetRoot: dir('dotnet'), entry: path.join(dir('desktop-host'), 'Najd.WindowsNode.dll') } })
    assert.equal((await desktop.discoverApps()).length, 5)
    const again = Date.now(); createBundleRuntime({ source: path.resolve(process.argv[2]), target: path.join(base, 'runtime') }).isReady()
    console.log(`\nPASS: unpacked ${runtime.status().total} files in ${seconds}s with per-component progress; engine healthy, gateway ${gateway.status().state}, desktop host OK; restart reuse check ${Date.now() - again} ms.`)
  } finally {
    await desktop?.stop().catch(() => {}); await gateway?.stop().catch(() => {})
    await fs.rm(base, { recursive: true, force: true }).catch(() => {})
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
