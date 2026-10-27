// The agent finds and adds missing skills and MCP servers (owner request 2026-10-20). No network: fetch, installs
// and the MCP store are fakes.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const { createExtensions } = require('../electron/extensions.cjs')
const { createAgentRuntime } = require('../electron/agent-runtime.cjs')
const { selectProfile } = require('../electron/agent-toolsets.cjs')
const { decideAction } = require('../electron/action-policy.cjs')

const official = { 'io.modelcontextprotocol.registry/official': { isLatest: true } }
const registry = { servers: [
  { server: { name: 'io.github.acme/weather', description: 'Weather forecasts', version: '1.2.0', repository: { url: 'https://github.com/acme/weather' },
    packages: [{ registryType: 'npm', identifier: '@acme/weather-mcp', version: '1.2.0', transport: { type: 'stdio' }, environmentVariables: [{ name: 'UNITS', default: 'metric' }] }] }, _meta: official },
  { server: { name: 'io.github.acme/maps', description: 'Maps', version: '2.0.0', packages: [{ registryType: 'pypi', identifier: 'acme-maps', version: '2.0.0', transport: { type: 'stdio' },
    environmentVariables: [{ name: 'MAPS_KEY', isRequired: true, isSecret: true }] }] }, _meta: official },
  { server: { name: 'ai.remote/only', description: 'Remote', version: '1', remotes: [{ type: 'streamable-http', url: 'https://mcp.example.com/mcp' }] }, _meta: official },
  { server: { name: 'io.github.acme/files', description: 'Files', version: '3.0.0', packages: [{ registryType: 'npm', identifier: 'acme-files', version: 'latest', transport: { type: 'stdio' },
    packageArguments: [{ type: 'named', name: '--stdio' }, { type: 'positional', valueHint: 'root_path', isRequired: true, description: 'Folder to serve' }] }] }, _meta: official },
  { server: { name: 'io.github.acme/notes', description: 'Notes', version: '1.0.0', packages: [{ registryType: 'npm', identifier: 'acme-notes', transport: { type: 'stdio' },
    packageArguments: [{ type: 'named', name: '--stdio' }, { type: 'named', name: '--mode', value: 'readonly' }, { type: 'positional', valueHint: 'extra' }] }] }, _meta: official },
  { server: { name: 'ai.remote/keyed', description: 'Keyed', version: '1', remotes: [{ type: 'streamable-http', url: 'https://k.example.com/mcp', headers: [{ name: 'Authorization', isRequired: true }] }] }, _meta: official }
] }
// npm release documents: exact versions with integrity; "latest" resolves to an exact version (NAJD-R07).
const integrity = name => 'sha512-' + Buffer.from(name.padEnd(64, '#')).toString('base64')
const npmDocs = { '@acme%2Fweather-mcp/1.2.0': { name: '@acme/weather-mcp', version: '1.2.0', bin: { 'weather-mcp': 'dist/index.js' } },
  'mcp-remote/latest': { name: 'mcp-remote', version: '0.15.1', bin: { 'mcp-remote': 'dist/proxy.js', 'mcp-remote-client': 'dist/client.js' } },
  'acme-notes/latest': { name: 'acme-notes', version: '4.5.6', bin: { 'acme-notes': 'index.js' } } }
