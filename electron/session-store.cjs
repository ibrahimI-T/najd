const fs = require('node:fs/promises')
const { replaceFile } = require('./atomic-file.cjs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { validActivity, sanitizeActivity } = require('./task-activity.cjs')

const MAX_SESSIONS = 5000
const MAX_MESSAGES = 50000
const MAX_FILE_BYTES = 256 * 1024 * 1024
const sessionIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function storeError(code) { return Object.assign(new Error(code), { code }) }
function validId(id) { return typeof id === 'string' && sessionIdPattern.test(id) }
function validAttachments(items) {
  return Array.isArray(items) && items.length <= 8 && items.every(item => item &&
    typeof item.id === 'string' && /^[a-f0-9]{64}$/.test(item.id) && typeof item.name === 'string' &&
    item.name.length > 0 && item.name.length <= 160 && !/[\\/\x00-\x1f]/.test(item.name) &&
    Object.keys(item).every(key => ['id', 'name'].includes(key)))
}
function validMessage(message) {
  return message && (message.role === 'user' || message.role === 'assistant') &&
    typeof message.text === 'string' && message.text.trim().length > 0 &&
    message.text.length <= (message.role === 'user' ? 4000000 : 4000000) &&
    typeof message.createdAt === 'string' && Number.isFinite(Date.parse(message.createdAt)) &&
    (message.activity === undefined || message.role === 'assistant' && validActivity(message.activity)) &&
    (message.attachments === undefined || message.role === 'user' && validAttachments(message.attachments))
}
function validSession(session) {
  return session && validId(session.id) && typeof session.title === 'string' && session.title.length <= 60 &&
    typeof session.createdAt === 'string' && Number.isFinite(Date.parse(session.createdAt)) &&
    typeof session.updatedAt === 'string' && Number.isFinite(Date.parse(session.updatedAt)) &&
    Array.isArray(session.messages) && session.messages.length <= MAX_MESSAGES && session.messages.every(validMessage)
}

function createSessionStore(filePath) {
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) throw storeError('INVALID_INPUT')
  let data = null
  let loading = null
  let pending = Promise.resolve()

  async function load() {
    if (data) return data
    if (!loading) loading = (async () => {
      let bytes
      try { bytes = await fs.readFile(filePath) }
      catch (error) {
        if (error.code === 'ENOENT') return { version: 1, sessions: [] }
        throw error
      }
      if (bytes.length > MAX_FILE_BYTES) throw storeError('HISTORY_CORRUPT')
      try {
        const parsed = JSON.parse(bytes.toString('utf8'))
        if (parsed.version !== 1 || !Array.isArray(parsed.sessions) || parsed.sessions.length > MAX_SESSIONS ||
            !parsed.sessions.every(validSession) || new Set(parsed.sessions.map(session => session.id)).size !== parsed.sessions.length) {
          throw storeError('HISTORY_CORRUPT')
        }
        for (const session of parsed.sessions) for (const message of session.messages) if (message.activity) sanitizeActivity(message.activity)
        return parsed
      } catch { throw storeError('HISTORY_CORRUPT') }
    })()
    try { data = await loading; return data }
    finally { loading = null }
  }

  async function save(next) {
    const serialized = JSON.stringify(next)
    if (Buffer.byteLength(serialized) > MAX_FILE_BYTES) throw storeError('HISTORY_LIMIT')
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    const temporary = `${filePath}.${randomUUID()}.tmp`
    try {
      await fs.writeFile(temporary, serialized, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
      await replaceFile(temporary, filePath)
    } finally {
      await fs.unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error })
    }
  }

  function mutate(change) {
    const operation = pending.then(async () => {
      const next = structuredClone(await load())
      const result = change(next)
      await save(next)
      data = next
      return structuredClone(result)
    })
    pending = operation.then(() => {}, () => {})
    return operation
  }

  async function listSessions() {
    await pending
    return (await load()).sessions.map(({ id, title, updatedAt, messages }) =>
      ({ id, title, updatedAt, messageCount: messages.length }))
  }

  async function searchSessions(query) {
    if (typeof query !== 'string' || !query.trim() || query.length > 100) throw storeError('INVALID_INPUT')
    await pending
    const needle = query.trim().toLowerCase()
    return (await load()).sessions.flatMap(session => {
      const match = session.messages.find(message => message.text.toLowerCase().includes(needle))
      if (!session.title.toLowerCase().includes(needle) && !match) return []
      const text = match?.text.replace(/\s+/g, ' ') || ''
      const position = text.toLowerCase().indexOf(needle)
      const snippet = match ? text.slice(Math.max(0, position - 35), Math.max(0, position - 35) + 120) : ''
      return [{ id: session.id, title: session.title, updatedAt: session.updatedAt,
        messageCount: session.messages.length, snippet }]
    }).slice(0, 30)
  }

  async function getSession(id) {
    if (!validId(id)) throw storeError('INVALID_INPUT')
    await pending
    const session = (await load()).sessions.find(item => item.id === id)
    if (!session) throw storeError('NOT_FOUND')
    return structuredClone(session)
  }

  function createSession() {
    return mutate(next => {
      if (next.sessions.length >= MAX_SESSIONS) throw storeError('HISTORY_LIMIT')
      const now = new Date().toISOString()
      const session = { id: randomUUID(), title: '', createdAt: now, updatedAt: now, messages: [] }
      next.sessions.unshift(session)
      return session
    })
  }

  async function appendMessage(id, role, text, activity, attachments) {
    if (attachments !== undefined && (role !== 'user' || !validAttachments(attachments))) throw storeError('INVALID_INPUT')
    if (activity !== undefined && (role !== 'assistant' || !validActivity(activity))) throw storeError('INVALID_INPUT')
    if (!validId(id) || (role !== 'user' && role !== 'assistant') || typeof text !== 'string' ||
        !text.trim() || text.length > (role === 'user' ? 4000000 : 4000000)) throw storeError('INVALID_INPUT')
    return mutate(next => {
      const index = next.sessions.findIndex(item => item.id === id)
      if (index < 0) throw storeError('NOT_FOUND')
      const session = next.sessions[index]
      if (session.messages.length >= MAX_MESSAGES) throw storeError('HISTORY_LIMIT')
      const message = { role, text: text.trim(), createdAt: new Date().toISOString() }
      if (activity !== undefined) message.activity = structuredClone(activity)
      if (attachments?.length) message.attachments = structuredClone(attachments)
      session.messages.push(message)
      if (role === 'user' && !session.title) session.title = message.text.slice(0, 60)
      session.updatedAt = message.createdAt
      next.sessions.splice(index, 1)
      next.sessions.unshift(session)
      return session
    })
  }

  async function deleteSession(id) {
    if (!validId(id)) throw storeError('INVALID_INPUT')
    return mutate(next => {
      const index = next.sessions.findIndex(item => item.id === id)
      if (index < 0) return false
      next.sessions.splice(index, 1)
      return true
    })
  }

  return { listSessions, searchSessions, getSession, createSession, appendMessage, deleteSession }
}

module.exports = { createSessionStore }
