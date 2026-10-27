// Bounded ZIP extraction/comparison runs off Electron's main event loop.
const { isDirectEntrySync } = require('./path-identity.cjs')
const fs = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { parentPort, workerData } = require('node:worker_threads')
const { Unzip, UnzipInflate } = require('fflate')
const opened = new Set(), files = new Set(), directories = new Set(), entries = new Set()
const fail = () => { throw Error('RUNTIME_ARCHIVE_INVALID') }
let total = 0, fileCount = 0, completed = 0
try {
  const { archive, directory, mode, sha512, progress, sync = true } = workerData
  if (!['extract', 'verify'].includes(mode) || !path.isAbsolute(archive) || !path.isAbsolute(directory)) fail()
  const root = path.resolve(directory), stat = fs.lstatSync(root)
  if (!stat.isDirectory() || stat.isSymbolicLink() || !isDirectEntrySync(root) || mode === 'extract' && fs.readdirSync(root).length) fail()
  const canonical = value => value.toLowerCase()
  function ensureDirectory(parts) {
    let current = root
    for (const part of parts) {
      current = path.join(current, part)
      directories.add(canonical(path.relative(root, current).split(path.sep).join('/')))
      let facts
      try { facts = fs.lstatSync(current) } catch (error) {
        if (error.code !== 'ENOENT' || mode !== 'extract') throw error
        fs.mkdirSync(current); facts = fs.lstatSync(current)
      }
      if (!facts.isDirectory() || facts.isSymbolicLink() || !isDirectEntrySync(current)) fail()
    }
  }
  const unzip = new Unzip(file => {
    if (++fileCount > 200000 || file.originalSize > 512 * 1024 ** 2 || ![0, 8].includes(file.compression)) fail()
    const isDirectory = file.name.endsWith('/'), name = isDirectory ? file.name.slice(0, -1) : file.name
    const parts = name.split('/')
    if (!name || name.length > 1024 || parts.some(part => !part || part === '.' || part === '..' || /[\x00-\x1f<>:"\\|?*]/.test(part) || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part))) fail()
    const key = canonical(name)
    if (entries.has(key)) fail()
    entries.add(key)
    ensureDirectory(isDirectory ? parts : parts.slice(0, -1))
    let handle, actualSize = 0
    if (!isDirectory) {
      files.add(key)
      const target = path.join(root, ...parts)
      if (mode === 'verify') {
        const facts = fs.lstatSync(target)
        if (!facts.isFile() || facts.isSymbolicLink() || !isDirectEntrySync(target)) fail()
      }
      handle = fs.openSync(target, mode === 'extract' ? 'wx' : 'r', 0o600)
      opened.add(handle)
    }
    file.ondata = (error, chunk, final) => {
      if (error) throw error
      total += chunk.length; actualSize += chunk.length
      if (total > 4 * 1024 ** 3 || actualSize > 512 * 1024 ** 2 || isDirectory && chunk.length) fail()
      if (!isDirectory) {
        let offset = 0
        while (offset < chunk.length) {
          if (mode === 'extract') {
            const count = fs.writeSync(handle, chunk, offset, chunk.length - offset)
            if (!count) fail()
            offset += count
          }
          else {
            const buffer = Buffer.alloc(Math.min(65536, chunk.length - offset)), count = fs.readSync(handle, buffer)
            if (!count || !buffer.subarray(0, count).equals(Buffer.from(chunk.subarray(offset, offset + count)))) fail()
            offset += count
          }
        }
      }
      if (final) {
        if (handle !== undefined) {
          if (fs.fstatSync(handle).size !== actualSize) fail()
          // Staged bundle unpacking is discarded if interrupted, so per-file sync is optional there.
          if (mode === 'extract' && sync) fs.fsyncSync(handle)
          fs.closeSync(handle); opened.delete(handle)
        }
        completed++
        // Optional coarse progress for visible first-run preparation.
        if (progress && completed % 250 === 0) parentPort.postMessage({ progress: completed })
      }
    }
    file.start()
  })
  unzip.register(UnzipInflate)
  const archiveFacts = fs.lstatSync(archive)
  if (!archiveFacts.isFile() || archiveFacts.isSymbolicLink() || archiveFacts.size > 2 * 1024 ** 3) fail()
  const input = fs.openSync(archive, 'r'), buffer = Buffer.alloc(65536), hash = createHash('sha512')
  opened.add(input)
  while (true) {
    const length = fs.readSync(input, buffer)
    if (!length) break
    hash.update(buffer.subarray(0, length))
    unzip.push(Buffer.from(buffer.subarray(0, length)), false)
  }
  unzip.push(new Uint8Array(0), true)
  fs.closeSync(input); opened.delete(input)
  if (!fileCount || completed !== fileCount || hash.digest('base64') !== sha512) fail()
  function checkExtras(current) {
    for (const item of fs.readdirSync(current, { withFileTypes: true })) {
      const target = path.join(current, item.name), relative = canonical(path.relative(root, target).split(path.sep).join('/'))
      if (item.isSymbolicLink()) fail()
      if (item.isDirectory()) { if (!directories.has(relative)) fail(); checkExtras(target) }
      else if (!item.isFile() || !files.has(relative)) fail()
    }
  }
  checkExtras(root)
  parentPort.postMessage({ files: files.size, bytes: total })
} catch {
  parentPort.postMessage({ error: 'RUNTIME_ARCHIVE_INVALID' })
} finally {
  for (const handle of opened) { try { fs.closeSync(handle) } catch {} }
}
