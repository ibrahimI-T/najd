// Review round 2 (I2-002, I2-004, I2-005): cancelling an MCP install stops the program during start-up and
// removes its registration; a launch configuration too long to show is not offered for approval; PyPI versions follow
// PEP 440 and a requested release is fetched exactly.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const { createMcpServers } = require('../electron/mcp-servers.cjs')
const { createExtensions } = require('../electron/extensions.cjs')
const { fakeWheel, withWheels } = require('./helpers/fake-wheel.cjs')
const { createAgentRuntime } = require('../electron/agent-runtime.cjs')

test('I2-002: a cancel during start-up stops the program at once and the server is never enabled', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'najd-mcp-cancel-'))
  const silent = path.join(dir, 'silent-server.cjs')
  fs.writeFileSync(silent, 'setInterval(() => {}, 1000)\n') // never answers initialize
  const servers = createMcpServers({ filePath: path.join(dir, 'mcp-servers.json'), clientVersion: 'test', confirm: async () => true, getBundledNode: () => process.execPath })
  const added = await servers.add({ name: 'Silent', command: 'najd-node', args: [silent] }, { approvedInChat: true })
  const controller = new AbortController()
  setTimeout(() => controller.abort(), 300)
  const started = Date.now()
  const view = await servers.connect(added.server.id, { signal: controller.signal })
  assert.ok(Date.now() - started < 10000, 'did not wait for the 60 s start-up timeout')
  assert.equal(view.error, 'CANCELLED'); assert.equal(view.enabled, false)
  const before = new AbortController(); before.abort()
  await assert.rejects(servers.connect(added.server.id, { signal: before.signal }), { code: 'CANCELLED' })
  await assert.rejects(servers.add({ name: 'Other', command: 'najd-node', args: [silent] }, { approvedInChat: true, signal: before.signal }), { code: 'CANCELLED' })
  assert.equal((await servers.list()).length, 1)
  servers.stopAll()
})

test('I2-002: a registration whose connection fails with an error is removed again', async () => {
  const calls = {}
  const mcpServers = { BUNDLED: 'najd-node', add: async () => ({ status: 'added', server: { id: 'x' } }), connect: async () => { throw Object.assign(new Error('boom'), { code: 'BOOM' }) }, remove: async id => { calls.removed = id } }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'najd-ext-r2-'))
  const run = async (_command, args) => {
    const prefix = args[args.indexOf('--prefix') + 1], home = path.join(prefix, 'node_modules', 'acme')
    fs.mkdirSync(home, { recursive: true })
    fs.writeFileSync(path.join(home, 'package.json'), JSON.stringify({ name: 'acme', version: '1.0.0', bin: 'index.js' }))
    fs.writeFileSync(path.join(prefix, 'package-lock.json'), JSON.stringify({ packages: { 'node_modules/acme': { version: '1.0.0', integrity: 'sha512-x' } } }))
  }
  const extensions = createExtensions({ mcpServers, root, run, getNode: () => 'C:\\n\\node.exe', getNpmCli: () => 'C:\\n\\npm-cli.js' })
  await assert.rejects(extensions.installMcp({ registryType: 'npm', packageName: 'acme', program: 'acme', version: '1.0.0', integrity: 'sha512-x', spec: 'acme@1.0.0', env: {}, args: [], server: { name: 'io.x/acme' } }), { code: 'BOOM' })
  assert.equal(calls.removed, 'x')
})

test('I2-005: PyPI releases use PEP 440 versions and a requested release is fetched exactly', async () => {
  const official = { 'io.modelcontextprotocol.registry/official': { isLatest: true } }
  const servers = [
    { server: { name: 'io.x/short', packages: [{ registryType: 'pypi', identifier: 'short-ver', version: '1.2', transport: { type: 'stdio' } }] }, _meta: official },
    { server: { name: 'io.x/odd', packages: [{ registryType: 'pypi', identifier: 'odd-ver', version: '1.2!x', transport: { type: 'stdio' } }] }, _meta: official }
  ]
  const shortWheel = fakeWheel('short_ver-1.2-py3-none-any.whl', ['short-ver'])
  const asked = []
  const fetchImpl = async url => ({ ok: true, json: async () => {
    asked.push(String(url))
    if (String(url).includes('pypi.org')) return { info: { version: '1.2' }, urls: [shortWheel.file] }
    return { servers }
  } })
  const extensions = createExtensions({ fetchImpl: withWheels(fetchImpl, [shortWheel]), mcpServers: {}, root: os.tmpdir() })
  const plan = await extensions.planMcp('io.x/short')
  assert.equal(plan.spec, 'short-ver==1.2'); assert.equal(plan.wheel.sha256, shortWheel.file.digests.sha256); assert.equal(plan.executable, 'short-ver')
  assert.ok(asked.includes('https://pypi.org/pypi/short-ver/1.2/json'), 'the requested release, not latest')
  // A version that is neither SemVer nor PEP 440 is not offered at all, and latest is never fetched in its place.
  assert.equal((await extensions.planMcp('io.x/odd')).status, 'unsupported')
  assert.ok(!asked.some(url => url.includes('odd-ver')))
})

