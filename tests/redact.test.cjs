const test = require('node:test')
const assert = require('node:assert/strict')
const { redactText } = require('../electron/redact.cjs')
const { validActivity } = require('../electron/task-activity.cjs')

test('redaction removes keys, tokens, passwords and URL credentials', () => {
  const samples = [
    'curl -H "Authorization: Bearer abcdefghijklmnop1234" https://x.test',
    'set OPENAI_API_KEY=sk-abcdefghijklmnopqrstuvwxyz123456',
    '$env:GITHUB_TOKEN = "ghp_abcdefghijklmnopqrstuvwxyz1234"',
    'login --password hunter2secret',
    'git clone https://user:p4ssw0rd@github.com/a/b.git',
    'GET /api?access_token=abc123def456&x=1',
    'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U',
    'AKIAABCDEFGHIJKLMNOP',
    'password: "my secret value"'
  ]
  for (const sample of samples) {
    const out = redactText(sample, 300)
    assert.ok(out.includes('[redacted]'), sample + ' -> ' + out)
    for (const secret of ['abcdefghijklmnop1234', 'sk-abcdefghijklmnop', 'ghp_abcdef', 'hunter2secret', 'p4ssw0rd', 'abc123def456', 'dozjgNryP4J3', 'AKIAABCDEFGHIJKLMNOP', 'my secret value'])
      assert.ok(!out.includes(secret), secret + ' leaked in ' + out)
  }
})

test('redaction covers quoted JSON and single-quoted keys, nested and escaped values, and short secrets', () => {
  const secret = ['hunter2secret', 'short-secret-value', 'abc def', 'zzz']
  const out = [redactText('{"password":"hunter2secret"}', 200), redactText('{"api_key":"short-secret-value","x":1}', 200),
    redactText("{'token': 'abc def'}", 200), redactText('{"a":{"Authorization":"Bearer zzz"}}', 200)].join(' | ')
  for (const value of secret) assert.ok(!out.includes(value), value + ' leaked: ' + out)
  assert.equal(redactText('{"name":"visible"}'), '{"name":"visible"}')
})

test('redaction keeps ordinary paths and commands, strips control characters and bounds length', () => {
  assert.equal(redactText('C:\\Users\\me\\Documents\\NAJD\\report.docx'), 'C:\\Users\\me\\Documents\\NAJD\\report.docx')
  assert.equal(redactText('git status --short'), 'git status --short')
  assert.equal(redactText('line1\nline2\u0000x'), 'line1 line2 x')
  assert.ok(redactText('a'.repeat(500), 100).length <= 100)
})

test('activity records accept the reasoning summary event and 240 character details', () => {
  const now = new Date().toISOString()
  assert.ok(validActivity({ version: 1, startedAt: now, finishedAt: null, events: [{ type: 'task.started', time: now }, { type: 'reasoning.summary', time: now, tool: 'najd-plan', detail: 'x'.repeat(240) }] }))
  assert.ok(!validActivity({ version: 1, startedAt: now, finishedAt: null, events: [{ type: 'task.started', time: now, detail: 'x'.repeat(241) }] }))
  assert.ok(!validActivity({ version: 1, startedAt: now, finishedAt: null, events: [{ type: 'raw.thinking', time: now }] }))
})

test('core pushes ids-only change notifications and stores redacted details', async () => {
  const { createNajdCore } = require('../electron/najd-core.cjs')
  const changes = []
  const core = createNajdCore({ onChange: change => changes.push(change), model: async request => {
    request.onToolEvent('reasoning.summary', 'najd-plan', 'Plan with token=abcdef0123456789abcdef')
    request.onToolEvent('tool.started', 'najd-terminal-run', 'echo password=hunter2')
    request.onToolEvent('tool.completed', 'najd-terminal-run', 'completed (exit 0)')
    return { kind: 'message', text: 'done' }
  } })
  const task = core.startTask({ text: 'do it', intentId: 'push-proof' })
  await new Promise(resolve => setTimeout(resolve, 30))
  const snapshot = core.getTask(task.id)
  const text = JSON.stringify(snapshot.activity)
  assert.ok(!text.includes('hunter2') && !text.includes('abcdef0123456789abcdef'))
  assert.ok(snapshot.activity.events.some(event => event.type === 'reasoning.summary'))
  assert.ok(changes.length >= 4)
  for (const change of changes) assert.deepEqual(Object.keys(change).sort(), ['conversationId', 'sequence', 'taskId'])
  assert.ok(changes.every((change, index) => index === 0 || change.sequence >= changes[index - 1].sequence))
  assert.equal(snapshot.lastSequence, changes.at(-1).sequence)
})

