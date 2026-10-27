const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const { createBrowserBridge } = require('../electron/browser-bridge.cjs')
const { createBrowserTools } = require('../electron/browser-tools.cjs')
const { createActionJournal } = require('../electron/action-journal.cjs')
const { createAgentRuntime, publicUrl } = require('../electron/agent-runtime.cjs')

const origin = `chrome-extension://${'c'.repeat(32)}`
// A tiny simulated web: search results → product page with a price → sign-up form with a password field.
const pages = {
  search: { url: 'https://www.google.com/search?q=desk+lamp', title: 'desk lamp - Search', text: 'Results: Najd Lamp store',
    elements: [{ id: 'e1', role: 'link', label: 'Najd Lamp – Shop', href: 'https://shop.example/lamp' }] },
  lamp: { url: 'https://shop.example/lamp', title: 'Najd Lamp', text: 'Najd Lamp — 149 SAR. Create an account to buy.',
    elements: [{ id: 'e2', role: 'button', label: 'Create account' }] },
  signup: { url: 'https://shop.example/signup', title: 'Sign up', text: 'Create your account',
    elements: [{ id: 'e3', role: 'field', label: 'Email', type: 'email', required: true }, { id: 'e4', role: 'field', label: 'Password', type: 'password', sensitive: true },
      { id: 'e5', role: 'button', label: 'Sign up', submits: true }] }
}

function fakeExtension(port, code) {
  const headers = { origin, authorization: `Bearer ${code}`, 'content-type': 'application/json' }
  const state = { page: null, received: [], typed: {} }
  let running = true
  const loop = (async () => {
    while (running) {
      const response = await fetch(`http://127.0.0.1:${port}/v2/command/next`, { headers }).catch(() => null)
      if (response?.status === 200) {
        const { id, kind, args } = await response.json()
        state.received.push({ kind, args })
        if (kind === 'open') state.page = args.url.includes('google.com') ? pages.search : pages.lamp
        if (kind === 'click') state.page = args.id === 'e1' ? pages.lamp : args.id === 'e2' ? pages.signup : state.page
        if (kind === 'type') state.typed[args.id] = args.text
        const page = { ...state.page, elements: state.page.elements.map(item => ({ ...item, ...(state.typed[item.id] ? { filled: true } : {}) })) }
        await fetch(`http://127.0.0.1:${port}/v2/command/result`, { method: 'POST', headers, body: JSON.stringify({ id, ok: true, result: kind === 'focus' ? { focused: true } : page, page }) })
      }
    }
  })()
  return { state, stop: async () => { running = false; await loop } }
}

