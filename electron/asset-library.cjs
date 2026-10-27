const { isDirectEntry } = require('./path-identity.cjs')
const { replaceFile } = require('./atomic-file.cjs')
const fs = require('node:fs/promises')
const path = require('node:path')
const { createHash, randomUUID } = require('node:crypto')
const { Worker } = require('node:worker_threads')
const { decideAction } = require('./action-policy.cjs')

const MAX_FILE = 100 * 1024 * 1024
const MAX_TEXT = 4000000 // matches document-worker.cjs: large references such as building codes (R-057)
const MAX_INDEX = 256 * 1024 * 1024
const MAX_ASSETS = 50000
const ID = /^[a-f0-9]{64}$/
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'])
const MAX_IMAGE = 2 * 1024 * 1024
const VIDEO_EXTENSIONS = new Set(['.mp4', '.m4v', '.webm', '.mov', '.ogv'])
const MAX_VIDEO = 1024 * 1024 * 1024, MAX_FRAMES_PAYLOAD = 4 * 1024 * 1024, MAX_AUDIO = 20 * 1024 * 1024
const NEVER_TEXT = /^[.](exe|dll|msi|msix|appx|sys|scr|com|cpl|lnk|url|hta|jar|apk|iso|img|vhdx?|zip|7z|rar|gz|tar|pdf|docx|xlsx|pptx|doc|xls|ppt|docm|xlsm|pptm)$/i
function plainText(bytes) {
  if (!bytes.length || bytes.includes(0)) return false
  try { new TextDecoder('utf-8', { fatal: true }).decode(bytes); return true } catch { return false }
}
const TEXT_EXTENSIONS = new Set(['.txt', '.md', '.markdown', '.csv', '.tsv', '.json', '.jsonl', '.js', '.mjs', '.cjs', '.ts', '.jsx', '.tsx', '.py', '.html', '.htm', '.css', '.scss', '.less',
  '.log', '.xml', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf', '.sql', '.sh', '.ps1', '.bat', '.cmd', '.c', '.h', '.cpp', '.hpp', '.cc', '.cs', '.java', '.kt', '.go', '.rs',
  '.rb', '.php', '.swift', '.dart', '.lua', '.r', '.m', '.vue', '.svelte', '.tex', '.srt', '.vtt', '.svg', '.gitignore'])
const error = code => Object.assign(new Error(code), { code })
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const within = (root, target) => {
  const relative = path.relative(root, target)
  return !relative || !relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative)
}
const sensitive = name => /^(\.env|id_rsa|id_ed25519|credentials|token|secrets?\.)/i.test(name) || /\.(pem|key|pfx|p12|kdbx)$/i.test(name)

async function regularBytes(file, max, code) {
  const stat = await fs.lstat(file)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > max) throw error(code)
  if (!await isDirectEntry(file)) throw error(code)
  const handle = await fs.open(file, 'r')
  try {
    const opened = await handle.stat()
    if (!opened.isFile() || opened.size > max || opened.ino !== stat.ino || opened.dev !== stat.dev) throw error(code)
    const bytes = Buffer.alloc(opened.size + 1)
    let length = 0
    while (length < bytes.length) {
      const read = await handle.read(bytes, length, bytes.length - length, length)
      if (!read.bytesRead) break
      length += read.bytesRead
    }
    if (length !== opened.size) throw error(code)
    return bytes.subarray(0, length)
  } finally { await handle.close() }
}

function extractDocument(bytes, kind) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, 'document-worker.cjs'), {
      workerData: { bytes, kind }, resourceLimits: { maxOldGenerationSizeMb: 1024, maxYoungGenerationSizeMb: 64 },
      stdout: true, stderr: true
    })
    // Do not forward parser diagnostics or document fragments into application logs.
    worker.stdout.resume()
    worker.stderr.resume()
    let settled = false
    const finish = (err, text) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      void worker.terminate()
      if (err) reject(err); else resolve(text)
    }
    const timer = setTimeout(() => finish(error('EXTRACTION_TIMEOUT')), 300000)
    worker.once('message', result => {
      if (result.error) return finish(error(result.error))
      if (typeof result.text !== 'string' || result.text.length > MAX_TEXT) return finish(error('EXTRACTION_FAILED'))
      finish(null, result.text)
    })
    worker.once('error', () => finish(error('EXTRACTION_FAILED')))
    worker.once('exit', () => { if (!settled) finish(error('EXTRACTION_FAILED')) })
  })
}

