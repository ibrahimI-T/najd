const { test } = require('node:test')
const assert = require('node:assert/strict')
const { generateKeyPairSync, sign, createHash } = require('node:crypto')
const { createChatGPTAuth, validateIdToken } = require('../electron/chatgpt-auth.cjs')
const { createChatGPTInference } = require('../electron/chatgpt-inference.cjs')
const keys = generateKeyPairSync('rsa', { modulusLength: 2048 })
const jwks = { keys: [{ ...keys.publicKey.export({ format: 'jwk' }), kid: 'test-key', use: 'sig', alg: 'RS256' }] }
function token(claims = {}) {
  const head = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'test-key' })).toString('base64url')
  const body = Buffer.from(JSON.stringify({ iss: 'https://auth.openai.com', aud: 'oaiapp_test', sub: 'test-user',
    email: 'test@example.invalid', exp: Math.floor(Date.now() / 1000) + 3600, ...claims })).toString('base64url')
  return `${head}.${body}.${sign('RSA-SHA256', Buffer.from(`${head}.${body}`), keys.privateKey).toString('base64url')}`
}
const json = data => new Response(JSON.stringify(data))
const settle = async predicate => { for (let i = 0; i < 100; i++) { if (await predicate()) return; await new Promise(r => setTimeout(r, 10)) }; throw new Error('Auth did not settle') }

function fixture(t, overrides = {}) {
  let data = { version: 1, hostId: 'urn:uuid:11111111-1111-4111-8111-111111111111', activeId: null, accounts: [] }
  const store = { read: async () => structuredClone(data), update: async fn => { const copy = structuredClone(data); fn(copy); data = copy; return structuredClone(data) } }
  let opened
  const calls = []
  const fetchImpl = async (url, options) => {
    calls.push({ url, options })
    if (url.endsWith('jwks.json')) return json(jwks)
    if (url.endsWith('/revoke')) return new Response(null, { status: overrides.revokeStatus || 200 })
    const form = new URLSearchParams(options.body)
    if (form.get('grant_type') === 'refresh_token') return json({ token_type: 'Bearer', access_token: 'REFRESHED-ACCESS', refresh_token: 'ROTATED-REFRESH', expires_in: 3600 })
    return json({ token_type: 'Bearer', access_token: 'TEST-ACCESS', refresh_token: 'TEST-REFRESH', id_token: token({ nonce: opened.searchParams.get('nonce') }), expires_in: 3600,
      scope: 'openid offline_access resource.invoke chatgpt.tokens.use.direct' })
  }
  const inference = { listModels: async access => [{ id: 'test-model', label: access === 'TEST-ACCESS' ? 'Account model' : 'Refreshed model' }], chat: async () => ({ kind: 'message', text: 'reply' }) }
  const auth = createChatGPTAuth({ store, inference, fetchImpl, openBrowser: async url => { opened = new URL(url) }, ...overrides })
  t.after(() => auth.dispose())
  async function callback(parameters = {}) {
    const url = new URL(opened.searchParams.get('redirect_uri'))
    for (const [key, value] of Object.entries({ state: opened.searchParams.get('state'), code: 'test-code', client_id: 'oaiapp_test', ...parameters })) url.searchParams.set(key, value)
    return fetch(url)
  }
  return { auth, store, calls, callback, opened: () => opened }
}

test('validates signatures, nonce, issuer, audience, identity, and expiry before saving', () => {
  assert.equal(validateIdToken(token({ nonce: 'expected' }), jwks, { clientId: 'oaiapp_test', nonce: 'expected' }).subject, 'test-user')
  for (const claims of [{ nonce: 'wrong' }, { iss: 'https://example.invalid' }, { aud: 'other' }, { exp: 0 }, { sub: 'other-user' }]) {
    assert.throws(() => validateIdToken(token({ nonce: 'expected', ...claims }), jwks,
      { clientId: 'oaiapp_test', nonce: 'expected', subject: 'test-user' }), { code: 'AUTH_INVALID_RESPONSE' })
  }
  const parts = token().split('.')
  parts[2] = (parts[2][0] === 'A' ? 'B' : 'A') + parts[2].slice(1)
  assert.throws(() => validateIdToken(parts.join('.'), jwks, { clientId: 'oaiapp_test' }), { code: 'AUTH_INVALID_RESPONSE' })
})

