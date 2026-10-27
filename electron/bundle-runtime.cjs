// First-run preparation of the runtime archives shipped inside the installer. The
// installer copies a few archives quickly; NAJD unpacks each component once into a
// versioned folder under LocalAppData with visible progress, verifies it (SHA-512 while
// reading, exact file set), and reuses it across app updates while the archive is unchanged.
//
// Updates are transactional. Component folders are content-addressed, so a new version never overwrites the one in use. The folders of the previous
// working generation are kept until the new generation has proven itself healthy (confirmHealthy); only then are older folders removed. A failed or
// interrupted preparation therefore leaves the last working components untouched, and the record of both generations is preserved if it cannot be read.
const fs = require('node:fs')
const { replaceFileSync } = require('./atomic-file.cjs')
const fsp = require('node:fs/promises')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { Worker } = require('node:worker_threads')

const fail = code => Object.assign(new Error(code), { code })
const MARKER = '.najd-component.json'
const STORE_MARKER = '.najd-runtime-store.json'
const GENERATIONS = '.najd-generations.json'
const FOLDER = /^[a-z][a-z-]{1,30}-[a-f0-9]{12}$/

function readBundle(source) {
  const bundle = JSON.parse(fs.readFileSync(path.join(source, 'bundle.json'), 'utf8'))
  if (bundle.format !== 'najd-runtime-bundle-v2' || !Array.isArray(bundle.components) || !bundle.components.length) throw fail('RUNTIME_ARCHIVE_INVALID')
  for (const row of bundle.components) {
    if (!/^[a-z][a-z-]{1,30}$/.test(row.id) || row.file !== row.id + '.zip' || !Number.isSafeInteger(row.files) || !Number.isSafeInteger(row.size) ||
        typeof row.sha512 !== 'string' || Buffer.from(row.sha512, 'base64').length !== 64 || typeof row.entry !== 'string') throw fail('RUNTIME_ARCHIVE_INVALID')
  }
  return bundle
}
const folderName = row => row.id + '-' + Buffer.from(row.sha512, 'base64').toString('hex').slice(0, 12)

function extract(archive, directory, sha512, onProgress) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, 'runtime-extract-worker.cjs'),
      { workerData: { archive, directory, mode: 'extract', sha512, progress: true, sync: false }, resourceLimits: { maxOldGenerationSizeMb: 256 } })
    let settled = false
    const done = (fn, value) => { if (settled) return; settled = true; void worker.terminate(); fn(value) }
    worker.on('message', message => {
      if (typeof message.progress === 'number') { onProgress(message.progress); return }
      if (message.error) done(reject, fail('RUNTIME_ARCHIVE_INVALID')); else done(resolve, message)
    })
    worker.once('error', () => done(reject, fail('RUNTIME_ARCHIVE_INVALID')))
    worker.once('exit', () => done(reject, fail('RUNTIME_ARCHIVE_INVALID')))
  })
}

