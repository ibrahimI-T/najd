const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const { createCredentialVault } = require('../electron/credential-vault.cjs')
const { createWindowsCredentialStore } = require('../electron/windows-credential-store.cjs')

// An in-memory secret store: the vault's policy is tested without touching the real Credential Manager.
function fakeStore() {
  const secrets = new Map()
  return { kind: 'fake', secrets, failWrite: false, failRemove: false,
    async write(target, username, secret) { if (this.failWrite) throw Object.assign(new Error('CREDENTIAL_STORE_FAILED'), { code: 'CREDENTIAL_STORE_FAILED' }); secrets.set(target, { username, secret }) },
    async read(target) { return secrets.get(target) || null },
    async remove(target) { if (this.failRemove) throw Object.assign(new Error('CREDENTIAL_STORE_FAILED'), { code: 'CREDENTIAL_STORE_FAILED' }); return secrets.delete(target) } }
}
const setup = (options = {}) => {
  const directory = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'najd-vault-'))
  const store = fakeStore(), audits = []
  const vault = createCredentialVault({ directory, store, audit: entry => audits.push(entry), ...options })
  return { directory, store, vault, audits }
}
const input = { label: 'Test mail', siteUrl: 'https://mail.example.com/login', username: 'tester@example.com', password: 'Tr0ub4dor&3-test', autoLogin: false }

test('an authorized account keeps its password only in the secret store, never in the list, the file or the audit', async () => {
  const { directory, store, vault, audits } = setup()
  const account = await vault.add(input)
  assert.equal(account.host, 'mail.example.com'); assert.equal(account.autoLogin, false)
  assert.equal([...store.secrets.values()][0].secret, input.password)
  const everything = JSON.stringify([await vault.list(), account, audits, fs.readFileSync(path.join(directory, 'accounts.json'), 'utf8')])
  assert.ok(!everything.includes(input.password), 'the password must not appear anywhere but the secret store')
  assert.ok(!('password' in (await vault.list())[0]))
})

test('reveal works only on the site of the account, over https, and is audited', async () => {
  const { vault, audits } = setup()
  const account = await vault.add(input)
  const revealed = await vault.reveal(account.id, 'https://mail.example.com/signin')
  assert.deepEqual({ username: revealed.username, password: revealed.password }, { username: 'tester@example.com', password: input.password })
  await vault.reveal(account.id, 'https://login.mail.example.com/x') // a subdomain of the site is the same site
  await assert.rejects(vault.reveal(account.id, 'https://mail.example.com.evil.test/x'), { code: 'HOST_MISMATCH' })
  await assert.rejects(vault.reveal(account.id, 'https://evilmail.example.com.attacker.io/'), { code: 'HOST_MISMATCH' })
  await assert.rejects(vault.reveal(account.id, 'http://mail.example.com/'), { code: 'INSECURE_PAGE' })
  await assert.rejects(vault.reveal(account.id, 'not a url'), { code: 'HOST_MISMATCH' })
  assert.equal(audits.filter(entry => entry.action === 'account-use').length, 2)
  assert.ok(!JSON.stringify(audits).includes(input.password))
})

test('local http sites are accepted only when explicitly allowed (test use)', async () => {
  const strict = setup()
  await assert.rejects(strict.vault.add({ ...input, siteUrl: 'http://127.0.0.1:8080/login' }), { code: 'INVALID_INPUT' })
  await assert.rejects(strict.vault.add({ ...input, siteUrl: 'http://mail.example.com/login' }), { code: 'INVALID_INPUT' })
  const local = setup({ allowLocal: true })
  const account = await local.vault.add({ ...input, siteUrl: 'http://127.0.0.1:8080/login' })
  assert.equal((await local.vault.reveal(account.id, 'http://127.0.0.1:8080/x')).password, input.password)
})

