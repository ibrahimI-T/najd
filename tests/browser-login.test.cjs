const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const { createBrowserTools } = require('../electron/browser-tools.cjs')
const { createCredentialVault } = require('../electron/credential-vault.cjs')

const PASSWORD = 'Sup3r-Secret-test-pw'
const field = (id, label, extra = {}) => ({ id, role: 'field', label, type: 'text', ...extra })
const loginPage = (host, extra = {}) => ({ url: `https://${host}/login`, title: 'Sign in', text: 'Please sign in' + (extra.text || ''), scroll: { y: 0 },
  elements: [field('e1', 'Email', { type: 'email' }), field('e2', 'Password', { type: 'password', sensitive: true }), { id: 'e3', role: 'button', label: 'Sign in', submits: true }, ...(extra.elements || [])] })
const accountPage = (host, text = 'Welcome back') => ({ url: `https://${host}/account`, title: 'Account', text, scroll: { y: 0 },
  elements: [{ id: 'e9', role: 'button', label: 'Next' }, { id: 'e8', role: 'button', label: 'Delete account' }, { id: 'e7', role: 'link', label: 'Transfer funds', href: `https://${host}/transfer` }] })

// A tiny simulated site behind a fake extension link: it checks the password, keeps a session and can expire it.
function fixture({ host = 'mail.example.com', echo = false } = {}) {
  const directory = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'najd-login-'))
  const secrets = new Map()
  const store = { kind: 'fake', async write(target, username, secret) { secrets.set(target, { username, secret }) }, async read(target) { return secrets.get(target) || null }, async remove(target) { return secrets.delete(target) } }
  const vault = createCredentialVault({ directory, store })
  const site = { sessionValid: false, page: null, commands: [], checks: 0 }
  const bridge = {
    status: () => ({ connected: true, page: site.page }),
    lastPage: () => site.page,
    async command(kind, args) {
      site.commands.push({ kind, args: JSON.parse(JSON.stringify(args)) })
      if (kind === 'open') site.page = new URL(args.url).pathname === '/account' && site.sessionValid ? accountPage(host) : loginPage(host)
      else if (kind === 'login') {
        site.checks++
        const ok = args.username === 'tester@example.com' && args.password === PASSWORD
        if (ok) site.sessionValid = true
        site.page = ok ? accountPage(host, echo ? 'Welcome back ' + args.password : 'Welcome back') : loginPage(host, { text: ' Wrong password.' })
      } else if (kind === 'click') site.page = accountPage(host)
      return JSON.parse(JSON.stringify(site.page))
    } }
  const approvals = []
  const requestApproval = decision => async (tool, input) => { approvals.push({ tool, input }); return decision }
  const tools = createBrowserTools({ bridge, vault })
  return { tools, vault, site, approvals, requestApproval, host, run: (args, decision = 'ALLOW_ONCE') => tools.run({ action: '', target: '', text: '', submit: false, ...args }, { requestApproval: requestApproval(decision) }) }
}
const add = (f, extra = {}) => f.vault.add({ label: 'Test mail', siteUrl: 'https://' + f.host, username: 'tester@example.com', password: PASSWORD, autoLogin: false, ...extra })
const leaks = value => JSON.stringify(value).includes(PASSWORD)

test('login fills the saved password itself: approved once, the model sees no password anywhere', async () => {
  const f = fixture(); const account = await add(f)
  const opened = await f.run({ action: 'open', target: `https://${f.host}/login` })
  assert.equal(opened.page.login.required, true)
  assert.deepEqual(opened.page.login.accounts, [{ id: account.id, label: 'Test mail', username: 'tester@example.com', autoLogin: false }])
  const result = await f.run({ action: 'login', target: account.id, submit: true })
  assert.equal(result.status, 'signed_in')
  assert.equal(f.approvals.length, 1); assert.equal(f.approvals[0].tool, 'najd-browser-login')
  assert.ok(!leaks([result, opened, f.approvals]), 'no result or approval may carry the password')
  const loginCommand = f.site.commands.find(command => command.kind === 'login')
  assert.equal(loginCommand.args.password, PASSWORD, 'only the extension command carries it')
  assert.equal(loginCommand.args.submit, true, 'a sign-in always submits its form, whatever the unused submit flag says')
  assert.equal(loginCommand.args.host, f.host); assert.equal(loginCommand.args.passId, 'e2'); assert.equal(loginCommand.args.userId, 'e1')
})

