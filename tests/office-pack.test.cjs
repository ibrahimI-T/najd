// Office and design pack manager (docs/AGENT-PLATFORM-M3-PLAN.md, M3-2/M3-002/M3-003/M3-005) with a fake desktop host
// standing in for uv and the probe. Real process lifecycle and logs, temporary folders only.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { createOfficePack, parseLock } = require('../electron/office-pack.cjs')
const { createProcessLifecycle } = require('../electron/process-lifecycle.cjs')
const { createExecLogs } = require('../electron/exec-logs.cjs')

const HASH = ' --hash=sha256:' + 'a'.repeat(64)
const LOCK = ['# engine-python: tools/python/najd-engine.exe', '# engine-version: 3.14.7', '# imports: docx PIL',
  'pillow==12.0.0' + HASH, 'python-docx==1.2.0' + HASH].join('\n') + '\n'

// behaviour: { uv: 'ok' | 'fail-hash' | 'fail-net' | 'extra' | 'slow', probe: 'ok' | 'fail' }
function fakeHost(behaviour) {
  const jobs = new Map()
  let next = 0
  const host = {
    calls: [],
    isRunning: () => true,
    async invokeHost(name, args) {
      host.calls.push(name)
      if (name === 'najd.process.list') return [...jobs.values()].map(job => ({ id: job.id, running: job.running, exitCode: job.exitCode }))
      if (name === 'najd.process.stop') { const job = jobs.get(args.id); if (job) { job.running = false; jobs.delete(args.id) } return { familyClosed: !behaviour.stuck } }
      if (name !== 'najd.process.start') throw new Error('unexpected ' + name)
      const id = 'job-' + ++next, job = { id, running: true, exitCode: null }
      jobs.set(id, job)
      const finish = (code, text = '') => { fs.writeFileSync(args.log, text); job.running = false; job.exitCode = code }
      if (args.command.includes('uv.exe')) {
        const target = /'--target' '([^']+)'/.exec(args.command)[1]
        const write = (name, version) => { fs.mkdirSync(path.join(target, `${name}-${version}.dist-info`), { recursive: true })
          fs.writeFileSync(path.join(target, `${name}-${version}.dist-info`, 'METADATA'), `Name: ${name}\nVersion: ${version}\nLicense-Expression: MIT\n`) }
        if (behaviour.uv === 'slow') return { id, pid: 999999, created: '1' }
        if (behaviour.uv === 'fail-hash') finish(1, 'error: Hash mismatch for pillow')
        else if (behaviour.uv === 'fail-net') finish(2, 'error: Failed to fetch: https://pypi.org/simple/pillow/')
        else {
          write('pillow', '12.0.0'); write('python_docx', '1.2.0')
          fs.mkdirSync(path.join(target, 'docx'), { recursive: true }); fs.writeFileSync(path.join(target, 'docx', '__init__.py'), 'x = 1\n')
          if (behaviour.uv === 'extra') write('evil', '1.0')
          finish(0, 'Installed 2 packages')
        }
      } else finish(behaviour.probe === 'fail' ? 1 : 0, behaviour.probe === 'fail' ? 'ModuleNotFoundError' : 'NAJD-PACK-PROBE "3.14.7"\n')
      return { id, pid: 4194300, created: '1' }
    }
  }
  return host
}

function setup(behaviour = { uv: 'ok', probe: 'ok' }, base = fs.mkdtempSync(path.join(os.tmpdir(), 'najd-pack-'))) {
  const host = fakeHost(behaviour)
  const engine = { python: path.join(base, 'python.exe'), uv: path.join(base, 'uv.exe'), receiptPython: 'tools/python/najd-engine.exe' }
  const make = (overrides = {}) => createOfficePack({ root: path.join(base, 'packs', 'office'), lockText: overrides.lockText || LOCK,
    getEngine: async () => overrides.engine || engine, host, hostPid: () => 4343,
    lifecycle: createProcessLifecycle({ filePath: path.join(base, 'lifecycle.json') }), logs: createExecLogs({ directory: path.join(base, 'logs') }) })
  return { base, host, engine, make, root: path.join(base, 'packs', 'office') }
}
const generations = root => fs.readdirSync(root).filter(name => name.startsWith('g-'))

