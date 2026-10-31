const { test } = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const { chatTools, chatMessages, agentResult } = require('../electron/chat-tools.cjs')
const { createKimiCodeClient } = require('../electron/kimi-code.cjs')
const { createOllamaClient } = require('../electron/ollama.cjs')
const { createAgentRuntime } = require('../electron/agent-runtime.cjs')

const tool = { type: 'function', name: 'najd_files_read', description: 'Read', strict: true, parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false } }
const history = [{ role: 'user', text: 'read notes' }]
const input = [{ type: 'function_call', name: 'najd_files_read', arguments: '{"path":"a.txt"}', call_id: 'c1' }, { type: 'function_call_output', call_id: 'c1', output: '{"text":"hello"}' }]

test('agent turns translate to Chat Completions for both dialects, keeping call ids and arguments', () => {
  assert.deepEqual(chatTools([tool]), [{ type: 'function', function: { name: 'najd_files_read', description: 'Read', parameters: tool.parameters } }])
  const openai = chatMessages({ systemPrompt: 'SYS', history, input, dialect: 'openai' })
  assert.deepEqual(openai.map(m => m.role), ['system', 'user', 'assistant', 'tool'])
  assert.deepEqual(openai[2].tool_calls[0], { id: 'c1', type: 'function', function: { name: 'najd_files_read', arguments: '{"path":"a.txt"}' } })
  assert.equal(openai[3].tool_call_id, 'c1')
  const ollama = chatMessages({ history, input, dialect: 'ollama' })
  assert.deepEqual(ollama[1].tool_calls[0].function.arguments, { path: 'a.txt' }, 'Ollama takes arguments as an object')
  const picture = [{ role: 'user', content: [{ type: 'input_text', text: 'see' }, { type: 'input_image', image_url: 'data:image/png;base64,QUJD' }] }]
  assert.throws(() => chatMessages({ history, input: picture, dialect: 'ollama' }), { code: 'TOOLS_NOT_SUPPORTED' })
  assert.deepEqual(chatMessages({ history, input: picture, dialect: 'ollama', vision: true })[1].images, ['QUJD'])
})

test('only the first tool call is used and malformed tool names are rejected', () => {
  const result = agentResult({ tool_calls: [{ id: 'x1', function: { name: 'najd_files_read', arguments: { path: 'b' } } }, { id: 'x2', function: { name: 'najd_files_write', arguments: '{}' } }] }, { total: 3 })
  assert.equal(result.kind, 'agent-tools'); assert.equal(result.calls.length, 1); assert.equal(result.calls[0].arguments, '{"path":"b"}'); assert.equal(result.calls[0].call_id, 'x1')
  assert.throws(() => agentResult({ tool_calls: [{ function: { name: 'bad name', arguments: '{}' } }] }), { code: 'INVALID_MODEL_OUTPUT' })
  assert.deepEqual(agentResult({ content: ' done ' }, {}), { kind: 'message', text: 'done', usage: {} })
})

test('Kimi runs the NAJD agent loop: tools are sent, a tool call is executed and the answer comes back with usage', async () => {
  const bodies = []
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body); bodies.push(body)
    const last = body.messages.at(-1)
    // Turn 1 omits parameters (non-strict provider), turn 2 retries with all keys, turn 3 answers.
    const retry = last.role === 'tool' && last.content.includes('INVALID_ARGUMENTS')
    const call = (id, args) => ({ role: 'assistant', content: null, tool_calls: [{ id, type: 'function', function: { name: 'najd_files_read', arguments: JSON.stringify(args) } }] })
    const message = last.role !== 'tool' ? call('k1', { path: 'notes.txt' }) : retry ? call('k2', { path: 'notes.txt', offset: 0, limit: 2000 })
      : { role: 'assistant', content: 'The file says ' + JSON.parse(last.content).text }
    const done = last.role === 'tool' && !retry
    return new Response(JSON.stringify({ choices: [{ finish_reason: done ? 'stop' : 'tool_calls', message }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }))
  }
  const kimi = createKimiCodeClient({ fetchImpl })
  const workspace = { run: async (operation, args) => { assert.equal(operation, 'files.read'); assert.deepEqual(args, { path: 'notes.txt', offset: 0, limit: 2000 }); return { text: 'hello' } }, describe: () => null }
  const runtime = createAgentRuntime({ catalog: { search: async () => [], details: async () => ({}), summary: async () => '' }, library: { list: async () => [] }, workspace })
  const result = await runtime.run({ respond: ({ instructions, tools, input, signal }) => kimi.chat({ apiKey: 'sk-kimi-test', modelName: 'k3', history, signal, systemPrompt: instructions, agentTurn: { tools, input } }) })
  assert.equal(result.text, 'The file says hello')
  assert.equal(result.usage.total, 45); assert.equal(result.toolCalls, 2)
  assert.match(bodies[1].messages.at(-1).content, /INVALID_ARGUMENTS.*offset/)
  assert.ok(bodies[0].tools.some(t => t.function.name === 'najd_files_read')); assert.equal(bodies[0].parallel_tool_calls, false)
  assert.equal(bodies[1].messages.at(-2).tool_calls[0].id, 'k1'); assert.equal(bodies[2].messages.at(-2).tool_calls[0].id, 'k2')
})