test('an account with auto sign-in logs in without asking; a denial fills nothing', async () => {
  const auto = fixture(); const autoAccount = await add(auto, { autoLogin: true })
  await auto.run({ action: 'open', target: `https://${auto.host}/login` })
  assert.equal((await auto.run({ action: 'login', target: autoAccount.id })).status, 'signed_in')
  assert.equal(auto.approvals.length, 0)
  const asked = fixture(); const account = await add(asked)
  await asked.run({ action: 'open', target: `https://${asked.host}/login` })
  const denied = await asked.run({ action: 'login', target: account.id }, 'DENY')
  assert.equal(denied.status, 'denied_by_user')
  assert.ok(!asked.site.commands.some(command => command.kind === 'login'))
  assert.equal((await asked.vault.list())[0].lastUsedAt, null, 'the secret was never read')
})

test('it never signs in on another site, on a form that sets passwords, or without an account', async () => {
  const f = fixture(); const account = await add(f)
  f.site.page = loginPage('evil.example.net')
  assert.equal((await f.run({ action: 'login', target: account.id })).status, 'host_mismatch')
  f.site.page = { ...loginPage(f.host), elements: [field('e1', 'Email'), field('e2', 'New password', { type: 'password', sensitive: true }), field('e4', 'Confirm password', { type: 'password', sensitive: true })] }
  assert.equal((await f.run({ action: 'login', target: account.id })).status, 'not_a_login_form')
  f.site.page = loginPage(f.host)
  assert.equal((await f.run({ action: 'login', target: 'nobody' })).status, 'no_account')
  assert.ok(!f.site.commands.some(command => command.kind === 'login'))
  assert.ok(!leaks(f.approvals))
})

test('a wrong password is reported, then the account pauses after two failures to avoid a lockout', async () => {
  const f = fixture(); const account = await add(f, { autoLogin: true })
  await f.vault.remove(account.id)
  const wrong = await f.vault.add({ label: 'Wrong', siteUrl: 'https://' + f.host, username: 'tester@example.com', password: 'not-the-password', autoLogin: true })
  await f.run({ action: 'open', target: `https://${f.host}/login` })
  assert.equal((await f.run({ action: 'login', target: wrong.id })).status, 'login_not_completed')
  assert.equal((await f.run({ action: 'login', target: wrong.id })).status, 'login_not_completed')
  const paused = await f.run({ action: 'login', target: wrong.id })
  assert.equal(paused.status, 'paused_after_failures')
  assert.equal(f.site.checks, 2, 'no third attempt reached the site')
  assert.ok(!JSON.stringify([paused]).includes('not-the-password'))
})

test('a verification code or CAPTCHA page is handed back to the user', async () => {
  const f = fixture(); const account = await add(f, { autoLogin: true })
  f.site.page = loginPage(f.host)
  const bridgeCommand = f.tools // keep the tool, replace the site response through the page after login
  assert.ok(bridgeCommand)
  const original = f.site
  const needs = fixture(); const acc = await add(needs, { autoLogin: true })
  const command = needs.site.commands
  needs.site.page = loginPage(needs.host)
  // The site answers the sign-in with a one-time-code form.
  const tools = createBrowserTools({ vault: needs.vault, bridge: { status: () => ({ connected: true }), lastPage: () => needs.site.page,
    command: async kind => { command.push({ kind }); needs.site.page = { url: `https://${needs.host}/verify`, title: 'Verify', text: 'Enter the verification code we sent', scroll: { y: 0 }, elements: [field('e5', 'Verification code')] }; return needs.site.page } } })
  const result = await tools.run({ action: 'login', target: acc.id, text: '', submit: true }, { requestApproval: async () => 'ALLOW_ONCE' })
  assert.equal(result.status, 'needs_user_verification')
  assert.ok(original && account)
})