test('the lock parses pins, header facts and an identity independent of line endings', () => {
  const lf = parseLock(LOCK), crlf = parseLock(LOCK.replace(/\n/g, '\r\n'))
  assert.equal(lf.sha256, crlf.sha256)
  assert.deepEqual(lf.imports, ['docx', 'PIL'])
  assert.deepEqual(lf.packages.map(pin => pin.name), ['pillow', 'python-docx'])
  assert.throws(() => parseLock(LOCK + 'unpinned\n'), { code: 'PACK_LOCK_INVALID' })
  assert.throws(() => parseLock(LOCK.replace('# imports: docx PIL', '# imports: os;rm')), { code: 'PACK_LOCK_INVALID' })
  const shipped = parseLock(fs.readFileSync(path.join(__dirname, '..', 'electron', 'packs', 'office-pack.lock.txt'), 'utf8'))
  assert.equal(shipped.packages.length, 18)
  assert.ok(shipped.imports.includes('matplotlib') && shipped.imports.includes('PIL'))
})

test('install verifies, records licenses and activates by switching the pointer; reinstall makes a new generation', async () => {
  const { make, root, host } = setup()
  const pack = make()
  await pack.start()
  assert.equal((await pack.status()).state, 'not-installed')
  const done = await pack.install()
  assert.equal(done.state, 'ready', JSON.stringify(done))
  assert.deepEqual(done.packages.map(row => [row.name, row.license]), [['pillow', 'MIT'], ['python-docx', 'MIT']])
  assert.ok(host.calls.filter(name => name === 'najd.process.start').length === 2, 'uv and the probe both ran through the host')
  const first = generations(root)
  assert.equal(first.length, 1)
  assert.equal(fs.existsSync(path.join(root, first[0], '.installing')), false)
  assert.equal(fs.existsSync(path.join(root, first[0], '.cache')), false)
  // Same lock again (repair): a new generation, the old one removed after the switch.
  const again = await pack.install()
  assert.equal(again.state, 'ready')
  const second = generations(root)
  assert.equal(second.length, 1); assert.notEqual(second[0], first[0])
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'active.json'), 'utf8')).generation, second[0])
})

test('failures keep the previous generation active and remove only the unfinished one', async () => {
  for (const [uv, probe, code] of [['fail-hash', 'ok', 'PACK_HASH_MISMATCH'], ['fail-net', 'ok', 'PACK_NETWORK'], ['extra', 'ok', 'PACK_VERIFY_FAILED'], ['ok', 'fail', 'PACK_VERIFY_FAILED']]) {
    const behaviour = { uv: 'ok', probe: 'ok' }
    const { make, root } = setup(behaviour)
    const pack = make()
    await pack.start(); await pack.install()
    const good = generations(root)[0]
    behaviour.uv = uv; behaviour.probe = probe
    const failed = await pack.install()
    assert.equal(failed.lastError, code, uv + '/' + probe)
    assert.equal(failed.state, 'ready', 'the earlier pack is still active')
    assert.deepEqual(generations(root), [good])
  }
})

test('changed lock or engine makes the pack incompatible; a resized file is damaged; a full check sees a changed byte', async () => {
  const { make, root, engine } = setup()
  const pack = make()
  await pack.start(); await pack.install()
  const lockChanged = make({ lockText: LOCK.replace('12.0.0', '12.0.1') }); await lockChanged.start()
  assert.equal((await lockChanged.status()).state, 'incompatible')
  const engineChanged = make({ engine: { ...engine, receiptPython: 'tools/python-3.15/najd-engine.exe' } }); await engineChanged.start()
  assert.equal((await engineChanged.status()).state, 'incompatible')
  const file = path.join(root, generations(root)[0], 'site-packages', 'docx', '__init__.py')
  fs.writeFileSync(file, 'y = 1\n') // same size, different byte
  const fresh = make(); await fresh.start()
  assert.equal((await fresh.status()).state, 'ready', 'the quick check compares names and sizes only')
  assert.equal((await fresh.check()).state, 'damaged', 'the full check re-hashes')
  fs.writeFileSync(file, 'longer = 1\n')
  const resized = make(); await resized.start()
  assert.equal((await resized.status()).state, 'damaged')
  assert.equal(await resized.acquire(), null, 'a damaged pack is never leased')
})

