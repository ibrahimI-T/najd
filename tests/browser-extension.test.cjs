const { test } = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const { validateExtension, storeManifest } = require('../scripts/extension-checks.cjs')

const folder = join(__dirname, '..', 'browser-extension')
const source = file => readFileSync(join(folder, file), 'utf8')

test('the extension passes every store-readiness check (manifest, permissions, icons, locales, no remote or dynamic code)', () => {
  const { errors, warnings } = validateExtension(folder)
  assert.deepEqual(errors, [])
  assert.deepEqual(warnings, [])
})

test('the store build declares website access as optional and only loopback up front', () => {
  const { manifest } = validateExtension(folder)
  const shipped = storeManifest(manifest)
  assert.deepEqual(shipped.host_permissions, ['http://127.0.0.1/*'])
  assert.deepEqual(shipped.optional_host_permissions, ['https://*/*', 'http://*/*'])
  assert.deepEqual(manifest.permissions, ['storage', 'scripting', 'tabGroups', 'alarms', 'sidePanel', 'contextMenus', 'webRequest'])
  assert.deepEqual(manifest.background, { service_worker: 'service-worker.js', type: 'module' })
  const stage = require('node:fs').mkdtempSync(join(require('node:os').tmpdir(), 'najd-ext-store-'))
  require('node:fs').cpSync(folder, stage, { recursive: true })
  require('node:fs').writeFileSync(join(stage, 'manifest.json'), JSON.stringify(shipped))
  assert.deepEqual(validateExtension(stage, { store: true }).errors, [])
})

test('both languages cover every message and the names fit the store limits', () => {
  const en = JSON.parse(source('_locales/en/messages.json')), ar = JSON.parse(source('_locales/ar/messages.json'))
  assert.deepEqual(Object.keys(ar).sort(), Object.keys(en).sort())
  assert.ok(en.extName.message.length <= 75 && en.extDescription.message.length <= 132)
  assert.ok(ar.extName.message.length <= 75 && ar.extDescription.message.length <= 132)
  assert.match(ar.statusConnected.message, /[\u0600-\u06FF]/)
})

test('link code accepts only a port and a 256-bit secret; only ordinary web pages can be opened', async () => {
  const { parsePairCode, allowedUrl, BRIDGE_PORTS } = await import('../browser-extension/src/protocol.js')
  assert.deepEqual(parsePairCode(`38127:${'a'.repeat(64)}`), { port: 38127, code: 'a'.repeat(64) })
  assert.equal(parsePairCode(`38127:${'a'.repeat(32)}`), null)
  assert.equal(parsePairCode(`0:${'a'.repeat(64)}`), null)
  assert.equal(parsePairCode(`https://evil.test:${'a'.repeat(64)}`), null)
  assert.deepEqual(BRIDGE_PORTS, require('../electron/browser-bridge.cjs').BRIDGE_PORTS)
  for (const bad of ['javascript:alert(1)', 'file:///c:/x', 'chrome://settings', 'https://user:pw@example.com/', 'data:text/html,x']) assert.equal(allowedUrl(bad), false, bad)
  assert.equal(allowedUrl('https://example.com/path?q=1'), true)
})

test('the page scripts never type into password, payment or one-time-code fields, and fill a password only through the sign-in command', () => {
  const scripts = source('src/page-scripts.js')
  assert.match(scripts, /if \(sensitive\) return \{ ok: false, error: 'SENSITIVE_FIELD' \}/)
  assert.match(scripts, /password\|passwd\|كلمة المرور\|كلمة السر\|cc-\[a-z-\]\+\|card\.\?number/)
  assert.match(scripts, /رقم البطاقة\|بطاقة الائتمان/)
  assert.match(scripts, /one-time-code\|otp\|totp\|2fa\|mfa\|verification\.\?code/)
  // The sign-in command checks the site, https, a single non-new password field and an affirmative sign-in form.
  for (const guard of ['HOST_MISMATCH', 'INSECURE_PAGE', 'NOT_A_LOGIN_FORM', 'AMBIGUOUS_FORM', 'new-password']) assert.ok(scripts.includes(guard), guard)
  // Only najdLogin may set a password value.
  assert.equal((scripts.match(/setValue\(pass, password\)/g) || []).length, 1)
})

