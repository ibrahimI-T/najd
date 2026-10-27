const { test } = require('node:test')
const assert = require('node:assert/strict')
const { fromResponses, fromChatCompletions, fromOllama, createUsage, addUsage, usageView } = require('../electron/usage.cjs')
const { createAgentRuntime } = require('../electron/agent-runtime.cjs')

const call = (name, args, id) => ({ kind: 'agent-tools', calls: [{ name, arguments: JSON.stringify(args), call_id: id }],
  items: [{ type: 'function_call', name, arguments: JSON.stringify(args), call_id: id }] })
const library = { list: async () => [], read: async () => ({ text: '' }), search: async () => [] }

test('provider usage keeps unknown counts as null, real zeros as 0 and passes cached tokens through (AP-007)', () => {
  assert.equal(fromResponses(undefined), null)
  assert.deepEqual(fromResponses({ input_tokens: 0, output_tokens: 0, total_tokens: 0 }), { input: 0, output: 0, total: 0, cached: null })
  assert.deepEqual(fromResponses({ input_tokens: 1200, output_tokens: 30, input_tokens_details: { cached_tokens: 1024 } }), { input: 1200, output: 30, total: 1230, cached: 1024 })
  assert.deepEqual(fromChatCompletions({ prompt_tokens: 50, completion_tokens: 5, total_tokens: 55, prompt_tokens_details: { cached_tokens: 32 } }), { input: 50, output: 5, total: 55, cached: 32 })
  assert.deepEqual(fromChatCompletions({ prompt_tokens: 50 }), { input: 50, output: null, total: null, cached: null })
  assert.equal(fromOllama({ done: true }), null)
  assert.deepEqual(fromOllama({ prompt_eval_count: 40, eval_count: 2 }), { input: 40, output: 2, total: 42, cached: null })
  // A run with one unreported call is partial: the known parts add up, the total is not presented as complete.
  const total = createUsage()
  addUsage(total, { input: 10, output: 2, total: 12, cached: null })
  addUsage(total, null)
  assert.deepEqual(usageView(total), { input: 10, output: 2, total: 12, cached: null, modelCalls: 2, partial: true, partialFields: ['input', 'output', 'total'] })
  // No call reported anything: every count is unknown (null), never 0 (APR-004).
  const none = createUsage(); addUsage(none, null); addUsage(none, undefined)
  assert.deepEqual(usageView(none), { input: null, output: null, total: null, cached: null, modelCalls: 2, partial: true, partialFields: ['input', 'output', 'total'] })
})

test('a cancelled run still returns its receipt with the usage of the calls already made (AP-004)', async () => {
  const controller = new AbortController()
  const runtime = createAgentRuntime({ catalog: { search: async () => [] }, library })
  let turn = 0
  const failure = await runtime.run({ signal: controller.signal, request: { text: 'hello' }, respond: async () => {
    if (turn++ === 0) return { ...call('najd_capabilities_search', { query: 'x' }, 'c1'), usage: { input: 100, output: 5, total: 105, cached: 64 } }
    controller.abort()
    return { kind: 'message', text: 'late', usage: { input: 120, output: 3, total: 123, cached: null } }
  } }).catch(error => error)
  assert.equal(failure.code, 'CANCELLED')
  assert.equal(failure.receipt.outcome, 'cancelled')
  assert.equal(failure.receipt.profile, 'general')
  assert.equal(failure.receipt.usage.total, 228); assert.equal(failure.receipt.usage.modelCalls, 2)
  assert.equal(failure.receipt.usage.cached, 64)
  assert.equal(failure.receipt.toolCalls, 1)
  assert.ok(failure.receipt.request.instructionsBytes > 0 && failure.receipt.request.toolsBytes > 0)
})

test('delegated usage and calls are counted once, also when the sub-agent fails', async () => {
  const workspace = { describe: () => ({ workspace: 'C:/w', grantedFolders: [] }), run: async () => ({ entries: [] }) }
  const runtime = createAgentRuntime({ catalog: { search: async () => [], details: async () => ({}) }, library, workspace })
  let parent = 0, child = 0
  const result = await runtime.run({ request: { text: 'research the notes' }, respond: async request => {
    if (request.isolated) {
      // The sub-agent lists a folder, then returns invalid output and fails.
      if (child++ === 0) return { ...call('najd_files_list', { path: 'notes' }, 'k1'), usage: { input: 10, output: 1, total: 11 } }
      return { kind: 'agent-tools', calls: [], items: [], usage: { input: 12, output: 1, total: 13 } }
    }
    if (parent++ === 0) return { ...call('najd_delegate', { task: 'list notes', context: '', background: false }, 'p1'), usage: { input: 100, output: 4, total: 104 } }
    assert.match(request.input.at(-1).output, /error/)
    return { kind: 'message', text: 'done', usage: { input: 130, output: 6, total: 136 } }
  } })
  assert.equal(result.text, 'done')
  assert.equal(result.usage.total, 104 + 136 + 11 + 13)
  assert.equal(result.usage.modelCalls, 4)
  assert.equal(result.toolCalls, 1 + 1) // the delegate call plus the sub-agent's one tool call
  assert.equal(result.receipt.outcome, 'completed')
})

test('request size counts pictures without their base64 data (AP-008)', async () => {
  const id = 'b'.repeat(64), big = 'data:image/png;base64,' + 'A'.repeat(500000)
  const runtime = createAgentRuntime({ catalog: {}, library: { list: async () => [{ id, name: 'p.png', characters: 0, kind: 'image' }], read: async () => ({}), search: async () => [], image: async () => big } })
  const result = await runtime.run({ assetIds: [id], respond: async () => ({ kind: 'message', text: 'ok', historyBytes: 321 }) })
  assert.equal(result.request.images, 1)
  assert.ok(result.request.turnBytes < 5000, 'base64 must not be counted as text: ' + result.request.turnBytes)
  assert.equal(result.request.historyBytes, 321)
  assert.equal('historyBytes' in result, false)
})
