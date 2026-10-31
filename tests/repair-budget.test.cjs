// Bounded repair of calls NAJD cannot run (owner review 2026-10-31: eight identical UNKNOWN_TOOL errors were accepted and
// nine model calls made before the test itself stopped). The real runtime is driven with scripted model turns.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createAgentRuntime } = require('../electron/agent-runtime.cjs')

const toolCall = (name, args, id) => ({ kind: 'agent-tools', calls: [{ name, arguments: typeof args === 'string' ? args : JSON.stringify(args), call_id: id }], items: [] })
async function drive(turns, { extra = {}, signal, approve = 'ALLOW_ONCE' } = {}) {
  const outputs = [], approvals = []
  let calls = 0
  const runtime = createAgentRuntime({ catalog: { search: async () => [], details: async () => ({}), summary: async () => '' }, library: { list: async () => [] }, ...extra })
  let result, failure
  try {
    result = await runtime.run({ request: { text: 'Do the task.', conversationId: 'repair' }, signal,
      requestApproval: async (tool, input) => { approvals.push({ tool, input }); return approve },
      respond: async ({ input }) => {
        calls++
        const last = input.at(-1)
        if (last?.type === 'function_call_output') outputs.push(JSON.parse(last.output))
        const next = turns.shift()
        return typeof next === 'function' ? next() : next || { kind: 'message', text: 'finished' }
      } })
  } catch (error) { failure = error }
  return { outputs, approvals, result, failure, calls: () => calls }
}
const repeat = (count, make) => Array.from({ length: count }, (_, index) => make(index))

test('the same unknown tool under new call ids ends the run on the third try with NAJD\'s own account', async () => {
  const { outputs, result, calls } = await drive(repeat(9, index => toolCall('najd_does_not_exist', {}, 'u' + index)))
  assert.equal(calls(), 3, 'three model calls, not nine')
  assert.equal(outputs[0].error, 'UNKNOWN_TOOL'); assert.equal(outputs[0].attemptsLeft, 2)
  assert.equal(outputs[1].repeated, true); assert.equal(outputs[1].attemptsLeft, 1); assert.match(outputs[1].note, /One more invalid call/)
  assert.equal(result.kind, 'message'); assert.match(result.text, /NAJD stopped this task/); assert.match(result.text, /UNKNOWN_TOOL/)
  assert.equal(result.receipt.outcome, 'stopped_invalid_calls'); assert.equal(result.receipt.invalidCalls, 3)
})

test('invalid JSON, oversized and wrong-key calls repeated with new ids are bounded the same way', async () => {
  for (const make of [
    index => toolCall('najd_plan', '{"action": "set", ', 'j' + index),
    index => toolCall('najd_plan', JSON.stringify({ action: 'set', steps: 'x'.repeat(9000), result: '', tools: '' }), 'o' + index),
    index => toolCall('najd_plan', { action: 'set', steps: 'a|b', extra: 1 }, 'k' + index)
  ]) {
    const { result, calls, outputs } = await drive(repeat(6, make))
    assert.equal(calls(), 3)
    assert.ok(['INVALID_ARGUMENTS', 'ARGUMENTS_TOO_LONG'].includes(outputs[0].error))
    assert.equal(result.receipt.outcome, 'stopped_invalid_calls')
  }
})

test('key order does not make a repeated invalid call look new', async () => {
  const turns = [toolCall('najd_plan', { action: 'set', extra: 1, steps: 'a|b' }, 'a'), toolCall('najd_plan', { steps: 'a|b', extra: 1, action: 'set' }, 'b'),
    toolCall('najd_plan', { extra: 1, action: 'set', steps: 'a|b' }, 'c')]
  const { result, calls } = await drive(turns)
  assert.equal(calls(), 3); assert.equal(result.receipt.outcome, 'stopped_invalid_calls')
})

test('two invalid calls alternating are caught too', async () => {
  const { result, calls } = await drive(repeat(10, index => index % 2 ? toolCall('najd_nope_b', {}, 'b' + index) : toolCall('najd_nope_a', {}, 'a' + index)))
  assert.equal(calls(), 5, 'A, B, A, B, A: the third A ends it')
  assert.match(result.text, /the same call three times/)
})

