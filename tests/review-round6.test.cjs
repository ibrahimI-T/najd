// Review round 6: skill bodies are written atomically and reused only when intact (R6-001), knowledge-base
// reconciliation reads the library inside its queue (R6-002), PyPI wheels match NAJD's Python (R6-003), and enabling a
// skill stops at a cancel that arrives during verification (R6-004).
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), { createHash } = require('node:crypto')
const { zipSync, strToU8 } = require('fflate')
const { createExternalSkills } = require('../electron/external-skills.cjs')
const { createKnowledgeBases } = require('../electron/knowledge-bases.cjs')
const { createExtensions } = require('../electron/extensions.cjs')
const { fakeWheel, withWheels } = require('./helpers/fake-wheel.cjs')

const skillArchive = text => zipSync({ 'repo-main/SKILL.md': strToU8('---\nname: sturdy\ndescription: A sturdy skill\n---\n' + text) })

test('R6-001: a partial body left under its digest name is replaced, not reused', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'najd-r6-skill-'))
  const body = '---\nname: sturdy\ndescription: A sturdy skill\n---\nWhole body.'
  const digest = createHash('sha256').update(body).digest('hex')
  fs.mkdirSync(path.join(dir, 'ext-sturdy'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'ext-sturdy', digest + '.md'), '---\nname: stu') // what a crash could leave
  const skills = createExternalSkills({ directory: dir, fetchImpl: async () => new Response(skillArchive('Whole body.')) })
  await skills.install('https://github.com/acme/sturdy')
  await skills.setEnabled('ext-sturdy', true)
  assert.match((await skills.read('ext-sturdy', 0, 200)).text, /Whole body\./)
  assert.deepEqual(fs.readdirSync(path.join(dir, 'ext-sturdy')).filter(name => name.endsWith('.tmp')), [])
})

test('R6-004: a cancel that arrives while a skill is verified stops the enable', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'najd-r6-enable-'))
  const skills = createExternalSkills({ directory: dir, fetchImpl: async () => new Response(skillArchive('Body.')) })
  await skills.install('https://github.com/acme/sturdy')
  const controller = new AbortController()
  const pending = skills.setEnabled('ext-sturdy', true, controller.signal)
  controller.abort()
  await assert.rejects(pending, { code: 'CANCELLED' })
  assert.equal((await skills.list())[0].enabled, false)
})

test('R6-002: a document added while a listing reads an older library snapshot stays in its base', async () => {
  const id = n => String(n).repeat(64).slice(0, 64)
  const present = new Set([id(1)])
  const library = {
    // Each call answers after a short delay with the library as it was when the call started.
    list: async () => { const snapshot = [...present]; await new Promise(resolve => setTimeout(resolve, 30)); return snapshot.map(key => ({ id: key, name: key.slice(0, 4), kind: 'text', characters: 4 })) },
    fullText: async key => ({ id: key, name: key.slice(0, 4), kind: 'text', text: 'text' })
  }
  const kb = createKnowledgeBases({ filePath: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'najd-r6-kb-')), 'kb.json'), library })
  const base = await kb.create({ name: 'Live' })
  await kb.addItems(base.id, [id(1)])
  const listing = kb.list()
  present.add(id(2))
  await kb.addItems(base.id, [id(2)])
  await listing
  assert.deepEqual((await kb.get(base.id)).items.map(item => item.id), [id(1), id(2)])
})

test('R6-003: the PyPI wheel matches NAJD Python; an incompatible release is refused before approval', async () => {
  const official = { 'io.modelcontextprotocol.registry/official': { isLatest: true } }
  const made = []
  const wheel = filename => { const built = fakeWheel(filename, [filename.split('-')[0]]); made.push(built); return built.file }
  const releases = { 'tagged': [wheel('tagged-1.0-cp310-cp310-win_amd64.whl', 'a'), wheel('tagged-1.0-cp314-cp314-win_amd64.whl', 'b')],
    'stable': [wheel('stable-1.0-cp39-abi3-win_amd64.whl', 'c')], 'old': [wheel('old-1.0-cp310-cp310-win_amd64.whl', 'd')] }
  const servers = Object.keys(releases).map(name => ({ server: { name: 'io.x/' + name, packages: [{ registryType: 'pypi', identifier: name, version: '1.0', transport: { type: 'stdio' } }] }, _meta: official }))
  const fetchImpl = async url => ({ ok: true, json: async () => {
    const match = String(url).match(/pypi\.org\/pypi\/([^/]+)\//)
    return match ? { info: { version: '1.0' }, urls: releases[match[1]] } : { servers }
  } })
  const extensions = createExtensions({ fetchImpl: withWheels(fetchImpl, made), mcpServers: {}, root: os.tmpdir(), getEngine: async () => ({ python: 'C:/x/python.exe', receiptPython: 'tools/python-3.14.7+20260901-win32-x64/najd-engine.exe' }) })
  assert.equal((await extensions.planMcp('io.x/tagged')).wheel.filename, 'tagged-1.0-cp314-cp314-win_amd64.whl')
  assert.equal((await extensions.planMcp('io.x/stable')).wheel.filename, 'stable-1.0-cp39-abi3-win_amd64.whl')
  await assert.rejects(extensions.planMcp('io.x/old'), { code: 'UNSUPPORTED_PACKAGE' })
})

test('R7-003: a rejected update leaves the base exactly as it was', async () => {
  const library = { list: async () => [], fullText: async () => ({ text: '' }) }
  const kb = createKnowledgeBases({ filePath: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'najd-r7-kb-')), 'kb.json'), library })
  const base = await kb.create({ name: 'Original', description: 'first' })
  await assert.rejects(kb.update(base.id, { name: 'Renamed', description: 'x'.repeat(401) }), { code: 'INVALID_INPUT' })
  const after = await kb.get(base.id)
  assert.equal(after.name, 'Original'); assert.equal(after.description, 'first')
  await kb.create({ name: 'Second' })
  assert.deepEqual((await kb.list()).map(row => row.name), ['Original', 'Second'], 'a later save does not carry the rejected rename')
})

