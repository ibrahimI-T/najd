const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createAgentRuntime } = require('../electron/agent-runtime.cjs')

const call = (name, args, id) => ({ kind: 'agent-tools', calls: [{ name, arguments: JSON.stringify(args), call_id: id }], items: [{ type: 'function_call', name, arguments: JSON.stringify(args), call_id: id }] })
const library = { list: async () => [], read: async () => ({ text: '' }), search: async () => [] }
const runtime = () => createAgentRuntime({ catalog: { search: async () => [], details: async () => ({}), summary: async () => '' }, library,
  workspace: { describe: () => ({ workspace: 'C:/w', grantedFolders: [] }), run: async () => ({ status: 'ok', text: 'file text '.repeat(300), offset: 0, hasMore: false }) },
  memory: { remember: async () => ({}), forget: async () => ({}) } })
const plan = (action, extra = {}) => ({ action, steps: '', result: '', tools: '', ...extra })

test('a plan keeps its place: set, done with a one-line result, revise; only the one-line form travels with the request', async () => {
  const seen = []
  const steps = [
    call('najd_plan', plan('set', { steps: 'read the file | change the title | check it' }), 'p1'),
    call('najd_files_read', { path: 'a.txt', offset: 0, limit: 8000 }, 'r1'),
    call('najd_plan', plan('done', { result: 'the title is on line 3', tools: 'files' }), 'p2'),
    call('najd_plan', plan('revise', { steps: 'change the title | check it again' }), 'p3'),
    call('najd_plan', plan('done', { result: 'changed' }), 'p4'),
    call('najd_plan', plan('done', { result: 'verified' }), 'p5')
  ]
  let turn = 0
  await runtime().run({ request: { text: 'Fix this bug in my repo', inputBudget: 48000 }, requestApproval: async () => 'ALLOW_ONCE',
    respond: async request => { seen.push({ instructions: request.instructions, tools: request.tools.map(tool => tool.name), input: JSON.stringify(request.input) }); return turn < steps.length ? steps[turn++] : { kind: 'message', text: 'done' } } })
  assert.ok(seen[0].tools.includes('najd_plan')); assert.match(seen[0].instructions, /first call najd_plan/)
  assert.match(seen[1].instructions, /Plan: \u25B61 read the file; \u00B72 change the title; \u00B73 check it/)
  assert.match(seen[3].instructions, /\u27131 read the file -> the title is on line 3; \u25B62 change the title/)
  assert.ok(seen[3].tools.includes('najd_files_write'), 'the step asked for the files tools')
  assert.match(seen[4].instructions, /\u27131 read the file -> the title is on line 3; \u25B62 change the title; \u00B73 check it again/, 'the plan was revised without losing the finished step')
  assert.match(seen.at(-1).instructions, /\u27133 check it again -> verified/); assert.match(seen.at(-1).instructions, /plan is complete/)
})

test('a plan with fewer than two steps, a done with no plan and an unknown action are refused with a code', async () => {
  const outputs = []
  const steps = [call('najd_plan', plan('set', { steps: 'only one' }), 'a'), call('najd_plan', plan('done', { result: 'x' }), 'b'), call('najd_plan', plan('dance'), 'c')]
  let turn = 0
  await runtime().run({ request: { text: 'Fix this bug', inputBudget: 48000 }, requestApproval: async () => 'ALLOW_ONCE',
    respond: async request => { outputs.push(JSON.stringify(request.input)); return turn < steps.length ? steps[turn++] : { kind: 'message', text: 'ok' } } })
  const last = outputs.at(-1)
  assert.ok(last.includes('NEEDS_AT_LEAST_TWO_STEPS') && last.includes('NO_ACTIVE_STEP') && last.includes('UNKNOWN_ACTION'))
})