function createBundleRuntime({ source, target }) {
  if (!path.isAbsolute(source || '') || !path.isAbsolute(target || '')) throw fail('INVALID_INPUT')
  const bundle = readBundle(source)
  const total = bundle.components.reduce((sum, row) => sum + row.files, 0)
  let status = { state: 'idle', component: null, done: 0, total, error: null }
  let running = null
  const waiters = []
  const generationsFile = path.join(target, GENERATIONS)
  const currentGeneration = version => ({ version, components: bundle.components.map(row => ({ folder: folderName(row), entry: row.entry })) })
  const VERSION = /^\d{1,6}\.\d{1,6}\.\d{1,6}(?:[-+][0-9A-Za-z.-]{1,40})?$/
  const validGeneration = value => value === null || (value && typeof value.version === 'string' && VERSION.test(value.version) && Array.isArray(value.components) &&
    value.components.length >= 1 && value.components.length <= 16 && new Set(value.components.map(item => item?.folder)).size === value.components.length &&
    value.components.every(item => item && typeof item.folder === 'string' && FOLDER.test(item.folder) && safeEntry(item.entry)))
  // An entry file is a normalized relative path that stays inside its component folder.
  const safeEntry = entry => typeof entry === 'string' && entry.length > 0 && entry.length <= 260 && !path.isAbsolute(entry) && !/^[a-zA-Z]:/.test(entry) &&
    !entry.split(/[\\/]/).some(part => part === '..' || part === '' || part === '.')
  const foldersOf = generation => (generation ? generation.components.map(item => item.folder) : [])
  // Returns { current, lastGood, previous }; a missing record is empty. A record that exists but cannot be trusted throws and is left in place for inspection.
  function readGenerations() {
    let raw
    try { raw = fs.readFileSync(generationsFile, 'utf8') } catch (error) { if (error.code === 'ENOENT') return { current: null, lastGood: null, previous: null }; throw fail('GENERATIONS_UNREADABLE') }
    let parsed
    try { parsed = JSON.parse(raw) } catch { throw fail('GENERATIONS_UNREADABLE') }
    if (!parsed || parsed.format !== 'najd-generations-v2' || !validGeneration(parsed.current) || !validGeneration(parsed.lastGood) || !validGeneration(parsed.previous)) throw fail('GENERATIONS_UNREADABLE')
    return { current: parsed.current, lastGood: parsed.lastGood, previous: parsed.previous }
  }
  function writeGenerations(value) {
    const temporary = generationsFile + '.' + randomUUID().slice(0, 8) + '.tmp'
    fs.writeFileSync(temporary, JSON.stringify({ format: 'najd-generations-v2', current: value.current, lastGood: value.lastGood, previous: value.previous }))
    replaceFileSync(temporary, generationsFile)
  }
  // A generation is usable only when every one of its folders carries a component marker whose identity matches the folder name and the entry file exists.
  function generationIntact(generation) {
    const missing = []
    for (const item of generation.components) {
      try {
        const marker = JSON.parse(fs.readFileSync(path.join(target, item.folder, MARKER), 'utf8'))
        const digest = typeof marker.sha512 === 'string' ? Buffer.from(marker.sha512, 'base64') : Buffer.alloc(0)
        const hash = digest.length === 64 ? digest.toString('hex').slice(0, 12) : ''
        if (!hash || item.folder !== marker.id + '-' + hash || !safeEntry(item.entry) || !fs.statSync(path.join(target, item.folder, item.entry)).isFile()) missing.push(item.folder)
      } catch { missing.push(item.folder) }
    }
    return missing
  }
  const ready = id => {
    const row = bundle.components.find(item => item.id === id)
    const directory = row && path.join(target, folderName(row))
    if (!directory) return false
    try { return JSON.parse(fs.readFileSync(path.join(directory, MARKER), 'utf8')).sha512 === row.sha512 && fs.existsSync(path.join(directory, row.entry)) }
    catch { return false }
  }

  async function prepareStore() {
    await fsp.mkdir(target, { recursive: true })
    const marker = path.join(target, STORE_MARKER)
    if (!fs.existsSync(marker)) {
      if ((await fsp.readdir(target)).length) throw fail('SETUP_STORE_UNAVAILABLE') // never take over an unknown folder
      await fsp.writeFile(marker, JSON.stringify({ format: 'najd-runtime-store-v1' }))
    }
    // Interrupted unpacking leaves only inert staging folders.
    for (const name of await fsp.readdir(target)) if (/^\.stage-[a-f0-9-]{36}$/.test(name)) await fsp.rm(path.join(target, name), { recursive: true, force: true })
  }

  async function perform() {
    status = { ...status, state: 'preparing', error: null }
    await prepareStore()
    // Components unpack concurrently (disk and antivirus scanning dominate), each in its own stage.
    const progress = Object.fromEntries(bundle.components.map(row => [row.id, ready(row.id) ? row.files : 0]))
    const active = new Set()
    const publish = () => { status = { ...status, done: Object.values(progress).reduce((sum, value) => sum + value, 0), component: [...active][0] || null } }
    publish()
    let failure = null
    async function unpack(row) {
      const stage = path.join(target, '.stage-' + randomUUID())
      await fsp.mkdir(stage)
      active.add(row.id); publish()
      try {
        await extract(path.join(source, row.file), stage, row.sha512, count => { progress[row.id] = Math.min(count, row.files); publish() })
        await fsp.writeFile(path.join(stage, MARKER), JSON.stringify({ id: row.id, sha512: row.sha512 }))
        const destination = path.join(target, folderName(row))
        // An existing (unusable) folder of this name is set aside first and removed only after the new one is in place; if publishing fails it is put back.
        const aside = path.join(target, '.stage-' + randomUUID())
        const hadOld = await fsp.rename(destination, aside).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error })
        try { await fsp.rename(stage, destination) } catch (error) { if (hadOld) await fsp.rename(aside, destination).catch(() => {}); throw error }
        if (hadOld) await fsp.rm(aside, { recursive: true, force: true }).catch(() => {})
        progress[row.id] = row.files
      } catch (error) { failure ||= Object.assign(error, { component: row.id }); await fsp.rm(stage, { recursive: true, force: true }).catch(() => {}) }
      finally { active.delete(row.id); publish() }
    }
    const pending = bundle.components.filter(row => !ready(row.id))
    const lanes = Array.from({ length: Math.min(3, pending.length) }, async () => { while (pending.length && !failure) await unpack(pending.shift()) })
    await Promise.all(lanes)
    if (failure) throw failure
    // Earlier component versions are NOT removed here: they belong to the last working generation until the new one is confirmed healthy.
    status = { ...status, state: 'ready', component: null, done: total }
  }

  function prepare() {
    if (status.state === 'ready') return Promise.resolve()
    if (!running) running = perform().catch(error => {
      status = { ...status, state: 'failed', error: ['RUNTIME_ARCHIVE_INVALID', 'SETUP_STORE_UNAVAILABLE'].includes(error.code) ? error.code : 'SETUP_STORE_UNAVAILABLE' }
      throw error
    }).finally(() => { running = null; for (const resolve of waiters.splice(0)) resolve() })
    return running
  }
  if (bundle.components.every(row => ready(row.id))) status = { ...status, state: 'ready', done: total }

  // Removes component folders that belong to none of the kept generations (current, last working, previous). Never runs when the record cannot be read.
  async function collect() {
    let generations
    try { generations = readGenerations() } catch { return { removed: [], skipped: 'GENERATIONS_UNREADABLE' } }
    // Without any recorded generation nothing is known to be removable (for example an install made before generations existed).
    if (!generations.current && !generations.lastGood && !generations.previous) return { removed: [], skipped: 'NO_GENERATION_RECORD' }
    const keep = new Set([...bundle.components.map(folderName), ...foldersOf(generations.current), ...foldersOf(generations.lastGood), ...foldersOf(generations.previous)])
    const removed = []
    for (const name of await fsp.readdir(target)) {
      if (keep.has(name) || !FOLDER.test(name) || !fs.existsSync(path.join(target, name, MARKER))) continue
      await fsp.rm(path.join(target, name), { recursive: true, force: true }).then(() => removed.push(name), () => {})
    }
    return { removed }
  }

  return {
    status: () => ({ ...status }),
    prepare,
    // The current bundle is fully unpacked and verified: record it as the current generation (the last working generation stays as it is).
    markPrepared(version) {
      if (status.state !== 'ready') throw fail('RUNTIME_NOT_READY')
      if (!VERSION.test(String(version))) throw fail('INVALID_INPUT')
      const generations = readGenerations()
      const next = currentGeneration(version)
      if (generations.current && JSON.stringify(generations.current) === JSON.stringify(next)) return generations
      writeGenerations({ ...generations, current: next })
      return readGenerations()
    },
    // The current generation proved itself healthy: it becomes the last working generation. The generation it replaces is kept as `previous` (a rollback
    // target after a successful update), and only folders outside current, last working and previous are removed.
    async confirmHealthy(version) {
      const generations = readGenerations()
      if (!generations.current || generations.current.version !== version) throw fail('GENERATION_NOT_CURRENT')
      const replaced = generations.lastGood && generations.lastGood.version !== version ? generations.lastGood : generations.previous
      writeGenerations({ current: generations.current, lastGood: generations.current, previous: replaced })
      return collect()
    },
    // What an explicit rollback would use: the newest older generation (the last working one while the current one is unconfirmed, otherwise the previous one),
    // reported only when every one of its component folders is complete and matches its recorded identity.
    rollbackPlan() {
      let generations
      try { generations = readGenerations() } catch { return { available: false, reason: 'GENERATIONS_UNREADABLE' } }
      const candidate = generations.lastGood && (!generations.current || generations.lastGood.version !== generations.current.version) ? generations.lastGood : generations.previous
      if (!candidate) return { available: false, reason: generations.lastGood ? 'ALREADY_CURRENT' : 'NO_PREVIOUS_GENERATION', ...(generations.lastGood ? { version: generations.lastGood.version } : {}) }
      const missing = generationIntact(candidate)
      return { available: missing.length === 0, version: candidate.version, missing }
    },
    generations() { try { return readGenerations() } catch { return { current: null, lastGood: null, previous: null, error: 'GENERATIONS_UNREADABLE' } } },
    collect,
    isReady: () => status.state === 'ready',
    whenSettled: () => status.state === 'ready' || status.state === 'failed' ? Promise.resolve() : new Promise(resolve => waiters.push(resolve)),
    // Deterministic paths, known before preparation finishes.
    directory: id => { const row = bundle.components.find(item => item.id === id); return row ? path.join(target, folderName(row)) : null },
    readyDirectory: id => ready(id) ? path.join(target, folderName(bundle.components.find(item => item.id === id))) : null
  }
}
module.exports = { createBundleRuntime }
