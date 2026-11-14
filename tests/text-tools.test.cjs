const { test } = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const { toolPrompt, extractCall, schemaProblems, parseReply, textMessages, nameToolResults } = require('../electron/text-tools.cjs')
const { createOllamaClient } = require('../electron/ollama.cjs')

const TOOLS = [
  { type: 'function', name: 'najd_files_read', description: 'Read a text file.', parameters: { type: 'object', properties: { path: { type: 'string', description: 'Absolute path' }, lines: { type: 'integer' } }, required: ['path'], additionalProperties: false } },
  { type: 'function', name: 'najd_office_create', description: 'Create an Office file.', parameters: { type: 'object', properties: { kind: { type: 'string', enum: ['docx', 'xlsx', 'pptx'] }, title: { type: 'string' }, rows: { type: 'array', items: { type: 'array' } } }, required: ['kind'] } }
]

test('the text protocol describes every tool with its parameters, required and optional', () => {
  const prompt = toolPrompt(TOOLS)
  assert.match(prompt, /<tool_call>\{"name": "TOOL_NAME", "arguments": \{\.\.\.\}\}<\/tool_call>/)
  assert.match(prompt, /- najd_files_read: Read a text file\.\n {4}path: string — Absolute path\n {4}lines\?: integer/)
  assert.match(prompt, /kind: string one of "docx"\/"xlsx"\/"pptx"/)
  assert.throws(() => toolPrompt([{ type: 'function', name: 'bad name!' }]), { code: 'INVALID_INPUT' })
})

test('a call is found in a tag, an unclosed tag, a json fence or a bare object, and an ordinary answer stays an answer', () => {
  assert.deepEqual(extractCall('Reading it.\n<tool_call>{"name": "najd_files_read", "arguments": {"path": "C:\\\\a.txt"}}</tool_call>'), { name: 'najd_files_read', arguments: { path: 'C:\\a.txt' }, raw: '<tool_call>{"name": "najd_files_read", "arguments": {"path": "C:\\\\a.txt"}}</tool_call>', text: 'Reading it.' })
  assert.equal(extractCall('<tool_call>{"name": "najd_files_read", "arguments": {"path": "x"}}').name, 'najd_files_read', 'a missing closing tag (cut by a stop token)')
  assert.equal(extractCall('```json\n{"name": "najd_office_create", "arguments": {"kind": "docx"}}\n```').name, 'najd_office_create')
  assert.deepEqual(extractCall('{"name": "najd_files_read", "parameters": "{\\"path\\": \\"y\\"}"}').arguments, { path: 'y' }, 'parameters and stringified arguments are accepted')
  assert.equal(extractCall('The capital of Saudi Arabia is Riyadh.'), null)
  assert.equal(extractCall('{"city": "Riyadh"}'), null, 'a JSON answer without a name is an answer')
  assert.equal(extractCall('<tool_call>{not json}</tool_call>').broken, true)
})

test('common open models\' own call formats are understood too (live 2026-11-09: LFM2.5 wrote its native format inside NAJD)', () => {
  const lfm = extractCall("<|tool_call_start|>[najd_files_read(path='C:\\\\w\\\\notes.txt', lines=20, full=True)]<|tool_call_end|>")
  assert.deepEqual([lfm.name, lfm.arguments], ['najd_files_read', { path: 'C:\\w\\notes.txt', lines: 20, full: true }])
  assert.deepEqual(extractCall('[najd_office_create(kind="docx", rows=[["a", 1], ["b", 2]])]').arguments, { kind: 'docx', rows: [['a', 1], ['b', 2]] }, 'Llama 3.2 style, the whole reply')
  assert.equal(extractCall('See [note(1)] in the text.'), null, 'a bracket in prose is not a call')
  assert.equal(extractCall("[najd_files_read(path='a'"), null, 'an unfinished call is not a call')
  assert.deepEqual(extractCall('[TOOL_CALLS][{"name": "najd_files_read", "arguments": {"path": "b"}}]').arguments, { path: 'b' }, 'Mistral')
  assert.deepEqual(extractCall('<function=najd_files_read>{"path": "c"}</function>').arguments, { path: 'c' }, 'Llama 3.1')
  assert.deepEqual(extractCall('<function=najd_office_create>\n<parameter=kind>\nxlsx\n</parameter>\n<parameter=rows>\n[[1]]\n</parameter>\n</function>').arguments, { kind: 'xlsx', rows: [[1]] }, 'qwen3-coder')
  // A misspelled name is read as the one loaded tool within two edits; ambiguous or distant names are not.
  assert.deepEqual(parseReply({ content: '<tool_call>{"name": "nadj_files_read", "arguments": {"path": "a"}}</tool_call>' }, TOOLS).message.tool_calls, [{ function: { name: 'najd_files_read', arguments: { path: 'a' } } }])
  assert.match(parseReply({ content: '<tool_call>{"name": "nadj_files_read", "arguments": {}}</tool_call>' }, TOOLS).problem, /najd_files_read is not valid: arguments\.path is required/, 'the corrected tool is still validated')
  assert.match(parseReply({ content: '<tool_call>{"name": "delete_files", "arguments": {}}</tool_call>' }, TOOLS).problem, /no tool named/)
  const twins = [...TOOLS, { type: 'function', name: 'najd_files_readx', parameters: { type: 'object', properties: {} } }]
  assert.match(parseReply({ content: '<tool_call>{"name": "najd_file_read", "arguments": {"path": "a"}}</tool_call>' }, twins).problem, /no tool named/, 'two close tools: no guess')
  // Validation still applies to every format.
  assert.match(parseReply({ content: "<|tool_call_start|>[najd_files_read()]<|tool_call_end|>" }, TOOLS).problem, /arguments\.path is required/)
})