test('revoking is recoverable: the account becomes unusable at once, a failed deletion is retried, never reported as done', async () => {
  const { vault, store } = setup()
  const account = await vault.add(input)
  store.failRemove = true
  await assert.rejects(vault.remove(account.id), { code: 'CREDENTIAL_STORE_FAILED' })
  assert.deepEqual(await vault.list(), [], 'a revoked account is not offered')
  assert.equal(await vault.find('Test mail'), null)
  await assert.rejects(vault.reveal(account.id, 'https://mail.example.com/'), { code: 'ACCOUNT_NOT_FOUND' }, 'a revoked account cannot be used even though its secret still exists')
  assert.equal(store.secrets.size, 1, 'the secret is still there until deletion succeeds')
  assert.equal(await vault.reconcile(), 0, 'still failing: nothing is claimed as done')
  store.failRemove = false
  assert.equal(await vault.reconcile(), 1)
  assert.equal(store.secrets.size, 0)
  const again = await vault.add(input) // the same account can be authorized again afterwards
  assert.equal(await vault.remove(again.id), true)
  assert.deepEqual(await vault.list(), []); assert.equal(store.secrets.size, 0)
})

test('a failed secret write leaves no account record, duplicates and bad input are refused, and auto sign-in can be switched', async () => {
  const { vault, store } = setup()
  store.failWrite = true
  await assert.rejects(vault.add(input), { code: 'CREDENTIAL_STORE_FAILED' })
  assert.deepEqual(await vault.list(), [])
  store.failWrite = false
  const account = await vault.add(input)
  await assert.rejects(vault.add(input), { code: 'ACCOUNT_EXISTS' })
  for (const bad of [{ ...input, password: '' }, { ...input, password: '12345' }, { ...input, username: ' ' }, { ...input, siteUrl: 'javascript:alert(1)' }, { ...input, siteUrl: 'https://user:pw@mail.example.com' }, { ...input, password: 'x'.repeat(1001) }])
    await assert.rejects(vault.add(bad), { code: 'INVALID_INPUT' })
  assert.equal((await vault.setAutoLogin(account.id, true)).autoLogin, true)
  assert.equal((await vault.find('Test mail')).id, account.id)
  assert.equal((await vault.find(account.id)).label, 'Test mail')
  assert.equal(await vault.find('missing'), null)
})

test('a secret that was handed to a page is scrubbed from text that reaches a model or a log', async () => {
  const { vault } = setup()
  const account = await vault.add(input)
  const { password } = await vault.reveal(account.id, 'https://mail.example.com/')
  assert.equal(vault.scrub(`echo: ${password} and again ${password}`), 'echo: [redacted] and again [redacted]')
  assert.equal(vault.scrub('nothing secret here'), 'nothing secret here')
})

test('every accepted password stays protected for the life of the process, including percent-encoded and nested forms', async () => {
  const { vault } = setup({ allowLocal: true })
  const account = await vault.add({ ...input, password: 'p@ss w"rd&1' })
  const { password } = await vault.reveal(account.id, 'https://mail.example.com/')
  await new Promise(resolve => setTimeout(resolve, 30))
  const page = { url: `https://mail.example.com/?pw=${encodeURIComponent(password)}`, title: `echo ${password}`, elements: [{ label: password }, ['x', { deep: `a ${password} b` }]] }
  const clean = JSON.stringify(vault.scrubDeep(page))
  assert.ok(!clean.includes(password) && !clean.includes(encodeURIComponent(password)), clean)
  await vault.reveal(account.id, 'https://mail.example.com/') // a second reveal does not shorten protection
  assert.ok(!JSON.stringify(vault.scrubDeep(page)).includes(password))
})

test('a damaged accounts file is preserved and the vault fails closed', async () => {
  const { directory, vault } = setup()
  fs.writeFileSync(path.join(directory, 'accounts.json'), '{not json')
  await assert.rejects(vault.list(), { code: 'ACCOUNT_STORE_UNAVAILABLE' })
  await assert.rejects(vault.add(input), { code: 'ACCOUNT_STORE_UNAVAILABLE' })
  assert.equal(fs.readFileSync(path.join(directory, 'accounts.json'), 'utf8'), '{not json')
})

