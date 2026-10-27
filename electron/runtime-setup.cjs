// Main-owned setup only. The renderer supplies no URLs, commands or installation paths.
const { isDirectEntry } = require('./path-identity.cjs')
const { replaceFile } = require('./atomic-file.cjs')
const fs = require('node:fs/promises')
const path = require('node:path')
const { createHash, randomUUID } = require('node:crypto')
const { Worker } = require('node:worker_threads')
const { verifyRuntimeManifest, planRuntimeComponents, runtimeAssetUrl, verifyRuntimeArchive, runtimeComponentIds } = require('./runtime-manifest.cjs')
const fail = code => Object.assign(new Error(code), { code })
const sha = value => createHash('sha256').update(value).digest('hex')
const codes = new Set(['SETUP_CANCELLED', 'SETUP_STORE_UNAVAILABLE', 'SETUP_ACTIVATION_BUSY', 'RUNTIME_DOWNLOAD_FAILED', 'RUNTIME_SIGNATURE_INVALID', 'RUNTIME_ARCHIVE_INVALID', 'RUNTIME_HEALTH_FAILED', 'RUNTIME_MANIFEST_INVALID', 'RUNTIME_COMPONENT_MISSING', 'INCOMPATIBLE_RUNTIME'])

async function checkedDirectory(directory, create = false) {
  if (create) await fs.mkdir(directory, { recursive: true })
  const stat = await fs.lstat(directory)
  if (!stat.isDirectory() || stat.isSymbolicLink() || !await isDirectEntry(directory)) throw fail('SETUP_STORE_UNAVAILABLE')
}
async function readJson(filename) {
  const stat = await fs.lstat(filename)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4096 || !await isDirectEntry(filename)) throw fail('SETUP_STORE_UNAVAILABLE')
  const handle = await fs.open(filename, 'r')
  try {
    const buffer = Buffer.alloc(4097), { bytesRead } = await handle.read(buffer)
    if (bytesRead > 4096) throw fail('SETUP_STORE_UNAVAILABLE')
    return JSON.parse(buffer.subarray(0, bytesRead).toString('utf8'))
  } finally { await handle.close() }
}
async function compareOrExtract(archive, directory, component, mode, signal) {
  if (signal.aborted) throw fail('SETUP_CANCELLED')
  const worker = new Worker(path.join(__dirname, 'runtime-extract-worker.cjs'), {
    workerData: { archive, directory, mode, sha512: component.file.sha512 }, resourceLimits: { maxOldGenerationSizeMb: 128 }
  })
  let timer, abort
  try {
    return await new Promise((resolve, reject) => {
      abort = () => reject(fail('SETUP_CANCELLED'))
      signal.addEventListener('abort', abort, { once: true })
      if (signal.aborted) { abort(); return }
      timer = setTimeout(() => reject(fail('RUNTIME_ARCHIVE_INVALID')), 240000)
      worker.once('message', result => result.error ? reject(fail('RUNTIME_ARCHIVE_INVALID')) : resolve(result))
      worker.once('error', () => reject(fail('RUNTIME_ARCHIVE_INVALID')))
      worker.once('exit', () => reject(fail('RUNTIME_ARCHIVE_INVALID')))
    })
  } finally { clearTimeout(timer); signal.removeEventListener('abort', abort); await worker.terminate() }
}

