const { mkdir, readFile, writeFile, unlink } = require('node:fs/promises')
const { replaceFile } = require('./atomic-file.cjs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')

function storeError(code) { return Object.assign(new Error(code), { code }) }

function createCredentialStore({ filePath, encryption, keyField = 'kimiCode', keyPattern = /^sk-kimi-[^\s]{1,500}$/ }) {
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath) || !encryption) throw storeError('INVALID_INPUT')
  if (!/^[a-zA-Z]{1,30}$/.test(keyField) || !(keyPattern instanceof RegExp)) throw storeError('INVALID_INPUT')
  let queue = Promise.resolve()
  const validKey = key => typeof key === 'string' && key.length <= 1024 && /^[\x21-\x7e]+$/.test(key) && keyPattern.test(key)
  function serialize(operation) {
    const work = queue.then(operation)
    queue = work.catch(() => {})
    return work
  }

  async function readRecord() {
    let raw
    try { raw = await readFile(filePath) }
    catch (error) {
      if (error.code === 'ENOENT') return null
      throw storeError('CREDENTIAL_UNAVAILABLE')
    }
    if (raw.length > 4096) throw storeError('CREDENTIAL_UNAVAILABLE')
    try {
      const record = JSON.parse(raw.toString('utf8'))
      if (record.version !== 1 || typeof record[keyField] !== 'string' || !/^[A-Za-z0-9+/=]+$/.test(record[keyField]) ||
          (record.verifiedModel != null && (typeof record.verifiedModel !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/.test(record.verifiedModel)))) throw new Error()
      return record
    } catch { throw storeError('CREDENTIAL_UNAVAILABLE') }
  }

  async function writeRecord(record, signal) {
    const directory = path.dirname(filePath)
    await mkdir(directory, { recursive: true })
    const temporary = path.join(directory, `.credentials-${randomUUID()}.tmp`)
    try {
      await writeFile(temporary, JSON.stringify(record), { flag: 'wx', mode: 0o600 })
      if (signal?.aborted) throw storeError('CANCELLED')
      await replaceFile(temporary, filePath)
    } finally { await unlink(temporary).catch(() => {}) }
  }

  async function decrypt(record) {
    if (!record) return null
    if (!await encryption.isAsyncEncryptionAvailable()) throw storeError('CREDENTIAL_UNAVAILABLE')
    try {
      const { result } = await encryption.decryptStringAsync(Buffer.from(record[keyField], 'base64'))
      if (!validKey(result)) throw new Error()
      return result
    } catch { throw storeError('CREDENTIAL_UNAVAILABLE') }
  }

  async function readKey() { await queue; return decrypt(await readRecord()) }
  async function status() {
    await queue
    const record = await readRecord()
    const saved = !!await decrypt(record)
    return { saved, verified: saved && !!record?.verifiedModel, verifiedModel: saved ? record?.verifiedModel || null : null }
  }
  function saveKey(key) {
    return serialize(async () => {
      if (!validKey(key)) throw storeError('INVALID_INPUT')
      await readRecord() // Do not overwrite a corrupt credential record.
      if (!await encryption.isAsyncEncryptionAvailable()) throw storeError('CREDENTIAL_UNAVAILABLE')
      const encrypted = await encryption.encryptStringAsync(key)
      await writeRecord({ version: 1, [keyField]: encrypted.toString('base64'), verifiedModel: null })
      return { saved: true }
    })
  }
  function markVerified(expectedKey, modelName, signal) {
    return serialize(async () => {
      if (!validKey(expectedKey) || (modelName !== null && !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/.test(modelName || ''))) throw storeError('INVALID_INPUT')
      const record = await readRecord()
      if (await decrypt(record) !== expectedKey) throw storeError('CREDENTIAL_CHANGED')
      if (signal?.aborted) throw storeError('CANCELLED')
      await writeRecord({ ...record, verifiedModel: modelName }, signal)
    })
  }
  function clearKey() {
    return serialize(async () => {
      try { await unlink(filePath) }
      catch (error) { if (error.code !== 'ENOENT') throw storeError('CREDENTIAL_UNAVAILABLE') }
      return { saved: false }
    })
  }

  return { saveKey, readKey, status, clearKey, markVerified,
    saveKimiKey: saveKey, readKimiKey: readKey, kimiStatus: async () => ({ saved: !!await readKey() }), clearKimiKey: clearKey }
}

module.exports = { createCredentialStore }