test('session reuse and expiry: an open session needs no sign-in, an expired one is detected and signed in again', async () => {
  const f = fixture(); const account = await add(f, { autoLogin: true })
  f.site.sessionValid = true // the user is already signed in in their own browser
  const reused = await f.run({ action: 'open', target: `https://${f.host}/account` })
  assert.equal(reused.page.title, 'Account'); assert.equal(reused.page.login, undefined)
  assert.ok(!f.site.commands.some(command => command.kind === 'login'))
  f.site.sessionValid = false // the session expired
  const expired = await f.run({ action: 'open', target: `https://${f.host}/account` })
  assert.equal(expired.page.login.required, true); assert.equal(expired.page.login.accounts[0].id, account.id)
  assert.equal((await f.run({ action: 'login', target: account.id })).status, 'signed_in')
  assert.equal(f.site.sessionValid, true)
})

test('revoking the authorization stops sign-ins at once', async () => {
  const f = fixture(); const account = await add(f, { autoLogin: true })
  await f.run({ action: 'open', target: `https://${f.host}/login` })
  await f.vault.remove(account.id)
  const result = await f.run({ action: 'login', target: account.id })
  assert.equal(result.status, 'no_account')
  const opened = await f.run({ action: 'open', target: `https://${f.host}/login` })
  assert.deepEqual(opened.page.login.accounts, [])
  assert.match(opened.page.login.note, /Settings > Accounts/)
  assert.ok(!f.site.commands.some(command => command.kind === 'login'))
})

test('a site that echoes the password back cannot show it to the model', async () => {
  const f = fixture({ echo: true }); const account = await add(f, { autoLogin: true })
  await f.run({ action: 'open', target: `https://${f.host}/login` })
  const result = await f.run({ action: 'login', target: account.id })
  assert.equal(result.status, 'signed_in')
  assert.ok(!leaks(result)); assert.match(result.page.text, /\[redacted\]/)
})

test('sensitive actions (delete account, money, payments, password changes) always use the strict approval, ordinary clicks do not', async () => {
  const f = fixture(); await add(f)
  f.site.page = accountPage(f.host)
  await f.run({ action: 'click', target: 'e9' })
  await f.run({ action: 'click', target: 'e8' })
  await f.run({ action: 'click', target: 'e7' })
  assert.deepEqual(f.approvals.map(item => item.tool), ['najd-browser-act', 'najd-browser-sensitive', 'najd-browser-sensitive'])
  assert.match(f.approvals[1].input.summary, /SENSITIVE ACTION/)
  const denied = await f.run({ action: 'click', target: 'e8' }, 'DENY')
  assert.equal(denied.status, 'denied_by_user')
})

test('the account list shows labels and usernames, never a password', async () => {
  const f = fixture(); await add(f)
  const result = await f.run({ action: 'accounts' })
  assert.equal(result.status, 'accounts'); assert.equal(result.accounts[0].username, 'tester@example.com')
  assert.ok(!leaks(result)); assert.ok(!('password' in result.accounts[0]))
})

