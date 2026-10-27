const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os')
const { generateKeyPairSync, sign, createHash } = require('node:crypto')
const { zipSync, strToU8 } = require('fflate')
const { spawn } = require('node:child_process')
const { createRuntimeSetup } = require('../electron/runtime-setup.cjs')
const keys = generateKeyPairSync('ed25519')
const config = { publicKey: keys.publicKey, channel: 'main', appVersion: '0.8.0', catalogVersion: '0.1.0', owner: 'ibrahimI-T', repo: 'najd-agent-releases' }
const hash = bytes => createHash('sha512').update(bytes).digest('base64')
function fixturePack(id, content = 'owned fixture', entry = `${id}.exe`) {
  const bytes = zipSync({ [entry]: strToU8(content), 'LICENSE.txt': strToU8('Owned test fixture license') })
  return { bytes, row: { id, version: '1.0.0', sourceRevision: null, entry, dependencies: [],
    file: { name: `NAJD-Runtime-${id}-1.0.0-win32-x64.zip`, size: bytes.length, sha512: hash(bytes) } } }
}
function manifest(packs, version = '0.1.0') {
  const bytes = Buffer.from(JSON.stringify({ format: 'najd-runtime-v1', channel: 'main', platform: 'win32-x64', version, minAppVersion: '0.8.0', components: packs.map(pack => pack.row) }))
  return JSON.stringify({ payload: bytes.toString('base64'), signature: sign(null, bytes, keys.privateKey).toString('base64') })
}
async function rootFor(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'najd-runtime-setup-'))
  t.after(async () => {
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(root).startsWith('najd-runtime-setup-')) throw Error('Unsafe cleanup')
    await fs.rm(root, { recursive: true, force: true })
  })
  return root
}
const until = async predicate => { for (let n = 0; n < 200; n++) { if (await predicate()) return; await new Promise(r => setTimeout(r, 5)) }; throw Error('State did not settle') }