test('search, open, read and links run directly; buttons and typing need approval; passwords are never typed by the model (authorized accounts are signed in by NAJD, R-063)', async t => {
  const bridge = createBrowserBridge({ filePath: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'najd-bt-')), 'link.json'),
    encryption: { isEncryptionAvailable: () => false }, ports: [38195, 38196], pollMs: 1000 })
  const { port } = await bridge.start()
  // Pair like the real extension: ask, the user allows in NAJD, collect the secret once.
  bridge.setHandlers({ onPairRequest: request => { void bridge.resolvePair(request.id, true) } })
  const asked = await (await fetch(`http://127.0.0.1:${port}/v2/pair/request`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: '{}' })).json()
  await new Promise(resolve => setTimeout(resolve, 30))
  const { secret: code } = await (await fetch(`http://127.0.0.1:${port}/v2/pair/status?id=${asked.id}`, { headers: { origin } })).json()
  const extension = fakeExtension(port, code)
  t.after(async () => { await bridge.stop(); await extension.stop() })
  for (let i = 0; i < 40 && !bridge.status().connected; i++) await new Promise(resolve => setTimeout(resolve, 50))
  const journal = createActionJournal({ filePath: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'najd-bt-')), 'actions.json') })
  const browser = createBrowserTools({ bridge, journal, allowUrl: publicUrl })
  const runtime = createAgentRuntime({ catalog: { search: async () => [], details: async () => ({}), summary: async () => '' }, library: { list: async () => [] }, browser, journal })
  const call = (args, id) => ({ kind: 'agent-tools', calls: [{ name: 'najd_browser', arguments: JSON.stringify(args), call_id: id }], items: [{ type: 'function_call', name: 'najd_browser', arguments: JSON.stringify(args), call_id: id }] })
  const steps = [
    { action: 'search', target: 'desk lamp', text: '', submit: false },
    { action: 'click', target: 'e1', text: '', submit: false },            // a link: no approval
    { action: 'click', target: 'e2', text: '', submit: false },            // a button: approval (deny)
    { action: 'click', target: 'e2', text: '', submit: false },            // a button: approval (allow)
    { action: 'type', target: 'e3', text: 'user@example.com', submit: false }, // typing: approval (allow)
    { action: 'type', target: 'e4', text: 'hunter2', submit: false },      // password: never typed by NAJD
    { action: 'open', target: 'http://192.168.1.1/admin', text: '', submit: false }
  ]
  const approvals = [], decisions = ['DENY', 'ALLOW_ONCE', 'ALLOW_ONCE'], outputs = []
  let turn = 0
  // A shopping/price request selects the research profile, which includes the linked browser.
  await runtime.run({ request: { text: 'ابحث لي عن سعر مصباح نجد وكم سعره' }, requestApproval: async (tool, input) => { approvals.push(input); return decisions.shift() }, respond: async request => {
    if (turn === 0) { assert.ok(request.tools.some(tool => tool.name === 'najd_browser')); assert.match(request.instructions, /Never ask for, type, repeat or store a password/) }
    if (turn > 0) outputs.push(JSON.parse(request.input.at(-1).output))
    return turn < steps.length ? call(steps[turn], 'w' + turn++) : { kind: 'message', text: 'Najd Lamp costs 149 SAR.' }
  } })
  assert.equal(outputs[0].status, 'searched'); assert.match(outputs[0].page.elements[0], /e1 link "Najd Lamp – Shop" → https:\/\/shop.example\/lamp/)
  assert.equal(outputs[1].status, 'clicked'); assert.match(outputs[1].page.text, /149 SAR/)
  assert.equal(outputs[2].status, 'denied_by_user')
  assert.equal(outputs[3].status, 'clicked'); assert.equal(outputs[3].page.title, 'Sign up')
  assert.equal(outputs[4].status, 'typed')
  assert.equal(outputs[5].status, 'needs_user'); assert.match(outputs[5].note, /typed by the user only/)
  assert.equal(outputs[6].error, 'PATH_NOT_ALLOWED', 'the model cannot point the browser at the local network')
  assert.equal(approvals.length, 3, 'only the two button presses and the typing asked')
  assert.match(approvals[0].summary, /Press "Create account" on shop.example/); assert.equal(approvals[2].preview, 'user@example.com')
  const kinds = extension.state.received.map(item => item.kind)
  assert.deepEqual(kinds, ['open', 'click', 'click', 'type', 'focus'], 'denied press and the password never reached the browser; the tab was shown for the password')
  assert.equal(extension.state.typed.e4, undefined)
  assert.deepEqual((await journal.list()).map(item => item.state), ['DENIED', 'COMPLETED', 'COMPLETED'])
})

test('the browser tool is offered only while the extension is connected', async t => {
  const bridge = createBrowserBridge({ filePath: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'najd-bt-')), 'link.json'), encryption: { isEncryptionAvailable: () => false }, ports: [38197] })
  await bridge.start(); t.after(() => bridge.stop())
  const runtime = createAgentRuntime({ catalog: { search: async () => [], details: async () => ({}), summary: async () => '' }, library: { list: async () => [] }, browser: createBrowserTools({ bridge }) })
  await runtime.run({ respond: async request => { assert.equal(request.tools.some(tool => tool.name === 'najd_browser'), false); return { kind: 'message', text: 'x' } } })
})

test('R064-203: pages are not read while the saved passwords cannot be loaded for masking', async () => {
  const bridge = { status: () => ({ connected: true }), lastPage: () => null, command: async () => { throw new Error('must not be called') } }
  const tools = createBrowserTools({ bridge, vault: { prime: async () => { throw new Error('CREDENTIAL_STORE_FAILED') }, scrubDeep: value => value, list: async () => [] } })
  const result = await tools.run({ action: 'read', target: '', text: '', submit: false }, { requestApproval: async () => 'ALLOW_ONCE' })
  assert.equal(result.status, 'vault_unavailable')
})

