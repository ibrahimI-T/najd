const { test } = require('node:test')
const assert = require('node:assert/strict')
const { generateKeyPairSync, sign, createHash } = require('node:crypto')
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os')
const { verifyRuntimeManifest, planRuntimeComponents, runtimeAssetUrl, verifyRuntimeArchive } = require('../electron/runtime-manifest.cjs')
const pair = generateKeyPairSync('ed25519')
const config = { publicKey: pair.publicKey, channel: 'main', appVersion: '0.8.0', catalogVersion: '0.1.0', owner: 'ibrahimI-T', repo: 'najd-agent-releases' }
const component = (id, entry, dependencies = []) => ({ id, version: '1.0.0', sourceRevision: null, entry, dependencies,
  file: { name: `NAJD-Runtime-${id}-1.0.0-win32-x64.zip`, size: 100, sha512: Buffer.alloc(64, 3).toString('base64') } })
const record = () => ({ format: 'najd-runtime-v1', channel: 'main', platform: 'win32-x64', version: '0.1.0', minAppVersion: '0.8.0',
  components: [component('hermes', 'run_agent.py', ['python', 'uv']), component('python', 'python.exe'), component('uv', 'uv.exe')] })
const envelope = value => { const bytes = Buffer.from(JSON.stringify(value)); return JSON.stringify({ payload: bytes.toString('base64'), signature: sign(null, bytes, pair.privateKey).toString('base64') }) }

test('sealed agent core carries its own interpreter without weakening legacy dependencies', () => {
  const value = record()
  value.components = [component('agent-core', 'hermes-agent/run_agent.py')]
  const manifest = verifyRuntimeManifest(envelope(value), config)
  assert.deepEqual(planRuntimeComponents(manifest, ['agent-core']).map(row => row.id), ['agent-core'])
  value.components[0].entry = 'bin/hermes.exe'
  assert.throws(() => verifyRuntimeManifest(envelope(value), config), { code: 'RUNTIME_MANIFEST_INVALID' })
  const legacy = record(); legacy.components[0].dependencies = []
  assert.throws(() => verifyRuntimeManifest(envelope(legacy), config), { code: 'RUNTIME_MANIFEST_INVALID' })
})

test('runtime pack catalog authenticates domain and pins, plans prerequisites before dependants', () => {
  const manifest = verifyRuntimeManifest(envelope(record()), config)
  assert.deepEqual(planRuntimeComponents(manifest, ['hermes']).map(row => row.id), ['python', 'uv', 'hermes'])
  assert.equal(runtimeAssetUrl(manifest, manifest.components[0], config), 'https://github.com/ibrahimI-T/najd-agent-releases/releases/download/runtime-v0.1.0/NAJD-Runtime-hermes-1.0.0-win32-x64.zip')
  assert.throws(() => planRuntimeComponents(manifest, ['openclaw']), { code: 'RUNTIME_COMPONENT_MISSING' })
  assert.throws(() => verifyRuntimeManifest(envelope(record()), { ...config, appVersion: '0.7.1' }), { code: 'INCOMPATIBLE_RUNTIME' })
})
test('wrong key, altered payload, app-update domain and unreviewed execution fields are rejected', () => {
  assert.throws(() => verifyRuntimeManifest(envelope(record()), { ...config, publicKey: generateKeyPairSync('ed25519').publicKey }), { code: 'RUNTIME_SIGNATURE_INVALID' })
  const changed = JSON.parse(envelope(record())); changed.payload = Buffer.from('{}').toString('base64')
  assert.throws(() => verifyRuntimeManifest(JSON.stringify(changed), config), { code: 'RUNTIME_SIGNATURE_INVALID' })
  for (const mutate of [m => { m.format = 'najd-update-v1' }, m => { m.version = '0.0.1' }, m => { m.components[0].command = 'install from live branch' },
    m => { m.components[0].entry = '../../private.exe' }, m => { m.components[0].file.name = '../escape.zip' },
    m => { m.components[0].file.size = 3 * 1024 ** 3 }, m => { m.components.push(m.components[0]) },
    m => { m.components[0].dependencies = ['unknown'] }, m => { m.components[0].dependencies = ['hermes'] },
    m => { m.components[0].dependencies = [] }]) {
    const value = record(); mutate(value)
    assert.throws(() => verifyRuntimeManifest(envelope(value), config), { code: 'RUNTIME_MANIFEST_INVALID' })
  }
})

test('runtime archive is fully hashed and changed bytes cannot enter preparation', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'najd-runtime-pack-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const filename = path.join(root, 'fixture.zip'), bytes = Buffer.from('owned runtime archive fixture')
  await fs.writeFile(filename, bytes)
  const item = component('python', 'python.exe')
  item.file.size = bytes.length; item.file.sha512 = createHash('sha512').update(bytes).digest('base64')
  await verifyRuntimeArchive(filename, item)
  await fs.writeFile(filename, Buffer.alloc(bytes.length, 1))
  await assert.rejects(verifyRuntimeArchive(filename, item), { code: 'RUNTIME_SIGNATURE_INVALID' })
})
