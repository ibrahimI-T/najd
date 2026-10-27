// Recipient-style acceptance for a packaged runtime archive, using a throwaway
// signing key: the app's own setup service authenticates the catalog, streams the
// real archive, extracts it into a fresh temporary store, runs the fixed health
// probe on the extracted payload-owned Python, and activates it.
//   node tests/runtime-pack-acceptance.cjs .runtimes/runtime-release-0.1.0
const assert = require('node:assert/strict')
const fs = require('node:fs'), fsp = require('node:fs/promises'), path = require('node:path'), os = require('node:os')
const { generateKeyPairSync, sign } = require('node:crypto')
const { Readable } = require('node:stream')
const { createRuntimeService } = require('../electron/runtime-service.cjs')

async function main() {
  const directory = path.resolve(process.argv[2])
  const row = JSON.parse(await fsp.readFile(path.join(directory, 'component.json'), 'utf8'))
  const keys = generateKeyPairSync('ed25519')
  const bytes = Buffer.from(JSON.stringify({ format: 'najd-runtime-v1', channel: 'main', platform: 'win32-x64', version: '0.1.0', minAppVersion: '0.7.1', components: [row] }))
  const catalog = JSON.stringify({ payload: bytes.toString('base64'), signature: sign(null, bytes, keys.privateKey).toString('base64') })
  const base = await fsp.mkdtemp(path.join(os.tmpdir(), 'najd-runtime-acceptance-'))
  let downloads = 0
  try {
    const service = createRuntimeService({ root: path.join(base, 'runtimes'), appVersion: '0.8.0', canActivate: async () => true,
      updateConfig: { publicKey: keys.publicKey.export({ type: 'spki', format: 'pem' }), owner: 'ibrahimI-T', repo: 'najd-agent-releases' },
      runtimeConfig: { catalogVersion: '0.1.0', channel: 'main', components: [row.id] }, getManifest: async () => catalog,
      fetchImpl: async url => { downloads++; assert.match(String(url), /releases\/download\/runtime-v0\.1\.0\//)
        return new Response(Readable.toWeb(fs.createReadStream(path.join(directory, row.file.name))), { headers: { 'content-length': String(row.file.size) } }) } })
    const started = Date.now()
    service.prepare()
    let status
    for (;;) {
      status = await service.status()
      if (!['validating', 'downloading', 'verifying', 'preparing', 'checking', 'activating'].includes(status.state)) break
      await new Promise(r => setTimeout(r, 500))
    }
    assert.equal(status.state, 'ready', status.error)
    const dirs = await service.directories()
    assert.ok(dirs[row.id].startsWith(base))
    assert.ok(fs.existsSync(path.join(dirs[row.id], 'NAJD-NOTICES', 'uv-LICENSE-MIT.txt')))
    assert.equal(downloads, 1)
    console.log(`PASS: signed catalog, ${row.file.size}-byte archive streamed, extracted, payload-owned health probe passed and activated in ${Math.round((Date.now() - started) / 1000)}s in a fresh store.`)
  } finally { await fsp.rm(base, { recursive: true, force: true }) }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
