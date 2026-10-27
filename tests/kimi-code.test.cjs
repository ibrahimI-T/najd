const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createKimiCodeClient } = require('../electron/kimi-code.cjs')

test('a partial Kimi completion cannot create connection proof', async () => {
  const client = createKimiCodeClient({ fetchImpl: async () => new Response(JSON.stringify({ choices: [{ finish_reason: 'length', message: { content: 'partial' } }] })) })
  await assert.rejects(client.chat({ apiKey: 'sk-kimi-test-key', modelName: 'k3', history: [{ role: 'user', text: 'Hello' }] }), { code: 'INVALID_MODEL_OUTPUT' })
})

const history = [{ role: 'user', text: 'Hello' }]

test('Kimi Code sends only an authenticated bounded chat request to its fixed endpoint', async () => {
  let seen
  const client = createKimiCodeClient({ fetchImpl: async (url, options) => {
    seen = { url, options }
    return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: 'Hi' } }] }), { status: 200 })
  } })
  assert.deepEqual(await client.chat({ apiKey: 'sk-kimi-example', modelName: 'k3-256k', history }), { kind: 'message', text: 'Hi' })
  assert.equal(seen.url, 'https://api.kimi.ai/coding/v1/chat/completions')
  assert.equal(seen.options.headers.Authorization, 'Bearer sk-kimi-example')
  assert.equal(JSON.parse(seen.options.body).model, 'k3-256k')
  assert.equal(seen.options.redirect, 'error')
  await client.chat({ apiKey: 'sk-kimi-example', modelName: 'k3-256k', history, maxOutputTokens: 512 })
  assert.equal(JSON.parse(seen.options.body).max_tokens, 512)
  await assert.rejects(client.chat({ apiKey: 'sk-kimi-example', modelName: 'k3-256k', history, maxOutputTokens: 1 }), { code: 'INVALID_INPUT' })
})

test('Kimi Code refuses missing credentials and malformed messages', async () => {
  const client = createKimiCodeClient({ fetchImpl: () => { throw new Error('must not call') } })
  await assert.rejects(client.chat({ apiKey: '', modelName: 'k3', history }), { code: 'AUTH_REQUIRED' })
  await assert.rejects(client.chat({ apiKey: 'sk-kimi-x', modelName: 'bad model', history }), { code: 'INVALID_INPUT' })
})

test('Kimi Code maps provider failures without returning provider body or key', async () => {
  const client = createKimiCodeClient({ fetchImpl: async () => new Response('secret response', { status: 401 }) })
  await assert.rejects(client.chat({ apiKey: 'sk-kimi-secret', modelName: 'k3', history }), { code: 'PROVIDER_REJECTED' })
})
