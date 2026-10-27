const { providerError } = require('./provider-http.cjs')
const choices = ['auto', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']

// Exact documented families only. Unknown catalogs keep provider defaults.
// Sources: docs/SUBSCRIPTION-RESEARCH.md, reviewed 2026-10-14.
function reasoningEfforts(provider, model) {
  const base = typeof model === 'string' ? model.replace(/-\d{4}-\d{2}-\d{2}$/, '') : ''
  if (['chatgpt', 'openai-api'].includes(provider)) {
    // Measured with a ChatGPT subscription on 2026-10-19: each model accepts exactly these levels.
    if (['gpt-6-sol', 'gpt-6-luna', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna'].includes(base)) return ['none', 'low', 'medium', 'high', 'xhigh', 'max']
    if (['gpt-6.1-sol', 'gpt-6-astra'].includes(base)) return ['low', 'medium', 'high', 'xhigh', 'max']
  }
  if (provider === 'kimi-code' && ['k3', 'k3-256k', 'kimi-for-coding'].includes(model)) return ['low', 'high', 'max']
  if (provider === 'minimax-plan' && model === 'MiniMax-M3.1-Flash-Preview') return ['low', 'medium', 'high', 'xhigh', 'max']
  return []
}

function resolveReasoning(provider, model, text, preference = 'auto') {
  if (!choices.includes(preference) || typeof text !== 'string') throw providerError('INVALID_INPUT')
  text = text.slice(0, 4000) // only the start of a long message is needed to estimate effort; there is no length limit
  const supported = reasoningEfforts(provider, model)
  if (preference !== 'auto') {
    if (!supported.includes(preference)) throw providerError('UNSUPPORTED_REASONING')
    return preference
  }
  if (!supported.length) return null
  // ponytail: bilingual heuristic, not semantic certainty; expand from failed prompt evaluations.
  const demanding = /security|vulnerab|race condition|rollback|migration|architecture|debug|ثغرات|أمني|الأمن|ترحيل|معمار|خطة شاملة|خطه شاملة|تشخيص/i.test(text) || text.length > 1600
  const multiStep = /compare|tradeoff|analy[sz]|plan|design|مقارن|حلل|خطط|صمم|تصميم|اشرح.*خطو/i.test(text) || text.length > 240
  const wanted = demanding ? 'high' : multiStep ? 'medium' : 'low'
  return supported.includes(wanted) ? wanted : supported.find(level => choices.indexOf(level) >= choices.indexOf(wanted)) || supported.at(-1)
}

module.exports = { reasoningEfforts, resolveReasoning, validReasoningPreference: value => choices.includes(value) }