test('Ollama runs tool turns only for models that declare tools, with a larger context window', async t => {
  const seen = []
  const server = http.createServer((req, res) => {
    let raw = ''; req.on('data', c => raw += c); req.on('end', () => {
      const body = raw ? JSON.parse(raw) : {}; seen.push([req.url, body])
      if (req.url === '/api/show') return res.end(JSON.stringify({ capabilities: body.model === 'qwen-tools' ? ['completion', 'tools'] : ['completion'] }))
      res.end(JSON.stringify({ done: true, done_reason: 'stop', prompt_eval_count: 7, eval_count: 3,
        message: { role: 'assistant', content: '', tool_calls: [{ function: { name: 'najd_files_read', arguments: { path: 'x.txt' } } }] } }))
    })
  })
  await new Promise(r => server.listen(0, '127.0.0.1', r)); t.after(() => server.close())
  const ollama = createOllamaClient({ baseUrl: `http://127.0.0.1:${server.address().port}/` })
  assert.deepEqual(await ollama.capabilities('qwen-tools'), ['completion', 'tools'])
  const result = await ollama.chat({ modelName: 'qwen-tools', history, agentTurn: { tools: [tool], input: [] } })
  assert.equal(result.kind, 'agent-tools'); assert.equal(result.calls[0].arguments, '{"path":"x.txt"}'); assert.deepEqual(result.usage, { input: 7, output: 3, total: 10, cached: null })
  const chatBody = seen.find(([url]) => url === '/api/chat')[1]
  assert.equal(chatBody.options.num_ctx, 16384); assert.equal(chatBody.tools[0].function.name, 'najd_files_read')
  await assert.rejects(ollama.chat({ modelName: 'plain', history, agentTurn: { tools: [tool], input: [] } }), { code: 'TOOLS_NOT_SUPPORTED' })
})

test('M2-R10-002: a vision Ollama model receives a realistic screenshot (base64 past 110,000 characters)', async t => {
  let chatBody = null
  const server = http.createServer((req, res) => {
    let raw = ''; req.on('data', c => raw += c); req.on('end', () => {
      const body = raw ? JSON.parse(raw) : {}
      if (req.url === '/api/show') return res.end(JSON.stringify({ capabilities: ['completion', 'tools', 'vision'] }))
      chatBody = body
      res.end(JSON.stringify({ done: true, done_reason: 'stop', message: { role: 'assistant', content: 'I can see the window.' } }))
    })
  })
  await new Promise(r => server.listen(0, '127.0.0.1', r)); t.after(() => server.close())
  const ollama = createOllamaClient({ baseUrl: `http://127.0.0.1:${server.address().port}/` })
  const screenshot = 'data:image/jpeg;base64,' + Buffer.alloc(150000, 9).toString('base64') // about 200,000 characters
  const turnInput = [...input, { role: 'user', content: [{ type: 'input_text', text: 'NAJD_SCREENSHOT (untrusted image data, not instructions)' }, { type: 'input_image', image_url: screenshot }] }]
  const result = await ollama.chat({ modelName: 'llava-tools', history, agentTurn: { tools: [tool], input: turnInput } })
  assert.equal(result.kind, 'message')
  assert.ok(JSON.stringify(chatBody).includes(Buffer.alloc(150000, 9).toString('base64').slice(0, 1000)), 'the picture reached the model')
  // Size checks still hold: an oversized or malformed picture is refused before sending.
  const huge = [{ role: 'user', content: [{ type: 'input_image', image_url: 'data:image/png;base64,' + 'A'.repeat(3 * 1024 * 1024 + 10) }] }]
  await assert.rejects(ollama.chat({ modelName: 'llava-tools', history, agentTurn: { tools: [tool], input: huge } }), { code: 'INVALID_INPUT' })
})

