const http = require('node:http')
const { randomBytes, randomUUID, createHash, createPublicKey, verify, timingSafeEqual } = require('node:crypto')
const { providerError, jsonRequest } = require('./provider-http.cjs')
const ISSUER = 'https://auth.openai.com'
const RESOURCE = 'https://api.openai.com/v1'
const SCOPE = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct'

function equal(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false
  const a = Buffer.from(left), b = Buffer.from(right)
  return a.length === b.length && timingSafeEqual(a, b)
}

function validateIdToken(token, jwks, { clientId, nonce, subject, now = Date.now() }) {
  try {
    if (typeof token !== 'string' || token.length > 32768 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) throw new Error()
    const [headerPart, claimsPart, signaturePart] = token.split('.')
    const header = JSON.parse(Buffer.from(headerPart, 'base64url').toString('utf8'))
    const claims = JSON.parse(Buffer.from(claimsPart, 'base64url').toString('utf8'))
    if (header.alg !== 'RS256' || typeof header.kid !== 'string' || header.crit) throw new Error()
    if (!Array.isArray(jwks?.keys) || jwks.keys.length > 100) throw new Error()
    const key = jwks.keys.find(k => k.kid === header.kid && k.kty === 'RSA' && (!k.use || k.use === 'sig') && (!k.alg || k.alg === 'RS256'))
    if (!key || !verify('RSA-SHA256', Buffer.from(`${headerPart}.${claimsPart}`), createPublicKey({ key, format: 'jwk' }), Buffer.from(signaturePart, 'base64url'))) throw new Error()
    const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud]
    if (claims.iss !== ISSUER || !audience.includes(clientId) ||
        ((audience.length > 1 || claims.azp !== undefined) && claims.azp !== clientId) ||
        !Number.isFinite(claims.exp) || claims.exp * 1000 <= now ||
        (claims.nbf !== undefined && (!Number.isFinite(claims.nbf) || claims.nbf * 1000 > now + 60000)) ||
        (claims.iat !== undefined && (!Number.isFinite(claims.iat) || claims.iat * 1000 > now + 60000)) ||
        typeof claims.sub !== 'string' || !claims.sub || claims.sub.length > 512 ||
        (nonce !== undefined && !equal(claims.nonce, nonce)) || (subject !== undefined && !equal(claims.sub, subject))) throw new Error()
    return { subject: claims.sub, email: typeof claims.email === 'string' && claims.email.length <= 320 && claims.email_verified !== false ? claims.email : '' }
  } catch { throw providerError('AUTH_INVALID_RESPONSE') }
}

function normalizeTokens(data, previous) {
  const scopes = typeof data?.scope === 'string' ? data.scope.split(/\s+/).filter(Boolean) : previous?.scopes
  if (!Array.isArray(scopes) || !scopes.includes('chatgpt.tokens.use.direct') || !scopes.includes('resource.invoke')) throw providerError('PLAN_NOT_ENABLED')
  const refreshToken = data.refresh_token || previous?.refreshToken
  const idToken = data.id_token || previous?.idToken
  if (typeof data.token_type !== 'string' || data.token_type.toLowerCase() !== 'bearer' || typeof data.access_token !== 'string' || !data.access_token ||
      typeof refreshToken !== 'string' || !refreshToken || typeof idToken !== 'string' || !idToken ||
      [data.access_token, refreshToken, idToken].some(value => value.length > 32768 || /[\r\n]/.test(value)) ||
      !Number.isFinite(data.expires_in) || data.expires_in < 1 || data.expires_in > 604800) throw providerError('AUTH_INVALID_RESPONSE')
  return { accessToken: data.access_token, refreshToken, idToken, scopes, expiresAt: Date.now() + data.expires_in * 1000 }
}