test('loading tools or discovery between invalid calls is not progress', async () => {
  const turns = []
  for (let index = 0; index < 6; index++) { turns.push(toolCall('najd_missing_' + index, {}, 'm' + index)); turns.push(toolCall('najd_tools_load', { toolset: ['files', 'plan', 'terminal', 'delegate', 'files-manage', 'files'][index], unload: '' }, 'l' + index)) }
  const { result, calls } = await drive(turns)
  assert.equal(result.receipt.outcome, 'stopped_invalid_calls')
  assert.equal(result.receipt.invalidCalls, 6)
  assert.ok(calls() <= 12)
})

test('a corrected call after invalid ones runs, and the task finishes normally', async () => {
  const turns = [toolCall('najd_plan', '{bad', 'x1'), toolCall('najd_plan', { action: 'set', steps: 'a|b' }, 'x2'),
    toolCall('najd_plan', { action: 'set', steps: 'Write the file|Check it', result: '', tools: '' }, 'x3')]
  const { result, outputs } = await drive(turns)
  assert.equal(outputs[2].status, 'ok')
  assert.equal(result.text, 'finished'); assert.equal(result.receipt.outcome, 'completed'); assert.equal(result.receipt.invalidCalls, 2)
})

test('real progress between unrelated failures keeps a long task going', async () => {
  // A real tool that runs and succeeds (listing the workspace) between invalid calls ends each streak.
  const workspace = { workspace: 'C:/najd-test', run: async () => ({ status: 'listed', entries: [] }) }
  const turns = []
  for (let index = 0; index < 8; index++) {
    turns.push(toolCall('najd_unknown_' + index, {}, 'u' + index), toolCall('najd_unknown_' + index, {}, 'v' + index))
    turns.push(toolCall('najd_files_list', { path: 'folder-' + index }, 'p' + index))
  }
  const { result } = await drive(turns, { extra: { workspace } })
  assert.equal(result.receipt.outcome, 'completed'); assert.equal(result.receipt.invalidCalls, 16)
})

test('a cancel during repair stops the run as cancelled', async () => {
  const controller = new AbortController()
  const turns = [toolCall('najd_x', {}, 'c1'), () => { controller.abort(); return toolCall('najd_x', {}, 'c2') }, toolCall('najd_x', {}, 'c3')]
  const { failure, calls } = await drive(turns, { signal: controller.signal })
  assert.equal(failure?.code, 'CANCELLED'); assert.ok(calls() <= 2)
})

test('an effect that may have happened is not sent again on an identical request, even after an unrelated listing', async () => {
  const ran = []
  // The workspace executor stands in for the real one: the command "times out" after it was sent, so its effect is unknown.
  const workspace = { workspace: 'C:/najd-test', run: async operation => {
    ran.push(operation)
    if (operation === 'terminal.run') throw Object.assign(new Error('TIMEOUT'), { code: 'TIMEOUT', effectUnknown: true })
    return { status: 'listed', entries: [] }
  } }
  const command = { command: 'New-Item x.txt', cwd: '' }
  const turns = [toolCall('najd_tools_load', { toolset: 'terminal', unload: '' }, 't0'), toolCall('najd_terminal_run', command, 'r1'),
    toolCall('najd_terminal_run', { cwd: '', command: command.command }, 'r2'), toolCall('najd_files_list', { path: '' }, 'r3'),
    toolCall('najd_terminal_run', command, 'r4')]
  const { outputs } = await drive(turns, { extra: { workspace } })
  assert.equal(outputs[1].effectUnknown, true)
  assert.equal(outputs[2].error, 'UNKNOWN_EFFECT_NOT_REPEATED', 'the same command in another key order is the same call')
  // A folder listing proves nothing about what the command did (independent review of 0.10.17), so the block stays.
  assert.equal(outputs[4].error, 'UNKNOWN_EFFECT_NOT_REPEATED')
  assert.equal(ran.filter(item => item === 'terminal.run').length, 1, 'the command was dispatched once')
})

test('an empty reply after finished work is asked for its answer once, then NAJD reports what ran instead of failing', async () => {
  const workspace = { workspace: 'C:/najd-test', run: async () => ({ status: 'listed', entries: [] }) }
  const empty = { kind: 'message', text: '', empty: true }
  const answered = await drive([toolCall('najd_files_list', { path: '' }, 'e1'), empty, { kind: 'message', text: 'The folder is empty.' }], { extra: { workspace } })
  assert.equal(answered.result.text, 'The folder is empty.'); assert.equal(answered.calls(), 3)
  const silent = await drive([toolCall('najd_files_list', { path: '' }, 'e2'), empty, empty], { extra: { workspace } })
  assert.equal(silent.failure, undefined)
  assert.equal(silent.result.receipt.outcome, 'completed_without_answer'); assert.match(silent.result.text, /The model wrote no reply[\s\S]*najd-files-list/)
  assert.equal(silent.calls(), 3, 'one request for the answer, not more')
})

