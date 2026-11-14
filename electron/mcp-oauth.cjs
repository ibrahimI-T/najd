// Signing in to a remote MCP server with OAuth (R-080), as the MCP authorization specification (2025-11-25) describes for a native
// client: the protected-resource metadata (RFC 9728, from the 401's WWW-Authenticate resource_metadata or the well-known paths), the
// authorization server's metadata (RFC 8414 and OpenID discovery, path-insertion order), dynamic client registration (RFC 7591) as a
// public client with a loopback redirect, PKCE S256 (refused when the server does not list it), state, the resource parameter
// (RFC 8707) on authorization and token requests, refresh, and nothing but https outside this computer. The owner signs in on the
// service's own page in their browser; NAJD never sees the password. Tokens are returned to the caller, which stores them encrypted
// and sends them only to the server they were issued for.
const http = require('node:http')
const { createHash, randomBytes } = require('node:crypto')

const fail = (code, detail) => Object.assign(new Error(code), { code }, detail ? { detail } : {})
const b64url = buffer => buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]'])

// https everywhere, plain http only for a server on this computer (local development and the test fixture).
function safeUrl(value) {
  let url
  try { url = new URL(value) } catch { throw fail('OAUTH_INVALID_URL') }
  if (url.username || url.password || url.hash || !(url.protocol === 'https:' || (url.protocol === 'http:' && LOOPBACK.has(url.hostname)))) throw fail('OAUTH_INVALID_URL')
  return url
}
// The canonical resource identifier: the MCP URL without fragment and without a trailing slash.
const canonical = value => { const url = safeUrl(value); url.hash = ''; return url.href.replace(/\/$/, '') }

// WWW-Authenticate: Bearer resource_metadata="…", scope="…", error="…"
function parseChallenge(header) {
  const out = {}
  for (const match of String(header || '').matchAll(/([a-zA-Z_]+)="([^"]*)"/g)) out[match[1]] = match[2]
  return out
}