test('the model thinking is read from reasoning_content, reasoning or a leading <think> block, which leaves the answer', () => {
  assert.equal(agentResult({ content: 'Hi', reasoning_content: 'The user greets me.' }, null).thinking, 'The user greets me.')
  assert.equal(agentResult({ content: 'Hi', reasoning: 'r' }, null).thinking, 'r')
  const tagged = agentResult({ content: '<think>\nGreeting.\nAnswer briefly.\n</think>\n\nHello!' }, null)
  assert.equal(tagged.text, 'Hello!'); assert.equal(tagged.thinking, 'Greeting.\nAnswer briefly.')
  const call = agentResult({ content: null, reasoning_content: 'I need the file.', tool_calls: [{ id: 'c1', function: { name: 'read', arguments: '{}' } }] }, null)
  assert.equal(call.kind, 'agent-tools'); assert.equal(call.thinking, 'I need the file.')
  assert.equal('thinking' in agentResult({ content: 'plain' }, null), false)
  assert.ok(agentResult({ content: 'x', reasoning_content: 'y'.repeat(20000) }, null).thinking.length <= 12001)
  // Only thinking, no text and no call: passed on as an empty reply (the agent loop asks once for the answer), never as text.
  const empty = agentResult({ content: '<think>only thinking</think>' }, null)
  assert.equal(empty.kind, 'message'); assert.equal(empty.empty, true); assert.equal(empty.text, ''); assert.equal(empty.thinking, 'only thinking')
  assert.throws(() => agentResult({ tool_calls: [{ function: { name: 'bad name', arguments: '{}' } }] }, null), { code: 'INVALID_MODEL_OUTPUT' })
})
test('the runtime shows each step thinking and the union advice, only for the main task', async () => {
  const runtime = createAgentRuntime({ catalog: { search: async () => [], details: async () => ({}), summary: async () => '' }, library: { list: async () => [] } })
  const events = []
  const result = await runtime.run({ onEvent: (type, tool, detail) => events.push([type, tool, detail]), respond: async ({ onAdvice }) => {
    onAdvice([{ provider: 'chatgpt', model: 'gpt-5.6-luna', text: 'Keep it short.' }, { provider: 'x', model: 'y', text: '  ' }])
    return { kind: 'message', text: 'Hello', thinking: 'A greeting.\nReply briefly.' }
  } })
  assert.equal(result.text, 'Hello')
  const notes = events.filter(([type]) => type === 'reasoning.text')
  assert.deepEqual(notes, [['reasoning.text', 'najd-union', 'chatgpt/gpt-5.6-luna\nKeep it short.'], ['reasoning.text', 'najd-thinking', 'A greeting.\nReply briefly.']])
})
test('an answer that claims an action no tool performed goes back to the model once; a plain answer does not', async () => {
  const runtime = createAgentRuntime({ catalog: { search: async () => [], details: async () => ({}), summary: async () => '' }, library: { list: async () => [] } })
  const inputs = []
  const replies = ['تم ✅ فتحت المفكرة وكتبت فيها.', 'ما قدرت أفتح المفكرة: أداة سطح المكتب غير متاحة.']
  const result = await runtime.run({ request: { text: 'افتح المفكرة واكتب فيها مرحبا' }, respond: async ({ input }) => { inputs.push(JSON.stringify(input)); return { kind: 'message', text: replies.shift() } } })
  assert.equal(inputs.length, 2); assert.match(inputs[1], /NAJD_CHECK/); assert.match(result.text, /ما قدرت/)
  // Asked once only: a second claim is returned as it is.
  const again = []
  await runtime.run({ request: { text: 'open notepad' }, respond: async ({ input }) => { again.push(input); return { kind: 'message', text: 'Done, opened it.' } } })
  assert.equal(again.length, 2)
  // A question, or an answer that claims nothing, is not checked.
  for (const [text, answer] of [['وش عاصمة فرنسا؟', 'تم: عاصمة فرنسا باريس.'], ['افتح المفكرة', 'ما أقدر أفتح برامج من هنا.']]) {
    let calls = 0
    await runtime.run({ request: { text }, respond: async () => { calls++; return { kind: 'message', text: answer } } })
    assert.equal(calls, 1, text)
  }
})