test('verified setup stages, checks health and atomically activates; restart validates files without another download', async t => {
  const root = await rootFor(t), pack = fixturePack('node'), catalog = manifest([pack])
  let downloads = 0, checks = 0
  const options = { root, config, getManifest: async () => catalog, fetchImpl: async url => {
    assert.match(url, /^https:\/\/github\.com\/ibrahimI-T\/najd-agent-releases\/releases\/download\/runtime-v0\.1\.0\//)
    downloads++; return new Response(pack.bytes)
  }, health: async ({ directory, component }) => { checks++; assert.equal(await fs.readFile(path.join(directory, component.entry), 'utf8'), 'owned fixture'); return true }, canActivate: async () => true }
  const setup = createRuntimeSetup(options)
  const first = setup.prepare(['node'])
  assert.equal(first, setup.prepare(['node']))
  const result = await first
  assert.equal(setup.status().state, 'ready')
  assert.equal(await fs.readFile(path.join(result.directories.node, 'node.exe'), 'utf8'), 'owned fixture')
  const active = await fs.readFile(path.join(root, 'active.json'), 'utf8')
  const restarted = createRuntimeSetup(options)
  assert.equal((await restarted.prepare(['node'])).generation, result.generation)
  assert.equal(downloads, 1); assert.equal(checks, 2)
  assert.equal(await fs.readFile(path.join(root, 'active.json'), 'utf8'), active)
  await fs.writeFile(path.join(result.directories.node, 'node.exe'), 'tampered')
  await assert.rejects(restarted.prepare(['node']), { code: 'RUNTIME_ARCHIVE_INVALID' })
  assert.equal(await fs.readFile(path.join(root, 'active.json'), 'utf8'), active)
})

test('bad archive hash and traversal never reach health or activate', async t => {
  for (const traversal of [false, true]) {
    const root = await rootFor(t), pack = fixturePack('node')
    if (traversal) { pack.bytes = zipSync({ '../escape.txt': strToU8('must not escape') }); pack.row.file.size = pack.bytes.length; pack.row.file.sha512 = hash(pack.bytes) }
    const setup = createRuntimeSetup({ root, config, getManifest: async () => manifest([pack]), fetchImpl: async () => new Response(traversal ? pack.bytes : Buffer.alloc(pack.bytes.length)),
      health: async () => assert.fail('Unverified archive must not execute'), canActivate: async () => true })
    await assert.rejects(setup.prepare(['node']), { code: traversal ? 'RUNTIME_ARCHIVE_INVALID' : 'RUNTIME_SIGNATURE_INVALID' })
    await assert.rejects(fs.access(path.join(root, 'active.json')), { code: 'ENOENT' })
    await assert.rejects(fs.access(path.join(root, 'escape.txt')), { code: 'ENOENT' })
  }
})

test('failed upgrade health and activation busy preserve the exact previous active generation', async t => {
  const root = await rootFor(t), pack = fixturePack('node')
  const base = { root, config, getManifest: async () => manifest([pack]), fetchImpl: async () => new Response(pack.bytes), health: async () => true, canActivate: async () => true }
  await createRuntimeSetup(base).prepare(['node'])
  const active = await fs.readFile(path.join(root, 'active.json'), 'utf8')
  const replacement = fixturePack('node', 'new owned version')
  for (const healthFailure of [true, false]) {
    const setup = createRuntimeSetup({ ...base, config: { ...config, catalogVersion: '0.2.0' }, getManifest: async () => manifest([replacement], '0.2.0'),
      fetchImpl: async () => new Response(replacement.bytes), health: async () => !healthFailure, canActivate: async () => false })
    await assert.rejects(setup.prepare(['node']), { code: healthFailure ? 'RUNTIME_HEALTH_FAILED' : 'SETUP_ACTIVATION_BUSY' })
    assert.equal(await fs.readFile(path.join(root, 'active.json'), 'utf8'), active)
  }
})

test('interrupted dependency download resumes from verified cache after restart', async t => {
  const root = await rootFor(t), packs = [fixturePack('node'), fixturePack('python')], counts = { node: 0, python: 0 }
  let interrupt = true
  const options = { root, config, getManifest: async () => manifest(packs), fetchImpl: async url => {
    const id = url.includes('Runtime-node-') ? 'node' : 'python'; counts[id]++
    if (id === 'python' && interrupt) throw Error('Owned network interruption')
    return new Response(packs.find(pack => pack.row.id === id).bytes)
  }, health: async () => true, canActivate: async () => true }
  await assert.rejects(createRuntimeSetup(options).prepare(['node', 'python']), { code: 'RUNTIME_DOWNLOAD_FAILED' })
  interrupt = false
  const resumed = createRuntimeSetup(options)
  await resumed.prepare(['node', 'python'])
  assert.deepEqual(counts, { node: 1, python: 2 })
  assert.equal(resumed.status().state, 'ready')
})

test('cancel interrupts download, another plan is busy, and corrupt/unowned stores are preserved', async t => {
  const root = await rootFor(t), pack = fixturePack('node')
  const setup = createRuntimeSetup({ root, config, getManifest: async () => manifest([pack]), fetchImpl: async (_url, options) => new Response(new ReadableStream({ start(controller) {
    options.signal.addEventListener('abort', () => controller.error(Error('Owned abort')), { once: true })
  } })), health: async () => assert.fail('Cancelled download must not execute'), canActivate: async () => true })
  const operation = setup.prepare(['node'])
  const rejected = assert.rejects(operation, { code: 'SETUP_CANCELLED' })
  await until(() => setup.status().state === 'downloading')
  await assert.rejects(setup.prepare(['python']), { code: 'SETUP_BUSY' })
  assert.equal(setup.cancel(), true)
  await rejected
  assert.equal(setup.status().state, 'cancelled')
  await fs.writeFile(path.join(root, 'active.json'), '{broken')
  await assert.rejects(setup.prepare(['node']), { code: 'SETUP_STORE_UNAVAILABLE' })
  assert.equal(await fs.readFile(path.join(root, 'active.json'), 'utf8'), '{broken')
  const unowned = await rootFor(t)
  await fs.writeFile(path.join(unowned, 'user-work.txt'), 'preserve')
  await assert.rejects(createRuntimeSetup({ root: unowned, config, getManifest: async () => manifest([pack]), health: async () => true, canActivate: async () => true }).prepare(['node']), { code: 'SETUP_STORE_UNAVAILABLE' })
  assert.equal(await fs.readFile(path.join(unowned, 'user-work.txt'), 'utf8'), 'preserve')
})

test('duplicate Windows names, device names and extra executable files fail closed', async t => {
  for (const name of ['NUL.txt', 'node.exe:stream', 'NODE.exe']) {
    const root = await rootFor(t), pack = fixturePack('node')
    pack.bytes = zipSync({ 'node.exe': strToU8('owned'), [name]: strToU8('invalid Windows entry') })
    pack.row.file.size = pack.bytes.length; pack.row.file.sha512 = hash(pack.bytes)
    const setup = createRuntimeSetup({ root, config, getManifest: async () => manifest([pack]), fetchImpl: async () => new Response(pack.bytes), health: async () => assert.fail('Invalid paths must not execute'), canActivate: async () => true })
    await assert.rejects(setup.prepare(['node']), { code: 'RUNTIME_ARCHIVE_INVALID' })
  }
  const root = await rootFor(t), pack = fixturePack('node')
  const setup = createRuntimeSetup({ root, config, getManifest: async () => manifest([pack]), fetchImpl: async () => new Response(pack.bytes), health: async () => true, canActivate: async () => true })
  const prepared = await setup.prepare(['node'])
  await fs.writeFile(path.join(prepared.directories.node, 'unexpected.dll'), 'not signed by the archive')
  await assert.rejects(setup.prepare(['node']), { code: 'RUNTIME_ARCHIVE_INVALID' })
})

test('actual process death after extraction never activates; next owner reuses cache and removes inert staging', async t => {
  const outer = await rootFor(t), pack = fixturePack('node'), catalog = manifest([pack]), root = path.join(outer, 'store')
  await fs.writeFile(path.join(outer, 'fixture.zip'), pack.bytes)
  await fs.writeFile(path.join(outer, 'input.json'), JSON.stringify({ config: { ...config, publicKey: keys.publicKey.export({ type: 'spki', format: 'pem' }) }, manifest: catalog }))
  const child = spawn(process.execPath, [path.join(__dirname, 'fixtures/runtime-setup-child.cjs'), outer], { windowsHide: true, stdio: 'ignore' })
  const exited = new Promise(resolve => child.once('exit', resolve))
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) { child.kill(); await exited } })
  await until(async () => fs.access(path.join(outer, 'health-started')).then(() => true, () => false))
  await assert.rejects(fs.access(path.join(root, 'active.json')), { code: 'ENOENT' })
  assert.equal(child.kill(), true)
  await exited
  const restarted = createRuntimeSetup({ root, config, getManifest: async () => catalog,
    fetchImpl: async () => assert.fail('Verified archive should survive process death'), health: async () => true, canActivate: async () => true })
  await restarted.prepare(['node'])
  assert.equal(restarted.status().state, 'ready')
  assert.equal((await fs.readdir(path.join(root, 'generations'))).some(name => name.startsWith('.stage-')), false)
})

