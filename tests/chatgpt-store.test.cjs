const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { randomBytes, createCipheriv, createDecipheriv } = require('node:crypto')
const { createChatGPTStore } = require('../electron/chatgpt-store.cjs')

test('protected ChatGPT state survives restart without plaintext tokens and keeps a stable host', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'najd-chatgpt-'))
  t.after(() => fs.rm(dir, { recursive: true, force: true }))
  const filePath = path.join(dir, 'chatgpt.json')
  const key = randomBytes(32)
  const encryption = {
    isAsyncEncryptionAvailable: async () => true,
    encryptStringAsync: async text => {
      const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv)
      const ciphertext = Buffer.concat([cipher.update(text), cipher.final()])
      return Buffer.concat([iv, cipher.getAuthTag(), ciphertext])
    },
    decryptStringAsync: async bytes => {
      const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12))
      decipher.setAuthTag(bytes.subarray(12, 28))
      return { result: Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8') }
    }
  }
  const store = createChatGPTStore({ filePath, encryption })
  const first = await store.update(data => {
    data.accounts.push({ id: 'test', clientId: 'oaiapp_test', subject: 'test-user', label: 'Test', tokens: {
      accessToken: 'PRIVATE-ACCESS', refreshToken: 'PRIVATE-REFRESH', idToken: 'PRIVATE-ID', scopes: ['chatgpt.tokens.use.direct'], expiresAt: Date.now() + 3600000
    } })
    data.activeId = 'test'
  })
  const raw = await fs.readFile(filePath, 'utf8')
  assert.equal(raw.includes('PRIVATE-ACCESS'), false)
  const restored = await createChatGPTStore({ filePath, encryption }).read()
  assert.deepEqual(restored, first)
  await fs.writeFile(filePath, 'corrupt')
  await assert.rejects(createChatGPTStore({ filePath, encryption }).update(() => {}), { code: 'CREDENTIAL_UNAVAILABLE' })
  assert.equal(await fs.readFile(filePath, 'utf8'), 'corrupt')
})

test('cancellation during encryption does not commit credentials', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'najd-chatgpt-'))
  t.after(() => fs.rm(dir, { recursive: true, force: true }))
  const filePath = path.join(dir, 'chatgpt.json')
  const controller = new AbortController()
  const store = createChatGPTStore({ filePath, encryption: {
    isAsyncEncryptionAvailable: async () => true,
    encryptStringAsync: async text => { controller.abort(); return Buffer.from(text) }
  } })
  await assert.rejects(store.update(() => {}, { signal: controller.signal }), { code: 'CANCELLED' })
  await assert.rejects(fs.stat(filePath), { code: 'ENOENT' })
})


test('lost encryption key fails closed; explicit reset preserves the unreadable record aside', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'najd-chatgpt-'))
  t.after(() => fs.rm(dir, { recursive: true, force: true }))
  const filePath = path.join(dir, 'chatgpt.json')
  const makeEncryption = key => ({
    isAsyncEncryptionAvailable: async () => true,
    encryptStringAsync: async text => {
      const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv)
      const ciphertext = Buffer.concat([cipher.update(text), cipher.final()])
      return Buffer.concat([iv, cipher.getAuthTag(), ciphertext])
    },
    decryptStringAsync: async bytes => {
      const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12))
      decipher.setAuthTag(bytes.subarray(12, 28))
      return { result: Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8') }
    }
  })
  // First session writes state protected by key A (the OS key that a crash later loses).
  const before = await createChatGPTStore({ filePath, encryption: makeEncryption(randomBytes(32)) }).update(data => {
    data.accounts.push({ id: 'lost', clientId: 'oaiapp_lost', subject: 'lost-user', label: 'Lost', tokens: null })
  })
  // After an abrupt termination the OS key is gone: a new store cannot decrypt the record.
  const locked = createChatGPTStore({ filePath, encryption: makeEncryption(randomBytes(32)) })
  await assert.rejects(locked.read(), { code: 'CREDENTIAL_UNAVAILABLE' })
  await assert.rejects(locked.update(() => {}), { code: 'CREDENTIAL_UNAVAILABLE' })
  // Explicit recovery moves the unreadable record aside untouched and starts fresh.
  const fresh = await locked.reset()
  assert.deepEqual(fresh.accounts, [])
  const names = await fs.readdir(dir)
  const backup = names.filter(name => name.startsWith('chatgpt.json.unreadable-'))
  assert.equal(backup.length, 1)
  const preserved = JSON.parse(await fs.readFile(path.join(dir, backup[0]), 'utf8'))
  assert.equal(preserved.version, 1)
  assert.equal(typeof preserved.encrypted, 'string')
  const after = await locked.update(data => { data.hostId = before.hostId })
  assert.equal(after.hostId, before.hostId)
  assert.equal((await createChatGPTStore({ filePath, encryption: makeEncryption(randomBytes(32)) }).read().then(() => 'ok', error => error.code)), 'CREDENTIAL_UNAVAILABLE')
})

test('reset refuses while encryption is unavailable and keeps the record', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'najd-chatgpt-'))
  t.after(() => fs.rm(dir, { recursive: true, force: true }))
  const filePath = path.join(dir, 'chatgpt.json')
  await fs.writeFile(filePath, 'corrupt')
  const store = createChatGPTStore({ filePath, encryption: { isAsyncEncryptionAvailable: async () => false } })
  await assert.rejects(store.reset(), { code: 'CREDENTIAL_UNAVAILABLE' })
  assert.equal(await fs.readFile(filePath, 'utf8'), 'corrupt')
  assert.deepEqual(await fs.readdir(dir), ['chatgpt.json'])
})
