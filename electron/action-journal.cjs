// Durable intent metadata only. This service never executes a tool or model.
const { isDirectEntry } = require('./path-identity.cjs')
const { replaceFile } = require('./atomic-file.cjs')
const fs = require('node:fs/promises')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { decideAction } = require('./action-policy.cjs')
const fail = code => Object.assign(new Error(code), { code })
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value)
// RECONCILED_DONE / RECONCILED_NOT_DONE are the owner's own statement about an unconfirmed action (what NAJD could not verify); they never start anything.
const states = new Set(['AWAITING_APPROVAL', 'APPROVED', 'DENIED', 'EXECUTING', 'COMPLETED', 'FAILED', 'CANCELLED', 'UNKNOWN_EFFECT', 'RECONCILED_DONE', 'RECONCILED_NOT_DONE'])
const MAX_RECORDS = 5000, MAX_BYTES = 8 * 1024 * 1024
const intentKeys = ['intentId', 'operation', 'target', 'changeHash']
const recordKeys = [...intentKeys, 'id', 'nonce', 'state', 'createdAt', 'updatedAt']
function validIntent(value) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    typeof value.intentId === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value.intentId) &&
    typeof value.operation === 'string' && decideAction(value.operation).decision === 'approval' &&
    typeof value.target === 'string' && !!value.target.trim() && value.target.length <= 1024 && !/[\x00-\x1f]/.test(value.target) &&
    typeof value.changeHash === 'string' && /^[a-f0-9]{64}$/.test(value.changeHash)
}
function validRecord(value) {
  return validIntent(value) && Object.keys(value).length === recordKeys.length && Object.keys(value).every(key => recordKeys.includes(key)) &&
    uuid(value.id) && uuid(value.nonce) && states.has(value.state) &&
    [value.createdAt, value.updatedAt].every(time => typeof time === 'string' && time.length <= 30 && Number.isFinite(Date.parse(time)))
}