function validEntry(item) {
  return item && ID.test(item.id) && ID.test(item.textHash) &&
    typeof item.name === 'string' && item.name.length > 0 && item.name.length <= 160 && !/[\\/\x00-\x1f]/.test(item.name) &&
    ['text', 'pdf', 'docx', 'xlsx', 'pptx', 'image', 'video'].includes(item.kind) && item.status === 'ready' && ['attachment', 'artifact'].includes(item.origin) &&
    (item.source === undefined || typeof item.source === 'string' && item.source.length <= 1024 && !/[\x00-\x1f]/.test(item.source)) &&
    Number.isInteger(item.size) && item.size > 0 && item.size <= (item.kind === 'video' ? MAX_VIDEO : MAX_FILE) &&
    Number.isInteger(item.characters) && (['image', 'video'].includes(item.kind) ? item.characters === 0 : item.characters > 0) && item.characters <= MAX_TEXT &&
    typeof item.createdAt === 'string' && Number.isFinite(Date.parse(item.createdAt)) &&
    (item.audioHash === undefined || item.kind === 'video' && ID.test(item.audioHash) && Number.isFinite(item.audioSeconds) && item.audioSeconds > 0 && item.audioSeconds <= 3600 && typeof item.audioTruncated === 'boolean')
}

function metadata(item) {
  const { id, name, kind, status, origin, size, characters, createdAt, source } = item
  return { id, name, kind, status, origin, size, characters, createdAt, ...(source ? { source } : {}), ...(item.audioHash ? { audioSeconds: item.audioSeconds, audioTruncated: item.audioTruncated } : {}) }
}