const npmDoc = url => { const key = String(url).split('registry.npmjs.org/')[1]; const doc = npmDocs[key]; return doc ? { ...doc, dist: { integrity: integrity(doc.name + doc.version) } } : {} }
const fetchImpl = async url => ({ ok: true, json: async () => String(url).includes('registry.npmjs.org') ? npmDoc(url) : String(url).includes('api.github.com')
  ? { items: [{ full_name: 'anthropics/skills', html_url: 'https://github.com/anthropics/skills', description: 'Skills', stargazers_count: 9000, pushed_at: '2026-10-01' }] }
  : registry })

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'najd-ext-'))
  const calls = { run: [], add: [], enabled: [] }
  const run = async (command, args) => {
    calls.run.push([command, args])
    const prefix = args[args.indexOf('--prefix') + 1]
    const pkg = path.join(prefix, 'node_modules', '@acme', 'weather-mcp')
    fs.mkdirSync(pkg, { recursive: true })
    const version = calls.tamper ? '9.9.9' : '1.2.0'
    fs.writeFileSync(path.join(pkg, 'package.json'), JSON.stringify({ name: '@acme/weather-mcp', version, bin: { 'weather-mcp': 'dist/index.js' } }))
    fs.writeFileSync(path.join(prefix, 'package-lock.json'), JSON.stringify({ packages: { 'node_modules/@acme/weather-mcp': { version, integrity: integrity('@acme/weather-mcp1.2.0') } } }))
  }
  const mcpServers = { BUNDLED: 'najd-node',
    add: async (input, options) => { calls.add.push([input, options]); return { status: 'added', server: { id: 'weather' } } },
    connect: async (id, options) => { calls.connect = options; if (calls.cancelDuringConnect) calls.cancelDuringConnect(); return { state: 'connected', tools: [{ name: 'forecast', description: 'Get a forecast' }] } },
    remove: async id => { calls.removed = id } }
  const skills = { install: async url => [{ id: 'ext-pdf', name: 'pdf', description: 'PDF skill', compatibility: 'instructions-only', url }], setEnabled: async (id, value) => calls.enabled.push([id, value]) }
  const extensions = createExtensions({ fetchImpl, skills, mcpServers, root, run, getNode: () => 'C:\\najd\\node.exe', getNpmCli: () => 'C:\\najd\\npm-cli.js', getEngine: async () => null })
  return { extensions, calls, root }
}

test('MCP search lists installable stdio servers first with what they need; skill search lists GitHub and curated sources', async () => {
  const { extensions } = setup()
  const servers = await extensions.searchMcp('weather')
  assert.equal(servers[0].installable, true); assert.equal(servers[0].package, 'npm:@acme/weather-mcp')
  assert.deepEqual(servers.find(row => row.name === 'io.github.acme/maps').needs, [{ name: 'MAPS_KEY', secret: true, description: '' }])
  assert.equal(servers.find(row => row.name === 'ai.remote/keyed').installable, false)
  assert.equal(servers.find(row => row.name === 'ai.remote/only').package, 'remote:https://mcp.example.com/mcp')
  const skills = await extensions.searchSkills('pdf')
  assert.equal(skills.repositories[0].url, 'https://github.com/anthropics/skills')
  assert.ok(skills.curatedSources.some(source => source.url === 'https://github.com/anthropics/skills'))
  assert.match(skills.note, /for finding skills/); assert.match(skills.note, /folder URL of that skill/); assert.match(skills.note, /only when the user asked for all of them/)
})

test('an npm MCP server installs without scripts, starts with NAJD Node from its package bin and connects', async () => {
  const { extensions, calls, root } = setup()
  const plan = await extensions.planMcp('io.github.acme/weather')
  assert.equal(plan.status, 'ready'); assert.equal(plan.spec, '@acme/weather-mcp@1.2.0'); assert.deepEqual(plan.env, { UNITS: 'metric' })
  const result = await extensions.installMcp(plan)
  assert.ok(calls.run[0][1].includes('--ignore-scripts'))
  const [input, options] = calls.add[0]
  assert.equal(input.command, 'najd-node')
  const folder = path.relative(path.join(root, 'npm'), input.args[0]).split(path.sep)
  assert.match(folder[0], /^[0-9a-f]{32}$/, 'one folder per exact release identity (I3-001)')
  assert.deepEqual(folder.slice(1), ['node_modules', '@acme', 'weather-mcp', 'dist', 'index.js'])
  assert.equal(options.approvedInChat, true)
  assert.equal(plan.integrity, integrity('@acme/weather-mcp1.2.0'))
  assert.equal(result.status, 'connected'); assert.equal(result.tools[0].name, 'forecast')
})

