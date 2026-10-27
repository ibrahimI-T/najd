const { test } = require('node:test')
const assert = require('node:assert/strict')
const { resolveReasoning, reasoningEfforts } = require('../electron/reasoning-policy.cjs')

test('Auto distinguishes light and demanding Arabic/English prompts within supported efforts', () => {
  for (const text of ['هلا', 'Hello', 'ترجم كلمة apple', 'Translate good morning to Arabic']) {
    assert.equal(resolveReasoning('chatgpt', 'gpt-6.1-sol', text, 'auto'), 'low')
  }
  for (const text of ['حلل الثغرات الأمنية وصمم خطة ترحيل قاعدة البيانات', 'Debug this race condition and design a rollback strategy']) {
    assert.equal(resolveReasoning('chatgpt', 'gpt-6.1-sol', text, 'auto'), 'high')
  }
  assert.equal(resolveReasoning('kimi-code', 'k3', 'Compare these approaches and explain the tradeoffs', 'auto'), 'high')
  assert.equal(resolveReasoning('chatgpt', 'gpt-6.1-sol', 'A'.repeat(300), 'auto'), 'medium')
})

test('manual effort is explicit; unsupported and unknown models fail closed or use default', () => {
  assert.equal(resolveReasoning('kimi-code', 'k3', 'hello', 'max'), 'max')
  assert.throws(() => resolveReasoning('kimi-code', 'k3', 'hello', 'medium'), { code: 'UNSUPPORTED_REASONING' })
  assert.equal(resolveReasoning('kimi-code', 'kimi-for-coding-highspeed', 'complex analysis', 'auto'), null)
  assert.equal(resolveReasoning('chatgpt', 'unknown-model', 'complex analysis', 'auto'), null)
  assert.throws(() => resolveReasoning('chatgpt', 'unknown-model', 'hello', 'high'), { code: 'UNSUPPORTED_REASONING' })
  assert.deepEqual(reasoningEfforts('minimax-plan', 'MiniMax-M3.1-Flash-Preview'), ['low', 'medium', 'high', 'xhigh', 'max'])
  assert.throws(() => resolveReasoning('chatgpt', 'gpt-6.1-sol', 'hello', 'invented'), { code: 'INVALID_INPUT' })
  assert.equal(resolveReasoning('openai-api', 'gpt-6-sol', 'hello', 'none'), 'none')
  assert.equal(resolveReasoning('chatgpt', 'gpt-6-luna', 'hello', 'none'), 'none')
  assert.throws(() => resolveReasoning('openai-api', 'gpt-6.1-sol', 'hello', 'none'), { code: 'UNSUPPORTED_REASONING' })
})