function createMcpOAuth({ fetchImpl = globalThis.fetch, openExternal, clientName = 'NAJD AGENT', timeoutMs = 5 * 60 * 1000 }) {
  if (typeof openExternal !== 'function') throw fail('INVALID_INPUT')
  async function json(url, init = {}) {
    const response = await fetchImpl(url, { ...init, redirect: 'error', signal: init.signal || AbortSignal.timeout(20000), headers: { accept: 'application/json', ...(init.headers || {}) } })
    if (!response.ok) throw fail('OAUTH_HTTP_' + response.status, (await response.text().catch(() => '')).slice(0, 300))
    return response.json()
  }
  async function firstJson(urls) { for (const url of urls) { try { return await json(url) } catch {} } return null }

  async function discover(serverUrl, challengeHeader = '') {
    const server = safeUrl(serverUrl), challenge = parseChallenge(challengeHeader)
    const resourceMeta = challenge.resource_metadata ? await json(safeUrl(challenge.resource_metadata).href)
      : await firstJson([new URL('/.well-known/oauth-protected-resource' + (server.pathname === '/' ? '' : server.pathname), server.origin).href, new URL('/.well-known/oauth-protected-resource', server.origin).href])
    const issuer = resourceMeta?.authorization_servers?.[0]
    if (!issuer) throw fail('OAUTH_NOT_SUPPORTED')
    const as = safeUrl(issuer), tail = as.pathname === '/' ? '' : as.pathname.replace(/\/$/, '')
    const metadata = await firstJson(tail
      ? [new URL('/.well-known/oauth-authorization-server' + tail, as.origin).href, new URL('/.well-known/openid-configuration' + tail, as.origin).href, new URL(tail + '/.well-known/openid-configuration', as.origin).href]
      : [new URL('/.well-known/oauth-authorization-server', as.origin).href, new URL('/.well-known/openid-configuration', as.origin).href])
    if (!metadata?.authorization_endpoint || !metadata.token_endpoint) throw fail('OAUTH_NOT_SUPPORTED')
    // PKCE S256 is required; a server that does not say it supports it is refused.
    if (!Array.isArray(metadata.code_challenge_methods_supported) || !metadata.code_challenge_methods_supported.includes('S256')) throw fail('OAUTH_PKCE_UNSUPPORTED')
    for (const key of ['authorization_endpoint', 'token_endpoint', 'registration_endpoint']) if (metadata[key]) safeUrl(metadata[key])
    const scope = challenge.scope || (Array.isArray(resourceMeta.scopes_supported) ? resourceMeta.scopes_supported.join(' ') : Array.isArray(metadata.scopes_supported) ? metadata.scopes_supported.join(' ') : '')
    return { resource: canonical(resourceMeta.resource || serverUrl), metadata, scope }
  }

  // A one-shot loopback listener for the redirect; it answers the browser with a short page and closes.
  function listen() {
    return new Promise((resolve, reject) => {
      let settle
      const result = new Promise((done, failed) => { settle = { done, failed } })
      const server = http.createServer((request, response) => {
        const url = new URL(request.url, 'http://127.0.0.1')
        if (url.pathname !== '/callback') { response.writeHead(404).end(); return }
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end('<!doctype html><meta charset="utf-8"><title>NAJD</title><body style="font-family:sans-serif;padding:2em">تم تسجيل الدخول. يمكنك إغلاق هذه الصفحة والعودة إلى نجد.<br>Signed in. You can close this page and return to NAJD.</body>')
        settle.done(Object.fromEntries(url.searchParams))
      })
      server.on('error', reject)
      server.listen(0, '127.0.0.1', () => resolve({ redirectUri: `http://127.0.0.1:${server.address().port}/callback`, result, close: () => server.close() }))
    })
  }

  async function token(metadata, params, signal) {
    const body = new URLSearchParams(params)
    const value = await json(metadata.token_endpoint, { method: 'POST', signal, headers: { 'content-type': 'application/x-www-form-urlencoded' }, body })
    if (typeof value.access_token !== 'string' || !value.access_token) throw fail('OAUTH_NO_TOKEN')
    return value
  }
  const pack = (value, base) => ({ ...base, access_token: value.access_token, refresh_token: value.refresh_token || base.refresh_token || null,
    expires_at: Number.isFinite(value.expires_in) ? Date.now() + value.expires_in * 1000 : null, scope: value.scope || base.scope || '' })

  return {
    parseChallenge,
    discover,
    // Discovery, registration, the owner's sign-in in their browser, and the token exchange. Returns what the caller stores.
    async signIn(serverUrl, { challenge = '', signal } = {}) {
      const { resource, metadata, scope } = await discover(serverUrl, challenge)
      const loop = await listen()
      try {
        let clientId
        if (metadata.registration_endpoint) {
          const registered = await json(metadata.registration_endpoint, { method: 'POST', signal, headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ client_name: clientName, redirect_uris: [loop.redirectUri], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' }) })
          clientId = registered.client_id
        }
        if (typeof clientId !== 'string' || !clientId) throw fail('OAUTH_REGISTRATION_UNAVAILABLE')
        const verifier = b64url(randomBytes(48)), state = b64url(randomBytes(24))
        const challengeCode = b64url(createHash('sha256').update(verifier).digest())
        const authorize = new URL(metadata.authorization_endpoint)
        for (const [key, value] of Object.entries({ response_type: 'code', client_id: clientId, redirect_uri: loop.redirectUri, code_challenge: challengeCode, code_challenge_method: 'S256', state, resource, ...(scope ? { scope } : {}) })) authorize.searchParams.set(key, value)
        await openExternal(authorize.href)
        const timer = new Promise((_, reject) => { const id = setTimeout(() => reject(fail('OAUTH_TIMEOUT')), timeoutMs); id.unref?.(); signal?.addEventListener('abort', () => { clearTimeout(id); reject(fail('CANCELLED')) }, { once: true }) })
        const answer = await Promise.race([loop.result, timer])
        if (answer.state !== state) throw fail('OAUTH_STATE_MISMATCH')
        if (answer.error) throw fail('OAUTH_DENIED', String(answer.error_description || answer.error).slice(0, 200))
        if (!answer.code) throw fail('OAUTH_NO_CODE')
        const value = await token(metadata, { grant_type: 'authorization_code', code: answer.code, code_verifier: verifier, redirect_uri: loop.redirectUri, client_id: clientId, resource }, signal)
        return pack(value, { resource, client_id: clientId, token_endpoint: metadata.token_endpoint, issuer: metadata.issuer || null })
      } finally { loop.close() }
    },
    // A new access token from the refresh token (the server may rotate the refresh token).
    async refresh(stored, { signal } = {}) {
      if (!stored?.refresh_token || !stored.token_endpoint || !stored.client_id) throw fail('OAUTH_REFRESH_UNAVAILABLE')
      safeUrl(stored.token_endpoint)
      const value = await token({ token_endpoint: stored.token_endpoint }, { grant_type: 'refresh_token', refresh_token: stored.refresh_token, client_id: stored.client_id, resource: stored.resource }, signal)
      return pack(value, stored)
    }
  }
}

module.exports = { createMcpOAuth, parseChallenge, canonical }
