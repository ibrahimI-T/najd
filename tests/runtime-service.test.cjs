const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os')
const { generateKeyPairSync, sign, createHash } = require('node:crypto')
const { zipSync, strToU8 } = require('fflate')
const { createRuntimeService } = require('../electron/runtime-service.cjs')
const { checkComponent } = require('../electron/runtime-health.cjs')

const keys = generateKeyPairSync('ed25519')
const updateConfig = { publicKey: keys.publicKey.export({ type: 'spki', format: 'pem' }), owner: 'ibrahimI-T', repo: 'najd-agent-releases' }
const runtimeConfig = { catalogVersion: '0.1.0', channel: 'main', components: ['agent-core'] }
const bytes = zipSync({ 'hermes-agent/run_agent.py': strToU8('# fixture'), 'najd-core.json': strToU8('{}') })
const row = { id: 'agent-core', version: '1.0.0', sourceRevision: null, entry: 'hermes-agent/run_agent.py', dependencies: [],
  file: { name: 'NAJD-Runtime-agent-core-1.0.0-win32-x64.zip', size: bytes.length, sha512: createHash('sha512').update(bytes).digest('base64') } }
const payload = Buffer.from(JSON.stringify({ format: 'najd-runtime-v1', channel: 'main', platform: 'win32-x64', version: '0.1.0', minAppVersion: '0.7.1', components: [row] }))
const catalog = JSON.stringify({ payload: payload.toString('base64'), signature: sign(null, payload, keys.privateKey).toString('base64') })
async function rootFor(t) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'najd-runtime-service-'))
  t.after(() => fs.rm(base, { recursive: true, force: true }))
  return path.join(base, 'runtimes')
}
const settle = async service => { for (let n = 0; n < 400; n++) { const s = await service.status(); if (!['validating', 'downloading', 'verifying', 'preparing', 'checking', 'activating'].includes(s.state)) return s; await new Promise(r => setTimeout(r, 10)) } throw Error('timeout') }

test('fixed catalog URL on the public binary channel; unpublished catalog is reported, not hidden', async t => {
  const urls = []
  const service = createRuntimeService({ root: await rootFor(t), updateConfig, runtimeConfig, appVersion: '0.8.0', canActivate: async () => true,
    fetchImpl: async url => { urls.push(String(url)); return new Response('missing', { status: 404 }) } })
  service.prepare()
  const status = await settle(service)
  assert.equal(urls[0], 'https://github.com/ibrahimI-T/najd-agent-releases/releases/download/runtime-v0.1.0/najd-runtime.json')
  assert.equal(status.state, 'failed'); assert.equal(status.notPublished, true); assert.equal(status.active, null)
})

test('runtime packs follow runtimeRepo when app releases move to another repository', async t => {
  const urls = []
  const service = createRuntimeService({ root: await rootFor(t), updateConfig: { ...updateConfig, repo: 'najd', runtimeRepo: 'najd-agent-releases' }, runtimeConfig, appVersion: '0.8.0', canActivate: async () => true,
    fetchImpl: async url => { urls.push(String(url)); return new Response('missing', { status: 404 }) } })
  service.prepare()
  await settle(service)
  assert.equal(urls[0], 'https://github.com/ibrahimI-T/najd-agent-releases/releases/download/runtime-v0.1.0/najd-runtime.json')
  assert.equal(require('../electron/update-config.json').runtimeRepo, 'najd-agent-releases')
})

test('signed catalog activates after the health probe; busy work blocks activation without losing the previous state', async t => {
  const root = await rootFor(t)
  let idle = false, probes = 0
  const service = createRuntimeService({ root, updateConfig, runtimeConfig, appVersion: '0.8.0', canActivate: async () => idle,
    getManifest: async () => catalog, fetchImpl: async () => new Response(bytes),
    health: async ({ component, directory }) => { probes++; return component.id === 'agent-core' && path.isAbsolute(directory) } })
  service.prepare()
  let status = await settle(service)
  assert.equal(status.state, 'failed'); assert.equal(status.error, 'SETUP_ACTIVATION_BUSY'); assert.equal(status.active, null)
  idle = true
  service.prepare()
  status = await settle(service)
  assert.equal(status.state, 'ready'); assert.deepEqual(status.active.components, ['agent-core'])
  const dirs = await service.directories()
  assert.ok(dirs['agent-core'].startsWith(path.join(root, 'generations')))
  await fs.access(path.join(dirs['agent-core'], 'hermes-agent', 'run_agent.py'))
  assert.equal(probes, 2)
})

test('health probes pick fixed commands per component and never pass unknown components', async () => {
  const calls = []
  const runner = async (exe, args) => { calls.push([path.basename(exe), args[0]]); return { code: 0, output: exe.endsWith('node.exe') ? 'v24.21.0' : '3.14.7' } }
  assert.equal(await checkComponent({ component: { id: 'node', version: '24.21.0' }, directory: 'C:/r/node', runner }), true)
  assert.equal(await checkComponent({ component: { id: 'node', version: '24.22.0' }, directory: 'C:/r/node', runner }), false)
  assert.equal(await checkComponent({ component: { id: 'python', version: '3.14.7' }, directory: 'C:/r/python', runner }), true)
  assert.equal(await checkComponent({ component: { id: 'openclaw', version: '1.0.0' }, directory: 'C:/r/x', runner }), false)
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'najd-health-'))
  await fs.writeFile(path.join(dir, 'najd-core.json'), JSON.stringify({ format: 'najd-agent-core-v1', sourceRevision: 'c70332f88886932337619a1e57029bd885c28b9d', python: '../outside/python.exe' }))
  assert.equal(await checkComponent({ component: { id: 'agent-core', version: '1.0.0' }, directory: dir, runner }), false, 'interpreter outside payload')
  await fs.rm(dir, { recursive: true, force: true })
  assert.deepEqual(calls.map(c => c[0]), ['node.exe', 'node.exe', 'python.exe'])
})

test('actual sealed core passes the fixed health probe when the publisher payload is present', { skip: !require('node:fs').existsSync(path.join(__dirname, '../.runtimes/runtime-packs/agent-core-004/najd-core.json')) }, async () => {
  const ok = await checkComponent({ component: { id: 'agent-core', version: '1.0.0' }, directory: path.join(__dirname, '../.runtimes/runtime-packs/agent-core-004') })
  assert.equal(ok, true)
})