test('real Windows Credential Manager: write, read (Unicode), delete with a test target', { skip: process.platform !== 'win32' }, async () => {
  const store = createWindowsCredentialStore()
  const target = 'NAJD AGENT TEST/vault-' + Date.now()
  try {
    await store.write(target, 'test-user@example.com', 'كلمة-سر ✓ p@ss"w0rd')
    assert.deepEqual(await store.read(target), { username: 'test-user@example.com', secret: 'كلمة-سر ✓ p@ss"w0rd' })
  } finally { await store.remove(target).catch(() => {}) }
  assert.equal(await store.read(target), null)
  await assert.rejects(store.read('not a NAJD target'), { code: 'INVALID_INPUT' })
})

test('R064-203: after a restart, a password a surviving tab still shows is masked once the vault is primed, and priming fails closed when a secret cannot be read', async () => {
  const first = setup()
  const account = await first.vault.add({ label: 'Mail', siteUrl: 'https://mail.example.com', username: 'me@example.com', password: 'Echoed-Pass-123' })
  // A new process: same files and secret store, but nothing has been handed to a page yet.
  const restarted = createCredentialVault({ directory: first.directory, store: first.store })
  assert.equal(JSON.stringify(restarted.scrubDeep({ text: 'the page says Echoed-Pass-123' })).includes('Echoed-Pass-123'), true, 'before priming nothing is known')
  await restarted.prime()
  assert.equal(JSON.stringify(restarted.scrubDeep({ text: 'the page says Echoed-Pass-123', url: 'https://x/?p=Echoed-Pass-123' })).includes('Echoed-Pass-123'), false)
  // A recorded account whose password is gone (or unreadable) means masking cannot be guaranteed: priming fails and stays unprimed.
  const missing = createCredentialVault({ directory: first.directory, store: { ...first.store, read: async () => null } })
  await assert.rejects(missing.prime(), { code: 'SECRET_MISSING' })
  const broken = createCredentialVault({ directory: first.directory, store: { ...first.store, read: async () => { throw new Error('CREDENTIAL_STORE_FAILED') } } })
  await assert.rejects(broken.prime())
  assert.ok(account.id)
})

test('R064-403: priming also covers a retained revoked credential and fails when it cannot be read', async () => {
  const first = setup()
  const account = await first.vault.add({ label: 'Mail', siteUrl: 'https://mail.example.com', username: 'me@example.com', password: 'Revoked-Pass-123' })
  first.store.failRemove = true
  await assert.rejects(first.vault.remove(account.id))   // revoked, but the password could not be deleted: the record and credential stay
  const restarted = createCredentialVault({ directory: first.directory, store: first.store })
  await restarted.prime()
  assert.equal(JSON.stringify(restarted.scrubDeep({ text: 'echo Revoked-Pass-123' })).includes('Revoked-Pass-123'), false, 'masked although revoked')
  const broken = createCredentialVault({ directory: first.directory, store: { ...first.store, read: async () => { throw new Error('CREDENTIAL_STORE_FAILED') } } })
  await assert.rejects(broken.prime())
})

test('R064-IR-004: every usual encoding of a saved password is masked, including form encoding and lower-case percent escapes', async () => {
  const { vault } = setup()
  await vault.add({ label: 'Mail', siteUrl: 'https://mail.example.com', username: 'me@example.com', password: 'secret pass&é*~!' })
  const account = (await vault.list())[0]
  await vault.reveal(account.id, 'https://mail.example.com/login')
  const secret = 'secret pass&é*~!'
  const forms = [secret, encodeURIComponent(secret), encodeURIComponent(secret).replace(/%20/g, '+'), new URLSearchParams({ p: secret }).toString().slice(2), encodeURIComponent(secret).replace(/%[0-9A-F]{2}/g, hex => hex.toLowerCase()), escape(secret)]
  for (const form of forms) assert.ok(!JSON.stringify(vault.scrubDeep({ url: 'https://x/?password=' + form, text: 'echo ' + form })).includes(form), form)
})