test('R064-402: an ordinary link is followed to the validated destination, a button is clicked, and both carry the approved target', async () => {
  const commands = []
  const page = { doc: 'doc1', url: 'https://shop.example.com/', title: 'Shop', scroll: { y: 0 }, elements: [
    { id: 'e1', role: 'link', label: 'Lamps', href: 'https://shop.example.com/lamps', target: 'https://shop.example.com/lamps?sort=price' },
    { id: 'e2', role: 'button', label: 'Add to basket' }] }
  const bridge = { status: () => ({ connected: true }), lastPage: () => page, pageToken: () => 'tok#1', async command(kind, args) { commands.push({ kind, args }); return page } }
  const tools = createBrowserTools({ bridge })
  const context = { requestApproval: async () => 'ALLOW_ONCE' }
  await tools.run({ action: 'click', target: 'e1', text: '', submit: false }, context)
  assert.equal(commands[0].args.expect.plain, true); assert.equal(commands[0].args.expect.doc, 'doc1')
  await tools.run({ action: 'click', target: 'e2', text: '', submit: false }, context)
  assert.equal(commands[1].args.expect.plain, false)
})

test('R064-IR-002: the whole link destination, query and decoded values included, is classified; a very long destination always asks', async () => {
  const commands = [], approvals = []
  const mk = target => ({ doc: 'd', snap: 1, url: 'https://app.example.com/', title: 'App', scroll: { y: 0 }, elements: [{ id: 'e1', role: 'link', label: 'Continue', href: 'https://app.example.com/action', target }] })
  const run = async (target, extra = {}) => {
    const page = mk(target); Object.assign(page.elements[0], extra)
    const tools = createBrowserTools({ bridge: { status: () => ({ connected: true }), lastPage: () => page, pageToken: () => 't#1', async command(kind, args) { commands.push(args); return page } } })
    return tools.run({ action: 'click', target: 'e1', text: '', submit: false }, { requestApproval: async tool => { approvals.push(tool); return 'ALLOW_ONCE' } })
  }
  await run('https://app.example.com/action?operation=delete_account')
  await run('https://app.example.com/action?op=delete%2520account%26x')
  assert.deepEqual(approvals, ['najd-browser-sensitive', 'najd-browser-sensitive'])
  approvals.length = 0
  await run('https://app.example.com/action?page=2')
  assert.deepEqual(approvals, [], 'an ordinary link is followed without asking')
  await run('https://app.example.com/action?' + 'a'.repeat(2100), { longTarget: true })
  assert.equal(approvals.length, 1, 'a destination too long to classify completely asks')
})

test('R064-REV-501: typing with submit asks strictly when the form it submits has a sensitive submit button or destination', async () => {
  const approvals = [], args = []
  const page = (form, formAction) => ({ doc: 'd', snap: 1, url: 'https://shop.example.com/review', title: 'Review', scroll: { y: 0 }, elements: [{ id: 'e1', role: 'field', label: 'Notes', type: 'text', form, formAction }] })
  const run = async (form, formAction, submit) => {
    const current = page(form, formAction)
    const tools = createBrowserTools({ bridge: { status: () => ({ connected: true }), lastPage: () => current, pageToken: () => 't#1', async command(kind, a) { args.push(a); return current } } })
    return tools.run({ action: 'type', target: 'e1', text: 'hello', submit }, { requestApproval: async tool => { approvals.push(tool); return 'ALLOW_ONCE' } })
  }
  await run('Place order', 'https://shop.example.com/review', true)
  await run('Save', 'https://shop.example.com/checkout/confirm?op=pay', true)
  assert.deepEqual(approvals, ['najd-browser-sensitive', 'najd-browser-sensitive'])
  approvals.length = 0
  await run('Save', 'https://shop.example.com/notes', true)
  await run('Place order', 'https://shop.example.com/review', false)
  assert.deepEqual(approvals, ['najd-browser-act', 'najd-browser-act'])
  assert.equal(args[0].expect.formKey, '', 'the form identity is carried as a key')
})