function createAssetLibrary({ directory, protectedRoots = [], prepareImage = null, prepareVideo = null }) {
  if (!path.isAbsolute(directory) || !Array.isArray(protectedRoots) || !protectedRoots.every(root => path.isAbsolute(root))) throw error('INVALID_INPUT')
  directory = path.resolve(directory)
  const indexPath = path.join(directory, 'index.json')
  let pending = Promise.resolve()

  async function ensureDirectory() {
    await fs.mkdir(directory, { recursive: true })
    if (!await isDirectEntry(directory)) throw error('PROTECTED_RESOURCE')
  }

  async function load() {
    await ensureDirectory()
    let bytes
    try { bytes = await regularBytes(indexPath, MAX_INDEX, 'LIBRARY_CORRUPT') }
    catch (failure) { if (failure.code === 'ENOENT') return { version: 1, assets: [] }; throw failure }
    try {
      const data = JSON.parse(bytes.toString('utf8'))
      if (data.version !== 1 || !Array.isArray(data.assets) || data.assets.length > MAX_ASSETS ||
          !data.assets.every(validEntry) || new Set(data.assets.map(item => item.id)).size !== data.assets.length) throw error('LIBRARY_CORRUPT')
      return { version: 1, assets: data.assets.map(item => ({ ...metadata(item), textHash: item.textHash, ...(item.audioHash ? { audioHash: item.audioHash } : {}) })) }
    } catch { throw error('LIBRARY_CORRUPT') }
  }

  async function immutable(file, bytes) {
    try { await fs.writeFile(file, bytes, { flag: 'wx', mode: 0o600 }) }
    catch (failure) {
      if (failure.code !== 'EEXIST') throw failure
      const existing = await regularBytes(file, MAX_FILE, 'LIBRARY_CORRUPT')
      if (digest(existing) !== digest(bytes)) throw error('LIBRARY_CORRUPT')
    }
  }

  async function commit(data) {
    const temporary = path.join(directory, `${randomUUID()}.tmp`)
    try {
      await fs.writeFile(temporary, JSON.stringify(data), { flag: 'wx', mode: 0o600 })
      await replaceFile(temporary, indexPath)
    } finally { await fs.unlink(temporary).catch(failure => { if (failure.code !== 'ENOENT') throw failure }) }
  }

  // Files NAJD itself generated for the user (after an approved write) join the same
  // persistent library so they can be found, reopened and attached again.
  function addArtifact({ name, text, source }) {
    const operation = pending.then(async () => {
      if (typeof text !== 'string' || !text.trim() || text.length > MAX_TEXT || typeof name !== 'string' || !name.trim() ||
          typeof source !== 'string' || !path.isAbsolute(source) || source.length > 1024 || /[\x00-\x1f]/.test(source)) throw error('INVALID_INPUT')
      const bytes = Buffer.from(text, 'utf8')
      const id = digest(bytes)
      const data = await load()
      const existing = data.assets.find(item => item.id === id)
      if (existing) return metadata(existing)
      if (data.assets.length >= MAX_ASSETS) throw error('LIBRARY_LIMIT')
      const clean = path.basename(name).replace(/[\\/\x00-\x1f]/g, '').slice(0, 160) || 'artifact.txt'
      const item = { id, name: clean, kind: 'text', status: 'ready', origin: 'artifact', source, size: bytes.length,
        characters: text.length, textHash: id, createdAt: new Date().toISOString() }
      await immutable(path.join(directory, `${id}.blob`), bytes)
      await immutable(path.join(directory, `${id}.txt`), bytes)
      data.assets.push(item)
      await commit(data)
      return metadata(item)
    })
    pending = operation.then(() => {}, () => {})
    return operation
  }

  function remove(id) {
    const operation = pending.then(async () => {
      if (typeof id !== 'string' || !ID.test(id)) throw error('INVALID_INPUT')
      const data = await load()
      if (!data.assets.some(item => item.id === id)) throw error('NOT_FOUND')
      data.assets = data.assets.filter(item => item.id !== id)
      await commit(data)
      for (const extension of ['blob', 'txt', 'wav']) await fs.unlink(path.join(directory, `${id}.${extension}`)).catch(failure => { if (failure.code !== 'ENOENT') throw failure })
      return true
    })
    pending = operation.then(() => {}, () => {})
    return operation
  }

  // Videos are hashed by streaming and never copied: the library keeps sampled frames and, when present, a 16 kHz sound track.
  async function importVideo(source, resolved, name) {
    const stat = await fs.lstat(source)
    if (!stat.isFile() || stat.isSymbolicLink() || !stat.size || stat.size > MAX_VIDEO) throw error('INVALID_INPUT')
    const hash = createHash('sha256')
    for await (const chunk of require('node:fs').createReadStream(resolved)) hash.update(chunk)
    const id = hash.digest('hex'), data = await load()
    const existing = data.assets.find(item => item.id === id)
    if (existing) return metadata(existing)
    if (data.assets.length >= MAX_ASSETS) throw error('LIBRARY_LIMIT')
    let prepared
    try { prepared = await prepareVideo(resolved) } catch { throw error('UNSUPPORTED_FORMAT') }
    if (!prepared || !Array.isArray(prepared.frames) || !prepared.frames.length || prepared.frames.length > 12) throw error('UNSUPPORTED_FORMAT')
    const payload = Buffer.from(JSON.stringify({ duration: prepared.duration, width: prepared.width, height: prepared.height,
      frames: prepared.frames.map(frame => ({ time: frame.time, jpeg: frame.jpeg.toString('base64') })) }))
    if (payload.length > MAX_FRAMES_PAYLOAD) throw error('UNSUPPORTED_FORMAT')
    const item = { id, name: name.replace(/[\x00-\x1f]/g, '').slice(0, 160), kind: 'video', status: 'ready', origin: 'attachment',
      size: stat.size, characters: 0, textHash: digest(payload), createdAt: new Date().toISOString() }
    // The sound track (16 kHz mono WAV) is kept locally for optional, approved transcription.
    const wav = prepared.audio?.wav
    if (Buffer.isBuffer(wav) && wav.length > 44 && wav.length <= MAX_AUDIO && Number.isFinite(prepared.audio.seconds)) {
      await immutable(path.join(directory, `${id}.wav`), wav)
      Object.assign(item, { audioHash: digest(wav), audioSeconds: prepared.audio.seconds, audioTruncated: prepared.audio.truncated === true })
    }
    await immutable(path.join(directory, `${id}.txt`), payload)
    data.assets.push(item)
    await commit(data)
    return metadata(item)
  }

  function importFile(source) {
    const operation = pending.then(async () => {
      if (typeof source !== 'string' || !path.isAbsolute(source) || source.includes('\0') || /:/.test(source.slice(process.platform === 'win32' ? 2 : 0))) throw error('INVALID_INPUT')
      const name = path.basename(source)
      if (sensitive(name)) throw error('PROTECTED_RESOURCE')
      const resolved = await fs.realpath(source)
      // Compare canonical paths on both sides so aliases (short names, junctions) cannot bypass protection.
      const canonical = async root => { try { return await fs.realpath(root) } catch (failure) { if (failure.code === 'ENOENT') return path.resolve(root); throw error('PROTECTED_RESOURCE') } }
      const guarded = await Promise.all([...protectedRoots, directory].map(canonical))
      if (guarded.some(root => within(root, resolved))) throw error('PROTECTED_RESOURCE')
      const extension = path.extname(name).toLowerCase()
      let kind = TEXT_EXTENSIONS.has(extension) ? 'text' : extension === '.pdf' ? 'pdf' : extension === '.docx' ? 'docx' : extension === '.xlsx' ? 'xlsx' : extension === '.pptx' ? 'pptx' : IMAGE_EXTENSIONS.has(extension) && prepareImage ? 'image' : null
      if (!kind && VIDEO_EXTENSIONS.has(extension) && prepareVideo) return importVideo(source, resolved, name)
      // Any other file that is plain UTF-8 text (no NUL bytes) is read as text, unless its extension names a program,
      // a picture or a video (which are never read as text).
      const sniff = !kind && !NEVER_TEXT.test(extension) && !IMAGE_EXTENSIONS.has(extension) && !VIDEO_EXTENSIONS.has(extension)
      if (!kind && !sniff) throw error('UNSUPPORTED_FORMAT')
      if (!kind && (await fs.stat(resolved)).size > MAX_FILE) throw error('UNSUPPORTED_FORMAT')
      const bytes = await regularBytes(source, MAX_FILE, 'INVALID_INPUT')
      if (!kind && plainText(bytes)) kind = 'text'
      if (!kind) throw error('UNSUPPORTED_FORMAT')
      if (!bytes.length) throw error('NO_EXTRACTABLE_TEXT')
      const id = digest(bytes)
      const data = await load()
      const existing = data.assets.find(item => item.id === id)
      if (existing) { if (!['image', 'video'].includes(existing.kind)) await verifiedText(existing); return metadata(existing) }
      if (data.assets.length >= MAX_ASSETS) throw error('LIBRARY_LIMIT')
      if (kind === 'image') {
        // Only a decoded, bounded re-encoding is ever sent to a model; the original is kept as imported.
        let prepared
        try { prepared = await prepareImage(bytes) } catch { throw error('UNSUPPORTED_FORMAT') }
        if (!Buffer.isBuffer(prepared) || !prepared.length || prepared.length > MAX_IMAGE) throw error('UNSUPPORTED_FORMAT')
        const item = { id, name: name.replace(/[\x00-\x1f]/g, '').slice(0, 160), kind, status: 'ready', origin: 'attachment',
          size: bytes.length, characters: 0, textHash: digest(prepared), createdAt: new Date().toISOString() }
        await immutable(path.join(directory, `${id}.blob`), bytes)
        await immutable(path.join(directory, `${id}.txt`), prepared)
        data.assets.push(item)
        await commit(data)
        return metadata(item)
      }
      const text = await extractDocument(bytes, kind)
      const textBytes = Buffer.from(text, 'utf8')
      const item = { id, name: name.replace(/[\x00-\x1f]/g, '').slice(0, 160), kind, status: 'ready', origin: 'attachment',
        size: bytes.length, characters: text.length, textHash: digest(textBytes), createdAt: new Date().toISOString() }
      await immutable(path.join(directory, `${id}.blob`), bytes)
      await immutable(path.join(directory, `${id}.txt`), textBytes)
      data.assets.push(item)
      await commit(data)
      return metadata(item)
    })
    pending = operation.then(() => {}, () => {})
    return operation
  }

  async function verifiedText(item) {
    if (decideAction('library.read', { kind: 'library', validated: true }).decision !== 'allow') throw error('PROTECTED_RESOURCE')
    let bytes
    try { bytes = await regularBytes(path.join(directory, `${item.id}.txt`), MAX_TEXT * 4, 'LIBRARY_CORRUPT') }
    catch { throw error('LIBRARY_CORRUPT') }
    if (digest(bytes) !== item.textHash) throw error('LIBRARY_CORRUPT')
    return bytes.toString('utf8')
  }

  async function list() { await pending; return (await load()).assets.map(metadata) }

  async function read(id, { offset = 0, limit = 8000 } = {}) {
    if (typeof id !== 'string' || !ID.test(id) || !Number.isInteger(offset) || offset < 0 || offset > MAX_TEXT ||
        !Number.isInteger(limit) || limit < 1 || limit > 8000) throw error('INVALID_INPUT')
    await pending
    const item = (await load()).assets.find(entry => entry.id === id)
    if (!item) throw error('NOT_FOUND')
    if (item.kind === 'image') return { ...metadata(item), offset: 0, text: '[image: use the attached picture itself]', hasMore: false }
    if (item.kind === 'video') return { ...metadata(item), offset: 0, text: item.audioHash ? '[video: use the attached sampled frames; its sound can be transcribed with najd_video_transcribe (paid, needs approval)]' : '[video: use the attached sampled frames; no usable sound track was stored]', hasMore: false }
    const text = await verifiedText(item)
    return { ...metadata(item), offset, text: text.slice(offset, offset + limit), hasMore: offset + limit < text.length }
  }

  async function search(query, ids) {
    if (typeof query !== 'string' || !query.trim() || query.length > 200 ||
        ids !== undefined && (!Array.isArray(ids) || ids.length > MAX_ASSETS || !ids.every(id => typeof id === 'string' && ID.test(id)))) throw error('INVALID_INPUT')
    await pending
    const results = []
    const needle = query.trim().toLowerCase()
    for (const item of (await load()).assets) {
      if (ids && !ids.includes(item.id) || ['image', 'video'].includes(item.kind)) continue
      const text = await verifiedText(item)
      const position = text.toLowerCase().indexOf(needle)
      if (position < 0) continue
      const offset = Math.max(0, position - 100)
      results.push({ id: item.id, name: item.name, offset, excerpt: text.slice(offset, offset + 600) })
      if (results.length >= 12) break
    }
    return results
  }
  async function image(id) {
    if (typeof id !== 'string' || !ID.test(id)) throw error('INVALID_INPUT')
    await pending
    const item = (await load()).assets.find(entry => entry.id === id)
    if (!item || item.kind !== 'image') throw error('NOT_FOUND')
    let bytes
    try { bytes = await regularBytes(path.join(directory, `${item.id}.txt`), MAX_IMAGE, 'LIBRARY_CORRUPT') } catch { throw error('LIBRARY_CORRUPT') }
    if (digest(bytes) !== item.textHash) throw error('LIBRARY_CORRUPT')
    return 'data:image/jpeg;base64,' + bytes.toString('base64')
  }
  async function video(id) {
    if (typeof id !== 'string' || !ID.test(id)) throw error('INVALID_INPUT')
    await pending
    const item = (await load()).assets.find(entry => entry.id === id)
    if (!item || item.kind !== 'video') throw error('NOT_FOUND')
    let bytes
    try { bytes = await regularBytes(path.join(directory, `${item.id}.txt`), MAX_FRAMES_PAYLOAD, 'LIBRARY_CORRUPT') } catch { throw error('LIBRARY_CORRUPT') }
    if (digest(bytes) !== item.textHash) throw error('LIBRARY_CORRUPT')
    const value = JSON.parse(bytes.toString('utf8'))
    return { duration: value.duration, width: value.width, height: value.height, frames: value.frames.map(frame => ({ time: frame.time, url: 'data:image/jpeg;base64,' + frame.jpeg })) }
  }
  // The stored sound track of a video, verified against its recorded hash.
  async function audio(id) {
    if (typeof id !== 'string' || !ID.test(id)) throw error('INVALID_INPUT')
    await pending
    const item = (await load()).assets.find(entry => entry.id === id)
    if (!item || item.kind !== 'video') throw error('NOT_FOUND')
    if (!item.audioHash) throw error('NO_AUDIO')
    let bytes
    try { bytes = await regularBytes(path.join(directory, `${item.id}.wav`), MAX_AUDIO, 'LIBRARY_CORRUPT') } catch { throw error('LIBRARY_CORRUPT') }
    if (digest(bytes) !== item.audioHash) throw error('LIBRARY_CORRUPT')
    return { wav: bytes, seconds: item.audioSeconds, truncated: item.audioTruncated }
  }
  // The whole verified text of a document, for indexing a knowledge base in main (R-057).
  async function fullText(id) {
    if (typeof id !== 'string' || !ID.test(id)) throw error('INVALID_INPUT')
    await pending
    const item = (await load()).assets.find(entry => entry.id === id)
    if (!item) throw error('NOT_FOUND')
    return ['image', 'video'].includes(item.kind) ? { ...metadata(item), text: '' } : { ...metadata(item), textHash: item.textHash, text: await verifiedText(item) }
  }
  // The original bytes of an attached or generated file, verified against its content id (videos keep no copy), so it can be opened.
  async function original(id) {
    if (typeof id !== 'string' || !ID.test(id)) throw error('INVALID_INPUT')
    await pending
    const item = (await load()).assets.find(entry => entry.id === id)
    if (!item) throw error('NOT_FOUND')
    if (item.kind === 'video') throw error('NOT_AVAILABLE')
    let bytes
    try { bytes = await regularBytes(path.join(directory, `${item.id}.blob`), MAX_FILE, 'LIBRARY_CORRUPT') } catch { throw error('LIBRARY_CORRUPT') }
    if (digest(bytes) !== item.id) throw error('LIBRARY_CORRUPT')
    return { name: item.name, bytes }
  }
  return { importFile, addArtifact, remove, list, read, search, fullText, image, video, audio, original }
}

module.exports = { createAssetLibrary }
