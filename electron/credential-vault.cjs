// Authorized accounts (R-063). The user adds an account in NAJD Settings and thereby authorizes NAJD to sign in to that site as them.
// Metadata (label, site, username, auto-login choice) is kept in a small JSON file; the secret lives only in the secret store
// (Windows Credential Manager). The secret never goes to the renderer, a model, a tool result, a log or the journal:
// `reveal` is main-process only, checks the page it is used on, and the values it returned are scrubbed from later page text.
const fs = require('node:fs/promises')
const { replaceFile } = require('./atomic-file.cjs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')

const error = code => Object.assign(new Error(code), { code })
const MAX_ACCOUNTS = 50
// Short enough to be guessed is too short to be protected: scrubbing needs a value that cannot be mistaken for ordinary page text.
const MIN_PASSWORD = 6
const PREFIX = 'NAJD AGENT/account/'
const validId = value => typeof value === 'string' && /^[0-9a-f-]{36}$/.test(value)
const text = (value, max) => typeof value === 'string' ? value.replace(/[\x00-\x1f]+/g, ' ').trim().slice(0, max) : ''
const isLocalHost = host => host === 'localhost' || host === '127.0.0.1' || host === '[::1]'

// The site an account may be used on: an https host (http only for this computer, so a local test site can be used).
function siteHost(value, allowLocal = false) {
  let url
  try { url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(String(value)) ? String(value) : 'https://' + String(value)) } catch { throw error('INVALID_INPUT') }
  if (url.username || url.password) throw error('INVALID_INPUT')
  if (url.protocol !== 'https:' && !(allowLocal && url.protocol === 'http:' && isLocalHost(url.hostname))) throw error('INVALID_INPUT')
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (!host || host.length > 253 || (!host.includes('.') && !isLocalHost(host) && !host.includes(':'))) throw error('INVALID_INPUT')
  return host
}
const hostMatches = (accountHost, pageHost) => pageHost === accountHost || pageHost.endsWith('.' + accountHost)