// Independent review of 0.10.17: successful discovery reset the repair budget (eight invalid calls, 17 model turns).
test('repeated unknown calls separated by successful capability searches stop on the third, in five model calls', async () => {
  const turns = []
  for (let index = 0; index < 8; index++) turns.push(toolCall('najd_does_not_exist', {}, 'u' + index), toolCall('najd_capabilities_search', { query: 'files ' + index }, 's' + index))
  const { result, calls, outputs } = await drive(turns)
  assert.equal(calls(), 5, 'unknown, search, unknown, search, unknown')
  assert.equal(result.receipt.outcome, 'stopped_invalid_calls'); assert.equal(result.receipt.invalidCalls, 3)
  assert.match(result.text, /the same call three times/); assert.match(result.text, /None of those calls ran/)
  assert.equal(outputs.filter(item => item.error === 'UNKNOWN_TOOL').length, 2)
})

test('repeated invalid JSON separated by capability-details reads stops on the third, reordered or not', async () => {
  const turns = []
  for (let index = 0; index < 8; index++) turns.push(toolCall('najd_plan', '{"action": "set", ', 'j' + index), toolCall('najd_capabilities_details', { id: 'najd-files-read-' + index }, 'd' + index))
  const { result, calls } = await drive(turns)
  assert.equal(calls(), 5); assert.equal(result.receipt.outcome, 'stopped_invalid_calls')
  const reordered = []
  for (let index = 0; index < 8; index++) reordered.push(toolCall('najd_plan', index % 2 ? { steps: 'a|b', extra: 1, action: 'set' } : { action: 'set', extra: 1, steps: 'a|b' }, 'k' + index), toolCall('najd_capabilities_details', { id: 'x-' + index }, 'q' + index))
  const second = await drive(reordered)
  assert.equal(second.calls(), 5); assert.equal(second.result.receipt.outcome, 'stopped_invalid_calls')
})

test('alternating invalid calls mixed with discovery and tool loading stop on the third repeat', async () => {
  const toolsets = ['files', 'plan', 'terminal', 'delegate', 'files-manage']
  const turns = []
  for (let index = 0; index < 6; index++) {
    turns.push(toolCall(index % 2 ? 'najd_nope_b' : 'najd_nope_a', {}, 'n' + index))
    turns.push(index % 2 ? toolCall('najd_capabilities_search', { query: 'q' + index }, 'c' + index) : toolCall('najd_tools_load', { toolset: toolsets[index], unload: '' }, 'l' + index))
  }
  const { result, calls } = await drive(turns)
  assert.equal(calls(), 9, 'A, load, B, search, A, load, B, search, A')
  assert.equal(result.receipt.outcome, 'stopped_invalid_calls'); assert.equal(result.receipt.invalidCalls, 5)
})

test('a corrected executable call after repair and discovery lets the task finish', async () => {
  const workspace = { workspace: 'C:/najd-test', run: async () => ({ status: 'listed', entries: [] }) }
  const turns = [toolCall('najd_files_lst', { path: '' }, 'a'), toolCall('najd_capabilities_search', { query: 'list files' }, 'b'), toolCall('najd_files_lst', { path: '' }, 'c'),
    toolCall('najd_files_list', { path: '' }, 'd'), toolCall('najd_files_lst', { path: '' }, 'e'), toolCall('najd_files_lst', { path: '' }, 'f')]
  const { result, calls } = await drive(turns, { extra: { workspace } })
  assert.equal(result.receipt.outcome, 'completed', 'the executed list ended the streak'); assert.equal(calls(), 7)
})

test('a cancel during recovery with discovery in between ends as cancelled without more model calls', async () => {
  const controller = new AbortController()
  const turns = [toolCall('najd_x', {}, 'c1'), toolCall('najd_capabilities_search', { query: 'x' }, 'c2'), () => { controller.abort(); return toolCall('najd_x', {}, 'c3') }, toolCall('najd_x', {}, 'c4')]
  const { failure, calls } = await drive(turns, { signal: controller.signal })
  assert.equal(failure?.code, 'CANCELLED'); assert.equal(calls(), 3)
})