test('R064-REVIEW-002: pressing a submit button is classified by where it sends the form, and the form is bound to the approval', async () => {
  const approvals = [], commands = []
  const page = (formAction, form) => ({ doc: 'd', snap: 1, url: 'https://shop.example.com/review', title: 'Review', scroll: { y: 0 }, elements: [{ id: 'e1', role: 'button', label: 'Continue', submits: true, form, formAction, formKey: 'k1' }] })
  const run = async (formAction, form) => {
    const current = page(formAction, form)
    const tools = createBrowserTools({ bridge: { status: () => ({ connected: true }), lastPage: () => current, pageToken: () => 't#1', async command(kind, args) { commands.push(args); return current } } })
    return tools.run({ action: 'click', target: 'e1', text: '', submit: false }, { requestApproval: async tool => { approvals.push(tool); return 'ALLOW_ONCE' } })
  }
  await run('https://shop.example.com/pay?confirm=1', 'Continue')
  await run('https://shop.example.com/review/next', 'Place order')
  await run('https://shop.example.com/review/next', 'Continue')
  assert.deepEqual(approvals, ['najd-browser-sensitive', 'najd-browser-sensitive', 'najd-browser-act'])
  assert.equal(commands[0].expect.formKey, 'k1')
})

test('R064-SEC-02: complete submit labels are classified, and metadata that could not be described completely always asks strictly', async () => {
  const approvals = []
  const run = async extra => {
    const page = { doc: 'd', snap: 1, url: 'https://shop.example.com/review', title: 'Review', scroll: { y: 0 }, elements: [{ id: 'e1', role: 'field', label: 'Comments', type: 'text', formKey: 'k', ...extra }] }
    const tools = createBrowserTools({ bridge: { status: () => ({ connected: true }), lastPage: () => page, pageToken: () => 't#1', async command() { return page } } })
    return tools.run({ action: 'type', target: 'e1', text: 'hi', submit: true }, { requestApproval: async tool => { approvals.push(tool); return 'ALLOW_ONCE' } })
  }
  await run({ form: 'x'.repeat(300) + ' Place order', formAction: 'https://shop.example.com/review' })
  await run({ form: 'Save', formAction: 'https://shop.example.com/review', formIncomplete: true })
  await run({ form: 'Save', formAction: 'https://shop.example.com/review' })
  assert.deepEqual(approvals, ['najd-browser-sensitive', 'najd-browser-sensitive', 'najd-browser-act'])
})

test('R064-IR-301: a link whose destination was too long to classify completely asks strictly, with a sensitive operation beyond the cut', async () => {
  const approvals = []
  const page = { doc: 'd', snap: 1, url: 'https://app.example.com/', title: 'App', scroll: { y: 0 }, elements: [{ id: 'e1', role: 'link', label: 'Continue', href: 'https://app.example.com/go', target: 'https://app.example.com/go?x=' + 'a'.repeat(1960), longTarget: true }] }
  const tools = createBrowserTools({ bridge: { status: () => ({ connected: true }), lastPage: () => page, pageToken: () => 't#1', async command() { return page } } })
  await tools.run({ action: 'click', target: 'e1', text: '', submit: false }, { requestApproval: async tool => { approvals.push(tool); return 'ALLOW_ONCE' } })
  assert.deepEqual(approvals, ['najd-browser-sensitive'])
})

test('R064-REV-601: an element whose description lost anything (budget, parsing) always asks strictly, and is never followed as a plain link', async () => {
  const approvals = []
  const run = async (item, action, submit) => {
    const page = { doc: 'd', snap: 1, url: 'https://shop.example.com/review', title: 'Review', scroll: { y: 0 }, elements: [item] }
    const tools = createBrowserTools({ bridge: { status: () => ({ connected: true }), lastPage: () => page, pageToken: () => 't#1', async command() { return page } } })
    return tools.run({ action, target: item.id, text: 'hi', submit }, { requestApproval: async tool => { approvals.push(tool); return 'ALLOW_ONCE' } })
  }
  await run({ id: 'e1', role: 'field', label: 'Comments', type: 'text', form: '', incomplete: true, formKey: 'k' }, 'type', true)
  await run({ id: 'e2', role: 'link', label: 'Continue', href: 'https://shop.example.com/a', target: 'https://shop.example.com/a?x=1', incomplete: true }, 'click', false)
  await run({ id: 'e3', role: 'field', label: 'Comments', type: 'text', form: 'Save', formAction: 'https://shop.example.com/x', formIncomplete: true, formKey: 'k' }, 'type', true)
  assert.deepEqual(approvals, ['najd-browser-sensitive', 'najd-browser-sensitive', 'najd-browser-sensitive'])
})