test('flags whose names contain a secret word are redacted, ordinary flags are kept', () => {
  assert.ok(!redactText('oauth --client-secret hunter2secret', 100).includes('hunter2secret'))
  assert.ok(!redactText('cmd --access-token abc123secret', 100).includes('abc123secret'))
  assert.ok(!redactText('x --private-key=zzzz1', 100).includes('zzzz1'))
  assert.equal(redactText('git commit --author bob --all', 100), 'git commit --author bob --all')
})

test('activity validation requires unique increasing seq values and the 160/240 detail limits', () => {
  const now = new Date().toISOString()
  const ev = (seq, extra = {}) => ({ type: 'task.started', time: now, ...(seq === undefined ? {} : { seq }), ...extra })
  const wrap = events => ({ version: 1, startedAt: now, finishedAt: null, events })
  assert.ok(validActivity(wrap([ev(), ev()])), 'legacy records without seq')
  assert.ok(validActivity(wrap([ev(3), ev(4), ev(9)])))
  assert.ok(!validActivity(wrap([ev(3), ev(3)])), 'duplicate')
  assert.ok(!validActivity(wrap([ev(4), ev(3)])), 'out of order')
  assert.ok(!validActivity(wrap([ev(1), ev()])), 'mixed')
  assert.ok(!validActivity(wrap([ev(0)])), 'non-positive')
  assert.ok(!validActivity(wrap([ev(1, { detail: 'x'.repeat(161) })])))
  assert.ok(validActivity(wrap([ev(1, { type: 'reasoning.summary', detail: 'x'.repeat(240) })])))
})

test('positional and PowerShell environment assignments of secret-looking names are redacted', () => {
  assert.ok(!redactText('setx DATABASE_PASSWORD hunter2secret', 100).includes('hunter2secret'))
  assert.ok(!redactText('set API_KEY=abc9', 100).includes('abc9'))
  assert.ok(!redactText("[Environment]::SetEnvironmentVariable('MY_TOKEN','tok12','User')", 100).includes('tok12'))
  assert.ok(redactText('setx PATH C:/tools/bin', 100).includes('C:/tools/bin'))
})

test('credential switches of common commands are masked and ordinary arguments stay', () => {
  for (const [text, secret] of [['curl --user alice:hunter2 https://example.test', 'hunter2'], ['curl -u bob:pw99 https://x.test', 'pw99'], ['mysql -uroot -phunter2 db', 'hunter2'],
    ['sshpass -p topsecret ssh host', 'topsecret'], ['cmdkey /add:host /user:u /pass:abc123', 'abc123']]) assert.ok(!redactText(text, 120).includes(secret), text)
  assert.equal(redactText('curl -s https://example.test/page', 100), 'curl -s https://example.test/page')
  assert.equal(redactText('mysql --version', 100), 'mysql --version')
})

test('legacy saved activity is redacted when sessions load', async () => {
  const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path')
  const { createSessionStore } = require('../electron/session-store.cjs')
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'najd-legacy-'))
  try {
    const file = path.join(dir, 'sessions.json')
    const now = new Date().toISOString()
    await fs.writeFile(file, JSON.stringify({ version: 1, sessions: [{ id: '11111111-1111-4111-8111-111111111111', title: 't', createdAt: now, updatedAt: now, messages: [
      { role: 'user', text: 'hi', createdAt: now },
      { role: 'assistant', text: 'ok', createdAt: now, activity: { version: 1, startedAt: now, finishedAt: now, events: [{ type: 'task.started', time: now }, { type: 'tool.started', time: now, tool: 'najd-terminal-run', detail: 'setx DB_PASSWORD hunter2secret' }] } }] }] }))
    const store = createSessionStore(file)
    const session = await store.getSession('11111111-1111-4111-8111-111111111111')
    assert.ok(!JSON.stringify(session).includes('hunter2secret'))
  } finally { await fs.rm(dir, { recursive: true, force: true }) }
})

