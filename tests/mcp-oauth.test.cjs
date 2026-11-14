// MCP OAuth sign-in end to end against a local fixture that follows the MCP authorization specification (R-080): a protected MCP
// endpoint answering 401 with resource_metadata, protected-resource and authorization-server metadata, dynamic client registration,
// an authorization endpoint that checks PKCE S256, state, redirect and resource and redirects to NAJD's loopback, a token endpoint with
// refresh. NAJD connects only after signing in, refreshes an expiring token, keeps tokens sealed, and refuses a server without S256.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const { createMcpOAuth } = require('../electron/mcp-oauth.cjs')
const { createMcpServers } = require('../electron/mcp-servers.cjs')
const { fixture } = require('./fixtures/mcp-oauth-fixture.cjs')

const encryption = { isEncryptionAvailable: () => true, encryptString: text => Buffer.from('enc:' + Buffer.from(text).toString('base64')), decryptString: buffer => Buffer.from(buffer.toString().slice(4), 'base64').toString() }

// The owner's browser: follows the authorization page's redirect to NAJD's loopback page.
const browser = async url => { const step = await fetch(url, { redirect: 'manual' }); assert.equal(step.status, 302, 'the authorization page redirects'); await fetch(step.headers.get('location')) }

test('a remote MCP server: 401, sign-in with PKCE and resource, connected, token refreshed, tokens sealed (R-080)', async () => {
  const fx = await fixture()
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'najd-mcp-oauth-'))
  const servers = createMcpServers({ filePath: path.join(dir, 'mcp-servers.json'), encryption, confirm: async () => true, oauth: createMcpOAuth({ openExternal: browser }) })
  try {
    const added = await servers.add({ name: 'oauth-fixture', url: fx.base + '/mcp' })
    const before = await servers.connect(added.server.id)
    assert.equal(before.state, 'failed'); assert.equal(before.error, 'AUTH_REQUIRED'); assert.equal(before.remote, true)
    const after = await servers.signIn(added.server.id)
    assert.equal(after.state, 'connected', JSON.stringify(after)); assert.deepEqual(after.tools.map(tool => tool.name), ['whoami'])
    assert.equal(fx.state.authorizeQuery.scope, 'tools.read', 'the challenge scope is requested')
    // The first token expires in a second: the next request refreshes it first.
    await new Promise(resolve => setTimeout(resolve, 1100))
    const call = await servers.call(added.server.id, 'whoami', {})
    assert.match(call.text, /signed in as fixture-user with AT-2/); assert.equal(fx.state.refreshed, 1)
    const disk = fs.readFileSync(path.join(dir, 'mcp-servers.json'), 'utf8')
    assert.equal(/AT-\d|RT-\d/.test(disk), false, 'no token in clear on disk')
  } finally { servers.stopAll(); await fx.close() }
})

test('sign-in is refused when the server does not support PKCE S256, and a wrong state is rejected', async () => {
  const fx = await fixture({ s256: false })
  try {
    await assert.rejects(createMcpOAuth({ openExternal: browser }).signIn(fx.base + '/mcp'), { code: 'OAUTH_PKCE_UNSUPPORTED' })
  } finally { await fx.close() }
  const ok = await fixture()
  try {
    const forged = async url => { const step = await fetch(url, { redirect: 'manual' }); const location = new URL(step.headers.get('location')); location.searchParams.set('state', 'forged'); await fetch(location) }
    await assert.rejects(createMcpOAuth({ openExternal: forged }).signIn(ok.base + '/mcp'), { code: 'OAUTH_STATE_MISMATCH' })
    await assert.rejects(createMcpOAuth({ openExternal: browser }).signIn('http://example.com/mcp'), { code: 'OAUTH_INVALID_URL' })
  } finally { await ok.close() }
})
