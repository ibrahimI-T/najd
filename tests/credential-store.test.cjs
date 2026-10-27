const { test } = require('node:test')
const assert = require('node:assert/strict')
const { mkdtemp, rm } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const path = require('node:path')
const { createCredentialStore } = require('../electron/credential-store.cjs')

test('credential store persists encrypted Kimi key and never returns it from status', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'najd-credentials-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const filePath = path.join(dir, 'credentials.json')
  const encryption = {
    isAsyncEncryptionAvailable: async () => true,
    encryptStringAsync: async value => Buffer.from(`sealed:${value}`),
    decryptStringAsync: async value => ({ result: value.toString().slice(7), shouldReEncrypt: false })
  }
  const store = createCredentialStore({ filePath, encryption })
  await store.saveKimiKey('sk-kimi-example')
  assert.deepEqual(await store.kimiStatus(), { saved: true })
  assert.equal(await store.readKimiKey(), 'sk-kimi-example')
  await store.clearKimiKey()
  assert.deepEqual(await store.kimiStatus(), { saved: false })
  assert.equal(await store.readKimiKey(), null)
})

test('provider keys are isolated and verification is bound to the current credential', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'najd-credentials-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const encryption = {
    isAsyncEncryptionAvailable: async () => true,
    encryptStringAsync: async value => Buffer.from(`sealed:${value}`),
    decryptStringAsync: async value => ({ result: value.toString().slice(7) })
  }
  const options = { filePath: path.join(dir, 'api.json'), encryption, keyField: 'apiKey', keyPattern: /^sk-example-[^\s]{1,500}$/ }
  const store = createCredentialStore(options)
  await store.saveKey('sk-example-first')
  assert.equal((await store.status()).verified, false)
  await store.markVerified('sk-example-first', 'account-model')
  assert.deepEqual(await createCredentialStore(options).status(), { saved: true, verified: true, verifiedModel: 'account-model' })
  await store.saveKey('sk-example-replacement')
  await assert.rejects(store.markVerified('sk-example-first', 'account-model'), { code: 'CREDENTIAL_CHANGED' })
  assert.equal((await store.status()).verified, false)
  await assert.rejects(store.saveKey('sk-kimi-other-provider'), { code: 'INVALID_INPUT' })
  await store.clearKey()
  assert.deepEqual(await store.status(), { saved: false, verified: false, verifiedModel: null })
})
