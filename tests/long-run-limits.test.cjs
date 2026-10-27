// Owner decision 2026-10-24: a task may work for hours. Only a request that never answers is bounded (one hour).
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createKimiCodeClient } = require('../electron/kimi-code.cjs')
const { createOllamaClient } = require('../electron/ollama.cjs')
const { createAgentRuntime } = require('../electron/agent-runtime.cjs')

test('model clients allow one request up to an hour', () => {
  assert.doesNotThrow(() => createKimiCodeClient({ timeoutMs: 3600000 }))
  assert.doesNotThrow(() => createOllamaClient({ timeoutMs: 3600000 }))
  assert.throws(() => createKimiCodeClient({ timeoutMs: 3600001 }), { code: 'INVALID_INPUT' })
})

test('the agent sets no deadline of its own (a timer there cannot be simulated, so its absence is checked), and Stop still ends a task', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../electron/agent-runtime.cjs'), 'utf8')
  assert.equal(/AbortSignal\.timeout\(/.test(source), false, 'no task-wide timer in the agent loop')
  const library = { list: async () => [], read: async () => ({ text: '' }), search: async () => [] }
  const runtime = createAgentRuntime({ catalog: { search: async () => [], details: async () => ({}) }, library })
  const controller = new AbortController()
  const stopped = await runtime.run({ signal: controller.signal, request: { text: 'x' }, respond: async () => { controller.abort(); return { kind: 'message', text: 'late' } } }).catch(error => error)
  assert.equal(stopped.code, 'CANCELLED')
})