test('registers NAJD with PKCE, rejects wrong state, saves issued client, and hides tokens', async t => {
  const f = fixture(t)
  await f.auth.start()
  assert.equal(f.opened().origin, 'https://auth.openai.com')
  assert.equal(f.opened().searchParams.get('client_id'), 'dynamic_agent_client')
  assert.equal(f.opened().searchParams.get('agent_name_hint'), 'NAJD AGENT')
  assert.equal((await f.callback({ state: 'wrong' })).status, 400)
  assert.equal((await f.auth.status()).signingIn, true)
  assert.equal((await f.callback()).status, 200)
  await settle(async () => !(await f.auth.status()).signingIn)
  const stored = await f.store.read()
  assert.equal(stored.accounts[0].clientId, 'oaiapp_test')
  const exchange = new URLSearchParams(f.calls[0].options.body)
  assert.equal(exchange.get('client_id'), 'oaiapp_test')
  assert.equal(exchange.get('redirect_uri'), f.opened().searchParams.get('redirect_uri'))
  assert.equal(createHash('sha256').update(exchange.get('code_verifier')).digest('base64url'), f.opened().searchParams.get('code_challenge'))
  assert.equal(JSON.stringify(await f.auth.status()).includes('TEST-ACCESS'), false)
  assert.deepEqual(await f.auth.listModels(), [{ id: 'test-model', label: 'Account model' }])
})

test('reauthorization uses the issued client and host; sign-out clears tokens but keeps mapping', async t => {
  const f = fixture(t)
  await f.auth.start(); await f.callback()
  await settle(async () => !(await f.auth.status()).signingIn)
  const first = await f.store.read()
  await f.auth.signOut(first.activeId)
  assert.equal((await f.store.read()).accounts[0].tokens, null)
  assert.equal((await f.auth.status()).revocationConfirmed, true)
  await f.auth.start(first.activeId)
  assert.equal(f.opened().searchParams.get('client_id'), 'oaiapp_test')
  assert.equal(f.opened().searchParams.get('ext_agent_host_id'), first.hostId)
  assert.equal(f.opened().searchParams.has('agent_name_hint'), false)
  assert.equal(f.opened().searchParams.has('id_token_hint'), false)
  await f.callback({ client_id: 'oaiapp_other' })
  await settle(async () => !(await f.auth.status()).signingIn)
  assert.equal((await f.auth.status()).errorCode, 'AUTH_INVALID_RESPONSE')
  assert.equal((await f.store.read()).accounts[0].tokens, null)
})

test('renews an expired token once and saves the rotated refresh token', async t => {
  const f = fixture(t)
  await f.auth.start(); await f.callback()
  await settle(async () => !(await f.auth.status()).signingIn)
  await f.store.update(data => { data.accounts[0].tokens.expiresAt = 0 })
  await Promise.all([f.auth.listModels(), f.auth.listModels()])
  assert.equal(f.calls.filter(c => new URLSearchParams(c.options.body).get('grant_type') === 'refresh_token').length, 1)
  assert.equal((await f.store.read()).accounts[0].tokens.refreshToken, 'ROTATED-REFRESH')
})

test('agent continuation cannot switch to another active subscription account', async t => {
  const f = fixture(t)
  await f.auth.start(); await f.callback()
  await settle(async () => !(await f.auth.status()).signingIn)
  await assert.rejects(f.auth.chat({ modelName: 'test-model', history: [{ role: 'user', text: 'Read attachment' }],
    expectedAccountId: 'another-account' }), { code: 'CREDENTIAL_CHANGED' })
})

test('ChatGPT connection proof follows complete inference and clears on reauthorization, rejection, and sign-out', async t => {
  let rejected = false
  const f = fixture(t, { inference: { listModels: async () => [{ id: 'test-model', label: 'Test' }],
    chat: async () => { if (rejected) throw Object.assign(new Error('PRIVATE'), { code: 'AUTH_REQUIRED' }); return { kind: 'message', text: 'OK' } } } })
  await f.auth.start(); await f.callback()
  await settle(async () => !(await f.auth.status()).signingIn)
  assert.equal((await f.auth.status()).verified, false)
  await f.auth.chat({ modelName: 'test-model', history: [{ role: 'user', text: 'Hello' }] })
  assert.equal((await f.auth.status()).verified, true)
  const id = (await f.auth.status()).activeId
  await f.auth.start(id); await f.callback()
  await settle(async () => !(await f.auth.status()).signingIn)
  assert.equal((await f.auth.status()).verified, false)
  await f.auth.chat({ modelName: 'test-model', history: [{ role: 'user', text: 'Hello' }] })
  rejected = true
  await assert.rejects(f.auth.chat({ modelName: 'test-model', history: [{ role: 'user', text: 'Hello' }] }), { code: 'AUTH_REQUIRED' })
  assert.equal((await f.auth.status()).verified, false)
  await f.auth.signOut(id)
  assert.equal((await f.auth.status()).verified, false)
})