test('R064-REVIEW-002: choosing an option is classified by that option, its value and the flags the bridge set before masking', async () => {
  const approvals = []
  const run = async (text, extra = {}) => {
    const page = { doc: 'd', snap: 1, url: 'https://app.example.com/settings', title: 'Account settings', scroll: { y: 0 }, elements: [{ id: 'e1', role: 'select', label: 'Action', options: [], optionPairs: [['Standard', 'free', false], ['Delete account', 'del', true], ['Plan', 'cancel_my_account', false]], ...extra }] }
    const tools = createBrowserTools({ bridge: { status: () => ({ connected: true }), lastPage: () => page, pageToken: () => 't#1', async command() { return page } } })
    return tools.run({ action: 'select', target: 'e1', text, submit: false }, { requestApproval: async tool => { approvals.push(tool); return 'ALLOW_ONCE' } })
  }
  await run('Delete account')
  await run('del')
  assert.equal((await run('Unknown option')).status, 'option_not_found')
  await run('Standard', { optionsIncomplete: true })
  await run('Standard')
  assert.deepEqual(approvals, ['najd-browser-sensitive', 'najd-browser-sensitive', 'najd-browser-sensitive', 'najd-browser-act'])
})

test('R064-REVIEW-001: flags set by the bridge are honoured even when the visible words were masked', async () => {
  const approvals = []
  const page = { doc: 'd', snap: 1, url: 'https://shop.example.com/', title: 'Shop', scroll: { y: 0 }, elements: [{ id: 'e1', role: 'link', label: 'Continue', href: 'https://shop.example.com/[redacted]', target: 'https://shop.example.com/[redacted]', strict: true }] }
  const tools = createBrowserTools({ bridge: { status: () => ({ connected: true }), lastPage: () => page, pageToken: () => 't#1', async command() { return page } } })
  await tools.run({ action: 'click', target: 'e1', text: '', submit: false }, { requestApproval: async tool => { approvals.push(tool); return 'ALLOW_ONCE' } })
  assert.deepEqual(approvals, ['najd-browser-sensitive'])
})

test('R064-IR-2801: an option that matches more than one entry is refused, and the classified option is carried by position', async () => {
  const commands = [], approvals = []
  const page = { doc: 'd', snap: 1, url: 'https://app.example.com/settings', title: 'Settings', scroll: { y: 0 }, elements: [{ id: 'e1', role: 'select', label: 'Action', options: [], optionPairs: [['Standard', 'free', false], ['Delete account', 'Standard', true], ['Premium', 'premium', false]] }] }
  const tools = createBrowserTools({ bridge: { status: () => ({ connected: true }), lastPage: () => page, pageToken: () => 't#1', async command(kind, args) { commands.push(args); return page } } })
  const context = { requestApproval: async tool => { approvals.push(tool); return 'ALLOW_ONCE' } }
  const ambiguous = await tools.run({ action: 'select', target: 'e1', text: 'Standard', submit: false }, context)
  assert.equal(ambiguous.status, 'ambiguous_option'); assert.equal(approvals.length, 0); assert.equal(commands.length, 0)
  await tools.run({ action: 'select', target: 'e1', text: 'premium', submit: false }, context)
  assert.equal(commands[0].expect.optionIndex, 2)
})

