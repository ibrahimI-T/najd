// Real browser check of the NAJD extension: Microsoft Edge with a temporary profile (never the user's), the unpacked extension,
// paired through its own panel the way a user does it (Connect, then the confirmation on the NAJD side), then driven through the
// real NAJD bridge on a local site. Also covers asking NAJD from the side panel. Usage: npm run smoke:browser
const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), http = require('node:http')
const { createBrowserBridge } = require('../electron/browser-bridge.cjs')
const { edge, sleep, launch, pairThroughPanel } = require('./helpers/edge-extension.cjs')

const site = {
  '/shop': '<!doctype html><title>Lamp shop</title><h1>Lamps</h1><a id="lamp" href="/lamp">Najd Lamp</a>',
  '/lamp': '<!doctype html><title>Najd Lamp</title><p>Price: 149 SAR</p><a href="/signup">Create account</a>',
  '/mutate': '<!doctype html><title>Notes</title><form id="f" action="/notes" onsubmit="event.preventDefault();document.title=\'Submitted\'"><label for="n">Notes</label><input id="n" type="text" oninput="document.getElementById(\'f\').action=\'/pay\'"><button type="submit">Save</button></form>',
  '/external': '<!doctype html><title>Review</title><form id="f" action="/review"><label for="n">Comments</label><input id="n" type="text"></form><button form="f" type="submit">Place order</button><input type="image" form="f" alt="Pay now" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=">',
  '/focus': '<!doctype html><title>Focus</title><label for="n">Notes</label><input id="n" type="text" onfocus="this.setAttribute(\'autocomplete\',\'one-time-code\')">',
  '/relabel': '<!doctype html><title>Relabel</title><label for="n">Notes</label><input id="n" type="text" onfocus="this.setAttribute(\'aria-label\',\'Recipient account number\')">',
  '/big': '<!doctype html><title>Big</title>' + Array.from({ length: 60 }, (_, index) => '<button type="button">' + 'B'.repeat(9000) + index + '</button>').join('') + '<form action="/review"><label for="n">Comments</label><input id="n" type="text"><button type="submit">Place order</button></form>',
  '/option': '<!doctype html><title>Plan</title><label for="s">Plan</label><select id="s"><option value="free">Standard</option><option value="premium">Premium</option></select><script>setTimeout(() => { document.getElementById(\'s\').options[0].value = \'premium\' }, 1500)</script>',
  '/arabic': '<!doctype html><meta charset="utf-8"><title>دفع</title><label for="x">رقم البطاقة</label><input id="x" type="text"><label for="y">ملاحظات</label><input id="y" type="text">',
  '/reorder': '<!doctype html><title>Reorder</title><label for="s">Action</label><select id="s"><option value="free">Standard</option><option value="Standard">Delete account</option></select><script>setTimeout(() => { const s = document.getElementById("s"); s.add(s.options[0]) }, 1500)</script>',
  '/longlabel': '<!doctype html><title>Long</title><button id="b" type="button">' + 'x'.repeat(100) + ' harmless</button><script>setTimeout(() => { document.getElementById("b").textContent = "x".repeat(100) + " Delete account" }, 1500)</script>',
  '/longoption': '<!doctype html><title>Plan</title><label for="s">Plan</label><select id="s"><option value="free">Standard</option><option value="' + 'a'.repeat(10000) + 'delete_account">Premium</option></select>',
  '/expiry': '<!doctype html><title>Pay</title><label for="e">Card expiry date</label><input id="e" type="text"><label for="m">Card expiry month</label><select id="m"><option>01</option><option>02</option></select><label for="q">Quantity</label><input id="q" type="text">',
  '/shared': '<!doctype html><title>Shared</title><label for="s">Account action</label><select id="s"><option value="x">Delete account</option><option value="x">Keep account</option></select><script>document.getElementById("s").onchange = event => { document.title = "chose " + event.target.selectedOptions[0].text }</script>',
  '/names': '<!doctype html><title>Names</title><button id="b" type="button" aria-label="Continue">Delete account</button><span id="n">Keep</span><button id="c" type="button" aria-labelledby="n">Go</button><script>setTimeout(() => { document.getElementById("n").textContent = "Remove everything" }, 1500)</script>',
  '/dest': '<!doctype html><title>Review</title><form action="/pay"><label for="n">Notes</label><input id="n" type="text"><button type="submit">Continue</button></form>',
  '/ariabutton': '<!doctype html><title>Review</title><form action="/review"><label for="n">Notes</label><input id="n" type="text"><button id="b" type="submit" aria-label="Pay">Continue</button></form><script>setTimeout(() => { document.getElementById("b").setAttribute("aria-label", "Save") }, 1500)</script>',
  '/titlebad': '<!doctype html><title>Settings</title><button id="b" type="button">Continue</button><script>setTimeout(() => { document.title = "Checkout" }, 1500)</script>',
  '/titleok': '<!doctype html><title>Inbox</title><button id="b" type="button" onclick="document.title = \'Clicked\'">Continue</button><script>setTimeout(() => { document.title = "Inbox (3)" }, 1500)</script>',
  '/arialink': '<!doctype html><title>Aria</title><div id="d" role="link" tabindex="0" onclick="document.title = \'Activated\'">Details</div>',
  '/multi': '<!doctype html><title>Multi</title><label for="m">Tags</label><select id="m" multiple><option selected>One</option><option>Two</option></select>',
  '/details': '<!doctype html><title>Details</title><details><summary>Filters</summary><button type="button">Apply filter</button></details>',
  '/editable': '<!doctype html><title>Editable</title><div id="e" contenteditable="true" role="textbox"></div>',
  '/imagesubmit': '<!doctype html><title>Image</title><form action="/review"><input id="n" type="text"><input type="image" alt="Go" formaction="http://127.0.0.1:1/z" src="data:image/gif;base64,R0lGODlhAQABAAAAACw="></form>',
  '/signup': '<!doctype html><title>Sign up</title><form onsubmit="event.preventDefault();document.title=\'Submitted \'+document.querySelector(\'#email\').value"><label for="email">Email</label><input id="email" type="email"><label for="pw">Password</label><input id="pw" type="password" autocomplete="new-password"><label for="otp">Verification code</label><input id="otp" type="text" autocomplete="one-time-code"><label for="vc">Security verification code</label><input id="vc" type="text"><input id="px" type="text" placeholder="Enter the OTP we sent you"><button type="submit">Create</button></form>'
}

