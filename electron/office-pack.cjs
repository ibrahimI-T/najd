// Office and design pack (docs/AGENT-PLATFORM-M3-PLAN.md, M3-2): pinned, hash-verified Python packages the user
// installs once from Settings. Main-owned; the renderer supplies no URLs, paths or package names.
// - Generations: every install writes a new folder g-<random>; activation atomically replaces active.json, so a
//   reinstall never targets an existing folder and a failed or interrupted install leaves the previous one (M3-002).
// - Leases: a Python run takes a lease on the active generation; a generation is deleted only when it is neither
//   active nor leased. A lease bound to a host job is released once the host no longer runs that job (M3-003).
// - Containment: uv and the verification probe run through the desktop host inside a kill-on-close Job, recorded in
//   the process lifecycle; startup removes an unfinished generation only when its installer can no longer run (M3-005).
const fsp = require('node:fs/promises')
const { replaceFile } = require('./atomic-file.cjs')
const path = require('node:path')
const { createHash, randomUUID } = require('node:crypto')
const fail = code => Object.assign(new Error(code), { code })
const sha = value => createHash('sha256').update(value).digest('hex')
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const normal = name => String(name).toLowerCase().replace(/[-_.]+/g, '-')
const quote = value => "'" + String(value).replace(/'/g, "''") + "'"
const FORMAT = 'najd-office-pack-v1', INSTALL_MS = 600000, PROBE_MS = 120000
const PROXIES = ['HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'no_proxy']

// The shipped lock: exact pins, header facts, and its identity (hashed over LF text, so a checkout's line endings
// do not change it).
function parseLock(text) {
  const lines = String(text).replace(/\r\n/g, '\n').split('\n')
  const header = {}, packages = []
  for (const line of lines) {
    const meta = /^# (engine-python|engine-version|imports): (.+)$/.exec(line)
    if (meta) { header[meta[1]] = meta[2].trim(); continue }
    if (!line.trim() || line.startsWith('#')) continue
    const pin = /^([a-z0-9-]+)==([A-Za-z0-9.+!-]+)((?: --hash=sha256:[a-f0-9]{64})+)$/.exec(line)
    if (!pin) throw fail('PACK_LOCK_INVALID')
    packages.push({ name: pin[1], version: pin[2] })
  }
  if (!header['engine-python'] || !header['engine-version'] || !header.imports || !packages.length) throw fail('PACK_LOCK_INVALID')
  const imports = header.imports.split(/\s+/)
  if (imports.some(name => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name))) throw fail('PACK_LOCK_INVALID')
  return { text: lines.join('\n'), sha256: sha(lines.join('\n')), python: header['engine-python'], version: header['engine-version'], imports, packages }
}

// Each installed distribution's name, version and license, from its METADATA.
async function distributions(site) {
  const rows = []
  for (const entry of await fsp.readdir(site, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.endsWith('.dist-info')) continue
    const text = await fsp.readFile(path.join(site, entry.name, 'METADATA'), 'utf8').catch(() => '')
    const field = name => (new RegExp('^' + name + ': (.+)$', 'mi').exec(text) || [])[1]?.trim() || null
    const classifiers = [...text.matchAll(/^Classifier: License :: (.+)$/gmi)].map(match => match[1].trim())
    rows.push({ name: normal(field('Name') || ''), version: field('Version'), license: field('License-Expression') || (field('License') || '').split('\n')[0].slice(0, 80) || classifiers.join('; ') || null })
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name))
}

// Every file under the generation's site-packages: relative path, size, SHA-256.
async function inventory(site, hashes = true) {
  const files = []
  const walk = async folder => {
    for (const entry of await fsp.readdir(folder, { withFileTypes: true })) {
      const full = path.join(folder, entry.name)
      if (entry.isSymbolicLink()) throw fail('PACK_DAMAGED')
      if (entry.isDirectory()) { await walk(full); continue }
      if (!entry.isFile()) continue
      const stat = await fsp.stat(full)
      files.push({ path: path.relative(site, full).split(path.sep).join('/'), size: stat.size, ...(hashes ? { sha256: sha(await fsp.readFile(full)) } : {}) })
    }
  }
  await walk(site)
  return files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
}
const treeHash = files => sha(files.map(file => `${file.path}\t${file.size}\t${file.sha256}`).join('\n'))

function alive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try { process.kill(pid, 0); return true } catch (error) { return error?.code === 'EPERM' }
}

