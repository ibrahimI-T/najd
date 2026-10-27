const { test } = require('node:test')
const assert = require('node:assert/strict')
const { buildContract, contractLine } = require('../electron/task-contract.cjs')
const { createAgentRuntime } = require('../electron/agent-runtime.cjs')

test('a request becomes a compact contract: deliverables, inputs, limits and checks (M7)', () => {
  const deck = buildContract('سوّ لي عرض باوربوينت من 3 شرائح بالعربي عن فوائد النوم المبكر بدون صور')
  assert.deepEqual(deck.deliverables, ['pptx'])
  assert.deepEqual(deck.constraints.counts, ['3 شرائح']); assert.equal(deck.constraints.language, 'Arabic'); assert.deepEqual(deck.constraints.exclusions, ['بدون صور'])
  assert.ok(deck.checks.some(check => /full path/.test(check)))
  const convert = buildContract('convert budget_test.xlsx to csv and read https://example.com/a', { attached: [{ name: 'notes.pdf' }] })
  assert.deepEqual(convert.inputs, { files: ['budget_test.xlsx'], links: ['https://example.com/a'], attachments: ['notes.pdf'] })
  assert.equal(buildContract('احذف كل الملفات القديمة').consequential, true)
  assert.equal(contractLine(buildContract('هلا كيف حالك')), '', 'plain conversation costs nothing')
  assert.match(contractLine(deck), /^NAJD_TASK_CONTRACT \(built from the request; it grants no permission\): deliver: pptx/)
})

test('the contract reaches the model with the request, and plain chat carries none', async () => {
  const runtime = createAgentRuntime({ catalog: { search: async () => [], details: async () => ({}), summary: async () => '' }, library: { list: async () => [] } })
  const seen = []
  for (const text of ['make a 5 slides presentation in english', 'hello there']) {
    await runtime.run({ request: { text }, respond: async ({ instructions }) => { seen.push(instructions); return { kind: 'message', text: 'ok' } } })
  }
  assert.match(seen[0], /NAJD_TASK_CONTRACT[^\n]*deliver: pptx[^\n]*5 slides; in English/)
  assert.doesNotMatch(seen[1], /NAJD_TASK_CONTRACT/)
  assert.match(seen[0], /Ask the user one brief question only when/)
})