test('docker login and net use passwords are masked while docker run -p ports stay', () => {
  assert.ok(!redactText('docker login -u alice -p hunter2 registry.example', 120).includes('hunter2'))
  assert.ok(!redactText('podman login --password=hunter2 r.example', 120).includes('hunter2'))
  assert.ok(!redactText('net use Z: hostshare hunter2 /user:bob', 120).includes('hunter2'))
  assert.equal(redactText('docker run -p 80:80 nginx', 100), 'docker run -p 80:80 nginx')
  assert.equal(redactText('net use Z: /delete', 100), 'net use Z: /delete')
})

test('authorization headers of any scheme and quoted curl credentials with spaces are masked', () => {
  const cases = [['curl -H "Authorization: Token ab12cd34ef56gh78ij90kl12mn34op56" x', 'ab12cd34ef56gh78'], ['Authorization: ApiKey abc def ghi', 'abc def'],
    ["curl -u 'bob:pa ss word' https://x.test", 'pa ss word'], ['curl --user "bob:two words" https://x.test', 'two words']]
  for (const [text, secret] of cases) assert.ok(!redactText(text, 200).includes(secret), text)
  assert.equal(redactText('curl -s https://x.test', 100), 'curl -s https://x.test')
})

test('long unbroken alphabetic values are masked while long paths with an extension stay', () => {
  assert.ok(!redactText('mycli login AbcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOP', 120).includes('ABCDEFGHIJKLMNOP'))
  const longPath = 'C:/Users/me/Documents/NAJD/a-very-long-folder-name-for-reports/final-report-version-two.docx'
  assert.equal(redactText(longPath, 200), longPath)
})

test('Cookie and Set-Cookie headers are masked through every semicolon-separated value', () => {
  for (const text of ['curl -H "Cookie: first=abc; opaque_name=second-secret" x', 'Cookie: first=abc; opaque_name=second-secret', 'Set-Cookie: sid=1; other=zzz2; Path=/'])
    assert.ok(!/second-secret|zzz2|first=abc|sid=1/.test(redactText(text, 200)), text)
})

test('split secret assignments and common prefixed token formats are masked', () => {
  const out = [redactText("TOKEN='ghp_'+'abcdefghijklmnop1234'", 160), redactText('$env:MY_KEY = "abc" + "defsecret" ; echo ok', 160), redactText('x glpat-abcdefghij1234567890 y', 160)].join(' | ')
  for (const secret of ['abcdefghijklmnop1234', 'defsecret', 'glpat-abcdefghij']) assert.ok(!out.includes(secret), secret + ' leaked: ' + out)
  assert.ok(out.includes('echo ok'))
})

test('escaped quotes inside a quoted secret do not leave a fragment', () => {
  const out = redactText('password = "prefix\\"two words"; print(1)', 160)
  assert.ok(!/two|words|prefix/.test(out), out)
  assert.ok(out.includes('print(1)'))
  assert.ok(!/b c/.test(redactText('--password "a\\"b c" --ok', 80)))
})

test('an uncertain tool effect turns a later task failure into UNKNOWN_EFFECT, never a plain failure', async () => {
  const { createNajdCore } = require('../electron/najd-core.cjs')
  const core = createNajdCore({ model: async request => {
    request.onToolEvent('tool.started', 'najd-desktop-act', 'invoke · e1')
    request.onToolEvent('tool.failed', 'najd-desktop-act', 'effect unknown: unverified')
    throw Object.assign(new Error('PROVIDER_TIMEOUT'), { code: 'PROVIDER_TIMEOUT' })
  } })
  const task = core.startTask({ text: 'do it', intentId: 'unknown-effect-proof' })
  await new Promise(resolve => setTimeout(resolve, 40))
  const snapshot = core.getTask(task.id)
  assert.equal(snapshot.state, 'UNKNOWN_EFFECT')
  assert.ok(snapshot.activity.events.some(event => event.type === 'task.unknown_effect'))
  assert.ok(!snapshot.activity.events.some(event => event.type === 'task.failed'))
})

test('PowerShell backtick escapes and doubled quotes inside a quoted secret leave no fragment', () => {
  for (const text of ['$env:API_KEY = "a`"b cdefghijk"; echo ok', '$env:API_KEY = "a""b cdefghijk" ; echo ok', "$env:API_KEY = 'it''s cdefghijk'; echo ok"]) {
    const out = redactText(text, 160)
    assert.ok(!/cdefghijk/.test(out), out)
    assert.ok(out.includes('echo ok'), out)
  }
})

test('concatenated values of quoted secret keys leave no fragment', () => {
  const out = redactText('python -c \'cfg={"token":"alpha"+"bravo-secret"}\'', 160)
  assert.ok(!/alpha|bravo/.test(out), out)
})

