// Website building (owner request 2026-10-20): website requests get the coding profile with page previews; previews
// reach vision models as pictures; only local servers, workspace files and public https pages are rendered.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path')
const { createAgentRuntime } = require('../electron/agent-runtime.cjs')
const { createWebPreview } = require('../electron/web-preview.cjs')
const { selectProfile } = require('../electron/agent-toolsets.cjs')

const call = (name, args, id) => ({ kind: 'agent-tools', calls: [{ name, arguments: JSON.stringify(args), call_id: id }], items: [{ type: 'function_call', name, arguments: JSON.stringify(args), call_id: id }] })
const base = { catalog: { search: async () => [], details: async () => ({}) }, library: { list: async () => [] }, logs: { read: async () => ({}) } }

test('making a website chooses coding with previews; browsing a site does not', () => {
  for (const text of ['صمم لي موقع لمطعمي', 'ابي صفحة هبوط لمنتجي', 'build me a portfolio website']) {
    const choice = selectProfile({ text })
    assert.equal(choice.profile, 'coding', text); assert.ok(choice.extra.includes('webpreview') && choice.extra.includes('process'), text)
  }
  for (const text of ['افتح موقع البنك', 'open the website of my school']) assert.ok(!selectProfile({ text }).extra.includes('webpreview'), text)
})

test('every model gets najd_web_preview; only a vision model sees the picture, others get its text (owner live test 2026-10-31)', async () => {
  const captures = []
  const webPreview = { capture: async (args) => { captures.push(args); return { status: 'captured', url: 'http://localhost:5173/', width: args.width, imageUrl: 'data:image/jpeg;base64,AAAA', consoleErrors: [] } } }
  for (const vision of [true, false]) {
    let turn = 0, offered = [], last = null
    const runtime = createAgentRuntime({ ...base, webPreview })
    await runtime.run({ request: { text: 'صمم لي موقع لمطعمي', conversationId: 'c', vision },
      respond: async request => {
        if (turn === 0) offered = request.tools.map(tool => tool.name)
        last = request.input
        return turn++ === 0 ? call('najd_web_preview', { target: 'http://localhost:5173/', width: 390, fullPage: true, steps: '' }, 'p1') : { kind: 'message', text: 'done' }
      } })
    assert.equal(offered.includes('najd_web_preview'), true)
    const result = JSON.parse(last.find(item => item.type === 'function_call_output').output)
    assert.equal(result.imageUrl, undefined, 'the picture is not sent as text')
    const sawImage = last.some(item => Array.isArray(item.content) && item.content.some(part => part.type === 'input_image' && part.image_url === 'data:image/jpeg;base64,AAAA'))
    assert.equal(sawImage, vision)
    if (!vision) assert.match(result.note, /cannot see the picture/)
  }
  assert.deepEqual(captures, [0, 1].map(() => ({ target: 'http://localhost:5173/', width: 390, fullPage: true, steps: '' })))
})

test('the preview refuses other schemes, non-public addresses and files outside the allowed folders', async () => {
  const preview = createWebPreview({ createSession: () => assert.fail('nothing should render'), isPublicUrl: url => url === 'https://example.com/',
    resolveFile: async () => { throw Object.assign(new Error('x'), { code: 'PATH_NOT_ALLOWED' }) }, prepareImage: async () => '' })
  for (const target of ['file:///C:/Windows/win.ini', 'ftp://host/x', 'http://10.0.0.5/', 'https://intranet.local/', 'javascript:alert(1)'])
    await assert.rejects(preview.capture({ target }), { code: /URL_NOT_ALLOWED|PATH_NOT_ALLOWED/ }, target)
  await assert.rejects(preview.capture({ target: 'C:\\Users\\someone\\secret.html' }), { code: 'PATH_NOT_ALLOWED' })
})

test('the website guide is bundled and names the tools it relies on', () => {
  const guide = fs.readFileSync(path.join(__dirname, '..', 'electron', 'najd-skills', 'najd-web-builder.md'), 'utf8')
  assert.match(guide, /^---\r?\nname: najd-web-builder\r?\n/)
  for (const tool of ['najd_web_preview', 'najd_process_start', 'najd_files_write', 'najd_image_generate']) assert.match(guide, new RegExp(tool))
})