test('R064-REVIEW-3201: ordinary purchase wording is sensitive in buttons, forms, options and pages, and the sensitive tool is always asked, also in full access', async () => {
  const approvals = []
  const run = async (item, action = 'click', submit = false, text = 'x') => {
    const page = { doc: 'd', snap: 1, url: 'https://shop.example/', title: 'Shop', scroll: { y: 0 }, elements: [item] }
    const tools = createBrowserTools({ bridge: { status: () => ({ connected: true }), lastPage: () => page, pageToken: () => 't#1', async command() { return page } } })
    return tools.run({ action, target: item.id, text, submit }, { requestApproval: async tool => { approvals.push(tool); return 'ALLOW_ONCE' } })
  }
  for (const label of ['Buy now', 'Purchase', 'Subscribe', 'Upgrade now', 'Donate', 'Book now', 'Complete order', 'Confirm payment', 'Proceed to payment', 'اشتر الآن', 'تأكيد الطلب', 'احجز الآن'])
    await run({ id: 'e1', role: 'button', label })
  await run({ id: 'e2', role: 'field', label: 'Notes', type: 'text', form: 'Buy now', formAction: 'https://shop.example/submit', formKey: 'k' }, 'type', true)
  await run({ id: 'e3', role: 'select', label: 'Plan', optionPairs: [['Purchase', 'p', false]] }, 'select', false, 'Purchase')
  assert.ok(approvals.every(tool => tool === 'najd-browser-sensitive'), approvals.join(','))
  assert.equal(approvals.length, 14)
  const core = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'electron', 'najd-core.cjs'), 'utf8')
  assert.match(core, /ALWAYS_ASK = new Set\(\[[^\]]*'najd-browser-sensitive'/)
  approvals.length = 0
  await run({ id: 'e4', role: 'button', label: 'Add note' })
  assert.deepEqual(approvals, ['najd-browser-act'])
})

test('R064-REV-3501: all of an element\'s accessible names are classified, not just the first', async () => {
  const approvals = []
  const page = { doc: 'd', snap: 1, url: 'https://app.example.com/', title: 'Settings', scroll: { y: 0 }, elements: [{ id: 'e1', role: 'button', label: 'Continue', names: 'Continue | Delete account' }] }
  const tools = createBrowserTools({ bridge: { status: () => ({ connected: true }), lastPage: () => page, pageToken: () => 't#1', async command() { return page } } })
  await tools.run({ action: 'click', target: 'e1', text: '', submit: false }, { requestApproval: async tool => { approvals.push(tool); return 'ALLOW_ONCE' } })
  assert.deepEqual(approvals, ['najd-browser-sensitive'])
})