test('full access mode still asks for sign-ins that were not pre-authorized and for sensitive actions', async () => {
  const { createNajdCore } = require('../electron/najd-core.cjs')
  const settle = () => new Promise(resolve => setTimeout(resolve, 40))
  const asked = []
  const core = createNajdCore({ model: async request => {
    for (const tool of ['najd-browser-act', 'najd-browser-login', 'najd-browser-sensitive']) {
      asked.push(tool)
      await request.requestApproval(tool, { path: 'https://x.test', summary: 's' })
    }
    return { kind: 'message', text: 'done' }
  } })
  const task = core.startTask({ text: 'go', intentId: 'full-access-login', accessMode: 'full' })
  await settle()
  // najd-browser-act was answered by the mode; the sign-in waits for the user.
  assert.equal(core.getTask(task.id).state, 'WAITING_APPROVAL')
  assert.equal(core.getTask(task.id).proposedTool, 'najd-browser-login')
  core.respondApproval(core.getTask(task.id).approvalId, 'ALLOW_ONCE'); await settle()
  assert.equal(core.getTask(task.id).state, 'WAITING_APPROVAL')
  assert.equal(core.getTask(task.id).proposedTool, 'najd-browser-sensitive')
  core.respondApproval(core.getTask(task.id).approvalId, 'DENY'); await settle()
  assert.deepEqual(asked, ['najd-browser-act', 'najd-browser-login', 'najd-browser-sensitive'])
})

test('a page that echoes the password in its address, title or labels is cleaned before the model or any approval sees it', async () => {
  const f = fixture(); const account = await add(f, { autoLogin: true })
  await f.run({ action: 'open', target: `https://${f.host}/login` })
  await f.run({ action: 'login', target: account.id })
  // The site now shows the password in places that are not the page text; the extension link reports it, the tool must clean it.
  const original = f.site.page
  f.site.page = { url: `https://${f.host}/account?echo=${encodeURIComponent(PASSWORD)}`, title: 'Hi ' + PASSWORD, text: 'ok', scroll: { y: 0 }, elements: [{ id: 'e1', role: 'button', label: 'Copy ' + PASSWORD }] }
  const tools = createBrowserTools({ vault: f.vault, bridge: { status: () => ({ connected: true }), lastPage: () => f.site.page, command: async () => JSON.parse(JSON.stringify(f.site.page)) } })
  const result = await tools.run({ action: 'read', target: '', text: '', submit: false }, { requestApproval: async () => 'ALLOW_ONCE' })
  assert.ok(!leaks(result), JSON.stringify(result))
  assert.ok(original)
})

test('sign-in is refused on registration, reset and unclear pages; only an affirmative sign-in form is filled', async () => {
  const f = fixture(); const account = await add(f, { autoLogin: true })
  const form = (url, title, button, autocomplete) => ({ url, title, text: '', scroll: { y: 0 }, elements: [field('e1', 'Email', { type: 'email' }),
    field('e2', 'Password', { type: 'password', sensitive: true, ...(autocomplete ? { autocomplete } : {}) }), { id: 'e3', role: 'button', label: button, submits: true }] })
  for (const [page, expected] of [
    [form(`https://${f.host}/register`, 'Create your account', 'Sign up'), 'not_a_login_form'],
    [form(`https://${f.host}/reset`, 'Reset password', 'Save'), 'not_a_login_form'],
    [form(`https://${f.host}/settings`, 'Settings', 'Save'), 'ambiguous_form'],
    [form(`https://${f.host}/x`, 'Welcome', 'Continue', 'current-password'), 'signed_in'],
    [form(`https://${f.host}/login`, 'Sign in', 'Sign in'), 'signed_in']]) {
    f.site.page = page
    assert.equal((await f.run({ action: 'login', target: account.id })).status, expected, page.url)
  }
})

test('a stopped task never fills a password: cancellation is honoured before the secret is read and before dispatch', async () => {
  const f = fixture(); const account = await add(f, { autoLogin: true })
  await f.run({ action: 'open', target: `https://${f.host}/login` })
  const controller = new AbortController(); controller.abort()
  await assert.rejects(f.tools.run({ action: 'login', target: account.id, text: '', submit: false }, { requestApproval: async () => 'ALLOW_ONCE', signal: controller.signal }), { code: 'CANCELLED' })
  assert.ok(!f.site.commands.some(command => command.kind === 'login'))
  assert.equal((await f.vault.list())[0].lastUsedAt, null, 'the secret was not even read')
})