test('NAJD-R01/R02: requests are checked per capture mode, public hosts by their resolved addresses, folders by their final index file', async () => {
  const fsx = require('node:fs'), os = require('node:os'), pathx = require('node:path')
  const { privateAddress } = require('../electron/web-preview.cjs')
  for (const address of ['10.1.2.3', '127.0.0.1', '192.168.1.1', '172.20.0.1', '169.254.1.1', '::1', 'fd00::1', '::ffff:10.0.0.1']) assert.equal(privateAddress(address), true, address)
  for (const address of ['8.8.8.8', '104.16.0.1', '2606:4700::1111']) assert.equal(privateAddress(address), false, address)
  const dir = fsx.mkdtempSync(pathx.join(os.tmpdir(), 'najd-preview-unit-'))
  fsx.mkdirSync(pathx.join(dir, 'site')); fsx.writeFileSync(pathx.join(dir, 'site', 'index.html'), '<p>x</p>')
  // The folder is allowed, but its index file resolves outside the allowed roots (as a symlink would).
  const resolveFile = async input => { if (input.endsWith('index.html')) throw Object.assign(new Error('x'), { code: 'PATH_NOT_ALLOWED' }); return pathx.resolve(dir, input) }
  const lookup = (host, _options, callback) => callback(null, host === 'rebind.example' ? [{ address: '10.0.0.7', family: 4 }] : [{ address: '93.184.216.34', family: 4 }])
  const preview = createWebPreview({ createSession: () => assert.fail('nothing should render'), isPublicUrl: () => true, resolveFile, lookup, prepareImage: async () => '' })
  await assert.rejects(preview.capture({ target: pathx.join(dir, 'site') }), { code: 'PATH_NOT_ALLOWED' })
  await assert.rejects(preview.capture({ target: 'https://rebind.example/' }), { code: 'URL_NOT_ALLOWED' })
  assert.equal(await preview.allowRequest(999, 'https://example.org/'), false, 'requests outside a live capture are refused')
})

test('I2-001/I2-008: the connection lookup refuses private answers, and the deadline covers address checks and DNS', async () => {
  let answer = [{ address: '10.0.0.9', family: 4 }]
  const preview = createWebPreview({ createSession: () => assert.fail('nothing should render'), isPublicUrl: () => true, resolveFile: async () => { throw new Error('x') },
    lookup: (_host, _options, callback) => answer === 'hang' ? undefined : callback(null, answer), prepareImage: async () => '', timeoutMs: 300 })
  const connect = () => new Promise(resolve => preview.publicLookup('site.example', {}, (error, address) => resolve(error ? error.code : address)))
  assert.equal(await connect(), 'URL_NOT_ALLOWED', 'a private address is never connected to')
  answer = [{ address: '93.184.216.34', family: 4 }]
  assert.equal(await connect(), '93.184.216.34')
  answer = 'hang'
  const started = Date.now()
  await assert.rejects(preview.capture({ target: 'https://slow.example/' }), { code: 'TIMEOUT' })
  assert.ok(Date.now() - started < 2000)
  const response = await preview.fetchHttps(new Request('https://10.0.0.1/'))
  assert.equal(response.status, 403)
})

test('I3-005: a proxied https request ends with its capture, and a late DNS answer opens no connection', async () => {
  let deliver = null, created = 0
  const preview = createWebPreview({ createSession: () => assert.fail('no window'), isPublicUrl: () => true, resolveFile: async () => { throw new Error('x') },
    lookup: (_host, _options, callback) => { deliver = () => callback(null, [{ address: '93.184.216.34', family: 4 }]) },
    requestImpl: (_url, options) => {
      created++
      const { EventEmitter } = require('node:events')
      const req = new EventEmitter()
      req.end = () => options.lookup('site.example', {}, (error, address) => req.emit(error ? 'error' : 'connect', error || address))
      req.destroy = () => {}
      return req
    }, prepareImage: async () => '' })
  const lifetime = new AbortController()
  const pending = preview.fetchHttps(new Request('https://site.example/'), { signal: lifetime.signal })
  lifetime.abort()
  deliver()
  const response = await pending
  assert.equal(response.status, 502, 'the late DNS answer is turned into a failure, not a connection')
  const already = new AbortController(); already.abort()
  assert.equal((await preview.fetchHttps(new Request('https://site.example/'), { signal: already.signal })).status, 499)
  assert.equal(created, 1)
})