test('a leased generation survives replacement and removal until released; acquire needs a ready pack', async () => {
  const { make, root } = setup()
  const pack = make()
  await pack.start()
  assert.equal(await pack.acquire(), null)
  await pack.install()
  const lease = await pack.acquire()
  assert.ok(lease && fs.existsSync(lease.sitePackages))
  await pack.install() // replacement
  assert.ok(fs.existsSync(lease.sitePackages), 'a run that imports later still finds its packages')
  assert.equal(generations(root).length, 2)
  const second = await pack.acquire()
  await pack.remove()
  assert.equal((await pack.status()).state, 'not-installed')
  assert.ok(fs.existsSync(second.sitePackages))
  lease.release(); second.release()
  await new Promise(resolve => setTimeout(resolve, 50))
  assert.deepEqual(generations(root), [])
})

test('a lease bound to a host job is released when the host no longer runs it', async () => {
  const { make, root, host } = setup()
  const pack = make()
  await pack.start(); await pack.install()
  const lease = await pack.acquire()
  const job = await host.invokeHost('najd.process.start', { command: 'python', log: path.join(root, 'job.log') }) // finishes at once in the fake
  lease.bind(job.id)
  await pack.remove()
  assert.ok(fs.existsSync(lease.sitePackages))
  await pack.sweep()
  assert.equal(fs.existsSync(lease.sitePackages), false, 'the job ended, so the lease was released and the generation removed')
})

test('an interrupted install leaves the old generation active and its folder waits while its installer may run', async () => {
  const behaviour = { uv: 'ok', probe: 'ok' }
  const { make, root, base } = setup(behaviour)
  const first = make()
  await first.start(); await first.install()
  const good = generations(root)[0]
  // Simulated crash during the next install: a generation with an installer marker whose processes are gone.
  const orphan = path.join(root, 'g-' + '0'.repeat(8) + '-0000-0000-0000-' + '0'.repeat(12))
  fs.mkdirSync(path.join(orphan, 'site-packages'), { recursive: true })
  fs.writeFileSync(path.join(orphan, '.installing'), JSON.stringify({ hostPid: 999998, pids: [999997], startIds: [] }))
  // And one whose installer process still exists (this test's own pid stands in for it).
  const busy = path.join(root, 'g-' + '1'.repeat(8) + '-0000-0000-0000-' + '0'.repeat(12))
  fs.mkdirSync(busy, { recursive: true })
  fs.writeFileSync(path.join(busy, '.installing'), JSON.stringify({ hostPid: 999996, pids: [process.pid], startIds: [] }))
  const restarted = make()
  await restarted.start()
  assert.equal((await restarted.status()).state, 'ready')
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'active.json'), 'utf8')).generation, good)
  assert.equal(fs.existsSync(orphan), false, 'removed: its installer can no longer run')
  assert.equal(fs.existsSync(busy), true, 'kept: its installer may still run')
  assert.equal((await restarted.status()).cleanupPending, true)
  assert.ok(base)
})

test('a cancelled install stops its job, keeps the pointer and removes its generation', async () => {
  const behaviour = { uv: 'slow', probe: 'ok' }
  const { make, root } = setup(behaviour)
  const pack = make()
  await pack.start()
  const running = pack.install()
  await new Promise(resolve => setTimeout(resolve, 400))
  assert.equal((await pack.status()).installing, 'downloading')
  await assert.rejects(pack.install(), { code: 'PACK_BUSY' })
  pack.cancel()
  const result = await running
  assert.equal(result.lastError, 'CANCELLED')
  assert.equal(result.state, 'not-installed')
  assert.deepEqual(generations(root), [])
})

