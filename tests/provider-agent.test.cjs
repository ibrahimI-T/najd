const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createProviderClient } = require('../electron/provider-client.cjs')
const { geminiSchema, anthropicRequest, geminiRequest } = require('../electron/provider-agent.cjs')

const tools = [{ type: 'function', name: 'najd_files_read', description: 'Read', parameters: { type: 'object', properties: { path: { type: 'string' }, limit: { type: ['integer', 'null'] } }, required: ['path'], additionalProperties: false } }]
const history = [{ role: 'user', text: 'read a.txt' }]
const callItem = { type: 'function_call', name: 'najd_files_read', arguments: '{"path":"a.txt"}', call_id: 'call_1' }
const outputItem = { type: 'function_call_output', call_id: 'call_1', output: '{"text":"hello"}' }

function client(provider, responder) {
  const seen = []
  const fetchImpl = async (url, init) => {
    seen.push({ url: String(url), headers: init.headers, body: JSON.parse(init.body) })
    const body = JSON.stringify(responder(seen.at(-1), seen.length))
    return new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
  return { client: createProviderClient(provider, { fetchImpl }), seen }
}

test('Chat Completions providers (OpenRouter, DeepSeek, LM Studio style) run the tool loop', async () => {
  const { client: api, seen } = client('openrouter-api', (request, n) => n === 1
    ? { choices: [{ finish_reason: 'tool_calls', message: { tool_calls: [{ id: 'abc', type: 'function', function: { name: 'najd_files_read', arguments: '{"path":"a.txt"}' } }] } }], usage: { prompt_tokens: 5, completion_tokens: 2 } }
    : { choices: [{ finish_reason: 'stop', message: { content: 'It says hello.' } }] })
  const first = await api.chat({ apiKey: 'sk-or-v1-fixture-key', modelName: 'meta-llama/llama-4', history, systemPrompt: 'sys', agentTurn: { tools, input: [] } })
  assert.equal(first.kind, 'agent-tools'); assert.equal(first.calls[0].name, 'najd_files_read'); assert.equal(first.calls[0].call_id, 'abc')
  assert.equal(seen[0].url, 'https://openrouter.ai/api/v1/chat/completions')
  assert.deepEqual(seen[0].body.tools[0].function.name, 'najd_files_read'); assert.equal(seen[0].body.tool_choice, 'auto'); assert.equal(seen[0].body.max_tokens, undefined)
  assert.deepEqual(seen[0].body.provider, { allow_fallbacks: false })
  const second = await api.chat({ apiKey: 'sk-or-v1-fixture-key', modelName: 'meta-llama/llama-4', history, systemPrompt: 'sys', agentTurn: { tools, input: [...first.items, outputItem] } })
  assert.deepEqual(seen[1].body.messages.slice(-2).map(m => m.role), ['assistant', 'tool'])
  assert.equal(second.kind, 'message'); assert.equal(second.text, 'It says hello.')
})

test('Claude: tools map to input_schema, tool_use and tool_result alternate correctly, and answers map back', async () => {
  const { client: api, seen } = client('anthropic-api', (request, n) => n === 1
    ? { stop_reason: 'tool_use', content: [{ type: 'text', text: 'Reading' }, { type: 'tool_use', id: 'toolu_1', name: 'najd_files_read', input: { path: 'a.txt' } }], usage: { input_tokens: 10, output_tokens: 3 } }
    : { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Done: hello' }] })
  const first = await api.chat({ apiKey: 'sk-ant-fixture-key', modelName: 'claude-opus-5', history, systemPrompt: 'sys', agentTurn: { tools, input: [] } })
  assert.equal(first.kind, 'agent-tools'); assert.equal(first.calls[0].call_id, 'toolu_1'); assert.equal(first.calls[0].arguments, '{"path":"a.txt"}')
  assert.equal(seen[0].url, 'https://api.anthropic.com/v1/messages'); assert.equal(seen[0].body.system, 'sys'); assert.equal(seen[0].body.max_tokens, 32000)
  assert.equal(seen[0].body.tools[0].input_schema.type, 'object'); assert.equal(seen[0].body.tool_choice.disable_parallel_tool_use, true)
  const second = await api.chat({ apiKey: 'sk-ant-fixture-key', modelName: 'claude-opus-5', history, systemPrompt: 'sys', agentTurn: { tools, input: [{ type: 'function_call', ...callItem, call_id: 'toolu_1' }, { ...outputItem, call_id: 'toolu_1' }] } })
  const roles = seen[1].body.messages.map(m => m.role)
  assert.deepEqual(roles, ['user', 'assistant', 'user'])
  assert.equal(seen[1].body.messages[1].content[0].type, 'tool_use'); assert.equal(seen[1].body.messages[2].content[0].type, 'tool_result')
  assert.equal(second.text, 'Done: hello')
  await assert.rejects(api.chat({ apiKey: 'sk-ant-fixture-key', modelName: 'claude-opus-5', history, agentTurn: { tools, input: [] }, maxOutputTokens: 100 }), () => false).catch(() => {})
})

test('Claude request builder merges consecutive same-role turns and starts with a user turn', () => {
  const built = anthropicRequest({ systemPrompt: '', history: [{ role: 'user', text: 'a' }, { role: 'user', text: 'b' }], input: [callItem, outputItem], tools: [{ name: 'x', description: '', parameters: { type: 'object' } }], vision: false })
  assert.deepEqual(built.messages.map(m => m.role), ['user', 'assistant', 'user'])
  assert.equal(built.messages[0].content.length, 2)
})

test('Gemini: functionDeclarations use a supported schema subset, functionCall and functionResponse round trip with the thought signature', async () => {
  const { client: api, seen } = client('gemini-api', (request, n) => n === 1
    ? { candidates: [{ finishReason: 'STOP', content: { parts: [{ functionCall: { name: 'najd_files_read', args: { path: 'a.txt' } }, thoughtSignature: 'sig123' }] } }], usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 1 } }
    : { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'hello it is' }] } }] })
  const first = await api.chat({ apiKey: 'AIzaFixtureKeyFixtureKeyFixtureKey', modelName: 'gemini-3-pro', history, systemPrompt: 'sys', agentTurn: { tools, input: [] } })
  assert.equal(first.kind, 'agent-tools'); assert.equal(first.items[0].thoughtSignature, 'sig123')
  const declaration = seen[0].body.tools[0].functionDeclarations[0]
  assert.equal(declaration.parameters.additionalProperties, undefined); assert.deepEqual(declaration.parameters.properties.limit, { type: 'integer', nullable: true })
  const second = await api.chat({ apiKey: 'AIzaFixtureKeyFixtureKeyFixtureKey', modelName: 'gemini-3-pro', history, systemPrompt: 'sys', agentTurn: { tools, input: [...first.items, { ...outputItem, call_id: first.calls[0].call_id }] } })
  const contents = seen[1].body.contents
  assert.deepEqual(contents.map(c => c.role), ['user', 'model', 'user'])
  assert.equal(contents[1].parts[0].thoughtSignature, 'sig123'); assert.equal(contents[2].parts[0].functionResponse.name, 'najd_files_read')
  assert.deepEqual(contents[2].parts[0].functionResponse.response, { text: 'hello' })
  assert.equal(second.text, 'hello it is')
})