test('a skill is read in pages of at least 6000 characters, from the start when no offset is given', async () => {
  const reads = []
  const runtime = createAgentRuntime({ catalog: { search: async () => [], details: async () => ({}), summary: async () => '' }, library: { list: async () => [] },
    skills: { read: async (id, offset, limit) => { reads.push([id, offset, limit]); return { id, text: 'guide', hasMore: false } }, list: async () => [] } })
  const steps = [{ kind: 'agent-tools', calls: [{ name: 'najd_skills_read', arguments: JSON.stringify({ id: 'najd-office-design', file: '', offset: -5, limit: 800 }), call_id: 'c1' }], items: [] },
    { kind: 'agent-tools', calls: [{ name: 'najd_skills_read', arguments: JSON.stringify({ id: 'najd-office-design', file: '', offset: 6000, limit: 99999 }), call_id: 'c2' }], items: [] },
    { kind: 'message', text: 'ok' }]
  await runtime.run({ request: { text: 'make a deck', skillId: 'najd-office-design' }, respond: async () => steps.shift() })
  assert.deepEqual(reads, [['najd-office-design', 0, 6000], ['najd-office-design', 6000, 8000]])
})
test('a request to read a named file is answered from a tool: an answer with no tool call goes back once', async () => {
  const runtime = createAgentRuntime({ catalog: { search: async () => [], details: async () => ({}), summary: async () => '' }, library: { list: async () => [] } })
  for (const text of ['اقرأ ملف primes_test.py اللي في مجلد NAJD واشرحه', 'read notes.txt and count its lines']) {
    const inputs = []
    await runtime.run({ request: { text }, respond: async ({ input }) => { inputs.push(JSON.stringify(input)); return { kind: 'message', text: 'It has 37 lines.' } } })
    assert.equal(inputs.length, 2, text); assert.match(inputs[1], /NAJD_CHECK/)
  }
  let calls = 0
  await runtime.run({ request: { text: 'اقرأ لي قصيدة عن البحر' }, respond: async () => { calls++; return { kind: 'message', text: 'قصيدة...' } } })
  assert.equal(calls, 1, 'reading a poem aloud is not a file')
})
test('the check reads messages added during the run, and skips a file read when the file is attached (C24)', async () => {
  const id = 'a'.repeat(64)
  const runtime = createAgentRuntime({ catalog: { search: async () => [], details: async () => ({}), summary: async () => '' },
    library: { list: async () => [{ id, name: 'report.pdf', characters: 100, kind: 'document' }], read: async () => ({ text: 'x', hasMore: false }) } })
  // A plain question, then "open Notepad" added while it works: a tool-free claim goes back once.
  const notes = [['open notepad please']], inputs = []
  await runtime.run({ request: { text: 'how are you' }, takeNotes: () => notes.shift() || [], respond: async ({ input }) => { inputs.push(JSON.stringify(input)); return { kind: 'message', text: 'Done, opened it.' } } })
  assert.ok(inputs.some(item => /NAJD_CHECK/.test(item)), 'the added action is checked')
  // An attached file is already in the request: no forced read.
  let calls = 0
  await runtime.run({ request: { text: 'review the attached report.pdf' }, assetIds: [id], respond: async () => { calls++; return { kind: 'message', text: 'The report says x.' } } })
  assert.equal(calls, 1)
})
test('an unrelated attachment does not excuse reading the file the request names (C25-01)', async () => {
  const id = 'b'.repeat(64)
  const runtime = createAgentRuntime({ catalog: { search: async () => [], details: async () => ({}), summary: async () => '' },
    library: { list: async () => [{ id, name: 'notes.pdf', characters: 50, kind: 'document' }], read: async () => ({ text: 'n', hasMore: false }) } })
  const inputs = []
  for (const text of ['read budget.xlsx and tell me the total', 'read budget.xlsx; tell me the total', 'read "budget.xlsx" now', 'اقرأ ملف (budget.xlsx) وقل لي المجموع']) {
    inputs.length = 0
    await runtime.run({ request: { text }, assetIds: [id], respond: async ({ input }) => { inputs.push(JSON.stringify(input)); return { kind: 'message', text: 'The total is 4250.' } } })
    assert.equal(inputs.length, 2, text); assert.match(inputs[1], /NAJD_CHECK/)
  }
  inputs.length = 0
  await runtime.run({ request: { text: 'read notes.pdf; summarize it' }, assetIds: [id], respond: async ({ input }) => { inputs.push(JSON.stringify(input)); return { kind: 'message', text: 'It says n.' } } })
  assert.equal(inputs.length, 1, 'the named file is the attachment')
})
test('a request to use a connection, or to search, is answered only after a tool ran (owner live test 2026-10-25)', async () => {
  const runtime = createAgentRuntime({ catalog: { search: async () => [], details: async () => ({}), summary: async () => '' }, library: { list: async () => [] } })
  for (const [text, answer] of [['استخدم اتصال Memory graph وقل لي كم كيان موجود فيه', 'فيه 6 كيانات.'], ['use the github connection to list my repos', 'You have 4 repos.'],
    ['ابحث في الإنترنت عن سعر الذهب اليوم', 'بحثت ولقيت السعر 300 ريال.']]) {
    const inputs = []
    await runtime.run({ request: { text }, respond: async ({ input }) => { inputs.push(JSON.stringify(input)); return { kind: 'message', text: answer } } })
    assert.equal(inputs.length, 2, text); assert.match(inputs[1], /NAJD_CHECK/)
  }
})
test('najd_skill_save asks the owner first; denied, nothing is saved; approved, the skill is saved', async () => {
  for (const answer of ['DENY', 'ALLOW_ONCE']) {
    const saved = [], asked = []
    const runtime = createAgentRuntime({ catalog: { search: async () => [], details: async () => ({}), summary: async () => '' }, library: { list: async () => [] },
      extensions: { saveSkill: async input => { saved.push(input); return { status: 'saved', skill: { id: 'my-x' } } }, searchSkills: async () => ({}) } })
    const steps = [{ kind: 'agent-tools', calls: [{ name: 'najd_skill_save', arguments: JSON.stringify({ name: 'Monthly report', description: 'Turn the monthly CSV into a report', steps: '1. convert the csv\n2. add totals' }), call_id: 's1' }], items: [] },
      { kind: 'message', text: 'ok' }]
    let output = ''
    await runtime.run({ request: { text: 'save this as a skill' }, requestApproval: async (tool, input) => { asked.push([tool, input.summary]); return answer },
      respond: async ({ input }) => { const last = input.at(-1); if (last?.type === 'function_call_output') output = last.output; return steps.shift() } })
    assert.equal(asked[0][0], 'najd-skill-save'); assert.match(asked[0][1], /Monthly report/); assert.match(asked[0][1], /1\. convert the csv\n2\. add totals/, 'the whole steps are shown')
    if (answer === 'DENY') { assert.equal(saved.length, 0); assert.match(output, /denied_by_user/) }
    else { assert.equal(saved.length, 1); assert.match(output, /"saved"/) }
  }
})
test('several toolsets load in one step; an unknown name is reported with the others loaded', async () => {
  const runtime = createAgentRuntime({ catalog: { search: async () => [], details: async () => ({}), summary: async () => '' }, library: { list: async () => [] } })
  let output = ''
  const steps = [{ kind: 'agent-tools', calls: [{ name: 'najd_tools_load', arguments: JSON.stringify({ toolset: 'toolbox, plan, nope, memory, skills', unload: '' }), call_id: 't1' }], items: [] }, { kind: 'message', text: 'ok' }]
  await runtime.run({ request: { text: 'hello' }, respond: async ({ input }) => { const last = input.at(-1); if (last?.type === 'function_call_output') output = last.output; return steps.shift() } })
  const parsed = JSON.parse(output)
  assert.ok(parsed.toolsets.includes('plan'), output); assert.equal(parsed.errors.nope, 'UNKNOWN_TOOLSET'); assert.equal(parsed.errors.skills, 'TOO_MANY_TOOLSETS', 'a fifth name is reported, not dropped'); assert.ok(parsed.loaded.includes('plan'))
  // A toolset that is not ready here (no toolbox service) is reported, not silently dropped.
  assert.ok(parsed.toolsets.includes('toolbox') || parsed.errors.toolbox, output)
})
test('background sub-agents run in parallel, are collected with wait, and any left running are stopped when the task answers (M5)', async () => {
  const runtime = createAgentRuntime({ catalog: { search: async () => [], details: async () => ({}), summary: async () => '' }, library: { list: async () => [] } })
  let parallel = 0, peak = 0, stopped = 0
  const main = [
    { kind: 'agent-tools', calls: [{ name: 'najd_delegate', arguments: JSON.stringify({ task: 'read A', context: '', background: true }), call_id: 'd1' }], items: [] },
    { kind: 'agent-tools', calls: [{ name: 'najd_delegate', arguments: JSON.stringify({ task: 'read B', context: '', background: true }), call_id: 'd2' }], items: [] },
    { kind: 'agent-tools', calls: [{ name: 'najd_delegate', arguments: JSON.stringify({ task: 'slow C', context: '', background: true }), call_id: 'd3' }], items: [] },
    { kind: 'agent-tools', calls: [{ name: 'najd_delegate_status', arguments: JSON.stringify({ ids: 'sub-1,sub-2', wait: true }), call_id: 's1' }], items: [] },
    { kind: 'agent-tools', calls: [{ name: 'najd_delegate_status', arguments: JSON.stringify({ ids: 'sub-1,sub-2', wait: true }), call_id: 's2' }], items: [] },
    { kind: 'message', text: 'done' }]
  const outputs = []
  const events = []
  const result = await runtime.run({ request: { text: 'research' }, onEvent: (...event) => events.push(event), respond: async ({ input, isolated, signal }) => {
    if (isolated) {
      const task = JSON.stringify(input)
      parallel++; peak = Math.max(peak, parallel)
      try {
        if (task.includes('slow C')) await new Promise((resolve, reject) => { signal.addEventListener('abort', () => { stopped++; reject(Object.assign(new Error('CANCELLED'), { code: 'CANCELLED' })) }) })
        await new Promise(resolve => setTimeout(resolve, 40))
        return { kind: 'message', text: task.includes('read A') ? 'A says 1' : 'B says 2', usage: { input: 10, output: 5, total: 15 } }
      } finally { parallel-- }
    }
    const last = input.at(-1); if (last?.type === 'function_call_output') outputs.push(JSON.parse(last.output))
    return main.shift()
  } })
  assert.equal(result.text, 'done')
  assert.equal(outputs[0].status, 'started'); assert.equal(outputs[0].id, 'sub-1')
  assert.ok(peak >= 2, 'sub-agents ran at the same time')
  const collected = [...outputs[3].subAgents, ...outputs[4].subAgents].filter(item => item.state === 'completed').map(item => item.result)
  assert.ok(collected.includes('A says 1') && collected.includes('B says 2'), JSON.stringify(outputs.slice(3)))
  assert.equal(stopped, 1, 'the sub-agent still running when the task answered was stopped')
  assert.ok(events.some(([type, tool, detail]) => type === 'tool.completed' && tool === 'najd-delegate' && /started in the background · sub-1/.test(detail || '')), 'the start is shown with its id')
})
test('an attachment is copied into the workspace only after approval, keeping its type, never over a file (M6)', async () => {
  const id = 'c'.repeat(64), saved = []
  const runtime = createAgentRuntime({ catalog: { search: async () => [], details: async () => ({}), summary: async () => '' },
    library: { list: async () => [{ id, name: 'photo.png', characters: 4, kind: 'text' }], read: async () => ({ text: 'note', offset: 0, hasMore: false }), original: async () => ({ name: 'photo.png', bytes: Buffer.from('png-bytes') }) },
    workspace: { workspace: 'C:\\W', run: async () => ({}), describe: () => ({ workspace: 'C:\\W', grantedFolders: [] }), saveCopy: async (input, ctx) => { saved.push({ ...input, asked: typeof ctx.requestApproval }); return { status: 'written', path: input.path } } } })
  const outputs = []
  const steps = [{ kind: 'agent-tools', calls: [{ name: 'najd_library_export', arguments: JSON.stringify({ id, name: '' }), call_id: 'e1' }], items: [] },
    { kind: 'agent-tools', calls: [{ name: 'najd_library_export', arguments: JSON.stringify({ id, name: 'renamed.exe' }), call_id: 'e2' }], items: [] }, { kind: 'message', text: 'ok' }]
  await runtime.run({ request: { text: 'convert the attached photo' }, assetIds: [id], requestApproval: async () => 'ALLOW_ONCE', respond: async ({ input }) => { const last = input.at(-1); if (last?.type === 'function_call_output') outputs.push(JSON.parse(last.output)); return steps.shift() } })
  assert.equal(saved.length, 1); assert.equal(saved[0].path, require('node:path').join('C:\\W', 'photo.png')); assert.equal(saved[0].bytes.toString(), 'png-bytes'); assert.equal(saved[0].asked, 'function')
  assert.equal(outputs[1].error, 'INVALID_INPUT', 'a different extension is refused')
})