test('cancelled sign-in closes its callback listener and never registers an account', async t => {
  const f = fixture(t)
  await f.auth.start()
  await f.auth.cancelSignIn()
  await assert.rejects(f.callback())
  assert.equal((await f.store.read()).accounts.length, 0)
})

test('concurrent sign-in calls share a single browser attempt', async t => {
  let opens = 0
  const f = fixture(t, { openBrowser: async () => { opens++ } })
  await Promise.all([f.auth.start(), f.auth.start()])
  assert.equal(opens, 1)
})

test('missing ChatGPT plan scope cannot enable inference', async t => {
  const f = fixture(t, { fetchImpl: async () => json({ token_type: 'Bearer', scope: 'openid profile email' }) })
  await f.auth.start(); await f.callback()
  await settle(async () => !(await f.auth.status()).signingIn)
  assert.equal((await f.auth.status()).errorCode, 'PLAN_NOT_ENABLED')
  assert.equal((await f.store.read()).accounts.length, 0)
})

test('declined consent saves no account and exposes a stable error only', async t => {
  const f = fixture(t)
  await f.auth.start(); await f.callback({ error: 'access_denied' })
  await settle(async () => !(await f.auth.status()).signingIn)
  assert.equal((await f.auth.status()).errorCode, 'AUTH_DENIED')
  assert.equal((await f.store.read()).accounts.length, 0)
  assert.equal(f.calls.length, 0)
})

test('failed remote revocation still clears local tokens and reports uncertainty', async t => {
  const f = fixture(t, { revokeStatus: 503 })
  await f.auth.start(); await f.callback()
  await settle(async () => !(await f.auth.status()).signingIn)
  const before = await f.store.read()
  const status = await f.auth.signOut(before.activeId)
  assert.equal(status.signedIn, false)
  assert.equal(status.revocationConfirmed, false)
  assert.equal((await f.store.read()).accounts[0].tokens, null)
  assert.equal((await f.store.read()).accounts[0].clientId, before.accounts[0].clientId)
})

test('Responses stream needs completed inference; interrupted and quota streams do not succeed', async () => {
  const history = [{ role: 'user', text: 'Hello' }]
  let seen
  const stream = events => events.map(item => `data: ${JSON.stringify(item)}\n\n`).join('')
  const client = createChatGPTInference({ fetchImpl: async (url, options) => {
    seen = { url, options }
    return new Response(stream([{ type: 'response.output_text.delta', delta: 'Hello' }, { type: 'response.completed', response: { status: 'completed' } }]))
  } })
  assert.deepEqual(await client.chat({ accessToken: 'TEST', modelName: 'test-model', history }), { kind: 'message', text: 'Hello' })
  assert.equal(seen.url, 'https://api.openai.com/v1/responses')
  assert.deepEqual(JSON.parse(seen.options.body), { model: 'test-model', store: false, stream: true, input: [{ role: 'user', content: 'Hello' }] })
  const interrupted = createChatGPTInference({ fetchImpl: async () => new Response(stream([{ type: 'response.output_text.delta', delta: 'partial' }])) })
  await assert.rejects(interrupted.chat({ accessToken: 'TEST', modelName: 'test-model', history }), { code: 'INVALID_MODEL_OUTPUT' })
  const quota = createChatGPTInference({ fetchImpl: async () => new Response(stream([{ type: 'response.failed', response: { error: { code: 'subscription_sharing_usage_limit_exceeded' } } }])) })
  await assert.rejects(quota.chat({ accessToken: 'TEST', modelName: 'test-model', history }), { code: 'PROVIDER_RATE_LIMIT' })
})

test('model catalog contains only account-visible slugs, never a guessed default', async () => {
  const client = createChatGPTInference({ fetchImpl: async () => json({ models: [
    { slug: 'allowed', display_name: 'Account model', visibility: 'list', context_window: 272000 }, { slug: 'hidden', visibility: 'hidden' }
  ] }) })
  assert.deepEqual(await client.listModels('TEST'), [{ id: 'allowed', label: 'Account model', contextWindow: 272000 }])
})


