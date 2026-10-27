const fs = require('node:fs/promises')
const { replaceFile } = require('./atomic-file.cjs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { providerError } = require('./provider-http.cjs')

function validState(data) {
  return data?.version === 1 && /^urn:uuid:[0-9a-f-]{36}$/i.test(data.hostId) &&
    Array.isArray(data.accounts) && data.accounts.length <= 10 &&
    new Set(data.accounts.map(a => a.id)).size === data.accounts.length &&
    data.accounts.every(a => a && typeof a.id === 'string' && typeof a.clientId === 'string' &&
      a.clientId !== 'dynamic_agent_client' && typeof a.subject === 'string' && typeof a.label === 'string' &&
      (a.tokens === null || (typeof a.tokens?.accessToken === 'string' && typeof a.tokens?.refreshToken === 'string' &&
        typeof a.tokens?.idToken === 'string' && Number.isFinite(a.tokens?.expiresAt) && Array.isArray(a.tokens.scopes)))) &&
    (data.activeId === null || data.accounts.some(a => a.id === data.activeId))
}

function createChatGPTStore({ filePath, encryption }) {
  if (!path.isAbsolute(filePath) || !encryption) throw providerError('INVALID_INPUT')
  let cached
  let loading
  let queue = Promise.resolve()

  async function loadOnce() {
    if (cached) return cached
    try {
      const bytes = await fs.readFile(filePath)
      if (bytes.length > 512 * 1024 || !await encryption.isAsyncEncryptionAvailable()) throw new Error()
      const record = JSON.parse(bytes.toString('utf8'))
      if (record.version !== 1 || typeof record.encrypted !== 'string') throw new Error()
      const { result } = await encryption.decryptStringAsync(Buffer.from(record.encrypted, 'base64'))
      const data = JSON.parse(result)
      if (!validState(data)) throw new Error()
      cached = data
    } catch (error) {
      if (error.code !== 'ENOENT') throw providerError('CREDENTIAL_UNAVAILABLE')
      cached = { version: 1, hostId: `urn:uuid:${randomUUID()}`, activeId: null, accounts: [] }
    }
    return cached
  }

  async function load() {
    if (cached) return cached
    if (!loading) loading = loadOnce()
    try { return await loading } finally { loading = null }
  }

  function update(change, { signal } = {}) {
    const work = queue.then(async () => {
      const next = structuredClone(await load())
      if (signal?.aborted) throw providerError('CANCELLED')
      change(next)
      if (!validState(next)) throw providerError('INVALID_INPUT')
      if (!await encryption.isAsyncEncryptionAvailable()) throw providerError('CREDENTIAL_UNAVAILABLE')
      const encrypted = await encryption.encryptStringAsync(JSON.stringify(next))
      if (signal?.aborted) throw providerError('CANCELLED')
      const serialized = JSON.stringify({ version: 1, encrypted: encrypted.toString('base64') })
      if (Buffer.byteLength(serialized) > 512 * 1024) throw providerError('CREDENTIAL_UNAVAILABLE')
      await fs.mkdir(path.dirname(filePath), { recursive: true })
      const temporary = `${filePath}.${randomUUID()}.tmp`
      try {
        await fs.writeFile(temporary, serialized, { flag: 'wx', mode: 0o600 })
        if (signal?.aborted) throw providerError('CANCELLED')
        await replaceFile(temporary, filePath)
      } finally { await fs.unlink(temporary).catch(() => {}) }
      cached = next
      return structuredClone(next)
    })
    queue = work.catch(() => {})
    return work
  }

  async function read() { await queue; return structuredClone(await load()) }
  function reset() {
    const work = queue.then(async () => {
      if (!await encryption.isAsyncEncryptionAvailable()) throw providerError('CREDENTIAL_UNAVAILABLE')
      try { await fs.rename(filePath, `${filePath}.unreadable-${Date.now()}`) }
      catch (error) { if (error.code !== 'ENOENT') throw providerError('CREDENTIAL_UNAVAILABLE') }
      cached = null
    })
    queue = work.catch(() => {})
    return work.then(() => update(() => {}))
  }
  return { read, update, reset }
}

module.exports = { createChatGPTStore }
