// Unknown-effect protection (independent review of 0.10.17): any successful observation, even capability metadata, cleared
// the block, and an identical terminal command that had timed out was dispatched a second time. Uncertainty is now bound
// to the operation and its target, and only evidence about that target resolves it. The real runtime is driven with
// scripted model turns; the workspace executor is a fake that records every dispatch and asks for approval like the real one.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createAgentRuntime } = require('../electron/agent-runtime.cjs')

const toolCall = (name, args, id) => ({ kind: 'agent-tools', calls: [{ name, arguments: JSON.stringify(args), call_id: id }], items: [] })
// files: the fake workspace contents. uncertain: operations (by path or command) whose first dispatch times out after it was sent.
function fakeWorkspace({ files = {}, uncertain = [], applyUncertain = false } = {}) {
  const dispatched = [], approvals = []
  const key = value => String(value || '').replace(/\\/g, '/').toLowerCase()
  const run = async (operation, args, { requestApproval }) => {
    if (operation === 'files.read') {
      if (!(key(args.path) in files)) throw Object.assign(new Error('NOT_FOUND'), { code: 'NOT_FOUND' })
      const text = files[key(args.path)]
      return { path: 'C:/najd-test/' + args.path, text, offset: 0, characters: text.length, hasMore: false }
    }
    if (operation === 'files.list') return { path: 'C:/najd-test', entries: Object.keys(files).map(name => ({ name, type: 'file' })) }
    // Effects ask for approval first, exactly like the real workspace executor.
    const decision = await requestApproval(operation === 'terminal.run' ? 'najd-terminal-run' : 'najd-files-write', { path: args.path || args.cwd || '', summary: operation })
    approvals.push(decision)
    if (decision !== 'ALLOW_ONCE') return { status: 'denied_by_user' }
    dispatched.push(operation + ' ' + (args.path || args.command))
    const target = args.path || args.command
    if (uncertain.includes(target)) {
      uncertain.splice(uncertain.indexOf(target), 1)
      if (applyUncertain && operation === 'files.write') files[key(args.path)] = args.content
      throw Object.assign(new Error('TIMEOUT'), { code: 'TIMEOUT', effectUnknown: true })
    }
    if (operation === 'files.write') { files[key(args.path)] = args.content; return { status: 'written', path: 'C:/najd-test/' + args.path } }
    return { status: 'completed', exitCode: 0 }
  }
  return { workspace: { workspace: 'C:/najd-test', run }, dispatched, approvals, files }
}
async function drive(turns, { workspace, skills, approve = 'ALLOW_ONCE', signal } = {}) {
  const outputs = []
  let calls = 0
  const runtime = createAgentRuntime({ catalog: { search: async () => [], details: async () => ({ id: 'najd-terminal-run', ready: true }), summary: async () => '' }, library: { list: async () => [] }, workspace, skills })
  let result, failure
  try {
    result = await runtime.run({ request: { text: 'Do the task.', conversationId: 'uncertain' }, signal, requestApproval: async () => approve,
      respond: async ({ input }) => {
        calls++
        const last = input.at(-1)
        if (last?.type === 'function_call_output') outputs.push(JSON.parse(last.output))
        const next = turns.shift()
        return typeof next === 'function' ? next() : next || { kind: 'message', text: 'finished' }
      } })
  } catch (error) { failure = error }
  return { outputs, result, failure, calls: () => calls }
}
const load = (toolset, id) => toolCall('najd_tools_load', { toolset, unload: '' }, id)
const command = { command: 'New-Item report.txt', cwd: '' }

test('capability details between an unknown terminal effect and the identical command: dispatched once', async () => {
  const fake = fakeWorkspace({ uncertain: ['New-Item report.txt'] })
  const { outputs } = await drive([load('terminal', 't0'), toolCall('najd_terminal_run', command, 'r1'), toolCall('najd_capabilities_details', { id: 'najd-terminal-run' }, 'r2'),
    toolCall('najd_terminal_run', { cwd: '', command: command.command }, 'r3')], { workspace: fake.workspace })
  assert.equal(outputs[1].effectUnknown, true)
  assert.equal(outputs[3].error, 'UNKNOWN_EFFECT_NOT_REPEATED')
  assert.deepEqual(fake.dispatched, ['terminal.run New-Item report.txt'])
})

test('a skill read does not clear the block', async () => {
  const fake = fakeWorkspace({ uncertain: ['New-Item report.txt'] })
  const skills = { list: async () => [{ id: 'najd-computer-control', name: 'Computer control', enabled: true }], read: async () => ({ text: 'guide', offset: 0, hasMore: false }) }
  const { outputs } = await drive([load('terminal', 't0'), toolCall('najd_terminal_run', command, 'r1'), toolCall('najd_skills_read', { id: 'najd-computer-control', file: '', offset: 0, limit: 0 }, 'r2'),
    toolCall('najd_terminal_run', command, 'r3')], { workspace: fake.workspace, skills })
  assert.equal(outputs[2].text, 'guide', 'the skill read itself ran')
  assert.equal(outputs[3].error, 'UNKNOWN_EFFECT_NOT_REPEATED'); assert.equal(fake.dispatched.length, 1)
})

test('unrelated file reads and listings do not clear the block of a command', async () => {
  const fake = fakeWorkspace({ files: { 'notes.txt': 'x' }, uncertain: ['New-Item report.txt'] })
  const { outputs } = await drive([load('terminal', 't0'), toolCall('najd_terminal_run', command, 'r1'), toolCall('najd_files_read', { path: 'notes.txt', offset: 0, limit: 0 }, 'r2'),
    toolCall('najd_files_list', { path: '' }, 'r3'), toolCall('najd_terminal_run', command, 'r4')], { workspace: fake.workspace })
  assert.equal(outputs[4].error, 'UNKNOWN_EFFECT_NOT_REPEATED'); assert.equal(fake.dispatched.length, 1)
})