test('lost OS key after abrupt termination recovers through explicit reset on the next sign-in', async t => {
  let locked = true
  let resets = 0
  let data = null
  const store = {
    read: async () => { if (locked) throw Object.assign(new Error('CREDENTIAL_UNAVAILABLE'), { code: 'CREDENTIAL_UNAVAILABLE' }); return structuredClone(data) },
    update: async fn => { if (locked) throw Object.assign(new Error('CREDENTIAL_UNAVAILABLE'), { code: 'CREDENTIAL_UNAVAILABLE' }); const copy = structuredClone(data); fn(copy); data = copy; return structuredClone(data) },
    reset: async () => { resets++; locked = false; data = { version: 1, hostId: 'urn:uuid:11111111-1111-4111-8111-111111111111', activeId: null, accounts: [] }; return structuredClone(data) }
  }
  const f = fixture(t, { store })
  await f.auth.start()
  assert.equal(resets, 1)
  assert.equal(f.opened().origin, 'https://auth.openai.com')
  await f.callback()
  await settle(async () => !(await f.auth.status()).signingIn)
  assert.equal((await f.auth.status()).signedIn, true)
})

test('sign-in still fails closed when encryption stays unavailable and no reset happens', async t => {
  const store = {
    read: async () => { throw Object.assign(new Error('CREDENTIAL_UNAVAILABLE'), { code: 'CREDENTIAL_UNAVAILABLE' }) },
    update: async () => { throw Object.assign(new Error('CREDENTIAL_UNAVAILABLE'), { code: 'CREDENTIAL_UNAVAILABLE' }) },
    reset: async () => { throw Object.assign(new Error('CREDENTIAL_UNAVAILABLE'), { code: 'CREDENTIAL_UNAVAILABLE' }) }
  }
  const f = fixture(t, { store })
  await assert.rejects(f.auth.start(), { code: 'CREDENTIAL_UNAVAILABLE' })
})

test('a tool call that arrives only as a streamed output item is read when the completed event lists no output', async () => {
  const stream = events => events.map(item => `data: ${JSON.stringify(item)}

`).join('')
  const call = { id: 'fc_1', type: 'function_call', status: 'completed', arguments: '{"toolset":"desktop"}', call_id: 'call_1', name: 'najd_tools_load' }
  const client = createChatGPTInference({ fetchImpl: async () => new Response(stream([
    { type: 'response.output_item.added', item: { ...call, arguments: '' } },
    { type: 'response.function_call_arguments.done', arguments: call.arguments },
    { type: 'response.output_item.done', item: call },
    { type: 'response.completed', response: { status: 'completed', output: [] } }])) })
  const result = await client.chat({ accessToken: 'token', modelName: 'gpt-5.6-luna', history: [{ role: 'user', text: 'Open Edge' }],
    agentTurn: { tools: [{ type: 'function', name: 'najd_tools_load', parameters: { type: 'object' } }], input: [] } })
  assert.equal(result.kind, 'agent-tools'); assert.equal(result.calls[0].name, 'najd_tools_load'); assert.equal(result.calls[0].call_id, 'call_1')
  // A plain answer still reads from the text deltas.
  const text = createChatGPTInference({ fetchImpl: async () => new Response(stream([{ type: 'response.output_text.delta', delta: 'Hi' },
    { type: 'response.output_item.done', item: { type: 'message', content: [{ type: 'output_text', text: 'Hi' }] } }, { type: 'response.completed', response: { status: 'completed', output: [] } }])) })
  assert.deepEqual(await text.chat({ accessToken: 'token', modelName: 'gpt-5.6-luna', history: [{ role: 'user', text: 'hello' }] }), { kind: 'message', text: 'Hi' })
})

test('agent calls of one conversation share a prompt cache key; other requests send none', async () => {
  const bodies = []
  const done = 'data: ' + JSON.stringify({ type: 'response.output_text.delta', delta: 'Hi' }) + '\n\n' + 'data: ' + JSON.stringify({ type: 'response.completed', response: { status: 'completed', output: [] } }) + '\n\n'
  const client = createChatGPTInference({ fetchImpl: async (_url, options) => { bodies.push(JSON.parse(options.body)); return new Response(done) } })
  const turn = cacheKey => ({ accessToken: 'token', modelName: 'gpt-5.6-luna', history: [{ role: 'user', text: 'hello' }], agentTurn: { tools: [], input: [], cacheKey } })
  await client.chat(turn('867c6e31-474f-496a-91c7-185df3970c8c'))
  await client.chat(turn('bad key with spaces'))
  await client.chat({ accessToken: 'token', modelName: 'gpt-5.6-luna', history: [{ role: 'user', text: 'hello' }] })
  assert.deepEqual(bodies.map(body => body.prompt_cache_key), ['867c6e31-474f-496a-91c7-185df3970c8c', undefined, undefined])
})
