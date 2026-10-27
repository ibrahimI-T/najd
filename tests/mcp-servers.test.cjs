const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const { createMcpServers, resolveCommand } = require('../electron/mcp-servers.cjs')
const fixture = path.join(__dirname, 'fixtures', 'mcp-fixture-server.cjs')
const fakeEncryption = { isEncryptionAvailable: () => true, encryptString: text => Buffer.from('enc:' + text), decryptString: buffer => { const text = buffer.toString(); if (!text.startsWith('enc:')) throw new Error('bad'); return text.slice(4) } }

function setup({ confirm = async () => true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'najd-mcp-'))
  const prompts = []
  const servers = createMcpServers({ filePath: path.join(dir, 'mcp-servers.json'), encryption: fakeEncryption, clientVersion: 'test',
    confirm: async details => { prompts.push(details); return confirm(details) }, getBundledNode: () => process.execPath })
  return { dir, servers, prompts }
}

test('adding a server needs the native confirmation; a declined add saves nothing', async () => {
  const { servers, prompts, dir } = setup({ confirm: async () => false })
  assert.deepEqual(await servers.add({ name: 'Fixture', command: 'najd-node', args: [fixture] }), { status: 'cancelled' })
  assert.equal(prompts[0].commandLine, 'NAJD Node ' + (/\s/.test(fixture) ? '"' + fixture + '"' : fixture))
  assert.deepEqual(await servers.list(), [])
  assert.equal(fs.existsSync(path.join(dir, 'mcp-servers.json')), false)
})

test('invalid commands, arguments and environment names are refused before confirmation', async () => {
  const { servers, prompts } = setup()
  await assert.rejects(servers.add({ name: 'x', command: 'definitely-not-a-real-program-najd' }), { code: 'COMMAND_NOT_FOUND' })
  await assert.rejects(servers.add({ name: 'x', command: 'najd-node', args: ['a\nb'] }), { code: 'INVALID_ARGS' })
  await assert.rejects(servers.add({ name: 'x', command: 'najd-node', env: { 'BAD-NAME': 'v' } }), { code: 'INVALID_ENV' })
  await assert.rejects(servers.add({ name: '', command: 'najd-node' }), { code: 'INVALID_NAME' })
  assert.equal(prompts.length, 0)
})

test('a connected server lists paged tools, runs calls, refuses server requests and keeps secrets out of the store', async t => {
  const { servers, dir } = setup()
  const added = await servers.add({ name: 'Fixture Tools', command: 'najd-node', args: [fixture], env: { FIXTURE_TOKEN: 'secret-value' } })
  assert.equal(added.status, 'added'); assert.equal(added.server.id, 'fixture-tools')
  const stored = fs.readFileSync(path.join(dir, 'mcp-servers.json'), 'utf8')
  assert.ok(!stored.includes('secret-value'), 'secret values are stored encrypted only')
  assert.deepEqual(added.server.envNames, ['FIXTURE_TOKEN'])
  t.after(() => servers.stopAll())
  const view = await servers.connect('fixture-tools')
  assert.equal(view.state, 'connected', view.error)
  assert.deepEqual(view.tools.map(tool => tool.name), ['echo', 'add', 'slow', 'broken', 'env'])
  assert.equal(view.tools[0].hints.readOnly, true)
  assert.equal(view.serverInfo.name, 'fixture')
  const echoed = await servers.call('fixture-tools', 'echo', { text: 'hi' })
  assert.deepEqual({ ...echoed, durationMs: 0 }, { isError: false, text: 'echo: hi', truncated: false, durationMs: 0 })
  assert.equal((await servers.call('fixture-tools', 'add', { a: 2, b: 3 })).text, '{"sum":5}')
  assert.equal((await servers.call('fixture-tools', 'broken', {})).isError, true)
  assert.equal((await servers.call('fixture-tools', 'env', {})).text, 'token present')
  await assert.rejects(servers.call('fixture-tools', 'missing', {}), { code: 'UNSUPPORTED_TOOL' })
  const controller = new AbortController()
  const slow = servers.call('fixture-tools', 'slow', {}, { signal: controller.signal })
  setTimeout(() => controller.abort(), 200)
  await assert.rejects(slow, { code: 'CANCELLED' })
  assert.equal((await servers.list())[0].enabled, true, 'a successful connect is remembered for the next start')
  assert.equal((await servers.tools()).length, 5)
  await servers.disconnect('fixture-tools')
  await assert.rejects(servers.call('fixture-tools', 'echo', { text: 'x' }), { code: 'NOT_CONNECTED' })
  assert.equal((await servers.list())[0].enabled, false)
  assert.equal((await servers.remove('fixture-tools')).status, 'removed')
  assert.ok(!fs.readFileSync(path.join(dir, 'mcp-servers.json'), 'utf8').includes('enc:'))
})

test('a server that cannot start reports a failed state instead of hanging', async () => {
  const { servers } = setup()
  await servers.add({ name: 'Exits', command: 'najd-node', args: ['-e', 'process.exit(3)'] })
  const view = await servers.connect('exits')
  assert.equal(view.state, 'failed'); assert.ok(['SERVER_EXITED', 'START_FAILED'].includes(view.error))
})

test('bare program names resolve through PATH like a terminal', () => {
  const found = resolveCommand('cmd', process.env.PATH)
  assert.match(found, /cmd\.exe$/i)
  assert.equal(resolveCommand('..\\evil'), null)
})

test('server-to-client requests (roots, sampling) are refused with method-not-found', async t => {
  const { createMcpClient } = require('../electron/mcp-client.cjs')
  const client = createMcpClient({ command: process.execPath, args: [fixture], env: process.env })
  t.after(() => client.stop())
  await client.start()
  for (let i = 0; i < 50 && !client.stderr().includes('roots/list'); i++) await new Promise(r => setTimeout(r, 20))
  assert.match(client.stderr(), /roots\/list answered with error -32601/)
})
