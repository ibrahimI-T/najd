// A local MCP server protected by OAuth, following the MCP authorization specification (R-080): used by tests/mcp-oauth.test.cjs and
// the feature-flow smoke. It answers 401 with resource_metadata, serves protected-resource and authorization-server metadata, registers
// clients, checks PKCE S256, state, redirect and resource on authorization, and issues and refreshes tokens.
const assert = require('node:assert/strict')
const http = require('node:http')
const { createHash } = require('node:crypto')
const b64url = buffer => buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

async function fixture({ s256 = true } = {}) {
  const state = { clients: new Map(), codes: new Map(), valid: new Set(), issued: 0, refreshed: 0, authorizeQuery: null }
  let base
  const send = (response, status, body, headers = {}) => { response.writeHead(status, { 'content-type': 'application/json', ...headers }); response.end(body === undefined ? '' : JSON.stringify(body)) }
  const read = request => new Promise(resolve => { let text = ''; request.on('data', chunk => { text += chunk }); request.on('end', () => resolve(text)) })
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, base)
    if (url.pathname === '/mcp' && request.method === 'POST') {
      const auth = request.headers.authorization || ''
      if (!state.valid.has(auth.replace(/^Bearer /, ''))) return send(response, 401, { error: 'unauthorized' }, { 'www-authenticate': `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/mcp", scope="tools.read"` })
      const body = JSON.parse(await read(request))
      if (!body.id) return send(response, 202)
      const result = body.method === 'initialize' ? { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'oauth-fixture' } }
        : body.method === 'tools/list' ? { tools: [{ name: 'whoami', description: 'Who is signed in', inputSchema: { type: 'object' } }] }
        : { content: [{ type: 'text', text: 'signed in as fixture-user with ' + auth.replace(/^Bearer /, '') }] }
      return send(response, 200, { jsonrpc: '2.0', id: body.id, result })
    }
    if (url.pathname === '/.well-known/oauth-protected-resource/mcp') return send(response, 200, { resource: base + '/mcp', authorization_servers: [base + '/as'], scopes_supported: ['tools.read'] })
    if (url.pathname === '/.well-known/oauth-authorization-server/as') return send(response, 200, { issuer: base + '/as', authorization_endpoint: base + '/as/authorize', token_endpoint: base + '/as/token', registration_endpoint: base + '/as/register', ...(s256 ? { code_challenge_methods_supported: ['S256'] } : {}) })
    if (url.pathname === '/as/register' && request.method === 'POST') {
      const body = JSON.parse(await read(request))
      assert.equal(body.token_endpoint_auth_method, 'none'); assert.match(body.redirect_uris[0], /^http:\/\/127\.0\.0\.1:\d+\/callback$/)
      const id = 'client-' + (state.clients.size + 1); state.clients.set(id, body.redirect_uris)
      return send(response, 201, { client_id: id, redirect_uris: body.redirect_uris })
    }
    if (url.pathname === '/as/authorize') {
      const q = Object.fromEntries(url.searchParams); state.authorizeQuery = q
      const ok = state.clients.get(q.client_id)?.includes(q.redirect_uri) && q.code_challenge_method === 'S256' && q.code_challenge && q.state && q.resource === base + '/mcp' && q.response_type === 'code'
      if (!ok) return send(response, 400, { error: 'invalid_request' })
      const code = 'code-' + Math.random().toString(36).slice(2); state.codes.set(code, q)
      response.writeHead(302, { location: `${q.redirect_uri}?code=${code}&state=${encodeURIComponent(q.state)}` }); return response.end()
    }
    if (url.pathname === '/as/token' && request.method === 'POST') {
      const q = Object.fromEntries(new URLSearchParams(await read(request)))
      if (q.resource !== base + '/mcp') return send(response, 400, { error: 'invalid_target' })
      if (q.grant_type === 'authorization_code') {
        const saved = state.codes.get(q.code); state.codes.delete(q.code)
        if (!saved || saved.redirect_uri !== q.redirect_uri || saved.client_id !== q.client_id || b64url(createHash('sha256').update(q.code_verifier || '').digest()) !== saved.code_challenge) return send(response, 400, { error: 'invalid_grant' })
        const token = 'AT-' + (++state.issued); state.valid.add(token)
        return send(response, 200, { access_token: token, token_type: 'Bearer', expires_in: 1, refresh_token: 'RT-' + state.issued })
      }
      if (q.grant_type === 'refresh_token' && /^RT-/.test(q.refresh_token)) { state.refreshed++; const token = 'AT-' + (++state.issued); state.valid.add(token); return send(response, 200, { access_token: token, token_type: 'Bearer', expires_in: 3600, refresh_token: 'RT-' + state.issued }) }
      return send(response, 400, { error: 'unsupported_grant_type' })
    }
    send(response, 404, { error: 'not_found' })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${server.address().port}`
  return { base, state, close: () => new Promise(resolve => server.close(resolve)) }
}

module.exports = { fixture }