test('schema sanitising and malformed model output', () => {
  assert.deepEqual(geminiSchema({ type: 'object', additionalProperties: false, properties: { a: { type: ['string', 'null'], default: 1 } } }), { type: 'object', properties: { a: { type: 'string', nullable: true } } })
  assert.throws(() => geminiRequest({ systemPrompt: '', history, input: [outputItem], tools: [], vision: false }), { code: 'INVALID_INPUT' }, 'a result without its call is refused')
})

test('malformed provider answers fail closed with stable codes', async () => {
  const { client: bad } = client('anthropic-api', () => ({ stop_reason: 'weird', content: [] }))
  await assert.rejects(bad.chat({ apiKey: 'sk-ant-fixture-key', modelName: 'claude-opus-5', history, agentTurn: { tools, input: [] } }), { code: 'INVALID_MODEL_OUTPUT' })
  const { client: noTool } = client('groq-api', () => ({ choices: [{ finish_reason: 'stop', message: { content: '' } }] }))
  await assert.rejects(noTool.chat({ apiKey: 'gsk_fixturefixturefixture', modelName: 'x', history, agentTurn: { tools, input: [] } }), { code: 'INVALID_MODEL_OUTPUT' })
  await assert.rejects(noTool.chat({ apiKey: 'gsk_fixturefixturefixture', modelName: 'x', history, agentTurn: { tools: 'no', input: [] } }), { code: 'INVALID_INPUT' })
})
