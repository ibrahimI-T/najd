const { test } = require('node:test')
const assert = require('node:assert/strict')
const catalog = require('../electron/provider-catalog.json')
const { createProviderClient } = require('../electron/provider-client.cjs')
const history = [{ role: 'user', text: 'Hello' }]
const json = value => new Response(JSON.stringify(value))

test('explicit Responses file proposal is strict, single-call and rejects retargeting', async () => {
  const target = 'C:\\Fixture\\report.txt'
  let sent, mode = 'valid'
  const client = createProviderClient('openai-api', { fetchImpl: async (_url, options) => {
    sent = JSON.parse(options.body)
    const call = { type: 'function_call', name: 'preview_requested_file', arguments: JSON.stringify(mode === 'retarget' ? { path: 'other.txt' } : {}) }
    return new Response('data: ' + JSON.stringify({ type: 'response.completed', response: { status: 'completed', output: mode === 'multiple' ? [call, call] : [call] } }) + '\n\n')
  } })
  const request = { apiKey: 'FAKE', modelName: 'test-model', history, readPath: target }
  assert.equal((await client.chat(request)).name, 'read-file')
  assert.equal(sent.parallel_tool_calls, false)
  assert.deepEqual(sent.tools[0].parameters.properties, {})
  assert.equal(sent.tools[0].strict, true)
  for (mode of ['retarget', 'multiple']) await assert.rejects(client.chat(request), { code: 'INVALID_MODEL_OUTPUT' })
  mode = 'valid'
  await assert.rejects(client.chat({ ...request, readPath: undefined }), { code: 'INVALID_MODEL_OUTPUT' })
})

test('each implemented API/plan uses its fixed protocol, destination, and secret headers', async () => {
  for (const config of catalog.filter(p => p.baseUrl)) {
    const calls = []
    const client = createProviderClient(config.id, { fetchImpl: async (url, options) => {
      calls.push({ url, options })
      assert.ok(url.startsWith(config.baseUrl + '/'))
      assert.equal(options.redirect, 'error')
      if (!options.method || options.method === 'GET') return json(config.protocol === 'gemini'
        ? { models: [{ name: 'models/test-model', displayName: 'Test', supportedGenerationMethods: ['generateContent'] }] }
        : { data: [{ id: 'test-model', display_name: 'Test' }] })
      if (config.protocol === 'responses') return new Response('data: {"type":"response.output_text.delta","delta":"OK"}\n\ndata: {"type":"response.completed","response":{"status":"completed"}}\n\n')
      if (config.protocol === 'anthropic') return json({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'OK' }] })
      if (config.protocol === 'gemini') return json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'OK' }] } }] })
      return json({ choices: [{ finish_reason: 'stop', message: { content: 'OK' } }] })
    } })
    const modelName = config.models?.[0] || 'test-model'
    const models = await client.listModels('FAKE-KEY')
    assert.ok(models.some(m => m.id === modelName))
    assert.deepEqual(await client.chat({ apiKey: 'FAKE-KEY', modelName, history }), { kind: 'message', text: 'OK' })
    const last = calls.at(-1)
    const headers = last.options.headers
    assert.equal(headers[config.protocol === 'gemini' ? 'x-goog-api-key' : config.protocol === 'anthropic' ? 'x-api-key' : 'Authorization'],
      ['anthropic', 'gemini'].includes(config.protocol) ? 'FAKE-KEY' : 'Bearer FAKE-KEY')
    assert.equal(JSON.stringify(JSON.parse(last.options.body)).includes('FAKE-KEY'), false)
    await client.chat({ apiKey: 'FAKE-KEY', modelName, history, maxOutputTokens: 1024 })
    const capped = JSON.parse(calls.at(-1).options.body)
    assert.equal(config.protocol === 'responses' ? capped.max_output_tokens : config.protocol === 'gemini' ? capped.generationConfig.maxOutputTokens : config.id === 'minimax-plan' ? capped.max_completion_tokens : capped.max_tokens, 1024)
    await assert.rejects(client.chat({ apiKey: 'FAKE-KEY', modelName, history, maxOutputTokens: 1 }), { code: 'INVALID_INPUT' })
  }
})

test('invalid destinations, missing credentials, partial responses, and unverified efforts cannot succeed', async () => {
  assert.throws(() => createProviderClient('not-registered'), { code: 'INVALID_INPUT' })
  const client = createProviderClient('minimax-plan', { fetchImpl: async () => json({ choices: [{ finish_reason: 'length', message: { content: 'partial' } }] }) })
  await assert.rejects(client.chat({ apiKey: '', modelName: 'MiniMax-M3.1-Flash-Preview', history }), { code: 'AUTH_REQUIRED' })
  await assert.rejects(client.chat({ apiKey: 'TEST', modelName: 'MiniMax-M3.1-Flash-Preview', history }), { code: 'INVALID_MODEL_OUTPUT' })
  await assert.rejects(client.chat({ apiKey: 'TEST', modelName: 'MiniMax-M3.1-Flash-Preview', history, reasoningEffort: 'none' }), { code: 'UNSUPPORTED_REASONING' })
})

test('untrusted catalogs, oversized bodies, authentication errors, and cancelled responses fail safely', async () => {
  const malformed = createProviderClient('gemini-api', { fetchImpl: async () => json({ models: [{ name: {}, supportedGenerationMethods: {} }] }) })
  assert.deepEqual(await malformed.listModels('FAKE'), [])
  const oversized = createProviderClient('anthropic-api', { fetchImpl: async () => json({ padding: 'x'.repeat(2 * 1024 * 1024) }) })
  await assert.rejects(oversized.chat({ apiKey: 'FAKE', modelName: 'test-model', history }), { code: 'INVALID_MODEL_OUTPUT' })
  const denied = createProviderClient('groq-api', { fetchImpl: async () => new Response('PRIVATE-KEY-ERROR', { status: 401 }) })
  await assert.rejects(denied.listModels('FAKE'), error => error.code === 'AUTH_REQUIRED' && !error.message.includes('PRIVATE'))
  const controller = new AbortController()
  const cancelled = createProviderClient('deepseek-api', { fetchImpl: async () => { controller.abort(); return json({ choices: [{ finish_reason: 'stop', message: { content: 'Late' } }] }) } })
  await assert.rejects(cancelled.chat({ apiKey: 'FAKE', modelName: 'test-model', history, signal: controller.signal }), { code: 'CANCELLED' })
})
