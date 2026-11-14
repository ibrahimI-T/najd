// MCP servers declared by packages: remote and stdio, owner decision 2026-11-13 (every kind allowed, never started without the
// owner pressing the button and confirming the exact command in NAJD's native dialog).
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { mcpDeclarations, declarationLine, connectPackageServer, reconcilePackageServers } = require('../electron/workstation/mcp-declarations.cjs')

test('stdio declarations keep the command, arguments and variable NAMES only; remote ones stay public https addresses', () => {
  const declared = mcpDeclarations({
    docs: { command: 'npx', args: ['-y', '@acme/docs', '--folder', 'C:\\My Docs'], env: { API_KEY: 'secret-value', 'bad name': 'x' } },
    web: { url: 'https://example.com/mcp' },
    'bad name!': { command: 'npx' },
    query: { url: 'https://example.com/mcp?token=abc' },
    plain: { url: 'http://example.com/mcp' },
    empty: { command: '   ' }
  })
  assert.deepEqual(declared.map(item => item.name), ['docs', 'web'])
  assert.deepEqual(declared[0], { name: 'docs', kind: 'stdio', command: 'npx', args: ['-y', '@acme/docs', '--folder', 'C:\\My Docs'], envNames: ['API_KEY'] })
  assert.deepEqual(declared[1], { name: 'web', url: 'https://example.com/mcp' })
  assert.equal(JSON.stringify(declared).includes('secret-value'), false, 'a variable value never survives')
  assert.equal(declarationLine(declared[0]), 'npx -y @acme/docs --folder "C:\\My Docs"')
  assert.equal(mcpDeclarations(null).length, 0)
})

test('declarations are bounded: thirty servers, thirty arguments, long text clipped', () => {
  const many = Object.fromEntries(Array.from({ length: 40 }, (_, index) => ['s' + index, { command: 'x'.repeat(500), args: Array.from({ length: 50 }, () => 'y'.repeat(500)) }]))
  const declared = mcpDeclarations(many)
  assert.equal(declared.length, 32)
  assert.equal(declared[0].command.length, 200); assert.equal(declared[0].args.length, 30); assert.equal(declared[0].args[0].length, 300)
})

const fakeServers = (initial = []) => {
  const rows = [...initial], calls = []
  return { calls, rows, list: async () => rows.map(row => ({ ...row })),
    add: async (input, options) => { calls.push(['add', input, options]); if (options.cancel) return { status: 'cancelled' }; const row = { id: 'srv-' + (rows.length + 1), name: input.name, ownerPackage: options.ownerPackage, commandLine: input.url || input.command }; rows.push(row); return { status: 'added', server: row } },
    connect: async id => { calls.push(['connect', id]); return { id, state: 'connected' } },
    remove: async id => { calls.push(['remove', id]); rows.splice(rows.findIndex(row => row.id === id), 1) } }
}
const pack = { id: 'acme', enabled: true, mcpServers: [{ name: 'docs', kind: 'stdio', command: 'npx', args: ['-y', '@acme/docs'], envNames: ['API_KEY'] }, { name: 'web', url: 'https://example.com/mcp' }] }

test('adding a declared command goes through add() without approvedInChat, owned by the package, with no variable values, then connects', async () => {
  const servers = fakeServers()
  const result = await connectPackageServer({ pack, name: 'docs', token: 'ignored-for-commands', servers })
  assert.equal(result.state, 'connected')
  const [, input, options] = servers.calls[0]
  assert.deepEqual(input, { name: 'docs', command: 'npx', args: ['-y', '@acme/docs'], env: {} })
  assert.equal(options.ownerPackage, 'acme'); assert.equal(options.approvedInChat, undefined, 'the native confirmation is not skipped')
  assert.equal(JSON.stringify(servers.calls).includes('ignored-for-commands'), false)
})

test('a declined confirmation connects nothing; an already added command is only connected; a disabled package refuses', async () => {
  const declined = fakeServers(); const realAdd = declined.add
  declined.add = (input, options) => realAdd(input, { ...options, cancel: true })
  assert.equal((await connectPackageServer({ pack, name: 'docs', servers: declined })).status, 'cancelled')
  assert.equal(declined.calls.some(call => call[0] === 'connect'), false)
  const added = fakeServers([{ id: 'srv-1', name: 'docs', ownerPackage: 'acme', commandLine: 'npx -y @acme/docs' }])
  await connectPackageServer({ pack, name: 'docs', servers: added })
  assert.deepEqual(added.calls, [['connect', 'srv-1']])
  await assert.rejects(connectPackageServer({ pack: { ...pack, enabled: false }, name: 'docs', servers: fakeServers() }), { code: 'PACKAGE_NOT_READY' })
  await assert.rejects(connectPackageServer({ pack, name: 'nothing', servers: fakeServers() }), { code: 'PACKAGE_NOT_READY' })
})

test('a remote declaration keeps its token flow: the token is passed as MCP_TOKEN and replaces the owned row', async () => {
  const servers = fakeServers([{ id: 'srv-1', name: 'web', ownerPackage: 'acme', commandLine: 'https://example.com/mcp' }])
  await connectPackageServer({ pack, name: 'web', token: '  tok-123  ', servers })
  assert.deepEqual(servers.calls.map(call => call[0]), ['remove', 'add', 'connect'])
  assert.deepEqual(servers.calls[1][1], { name: 'web', url: 'https://example.com/mcp', env: { MCP_TOKEN: 'tok-123' } })
})

test('after an update, owned servers the package no longer declares are removed; declared and manual ones stay', async () => {
  const servers = fakeServers([
    { id: 'a', name: 'docs', ownerPackage: 'acme', commandLine: 'npx -y @acme/docs' },
    { id: 'b', name: 'web', ownerPackage: 'acme', commandLine: 'https://example.com/mcp' },
    { id: 'c', name: 'old', ownerPackage: 'acme', commandLine: 'node old.js' },
    { id: 'd', name: 'mine', ownerPackage: null, commandLine: 'node mine.js' }
  ])
  await reconcilePackageServers({ pack, servers })
  assert.deepEqual(servers.rows.map(row => row.id), ['a', 'b', 'd'])
})