function createActionJournal({ filePath }) {
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) throw fail('INVALID_INPUT')
  let data
  let pending = Promise.resolve()
  async function save(next) {
    const bytes = JSON.stringify(next)
    if (Buffer.byteLength(bytes) > MAX_BYTES) throw fail('JOURNAL_LIMIT')
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    const temporary = `${filePath}.${randomUUID()}.tmp`
    try {
      const handle = await fs.open(temporary, 'wx', 0o600)
      try { await handle.writeFile(bytes, 'utf8'); await handle.sync() } finally { await handle.close() }
      await replaceFile(temporary, filePath)
    } finally { await fs.unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error }) }
  }
  async function load() {
    if (data) return data
    let bytes
    try {
      const stat = await fs.lstat(filePath)
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_BYTES) throw fail('JOURNAL_CORRUPT')
      if (!await isDirectEntry(filePath)) throw fail('JOURNAL_CORRUPT')
      bytes = await fs.readFile(filePath)
      if (bytes.length > MAX_BYTES) throw fail('JOURNAL_CORRUPT')
    } catch (error) { if (error.code === 'ENOENT') return { version: 1, actions: [] }; throw error }
    let parsed
    try {
      parsed = JSON.parse(bytes.toString('utf8'))
      if (parsed.version !== 1 || !Array.isArray(parsed.actions) || parsed.actions.length > MAX_RECORDS ||
          !parsed.actions.every(validRecord) || new Set(parsed.actions.map(item => item.id)).size !== parsed.actions.length ||
          new Set(parsed.actions.map(item => item.intentId)).size !== parsed.actions.length) throw fail('JOURNAL_CORRUPT')
    } catch { throw fail('JOURNAL_CORRUPT') }
    let recovered = false
    for (const record of parsed.actions) {
      let changed = false
      if (record.state === 'EXECUTING') { record.state = 'UNKNOWN_EFFECT'; changed = true }
      else if (['AWAITING_APPROVAL', 'APPROVED'].includes(record.state)) {
        record.state = 'AWAITING_APPROVAL'; record.nonce = randomUUID(); changed = true
      }
      if (changed) { record.updatedAt = new Date().toISOString(); recovered = true }
    }
    if (recovered) await save(parsed)
    data = parsed
    return data
  }
  function serialize(change, write = true) {
    const operation = pending.then(async () => {
      const next = structuredClone(await load())
      const result = await change(next)
      if (write) await save(next)
      data = next
      return structuredClone(result)
    })
    pending = operation.then(() => {}, () => {})
    return operation
  }
  function find(next, id) {
    if (!uuid(id)) throw fail('INVALID_INPUT')
    const record = next.actions.find(item => item.id === id)
    if (!record) throw fail('NOT_FOUND')
    return record
  }
  function update(record, state) { record.state = state; record.updatedAt = new Date().toISOString(); return record }
  async function prepare(intent) {
    if (!validIntent(intent) || Object.keys(intent).length !== intentKeys.length || Object.keys(intent).some(key => !intentKeys.includes(key))) throw fail('INVALID_INPUT')
    const captured = structuredClone(intent)
    return serialize(next => {
      const existing = next.actions.find(item => item.intentId === captured.intentId)
      if (existing) {
        if (!intentKeys.every(key => existing[key] === captured[key])) throw fail('CONFLICT')
        return existing
      }
      // A full journal drops its oldest settled records (never pending, executing or unconfirmed ones), so effects never stop because of history.
      if (next.actions.length >= MAX_RECORDS) {
        const settled = new Set(['DENIED', 'COMPLETED', 'FAILED', 'CANCELLED', 'RECONCILED_DONE', 'RECONCILED_NOT_DONE'])
        const keep = next.actions.length - Math.floor(MAX_RECORDS / 4)
        let drop = next.actions.length - keep
        next.actions = next.actions.filter(item => !(drop > 0 && settled.has(item.state) && drop-- > 0))
        if (next.actions.length >= MAX_RECORDS) throw fail('JOURNAL_LIMIT')
      }
      const now = new Date().toISOString()
      const record = { ...captured, id: randomUUID(), nonce: randomUUID(), state: 'AWAITING_APPROVAL', createdAt: now, updatedAt: now }
      next.actions.push(record)
      return record
    })
  }
  async function decide(id, nonce, decision) {
    if (!uuid(nonce) || !['ALLOW_ONCE', 'DENY'].includes(decision)) throw fail('CONFLICT')
    return serialize(next => {
      const record = find(next, id)
      if (record.state !== 'AWAITING_APPROVAL' || record.nonce !== nonce) throw fail('CONFLICT')
      return update(record, decision === 'ALLOW_ONCE' ? 'APPROVED' : 'DENIED')
    })
  }
  const claim = id => serialize(next => {
    const record = find(next, id)
    if (record.state !== 'APPROVED') throw fail('CONFLICT')
    return update(record, 'EXECUTING')
  })
  async function finish(id, verified) {
    if (typeof verified !== 'boolean' && verified !== 'failed') throw fail('INVALID_INPUT')
    return serialize(next => {
      const record = find(next, id)
      if (record.state !== 'EXECUTING') throw fail('CONFLICT')
      return update(record, verified === 'failed' ? 'FAILED' : verified ? 'COMPLETED' : 'UNKNOWN_EFFECT')
    })
  }
  const cancel = id => serialize(next => {
    const record = find(next, id)
    if (record.state === 'EXECUTING') return update(record, 'UNKNOWN_EFFECT')
    if (['AWAITING_APPROVAL', 'APPROVED'].includes(record.state)) return update(record, 'CANCELLED')
    return record
  })
  const get = id => serialize(next => find(next, id), false)
  // Main may abandon a persisted claim only when its executor was never dispatched.
  const abandon = id => serialize(next => {
    const record = find(next, id)
    if (!['APPROVED', 'EXECUTING'].includes(record.state)) throw fail('CONFLICT')
    return update(record, 'CANCELLED')
  })
  // The owner settles an unconfirmed action ('done' / 'not-done') or dismisses a stale approval ('dismiss'). Only those two starting states are accepted, every other
  // state conflicts, and nothing is executed or retried. The record keeps the owner's statement, not a verified fact.
  const reconcile = (id, resolution) => serialize(next => {
    const record = find(next, id)
    if (record.state === 'UNKNOWN_EFFECT' && resolution === 'done') return update(record, 'RECONCILED_DONE')
    if (record.state === 'UNKNOWN_EFFECT' && resolution === 'not-done') return update(record, 'RECONCILED_NOT_DONE')
    if (record.state === 'AWAITING_APPROVAL' && resolution === 'dismiss') return update(record, 'CANCELLED')
    throw fail('CONFLICT')
  })
  const list = () => serialize(next => next.actions, false)
  const flush = () => pending
  return { prepare, decide, claim, finish, cancel, abandon, reconcile, get, list, flush }
}
module.exports = { createActionJournal }