test('servers that need secrets, remote-only servers and unknown names are not installed', async () => {
  const { extensions, calls } = setup()
  assert.equal((await extensions.planMcp('io.github.acme/maps')).status, 'needs_user_input')
  assert.equal((await extensions.planMcp('ai.remote/keyed')).status, 'unsupported')
  await assert.rejects(extensions.planMcp('io.github.nobody/none'), { code: 'NOT_FOUND' })
  await assert.rejects(extensions.installSkill('https://evil.example/skill.zip'), { code: 'INVALID_INPUT' })
  assert.equal(calls.run.length, 0)
})

test('the agent searches, asks the user, then installs and can call the new MCP tools in the same task', async () => {
  const { extensions, calls } = setup()
  const approvals = []
  const mcp = { tools: async () => calls.add.length ? [{ server: 'weather', serverName: 'weather', name: 'forecast', inputSchema: { type: 'object' } }] : [], call: async () => ({ text: 'sunny' }) }
  const runtime = createAgentRuntime({ catalog: { search: async () => [], details: async () => ({}) }, library: { list: async () => [] }, logs: { read: async () => ({}) }, mcp, extensions })
  const call = (name, args, id) => ({ kind: 'agent-tools', calls: [{ name, arguments: JSON.stringify(args), call_id: id }], items: [{ type: 'function_call', name, arguments: JSON.stringify(args), call_id: id }] })
  let turn = 0, instructions = '', last = null, offered = null
  await runtime.run({ request: { text: 'ثبت لي اتصال للطقس', conversationId: 'c' }, requestApproval: async (tool, card) => { approvals.push([tool, card]); return 'ALLOW_ONCE' },
    respond: async request => {
      if (turn === 0) instructions = request.instructions
      last = request.input; offered = request.tools.map(tool => tool.name)
      turn++
      if (turn === 1) return call('najd_extensions_search', { kind: 'mcp', query: 'weather' }, 's1')
      if (turn === 2) return call('najd_extension_install', { kind: 'mcp', source: 'io.github.acme/weather' }, 'i1')
      if (turn === 3) return call('najd_mcp_call', { server: 'weather', tool: 'forecast', arguments: '{}' }, 'm1')
      return { kind: 'message', text: 'تم' }
    } })
  assert.match(instructions, /strong, well-equipped environment/)
  assert.match(instructions, /najd_extensions_search/)
  assert.equal(approvals[0][0], 'najd-mcp-install'); assert.match(approvals[0][1].summary, /@acme\/weather-mcp@1\.2\.0/)
  assert.equal(approvals[1][0], 'najd-mcp-call')
  assert.ok(offered.includes('najd_mcp_call'))
  assert.ok(last.some(item => item.type === 'function_call_output' && item.output.includes('sunny')))
})

test('a skill install is approved first and enabled; a denial installs nothing', async () => {
  const { extensions, calls } = setup()
  const runtime = createAgentRuntime({ catalog: { search: async () => [], details: async () => ({}) }, library: { list: async () => [] }, logs: { read: async () => ({}) }, extensions })
  const call = (name, args, id) => ({ kind: 'agent-tools', calls: [{ name, arguments: JSON.stringify(args), call_id: id }], items: [{ type: 'function_call', name, arguments: JSON.stringify(args), call_id: id }] })
  for (const decision of ['DENY', 'ALLOW_ONCE']) {
    let turn = 0, last = null
    await runtime.run({ request: { text: 'add a pdf skill', conversationId: 'c' }, requestApproval: async tool => { assert.equal(tool, 'najd-skill-install'); return decision },
      respond: async request => { last = request.input; return turn++ === 0 ? call('najd_extension_install', { kind: 'skill', source: 'https://github.com/anthropics/skills/tree/main/skills/pdf' }, 'k') : { kind: 'message', text: 'ok' } } })
    const output = JSON.parse(last.find(item => item.type === 'function_call_output').output)
    assert.equal(output.status, decision === 'DENY' ? 'denied_by_user' : 'installed')
  }
  assert.deepEqual(calls.enabled, [['ext-pdf', true]])
})