test('R7-001/R7-002: previews only read, and an invalid server answer never throws in the main process', async () => {
  const { createWebPreview } = require('../electron/web-preview.cjs')
  const { EventEmitter } = require('node:events')
  const preview = createWebPreview({ createSession: () => assert.fail('no window'), isPublicUrl: () => true, resolveFile: async () => { throw new Error('x') },
    lookup: (_host, _options, callback) => callback(null, [{ address: '93.184.216.34', family: 4 }]),
    requestImpl: (_url, _options, onResponse) => {
      const req = new EventEmitter()
      req.end = () => { const res = new EventEmitter(); res.statusCode = 600; res.headers = { 'x-bad': 'ok' }; res.destroy = () => {}; onResponse(res) }
      req.destroy = () => {}
      return req
    }, prepareImage: async () => '' })
  assert.equal((await preview.fetchHttps(new Request('https://site.example/'))).status, 502)
  assert.equal((await preview.fetchHttps(new Request('https://site.example/', { method: 'POST', body: 'x' }))).status, 405)
  assert.equal(await preview.allowRequest(1, 'https://site.example/', 'DELETE'), false)
})

test('R8-003/R8-004: pure wheels respect the Python version and Requires-Python; unreadable bases are reported, not hidden', async () => {
  const official = { 'io.modelcontextprotocol.registry/official': { isLatest: true } }
  const made = []
  const wheel = filename => { const built = fakeWheel(filename, [filename.split('-')[0]]); made.push(built); return built.file }
  const releases = { newer: { urls: [wheel('newer-1.0-py315-none-any.whl', 'a'), wheel('newer-1.0-cp314-cp314-win_amd64.whl', 'b')] },
    strict: { requires_python: '>=3.15', urls: [wheel('strict-1.0-py3-none-any.whl', 'c')] } }
  const servers = Object.keys(releases).map(name => ({ server: { name: 'io.x/' + name, packages: [{ registryType: 'pypi', identifier: name, version: '1.0', transport: { type: 'stdio' } }] }, _meta: official }))
  const fetchImpl = async url => ({ ok: true, json: async () => {
    const match = String(url).match(/pypi\.org\/pypi\/([^/]+)\//)
    return match ? { info: { version: '1.0', requires_python: releases[match[1]].requires_python }, urls: releases[match[1]].urls } : { servers }
  } })
  const extensions = createExtensions({ fetchImpl: withWheels(fetchImpl, made), mcpServers: {}, root: os.tmpdir(), getEngine: async () => ({ receiptPython: 'tools/python-3.14.7+20260901-win32-x64/najd-engine.exe' }) })
  assert.equal((await extensions.planMcp('io.x/newer')).wheel.filename, 'newer-1.0-cp314-cp314-win_amd64.whl')
  await assert.rejects(extensions.planMcp('io.x/strict'), { code: 'UNSUPPORTED_PACKAGE' })

  const { createAgentRuntime } = require('../electron/agent-runtime.cjs')
  const runtime = createAgentRuntime({ catalog: { search: async () => [], details: async () => ({}) }, library: { list: async () => [] }, logs: { read: async () => ({}) },
    knowledge: { summary: async () => { throw Object.assign(new Error('x'), { code: 'KNOWLEDGE_STORE_UNAVAILABLE' }) } } })
  let instructions = ''
  await runtime.run({ request: { text: 'حسب سياسات الشركة كم الإجازة؟', conversationId: 'c' }, respond: async request => { instructions = request.instructions; return { kind: 'message', text: 'ok' } } })
  assert.match(instructions, /knowledge bases could not be read right now/)
})

test('R9-002: Requires-Python follows PEP 440 against the full Python version', () => {
  const { requiresPythonAllows } = require('../electron/extensions.cjs')
  const version = [3, 14, 7]
  for (const [spec, expected] of [['>3.14.0', true], ['<=3.14.6', false], ['~=3.13.0', false], ['~=3.14.0', true], ['~=3.10', true], ['>=3.10,<3.15', true],
    ['>=3.15', false], ['==3.14.*', true], ['!=3.14.*', false], ['==3.13.*', false], ['>=3.9, !=3.11.*', true], ['>=3.10.*', false], ['banana', false], ['', true]])
    assert.equal(requiresPythonAllows(spec, version), expected, spec)
  assert.equal(requiresPythonAllows('>=3.10', null), false, 'an unknown Python version is not trusted')
})