test('calls are validated against the tool schema before anything runs', () => {
  const read = TOOLS[0].parameters, office = TOOLS[1].parameters
  assert.deepEqual(schemaProblems(read, { path: 'C:\\a.txt', lines: 20 }), [])
  assert.deepEqual(schemaProblems(read, {}), ['arguments.path is required'])
  assert.deepEqual(schemaProblems(read, { path: 5 }), ['arguments.path must be string'])
  assert.deepEqual(schemaProblems(read, { path: 'a', lines: 2.5 }), ['arguments.lines must be integer'])
  assert.deepEqual(schemaProblems(read, { path: 'a', rm: true }), ['arguments.rm is not a parameter of this tool'])
  assert.deepEqual(schemaProblems(office, { kind: 'exe' }), ['arguments.kind must be one of "docx", "xlsx", "pptx"'])
  assert.deepEqual(schemaProblems(office, { kind: 'xlsx', rows: [[1], 'x'] }), ['arguments.rows[1] must be array'])
  assert.equal(parseReply({ content: '<tool_call>{"name": "rm_rf", "arguments": {}}</tool_call>' }, TOOLS).problem.startsWith('There is no tool named "rm_rf"'), true)
  const good = parseReply({ content: '<think>need the file</think>Let me read it. <tool_call>{"name": "najd_files_read", "arguments": {"path": "a"}}</tool_call>' }, TOOLS)
  assert.deepEqual(good.message.tool_calls, [{ function: { name: 'najd_files_read', arguments: { path: 'a' } } }])
  assert.equal(good.message.content, '<think>need the file</think>Let me read it.', 'the thinking and prose before the call are kept')
  // Ollama parses some families' tags itself: the call arrives in tool_calls and is validated just the same.
  assert.deepEqual(parseReply({ content: '', tool_calls: [{ function: { name: 'najd_files_read', arguments: { path: 'a' } } }] }, TOOLS).message.tool_calls, [{ function: { name: 'najd_files_read', arguments: { path: 'a' } } }])
  assert.match(parseReply({ content: '', tool_calls: [{ function: { name: 'najd_files_read', arguments: {} } }] }, TOOLS).problem, /arguments\.path is required/)
})

test('earlier calls and results are written back as text a template without tool support can hold', () => {
  const messages = textMessages(nameToolResults([{ role: 'system', content: 's' }, { role: 'user', content: 'q' },
    { role: 'assistant', content: '', tool_calls: [{ function: { name: 'najd_files_read', arguments: { path: 'a' } } }] }, { role: 'tool', content: 'hello' }]))
  assert.deepEqual(messages.slice(2), [
    { role: 'assistant', content: '<tool_call>{"name":"najd_files_read","arguments":{"path":"a"}}</tool_call>' },
    { role: 'user', content: '<tool_response name="najd_files_read">\nhello\n</tool_response>' }])
})