test('I5-001: every spelling of a private address is refused, including IPv4-mapped and NAT64 forms', () => {
  const { privateAddress } = require('../electron/web-preview.cjs')
  for (const address of ['::ffff:7f00:1', '::ffff:127.0.0.1', '0:0:0:0:0:ffff:7f00:0001', '::ffff:a00:1', '::ffff:c0a8:101', '::ffff:a9fe:1', '64:ff9b::a00:1', '::7f00:1', '::', 'fe80::1', 'ff02::1', 'not-an-address'])
    assert.equal(privateAddress(address), true, address)
  for (const address of ['::ffff:808:808', '2606:4700::1111', '64:ff9b::808:808']) assert.equal(privateAddress(address), false, address)
})

test('R10-001: network shares and device paths never reach the file resolver', async () => {
  const seen = []
  const preview = createWebPreview({ createSession: () => assert.fail('nothing should render'), isPublicUrl: () => false,
    resolveFile: async input => { seen.push(input); throw Object.assign(new Error('x'), { code: 'PATH_NOT_ALLOWED' }) }, prepareImage: async () => '' })
  for (const target of ['\\\\attacker\\share\\page.html', '//attacker/share/page.html', '\\\\?\\C:\\Windows\\win.ini', 'file://attacker/share/page.html'])
    await assert.rejects(preview.capture({ target }), { code: 'URL_NOT_ALLOWED' }, target)
  // A resource in a page: file://attacker/... and a UNC path written as a file URL.
  assert.equal(await preview.allowRequest(42, 'file://attacker/share/style.css'), false)
  assert.deepEqual(seen, [], 'the resolver was never asked')
})

test('R12-003: a session that finishes after a timeout is closed as soon as it exists', async () => {
  const closed = { destroyed: 0, released: 0 }
  const preview = createWebPreview({ isPublicUrl: () => false, resolveFile: async () => { throw new Error('x') }, prepareImage: async () => '', timeoutMs: 100,
    createSession: () => new Promise(resolve => setTimeout(() => resolve({ window: { destroy: () => closed.destroyed++, webContents: { id: 7 } }, release: async () => { closed.released++ } }), 400)) })
  await assert.rejects(preview.capture({ target: 'http://127.0.0.1:5173/' }), { code: 'TIMEOUT' })
  await new Promise(resolve => setTimeout(resolve, 600))
  assert.deepEqual(closed, { destroyed: 1, released: 1 })
})

test('R12-001: a link to a network share is refused before anything follows it; local junctions are fine', async () => {
  const fsx = require('node:fs'), osx = require('node:os'), pathx = require('node:path')
  const dir = fsx.realpathSync(fsx.mkdtempSync(pathx.join(osx.tmpdir(), 'najd-preview-links-')))
  fsx.mkdirSync(pathx.join(dir, 'real')); fsx.writeFileSync(pathx.join(dir, 'real', 'index.html'), '<p>x</p>')
  fsx.symlinkSync(pathx.join(dir, 'real'), pathx.join(dir, 'local-link'), 'junction')
  const seen = []
  const preview = createWebPreview({ createSession: () => { throw Object.assign(new Error('stop'), { code: 'STOP' }) }, isPublicUrl: () => false, baseDirectory: dir, prepareImage: async () => '',
    resolveFile: async input => { seen.push(input); return input } })
  await assert.rejects(preview.capture({ target: pathx.join(dir, 'local-link') }), { code: 'STOP' }, 'a local junction is followed')
  let shared = true
  try { fsx.symlinkSync('\\\\attacker.invalid\\share', pathx.join(dir, 'remote'), 'dir') } catch { shared = false }
  if (shared) {
    seen.length = 0
    await assert.rejects(preview.capture({ target: pathx.join(dir, 'remote', 'page.html') }), { code: 'URL_NOT_ALLOWED' })
    assert.deepEqual(seen, [], 'the resolver never saw the share')
  } else console.log('# symlink to a share needs Developer Mode or admin here; the share case was not run')
})


test('R12-001: links whose targets are shares (any spelling) stop the walk; the resolver is never asked', async () => {
  const targets = ['\\\\server\\share', '\\??\\UNC\\server\\share', '//server/share', 'UNC\\server\\share']
  for (const target of targets) {
    const seen = []
    const files = {
      lstat: async file => ({ isSymbolicLink: () => /linked$/i.test(file) }),
      readlink: async () => target
    }
    const preview = createWebPreview({ createSession: () => assert.fail('nothing should render'), isPublicUrl: () => false, files, prepareImage: async () => '',
      resolveFile: async input => { seen.push(input); return input } })
    await assert.rejects(preview.capture({ target: 'C:\\work\\linked\\page.html' }), { code: 'URL_NOT_ALLOWED' }, target)
    assert.deepEqual(seen, [], target)
  }
})