test('I2-004: a launch configuration too long to show in full is not offered for approval', async () => {
  const long = Array.from({ length: 6 }, (_, index) => 'x'.repeat(300) + index)
  const extensions = { planMcp: async () => ({ status: 'ready', server: { name: 'io.x/long', repository: '', description: '' }, registryType: 'npm', spec: 'long@1.0.0', integrity: 'sha512-x', args: long, env: {} }),
    installMcp: async () => assert.fail('must not install') }
  const call = (name, args, id) => ({ kind: 'agent-tools', calls: [{ name, arguments: JSON.stringify(args), call_id: id }], items: [{ type: 'function_call', name, arguments: JSON.stringify(args), call_id: id }] })
  const runtime = createAgentRuntime({ catalog: { search: async () => [], details: async () => ({}) }, library: { list: async () => [] }, logs: { read: async () => ({}) }, extensions })
  let turn = 0, last = null
  await runtime.run({ request: { text: 'install an MCP server', conversationId: 'c' }, requestApproval: async () => assert.fail('must not ask'),
    respond: async request => { last = request.input; return turn++ === 0 ? call('najd_extension_install', { kind: 'mcp', source: 'io.x/long' }, 'i') : { kind: 'message', text: 'ok' } } })
  const output = JSON.parse(last.find(item => item.type === 'function_call_output').output)
  assert.equal(output.status, 'unsupported'); assert.match(output.note, /too long to show in full/)
})

test('R13-002: the program is read from the wheel before approval; several programs without a clear one are refused', async () => {
  const official = { 'io.modelcontextprotocol.registry/official': { isLatest: true } }
  const wheels = { single: fakeWheel('single-1.0-py3-none-any.whl', ['single-server']), named: fakeWheel('named_mcp-1.0-py3-none-any.whl', ['named-admin', 'named-mcp']),
    ambiguous: fakeWheel('ambiguous-1.0-py3-none-any.whl', ['acme-admin', 'acme-server']) }
  const servers = Object.keys(wheels).map(key => ({ server: { name: 'io.x/' + key, packages: [{ registryType: 'pypi', identifier: key === 'named' ? 'named_mcp' : key, version: '1.0', transport: { type: 'stdio' } }] }, _meta: official }))
  const fetchImpl = async url => ({ ok: true, json: async () => {
    const match = String(url).match(/pypi\.org\/pypi\/([^/]+)\//)
    const key = match && (match[1] === 'named_mcp' ? 'named' : match[1])
    return key ? { info: { version: '1.0' }, urls: [wheels[key].file] } : { servers }
  } })
  const extensions = createExtensions({ fetchImpl: withWheels(fetchImpl, Object.values(wheels)), mcpServers: {}, root: os.tmpdir() })
  assert.equal((await extensions.planMcp('io.x/single')).executable, 'single-server')
  assert.equal((await extensions.planMcp('io.x/named')).executable, 'named-mcp')
  await assert.rejects(extensions.planMcp('io.x/ambiguous'), { code: 'UNSUPPORTED_PACKAGE' })
})

test('R13-001: MCP arguments too long to show in full are refused before approval', async () => {
  const { createAgentRuntime } = require('../electron/agent-runtime.cjs')
  const mcp = { tools: async () => [{ server: 's', serverName: 'S', name: 'run', inputSchema: { type: 'object' } }], call: async () => assert.fail('must not run') }
  const runtime = createAgentRuntime({ catalog: { search: async () => [], details: async () => ({}) }, library: { list: async () => [] }, logs: { read: async () => ({}) }, mcp })
  const call = (name, args, id) => ({ kind: 'agent-tools', calls: [{ name, arguments: JSON.stringify(args), call_id: id }], items: [{ type: 'function_call', name, arguments: JSON.stringify(args), call_id: id }] })
  let turn = 0, last = null
  await runtime.run({ request: { text: 'run it', conversationId: 'c' }, requestApproval: async () => assert.fail('must not ask'),
    respond: async request => { last = request.input; return turn++ === 0 ? call('najd_mcp_call', { server: 's', tool: 'run', arguments: JSON.stringify({ note: 'x'.repeat(1300), target: 'C:/' }) }, 'm') : { kind: 'message', text: 'ok' } } })
  const output = JSON.parse(last.find(item => item.type === 'function_call_output').output)
  assert.equal(output.error, 'ARGUMENTS_TOO_LONG')
})

test('I15-001: an oversized wheel without a declared length is stopped while it streams', async () => {
  const official = { 'io.modelcontextprotocol.registry/official': { isLatest: true } }
  const servers = [{ server: { name: 'io.x/huge', packages: [{ registryType: 'pypi', identifier: 'huge', version: '1.0', transport: { type: 'stdio' } }] }, _meta: official }]
  let produced = 0
  const endless = new ReadableStream({ pull(controller) { const chunk = new Uint8Array(1024 * 1024); produced += chunk.length; controller.enqueue(chunk) } })
  const fetchImpl = async url => String(url).endsWith('.whl') ? new Response(endless)
    : { ok: true, json: async () => String(url).includes('pypi.org')
      ? { info: { version: '1.0' }, urls: [{ packagetype: 'bdist_wheel', url: 'https://files.pythonhosted.org/p/huge-1.0-py3-none-any.whl', filename: 'huge-1.0-py3-none-any.whl', digests: { sha256: 'a'.repeat(64) } }] }
      : { servers } }
  const extensions = createExtensions({ fetchImpl, mcpServers: {}, root: os.tmpdir() })
  await assert.rejects(extensions.planMcp('io.x/huge'), { code: 'UNSUPPORTED_PACKAGE' })
  assert.ok(produced <= 66 * 1024 * 1024, 'reading stopped just past the limit: ' + produced)
})