test('terminal state is published only after staging cleanup; a retry then starts a fresh attempt exactly once', async t => {
  const root = await rootFor(t), pack = fixturePack('node')
  let idle = false, attempts = 0, releaseCleanup
  const held = new Promise(resolve => { releaseCleanup = resolve })
  let holdNext = true, cleanupStarted
  const cleanupBegan = new Promise(resolve => { cleanupStarted = resolve })
  const setup = createRuntimeSetup({ root, config, getManifest: async () => { attempts++; return manifest([pack]) },
    fetchImpl: async () => new Response(pack.bytes), health: async () => true, canActivate: async () => idle,
    removeTree: async target => {
      if (holdNext) { holdNext = false; cleanupStarted(); await held }
      await fs.rm(target, { recursive: true, force: true })
    } })
  const first = setup.prepare(['node'])
  const firstOutcome = first.then(() => 'resolved', error => error.code)
  await cleanupBegan
  // While cleanup is still running the operation is not finished, so no terminal state may be visible
  // and an identical request joins the same in-flight operation instead of duplicating it.
  assert.notEqual(setup.status().state, 'failed')
  assert.equal(setup.status().error, null)
  assert.equal(setup.prepare(['node']), first)
  await assert.rejects(setup.prepare(['other']), { code: 'SETUP_BUSY' })
  releaseCleanup()
  assert.equal(await firstOutcome, 'SETUP_ACTIVATION_BUSY')
  // Once failure is observable the store is clean and a retry is a new attempt.
  assert.equal(setup.status().state, 'failed'); assert.equal(setup.status().error, 'SETUP_ACTIVATION_BUSY')
  assert.deepEqual((await fs.readdir(path.join(root, 'generations'))).filter(name => name.startsWith('.stage-')), [])
  idle = true
  const retry = setup.prepare(['node'])
  assert.notEqual(retry, first)
  assert.equal(setup.prepare(['node']), retry, 'concurrent identical retries share one attempt')
  await retry
  assert.equal(setup.status().state, 'ready'); assert.equal(attempts, 2)
})

test('shutdown waits for pending staging cleanup before reporting the operation settled', async t => {
  const root = await rootFor(t), pack = fixturePack('node')
  let releaseCleanup, cleanupStarted, cleaned = false
  const held = new Promise(resolve => { releaseCleanup = resolve }), began = new Promise(resolve => { cleanupStarted = resolve })
  const setup = createRuntimeSetup({ root, config, getManifest: async () => manifest([pack]), fetchImpl: async () => new Response(pack.bytes),
    health: async () => true, canActivate: async () => false,
    removeTree: async target => { cleanupStarted(); await held; await fs.rm(target, { recursive: true, force: true }); cleaned = true } })
  const first = setup.prepare(['node']).catch(error => error.code)
  await began
  let settled = false
  const shutdown = setup.shutdown().then(() => { settled = true })
  await new Promise(resolve => setTimeout(resolve, 50))
  assert.equal(settled, false, 'shutdown must not finish while cleanup is pending')
  releaseCleanup()
  await shutdown
  assert.equal(cleaned, true); assert.equal(setup.hasActive(), false)
  assert.ok(['SETUP_ACTIVATION_BUSY', 'SETUP_CANCELLED'].includes(await first))
})