test('stopping a task while an effectful tool is open is an unknown effect; a reply after an uncertain effect is too', async () => {
  const { createNajdCore } = require('../electron/najd-core.cjs')
  // 1. Stop during a dispatched effectful tool.
  let release
  const core = createNajdCore({ model: async request => {
    request.onToolEvent('tool.started', 'najd-mcp-call', 'server · tool')
    await new Promise(resolve => { release = resolve })
    return { kind: 'message', text: 'late' }
  } })
  const task = core.startTask({ text: 'go', intentId: 'cancel-open-effect' })
  await new Promise(resolve => setTimeout(resolve, 30))
  const stopped = core.cancelTask(task.id)
  release()
  assert.equal(stopped.state, 'UNKNOWN_EFFECT')
  assert.ok(stopped.activity.events.some(event => event.type === 'task.unknown_effect'))
  // 2. A read-only tool open at stop time is a clean stop.
  const reader = createNajdCore({ model: async request => { request.onToolEvent('tool.started', 'najd-files-read', 'a.txt'); await new Promise(() => {}) } })
  const readTask = reader.startTask({ text: 'go', intentId: 'cancel-open-read' })
  await new Promise(resolve => setTimeout(resolve, 30))
  assert.equal(reader.cancelTask(readTask.id).state, 'CANCELLED')
  // 3. A normal reply after an unverified effect keeps its text but ends as UNKNOWN_EFFECT, not COMPLETED.
  const replied = createNajdCore({ model: async request => {
    request.onToolEvent('tool.started', 'najd-desktop-act', 'invoke · e1')
    request.onToolEvent('tool.failed', 'najd-desktop-act', 'effect unknown: unverified')
    return { kind: 'message', text: 'I clicked it; please check.' }
  } })
  const done = replied.startTask({ text: 'go', intentId: 'reply-after-unknown' })
  await new Promise(resolve => setTimeout(resolve, 40))
  const snapshot = replied.getTask(done.id)
  assert.equal(snapshot.state, 'UNKNOWN_EFFECT')
  assert.equal(snapshot.output, 'I clicked it; please check.')
  assert.ok(!snapshot.activity.events.some(event => event.type === 'task.completed'))
})

test('terminal states from a stop survive a late model reply, browser clicks count as effectful, and an earlier uncertain effect outlives a later approval wait', async () => {
  const { createNajdCore } = require('../electron/najd-core.cjs')
  const settle = () => new Promise(resolve => setTimeout(resolve, 40))
  // A late reply after an unknown-effect stop must not become COMPLETED.
  let release
  const late = createNajdCore({ model: async request => {
    request.onToolEvent('tool.started', 'najd-browser', 'click · e1')
    await new Promise(resolve => { release = resolve })
    return { kind: 'message', text: 'late reply' }
  } })
  const a = late.startTask({ text: 'go', intentId: 'late-reply-after-stop' })
  await settle()
  assert.equal(late.cancelTask(a.id).state, 'UNKNOWN_EFFECT')
  release(); await settle()
  assert.equal(late.getTask(a.id).state, 'UNKNOWN_EFFECT')
  assert.ok(!late.getTask(a.id).activity.events.some(event => event.type === 'task.completed'))
  // Browser reads are not effectful.
  const read = createNajdCore({ model: async request => { request.onToolEvent('tool.started', 'najd-browser', 'read'); await new Promise(() => {}) } })
  const b = read.startTask({ text: 'go', intentId: 'browser-read-stop' })
  await settle()
  assert.equal(read.cancelTask(b.id).state, 'CANCELLED')
  // An earlier unverified effect wins over a stop at a later approval.
  const later = createNajdCore({ model: async request => {
    request.onToolEvent('tool.started', 'najd-desktop-act', 'invoke · e1')
    request.onToolEvent('tool.failed', 'najd-desktop-act', 'effect unknown: unverified')
    await request.requestApproval('najd-files-write', { path: 'a.txt', summary: 's' })
    return { kind: 'message', text: 'x' }
  } })
  const c = later.startTask({ text: 'go', intentId: 'unknown-then-approval' })
  await settle()
  assert.equal(later.getTask(c.id).state, 'WAITING_APPROVAL')
  assert.equal(later.cancelTask(c.id).state, 'UNKNOWN_EFFECT')
  // A failure while effectful work is still open is not a plain failure.
  const failing = createNajdCore({ model: async request => {
    request.onToolEvent('tool.started', 'najd-python-run', 'print(1)')
    throw Object.assign(new Error('PROVIDER_TIMEOUT'), { code: 'PROVIDER_TIMEOUT' })
  } })
  const d = failing.startTask({ text: 'go', intentId: 'failure-with-open-effect' })
  await settle()
  assert.equal(failing.getTask(d.id).state, 'UNKNOWN_EFFECT')
})