test('extension searches are scoped reads, installs need approval, and Arabic install requests load the toolset', () => {
  assert.equal(decideAction('extensions.search', { kind: 'extensions', validated: true }).decision, 'allow')
  assert.equal(decideAction('extensions.install').decision, 'approval')
  assert.ok(selectProfile({ text: 'ثبت لي مهارة للـ PDF' }).extra.includes('extensions'))
  assert.ok(selectProfile({ text: 'install an MCP server for weather' }).extra.includes('extensions'))
})

test('a remote server without required headers is reached through the pinned mcp-remote bridge', async () => {
  const { extensions, calls } = setup()
  const plan = await extensions.planMcp('ai.remote/only')
  assert.equal(plan.status, 'ready'); assert.equal(plan.spec, 'mcp-remote@0.15.1'); assert.deepEqual(plan.args, ['https://mcp.example.com/mcp'])
  // The fake installer writes the weather package; point the plan at it to check the bridge launch line.
  assert.equal(plan.program, 'mcp-remote', 'the bridge program, not its client')
  await extensions.installMcp({ ...plan, packageName: '@acme/weather-mcp', program: 'weather-mcp', version: '1.2.0', integrity: integrity('@acme/weather-mcp1.2.0') })
  assert.ok(calls.run[0][1].includes('mcp-remote@0.15.1'))
  assert.equal(calls.add[0][0].args.at(-1), 'https://mcp.example.com/mcp')
})

test('NAJD-R04/R07: launch arguments are planned, required values stop the install, tags resolve to an exact release', async () => {
  const { extensions } = setup()
  const files = await extensions.planMcp('io.github.acme/files')
  assert.equal(files.status, 'needs_user_input'); assert.deepEqual(files.needs.map(row => row.name), ['root_path'])
  const notes = await extensions.planMcp('io.github.acme/notes')
  assert.equal(notes.status, 'ready'); assert.equal(notes.spec, 'acme-notes@4.5.6', 'a missing version is resolved before approval')
  assert.deepEqual(notes.args, ['--stdio', '--mode', 'readonly'], 'flags and fixed values are passed; an optional value nobody gave is left out')
})

test('NAJD-R07: an installed package that is not the approved release is refused and never registered', async () => {
  const { extensions, calls } = setup()
  const plan = await extensions.planMcp('io.github.acme/weather')
  calls.tamper = true
  await assert.rejects(extensions.installMcp(plan), { code: 'INTEGRITY_MISMATCH' })
  assert.equal(calls.add.length, 0)
})

test('NAJD-R03: cancellation stops before registration, reaches registration and connection, and removes a server cancelled while connecting', async () => {
  const { extensions, calls } = setup()
  const plan = await extensions.planMcp('io.github.acme/weather')
  const before = new AbortController(); before.abort()
  await assert.rejects(extensions.installMcp(plan, before.signal), { code: 'CANCELLED' })
  assert.equal(calls.run.length, 0)
  const during = new AbortController()
  calls.cancelDuringConnect = () => during.abort()
  await assert.rejects(extensions.installMcp(plan, during.signal), { code: 'CANCELLED' })
  assert.equal(calls.add[0][1].signal, during.signal); assert.equal(calls.connect.signal, during.signal)
  assert.equal(calls.removed, 'weather')
})