test('typing into a field on a page about money or accounts uses the strict approval, with or without submit', async () => {
  const f = fixture(); await add(f)
  f.site.page = { url: `https://${f.host}/checkout`, title: 'Checkout', text: '', scroll: { y: 0 }, elements: [field('e1', 'Coupon')] }
  await f.run({ action: 'type', target: 'e1', text: 'SAVE10', submit: true })
  f.site.page = { url: `https://${f.host}/search`, title: 'Search', text: '', scroll: { y: 0 }, elements: [field('e1', 'Search')] }
  await f.run({ action: 'type', target: 'e1', text: 'lamps', submit: true })
  assert.deepEqual(f.approvals.map(item => item.tool), ['najd-browser-sensitive', 'najd-browser-act'])
})

test('one-time-code fields are left to the owner', async () => {
  const f = fixture(); await add(f)
  f.site.page = { url: `https://${f.host}/verify`, title: 'Verify', text: '', scroll: { y: 0 }, elements: [field('e1', 'Verification code', { sensitive: true })] }
  const result = await f.run({ action: 'type', target: 'e1', text: '123456' })
  assert.equal(result.status, 'needs_user')
  assert.equal(f.approvals.length, 0)
})

test('a sign-in whose page cannot be observed afterwards is an unknown effect and counts toward the pause', async () => {
  const f = fixture(); const account = await add(f, { autoLogin: true })
  await f.run({ action: 'open', target: `https://${f.host}/login` })
  const tools = createBrowserTools({ vault: f.vault, bridge: { status: () => ({ connected: true }), lastPage: () => f.site.page,
    command: async () => { throw Object.assign(new Error('PAGE_NOT_ACCESSIBLE'), { code: 'PAGE_NOT_ACCESSIBLE' }) } } })
  const attempt = () => tools.run({ action: 'login', target: account.id, text: '', submit: false }, { requestApproval: async () => 'ALLOW_ONCE' }).catch(failure => failure)
  const first = await attempt(); assert.equal(first.effectUnknown, true)
  await attempt()
  assert.equal((await tools.run({ action: 'login', target: account.id, text: '', submit: false }, { requestApproval: async () => 'ALLOW_ONCE' })).status, 'paused_after_failures')
})

test('R064-104: "Forgot password?" and a "Register" link on a sign-in page do not stop a sign-in; a registration submit button still does', async () => {
  const f = fixture(); const account = await add(f)
  f.site.page = loginPage(f.host, { elements: [{ id: 'e5', role: 'link', label: 'Forgot password?', href: 'https://x/forgot' }, { id: 'e6', role: 'button', label: 'Register' }] })
  assert.equal((await f.run({ action: 'login', target: account.id })).status, 'signed_in')
  const g = fixture(); const other = await add(g)
  g.site.page = { ...loginPage(g.host), elements: [field('e1', 'Email', { type: 'email' }), field('e2', 'Password', { type: 'password', sensitive: true }), { id: 'e3', role: 'button', label: 'Create account', submits: true }] }
  assert.equal((await g.run({ action: 'login', target: other.id })).status, 'not_a_login_form')
})

test('R064-101: an approved action is bound to the page and browser it was approved for; a changed page is refused, never redirected', async () => {
  const commands = []
  let token = 'chrome-extension://aaaa#1'
  const page = { url: 'https://shop.example.com/', title: 'Shop', scroll: { y: 0 }, elements: [{ id: 'e1', role: 'button', label: 'Buy' }] }
  const bridge = { status: () => ({ connected: true }), lastPage: () => page, pageToken: () => token,
    async command(kind, args, options) { commands.push({ kind, args, bind: options?.bind }); if (options?.bind !== token) throw Object.assign(new Error('PAGE_CHANGED'), { code: 'PAGE_CHANGED' }); return page } }
  const tools = createBrowserTools({ bridge })
  const run = (decision, change) => tools.run({ action: 'click', target: 'e1', text: '', submit: false }, { requestApproval: async () => { change?.(); return decision } })
  assert.equal((await run('ALLOW_ONCE')).status, 'clicked')
  assert.equal(commands.at(-1).bind, 'chrome-extension://aaaa#1', 'the command carries the token captured before the approval')
  const refused = await run('ALLOW_ONCE', () => { token = 'chrome-extension://bbbb#7' })
  assert.equal(refused.status, 'page_changed')
})