test('parenthesized and concatenated flag values leave no fragment', () => {
  for (const text of ["mycli --password ('alpha' + 'bravo-secret') --x", "mycli --password 'a'+'bravo-secret' --x"])
    assert.ok(!/alpha|bravo/.test(redactText(text, 160)), text)
  // A value that opens with a parenthesis is masked to the end of the line (the boundary is not guessed).
  assert.ok(redactText("mycli --password ('alpha' + 'bravo-secret') --x", 160).startsWith('mycli --password'))
})

test('parenthesized assignment values (generic and PowerShell environment) leave no fragment', () => {
  for (const text of ["$env:API_KEY = ( 'alpha' + 'bravo-secret' ) ; echo ok", "token=('alpha'+'bravo-secret')"]) assert.ok(!/alpha|bravo/.test(redactText(text, 160)), text)
})

test('quoted CMD assignments are masked as a whole unit', () => {
  for (const text of ['set "DB_PASSWORD=alpha bravo" & echo ok', 'setx "API_KEY" "alpha bravo"', 'setx API_KEY "alpha bravo"']) {
    const out = redactText(text, 160)
    assert.ok(!/alpha|bravo/.test(out), out)
  }
  assert.ok(redactText('set "DB_PASSWORD=alpha bravo" & echo ok', 160).includes('echo ok'))
  assert.equal(redactText('set PATH=C:/x', 100), 'set PATH=C:/x')
})

test('SetEnvironmentVariable masks the whole value argument, including concatenated and parenthesized ones', () => {
  for (const text of ["[Environment]::SetEnvironmentVariable('API_KEY','alpha'+'bravo-secret','User')", "[Environment]::SetEnvironmentVariable('API_KEY',('alpha'+'bravo-secret'),'User')"])
    assert.ok(!/alpha|bravo/.test(redactText(text, 200)), text)
  assert.equal(redactText("[Environment]::SetEnvironmentVariable('PATH','C:/x','User')", 200), "[Environment]::SetEnvironmentVariable('PATH','C:/x','User')")
})

test('SetEnvironmentVariable masks the rest of the statement, including values after parentheses and parentheses inside quotes', () => {
  for (const text of ["[Environment]::SetEnvironmentVariable('API_KEY',('')+'hunter2','User'); echo ok", "[Environment]::SetEnvironmentVariable('API_KEY','a)bsecret','User')"])
    assert.ok(!/hunter2|bsecret/.test(redactText(text, 200)), text)
  // The rest of the line is masked on purpose (no boundary guessing), so later commands on the same line are not kept.
  assert.ok(redactText("[Environment]::SetEnvironmentVariable('API_KEY',('')+'hunter2','User'); echo ok", 200).startsWith('[Environment]::SetEnvironmentVariable'))
})

test('SetEnvironmentVariable masks to the end of the line even with a quoted semicolon', () => {
  assert.ok(!/bravo/.test(redactText("[Environment]::SetEnvironmentVariable('API_KEY','alpha;bravo-secret','User'); echo x", 200)))
})

test('nested parenthesized secret expressions are masked to the end of the line', () => {
  for (const text of ["$env:API_KEY = (( 'alpha' ) + ( 'bravo secret' )) ; echo x", "mycli --password (( 'alpha' ) + ( 'bravo secret' )) --x", "token=(('alpha')+('bravo'))"])
    assert.ok(!/alpha|bravo/.test(redactText(text, 200)), text)
})

test('a block keeps its lines and still masks a secret whose value is on the line after its key (C16-02)', () => {
  const { redactBlock } = require('../electron/redact.cjs')
  const out = redactBlock('First line.\n{\n  "password":\n    "hunter2-very-secret"\n}\nauthorization: Bearer\nabcdef0123456789abcdef0123456789abcdef01\nend')
  assert.ok(!/hunter2|abcdef0123/.test(out), out)
  assert.ok(out.startsWith('First line.\n')); assert.ok(out.endsWith('\nend'), 'text after a masked line survives')
})