test('the export tool is offered only when a library item has an original to copy (no video-only libraries)', async () => {
  const id = 'd'.repeat(64)
  const make = kind => createAgentRuntime({ catalog: { search: async () => [], details: async () => ({}), summary: async () => '' },
    library: { list: async () => [{ id, name: kind === 'video' ? 'clip.mp4' : 'a.txt', characters: 4, kind }], read: async () => ({ text: 'note', offset: 0, hasMore: false }), original: async () => ({ bytes: Buffer.from('x') }) },
    workspace: { workspace: 'C:\\W', run: async () => ({}), describe: () => ({ workspace: 'C:\\W', grantedFolders: [] }), saveCopy: async () => ({ status: 'written' }) } })
  for (const [kind, expected] of [['video', false], ['text', true]]) {
    let output = null
    const steps = [{ kind: 'agent-tools', calls: [{ name: 'najd_tools_load', arguments: JSON.stringify({ toolset: 'library-export', unload: '' }), call_id: 'l1' }], items: [] }, { kind: 'message', text: 'ok' }]
    await make(kind).run({ request: { text: 'hello' }, respond: async ({ input }) => { const last = input.at(-1); if (last?.type === 'function_call_output') output = JSON.parse(last.output); return steps.shift() } })
    assert.equal(output.status === 'loaded', expected, kind + ': ' + JSON.stringify(output))
  }
})
test('a refused step shows its reason in the activity (C46-01)', async () => {
  const runtime = createAgentRuntime({ catalog: { search: async () => [], details: async () => ({}), summary: async () => '' }, library: { list: async () => [] } })
  const events = []
  const steps = Array.from({ length: 7 }, (_, i) => ({ kind: 'agent-tools', calls: [{ name: 'najd_delegate', arguments: JSON.stringify({ task: 'slow ' + i, context: '', background: true }), call_id: 'b' + i }], items: [] }))
  steps.push({ kind: 'message', text: 'ok' })
  await runtime.run({ request: { text: 'research' }, onEvent: (...event) => events.push(event), respond: async ({ isolated, signal }) => {
    if (isolated) return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(Object.assign(new Error('CANCELLED'), { code: 'CANCELLED' }))))
    return steps.shift()
  } })
  assert.ok(events.some(([type, tool, detail]) => type === 'tool.failed' && tool === 'najd-delegate' && detail === 'declined: refused · LIMIT_REACHED'), JSON.stringify(events.filter(([, tool]) => tool === 'najd-delegate')))
})