// allowLocal: sites on this computer over http (only for tests; real accounts are https sites).
function createCredentialVault({ directory, store, audit = () => {}, allowLocal = false } = {}) {
  if (!path.isAbsolute(directory || '') || !store?.write || !store?.read || !store?.remove) throw error('INVALID_INPUT')
  const filename = path.join(directory, 'accounts.json')
  let queue = Promise.resolve()
  const serial = work => { const result = queue.then(work); queue = result.catch(() => {}); return result }
  // Every secret this process has handed to a page, kept until the process ends (a page can keep showing it as long as the tab lives).
  const handed = new Set()
  // After a restart a browser tab can still show a password an earlier run filled in. Before any page is read, every saved password is loaded into
  // the set above (once per process), so such an echo is masked exactly like one from this run.
  let primed = false

  async function load() {
    try {
      const value = JSON.parse(await fs.readFile(filename, 'utf8'))
      if (!value || value.version !== 1 || !Array.isArray(value.accounts) || value.accounts.length > MAX_ACCOUNTS) throw error('ACCOUNT_STORE_UNAVAILABLE')
      return value
    } catch (failure) {
      if (failure?.code === 'ENOENT') return { version: 1, accounts: [] }
      throw error('ACCOUNT_STORE_UNAVAILABLE') // a damaged file is left in place, never overwritten
    }
  }
  async function save(value) {
    await fs.mkdir(directory, { recursive: true })
    const temporary = filename + '.' + randomUUID() + '.tmp'
    await fs.writeFile(temporary, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
    await replaceFile(temporary, filename)
  }
  // Plain, percent-encoded (upper and lower case hex), form-encoded (spaces as +, as in URLSearchParams and GET forms) and escape() forms.
  // Adds a credential's password to the masking set (a credential that is already gone is fine; one that cannot be read is a failure).
  const protect = async id => { const secret = await store.read(PREFIX + id); if (secret?.secret) handed.add(secret.secret) }
  const forms = secret => {
    const base = [secret, encodeURIComponent(secret), encodeURI(secret), escape(secret), new URLSearchParams({ x: secret }).toString().slice(2), encodeURIComponent(secret).replace(/%20/g, '+')]
    const lower = base.map(item => item.replace(/%[0-9A-F]{2}/g, hex => hex.toLowerCase()))
    return [...base, ...lower].filter((item, index, all) => item && all.indexOf(item) === index)
  }
  // Every form of every secret is searched in the original text and the union of the matching spans is replaced, so overlapping passwords
  // (one the beginning of another, or sharing a stretch) are masked completely whatever order they were saved in.
  const scrubText = text => {
    const spans = []
    for (const secret of handed) for (const form of forms(secret)) {
      for (let from = text.indexOf(form); from !== -1; from = text.indexOf(form, from + 1)) spans.push([from, from + form.length])
    }
    if (!spans.length) return text
    spans.sort((a, b) => a[0] - b[0] || b[1] - a[1])
    let out = '', cursor = 0, start = spans[0][0], end = spans[0][1]
    const flush = () => { out += text.slice(cursor, start) + '[redacted]'; cursor = end }
    for (const [from, to] of spans.slice(1)) { if (from <= end) end = Math.max(end, to); else { flush(); start = from; end = to } }
    flush()
    return out + text.slice(cursor)
  }
  const scrubValue = value => {
    if (typeof value === 'string') return scrubText(value)
    if (Array.isArray(value)) return value.map(scrubValue)
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, scrubValue(item)]))
    return value
  }
  const view = account => ({ id: account.id, label: account.label, host: account.host, username: account.username, autoLogin: account.autoLogin === true,
    authorizedAt: account.authorizedAt, lastUsedAt: account.lastUsedAt || null })

  return {
    storeKind: store.kind || 'secret-store',
    list: () => serial(async () => (await load()).accounts.filter(account => !account.revoked).map(view)),
    forHost: pageHost => serial(async () => (await load()).accounts.filter(account => !account.revoked && hostMatches(account.host, String(pageHost).toLowerCase())).map(view)),
    find: reference => serial(async () => {
      const accounts = (await load()).accounts.filter(account => !account.revoked)
      const wanted = text(reference, 200).toLowerCase()
      const found = accounts.find(account => account.id === reference) || accounts.find(account => account.label.toLowerCase() === wanted) ||
        accounts.filter(account => account.host === wanted || `${account.username}@${account.host}`.toLowerCase() === wanted).slice(0, 2)
      const one = Array.isArray(found) ? (found.length === 1 ? found[0] : null) : found
      return one ? view(one) : null
    }),

    // The user authorizes an account: the password goes straight into the secret store and is not kept anywhere else.
    add: ({ label, siteUrl, username, password, autoLogin = false }) => serial(async () => {
      const host = siteHost(siteUrl, allowLocal)
      const cleanLabel = text(label, 60) || host, cleanUser = text(username, 320)
      if (!cleanUser || typeof password !== 'string' || password.length < MIN_PASSWORD || password.length > 1000) throw error('INVALID_INPUT')
      const current = await load()
      if (current.accounts.length >= MAX_ACCOUNTS) throw error('ACCOUNT_LIMIT')
      if (current.accounts.some(account => !account.revoked && account.host === host && account.username.toLowerCase() === cleanUser.toLowerCase())) throw error('ACCOUNT_EXISTS')
      const account = { id: randomUUID(), label: cleanLabel, host, username: cleanUser, autoLogin: autoLogin === true, authorizedAt: new Date().toISOString() }
      await store.write(PREFIX + account.id, cleanUser, password) // stored before the record exists: no record without its secret
      handed.add(password)
      try { await save({ version: 1, accounts: [...current.accounts, account] }) }
      catch (failure) { await store.remove(PREFIX + account.id).catch(() => {}); throw failure }
      audit({ action: 'account-add', account: account.label, host })
      return view(account)
    }),
    setAutoLogin: (id, enabled) => serial(async () => {
      if (!validId(id) || typeof enabled !== 'boolean') throw error('INVALID_INPUT')
      const current = await load()
      const account = current.accounts.find(item => item.id === id && !item.revoked)
      if (!account) throw error('ACCOUNT_NOT_FOUND')
      account.autoLogin = enabled
      await save(current)
      audit({ action: enabled ? 'account-autologin-on' : 'account-autologin-off', account: account.label, host: account.host })
      return view(account)
    }),
    // Revoking is recoverable: the account is first marked revoked (unusable at once), then the saved password is deleted, then the record.
    // If the password cannot be deleted the account stays revoked and the deletion is retried (reconcile), never reported as done.
    remove: id => serial(async () => {
      if (!validId(id)) throw error('INVALID_INPUT')
      const current = await load()
      const account = current.accounts.find(item => item.id === id)
      if (!account) throw error('ACCOUNT_NOT_FOUND')
      if (!account.revoked) { account.revoked = true; await save(current) }
      // The password is kept for masking BEFORE it is deleted (a tab that survives may still echo it). If it cannot be read, nothing is deleted: the
      // account stays revoked, with its credential, for a protected retry.
      await protect(id)
      await store.remove(PREFIX + id) // a real failure throws and leaves the revoked marker for a retry
      // Recorded at once: from here on a missing credential is expected, not a sign that an interrupted deletion took its password out of reach of masking.
      account.credentialGone = true; await save(current)
      await save({ version: 1, accounts: current.accounts.filter(item => item.id !== id) })
      audit({ action: 'account-remove', account: account.label, host: account.host })
      return true
    }),
    // Revoked accounts whose saved password could not be deleted yet (they are hidden from list()); the user can see and retry them.
    pending: () => serial(async () => {
      const out = []
      for (const account of (await load()).accounts.filter(item => item.revoked)) {
        const present = !!(await store.read(PREFIX + account.id).catch(() => ({ secret: 'x' })))?.secret
        out.push({ ...view(account), unresolved: !present && !account.credentialGone })
      }
      return out
    }),
    // The owner confirms that the browser tabs of an interrupted revocation were closed or refreshed: the record is cleared.
    acknowledge: id => serial(async () => {
      if (!validId(id)) throw error('INVALID_INPUT')
      const current = await load()
      const account = current.accounts.find(item => item.id === id && item.revoked)
      if (!account) throw error('ACCOUNT_NOT_FOUND')
      if ((await store.read(PREFIX + id))?.secret) throw error('INVALID_INPUT') // the credential is still stored: it is retried, not acknowledged
      await save({ version: 1, accounts: current.accounts.filter(item => item.id !== id) })
      audit({ action: 'account-revocation-acknowledged', account: account.label, host: account.host })
      return true
    }),
    // Finishes revocations that were interrupted (call at startup and from time to time).
    reconcile: () => serial(async () => {
      const current = await load()
      let done = 0
      for (const account of current.accounts.filter(item => item.revoked)) {
        try {
          const unread = await store.read(PREFIX + account.id)
          if (!unread?.secret && !account.credentialGone) continue // unresolved: only the owner's confirmation clears it
          await protect(account.id); await store.remove(PREFIX + account.id); current.accounts = current.accounts.filter(item => item.id !== account.id); done++ } catch {}
      }
      if (done) await save(current)
      return done
    }),

    // Main process only. The page must be the account's own site over https; the result is for the browser bridge, never for a model.
    reveal: (id, pageUrl) => serial(async () => {
      if (!validId(id)) throw error('INVALID_INPUT')
      let page
      try { page = new URL(pageUrl) } catch { throw error('HOST_MISMATCH') }
      const current = await load()
      const account = current.accounts.find(item => item.id === id && !item.revoked)
      if (!account) throw error('ACCOUNT_NOT_FOUND')
      const host = page.hostname.toLowerCase().replace(/^\[|\]$/g, '')
      if (!hostMatches(account.host, host)) throw error('HOST_MISMATCH')
      if (page.protocol !== 'https:' && !(allowLocal && page.protocol === 'http:' && isLocalHost(host))) throw error('INSECURE_PAGE')
      const secret = await store.read(PREFIX + id)
      if (!secret?.secret) throw error('SECRET_MISSING')
      account.lastUsedAt = new Date().toISOString()
      await save(current).catch(() => {})
      handed.add(secret.secret)
      audit({ action: 'account-use', account: account.label, host: account.host })
      return { username: account.username, password: secret.secret, host: account.host }
    }),
    // Loads every saved password into the masking set (main process only). It throws if a saved password cannot be read, so callers can refuse to read pages.
    prime: () => serial(async () => {
      if (primed) return
      const current = await load()
      // Every account that is not being revoked must have a readable, non-empty password; otherwise masking cannot be guaranteed and this fails.
      for (const account of current.accounts.filter(item => !item.revoked)) {
        const secret = await store.read(PREFIX + account.id)
        if (!secret?.secret) throw error('SECRET_MISSING')
        handed.add(secret.secret)
      }
      // A revoked account whose password is still stored is masked too; a store failure here fails priming (only a confirmed absence is fine).
      // A revoked account whose password is gone without a record that its deletion finished (a crash between the two): its password may still be shown by a
      // tab that survived, and cannot be masked. That is unresolved: priming fails until the owner confirms in Settings > Accounts.
      for (const account of current.accounts.filter(item => item.revoked)) {
        const secret = await store.read(PREFIX + account.id)
        if (secret?.secret) handed.add(secret.secret)
        else if (!account.credentialGone) throw error('REVOCATION_UNRESOLVED')
      }
      primed = true
    }),
    // Removes any secret handed to a page from text that is about to reach a model, a log or the screen.
    scrub: value => scrubText(String(value ?? '')),
    // The same for a whole structure of plain values, before it is serialized (JSON escaping could hide a password with quotes in it),
    // including its percent-encoded form in addresses.
    scrubDeep: value => scrubValue(value),
    siteHost, hostMatches
  }
}

module.exports = { createCredentialVault, siteHost, hostMatches, PREFIX }