test('R064-001: overlapping saved passwords are masked completely, whatever order they were saved in', async () => {
  for (const order of [['abcdef-pass', 'abcdef-pass-LongPrivateSuffix'], ['abcdef-pass-LongPrivateSuffix', 'abcdef-pass'], ['overlap-first-AAA', 'AAA-second-tail']]) {
    const { vault } = setup()
    for (const [index, password] of order.entries()) {
      const account = await vault.add({ label: 'A' + index, siteUrl: `https://site${index}.example.com`, username: 'u' + index + '@example.com', password })
      await vault.reveal(account.id, `https://site${index}.example.com/login`)
    }
    const text = order.join(' / ') + ' and glued: ' + (order[0].startsWith('overlap') ? 'overlap-first-AAA-second-tail' : 'abcdef-pass-LongPrivateSuffix')
    const masked = JSON.stringify(vault.scrubDeep({ text }))
    assert.ok(!/LongPrivateSuffix|AAA|abcdef|second-tail|overlap-first/.test(masked), masked)
  }
})

test('R064-REVIEW-3203: a revocation whose password could not be deleted stays visible and is finished when the store recovers', async () => {
  const { vault, store } = setup()
  const account = await vault.add({ label: 'Mail', siteUrl: 'https://mail.example.com', username: 'me@example.com', password: 'Pending-Pass-123' })
  store.failRemove = true
  await assert.rejects(vault.remove(account.id))
  assert.deepEqual(await vault.list(), [], 'hidden from the account list')
  assert.equal((await vault.pending()).length, 1, 'but listed as a pending deletion')
  assert.ok(store.secrets.size >= 1, 'the password is still stored')
  store.failRemove = false
  await vault.prime(); await vault.reconcile()
  assert.equal((await vault.pending()).length, 0); assert.equal(store.secrets.size, 0)
})

test('R064-IR-3301: a password is kept for masking before its credential is deleted, and nothing is deleted when it cannot be read', async () => {
  const first = setup()
  const a = await first.vault.add({ label: 'A', siteUrl: 'https://a.example.com', username: 'a@example.com', password: 'Account-A-Pass-1' })
  const b = await first.vault.add({ label: 'B', siteUrl: 'https://b.example.com', username: 'b@example.com', password: 'Account-B-Pass-2' })
  // A new process that has not loaded anything yet: removing B must still keep B's password masked afterwards.
  const restarted = createCredentialVault({ directory: first.directory, store: first.store })
  await restarted.remove(b.id)
  assert.equal(JSON.stringify(restarted.scrubDeep({ text: 'echo Account-B-Pass-2' })).includes('Account-B-Pass-2'), false)
  // If the password cannot be read, the credential is not deleted: the account stays revoked, with its credential, for a protected retry.
  const unreadable = createCredentialVault({ directory: first.directory, store: { ...first.store, read: async () => { throw new Error('CREDENTIAL_STORE_FAILED') } } })
  await assert.rejects(unreadable.remove(a.id))
  assert.ok([...first.store.secrets.keys()].some(key => key.endsWith(a.id)), 'the credential is still stored')
  assert.equal((await unreadable.pending()).length, 1)
})

test('R064-REV-3502: a revocation interrupted after the credential was deleted is unresolved until the owner confirms, and masking is not assumed', async () => {
  const first = setup()
  const account = await first.vault.add({ label: 'Mail', siteUrl: 'https://mail.example.com', username: 'me@example.com', password: 'Crash-Pass-123' })
  first.store.failRemove = true
  await assert.rejects(first.vault.remove(account.id))        // revoked, credential kept
  first.store.failRemove = false
  first.store.secrets.clear()                                  // the crash: the credential is gone, the record never said so
  const restarted = createCredentialVault({ directory: first.directory, store: first.store })
  await assert.rejects(restarted.prime(), { code: 'REVOCATION_UNRESOLVED' })
  assert.equal(await restarted.reconcile(), 0, 'the record is not removed silently')
  const pending = await restarted.pending()
  assert.equal(pending.length, 1); assert.equal(pending[0].unresolved, true)
  await restarted.acknowledge(account.id)
  assert.equal((await restarted.pending()).length, 0)
  await restarted.prime()
  // A normal, completed revocation leaves nothing unresolved.
  const normal = setup()
  const other = await normal.vault.add({ label: 'B', siteUrl: 'https://b.example.com', username: 'b@example.com', password: 'Normal-Pass-456' })
  await normal.vault.remove(other.id)
  await normal.vault.prime()
  assert.equal((await normal.vault.pending()).length, 0)
})
