// Token usage contract at the provider boundary (docs/AGENT-PLATFORM-PLAN.md AP-007).
// Every field is a number only when the provider reported it, otherwise null: a missing count is never 0.
const count = value => Number.isFinite(value) && value >= 0 ? Math.round(value) : null
const first = (...values) => { for (const value of values) { const number = count(value); if (number !== null) return number } return null }
const FIELDS = ['input', 'output', 'total', 'cached']

// OpenAI Responses (ChatGPT subscription and API key): input_tokens, output_tokens, total_tokens, input_tokens_details.cached_tokens.
function fromResponses(raw) {
  if (!raw || typeof raw !== 'object') return null
  const input = count(raw.input_tokens), output = count(raw.output_tokens)
  return { input, output, total: first(raw.total_tokens, input !== null && output !== null ? input + output : NaN), cached: count(raw.input_tokens_details?.cached_tokens) }
}
// OpenAI-compatible chat completions (Kimi): prompt/completion/total, cached in prompt_tokens_details or a top-level field.
function fromChatCompletions(raw) {
  if (!raw || typeof raw !== 'object') return null
  const input = count(raw.prompt_tokens), output = count(raw.completion_tokens)
  return { input, output, total: first(raw.total_tokens, input !== null && output !== null ? input + output : NaN),
    cached: first(raw.prompt_tokens_details?.cached_tokens, raw.cached_tokens) }
}
// Ollama native /api/chat: prompt_eval_count and eval_count; no cache field.
function fromOllama(raw) {
  if (!raw || typeof raw !== 'object') return null
  const input = count(raw.prompt_eval_count), output = count(raw.eval_count)
  if (input === null && output === null) return null
  return { input, output, total: input !== null && output !== null ? input + output : null, cached: null }
}

// Anthropic Messages: input_tokens, output_tokens; cache reads in cache_read_input_tokens.
function fromAnthropic(raw) {
  if (!raw || typeof raw !== 'object') return null
  const input = count(raw.input_tokens), output = count(raw.output_tokens)
  return { input, output, total: input !== null && output !== null ? input + output : null, cached: count(raw.cache_read_input_tokens) }
}
// Gemini generateContent: usageMetadata prompt/candidates/total and cachedContentTokenCount.
function fromGemini(raw) {
  if (!raw || typeof raw !== 'object') return null
  const input = count(raw.promptTokenCount), output = count(raw.candidatesTokenCount)
  return { input, output, total: first(raw.totalTokenCount, input !== null && output !== null ? input + output : NaN), cached: count(raw.cachedContentTokenCount) }
}

// Accumulates calls per field: the sum of reported values and how many calls reported it (AP-004/AP-007).
function createUsage() {
  return { modelCalls: 0, sums: { input: 0, output: 0, total: 0, cached: 0 }, reported: { input: 0, output: 0, total: 0, cached: 0 } }
}
// A call counts when it is sent (startCall); its usage is added if the provider reported it (reportCall). A call that
// failed or was cancelled after it was sent stays counted with unknown usage, so the totals become partial (APR-009).
function startCall(total) { total.modelCalls++; return total }
function reportCall(total, usage) {
  for (const key of FIELDS) {
    const value = count(usage?.[key])
    if (value !== null) { total.sums[key] += value; total.reported[key]++ }
  }
  return total
}
function addUsage(total, usage) { return reportCall(startCall(total), usage) }
// Adds a finished child run (delegated sub-agent) once; accepts an accumulator or its usageView.
function mergeUsage(total, child) {
  if (!child) return total
  total.modelCalls += Number(child.modelCalls) || 0
  if (child.sums) {
    for (const key of FIELDS) { total.sums[key] += child.sums[key]; total.reported[key] += child.reported[key] }
  } else {
    // A view: a null field was never reported by the child; a partial view still counts its known part once.
    const calls = Number(child.modelCalls) || 0
    for (const key of FIELDS) {
      const value = count(child[key])
      if (value === null) continue
      total.sums[key] += value
      const missing = key === 'cached' ? 0 : child.partialFields?.includes(key) ? 1 : 0
      total.reported[key] += Math.max(1, calls - missing)
    }
  }
  return total
}
// View for storage and the UI. A field is null when no call reported it; partialFields lists the fields some
// calls did not report (their known sum is shown as partial). Cached counts are optional for providers.
function usageView(total) {
  const view = { modelCalls: total.modelCalls, partial: false, partialFields: [] }
  for (const key of FIELDS) {
    const reported = total.reported[key]
    view[key] = reported ? total.sums[key] : null
    if (key !== 'cached' && reported < total.modelCalls) { view.partialFields.push(key); view.partial = true }
  }
  return view
}

module.exports = { fromResponses, fromChatCompletions, fromOllama, fromAnthropic, fromGemini, createUsage, addUsage, startCall, reportCall, mergeUsage, usageView }
