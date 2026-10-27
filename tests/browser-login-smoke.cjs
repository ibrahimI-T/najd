// Real browser check of authorized sign-in (R-063): Microsoft Edge with a temporary profile (never the user's), the unpacked NAJD extension,
// a local test site with real cookies and sessions, and the real NAJD bridge, browser tool and credential vault (in-memory secret store).
// Covers sign-in, session reuse in the same browser profile, session expiry, wrong password, a password-change form, revocation and the
// extension's own refusals. Test accounts only. Usage: npm run smoke:browser-login
const assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http')
const { createBrowserBridge } = require('../electron/browser-bridge.cjs')
const { createBrowserTools } = require('../electron/browser-tools.cjs')
const { createCredentialVault } = require('../electron/credential-vault.cjs')

const { edge, sleep, launch, pairThroughPanel } = require('./helpers/edge-extension.cjs')
const PASSWORD = 'Test-Account-pw-7731'

async function main() {
  if (!edge) { console.log('SKIP: Microsoft Edge not found'); return }
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'najd-login-smoke-'))
  const sessions = new Set()
  const html = (title, body) => `<!doctype html><meta charset="utf-8"><title>${title}</title>${body}`
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://x')
    const cookie = /sid=([a-f0-9]+)/.exec(request.headers.cookie || '')?.[1]
    const send = (status, body, headers = {}) => response.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', ...headers }).end(body)
    if (url.pathname === '/login' && request.method === 'GET') return send(200, html('Sign in', '<form method="post" action="/login"><label for="user">Email</label><input id="user" name="user" type="email"><label for="pw">Password</label><input id="pw" name="pw" type="password" autocomplete="current-password"><button type="submit">Sign in</button></form>' + (url.searchParams.get('error') ? '<p>Wrong password.</p>' : '')))
    if (url.pathname === '/login' && request.method === 'POST') {
      let body = ''; request.on('data', chunk => { body += chunk }); request.on('end', () => {
        const form = new URLSearchParams(body)
        if (form.get('user') === 'tester@example.com' && form.get('pw') === PASSWORD) { const sid = [...Array(16)].map(() => Math.floor(Math.random() * 16).toString(16)).join(''); sessions.add(sid); return send(302, '', { Location: '/account', 'Set-Cookie': `sid=${sid}; Path=/; HttpOnly` }) }
        send(302, '', { Location: '/login?error=1' })
      }); return
    }
    // A sign-in page whose own script, while the user name is typed, turns the password field into a new-password field.
    if (url.pathname === '/trap') return send(200, html('Sign in', '<form method="post" action="/login"><label for="user">Email</label><input id="user" name="user" type="email" oninput="document.getElementById(\'pw\').setAttribute(\'autocomplete\',\'new-password\')"><label for="pw">Password</label><input id="pw" name="pw" type="password" autocomplete="current-password"><button type="submit">Sign in</button></form>'))
    // A sign-in page whose password field turns into a new-password field the moment it receives focus.
    if (url.pathname === '/focustrap') return send(200, html('Sign in', '<form method="post" action="/login"><label for="user">Email</label><input id="user" name="user" type="email"><label for="pw">Password</label><input id="pw" name="pw" type="password" autocomplete="current-password" onfocus="this.setAttribute(\'autocomplete\',\'new-password\')"><button type="submit">Sign in</button></form>'))
    // Sign-in pages whose script changes how a field reads while it receives focus.
    if (url.pathname === '/labeltrap') return send(200, html('Sign in', '<form method="post" action="/login"><label for="user">Email</label><input id="user" name="user" type="email"><label for="pw">Password</label><input id="pw" name="pw" type="password" autocomplete="current-password" onfocus="document.querySelector(\'label[for=pw]\').textContent=\'New password\'"><button type="submit">Sign in</button></form>'))
    if (url.pathname === '/otptrap') return send(200, html('Sign in', '<form method="post" action="/login"><label for="user">Email</label><input id="user" name="user" type="email" onfocus="this.setAttribute(\'autocomplete\',\'one-time-code\')"><label for="pw">Password</label><input id="pw" name="pw" type="password" autocomplete="current-password"><button type="submit">Sign in</button></form>'))
    // A "password" field that is really a verification-code field; and one that becomes one while receiving focus.
    if (url.pathname === '/otppass') return send(200, html('Sign in', '<form method="post" action="/login"><label for="user">Email</label><input id="user" name="user" type="email"><label for="pw">Verification code</label><input id="pw" name="pw" type="password" autocomplete="one-time-code"><button type="submit">Sign in</button></form>'))
    if (url.pathname === '/otpfocus') return send(200, html('Sign in', '<form method="post" action="/login"><label for="user">Email</label><input id="user" name="user" type="email"><label for="pw">Password</label><input id="pw" name="pw" type="password" autocomplete="current-password" onfocus="this.setAttribute(\'autocomplete\',\'one-time-code\')"><button type="submit">Sign in</button></form>'))
    // A sign-in page whose form sends the password to another site.
    if (url.pathname === '/collector') return send(200, html('Sign in', '<form method="post" action="http://collector.example/receive"><label for="user">Email</label><input id="user" name="user" type="email"><label for="pw">Password</label><input id="pw" name="pw" type="password" autocomplete="current-password"><button type="submit">Sign in</button></form>'))
    if (url.pathname === '/account') return cookie && sessions.has(cookie) ? send(200, html('Account', '<h1>Welcome tester</h1><button>Next</button><button>Delete account</button>')) : send(302, '', { Location: '/login' })
    if (url.pathname === '/expire') { sessions.clear(); return send(200, 'expired') }
    if (url.pathname === '/change-password') return send(200, html('Change password', '<form><label for="a">New password</label><input id="a" type="password" autocomplete="new-password"><label for="b">Confirm password</label><input id="b" type="password"><button>Save</button></form>'))
    send(404, 'not found')
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  const bridge = createBrowserBridge({ filePath: path.join(profile, 'link.json'), encryption: { isEncryptionAvailable: () => false }, ports: [38221, 38222, 38223] })
  await bridge.start()
  const secrets = new Map()
  const vault = createCredentialVault({ directory: path.join(profile, 'accounts'), allowLocal: true, store: { kind: 'fake',
    async write(target, username, secret) { secrets.set(target, { username, secret }) }, async read(target) { return secrets.get(target) || null }, async remove(target) { return secrets.delete(target) } } })
  const tools = createBrowserTools({ bridge, vault, allowUrl: () => true })
  const results = []
  const run = async (args, decision = 'ALLOW_ONCE') => { const out = await tools.run({ action: '', target: '', text: '', submit: false, ...args }, { requestApproval: async () => decision }); results.push(out)
    if (process.env.NAJD_SMOKE_DEBUG) console.error(args.action, args.target.slice(-12), '->', out.status, out.page?.title, out.page?.url)
    return out }
  const browser = await launch({ debugPort: 39234 })
  try {
    const panel = await browser.openPanel()
    await pairThroughPanel(bridge, panel)
    for (let i = 0; i < 60 && !bridge.status().connected; i++) await sleep(250)
    assert.equal(bridge.status().connected, true, 'extension linked')
    panel.close()

    const account = await vault.add({ label: 'Test site', siteUrl: base, username: 'tester@example.com', password: PASSWORD, autoLogin: true })

    // 1. Not signed in: the page asks for a sign-in and names the authorized account (no password).
    const first = await run({ action: 'open', target: base + '/account' })
    assert.equal(first.page.title, 'Sign in'); assert.equal(first.page.login.required, true); assert.equal(first.page.login.accounts[0].id, account.id)
    // 2. Authorized sign-in with the real browser: the saved password is filled by the extension; the model never sees it.
    const signedIn = await run({ action: 'login', target: account.id, submit: true })
    if (signedIn.status !== 'signed_in') console.error('sign-in outcome:', JSON.stringify(signedIn).slice(0, 900))
    assert.equal(signedIn.status, 'signed_in', JSON.stringify(signedIn).slice(0, 400))
    assert.equal(signedIn.page.title, 'Account')
    // 3. Session reuse: the same browser profile keeps the cookie, so opening the page again needs no sign-in.
    const reused = await run({ action: 'open', target: base + '/account' })
    assert.equal(reused.page.title, 'Account'); assert.equal(reused.page.login, undefined)
    // 4. Session expiry: the site forgets the session; the page asks again and the same account signs in again.
    await fetch(base + '/expire')
    const expired = await run({ action: 'open', target: base + '/account' })
    assert.equal(expired.page.login.required, true)
    assert.equal((await run({ action: 'login', target: account.id })).status, 'signed_in')
    // 5. A password-change form is never filled.
    await run({ action: 'open', target: base + '/change-password' })
    assert.equal((await run({ action: 'login', target: account.id })).status, 'not_a_login_form')
    // 6. The extension itself refuses the sign-in command on another site and typing into a password field.
    await run({ action: 'open', target: base + '/login' })
    const page = bridge.lastPage(), pass = page.elements.find(item => item.type === 'password')
    await assert.rejects(bridge.command('login', { host: 'other.example', userId: '', passId: pass.id, username: 'x', password: 'y', submit: false }), { code: 'HOST_MISMATCH' })
    // The sign-in is bound to the approved document, address and fields: anything else is refused before a password is touched.
    const sample = { host: new URL(base).hostname, userId: '', passId: pass.id, username: 'x', password: 'y', submit: false }
    await assert.rejects(bridge.command('login', { ...sample, expect: { doc: 'another-document', snap: '0', passLabel: pass.label, userLabel: '' } }), { code: 'PAGE_CHANGED' })
    await assert.rejects(bridge.command('login', { ...sample, expect: { doc: page.doc, snap: '0', passLabel: pass.label, userLabel: '' } }), { code: 'PAGE_CHANGED' })
    await assert.rejects(bridge.command('login', { ...sample, expect: { doc: page.doc, snap: String(page.snap), passLabel: 'Not the password field', userLabel: '' } }), { code: 'ELEMENT_CHANGED' })
    await assert.rejects(bridge.command('type', { id: pass.id, text: 'secret', submit: false }), { code: 'SENSITIVE_FIELD' })
    // 6b. A page that changes the form while the user name is being typed: the password is never put into it, and nothing is submitted.
    await run({ action: 'open', target: base + '/trap' })
    await assert.rejects(run({ action: 'login', target: account.id }), error => error.code === 'PARTIAL_ACTION' || error.effectUnknown === true)
    const trapped = bridge.lastPage() && (await bridge.command('read')).elements.find(item => item.type === 'password')
    assert.ok(trapped && !trapped.filled, 'the password field stayed empty')
    // 6c. A password field that changes when it receives focus: the password is not written (the user name may have been).
    await run({ action: 'open', target: base + '/focustrap' })
    await bridge.command('focus') // focus events only fire in a focused window
    const focusResult = await run({ action: 'login', target: account.id }).catch(error => ({ thrown: error.code, unknown: error.effectUnknown }))
    assert.ok(['PARTIAL_ACTION', 'ELEMENT_CHANGED'].includes(focusResult.thrown) && focusResult.unknown !== undefined, 'refused: ' + JSON.stringify(focusResult).slice(0, 120))
    const focusTrapped = (await bridge.command('read')).elements.find(item => item.type === 'password')
    assert.ok(focusTrapped && !focusTrapped.filled, 'the password field stayed empty')
    // 6d. A password field that starts to read as a new password, and a user name field that turns into a one-time-code field, while receiving focus.
    for (const [index, trap] of ['/otptrap', '/labeltrap', '/otppass', '/otpfocus'].entries()) {
      const trapAccount = await vault.add({ label: 'Trap ' + index, siteUrl: base, username: 'trap' + index + '@example.com', password: PASSWORD + index, autoLogin: true })
      await run({ action: 'open', target: base + trap })
      await bridge.command('focus')
      const refused = await run({ action: 'login', target: trapAccount.id }).catch(error => ({ thrown: error.code }))
      assert.ok(['PARTIAL_ACTION', 'ELEMENT_CHANGED'].includes(refused.thrown) || ['not_a_login_form', 'ambiguous_form', 'page_changed'].includes(refused.status), trap + ': ' + JSON.stringify(refused).slice(0, 120))
      const pw = (await bridge.command('read')).elements.find(item => item.type === 'password')
      assert.ok(pw && !pw.filled, trap + ': the password field stayed empty')
      await vault.remove(trapAccount.id)
    }
    // 6e. A form that would send the password to another site is refused before anything is filled.
    await run({ action: 'open', target: base + '/collector' })
    const collector = await run({ action: 'login', target: account.id })
    assert.equal(collector.status, 'destination_not_allowed')
    assert.ok(!(await bridge.command('read')).elements.find(item => item.type === 'password').filled, 'nothing was filled')
    // 7. Wrong password: reported, not retried in a loop.
    await vault.remove(account.id)
    const wrong = await vault.add({ label: 'Wrong', siteUrl: base, username: 'tester@example.com', password: 'wrong-password', autoLogin: true })
    await run({ action: 'open', target: base + '/login' })
    assert.equal((await run({ action: 'login', target: wrong.id })).status, 'login_not_completed')
    // 8. Revocation: the authorization and the saved password are gone.
    await vault.remove(wrong.id)
    await run({ action: 'open', target: base + '/login' })
    assert.equal((await run({ action: 'login', target: wrong.id })).status, 'no_account')
    assert.equal(secrets.size, 0, 'no saved password remains')
    assert.ok(!JSON.stringify(results).includes(PASSWORD) && !JSON.stringify(results).includes('wrong-password'), 'no tool result ever carried a password')
    console.log('PASS: real Edge (temporary profile): authorized sign-in, session reuse, expiry and re-sign-in, password-change form refused, extension refusals, wrong password, revocation; no password in any tool result.')
  } finally {
    await bridge.stop(); server.close()
    await browser.stop()
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 })
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
