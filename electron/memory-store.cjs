const fs = require('node:fs/promises')
const { replaceFile } = require('./atomic-file.cjs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const MAX_BYTES = 64 * 1024 * 1024
const MAX_NOTES = 5000
const fail = code => Object.assign(new Error(code), { code })
const fields = ['id', 'title', 'text', 'createdAt', 'updatedAt']
const validId = id => typeof id === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id)
const validText = (value, limit) => typeof value === 'string' && value.trim().length > 0 && value.length <= limit && !/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value)
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join(',') === [...keys].sort().join(',')
const validTime = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value
const empty = () => ({ format: 'najd-memory', version: 1, notes: [] })

function parseSnapshot(raw) {
  if (typeof raw !== 'string' || Buffer.byteLength(raw) > MAX_BYTES) throw fail('INVALID_INPUT')
  let value
  try { value = JSON.parse(raw) } catch { throw fail('INVALID_INPUT') }
  if (!exact(value, ['format', 'version', 'notes']) || value.format !== 'najd-memory' || value.version !== 1 ||
    !Array.isArray(value.notes) || value.notes.length > 5000 || value.notes.some(note => !exact(note, fields) ||
      !validId(note.id) || !validText(note.title, 80) || !validText(note.text, 100000) ||
      !validTime(note.createdAt) || !validTime(note.updatedAt) || note.updatedAt < note.createdAt) ||
    new Set(value.notes.map(note => note.id)).size !== value.notes.length) throw fail('INVALID_INPUT')
  return value
}

function createMemoryStore(filePath, { maxNotes = MAX_NOTES } = {}) {
  if (!path.isAbsolute(filePath || '')) throw fail('INVALID_INPUT')
  let queue = Promise.resolve(), unavailable = false
  function serial(work) { const result = queue.then(work); queue = result.catch(() => {}); return result }
  async function load() {
    if (unavailable) throw fail('MEMORY_STORE_UNAVAILABLE')
    try {
      const stat = await fs.lstat(filePath)
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_BYTES) throw fail('MEMORY_STORE_UNAVAILABLE')
      const handle = await fs.open(filePath, 'r')
      try {
        const buffer = Buffer.alloc(MAX_BYTES + 1), { bytesRead } = await handle.read(buffer)
        if (bytesRead > MAX_BYTES) throw fail('MEMORY_STORE_UNAVAILABLE')
        // Refuse malformed UTF-8 rather than silently rewriting replacement characters.
        return parseSnapshot(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, bytesRead)))
      } finally { await handle.close() }
    } catch (error) {
      if (error.code === 'ENOENT') return empty()
      unavailable = true
      throw fail('MEMORY_STORE_UNAVAILABLE')
    }
  }
  async function persist(value) {
    const bytes = JSON.stringify(value, null, 2) + '\n'
    if (value.notes.length > maxNotes || Buffer.byteLength(bytes) > MAX_BYTES) throw fail('MEMORY_LIMIT')
    try {
      await fs.mkdir(path.dirname(filePath), { recursive: true })
      const temporary = filePath + '.' + randomUUID() + '.tmp'
      await fs.writeFile(temporary, bytes, { flag: 'wx' })
      await replaceFile(temporary, filePath)
    } catch {
      unavailable = true
      throw fail('MEMORY_STORE_UNAVAILABLE')
    }
  }
  return {
    list: () => serial(async () => (await load()).notes),
    save: input => serial(async () => {
      if ((!exact(input, ['title', 'text']) && !exact(input, ['id', 'title', 'text'])) ||
        !validText(input.title, 80) || !validText(input.text, 100000) || ('id' in input && !validId(input.id))) throw fail('INVALID_INPUT')
      const value = await load(), existing = input.id ? value.notes.find(note => note.id === input.id) : null
      if (input.id && !existing) throw fail('INVALID_INPUT')
      const now = new Date(Math.max(Date.now(), existing ? Date.parse(existing.updatedAt) : 0)).toISOString()
      const note = { id: existing?.id || randomUUID(), title: input.title.trim(), text: input.text.trim(),
        createdAt: existing?.createdAt || now, updatedAt: now }
      if (existing) value.notes[value.notes.indexOf(existing)] = note
      else value.notes.push(note)
      await persist(value)
      return { ...note }
    }),
    remove: id => serial(async () => {
      if (!validId(id)) throw fail('INVALID_INPUT')
      const value = await load()
      value.notes = value.notes.filter(note => note.id !== id)
      await persist(value)
      return { removed: true }
    }),
    exportSnapshot: () => serial(async () => JSON.stringify(await load(), null, 2) + '\n'),
    importSnapshot: raw => serial(async () => {
      const incoming = parseSnapshot(raw), value = await load()
      for (const note of incoming.notes) {
        const existing = value.notes.find(item => item.id === note.id)
        if (existing && fields.some(field => existing[field] !== note[field])) throw fail('MEMORY_CONFLICT')
        if (!existing) value.notes.push(note)
      }
      await persist(value)
      return { count: value.notes.length }
    })
  }
}

// Called only with a main-owned native file-picker result, never a renderer path.
async function readMemoryBackup(filePath) {
  try {
    const stat = await fs.lstat(filePath)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_BYTES) throw fail('INVALID_INPUT')
    const handle = await fs.open(filePath, 'r')
    try {
      const buffer = Buffer.alloc(MAX_BYTES + 1), { bytesRead } = await handle.read(buffer)
      if (bytesRead > MAX_BYTES) throw fail('INVALID_INPUT')
      const raw = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, bytesRead))
      parseSnapshot(raw)
      return raw
    } finally { await handle.close() }
  } catch { throw fail('INVALID_INPUT') }
}
module.exports = { createMemoryStore, readMemoryBackup }
