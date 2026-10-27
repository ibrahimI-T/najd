const assert = require('node:assert/strict')
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os')
const { generateKeyPairSync, createHash, sign } = require('node:crypto')
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const { zipSync } = require('fflate')
const { createRuntimeSetup } = require('../electron/runtime-setup.cjs')
async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'najd-runtime-setup-'))
  try {
    const pins = require('../electron/runtime-pins.json'), source = path.resolve(`.runtimes/node-v${pins.node.version}-win-x64`)
    const original = JSON.parse(await fs.readFile(path.join(source, 'najd-runtime.json'), 'utf8'))
    const node = await fs.readFile(path.join(source, 'node.exe'))
    assert.equal(original.archiveSha256, pins.node.archiveSha256)
    assert.equal(createHash('sha256').update(node).digest('hex'), original.executableSha256)
    // Genuine pinned binary, synthetic signed transport. No publisher key or public runtime pack.
    const bytes = zipSync({ 'node.exe': node, 'LICENSE': await fs.readFile(path.join(source, 'LICENSE')) }, { level: 1 })
    const keys = generateKeyPairSync('ed25519')
    const record = { format: 'najd-runtime-v1', channel: 'main', platform: 'win32-x64', version: '0.1.0', minAppVersion: '0.8.0', components: [{
      id: 'node', version: pins.node.version, sourceRevision: null, entry: 'node.exe', dependencies: [],
      file: { name: `NAJD-Runtime-node-${pins.node.version}-win32-x64.zip`, size: bytes.length, sha512: createHash('sha512').update(bytes).digest('base64') }
    }] }
    const payload = Buffer.from(JSON.stringify(record)), raw = JSON.stringify({ payload: payload.toString('base64'), signature: sign(null, payload, keys.privateKey).toString('base64') })
    let downloads = 0, checks = 0
    const setup = createRuntimeSetup({ root: path.join(root, 'store'), config: { publicKey: keys.publicKey, channel: 'main', appVersion: '0.8.0', catalogVersion: '0.1.0', owner: 'ibrahimI-T', repo: 'najd-agent-releases' },
      getManifest: async () => raw, fetchImpl: async () => { downloads++; return new Response(bytes) },
      health: async ({ directory, component, signal }) => {
        checks++
        const result = await promisify(execFile)(path.join(directory, component.entry), ['--version'], { windowsHide: true, signal, timeout: 10000, maxBuffer: 65536,
          env: { SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR, PATH: path.join(process.env.SystemRoot, 'System32'), TEMP: root, TMP: root } })
        return result.stdout.trim() === 'v' + pins.node.version
      }, canActivate: async () => true })
    const result = await setup.prepare(['node'])
    assert.equal(setup.status().state, 'ready')
    assert.ok(result.directories.node.startsWith(path.join(root, 'store', 'generations') + path.sep))
    await setup.prepare(['node'])
    assert.equal(downloads, 1); assert.equal(checks, 2)
    console.log(`PASS: genuine Node ${pins.node.version} (${node.length} executable bytes, ${bytes.length} archive bytes) verified, extracted, actually launched in an isolated generation, activated and revalidated without redownload. Fixture signing/transport; no public pack or clean-Windows claim.`)
  } finally {
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(root).startsWith('najd-runtime-setup-')) throw Error('Unsafe cleanup')
    await fs.rm(root, { recursive: true, force: true })
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
