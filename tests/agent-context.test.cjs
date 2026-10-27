const { test } = require('node:test')
const assert = require('node:assert/strict')
const { fitAgentHistory } = require('../electron/agent-context.cjs')
test('attachment/tool context evicts old conversation rather than the latest request or source data', () => {
  const history = [{ role: 'user', text: 'old HTML example'.repeat(80) }, { role: 'assistant', text: 'old HTML answer'.repeat(80) }, { role: 'user', text: 'Summarize this attachment' }]
  const turn = { tools: [], input: [{ role: 'user', content: 'ACTUAL DOCUMENT'.repeat(20) }] }
  const before = JSON.stringify(history)
  assert.deepEqual(fitAgentHistory(history, 'public instructions', turn, 1000), [history[2]])
  assert.equal(JSON.stringify(history), before)
  assert.deepEqual(fitAgentHistory(history, '', { tools: [], input: [] }, 10000), history)
  assert.throws(() => fitAgentHistory([history[2]], '', turn, 50), { code: 'CONTEXT_LIMIT' })
})