async function fakeOllama(t, replies, { caps = ['completion'] } = {}) {
  const bodies = []
  const server = http.createServer(async (req, res) => {
    let raw = ''
    for await (const chunk of req) raw += chunk
    res.setHeader('Content-Type', 'application/json')
    if (req.url === '/api/show') return res.end(JSON.stringify({ capabilities: caps, model_info: { 'gemma.context_length': 8192 } }))
    const body = JSON.parse(raw); bodies.push(body)
    const reply = replies.shift() ?? 'done'
    res.end(JSON.stringify({ done: true, done_reason: 'stop', prompt_eval_count: 100, eval_count: 10, message: { role: 'assistant', content: reply } }))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  return { client: createOllamaClient({ baseUrl: 'http://127.0.0.1:' + server.address().port }), bodies }
}

test('a local model without native tool calling runs tools through the validated text protocol', async t => {
  const { client, bodies } = await fakeOllama(t, ['<tool_call>{"name": "najd_files_read", "arguments": {"path": "C:\\\\notes.txt"}}</tool_call>'])
  const turn = { tools: TOOLS, input: [{ role: 'user', content: 'Read C:\\notes.txt' }] }
  const result = await client.chat({ modelName: 'gemma2:2b', history: [{ role: 'user', text: 'Read C:\\notes.txt' }], systemPrompt: 'Be brief.', agentTurn: turn })
  assert.equal(result.kind, 'agent-tools')
  assert.deepEqual(result.calls.map(call => [call.name, JSON.parse(call.arguments)]), [['najd_files_read', { path: 'C:\\notes.txt' }]])
  assert.equal(bodies[0].tools, undefined, 'no native tools field is sent to a model that has none')
  assert.match(bodies[0].messages[0].content, /^Be brief\.\n\n# Tools/)
  assert.equal(bodies[0].options.num_ctx, 8192, 'the window the model reports')
  // The tool result goes back as text and the model answers.
  const next = await client.chat({ modelName: 'gemma2:2b', history: [{ role: 'user', text: 'Read C:\\notes.txt' }], agentTurn: { tools: TOOLS, input: [...turn.input, ...result.items, { type: 'function_call_output', call_id: result.calls[0].call_id, output: 'hello' }] } })
  assert.deepEqual([next.kind, next.text], ['message', 'done'])
  assert.deepEqual(bodies[1].messages.slice(-2).map(message => message.role), ['assistant', 'user'])
  assert.match(bodies[1].messages.at(-1).content, /<tool_response name="najd_files_read">\nhello/)
})

test('an invalid text call is sent back with the reason and never runs; after the retries the model is told it could not run', async t => {
  const { client, bodies } = await fakeOllama(t, ['<tool_call>{"name": "najd_files_read", "arguments": {}}</tool_call>', '<tool_call>{"name": "najd_files_read", "arguments": {"path": "a.txt"}}</tool_call>'])
  const result = await client.chat({ modelName: 'gemma2:2b', history: [{ role: 'user', text: 'Read a.txt' }], agentTurn: { tools: TOOLS, input: [{ role: 'user', content: 'Read a.txt' }] } })
  assert.equal(result.kind, 'agent-tools')
  assert.equal(bodies.length, 2)
  assert.match(bodies[1].messages.at(-1).content, /<tool_error>The call to najd_files_read is not valid: arguments\.path is required\./)
  assert.deepEqual([result.usage.input, result.usage.output], [200, 20], 'both attempts are counted')
  const stubborn = await fakeOllama(t, ['<tool_call>{"name": "delete_everything", "arguments": {}}</tool_call>', '<tool_call>{"name": "delete_everything", "arguments": {}}</tool_call>', '<tool_call>{"name": "delete_everything", "arguments": {}}</tool_call>'])
  const refused = await stubborn.client.chat({ modelName: 'gemma2:2b', history: [{ role: 'user', text: 'x' }], agentTurn: { tools: TOOLS, input: [{ role: 'user', content: 'x' }] } })
  assert.equal(refused.kind, 'message')
  assert.match(refused.text, /could not run the tool.*no tool named "delete_everything"/)
  assert.equal(stubborn.bodies.length, 3)
})

test('a model that declares native tools keeps the native path, and an embedding-only model is refused', async t => {
  const native = await fakeOllama(t, ['ok'], { caps: ['completion', 'tools'] })
  await native.client.chat({ modelName: 'qwen3:8b', history: [{ role: 'user', text: 'hi' }], agentTurn: { tools: TOOLS, input: [{ role: 'user', content: 'hi' }] } })
  assert.equal(native.bodies[0].tools.length, 2)
  const embed = await fakeOllama(t, [], { caps: ['embedding'] })
  await assert.rejects(embed.client.chat({ modelName: 'nomic-embed-text', history: [{ role: 'user', text: 'hi' }], agentTurn: { tools: TOOLS, input: [{ role: 'user', content: 'hi' }] } }), { code: 'TOOLS_NOT_SUPPORTED' })
})