// removeTree is injectable only so tests can hold staging cleanup open deterministically.
function createRuntimeSetup({ root, config, getManifest, fetchImpl = globalThis.fetch, health, canActivate, removeTree = target => fs.rm(target, { recursive: true, force: true }) }) {
  if (!path.isAbsolute(root || '') || path.dirname(path.resolve(root)) === path.resolve(root) ||
      typeof getManifest !== 'function' || typeof fetchImpl !== 'function' || typeof health !== 'function' || typeof canActivate !== 'function') throw fail('INVALID_INPUT')
  root = path.resolve(root); config = Object.freeze({ ...config })
  const archiveRoot = path.join(root, 'archives'), generationRoot = path.join(root, 'generations'), activePath = path.join(root, 'active.json')
  let running = null, controller, requestKey
  let status = { state: 'idle', component: null, downloaded: 0, total: 0, error: null, hasPrevious: false, cleanupPending: false }
  const update = (state, details = {}) => { status = { ...status, state, ...details } }
  const check = signal => { if (signal.aborted) throw fail('SETUP_CANCELLED') }
  async function initialize() {
    await checkedDirectory(root, true)
    const owner = path.join(root, '.najd-runtime-store.json')
    try {
      const marker = await readJson(owner)
      if (Object.keys(marker).join(',') !== 'format' || marker.format !== 'najd-runtime-store-v1') throw fail('SETUP_STORE_UNAVAILABLE')
    } catch (error) {
      if (error.code !== 'ENOENT' || (await fs.readdir(root)).length) throw fail('SETUP_STORE_UNAVAILABLE')
      await fs.writeFile(owner, JSON.stringify({ format: 'najd-runtime-store-v1' }), { flag: 'wx', mode: 0o600 })
    }
    let previous = null
    try {
      previous = await readJson(activePath)
      if (Object.keys(previous).sort().join(',') !== 'catalogVersion,components,generation,version' || previous.version !== 1 ||
          !/^g-[a-f0-9]{32}$/.test(previous.generation) || !/^\d+\.\d+\.\d+$/.test(previous.catalogVersion) ||
          !Array.isArray(previous.components) || previous.components.length > runtimeComponentIds.length || previous.components.some(id => !runtimeComponentIds.includes(id))) throw fail('SETUP_STORE_UNAVAILABLE')
    } catch (error) { if (error.code !== 'ENOENT') throw fail('SETUP_STORE_UNAVAILABLE') }
    await checkedDirectory(archiveRoot, true); await checkedDirectory(generationRoot, true)
    // The hosting application must hold its profile's single-instance ownership.
    // Interrupted staging is inert; verified archives are the resumable checkpoint.
    for (const name of await fs.readdir(generationRoot)) {
      if (/^\.stage-[a-f0-9-]{36}$/.test(name)) await removeStage(path.join(generationRoot, name))
    }
    for (const name of await fs.readdir(archiveRoot)) {
      if (/^[a-f0-9]{64}\.zip\.[a-f0-9-]{36}\.partial$/.test(name)) {
        const candidate = path.join(archiveRoot, name), facts = await fs.lstat(candidate)
        if (!facts.isFile() || facts.isSymbolicLink() || !await isDirectEntry(candidate)) throw fail('SETUP_STORE_UNAVAILABLE')
        await fs.unlink(candidate)
      }
    }
    return previous
  }
  async function download(component, manifest, signal) {
    const destination = path.join(archiveRoot, sha(component.file.sha512) + '.zip')
    update('verifying', { component: component.id, downloaded: 0, total: component.file.size })
    try { await fs.lstat(destination); await verifyRuntimeArchive(destination, component); return destination }
    catch (error) { if (error.code !== 'ENOENT') throw error }
    const temporary = destination + '.' + randomUUID() + '.partial'
    let handle
    try {
      update('downloading')
      const combined = AbortSignal.any([signal, AbortSignal.timeout(300000)])
      let response
      try { response = await fetchImpl(runtimeAssetUrl(manifest, component, config), { signal: combined, redirect: 'follow', credentials: 'omit' }) }
      catch { check(signal); throw fail('RUNTIME_DOWNLOAD_FAILED') }
      check(signal)
      if (!response.ok || response.status !== 200 || !response.body) throw fail('RUNTIME_DOWNLOAD_FAILED')
      if (response.url) {
        const url = new URL(response.url)
        if (url.protocol !== 'https:' || url.username || url.password || url.port && url.port !== '443' ||
            !(url.hostname === 'github.com' || url.hostname.endsWith('.githubusercontent.com'))) throw fail('RUNTIME_DOWNLOAD_FAILED')
      }
      const length = response.headers.get('content-length')
      if (length !== null && (!/^\d+$/.test(length) || Number(length) !== component.file.size)) throw fail('RUNTIME_SIGNATURE_INVALID')
      handle = await fs.open(temporary, 'wx', 0o600)
      let count = 0
      try {
        for await (const chunk of response.body) {
          check(signal); count += chunk.length
          if (count > component.file.size) throw fail('RUNTIME_SIGNATURE_INVALID')
          await handle.writeFile(chunk); update('downloading', { downloaded: count })
        }
      } catch (error) { check(signal); throw codes.has(error.code) ? error : fail('RUNTIME_DOWNLOAD_FAILED') }
      await handle.sync(); await handle.close(); handle = null
      check(signal); update('verifying')
      await verifyRuntimeArchive(temporary, component)
      await replaceFile(temporary, destination)
      return destination
    } finally {
      await handle?.close()
      await fs.unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error })
    }
  }
  async function removeStage(stage) {
    if (path.dirname(stage) !== generationRoot || !/^\.stage-[a-f0-9-]{36}$/.test(path.basename(stage))) throw fail('SETUP_STORE_UNAVAILABLE')
    await checkedDirectory(stage)
    await removeTree(stage)
  }
  // Terminal states (ready/failed/cancelled) are returned to prepare(), which publishes them in the
  // same synchronous step that clears the in-flight operation, after staging cleanup has finished.
  // Observers therefore never see a terminal state while a retry would still join the old attempt.
  async function perform(requested, signal, finish) {
    let stage
    try {
      update('validating', { component: null, downloaded: 0, total: 0, error: null, hasPrevious: false, cleanupPending: false })
      const previous = await initialize(); check(signal)
      status.hasPrevious = previous !== null
      let raw
      try { raw = await getManifest(signal) } catch { check(signal); throw fail('RUNTIME_DOWNLOAD_FAILED') }
      const manifest = verifyRuntimeManifest(raw, config), plan = planRuntimeComponents(manifest, requested)
      if (!plan.length) throw fail('RUNTIME_COMPONENT_MISSING')
      const generation = 'g-' + sha(raw + JSON.stringify(plan.map(row => row.id))).slice(0, 32), destination = path.join(generationRoot, generation)
      let existing = false
      try { await checkedDirectory(destination); existing = true } catch (error) { if (error.code !== 'ENOENT') throw error }
      if (!existing) { stage = path.join(generationRoot, '.stage-' + randomUUID()); await fs.mkdir(stage) }
      const prepared = existing ? destination : stage, directories = {}
      if (existing) {
        const expected = new Set([...plan.map(row => row.id), 'catalog.json'])
        if ((await fs.readdir(prepared)).some(name => !expected.has(name)) || await fs.readFile(path.join(prepared, 'catalog.json'), 'utf8') !== raw) throw fail('RUNTIME_ARCHIVE_INVALID')
      } else await fs.writeFile(path.join(prepared, 'catalog.json'), raw, { flag: 'wx', mode: 0o600 })
      for (const component of plan) {
        check(signal)
        const archive = await download(component, manifest, signal), directory = path.join(prepared, component.id)
        if (!existing) await fs.mkdir(directory)
        update('preparing', { component: component.id })
        await compareOrExtract(archive, directory, component, existing ? 'verify' : 'extract', signal)
        await fs.access(path.join(directory, component.entry))
        directories[component.id] = directory
        check(signal); update('checking')
        let healthy = false
        try { healthy = await health({ component: structuredClone(component), directory, directories: { ...directories }, signal }) === true }
        catch { check(signal); throw fail('RUNTIME_HEALTH_FAILED') }
        check(signal)
        if (!healthy) throw fail('RUNTIME_HEALTH_FAILED')
        // A health probe may not mutate an immutable executable generation.
        await compareOrExtract(archive, directory, component, 'verify', signal)
      }
      check(signal)
      if (await canActivate() !== true) throw fail('SETUP_ACTIVATION_BUSY')
      check(signal); update('activating', { component: null })
      if (!existing) { await fs.rename(stage, destination); stage = null }
      const next = { version: 1, generation, catalogVersion: manifest.version, components: plan.map(row => row.id) }
      const temporary = path.join(root, 'active.' + randomUUID() + '.tmp')
      try {
        const handle = await fs.open(temporary, 'wx', 0o600)
        try { await handle.writeFile(JSON.stringify(next)); await handle.sync() } finally { await handle.close() }
        await replaceFile(temporary, activePath)
      } finally { await fs.unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error }) }
      finish.terminal = ['ready', { error: null, hasPrevious: previous !== null }]
      return { generation, directories: Object.fromEntries(plan.map(row => [row.id, path.join(destination, row.id)])) }
    } catch (error) {
      const code = signal.aborted ? 'SETUP_CANCELLED' : codes.has(error.code) ? error.code : 'SETUP_STORE_UNAVAILABLE'
      finish.terminal = [code === 'SETUP_CANCELLED' ? 'cancelled' : 'failed', { error: code }]
      throw fail(code)
    } finally { if (stage) await removeStage(stage).catch(() => { status.cleanupPending = true }) }
  }
  return {
    status: () => ({ ...status, canCancel: !!running && status.state !== 'activating' }),
    prepare: requested => {
      if (!Array.isArray(requested) || requested.length > 16 || requested.some(id => typeof id !== 'string')) return Promise.reject(fail('INVALID_INPUT'))
      const key = JSON.stringify(requested)
      if (running) return key === requestKey ? running : Promise.reject(fail('SETUP_BUSY'))
      controller = new AbortController(); requestKey = key
      const finish = { terminal: null }, settle = () => { running = null; if (finish.terminal) update(...finish.terminal) }
      running = perform([...requested], controller.signal, finish).then(result => { settle(); return result }, error => { settle(); throw error })
      return running
    },
    cancel: () => { if (!running || status.state === 'activating') return false; controller.abort(); return true },
    shutdown: async () => { if (running && status.state !== 'activating') controller.abort(); await running?.catch(() => {}) },
    hasActive: () => running !== null
  }
}
module.exports = { createRuntimeSetup }