async function main() {
  if (!edge) { console.log('SKIP: Microsoft Edge not found'); return }
  const server = http.createServer((request, response) => { const page = site[new URL(request.url, 'http://x').pathname]; response.writeHead(page ? 200 : 404, { 'Content-Type': 'text/html; charset=utf-8' }).end(page || 'not found') })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'najd-bridge-smoke-'))
  const bridge = createBrowserBridge({ filePath: path.join(dir, 'link.json'), encryption: { isEncryptionAvailable: () => false }, ports: [38211, 38212, 38213] })
  await bridge.start()
  const browser = await launch({ debugPort: 39233 })
  try {
    // Pair through the panel: unlinked at first, Connect, the same code on both sides, then linked.
    const panel = await browser.openPanel()
    assert.equal(await panel.eval("document.getElementById('status').dataset.state"), 'unlinked')
    assert.equal(await panel.eval("document.getElementById('view-unlinked').hidden"), false)
    const request = await pairThroughPanel(bridge, panel)
    assert.ok(request, 'NAJD received a pairing request')
    assert.match(request.code, /^\d{6}$/); assert.match(request.name, /Edge/)
    for (let i = 0; i < 60 && !bridge.status().connected; i++) await sleep(250)
    assert.equal(bridge.status().paired, true); assert.equal(bridge.status().connected, true, 'the extension polls NAJD after pairing')
    for (let i = 0; i < 20 && (await panel.eval("document.getElementById('status').dataset.state")) !== 'connected'; i++) await sleep(250)
    assert.equal(await panel.eval("document.getElementById('status').dataset.state"), 'connected')
    assert.equal(await panel.eval("document.getElementById('view-linked').hidden"), false)

    const open = await bridge.command('open', { url: base + '/shop' }, { timeoutMs: 45000 })
    assert.equal(open.title, 'Lamp shop')
    const link = open.elements.find(item => item.role === 'link' && item.label === 'Najd Lamp')
    assert.ok(link?.href.endsWith('/lamp'), 'links are listed with their target')
    // The destination a link had when it was classified is part of what was approved: a different one is refused.
    assert.match(link.target, /\/lamp$/, 'the snapshot records the full destination'); assert.ok(open.snap >= 1, 'each snapshot is numbered')
    await assert.rejects(bridge.command('click', { id: link.id, expect: { doc: open.doc, snap: '0', role: 'link', label: link.label } }), { code: 'PAGE_CHANGED' })
    const lamp = await bridge.command('click', { id: link.id })
    assert.match(lamp.text, /149 SAR/)
    // An approved action runs only in the document and on the element that were approved.
    const target = lamp.elements.find(item => item.label === 'Create account')
    assert.match(lamp.doc, /^[a-z0-9]{8,}$/, 'the snapshot names its document')
    await assert.rejects(bridge.command('click', { id: target.id, expect: { doc: 'another-document', role: target.role, label: target.label } }), { code: 'PAGE_CHANGED' })
    await assert.rejects(bridge.command('click', { id: target.id, expect: { doc: lamp.doc, snap: String(lamp.snap), role: target.role, label: 'Something else' } }), { code: 'ELEMENT_CHANGED' })
    await assert.rejects(bridge.command('click', { id: target.id, expect: { doc: lamp.doc, snap: '0', role: target.role, label: target.label } }), { code: 'PAGE_CHANGED' })
    const signup = await bridge.command('click', { id: lamp.elements.find(item => item.label === 'Create account').id })
    const email = signup.elements.find(item => item.role === 'field' && item.label === 'Email')
    const password = signup.elements.find(item => item.role === 'field' && item.type === 'password')
    const code = signup.elements.find(item => item.role === 'field' && item.label === 'Verification code')
    assert.equal(password.sensitive, true, 'password fields are marked for the user')
    assert.equal(code.sensitive, true, 'one-time-code fields are marked for the user')
    // Fields that are named only by their visible label or placeholder are protected too, and the live action refuses them as well.
    const byLabel = signup.elements.find(item => item.role === 'field' && item.label === 'Security verification code'), byPlaceholder = signup.elements.find(item => item.role === 'field' && /OTP/.test(item.label))
    assert.equal(byLabel.sensitive, true, 'a field called Verification code by its label only'); assert.equal(byPlaceholder.sensitive, true, 'a field called OTP by its placeholder only')
    await assert.rejects(bridge.command('type', { id: byLabel.id, text: '123456', submit: false }), { code: 'SENSITIVE_FIELD' })
    await assert.rejects(bridge.command('type', { id: byPlaceholder.id, text: '123456', submit: false }), { code: 'SENSITIVE_FIELD' })
    await assert.rejects(bridge.command('type', { id: password.id, text: 'secret', submit: false }), { code: 'SENSITIVE_FIELD' })
    await assert.rejects(bridge.command('type', { id: code.id, text: '123456', submit: false }), { code: 'SENSITIVE_FIELD' })
    // Submitting keeps the form it was approved with: the same submit buttons and destination.
    assert.match(email.form, /^Create/); assert.match(email.formAction, /\/signup/); assert.ok(email.formKey, 'the form has an identity key')
    const approved = { doc: signup.doc, snap: String(signup.snap), role: 'field', label: email.label, formKey: email.formKey }
    await assert.rejects(bridge.command('type', { id: email.id, text: 'x', submit: true, expect: { ...approved, formKey: 'another-form' } }), { code: 'ELEMENT_CHANGED' })
    const typed = await bridge.command('type', { id: email.id, text: 'user@example.com', submit: true, expect: approved })
    assert.equal(typed.title, 'Submitted user@example.com', 'typing and Enter submitted the form')
    const scrolled = await bridge.command('scroll', { direction: 'down' })
    assert.ok(scrolled.scroll.y >= 0)
    const back = await bridge.command('back')
    assert.equal(back.title, 'Najd Lamp')
    assert.deepEqual(await bridge.command('focus'), { focused: true })
    await assert.rejects(bridge.command('open', { url: 'javascript:alert(1)' }), { code: 'URL_NOT_ALLOWED' })
    // A focus handler that turns the field into a one-time-code field: nothing is written into it.
    const focusPage = await bridge.command('open', { url: base + '/focus' })
    const focusField = focusPage.elements.find(item => item.role === 'field')
    await assert.rejects(bridge.command('type', { id: focusField.id, text: 'secret-code', submit: false, expect: { doc: focusPage.doc, snap: String(focusPage.snap), role: 'field', label: focusField.label, formKey: '' } }), { code: 'ELEMENT_CHANGED' })
    assert.ok(!(await bridge.command('read')).elements.find(item => item.role === 'field').filled, 'the field stayed empty')
    // A focus handler that changes what the field says it is: nothing is written either.
    const relabel = await bridge.command('open', { url: base + '/relabel' })
    const relabelField = relabel.elements.find(item => item.role === 'field')
    await assert.rejects(bridge.command('type', { id: relabelField.id, text: 'to the wrong place', submit: false, expect: { doc: relabel.doc, snap: String(relabel.snap), role: 'field', label: relabelField.label, formKey: '' } }), { code: 'ELEMENT_CHANGED' })
    assert.ok(!(await bridge.command('read')).elements.find(item => item.role === 'field').filled, 'the relabelled field stayed empty')
    // A page so large that the snapshot budget runs out: what could not be described is marked, so NAJD asks instead of guessing.
    const big = await bridge.command('open', { url: base + '/big' })
    const bigField = big.elements.find(item => item.role === 'field')
    assert.ok(bigField && (bigField.incomplete === true || /Place order/.test(bigField.form)), 'the form is described completely or marked incomplete')
    assert.ok(big.elements.some(item => item.incomplete === true), 'elements past the budget are marked incomplete')
    // An option keeps the value it had when it was described: a page that changes the value under an unchanged label is refused.
    const plan = await bridge.command('open', { url: base + '/option' })
    const planSelect = plan.elements.find(item => item.role === 'select')
    assert.deepEqual(planSelect.optionPairs, [['Standard', 'free', false], ['Premium', 'premium', false]])
    await new Promise(resolve => setTimeout(resolve, 2200))
    await assert.rejects(bridge.command('select', { id: planSelect.id, text: 'Standard', expect: { doc: plan.doc, snap: String(plan.snap), role: 'select', label: planSelect.label, optionIndex: 0 } }), { code: 'ELEMENT_CHANGED' })
    // Payment details named only in Arabic are protected too, in the snapshot and in the live action.
    const arabic = await bridge.command('open', { url: base + '/arabic' })
    const card = arabic.elements.find(item => item.label === 'رقم البطاقة'), notesAr = arabic.elements.find(item => item.label === 'ملاحظات')
    assert.equal(card.sensitive, true); assert.ok(!notesAr.sensitive)
    await assert.rejects(bridge.command('type', { id: card.id, text: '4111111111111111', submit: false }), { code: 'SENSITIVE_FIELD' })
    // Options reordered after approval: the approved option (by complete label and value) is still the one selected, never another one.
    const reorder = await bridge.command('open', { url: base + '/reorder' })
    const reorderSelect = reorder.elements.find(item => item.role === 'select')
    await new Promise(resolve => setTimeout(resolve, 2200))
    await bridge.command('select', { id: reorderSelect.id, text: 'Standard', expect: { doc: reorder.doc, snap: String(reorder.snap), role: 'select', label: reorderSelect.label, optionIndex: 0 } }).catch(error => { assert.equal(error.code, 'ELEMENT_CHANGED') })
    // A label whose first 100 characters stay the same while the rest changes is a different element.
    const long = await bridge.command('open', { url: base + '/longlabel' })
    const longButton = long.elements.find(item => item.role === 'button')
    await new Promise(resolve => setTimeout(resolve, 2200))
    await assert.rejects(bridge.command('click', { id: longButton.id, expect: { doc: long.doc, snap: String(long.snap), role: 'button', label: longButton.label, formKey: '' } }), { code: 'ELEMENT_CHANGED' })
    // A hash-routed page says where it is only in the fragment: that alone makes the page sensitive. The complete address is not passed on.
    const routed = await bridge.command('open', { url: base + '/shop#/checkout' })
    assert.equal(routed.strictPage, true); assert.equal(routed.fullUrl, undefined); assert.ok(!routed.url.includes('#'))
    assert.equal((await bridge.command('open', { url: base + '/shop#/about' })).strictPage, undefined)
    // An option too long to describe completely is flagged, so choosing it always asks.
    const longOption = await bridge.command('open', { url: base + '/longoption' })
    assert.deepEqual(longOption.elements.find(item => item.role === 'select').optionPairs.map(pair => pair[2]), [false, true])
    // Card expiry named only by its visible label (a text field and a select) is owner-only, in the snapshot and in the live action.
    const expiry = await bridge.command('open', { url: base + '/expiry' })
    const expiryField = expiry.elements.find(item => item.label === 'Card expiry date'), expirySelect = expiry.elements.find(item => item.role === 'select'), quantity = expiry.elements.find(item => item.label === 'Quantity')
    assert.equal(expiryField.sensitive, true); assert.equal(expirySelect.sensitive, true); assert.ok(!quantity.sensitive)
    await assert.rejects(bridge.command('type', { id: expiryField.id, text: '12/30', submit: false }), { code: 'SENSITIVE_FIELD' })
    await assert.rejects(bridge.command('select', { id: expirySelect.id, text: '02' }), { code: 'SENSITIVE_FIELD' })
    // Two options share one value: choosing the second selects the second (not the first one that has the same value).
    const shared = await bridge.command('open', { url: base + '/shared' })
    const sharedSelect = shared.elements.find(item => item.role === 'select')
    const chosen = await bridge.command('select', { id: sharedSelect.id, text: 'Keep account', expect: { doc: shared.doc, snap: String(shared.snap), role: 'select', label: sharedSelect.label, optionIndex: 1 } })
    assert.equal(chosen.title, 'chose Keep account')
    // A button called "Continue" by its aria-label and "Delete account" by its text is classified by both; and a referenced name that changes is a different element.
    const names = await bridge.command('open', { url: base + '/names' })
    const both = names.elements.find(item => item.label === 'Continue'), labelled = names.elements.find(item => item.role === 'button' && item !== both)
    assert.match(both.names, /Continue/); assert.match(both.names, /Delete account/); assert.equal(both.strict, true, 'classified by every name')
    await new Promise(resolve => setTimeout(resolve, 2200))
    await assert.rejects(bridge.command('click', { id: labelled.id, expect: { doc: names.doc, snap: String(names.snap), role: 'button', label: labelled.label, formKey: '' } }), { code: 'ELEMENT_CHANGED' })
    // A submit button without a formaction of its own sends the form where the form says (not to the address of the page it is on).
    const dest = await bridge.command('open', { url: base + '/dest' })
    const destField = dest.elements.find(item => item.role === 'field'), destButton = dest.elements.find(item => item.role === 'button')
    assert.match(destField.formAction, /\/pay$/); assert.match(destButton.formAction, /\/pay$/)
    assert.equal(destButton.strictForm, true, 'the real destination is classified')
    // Every accessible name of a submit control counts: a button called Pay by its aria-label makes its form sensitive; and renaming it later is a different form.
    const ariaButton = await bridge.command('open', { url: base + '/ariabutton' })
    const ariaField = ariaButton.elements.find(item => item.role === 'field')
    assert.match(ariaField.form, /Pay/); assert.equal(ariaField.strictForm, true)
    await new Promise(resolve => setTimeout(resolve, 2200))
    await assert.rejects(bridge.command('type', { id: ariaField.id, text: 'hello', submit: true, expect: { doc: ariaButton.doc, snap: String(ariaButton.snap), role: 'field', label: ariaField.label, formKey: ariaField.formKey } }), { code: 'ELEMENT_CHANGED' })
    // A page title that turns into a payment wording after the snapshot invalidates what was approved; a harmless title change does not.
    const titleBad = await bridge.command('open', { url: base + '/titlebad' })
    const titleBadButton = titleBad.elements.find(item => item.role === 'button')
    await new Promise(resolve => setTimeout(resolve, 2200))
    await assert.rejects(bridge.command('click', { id: titleBadButton.id, expect: { doc: titleBad.doc, snap: String(titleBad.snap), role: 'button', label: titleBadButton.label, formKey: '' } }), { code: 'PAGE_CHANGED' })
    const titleOk = await bridge.command('open', { url: base + '/titleok' })
    const titleOkButton = titleOk.elements.find(item => item.role === 'button')
    await new Promise(resolve => setTimeout(resolve, 2200))
    assert.equal((await bridge.command('click', { id: titleOkButton.id, expect: { doc: titleOk.doc, snap: String(titleOk.snap), role: 'button', label: titleOkButton.label, formKey: '' } })).title, 'Clicked')
    // An ARIA link has no address: it records none and is activated like a control (never navigated to a made-up address).
    const aria = await bridge.command('open', { url: base + '/arialink' })
    const ariaLink = aria.elements.find(item => item.label === 'Details')
    assert.equal(ariaLink.role, 'link'); assert.equal(ariaLink.href, undefined); assert.equal(ariaLink.target, undefined)
    assert.equal((await bridge.command('click', { id: ariaLink.id, expect: { doc: aria.doc, snap: String(aria.snap), role: 'link', label: 'Details', formKey: '' } })).title, 'Activated')
    // A multiple select is refused before its selection changes.
    const multi = await bridge.command('open', { url: base + '/multi' })
    const multiSelect = multi.elements.find(item => item.role === 'select')
    await assert.rejects(bridge.command('select', { id: multiSelect.id, text: 'Two', expect: { doc: multi.doc, snap: String(multi.snap), role: 'select', label: multiSelect.label, optionIndex: 1 } }), { code: 'INVALID_TARGET' })
    // A collapsed details element is opened through its summary, and its contents are then reachable.
    const details = await bridge.command('open', { url: base + '/details' })
    const summary = details.elements.find(item => item.label === 'Filters')
    assert.equal(summary.role, 'button'); assert.ok(!details.elements.some(item => item.label === 'Apply filter'), 'collapsed contents are not listed')
    const opened = await bridge.command('click', { id: summary.id, expect: { doc: details.doc, snap: String(details.snap), role: 'button', label: 'Filters', formKey: '' } })
    assert.ok(opened.elements.some(item => item.label === 'Apply filter'), 'the contents are listed once it is open')
    // Typing into an empty contenteditable changes its text but not its name: it is an ordinary action, not an uncertain one.
    const editable = await bridge.command('open', { url: base + '/editable' })
    const editableField = editable.elements.find(item => item.role === 'field')
    const typedEditable = await bridge.command('type', { id: editableField.id, text: 'hello editable', submit: false, expect: { doc: editable.doc, snap: String(editable.snap), role: 'field', label: editableField.label, formKey: '' } })
    assert.match(typedEditable.text, /hello editable/)
    // An image input that submits a form is a submitter: its own destination is described (and so can be refused).
    const imageSubmit = await bridge.command('open', { url: base + '/imagesubmit' })
    const imageButton = imageSubmit.elements.find(item => item.label === 'Go')
    assert.equal(imageButton.submits, true); assert.match(imageButton.formAction, /127\.0\.0\.1:1\/z$/)
    // Submit controls are the ones associated with the form, wherever they are in the page (a button outside it, an image submitter).
    const external = await bridge.command('open', { url: base + '/external' })
    const comments = external.elements.find(item => item.role === 'field')
    assert.match(comments.form, /Place order/); assert.match(comments.form, /Pay now/)
    // Page code that runs while the text is typed cannot turn the approved form into another one: nothing is submitted.
    const mutate = await bridge.command('open', { url: base + '/mutate' })
    const notes = mutate.elements.find(item => item.role === 'field')
    await assert.rejects(bridge.command('type', { id: notes.id, text: 'hello', submit: true, expect: { doc: mutate.doc, snap: String(mutate.snap), role: 'field', label: notes.label, formKey: notes.formKey } }), { code: 'PARTIAL_ACTION' })
    assert.notEqual((await bridge.command('read')).title, 'Submitted', 'the form was not submitted')

    // The address policy is enforced on the connection the browser made: with this computer not allowed, a page loaded from it is never read, and the tab is emptied.
    await panel.eval('chrome.storage.local.set({ najdAllowLocal: false }).then(() => true)')
    await assert.rejects(bridge.command('open', { url: base + '/shop' }), { code: 'PAGE_ADDRESS_NOT_ALLOWED' })
    await panel.eval('chrome.storage.local.set({ najdAllowLocal: true }).then(() => true)')
    assert.match((await bridge.command('open', { url: base + '/shop' })).title, /Lamp shop/, 'allowed again: the page is read')

    // Asking NAJD from the side panel: the question reaches the app, progress and the answer come back.
    const received = [], cancelled = []
    bridge.setHandlers({ onAsk: ask => { received.push(ask); return true }, onAskCancel: info => { cancelled.push(info) } })
    const ask = async text => {
      await panel.eval("(() => { const field = document.getElementById('ask-text'); field.value = " + JSON.stringify(text) + "; document.getElementById('include-page').checked = false; document.getElementById('ask-form').requestSubmit(); return true })()")
      const count = received.length
      for (let i = 0; i < 40 && received.length === count; i++) await sleep(250)
      return received.at(-1)
    }
    const first = await ask('Summarize the open tab')
    assert.equal(first.text, 'Summarize the open tab'); assert.equal(first.page, null, 'the page is shared only when the box is ticked')
    bridge.updateAsk(first.id, { state: 'running', taskId: '11111111-1111-4111-8111-111111111111', progress: 'najd-files-read: notes.txt' })
    for (let i = 0; i < 20 && !(await panel.eval("document.getElementById('answer-progress').textContent")); i++) await sleep(250)
    assert.match(await panel.eval("document.getElementById('answer-progress').textContent"), /Working with files/)
    bridge.updateAsk(first.id, { state: 'done', output: 'The tab is a lamp shop page.', needsApproval: false })
    for (let i = 0; i < 20 && !(await panel.eval("document.getElementById('answer-output').textContent")); i++) await sleep(250)
    assert.equal(await panel.eval("document.getElementById('answer-output').textContent"), 'The tab is a lamp shop page.')
    assert.equal(await panel.eval("document.getElementById('send').hidden"), false, 'a new question can be sent after the answer')

    // Stop in the panel reaches the app with the task id, and the question stays cancelled whatever the app reports afterwards.
    await panel.eval("document.getElementById('new-ask') && document.getElementById('new-ask').click(); true")
    const second = await ask('Check the second tab')
    bridge.updateAsk(second.id, { state: 'running', taskId: '22222222-2222-4222-8222-222222222222', progress: 'najd-files-read: notes.txt' })
    for (let i = 0; i < 20 && (await panel.eval("document.getElementById('stop').hidden")); i++) await sleep(250)
    assert.equal(await panel.eval("document.getElementById('stop').hidden"), false)
    await panel.eval("document.getElementById('stop').click(); true")
    for (let i = 0; i < 20 && !cancelled.length; i++) await sleep(250)
    assert.equal(cancelled[0].taskId, '22222222-2222-4222-8222-222222222222')
    assert.equal(bridge.getAsk(second.id).progress, 'STOPPING', 'stopping until the app reports how the task ended')
    bridge.updateAsk(second.id, { state: 'cancelled' })
    bridge.updateAsk(second.id, { state: 'done', output: 'late answer' })
    assert.equal(bridge.getAsk(second.id).state, 'cancelled')


    // Unlinking from the panel removes the link on both sides.
    await panel.eval("document.getElementById('unlink').click(); true")
    for (let i = 0; i < 20 && bridge.status().paired; i++) await sleep(250)
    assert.equal(bridge.status().paired, false)
    panel.close()
    console.log('PASS: real Edge (temporary profile) paired through its panel (code on both sides); open, read, follow links, type+submit, scroll, back and focus work; password and one-time-code typing is refused; asking NAJD from the panel, progress, answer and Stop reach the app; unlinking works.')
  } finally {
    await bridge.stop(); server.close()
    await browser.stop()
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