test('I3-001: two releases of a package never share a folder, and an incomplete folder is redone', async () => {
  const { extensions, calls, root } = setup()
  const plan = await extensions.planMcp('io.github.acme/weather')
  await extensions.installMcp(plan)
  const first = path.dirname(path.dirname(path.dirname(path.dirname(path.dirname(calls.add[0][0].args[0])))))
  assert.ok(fs.existsSync(path.join(first, 'najd-release.json')))
  // Another release (different version and integrity) of the same package gets its own folder.
  const other = { ...plan, version: '1.3.0', spec: '@acme/weather-mcp@1.3.0', integrity: 'sha512-other' }
  await assert.rejects(extensions.installMcp(other), { code: 'INTEGRITY_MISMATCH' })
  const folders = fs.readdirSync(path.join(root, 'npm'))
  assert.equal(folders.length, 2); assert.ok(!fs.existsSync(path.join(root, 'npm', folders.find(name => name !== path.basename(first)), 'najd-release.json')), 'unverified release left incomplete')
  // Re-installing the first release reuses its folder.
  await extensions.installMcp(plan)
  assert.equal(path.dirname(path.dirname(path.dirname(path.dirname(path.dirname(calls.add[1][0].args[0]))))), first)
})

test('I3-002: a skill install cancelled after download is not saved, and enabling stops at a cancel', async () => {
  const fsx = require('node:fs'), osx = require('node:os'), pathx = require('node:path')
  const { createExternalSkills } = require('../electron/external-skills.cjs')
  const library = createExternalSkills({ directory: fsx.mkdtempSync(pathx.join(osx.tmpdir(), 'najd-skills-cancel-')) })
  const controller = new AbortController(); controller.abort()
  await assert.rejects(library.setEnabled('ext-x', true, controller.signal), { code: 'CANCELLED' })
  const live = new AbortController()
  const skills = { install: async () => [{ id: 'ext-a', name: 'a' }, { id: 'ext-b', name: 'b' }], setEnabled: async id => { if (id === 'ext-a') live.abort() } }
  const extensions = createExtensions({ skills, mcpServers: {}, root: osx.tmpdir() })
  const result = await extensions.installSkill('https://github.com/acme/skills', live.signal)
  assert.equal(result.status, 'cancelled'); assert.deepEqual(result.enabled, ['ext-a'])
})

test('R14-002: an npm package with several programs and none named after it is refused before approval', async () => {
  const official = { 'io.modelcontextprotocol.registry/official': { isLatest: true } }
  const servers = [{ server: { name: 'io.x/multi', packages: [{ registryType: 'npm', identifier: 'acme-mcp', version: '2.0.0', transport: { type: 'stdio' } }] }, _meta: official }]
  const fetch2 = async url => ({ ok: true, json: async () => String(url).includes('registry.npmjs.org')
    ? { name: 'acme-mcp', version: '2.0.0', dist: { integrity: integrity('acme-mcp2.0.0') }, bin: { 'acme-admin': 'admin.js', 'acme-server': 'server.js' } }
    : { servers } })
  const extensions = createExtensions({ fetchImpl: fetch2, mcpServers: {}, root: os.tmpdir() })
  const plan = await extensions.planMcp('io.x/multi')
  assert.equal(plan.status, 'unsupported')
})

test('the researched developer pack and connectors are suggested by what a search is about, and install nothing by themselves', () => {
  const { recommendedFor } = require('../electron/extensions.cjs')
  assert.deepEqual(recommendedFor('open github issues', 'mcp').map(item => item.title), ['GitHub'])
  assert.deepEqual(recommendedFor('library documentation for coding', 'mcp').map(item => item.title), ['Context7'])
  const skillPick = recommendedFor('debugging workflow', 'skill').find(item => item.repository === 'https://github.com/obra/superpowers')
  assert.ok(skillPick && !skillPick.url, 'a skill suggestion names its repository, never an install URL for all of it'); assert.match(skillPick.note, /only its folder URL/)
  assert.deepEqual(recommendedFor('weather today', 'mcp'), [])
  for (const item of recommendedFor('github docs browser figma notion devtools', 'mcp')) assert.match(item.note, /search the registry/)
})