test('the worker accepts messages only from the extension\'s own pages and never relays page content to anything but loopback', () => {
  const worker = source('service-worker.js')
  assert.match(worker, /sender\.id !== chrome\.runtime\.id/)
  assert.match(worker, /startsWith\(chrome\.runtime\.getURL\(''\)\)/)
  const link = source('src/link.js')
  for (const match of link.matchAll(/fetch\(`([^`]+)`/g)) assert.match(match[1], /^http:\/\/127\.0\.0\.1:\$\{/, match[1])
})

test('R064-301: selected website text never becomes the question: it travels as page context and a fixed question is used when none is typed', () => {
  const panel = source('sidepanel.js')
  assert.doesNotMatch(panel, /ask-text'\)\.value = najdPrompt/)
  assert.match(panel, /t\('defaultSelectionQuestion'\)/)
  assert.match(panel, /selection,?\s*\}|selection \}/)
})

test('pairing shows the same six-digit code on both sides and never stores a secret before the user allows it', () => {
  const link = source('src/link.js')
  // The secret is stored only after the app reports "approved".
  const approved = link.indexOf("state?.state === 'approved'")
  assert.ok(approved > 0 && link.indexOf('setLink({ port: found.port, secret: state.secret })') > approved)
  assert.match(source('sidepanel.js'), /\$\('pair-code'\)\.textContent/)
})

test('R064-REV-001/003: identities are extension-owned state, not page attributes, and a question lost to a restart is shown as unconfirmed', () => {
  const scripts = source('src/page-scripts.js')
  assert.doesNotMatch(scripts, /data-najd-id|najdId|najdDoc|najdNext/)
  assert.match(scripts, /globalThis\.__najd/)
  assert.match(source('src/link.js'), /response\.status === 404\) return \{ state: 'failed', progress: 'UNKNOWN_EFFECT'/)
})

test('R064-REVIEW-02/03: a stopped question never starts (checked in the main process), and page details are never dropped silently', () => {
  const main = readFileSync(join(__dirname, '..', 'electron', 'main.cjs'), 'utf8')
  assert.match(main, /known\.cancelled \|\| \['done', 'failed', 'cancelled'\]\.includes\(known\.state\)\) throw mainError\('ASK_CANCELLED'\)/)
  assert.match(main, /askOfTask\.set\(started\.id, askId\)/)
  assert.match(source('service-worker.js'), /info\.pageUrl \|\| tab\.url/)
  assert.match(source('sidepanel.js'), /pageNoteShown/)
  assert.ok(JSON.parse(source('_locales/en/messages.json')).pageUnavailable)
})

test('R064-401/402: fields are classified by their labels and placeholders in the snapshot and in the live action, select included, and links keep their destination', () => {
  const scripts = source('src/page-scripts.js')
  assert.ok((scripts.match(/visibleName\(element\)/g) || []).length >= 2)
  assert.match(scripts, /kind === 'select'\) \{\s*if \(sensitive\) return \{ ok: false, error: 'SENSITIVE_FIELD' \}/)
  assert.match(scripts, /item\.target = cut\(full, 2000\)/)
  assert.match(scripts, /location\.assign\(destination\.toString\(\)\)/)
})

test('R064-IR-001/003: approvals are bound to the observed snapshot and the untruncated address, and links keep their exact destination in extension-owned state', () => {
  const scripts = source('src/page-scripts.js')
  assert.match(scripts, /location\.href !== registry\.nav/)
  assert.match(scripts, /location\.href !== registry\?\.nav/)
  assert.match(scripts, /registry\.targets\.set\(id, full\)/)
  assert.match(scripts, /registry\.targets\.get\(id\)/)
  assert.doesNotMatch(scripts, /here\.hash = ''/)
})

test('R064-002/003: focus handlers are followed by a new check before anything is written, the page is sent once, and an undeliverable result is reported', () => {
  const scripts = source('src/page-scripts.js')
  assert.match(scripts, /element\.focus\(\)\s*\n\s*if \(!approvedNow\(\)\) return \{ ok: false, error: 'ELEMENT_CHANGED' \}/)
  assert.match(scripts, /element\.focus\(\)\s*\n\s*if \(!stillSignIn\(\)\) return false/)
  assert.match(scripts, /let budget = 300000/)
  assert.equal((source('src/commands.js').match(/resultIsPage: true/g) || []).length, 2)
  assert.match(source('service-worker.js'), /RESULT_NOT_DELIVERED/)
})

test('R064-IR-302/REVIEW-004: role and label are checked again after focus, and a question stays recoverable in the main process until its task exists', () => {
  const scripts = source('src/page-scripts.js')
  assert.match(scripts, /element\.type !== 'password' && targetMatches\(\)/)
  const main = readFileSync(join(__dirname, '..', 'electron', 'main.cjs'), 'utf8')
  assert.match(main, /NOT_STARTED/); assert.match(main, /dropPendingAsk\(askId\)/); assert.match(main, /ASK_STARTED/)
  assert.doesNotMatch(main, /najd:ask:ack/)
  assert.doesNotMatch(readFileSync(join(__dirname, '..', 'electron', 'preload.cjs'), 'utf8'), /najd:ask:ack/)
  assert.match(readFileSync(join(__dirname, '..', 'src', 'App.tsx'), 'utf8'), /seenAsks\.current\.has\(ask\.id\)/)
})

test('R064-REV-601/602: omissions are tracked per element, and both sign-in fields are compared again after page code ran', () => {
  const scripts = source('src/page-scripts.js')
  assert.match(scripts, /if \(omitted !== omittedBefore\) item\.incomplete = true/)
  assert.match(scripts, /catch \{ info\.formIncomplete = true \}/)
  assert.match(scripts, /visibleName\(userNow\) !== baseline\.user/)
  assert.match(scripts, /visibleName\(pass\) !== baseline\.pass/)
  assert.match(scripts, /pass\.autocomplete === 'current-password' \|\| good\.test/)
})

test('R064-IR-2801/2802/2803: the classified option is selected by position and complete identity, labels are compared in full, and payment details are recognised in Arabic', () => {
  const scripts = source('src/page-scripts.js')
  assert.match(scripts, /expect\.optionIndex/); assert.match(scripts, /live\.length !== 1/)
  assert.match(scripts, /registry\.labels\.set\(id, label\.slice\(0, 4000\)\)/)
  assert.match(scripts, /now\.full\.slice\(0, 4000\) === /)
  // The Arabic payment words are part of every sensitive-field expression (snapshot, live action, after-focus check, sign-in user field).
  assert.equal((scripts.match(/رقم البطاقة/g) || []).length, 4)
  const sensitive = new RegExp(scripts.match(/element\.type === 'password' \|\| \/(.+?)\/\.test\(identity\)/)[1])
  for (const text of ['رقم البطاقة', 'بطاقة الائتمان', 'رمز الأمان', 'تاريخ الانتهاء', 'الرقم السري', 'آيبان', 'cc-name', 'cc-exp-month', 'credit card', 'PIN code', 'account number'])
    assert.ok(sensitive.test(text.toLowerCase()), text)
  assert.ok(!sensitive.test('search the shop'))
})

test('R064-IR-3101/3102: options too long to carry are flagged, and the complete address is delivered for classification', () => {
  const scripts = source('src/page-scripts.js')
  assert.match(scripts, /label\.length > 120 \+ OVERLAP \|\| value\.length > 120 \+ OVERLAP/)
  assert.match(scripts, /fullUrl = cut\(location\.href, 2000\)/)
  assert.match(scripts, /urlIncomplete: true/)
})

test('R064-REVIEW-3202: every call carries the installation id, created once per browser profile', () => {
  const link = source('src/link.js')
  assert.match(link, /najdInstance/); assert.match(link, /'X-NAJD-Instance': INSTANCE/)
  assert.equal((link.match(/await ready/g) || []).length, 3)
})

test('R064-IR-3302/3303/3304: card expiry wording is sensitive (selects too), started questions can be recovered after a reload, and a failed removal refreshes the lists', () => {
  const scripts = source('src/page-scripts.js')
  const sensitive = new RegExp(scripts.match(/element\.type === 'password' \|\| \/(.+?)\/\.test\(identity\)/)[1])
  for (const text of ['card expiry date', 'expiration month', 'exp date', 'valid thru', 'mm / yy', 'expires']) assert.ok(sensitive.test(text), text)
  assert.match(scripts, /if \(role === 'select'\) \{\s*if \(sensitive\(element\)\) item\.sensitive = true/)
  assert.match(readFileSync(join(__dirname, '..', 'electron', 'main.cjs'), 'utf8'), /najd:ask:active/)
  const app = readFileSync(join(__dirname, '..', 'src', 'App.tsx'), 'utf8')
  assert.match(app, /async function recoverAsk/); assert.match(app, /activeAsks\(\)/)
  assert.match(readFileSync(join(__dirname, '..', 'src', 'AccountsSettings.tsx'), 'utf8'), /setError\(codeOf\(failure\)\); void reload\(\)/)
})

test('R064-IR-3401/3402: the matched option itself is selected, and a finished answer stays recoverable until the conversation has it', () => {
  const scripts = source('src/page-scripts.js')
  assert.match(scripts, /option\.selected = true\s*\n\s*if \(element\.selectedOptions\[0\] !== option\) return \{ ok: false, error: 'PARTIAL_ACTION' \}/)
  assert.doesNotMatch(scripts, /element\.value = option\.value/)
  const main = readFileSync(join(__dirname, '..', 'electron', 'main.cjs'), 'utf8')
  assert.match(main, /unsavedAsks\.set\(taskId, askId\)/); assert.match(main, /najd:ask:saved/)
  assert.ok((readFileSync(join(__dirname, '..', 'src', 'App.tsx'), 'utf8').match(/askSaved\(/g) || []).length >= 3)
})

test('R064-REVIEW-3601..3604: a submitter without its own formaction uses the form destination, every accessible name of a submit control counts, and recovery restores Stop and never saves an answer twice', () => {
  const scripts = source('src/page-scripts.js')
  assert.match(scripts, /control\.hasAttribute\('formaction'\) \? control\.formAction : form\.action/)
  assert.doesNotMatch(scripts, /element\.formAction \|\| element\.form\.action/)
  assert.equal((scripts.match(/control\.getAttribute\('aria-label'\)/g) || []).length, 3)
  const app = readFileSync(join(__dirname, '..', 'src', 'App.tsx'), 'utf8')
  assert.match(app, /setActiveTaskId\(task\.id\)\s*\n\s*\}\s*\n\s*while \(task\.state === 'QUEUED'/)
  assert.match(app, /const same = \(value: string\) => value\.replace/)
  assert.match(app, /finishWork\(workKey\); setActiveTaskId\(null\); setBusy\(false\)/)
})

test('R064-REVIEW-3701/3702: the password target is checked for verification identities before and after page code, and recovery is the only owner of the busy state until it is done', () => {
  const scripts = source('src/page-scripts.js')
  assert.match(scripts, /OTP\.test\(identityOf\(pass\)\) \|\| \(userNow && OTP\.test\(identityOf\(userNow\)\)\)/)
  assert.match(scripts, /new-password\/i\.test\(pass\.autocomplete \|\| ''\) \|\| OTP\.test\(identityOf\(pass\)\)\) return false/)
  const app = readFileSync(join(__dirname, '..', 'src', 'App.tsx'), 'utf8')
  assert.match(app, /const \[recoveryReady, setRecoveryReady\]/)
  assert.match(app, /for \(const item of list\) await recoverAsk\(item\.taskId\)/)
  assert.match(app, /!historyReady \|\| !recoveryReady \|\| providers\.connectionBusy/)
})

test('R064-REVIEW-3801: the extension judges a changed page title with the same sensitive-action wording as NAJD', () => {
  const policy = readFileSync(join(__dirname, '..', 'electron', 'browser-policy.cjs'), 'utf8').match(/const SENSITIVE_ACTION = (\/.*\/i)\r?\n/)[1]
  const scripts = source('src/page-scripts.js')
  const copies = [...scripts.matchAll(/const ACTION_WORDS = (\/.*\/i)\r?\n/g)].map(match => match[1])
  assert.equal(copies.length, 2, 'one copy for the action and one for the sign-in')
  for (const copy of copies) assert.equal(copy, policy, 'the two lists of sensitive wording must stay identical')
  assert.equal((scripts.match(/titleOk\(\)/g) || []).length >= 4, true)
})

test('R064-IR-3901/3902: only a real href is a destination, and a multiple select is refused before anything changes', () => {
  const scripts = source('src/page-scripts.js')
  assert.match(scripts, /role === 'link' && typeof element\.href === 'string' && element\.href/)
  assert.match(scripts, /registry\.targets\.get\(id\) \?\? ''/)
  assert.match(scripts, /element\.localName !== 'select' \|\| element\.multiple/)
  assert.match(scripts, /selectedOptions\[0\] !== option\) return \{ ok: false, error: 'PARTIAL_ACTION' \}/)
})

test('R064-REVIEW-4002: a disclosure summary is part of the snapshot (a button), so a collapsed details element can be opened', () => {
  assert.match(source('src/page-scripts.js'), /\[contenteditable=true\], summary'\)/)
})

test('R064-IR-4203: a question from the browser waits while the owner has an unsent draft or attachments', () => {
  const app = readFileSync(join(__dirname, '..', 'src', 'App.tsx'), 'utf8')
  assert.match(app, /providers\.connectionBusy \|\| draft\.trim\(\) \|\| attachments\.length\) return/)
  assert.match(app, /providers\.connectionBusy, draft, attachments\.length\]/)
})

test('R064-REVIEW-4301/4302: a terminal question never starts, expiry removes it from the app queue, and the panel says when an answer was cut', () => {
  const main = readFileSync(join(__dirname, '..', 'electron', 'main.cjs'), 'utf8')
  assert.match(main, /known\.cancelled \|\| \['done', 'failed', 'cancelled'\]\.includes\(known\.state\)\) throw mainError\('ASK_CANCELLED'\)/)
  assert.match(main, /'NOT_STARTED' \}\)\s*\n\s*\/\/[^\n]*\n\s*for \(const window of BrowserWindow\.getAllWindows\(\)\)[^\n]*'najd:ask:cancelled'/)
  assert.match(source('sidepanel.js'), /ask\.outputTruncated !== true/)
  assert.ok(JSON.parse(source('_locales/ar/messages.json')).answerTruncated)
})

test('R064-REV-01/02: the extension checks every destination the password could go to, and image buttons are submitters', () => {
  const scripts = source('src/page-scripts.js')
  assert.match(scripts, /const destinationOk = \(\) => \{/)
  assert.match(scripts, /if \(!destinationOk\(\)\) return \{ ok: false, error: 'NOT_A_LOGIN_FORM' \}/)
  assert.match(scripts, /\|\| \(tag === 'input' && type === 'image' && element\.form\)\) item\.submits = true/)
})

test('R064-REVIEW-4501: the extension can empty its tab on request, without needing website access', () => {
  const commands = source('src/commands.js')
  assert.match(commands, /kind !== 'focus' && kind !== 'park' && !\(await hasSiteAccess\(\)\)/)
  assert.match(commands, /url: 'about:blank'/)
})

test('R064-REVIEW-4601: the app resolves host names (DNS) before a browser address is accepted', () => {
  const main = readFileSync(join(__dirname, '..', 'electron', 'main.cjs'), 'utf8')
  assert.match(main, /resolveUrl: \(\(\) => \{/); assert.match(main, /node:dns/); assert.match(main, /privateAddress\(row\.address\)/)
})

test('R064-IR-4701: the extension judges the address the browser really connected to (public ones pass, this computer and private networks do not)', async () => {
  const { privateIp } = await import('../browser-extension/src/protocol.js')
  for (const address of ['8.8.8.8', '1.1.1.1', '2606:4700::1111', '93.184.216.34']) assert.equal(privateIp(address), false, address)
  for (const address of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.0.10', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1', '::', 'fe80::1', 'fd00::1', '::ffff:192.168.1.1', '', 'not-an-address']) assert.equal(privateIp(address), true, address)
  assert.equal(privateIp('172.32.0.1'), false); assert.equal(privateIp('172.15.0.1'), false)
  const commands = source('src/commands.js')
  assert.match(commands, /chrome\.webRequest\.onCompleted\.addListener/); assert.match(commands, /types: \['main_frame'\]/)
  assert.equal((commands.match(/refuseIfPrivate\(tab\)/g) || []).length, 4, 'its definition, and three uses: after opening, before acting and before reading the result')
})

test('R064-IR-4702: the panel warns before sending a selection that is longer than NAJD takes', () => {
  assert.match(source('sidepanel.js'), /\(page\?\.selection\?\.length \|\| 0\) > 2000 && !selectionNoteShown/)
  assert.ok(JSON.parse(source('_locales/ar/messages.json')).selectionTooLong)
})

test('R064-REVIEW-4802: the extension and the app classify addresses by range, identically, whatever the spelling', async () => {
  const { privateIp } = await import('../browser-extension/src/protocol.js')
  const { privateAddress } = require('../electron/web-preview.cjs')
  const addresses = ['8.8.8.8', '1.1.1.1', '93.184.216.34', '10.0.0.1', '172.16.0.1', '172.32.0.1', '192.168.1.1', '127.0.0.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '203.0.113.5', '198.51.100.7',
    '::1', '0:0:0:0:0:0:0:1', '0000:0000:0000:0000:0000:0000:0000:0001', '::', 'fec0::1', 'fe80::1', 'fe80::1%eth0', 'fd12::1', 'fc00::1', 'ff02::1',
    '::ffff:7f00:1', '::ffff:127.0.0.1', '::ffff:a00:1', '::ffff:808:808', '::ffff:8.8.8.8', '0:0:0:0:0:ffff:c0a8:101', '64:ff9b::7f00:1', '64:ff9b::808:808',
    '2606:4700::1111', '2001:4860:4860::8888', '2001:db8::1', '2001::1', '2002:c0a8:101::1', '2002:808:808::1', '3fff::1', 'garbage', '', '1.2.3', '999.1.1.1', '1:2:3:4:5:6:7:8:9']
  for (const address of addresses) assert.equal(privateIp(address), address === '' ? true : privateAddress(address), address)
  for (const address of ['fec0::1', '::ffff:7f00:1', '0:0:0:0:0:0:0:1']) assert.equal(privateIp(address), true, address)
})
test('R064-REVIEW-4801: a navigation withdraws the earlier authorization and only the answering connection grants a new one', () => {
  const commands = source('src/commands.js')
  assert.match(commands, /chrome\.webRequest\.onBeforeRequest\.addListener\(details => \{\s*\n\s*if \(details\.tabId < 0\) return\s*\n\s*connections\.set\(details\.tabId, null\)/)
  assert.match(commands, /onResponseStarted\.addListener\(recordConnection, mainFrame\)/)
  assert.match(commands, /let record = connections\.get\(tab\.id\)/)
  assert.doesNotMatch(commands, /webRequest\.onCompleted\.addListener\(details => \{\s*\n\s*void/)
})