test('M3-I003/I004: damage found by a full check stays until reinstall; deletion waits for a running installer every time', async () => {
  const { make, root } = setup()
  const pack = make()
  await pack.start(); await pack.install()
  const generation = generations(root)[0]
  const file = path.join(root, generation, 'site-packages', 'docx', '__init__.py')
  fs.writeFileSync(file, 'y = 1\n') // same size, different byte
  assert.equal((await pack.check()).state, 'damaged')
  assert.equal((await pack.status()).state, 'damaged', 'a later quick check does not make it usable again')
  assert.equal(await pack.acquire(), null)
  const restarted = make(); await restarted.start()
  assert.equal((await restarted.status()).state, 'damaged', 'the damage mark survives a restart')
  assert.equal((await restarted.install()).state, 'ready', 'a reinstall (new generation) clears it')
  // An unfinished generation whose installer process still runs is never deleted by a later sweep either.
  const busy = path.join(root, 'g-' + '2'.repeat(8) + '-0000-0000-0000-' + '0'.repeat(12))
  fs.mkdirSync(busy, { recursive: true })
  fs.writeFileSync(path.join(busy, '.installing'), JSON.stringify({ hostPid: 999996, pids: [process.pid], startIds: [] }))
  const again = make(); await again.start()
  await again.sweep(); await again.sweep()
  assert.ok(fs.existsSync(busy), 'kept while its installer runs')
  fs.writeFileSync(path.join(busy, '.installing'), JSON.stringify({ hostPid: 999996, pids: [999995], startIds: [] }))
  await again.sweep()
  assert.equal(fs.existsSync(busy), false, 'removed once its installer has ended')
})

test('M3-I012: a check that raced a replacement is not published, and a generation being removed is never leased', async () => {
  const { make, root } = setup()
  const pack = make()
  await pack.start(); await pack.install()
  const [old] = generations(root)
  const fsp = require('node:fs/promises'), { readFile, rm } = fsp
  let openCheck, openRemoval, checkHeld = false, removalHeld = false
  const checkGate = new Promise(resolve => { openCheck = resolve }), removalGate = new Promise(resolve => { openRemoval = resolve })
  // The check stops right after reading the old pointer and receipt; the old folder's deletion stops before it starts.
  fsp.readFile = async (file, ...rest) => { if (!checkHeld && String(file).endsWith(path.join(old, 'najd-pack.json'))) { checkHeld = true; await checkGate } return readFile.call(fsp, file, ...rest) }
  fsp.rm = async (target, ...rest) => { if (!removalHeld && path.basename(String(target)) === old) { removalHeld = true; await removalGate } return rm.call(fsp, target, ...rest) }
  try {
    const leasing = pack.acquire()
    while (!checkHeld) await new Promise(resolve => setTimeout(resolve, 10))
    const replacing = pack.install()
    while (!removalHeld) await new Promise(resolve => setTimeout(resolve, 10))
    openCheck()
    const lease = await leasing
    assert.ok(lease, 'the check ran again on the new pointer')
    assert.notEqual(lease.generation, old, 'the generation being removed was not leased')
    openRemoval(); await replacing
    assert.ok(fs.existsSync(lease.sitePackages), 'the leased generation is intact')
    assert.equal(fs.existsSync(path.join(root, old)), false)
    lease.release()
  } finally { fsp.readFile = readFile; fsp.rm = rm; openCheck(); openRemoval() }
})

test('M3-I022: an install is reserved before its first wait; a second request, check and remove are refused meanwhile', async () => {
  const { make, root } = setup()
  const pack = make()
  await pack.start()
  const first = pack.install(), second = pack.install()
  await assert.rejects(second, { code: 'PACK_BUSY' })
  await assert.rejects(pack.check(), { code: 'PACK_BUSY' })
  await assert.rejects(pack.remove(), { code: 'PACK_BUSY' })
  assert.ok((await pack.status()).installing, 'the phase is visible from the start')
  assert.equal((await first).state, 'ready')
  assert.equal(generations(root).length, 1)
  assert.equal(fs.readdirSync(root).filter(name => name.startsWith('active.json.tmp')).length, 0)
})

test('M3-I024: remove and install never overlap in either order', async () => {
  const { make, root } = setup()
  const pack = make()
  await pack.start(); await pack.install()
  // Remove first: an install that arrives while it runs is refused, and the pointer it leaves is its own.
  const removing = pack.remove()
  await assert.rejects(pack.install(), { code: 'PACK_BUSY' })
  await assert.rejects(pack.check(), { code: 'PACK_BUSY' })
  assert.equal((await removing).state, 'not-installed')
  // Install first: remove is refused until it ends.
  const installing = pack.install()
  await assert.rejects(pack.remove(), { code: 'PACK_BUSY' })
  assert.equal((await installing).state, 'ready')
  assert.ok(fs.existsSync(path.join(root, 'active.json')), 'the new pointer survived')
  assert.equal((await pack.remove()).state, 'not-installed')
})