test('a relevant read that cannot establish the result keeps the block', async () => {
  // The file now holds other text: the write may or may not have happened (it could have been changed since).
  const fake = fakeWorkspace({ files: { 'out.txt': 'older text' }, uncertain: ['out.txt'] })
  const write = { path: 'out.txt', content: 'new text' }
  const { outputs } = await drive([load('files', 'f0'), toolCall('najd_files_write', write, 'w1'), toolCall('najd_files_read', { path: 'out.txt', offset: 0, limit: 0 }, 'w2'),
    toolCall('najd_files_write', { content: 'new text', path: 'out.txt' }, 'w3')], { workspace: fake.workspace })
  assert.equal(outputs[3].error, 'UNKNOWN_EFFECT_NOT_REPEATED'); assert.equal(fake.dispatched.length, 1)
})

test('a relevant read showing the write already happened: it is not sent again', async () => {
  const fake = fakeWorkspace({ uncertain: ['out.txt'], applyUncertain: true })
  const write = { path: 'out.txt', content: 'new text' }
  const { outputs } = await drive([load('files', 'f0'), toolCall('najd_files_write', write, 'w1'), toolCall('najd_files_read', { path: 'out.txt', offset: 0, limit: 0 }, 'w2'),
    toolCall('najd_files_write', write, 'w3')], { workspace: fake.workspace })
  assert.equal(outputs[1].effectUnknown, true)
  assert.equal(outputs[2].effectCheck, 'confirmed', 'the read reports what it established')
  assert.equal(outputs[3].error, 'EFFECT_ALREADY_DONE'); assert.equal(fake.dispatched.length, 1)
})

test('a relevant read showing nothing happened: the retry goes through approval again, and a denial changes nothing', async () => {
  for (const approve of ['ALLOW_ONCE', 'DENY']) {
    const fake = fakeWorkspace({ uncertain: ['out.txt'] })
    const write = { path: 'out.txt', content: 'new text' }
    let asked = 0
    const runApprove = { approve: 'ALLOW_ONCE' }
    const turns = [load('files', 'f0'), toolCall('najd_files_write', write, 'w1'), toolCall('najd_files_read', { path: 'out.txt', offset: 0, limit: 0 }, 'w2'),
      () => { runApprove.approve = approve; return toolCall('najd_files_write', write, 'w3') }]
    const workspace = { ...fake.workspace, run: (operation, args, options) => fake.workspace.run(operation, args, { ...options, requestApproval: async (...rest) => { asked++; return runApprove.approve } }) }
    const { outputs } = await drive(turns, { workspace })
    assert.equal(outputs[2].effectCheck, 'absent')
    assert.equal(asked, 2, 'the retry asked for approval again (' + approve + ')')
    if (approve === 'ALLOW_ONCE') { assert.equal(outputs[3].status, 'written'); assert.equal(fake.dispatched.length, 2) }
    else { assert.equal(outputs[3].status, 'denied_by_user'); assert.equal(fake.dispatched.length, 1); assert.equal(fake.files['out.txt'], undefined) }
  }
})

test('two uncertain writes: resolving one does not clear the other', async () => {
  const fake = fakeWorkspace({ uncertain: ['a.txt', 'b.txt'] })
  const { outputs } = await drive([load('files', 'f0'), toolCall('najd_files_write', { path: 'a.txt', content: 'A' }, 'a1'), toolCall('najd_files_write', { path: 'b.txt', content: 'B' }, 'b1'),
    toolCall('najd_files_read', { path: 'a.txt', offset: 0, limit: 0 }, 'a2'), toolCall('najd_files_write', { path: 'a.txt', content: 'A' }, 'a3'),
    toolCall('najd_files_write', { content: 'B', path: 'b.txt' }, 'b3')], { workspace: fake.workspace })
  assert.equal(outputs[4].status, 'written', 'a.txt was confirmed absent and retried')
  assert.equal(outputs[5].error, 'UNKNOWN_EFFECT_NOT_REPEATED', 'b.txt is still unknown')
  assert.deepEqual(fake.dispatched, ['files.write a.txt', 'files.write b.txt', 'files.write a.txt'])
})

test('a cancel after an unknown effect stops the run without dispatching it again', async () => {
  const controller = new AbortController()
  const fake = fakeWorkspace({ uncertain: ['New-Item report.txt'] })
  const { failure } = await drive([load('terminal', 't0'), toolCall('najd_terminal_run', command, 'r1'), () => { controller.abort(); return toolCall('najd_terminal_run', command, 'r2') }],
    { workspace: fake.workspace, signal: controller.signal })
  assert.equal(failure?.code, 'CANCELLED'); assert.equal(fake.dispatched.length, 1)
})

test('a read that failed before an uncertain write is read again afterwards, not answered from the old failure', async () => {
  const fake = fakeWorkspace({ uncertain: ['out.txt'], applyUncertain: true })
  const write = { path: 'out.txt', content: 'new text' }
  const read = { path: 'out.txt', offset: 0, limit: 0 }
  const { outputs } = await drive([load('files', 'f0'), toolCall('najd_files_read', read, 'p1'), toolCall('najd_files_write', write, 'w1'), toolCall('najd_files_read', read, 'p2'),
    toolCall('najd_files_write', write, 'w2')], { workspace: fake.workspace })
  assert.equal(outputs[1].error, 'NOT_FOUND'); assert.equal(outputs[3].effectCheck, 'confirmed')
  assert.equal(outputs[4].error, 'EFFECT_ALREADY_DONE'); assert.equal(fake.dispatched.length, 1)
})