function createOfficePack({ root, lockText, getEngine, host, hostReady = async () => true, hostPid = () => null, lifecycle, logs }) {
  if (!path.isAbsolute(root || '') || typeof getEngine !== 'function' || typeof host?.invokeHost !== 'function' || !lifecycle) throw fail('INVALID_INPUT')
  const lock = parseLock(lockText)
  const pointer = path.join(root, 'active.json')
  // state: the validated active pack; progress: an install running beside it (the active pack stays usable meanwhile).
  let state = { state: 'unknown' }, progress = null, lastError = null, current = null, operation = null, controller = null, checkedAt = 0
  const leases = new Map() // generation -> Set of lease objects
  const doomed = new Set() // generations to delete once unleased
  // M3-I012: revision changes whenever the pointer does, so a validation that raced a change is not published; a
  // generation enters retiring (synchronously) before anything about its removal is awaited, and is never leased again.
  let revision = 0
  const retiring = new Set()

  // ---- pointer and receipt ----
  async function readPointer() {
    let text
    try { text = await fsp.readFile(pointer, 'utf8') } catch (error) { if (error?.code === 'ENOENT') return null; throw fail('PACK_DAMAGED') }
    let value = null
    try { value = JSON.parse(text) } catch {}
    if (!value || typeof value.generation !== 'string' || !/^g-[a-f0-9-]{36}$/.test(value.generation)) throw fail('PACK_DAMAGED')
    return value
  }
  async function writePointer(value) {
    revision++
    const temporary = pointer + '.tmp-' + process.pid + '-' + randomUUID()
    await fsp.writeFile(temporary, JSON.stringify(value))
    try { await replaceFile(temporary, pointer) } catch (error) { await fsp.rm(temporary, { force: true }).catch(() => {}); throw error }
  }
  // Validates the active generation. full: re-hash every file; otherwise compare names and sizes.
  async function validate({ full = false } = {}) {
    const engine = await getEngine().catch(() => null)
    let active
    try { active = await readPointer() } catch { return { state: 'damaged', error: 'PACK_DAMAGED' } }
    if (!active) return { state: 'not-installed' }
    const folder = path.join(root, active.generation), site = path.join(folder, 'site-packages')
    let receipt = null
    try { receipt = JSON.parse(await fsp.readFile(path.join(folder, 'najd-pack.json'), 'utf8')) } catch {}
    if (!receipt || receipt.format !== FORMAT || !Array.isArray(receipt.files) || !Array.isArray(receipt.packages)) return { state: 'damaged', generation: active.generation, error: 'PACK_DAMAGED' }
    const summary = { generation: active.generation, packages: receipt.packages, sizeBytes: receipt.files.reduce((sum, file) => sum + file.size, 0), installedAt: receipt.installedAt }
    // Damage found once stays found (M3-I003): a later quick check cannot make a known-changed generation usable again.
    const latch = path.join(folder, '.damaged')
    if (await fsp.stat(latch).then(() => true, () => false)) return { state: 'damaged', error: 'PACK_DAMAGED', ...summary }
    const damaged = async () => { await fsp.writeFile(latch, new Date().toISOString()).catch(() => {}); return { state: 'damaged', error: 'PACK_DAMAGED', ...summary } }
    if (receipt.lockSha256 !== lock.sha256) return { state: 'incompatible', reason: 'lock', ...summary }
    if (!engine || receipt.engine?.python !== engine.receiptPython || receipt.engine.python !== lock.python) return { state: 'incompatible', reason: 'engine', ...summary }
    let files
    try { files = await inventory(site, full) } catch { return damaged() }
    const same = files.length === receipt.files.length && files.every((file, index) => file.path === receipt.files[index].path && file.size === receipt.files[index].size &&
      (!full || file.sha256 === receipt.files[index].sha256))
    if (!same || (full && treeHash(files) !== receipt.treeSha256)) return damaged()
    return { state: 'ready', site, ...summary }
  }
  async function refresh(options) {
    for (let attempt = 0; ; attempt++) {
      const seen = revision
      const next = await validate(options)
      if (seen !== revision && attempt < 5) continue // the pointer moved while checking: check again
      state = seen === revision ? next : { state: 'unknown' }; checkedAt = Date.now()
      current = state.state === 'ready' && !retiring.has(state.generation) ? { generation: state.generation, site: state.site } : null
      return state
    }
  }

  // ---- cleanup ----
  // An installer has ended when none of its processes exists and every lifecycle record of its steps is finished (or
  // unconfirmed while the host that would have run it is gone).
  async function installerGone(marker) {
    if ((marker.pids || []).some(alive)) return false
    for (const startId of marker.startIds || []) {
      const record = await lifecycle.get(startId).catch(() => null)
      if (!record || ['exited', 'stopped', 'failed', 'ended-with-session'].includes(record.state)) continue
      if (record.state === 'unknown' && !alive(marker.hostPid)) continue
      return false
    }
    return true
  }
  async function removeGeneration(generation) {
    retiring.add(generation)
    if (current?.generation === generation) current = null
    if (leases.get(generation)?.size) { doomed.add(generation); return false }
    const folder = path.join(root, generation)
    // Before every deletion, not only at startup (M3-I004).
    let marker = null
    try { marker = JSON.parse(await fsp.readFile(path.join(folder, '.installing'), 'utf8')) } catch {}
    if (marker && !await installerGone(marker)) { doomed.add(generation); return false }
    // Leases are checked again right before deleting, with nothing awaited in between (acquire refuses retiring ones).
    if (leases.get(generation)?.size) { doomed.add(generation); return false }
    try { await fsp.rm(folder, { recursive: true, force: true }); doomed.delete(generation); return true }
    catch { doomed.add(generation); return false } // kept for the next start; never forced
  }
  // Releases leases whose host job is no longer running, then deletes doomed generations that became unleased. Sweeps
  // run one after another, so two never delete the same folder at once.
  let sweeping = Promise.resolve()
  const sweep = () => { sweeping = sweeping.then(sweepOnce, sweepOnce); return sweeping }
  async function sweepOnce() {
    const bound = [...leases.values()].flatMap(set => [...set]).filter(lease => lease.hostId)
    if (bound.length) {
      let hosted = null
      try { hosted = host.isRunning?.() === false ? [] : await host.invokeHost('najd.process.list', {}) } catch { hosted = null }
      if (Array.isArray(hosted)) for (const lease of bound) {
        const live = hosted.find(item => item.id === lease.hostId)
        if (!live || !live.running) lease.release()
      }
    }
    for (const generation of [...doomed]) await removeGeneration(generation)
  }
  // At startup: every generation that is not the pointer's is removed, unless an installer that wrote it may still
  // be running (its host or its uv process still exists), in which case it waits for the next start.
  async function cleanup() {
    let active = null
    try { active = await readPointer() } catch {}
    for (const entry of await fsp.readdir(root, { withFileTypes: true }).catch(() => [])) {
      if (!entry.isDirectory() || !/^g-/.test(entry.name) || entry.name === active?.generation) continue
      if (entry.name === progress?.generation) continue
      await removeGeneration(entry.name)
    }
    for (const entry of await fsp.readdir(root).catch(() => [])) if (entry.startsWith('active.json.tmp-')) await fsp.rm(path.join(root, entry), { force: true }).catch(() => {})
  }

  // ---- host-contained commands ----
  async function hosted({ command, cwd, env, timeoutMs, signal, marker, label }) {
    const record = await lifecycle.reserve({ provenance: { kind: 'approved', actionId: 'settings-office-pack' }, command: label, logId: null })
    marker.startIds.push(record.startId)
    await fsp.writeFile(path.join(marker.folder, '.installing'), JSON.stringify({ hostPid: hostPid(), pids: marker.pids, startIds: marker.startIds }))
    const log = logs.createExternal({ conversationId: null, kind: 'office-pack' })
    let started
    try { started = await host.invokeHost('najd.process.start', { command, cwd, log: log.file, env, timeoutMs }, 20000, { signal }) }
    catch (error) {
      await lifecycle.unknown(record.startId).catch(() => {})
      throw fail(error?.code === 'CANCELLED' ? 'CANCELLED' : error?.code === 'NOT_CONNECTED' ? 'NOT_CONNECTED' : 'PACK_INSTALL_FAILED')
    }
    marker.pids.push(started.pid)
    await fsp.writeFile(path.join(marker.folder, '.installing'), JSON.stringify({ hostPid: hostPid(), pids: marker.pids, startIds: marker.startIds })).catch(() => {})
    await lifecycle.confirm(record.startId, { hostId: started.id, pid: started.pid, created: started.created, contained: true }).catch(() => {})
    let outcome = 'running', exitCode = null
    const deadline = Date.now() + timeoutMs + 10000
    while (outcome === 'running') {
      if (signal.aborted) { outcome = 'cancelled'; break }
      if (Date.now() > deadline) { outcome = 'timeout'; break }
      await sleep(250)
      const list = await host.invokeHost('najd.process.list', {}, 20000).catch(() => null)
      const live = Array.isArray(list) ? list.find(item => item.id === started.id) : null
      if (live?.timedOut) outcome = 'timeout'
      else if (live && !live.running) { outcome = 'finished'; exitCode = live.exitCode }
      else if (Array.isArray(list) && !live) outcome = 'lost'
    }
    const stopped = await host.invokeHost('najd.process.stop', { id: started.id }).catch(() => null)
    const closed = outcome === 'finished' || outcome === 'lost' || stopped?.familyClosed === true
    if (closed) await (outcome === 'finished' ? lifecycle.exited(record.startId, exitCode) : lifecycle.stopped(record.startId)).catch(() => {})
    const text = await fsp.readFile(log.file, 'utf8').catch(() => '')
    logs.release?.(log.logId)
    if (!closed) throw Object.assign(fail('PACK_INSTALL_FAILED'), { familyOpen: true })
    if (outcome === 'cancelled') throw fail('CANCELLED')
    if (outcome !== 'finished') throw fail('TIMEOUT')
    return { exitCode, output: text.slice(-20000) }
  }

  // The operation is reserved in the same synchronous step that checks it (M3-I022), so two requests never both pass;
  // check and remove refuse while it is held, including during the preflight, and one outer finally releases it.
  async function install() {
    if (operation) throw fail('PACK_BUSY')
    operation = 'reserved'
    controller = new AbortController()
    const signal = controller.signal
    const generation = 'g-' + randomUUID()
    progress = { generation, phase: 'downloading' }; lastError = null
    try {
      const engine = await getEngine().catch(() => null)
      if (!engine) throw fail('RUNTIME_NOT_READY')
      if (engine.receiptPython !== lock.python) throw fail('PACK_ENGINE_MISMATCH')
      if (!await hostReady().catch(() => false)) throw fail('NOT_CONNECTED')
      if (signal.aborted) throw fail('CANCELLED')
      return await installReserved({ engine, signal, generation })
    } finally { operation = null; controller = null; progress = null }
  }
  async function installReserved({ engine, signal, generation }) {
    const folder = path.join(root, generation), site = path.join(folder, 'site-packages'), home = path.join(folder, '.home')
    const marker = { folder, pids: [], startIds: [] }
    operation = (async () => {
      let activated = false
      try {
        await fsp.mkdir(path.join(home, 'Local'), { recursive: true }); await fsp.mkdir(path.join(home, 'Roaming'), { recursive: true })
        await fsp.mkdir(site, { recursive: true })
        await fsp.writeFile(path.join(folder, 'lock.txt'), lock.text)
        const env = { HOME: home, USERPROFILE: home, APPDATA: path.join(home, 'Roaming'), LOCALAPPDATA: path.join(home, 'Local'), TEMP: home, TMP: home,
          UV_CACHE_DIR: path.join(folder, '.cache') }
        for (const name of PROXIES) if (process.env[name]) env[name] = process.env[name]
        const args = ['pip', 'install', '--target', site, '--require-hashes', '--only-binary', ':all:', '--no-deps', '--no-config', '--native-tls',
          '--index-url', 'https://pypi.org/simple', '--python', engine.python, '-r', path.join(folder, 'lock.txt')]
        const installed = await hosted({ command: '& ' + quote(engine.uv) + ' ' + args.map(quote).join(' '), cwd: folder, env, timeoutMs: INSTALL_MS, signal, marker, label: 'Office pack install' })
        if (installed.exitCode !== 0) {
          const text = installed.output.toLowerCase()
          throw fail(/hash mismatch|hashes do not match|does not match the expected hash/.test(text) ? 'PACK_HASH_MISMATCH'
            : /failed to fetch|connect|dns|timed out|network|tls|certificate|proxy/.test(text) ? 'PACK_NETWORK' : /no space|disk/.test(text) ? 'PACK_DISK_FAILED' : 'PACK_INSTALL_FAILED')
        }
        progress.phase = 'verifying'
        await fsp.rm(path.join(folder, '.cache'), { recursive: true, force: true })
        // Exactly the locked distributions, nothing more and nothing missing.
        const found = await distributions(site)
        const expected = lock.packages.map(pin => pin.name + '==' + pin.version).sort().join(',')
        if (found.map(row => row.name + '==' + row.version).sort().join(',') !== expected) throw fail('PACK_VERIFY_FAILED')
        // Every listed import works on the engine interpreter with only the pack added.
        const probe = path.join(folder, 'probe.py')
        await fsp.writeFile(probe, 'import importlib, json, site, sys\nsite.addsitedir(sys.argv[1])\nfor name in sys.argv[2:]:\n    importlib.import_module(name)\n' +
          'print("NAJD-PACK-PROBE " + json.dumps(".".join(map(str, sys.version_info[:3]))))\n')
        const probed = await hosted({ command: '& ' + quote(engine.python) + ' -I -B -X utf8 ' + [probe, site, ...lock.imports].map(quote).join(' '),
          cwd: folder, env: { HOME: home, USERPROFILE: home, APPDATA: path.join(home, 'Roaming'), LOCALAPPDATA: path.join(home, 'Local'), TEMP: home, TMP: home, MPLBACKEND: 'Agg', MPLCONFIGDIR: path.join(home, 'mpl') },
          timeoutMs: PROBE_MS, signal, marker, label: 'Office pack check' })
        const version = (/NAJD-PACK-PROBE "([0-9.]+)"/.exec(probed.output) || [])[1]
        if (probed.exitCode !== 0 || version !== lock.version) throw fail('PACK_VERIFY_FAILED')
        await fsp.rm(probe, { force: true }); await fsp.rm(home, { recursive: true, force: true })
        const files = await inventory(site, true)
        await fsp.writeFile(path.join(folder, 'najd-pack.json'), JSON.stringify({ format: FORMAT, lockSha256: lock.sha256, engine: { python: engine.receiptPython, version },
          packages: found, files, treeSha256: treeHash(files), installedAt: new Date().toISOString() }))
        if (signal.aborted) throw fail('CANCELLED')
        const previous = await readPointer().catch(() => null)
        await writePointer({ generation, lockSha256: lock.sha256, engine: { python: engine.receiptPython, version } })
        activated = true
        await fsp.rm(path.join(folder, '.installing'), { force: true }).catch(() => {})
        if (previous && previous.generation !== generation) await removeGeneration(previous.generation)
      } catch (error) {
        if (!activated) {
          // The pointer is unchanged. The unfinished generation goes now, unless its installer may still run.
          if (error?.familyOpen) doomed.add(generation)
          else await removeGeneration(generation)
        }
        throw error
      }
    })()
    try { await operation }
    catch (error) {
      lastError = ['CANCELLED', 'TIMEOUT', 'NOT_CONNECTED', 'PACK_NETWORK', 'PACK_HASH_MISMATCH', 'PACK_DISK_FAILED', 'PACK_VERIFY_FAILED', 'PACK_INSTALL_FAILED'].includes(error?.code) ? error.code : 'PACK_INSTALL_FAILED'
    }
    progress = null
    await refresh().catch(() => {})
    return status()
  }

  // Remove and check hold the same operation slot as install, taken before their first wait (M3-I024), so no two of
  // them overlap in either order.
  async function exclusive(name, work) {
    if (operation) throw fail('PACK_BUSY')
    operation = name
    try { return await work() } finally { operation = null }
  }
  function remove() {
    return exclusive('removing', async () => {
      const active = await readPointer().catch(() => null)
      current = null; revision++
      if (active) retiring.add(active.generation)
      await fsp.rm(pointer, { force: true })
      if (active) await removeGeneration(active.generation)
      await refresh()
      return status()
    })
  }

  function status() {
    const { site, ...visible } = state
    return { ...visible, ...(progress ? { installing: progress.phase } : {}), ...(lastError ? { lastError } : {}), lockSha256: lock.sha256, packageCount: lock.packages.length, leased: [...leases.values()].reduce((sum, set) => sum + set.size, 0),
      cleanupPending: doomed.size > 0 }
  }

  return {
    lock: { sha256: lock.sha256, packages: lock.packages.map(pin => ({ ...pin })), imports: [...lock.imports] },
    async start() { await fsp.mkdir(root, { recursive: true }); await cleanup(); await refresh() },
    status: async () => { if (Date.now() - checkedAt > 2000) await refresh().catch(() => {}); return status() },
    check: () => exclusive('checking', async () => { await refresh({ full: true }); return status() }),
    install, remove,
    cancel: () => { controller?.abort(); return status() },
    sweep,
    // A lease on the verified active generation: the check runs first; the lease is taken in the same synchronous step
    // that confirms nothing changed meanwhile (M3-003).
    async acquire() {
      await refresh()
      const chosen = current
      if (!chosen || state.state !== 'ready' || state.generation !== chosen.generation || retiring.has(chosen.generation)) return null
      const set = leases.get(chosen.generation) || new Set()
      leases.set(chosen.generation, set)
      const lease = { generation: chosen.generation, sitePackages: chosen.site, hostId: null,
        bind(hostId) { if (typeof hostId === 'string') lease.hostId = hostId },
        release() {
          if (!set.delete(lease)) return
          if (!set.size) leases.delete(chosen.generation)
          if (doomed.has(chosen.generation) || current?.generation !== chosen.generation) void sweep()
        } }
      set.add(lease)
      return lease
    },
    describe: () => ({ state: state.state, installing: progress?.phase || null, packages: lock.packages.map(pin => pin.name) })
  }
}

module.exports = { createOfficePack, parseLock }
