const { test } = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const { createOllamaClient } = require('../electron/ollama.cjs')

async function localServer(t, handler) {
  const server = http.createServer(handler)
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(async () => {
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
  })
  return `http://127.0.0.1:${server.address().port}`
}

test('Hermes system prompt preserves its role and rejects oversized/mixed tool inputs', async t => {
  let calls = 0
  const baseUrl = await localServer(t, async (req, res) => {
    let raw = ''
    for await (const chunk of req) raw += chunk
    const body = JSON.parse(raw)
    calls++
    assert.deepEqual(body.messages, [{ role: 'system', content: 'Bound Hermes instructions' }, { role: 'user', content: 'Plan only' }])
    assert.equal(body.tools, undefined)
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ done: true, message: { content: 'Plan' } }))
  })
  const client = createOllamaClient({ baseUrl })
  const request = { modelName: 'fixture', history: [{ role: 'user', text: 'Plan only' }], systemPrompt: 'Bound Hermes instructions' }
  assert.equal((await client.chat(request)).text, 'Plan')
  await assert.rejects(client.chat({ ...request, systemPrompt: 'x'.repeat(400001) }), { code: 'INVALID_INPUT' })
  await assert.rejects(client.chat({ ...request, readPath: 'fixture.txt' }), { code: 'INVALID_INPUT' })
  assert.equal(calls, 1)
})

test('explicit local file proposal checks model tool capability and exact arguments', async t => {
  const target = 'C:\\Fixture\\report.txt'
  let capable = true, retarget = false, chats = 0
  const baseUrl = await localServer(t, async (incoming, response) => {
    let raw = ''
    for await (const chunk of incoming) raw += chunk
    const body = JSON.parse(raw)
    response.setHeader('Content-Type', 'application/json')
    if (incoming.url === '/api/show') return response.end(JSON.stringify({ capabilities: capable ? ['completion', 'tools'] : ['completion'] }))
    chats++
    assert.deepEqual(body.tools[0].function.parameters.properties, {})
    assert.equal(body.options.temperature, 0)
    assert.equal(body.options.seed, 0)
    assert.equal(body.messages[0].role, 'system')
    assert.ok(body.messages[0].content.includes('empty JSON arguments {}'))
    response.end(JSON.stringify({ done: true, message: { content: '', tool_calls: [{ function: { name: 'preview_requested_file', arguments: retarget ? { path: 'other.txt' } : {} } }] } }))
  })
  const client = createOllamaClient({ baseUrl })
  const request = { modelName: 'qwen3:8b', history: [{ role: 'user', text: 'Read fixture' }], readPath: target }
  assert.equal((await client.chat(request)).name, 'read-file')
  retarget = true
  await assert.rejects(client.chat(request), { code: 'INVALID_MODEL_OUTPUT' })
  capable = false
  await assert.rejects(client.chat(request), { code: 'TOOLS_NOT_SUPPORTED' })
  assert.equal(chats, 2)
})

test('lists installed models and sends a bounded chat with history only', async t => {
  let request
  const baseUrl = await localServer(t, async (incoming, response) => {
    if (incoming.url === '/api/tags') {
      response.setHeader('Content-Type', 'application/json')
      response.end(JSON.stringify({ models: [{ name: 'qwen3:8b' }, { name: 'gemma:latest' }] }))
      return
    }
    let body = ''
    for await (const chunk of incoming) body += chunk
    request = { url: incoming.url, body: JSON.parse(body) }
    response.setHeader('Content-Type', 'application/json')
    response.end(JSON.stringify({ message: { role: 'assistant', content: 'أهلًا من النموذج المحلي' }, done: true }))
  })
  const client = createOllamaClient({ baseUrl })
  assert.deepEqual(await client.listModels(), ['qwen3:8b', 'gemma:latest'])
  const result = await client.chat({ modelName: 'qwen3:8b', history: [
    { role: 'user', text: 'مرحبا' }, { role: 'assistant', text: 'أهلًا' }, { role: 'user', text: 'اكمل' }
  ] })
  assert.deepEqual(result, { kind: 'message', text: 'أهلًا من النموذج المحلي' })
  assert.equal(request.url, '/api/chat')
  assert.deepEqual(request.body, { model: 'qwen3:8b', stream: false, truncate: false, shift: false, options: {}, messages: [
    { role: 'user', content: 'مرحبا' }, { role: 'assistant', content: 'أهلًا' }, { role: 'user', content: 'اكمل' }
  ] })
  await client.chat({ modelName: 'qwen3:8b', history: [{ role: 'user', text: 'fixture' }], maxOutputTokens: 512 })
  assert.equal(request.body.options.num_predict, 512)
})

test('rejects invalid model names and external endpoints', async () => {
  assert.throws(() => createOllamaClient({ baseUrl: 'http://example.com:11434' }), { code: 'INVALID_INPUT' })
  const client = createOllamaClient()
  await assert.rejects(client.chat({ modelName: '../bad model', history: [{ role: 'user', text: 'x' }] }), { code: 'INVALID_INPUT' })
})

test('a partial or token-limited local answer cannot verify inference', async t => {
  let payload = { done: false, message: { content: 'partial fixture' } }
  const baseUrl = await localServer(t, (_request, response) => response.end(JSON.stringify(payload)))
  const client = createOllamaClient({ baseUrl })
  const request = { modelName: 'qwen2.5:1.5b', history: [{ role: 'user', text: 'fixture' }] }
  await assert.rejects(client.chat(request), { code: 'INVALID_MODEL_OUTPUT' })
  payload = { done: true, done_reason: 'length', message: { content: 'still partial' } }
  await assert.rejects(client.chat(request), { code: 'INVALID_MODEL_OUTPUT' })
})

test('reports unavailable service without leaking network errors', async t => {
  const baseUrl = await localServer(t, (_request, response) => { response.destroy() })
  const client = createOllamaClient({ baseUrl })
  await assert.rejects(client.listModels(), { code: 'OLLAMA_UNAVAILABLE' })
})

test('rejects malformed or oversized model responses', async t => {
  const baseUrl = await localServer(t, (_request, response) => {
    response.setHeader('Content-Type', 'application/json')
    response.end(JSON.stringify({ message: { role: 'assistant', content: 'x'.repeat(20001) } }))
  })
  const client = createOllamaClient({ baseUrl })
  await assert.rejects(client.chat({ modelName: 'test', history: [{ role: 'user', text: 'hi' }] }), { code: 'INVALID_MODEL_OUTPUT' })
})

test('times out a stalled local model request', async t => {
  const baseUrl = await localServer(t, () => {})
  const client = createOllamaClient({ baseUrl, timeoutMs: 30 })
  await assert.rejects(client.chat({ modelName: 'test', history: [{ role: 'user', text: 'hi' }] }), { code: 'PROVIDER_TIMEOUT' })
})
