// Local OpenAI-compatible servers (LM Studio, llama.cpp, vLLM...) whose model has no native tool calling keep their tools through the
// validated text protocol (R-082).
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createProviderClient } = require('../electron/provider-client.cjs')
const json = (value, status = 200) => new Response(JSON.stringify(value), { status })
const TOOLS = [{ type: 'function', name: 'najd_files_read', description: 'Read a text file.', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false } }]
const ask = text => ({ modelName: 'local-model', history: [{ role: 'user', text }], agentTurn: { tools: TOOLS, input: [{ role: 'user', content: text }] } })
const reply = (content, finish = 'stop') => json({ choices: [{ finish_reason: finish, message: { role: 'assistant', content } }], usage: { prompt_tokens: 50, completion_tokens: 5, total_tokens: 55 } })

test('a server that rejects the tools field gets the text protocol, and the model is remembered for the next turns', async () => {
  const bodies = []
  const client = createProviderClient('llamacpp', { fetchImpl: async (_url, options) => {
    const body = JSON.parse(options.body); bodies.push(body)
    if (body.tools) return json({ error: { message: 'tools param requires --jinja flag' } }, 500)
    return reply('<tool_call>{"name": "najd_files_read", "arguments": {"path": "C:/a.txt"}}</tool_call>')
  } })
  const first = await client.chat(ask('read C:/a.txt'))
  assert.equal(first.kind, 'agent-tools')
  assert.deepEqual(JSON.parse(first.calls[0].arguments), { path: 'C:/a.txt' })
  assert.equal(bodies.length, 2, 'one native attempt, then the text protocol')
  assert.equal(bodies[1].tools, undefined); assert.equal(bodies[1].tool_choice, undefined)
  assert.match(bodies[1].messages[0].content, /# Tools[\s\S]*najd_files_read/)
  await client.chat(ask('read it again'))
  assert.equal(bodies.length, 3, 'remembered: no second native attempt')
  assert.equal(bodies[2].tools, undefined)
})

test('a rejection that is not about tools stays the error and is not remembered', async () => {
  let calls = 0
  const client = createProviderClient('lmstudio', { fetchImpl: async () => { calls++; return json({ error: 'model not loaded' }, 400) } })
  await assert.rejects(client.chat(ask('hello')), { code: 'PROVIDER_REJECTED' })
  await assert.rejects(client.chat(ask('hello')), { code: 'PROVIDER_REJECTED' })
  assert.equal(calls, 4, 'each turn tries native first again, since the text protocol failed too')
})

test('a model that writes its call as text on a server that accepted the tools field is understood, and validated', async () => {
  const client = createProviderClient('lmstudio', { fetchImpl: async (_url, options) => {
    const body = JSON.parse(options.body)
    assert.ok(body.tools, 'native tools were offered')
    return body.messages.at(-1).content.includes('bad') ? reply('<tool_call>{"name": "najd_files_read", "arguments": {}}</tool_call>') : reply('<tool_call>{"name": "najd_files_read", "arguments": {"path": "C:/b.txt"}}</tool_call>')
  } })
  const good = await client.chat(ask('read b'))
  assert.equal(good.kind, 'agent-tools'); assert.deepEqual(JSON.parse(good.calls[0].arguments), { path: 'C:/b.txt' })
  const bad = await client.chat(ask('bad call'))
  assert.equal(bad.kind, 'message', 'an invalid text call is never run on this path')
})

test('cloud providers never take the text protocol', async () => {
  const client = createProviderClient('openai-api', { fetchImpl: async () => json({ error: 'no' }, 400) })
  await assert.rejects(client.chat({ apiKey: 'sk-test-FAKE', ...ask('hello') }), { code: 'PROVIDER_REJECTED' })
})

test('a server that refuses a request as larger than its window gives CONTEXT_LIMIT with the stated window, never the text fallback', async () => {
  const { jsonRequest } = require('../electron/provider-http.cjs')
  const llama = '{"error":{"code":400,"message":"request (4825 tokens) exceeds the available context size (4096 tokens), try increasing it","type":"exceed_context_size_error","n_prompt_tokens":4825,"n_ctx":4096}}'
  await assert.rejects(jsonRequest(async () => new Response(llama, { status: 400 }), 'http://127.0.0.1:1/x'), error => error.code === 'CONTEXT_LIMIT' && error.window === 4096)
  const openai = '{"error":{"message":"This model\'s maximum context length is 128000 tokens. However, your messages resulted in 130000 tokens.","code":"context_length_exceeded"}}'
  await assert.rejects(jsonRequest(async () => new Response(openai, { status: 400 }), 'https://x/y'), error => error.code === 'CONTEXT_LIMIT' && error.window === 128000)
  await assert.rejects(jsonRequest(async () => new Response('{"error":"model not loaded"}', { status: 400 }), 'https://x/y'), error => error.code === 'PROVIDER_REJECTED' && error.window === undefined)
  let calls = 0
  const client = createProviderClient('llamacpp', { fetchImpl: async () => { calls++; return new Response(llama, { status: 400 }) } })
  await assert.rejects(client.chat(ask('read a')), { code: 'CONTEXT_LIMIT' })
  assert.equal(calls, 1, 'a too-long request is not retried as text')
})

test('the provider service remembers the window a local server stated, so the next run is sized to it', async t => {
  const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path')
  const { createProviderService } = require('../electron/provider-service.cjs')
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'najd-context-limit-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const service = createProviderService({ directory: root, encryption: { isAsyncEncryptionAvailable: async () => true, encryptStringAsync: async v => Buffer.from(v), decryptStringAsync: async v => ({ result: v.toString() }) },
    chatGPT: { status: async () => ({ signedIn: false }) }, ollama: { listModels: async () => [] }, localFetch: async () => new Response('{}', { status: 404 }),
    clientFactory: () => ({ chat: async () => { throw Object.assign(new Error('CONTEXT_LIMIT'), { code: 'CONTEXT_LIMIT', window: 4096 }) } }) })
  t.after(() => service.dispose())
  await service.setEndpoint('llamacpp', 'http://127.0.0.1:8099/v1')
  const before = service.inputBudget('llamacpp', 'm')
  await assert.rejects(service.chat({ provider: 'llamacpp', modelName: 'm', history: [{ role: 'user', text: 'hi' }] }), { code: 'CONTEXT_LIMIT' })
  assert.equal(service.inputBudget('llamacpp', 'm'), 4096 * 3, 'the stated window now sizes the budget (it was ' + before + ')')
})