test('R064-REVIEW-102: a sign-in form that also pays or orders always needs the strict approval, auto sign-in account included', async () => {
  const f = fixture(); const account = await add(f, { autoLogin: true })
  f.site.page = { url: `https://${f.host}/checkout/confirm`, title: 'Sign in', text: '', scroll: { y: 0 }, elements: [field('e1', 'Email', { type: 'email' }),
    field('e2', 'Password', { type: 'password', sensitive: true, autocomplete: 'current-password', form: 'Pay', formAction: `https://${f.host}/checkout/confirm`, formKey: 'k' }), { id: 'e3', role: 'button', label: 'Pay', submits: true }] }
  const result = await f.run({ action: 'login', target: account.id })
  assert.equal(f.approvals.length, 1, 'asked although the account is auto sign-in')
  assert.equal(f.approvals[0].tool, 'najd-browser-sensitive')
  assert.match(f.approvals[0].input.summary, /SENSITIVE/)
  assert.equal(result.status, 'signed_in')
  // An ordinary sign-in form of an auto sign-in account still needs no approval.
  const plain = fixture(); const other = await add(plain, { autoLogin: true })
  plain.site.page = loginPage(plain.host)
  await plain.run({ action: 'login', target: other.id })
  assert.equal(plain.approvals.length, 0)
})

test('R064-REVIEW-3701: a password-typed field that is really a verification-code or payment field is never signed in to', async () => {
  for (const extra of [{ autocomplete: 'one-time-code' }, { label: 'Verification code' }, { label: 'رمز التحقق' }, { autocomplete: 'cc-csc' }, { names: 'Card number' }]) {
    const f = fixture(); const account = await add(f, { autoLogin: true })
    f.site.page = { ...loginPage(f.host), elements: [field('e1', 'Email', { type: 'email' }), field('e2', 'Password', { type: 'password', sensitive: true, ...extra }), { id: 'e3', role: 'button', label: 'Sign in', submits: true }] }
    const result = await f.run({ action: 'login', target: account.id })
    assert.equal(result.status, 'not_a_login_form', JSON.stringify(extra))
    assert.ok(!f.site.commands.some(command => command.kind === 'login'), 'nothing was sent to the browser')
  }
})

test('R064-REV-01: the saved password is only sent to the account\'s own site over https; any other form destination is refused before anything is filled', async () => {
  for (const formAction of ['http://collector.example/receive', 'https://collector.example/receive', 'https://evil.example.net/login', 'ftp://mail.example.com/x']) {
    const f = fixture(); const account = await add(f, { autoLogin: true })
    f.site.page = { ...loginPage(f.host), elements: [field('e1', 'Email', { type: 'email' }), field('e2', 'Password', { type: 'password', sensitive: true, formAction, form: 'Sign in', formKey: 'k' }), { id: 'e3', role: 'button', label: 'Sign in', submits: true }] }
    const result = await f.run({ action: 'login', target: account.id })
    assert.equal(result.status, 'destination_not_allowed', formAction)
    assert.ok(!f.site.commands.some(command => command.kind === 'login'), 'nothing was sent to the browser')
  }
  const good = fixture(); const goodAccount = await add(good, { autoLogin: true })
  good.site.page = { ...loginPage(good.host), elements: [field('e1', 'Email', { type: 'email' }), field('e2', 'Password', { type: 'password', sensitive: true, formAction: `https://${good.host}/session`, form: 'Sign in', formKey: 'k' }), { id: 'e3', role: 'button', label: 'Sign in', submits: true }] }
  assert.equal((await good.run({ action: 'login', target: goodAccount.id })).status, 'signed_in')
})