test('R064-REVIEW-4101: options are shown with selection tokens, duplicates and long labels show their value, and any option can be chosen by its token', async () => {
  const commands = []
  const long = 'L'.repeat(80)
  const page = { doc: 'd', snap: 1, url: 'https://app.example.com/', title: 'Settings', scroll: { y: 0 }, elements: [{ id: 'e1', role: 'select', label: 'Plan', options: [],
    optionPairs: [['Standard', 'free', false], ['Premium', 'p1', false], ['Premium', 'p2', false], [long, 'long-one', false], ...Array.from({ length: 45 }, (_, index) => ['Extra ' + index, 'x' + index, false])] }] }
  const tools = createBrowserTools({ bridge: { status: () => ({ connected: true }), lastPage: () => page, pageToken: () => 't#1', async command(kind, args) { commands.push(args); return page } } })
  const read = await tools.run({ action: 'read', target: '', text: '', submit: false }, {})
  const shown = JSON.stringify(read.page.elements)
  assert.match(shown, /#0 Standard/); assert.match(shown, /#1 Premium \[value: p1\]/); assert.match(shown, /#2 Premium \[value: p2\]/); assert.match(shown, /\[value: long-one\]/); assert.match(shown, /\+9 more/)
  const context = { requestApproval: async () => 'ALLOW_ONCE' }
  assert.equal((await tools.run({ action: 'select', target: 'e1', text: 'Premium', submit: false }, context)).status, 'ambiguous_option')
  await tools.run({ action: 'select', target: 'e1', text: '#2', submit: false }, context)
  assert.equal(commands.at(-1).expect.optionIndex, 2)
  await tools.run({ action: 'select', target: 'e1', text: '#48', submit: false }, context)
  assert.equal(commands.at(-1).expect.optionIndex, 48, 'an option beyond the shown list is chosen by its token')
  assert.equal((await tools.run({ action: 'select', target: 'e1', text: '#99', submit: false }, context)).status, 'option_not_found')
})

test('R064-IR-4201: links and forms that lead to this computer or a private network are refused, whatever the click would need', async () => {
  const commands = []
  const allowUrl = url => !/^https?:\/\/(127\.|localhost|10\.|192\.168\.)/.test(url)
  const page = { doc: 'd', snap: 1, url: 'https://shop.example.com/', title: 'Shop', scroll: { y: 0 }, elements: [
    { id: 'e1', role: 'link', label: 'Admin', href: 'http://127.0.0.1:8080/action', target: 'http://127.0.0.1:8080/action?x=1' },
    { id: 'e2', role: 'link', label: 'News', href: 'https://news.example.com/a', target: 'https://news.example.com/a' },
    { id: 'e3', role: 'button', label: 'Save', submits: true, form: 'Save', formAction: 'http://192.168.1.10/save', formKey: 'k' },
    { id: 'e4', role: 'field', label: 'Notes', type: 'text', form: 'Save', formAction: 'http://localhost/save', formKey: 'k' }] }
  const tools = createBrowserTools({ bridge: { status: () => ({ connected: true }), lastPage: () => page, pageToken: () => 't#1', async command(kind, args) { commands.push(args); return page } }, allowUrl })
  const context = { requestApproval: async () => 'ALLOW_ONCE' }
  assert.equal((await tools.run({ action: 'click', target: 'e1', text: '', submit: false }, context)).status, 'url_not_allowed')
  assert.equal((await tools.run({ action: 'click', target: 'e3', text: '', submit: false }, context)).status, 'url_not_allowed')
  assert.equal((await tools.run({ action: 'type', target: 'e4', text: 'hi', submit: true }, context)).status, 'url_not_allowed')
  assert.equal(commands.length, 0, 'nothing was sent to the browser')
  assert.equal((await tools.run({ action: 'click', target: 'e2', text: '', submit: false }, context)).status, 'clicked')
})

test('R064-IR-4202: the approval of a choice shows the resolved label, value and position, and the journal fingerprint holds them', async () => {
  const approvals = []
  const page = { doc: 'd', snap: 1, url: 'https://app.example.com/', title: 'Settings', scroll: { y: 0 }, elements: [{ id: 'e1', role: 'select', label: 'Action', options: [], optionPairs: [['Keep', 'keep', false], ['Pause', 'pause', false], ['Delete account', 'x1', true]] }] }
  const journalled = []
  const journal = { prepare: async entry => { journalled.push(entry); return { id: 'a', nonce: 'n' } }, decide: async () => {}, claim: async () => {}, finish: async () => {}, cancel: async () => {} }
  const tools = createBrowserTools({ bridge: { status: () => ({ connected: true }), lastPage: () => page, pageToken: () => 't#1', async command() { return page } }, journal })
  await tools.run({ action: 'select', target: 'e1', text: '#2', submit: false }, { requestApproval: async (tool, input) => { approvals.push({ tool, input }); return 'ALLOW_ONCE' } })
  assert.equal(approvals[0].tool, 'najd-browser-sensitive')
  assert.match(approvals[0].input.summary, /Delete account \[value: x1\] \(#2\)/); assert.match(approvals[0].input.preview, /Delete account \[value: x1\]/)
  assert.ok(journalled.length === 1)
  // The same request for another option has another fingerprint.
  await tools.run({ action: 'select', target: 'e1', text: '#1', submit: false }, { requestApproval: async () => 'ALLOW_ONCE' })
  assert.notEqual(journalled[0].changeHash, journalled[1].changeHash)
})

test('R064-REVIEW-4501: a page the tab ended up on (a redirect) is judged like a requested address: refused, emptied and forgotten', async () => {
  const log = []
  const allowUrl = url => !/^https?:\/\/(127\.|localhost|10\.|192\.168\.)/.test(url)
  const bridge = { status: () => ({ connected: true }), lastPage: () => null, pageToken: () => null, forgetPage: () => log.push('forget'),
    async command(kind, args) {
      log.push(kind)
      if (kind === 'park') return { parked: true }
      return { url: kind === 'open' && args.url === 'https://redirects.example.com/' ? 'http://192.168.1.1/admin' : 'https://ok.example.com/', title: 'x', text: 'secret admin page', elements: [] }
    } }
  const tools = createBrowserTools({ bridge, allowUrl })
  const result = await tools.run({ action: 'open', target: 'https://redirects.example.com/', text: '', submit: false }, {})
  assert.equal(result.status, 'url_not_allowed'); assert.ok(!JSON.stringify(result).includes('secret admin page'), 'nothing of the page reaches the model')
  assert.deepEqual(log, ['open', 'park', 'forget'])
  const fine = await tools.run({ action: 'open', target: 'https://ok.example.com/', text: '', submit: false }, {})
  assert.equal(fine.status, 'opened')
})

test('R064-REVIEW-4601: a public-looking host name that resolves to a private address is refused when opened, when it is where the tab ended up, and as a link or form destination', async () => {
  const resolves = { 'router.example.com': false, 'ok.example.com': true }
  const resolveUrl = async url => resolves[new URL(url).hostname] ?? true
  const log = []
  const page = { doc: 'd', snap: 1, url: 'https://ok.example.com/', title: 'Shop', scroll: { y: 0 }, elements: [
    { id: 'e1', role: 'link', label: 'Admin', href: 'https://router.example.com/a', target: 'https://router.example.com/a' },
    { id: 'e2', role: 'button', label: 'Save', submits: true, formAction: 'https://router.example.com/save', formKey: 'k' }] }
  const bridge = { status: () => ({ connected: true }), lastPage: () => page, pageToken: () => 't#1', forgetPage: () => log.push('forget'),
    async command(kind, args) { log.push(kind); if (kind === 'park') return { parked: true }; return { ...page, url: args?.url === 'https://redirect.example.com/' ? 'https://router.example.com/' : (args?.url || page.url) } } }
  const tools = createBrowserTools({ bridge, resolveUrl })
  await assert.rejects(tools.run({ action: 'open', target: 'https://router.example.com/', text: '', submit: false }, {}), { code: 'PATH_NOT_ALLOWED' })
  assert.equal((await tools.run({ action: 'open', target: 'https://redirect.example.com/', text: '', submit: false }, {})).status, 'url_not_allowed')
  assert.ok(log.includes('park') && log.includes('forget'))
  const context = { requestApproval: async () => 'ALLOW_ONCE' }
  assert.equal((await tools.run({ action: 'click', target: 'e1', text: '', submit: false }, context)).status, 'url_not_allowed')
  assert.equal((await tools.run({ action: 'click', target: 'e2', text: '', submit: false }, context)).status, 'url_not_allowed')
  assert.equal((await tools.run({ action: 'open', target: 'https://ok.example.com/', text: '', submit: false }, {})).status, 'opened')
})

test('a button whose label is longer than the approval can show is flagged as shown only in part', async () => {
  const seen = []
  const label = 'Send the payment to ' + 'the long recipient name '.repeat(8) + 'ACCOUNT-9'
  const page = { doc: 'd', snap: 1, url: 'https://bank.example.com/', title: 'Bank', scroll: { y: 0 }, elements: [{ id: 'e1', role: 'button', label }, { id: 'e2', role: 'button', label: 'Save' }] }
  const tools = createBrowserTools({ bridge: { status: () => ({ connected: true }), lastPage: () => page, pageToken: () => 't#1', async command() { return page } } })
  const ask = id => tools.run({ action: 'click', target: id, text: '', submit: false }, { requestApproval: async (tool, input) => { seen.push(input); return 'DENY' } })
  await ask('e1'); await ask('e2')
  assert.equal(seen[0].truncated, true); assert.equal(seen[1].truncated, false)
})

test('a page address that reached the bridge cap flags every approval as shown only in part', async () => {
  const seen = []
  const url = 'https://app.example.com/path?' + 'q=1&'.repeat(125)
  const page = { doc: 'd', snap: 1, url: url.slice(0, 500), title: 'App', scroll: { y: 0 }, elements: [{ id: 'e1', role: 'button', label: 'Confirm' }] }
  const tools = createBrowserTools({ bridge: { status: () => ({ connected: true }), lastPage: () => page, pageToken: () => 't#1', async command() { return page } } })
  await tools.run({ action: 'click', target: 'e1', text: '', submit: false }, { requestApproval: async (tool, input) => { seen.push(input); return 'DENY' } })
  assert.equal(seen[0].truncated, true)
})
