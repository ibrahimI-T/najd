// Publisher-only: assemble every runtime NAJD needs into build/bundle/najd-runtime so the
// installer ships them and nothing separate is downloaded or installed after setup.
// Components keep their original license/notice files; folder and process names are NAJD's.
//   node scripts/stage-bundle.cjs --engine .runtimes/runtime-packs/agent-core-004
const fs = require('node:fs'), fsp = require('node:fs/promises'), path = require('node:path')
const pins = require('../electron/runtime-pins.json')
const { writeZip, walk } = require('./zip-writer.cjs')

const ROOT = path.resolve(__dirname, '..'), RUNTIMES = path.join(ROOT, '.runtimes')
const OUT = path.join(ROOT, 'build/bundle/najd-runtime')
// The installer ships a few archives (fast install); NAJD unpacks them on first run with progress.
const PACKED = path.join(ROOT, 'build/bundle/najd-runtime-packed')
const entries = { engine: 'najd-core.json', gateway: 'node_modules/openclaw/openclaw.mjs', node: 'najd-gateway.exe', dotnet: 'dotnet.exe', 'desktop-host': 'Najd.WindowsNode.dll' }

function arg(name) {
  const index = process.argv.indexOf('--' + name)
  if (index < 0 || !process.argv[index + 1]) throw Error('Missing --' + name)
  const value = path.resolve(ROOT, process.argv[index + 1])
  if (!value.startsWith(RUNTIMES + path.sep)) throw Error('Inputs must be staged beneath .runtimes')
  return value
}

async function copyTree(source, target, { skip = () => false, rename = name => name } = {}) {
  await fsp.mkdir(target, { recursive: true })
  let count = 0
  for (const entry of await fsp.readdir(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name), relative = path.relative(ROOT, from)
    if (entry.isSymbolicLink()) throw Error('Links are not bundled: ' + relative)
    if (skip(entry, from)) continue
    const to = path.join(target, rename(entry.name, from))
    if (entry.isDirectory()) count += await copyTree(from, to, { skip, rename })
    else if (entry.isFile()) { await fsp.copyFile(from, to); count++ }
  }
  return count
}

async function main() {
  const engineSource = arg('engine')
  if (fs.existsSync(OUT)) await fsp.rm(OUT, { recursive: true })
  await fsp.mkdir(OUT, { recursive: true })
  const report = {}

  // Node: only the executable, its license and the provisioning record are needed.
  const nodeSource = path.join(RUNTIMES, `node-v${pins.node.version}-win-x64`)
  await fsp.mkdir(path.join(OUT, 'node'))
  await fsp.copyFile(path.join(nodeSource, 'node.exe'), path.join(OUT, 'node/najd-gateway.exe'))
  for (const name of ['LICENSE', 'najd-runtime.json']) await fsp.copyFile(path.join(nodeSource, name), path.join(OUT, 'node', name))
  report.node = 3

  // Gateway: the pinned dependency container exactly as provisioned.
  report.gateway = await copyTree(path.join(RUNTIMES, `openclaw-runtime-${pins.openclaw.version}`), path.join(OUT, 'gateway'))

  // .NET: the shared runtime the desktop host targets, not the SDK.
  const sdk = path.join(RUNTIMES, 'dotnet-sdk-10.0.400')
  await fsp.mkdir(path.join(OUT, 'dotnet/shared'), { recursive: true })
  for (const name of ['dotnet.exe', 'LICENSE.txt', 'ThirdPartyNotices.txt']) await fsp.copyFile(path.join(sdk, name), path.join(OUT, 'dotnet', name))
  report.dotnet = 3 + await copyTree(path.join(sdk, 'host'), path.join(OUT, 'dotnet/host')) +
    await copyTree(path.join(sdk, 'shared/Microsoft.NETCore.App'), path.join(OUT, 'dotnet/shared/Microsoft.NETCore.App'))

  // Desktop host: Windows x64 natives only, no debug symbols.
  report.desktopHost = await copyTree(path.join(RUNTIMES, 'windows-node-host'), path.join(OUT, 'desktop-host'), {
    skip: (entry, from) => entry.name.endsWith('.pdb') || entry.name === 'ggml-metal.metal' ||
      path.basename(path.dirname(from)) === 'runtimes' && entry.isDirectory() && entry.name !== 'win-x64' })

  // Engine: sealed core with NAJD folder/process names. Upstream launchers and debug
  // symbols are not used; original source, licenses and notices remain in place.
  const engine = path.join(OUT, 'engine')
  const receipt = JSON.parse(await fsp.readFile(path.join(engineSource, 'najd-core.json'), 'utf8'))
  report.engine = await copyTree(engineSource, engine, {
    skip: (entry, from) => entry.name.endsWith('.pdb') || path.dirname(from) === engineSource && entry.name === 'bin',
    rename: (name, from) => path.dirname(from) === engineSource && name === 'hermes-agent' ? 'core' : name })
  const python = path.join(engine, receipt.python)
  const branded = path.join(path.dirname(python), 'najd-engine.exe')
  await fsp.rename(python, branded)
  await fsp.rm(path.join(path.dirname(python), 'pythonw.exe'), { force: true })
  receipt.python = path.relative(engine, branded).split(path.sep).join('/')
  receipt.source = 'core'
  await fsp.writeFile(path.join(engine, 'najd-core.json'), JSON.stringify(receipt, null, 2) + '\n')
  // The upstream payload manifest locates the source tree and interpreter; keep it consistent.
  const manifest = JSON.parse(await fsp.readFile(path.join(engine, 'manifest.json'), 'utf8'))
  manifest.repo = 'core'; manifest.launchers = []
  manifest.runtime = { ...manifest.runtime, repoDir: 'core', storePython: receipt.python, commands: {} }
  await fsp.writeFile(path.join(engine, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')

  await fsp.writeFile(path.join(OUT, 'bundle.json'), JSON.stringify({ format: 'najd-runtime-bundle-v1', node: pins.node.version,
    gateway: pins.openclaw.version, engineRevision: receipt.sourceRevision, files: report }, null, 2) + '\n')
  if (fs.existsSync(PACKED)) await fsp.rm(PACKED, { recursive: true })
  await fsp.mkdir(PACKED, { recursive: true })
  const components = []
  for (const [id, entry] of Object.entries(entries)) {
    const file = id + '.zip'
    const result = await writeZip(path.join(PACKED, file), walk(path.join(OUT, id)))
    components.push({ id, file, entry, ...result })
    console.log('Packed', id, result.files, 'files', result.size, 'bytes')
  }
  await fsp.writeFile(path.join(PACKED, 'bundle.json'), JSON.stringify({ format: 'najd-runtime-bundle-v2', node: pins.node.version,
    gateway: pins.openclaw.version, engineRevision: receipt.sourceRevision, components }, null, 2) + '\n')
  console.log('Bundled NAJD runtime:', JSON.stringify(report))
}
main().catch(error => { console.error('Bundle staging failed:', error.message); process.exitCode = 1 })
