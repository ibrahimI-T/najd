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

test('a Kimi refusal keeps its reason for the error log, and a too-long request is CONTEXT_LIMIT (live 2026-11-09)', async () => {
  const { createKimiCodeClient } = require('../electron/kimi-code.cjs')
  const request = { apiKey: 'sk-kimi-FAKE-TEST-KEY', modelName: 'k3', history: [{ role: 'user', text: 'hi' }] }
  const refused = createKimiCodeClient({ fetchImpl: async () => new Response('{"error":{"message":"Invalid request: tools[3].function.parameters is not a valid JSON schema","type":"invalid_request_error"}}', { status: 400 }) })
  await assert.rejects(refused.chat(request), error => error.code === 'PROVIDER_REJECTED' && error.status === 400 && /not a valid JSON schema/.test(error.detail) && !String(error.detail).includes('sk-kimi'))
  const tooLong = createKimiCodeClient({ fetchImpl: async () => new Response('{"error":{"message":"Invalid request: Your request exceeded model token limit: 262144","type":"invalid_request_error","code":"context_length_exceeded"}}', { status: 400 }) })
  await assert.rejects(tooLong.chat(request), { code: 'CONTEXT_LIMIT' })
})