function createChatGPTAuth({ store, inference, openBrowser, fetchImpl = fetch, callbackTimeoutMs = 300000 }) {
  let pending = null
  let errorCode = null
  let revocationConfirmed = null
  let startPromise = null
  let generation = 0
  const refreshes = new Map()
  const requests = new Set()

  async function status() {
    const data = await store.read()
    const active = data.accounts.find(a => a.id === data.activeId)
    return { signingIn: !!pending, activeId: data.activeId, signedIn: !!active?.tokens,
      verified: !!active?.tokens && active.tokens.expiresAt > Date.now() && !!active.verifiedModel, verifiedModel: active?.tokens ? active.verifiedModel || null : null,
      accounts: data.accounts.map(a => ({ id: a.id, label: a.label, signedIn: !!a.tokens })), errorCode, revocationConfirmed }
  }

  function closeAttempt(attempt) {
    clearTimeout(attempt.timer)
    attempt.server?.close()
    attempt.server?.closeIdleConnections()
  }

  function cancelSignIn() {
    generation++
    if (pending) {
      pending.controller.abort()
      closeAttempt(pending)
      pending = null
    }
    errorCode = null
  }

  function stopRequests() { for (const controller of requests) controller.abort() }
  async function postToken(parameters, signal) {
    return jsonRequest(fetchImpl, `${ISSUER}/api/accounts/oauth/token`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ ...parameters, resource: RESOURCE }).toString()
    }, signal)
  }

  async function finish(attempt, params) {
    try {
      if (params.get('error')) throw providerError(params.get('error') === 'access_denied' ? 'AUTH_DENIED' : 'AUTH_INVALID_RESPONSE')
      const issued = params.get('client_id') || attempt.account?.clientId
      if (!issued || !/^[A-Za-z0-9_-]{5,256}$/.test(issued) || issued === 'dynamic_agent_client' ||
          (attempt.account && issued !== attempt.account.clientId) || !params.get('code') || params.get('code').length > 4096) throw providerError('AUTH_INVALID_RESPONSE')
      const data = await postToken({ grant_type: 'authorization_code', client_id: issued, code: params.get('code'),
        code_verifier: attempt.verifier, redirect_uri: attempt.redirect }, attempt.controller.signal)
      const tokens = normalizeTokens(data)
      const jwks = await jsonRequest(fetchImpl, `${ISSUER}/.well-known/jwks.json`, {}, attempt.controller.signal)
      const identity = validateIdToken(tokens.idToken, jwks, { clientId: issued, nonce: attempt.nonce, subject: attempt.account?.subject })
      if (pending !== attempt || attempt.controller.signal.aborted) return
      stopRequests()
      await store.update(next => {
        if (pending !== attempt || attempt.controller.signal.aborted) throw providerError('CANCELLED')
        let account = attempt.account ? next.accounts.find(a => a.id === attempt.account.id) :
          next.accounts.find(a => a.clientId === issued && a.subject === identity.subject)
        if (!account) {
          account = { id: randomUUID(), clientId: issued, subject: identity.subject,
            label: `${identity.email || 'ChatGPT'} · ${issued.slice(-6)}`, tokens: null }
          next.accounts.push(account)
        }
        account.tokens = tokens
        account.verifiedModel = null
        next.activeId = account.id
      }, { signal: attempt.controller.signal })
      if (pending === attempt) { pending = null; errorCode = null; revocationConfirmed = null }
    } catch (error) {
      if (pending === attempt) { pending = null; errorCode = error?.code || 'PROVIDER_ERROR' }
    } finally { closeAttempt(attempt) }
  }

  async function begin(accountId = null) {
    if (pending) return status()
    const initialGeneration = generation
    if (accountId !== null && typeof accountId !== 'string') throw providerError('INVALID_INPUT')
    let saved
    try { saved = await store.update(() => {}) } // Persist the host before authorization.
    catch (error) {
      // A record left undecryptable by a lost OS key blocks sign-in; move it aside and start fresh.
      if (error?.code !== 'CREDENTIAL_UNAVAILABLE' || typeof store.reset !== 'function') throw error
      saved = await store.reset()
    }
    if (generation !== initialGeneration) throw providerError('CANCELLED')
    const account = accountId === null ? null : saved.accounts.find(a => a.id === accountId)
    if (accountId !== null && !account) throw providerError('NOT_FOUND')
    if (!account && saved.accounts.length >= 10) throw providerError('AUTH_ACCOUNT_LIMIT')
    const attempt = { account, state: randomBytes(32).toString('base64url'), nonce: randomBytes(32).toString('base64url'),
      verifier: randomBytes(32).toString('base64url'), controller: new AbortController(), processing: false }
    pending = attempt
    errorCode = null
    attempt.server = http.createServer((request, response) => {
      response.setHeader('Cache-Control', 'no-store')
      response.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'")
      response.setHeader('Content-Type', 'text/plain; charset=utf-8')
      let url
      try { url = new URL(request.url, attempt.redirect) } catch { response.writeHead(400); response.end(); return }
      if (request.method !== 'GET' || request.headers.host !== `127.0.0.1:${attempt.server.address()?.port}` ||
          url.pathname !== '/auth/callback' || request.url.length > 8192) { response.writeHead(404); response.end(); return }
      if (pending !== attempt || attempt.processing || ['state', 'code', 'client_id', 'error'].some(key => url.searchParams.getAll(key).length > 1) ||
          !equal(url.searchParams.get('state'), attempt.state)) { response.writeHead(400); response.end('Invalid sign-in callback.'); return }
      attempt.processing = true
      response.end('Return to NAJD AGENT to finish.\nارجع إلى نجد لإكمال الربط.')
      void finish(attempt, url.searchParams)
    })
    try {
      await new Promise((resolve, reject) => {
        attempt.server.once('error', reject)
        attempt.server.listen(0, '127.0.0.1', resolve)
      })
      if (pending !== attempt) throw providerError('CANCELLED')
      attempt.redirect = `http://127.0.0.1:${attempt.server.address().port}/auth/callback`
      attempt.timer = setTimeout(() => {
        if (pending !== attempt) return
        cancelSignIn()
        errorCode = 'AUTH_TIMEOUT'
      }, callbackTimeoutMs)
      attempt.timer.unref()
      const url = new URL(`${ISSUER}/api/accounts/authorize`)
      const parameters = { client_id: account?.clientId || 'dynamic_agent_client', ext_agent_host_id: saved.hostId,
        response_type: 'code', redirect_uri: attempt.redirect, scope: SCOPE, resource: RESOURCE, state: attempt.state,
        nonce: attempt.nonce, code_challenge_method: 'S256', code_challenge: createHash('sha256').update(attempt.verifier).digest('base64url') }
      if (!account) parameters.agent_name_hint = 'NAJD AGENT'
      else if (account.tokens?.idToken) parameters.id_token_hint = account.tokens.idToken
      for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, value)
      await openBrowser(url.toString())
      return status()
    } catch (error) {
      if (pending === attempt) cancelSignIn()
      throw providerError(error?.code === 'CREDENTIAL_UNAVAILABLE' ? error.code : 'PROVIDER_ERROR')
    }
  }

  function start(accountId = null) {
    if (!startPromise) {
      const work = begin(accountId)
      startPromise = work
      void work.finally(() => { if (startPromise === work) startPromise = null }).catch(() => {})
    }
    return startPromise
  }

  async function select(accountId) {
    const data = await store.read()
    if (typeof accountId !== 'string' || !data.accounts.some(a => a.id === accountId)) throw providerError('NOT_FOUND')
    cancelSignIn()
    stopRequests()
    await store.update(next => { next.activeId = accountId })
    return status()
  }

  async function access(account, signal) {
    if (!account?.tokens) throw providerError('AUTH_REQUIRED')
    if (account.tokens.expiresAt > Date.now() + 60000) return account.tokens.accessToken
    if (!refreshes.has(account.id)) {
      const work = (async () => {
        const current = (await store.read()).accounts.find(a => a.id === account.id)
        if (!current?.tokens) throw providerError('AUTH_REQUIRED')
        if (current.tokens.expiresAt > Date.now() + 60000) return current.tokens.accessToken
        const data = await postToken({ grant_type: 'refresh_token', client_id: current.clientId, refresh_token: current.tokens.refreshToken }, signal)
        const tokens = normalizeTokens(data, current.tokens)
        if (data.id_token) {
          const jwks = await jsonRequest(fetchImpl, `${ISSUER}/.well-known/jwks.json`, {}, signal)
          validateIdToken(data.id_token, jwks, { clientId: current.clientId, subject: current.subject })
        }
        await store.update(next => {
          const target = next.accounts.find(a => a.id === current.id)
          if (!target?.tokens || target.tokens.refreshToken !== current.tokens.refreshToken || signal?.aborted) throw providerError('AUTH_REQUIRED')
          target.tokens = tokens
        }, { signal })
        return tokens.accessToken
      })()
      refreshes.set(account.id, work)
      void work.finally(() => { refreshes.delete(account.id) }).catch(() => {})
    }
    return refreshes.get(account.id)
  }

  async function withAccount(operation, signal) {
    const controller = new AbortController()
    requests.add(controller)
    const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal
    try {
      const data = await store.read()
      const account = data.accounts.find(a => a.id === data.activeId)
      const token = await access(account, combined)
      if (combined.aborted) throw providerError('CANCELLED')
      return await operation(token, combined, account)
    } finally { requests.delete(controller) }
  }

  async function signOut(accountId) {
    cancelSignIn()
    stopRequests()
    const account = (await store.read()).accounts.find(a => a.id === accountId)
    if (!account) throw providerError('NOT_FOUND')
    revocationConfirmed = !account.tokens
    if (account.tokens) {
      try {
        const response = await fetchImpl(`${ISSUER}/api/accounts/oauth/revoke`, { method: 'POST', redirect: 'error',
          signal: AbortSignal.timeout(15000), headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ token: account.tokens.refreshToken, token_type_hint: 'refresh_token', client_id: account.clientId }).toString() })
        revocationConfirmed = response.status === 200
      } catch { revocationConfirmed = false }
    }
    await store.update(next => { const target = next.accounts.find(a => a.id === accountId); target.tokens = null; target.verifiedModel = null })
    return status()
  }

  return { start, cancelSignIn: async () => { cancelSignIn(); return status() }, status, select, signOut,
    listModels: () => withAccount((accessToken, signal) => inference.listModels(accessToken, signal)),
    chat: ({ modelName, history, signal, reasoningEffort, readPath, maxOutputTokens, systemPrompt, agentTurn, expectedAccountId }) => withAccount(async (accessToken, requestSignal, account) => {
      if (expectedAccountId !== undefined && account.id !== expectedAccountId) throw providerError('CREDENTIAL_CHANGED')
      try {
        const result = await inference.chat({ accessToken, modelName, history, signal: requestSignal, reasoningEffort, readPath, maxOutputTokens, systemPrompt, agentTurn })
        await store.update(next => {
          const target = next.accounts.find(a => a.id === account.id)
          if (next.activeId !== account.id || !target?.tokens || requestSignal.aborted) throw providerError('CANCELLED')
          target.verifiedModel = modelName
        }, { signal: requestSignal })
        return result
      } catch (error) {
        if (['AUTH_REQUIRED', 'PROVIDER_REJECTED'].includes(error?.code)) await store.update(next => {
          const target = next.accounts.find(a => a.id === account.id); if (target) target.verifiedModel = null
        })
        throw error
      }
    }, signal),
    dispose: () => { cancelSignIn(); stopRequests() } }
}

module.exports = { createChatGPTAuth, validateIdToken }
