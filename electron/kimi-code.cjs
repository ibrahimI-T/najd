const { agentTurnSize } = require('./agent-context.cjs')
// Pictures count as a fixed cost (each bounded in size and number), not by their base64 length (M2-R10-002).
const agentTurnSizeSafe = turn => { try { return agentTurnSize(turn) } catch { return Infinity } }
const { fromChatCompletions } = require('./usage.cjs')
const ENDPOINT = 'https://api.kimi.ai/coding/v1/chat/completions'
const MODELS = Object.freeze(['kimi-for-coding', 'k3-256k', 'k3', 'kimi-for-coding-highspeed'])
const MAX_RESPONSE_BYTES = 1024 * 1024
const { resolveReasoning } = require('./reasoning-policy.cjs')
const { outputTokenLimit, validateSystemPrompt } = require('./provider-http.cjs')
const { chatTools, chatMessages, agentResult } = require('./chat-tools.cjs')

function providerError(code) { return Object.assign(new Error(code), { code }) }

function validHistory(history) {
  return Array.isArray(history) && history.length > 0 && history.length <= 500 &&
    history.at(-1)?.role === 'user' &&
    history.every(message => message && ['user', 'assistant'].includes(message.role) &&
      typeof message.text === 'string' && !!message.text.trim() &&
      message.text.length <= 4000000) &&
    history.reduce((size, message) => size + message.text.length, 0) <= 20000000
}

// One request may think for a long time (owner decision 2026-10-24); the hour is only a safety net against a request that never answers.
function createKimiCodeClient({ fetchImpl = fetch, timeoutMs = 3600000 } = {}) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 3600000) throw providerError('INVALID_INPUT')
  async function chat({ apiKey, modelName, history, signal, reasoningEffort, maxOutputTokens = 0, systemPrompt, agentTurn } = {}) {
    validateSystemPrompt(systemPrompt)
    const maxTokens = outputTokenLimit(maxOutputTokens)
    if (agentTurn && (!Array.isArray(agentTurn.input) || agentTurnSizeSafe(agentTurn) > 40000000)) throw providerError('INVALID_INPUT')
    if (!apiKey) throw providerError('AUTH_REQUIRED')
    if (typeof apiKey !== 'string' || !/^sk-kimi-[^\s]{1,500}$/.test(apiKey) ||
        !MODELS.includes(modelName) || !validHistory(history)) throw providerError('INVALID_INPUT')
    const timeout = AbortSignal.timeout(timeoutMs)
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout
    const effort = reasoningEffort === undefined ? null : resolveReasoning('kimi-code', modelName, history.at(-1).text, reasoningEffort)
    let response
    try {
      response = await fetchImpl(ENDPOINT, {
        method: 'POST', redirect: 'error', signal: combined,
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: modelName, stream: false, ...(maxTokens ? { max_tokens: maxTokens } : {}),
          messages: agentTurn ? chatMessages({ systemPrompt, history, input: agentTurn.input, dialect: 'openai', vision: true })
            : [...(systemPrompt === undefined ? [] : [{ role: 'system', content: systemPrompt }]), ...history.map(({ role, text }) => ({ role, content: text }))],
          ...(agentTurn ? { tools: chatTools(agentTurn.tools), tool_choice: 'auto', parallel_tool_calls: false } : {}), ...(effort ? { reasoning_effort: effort } : {}) })
      })
      if (response.status === 401) throw providerError('PROVIDER_REJECTED')
      if (response.status === 403 || response.status === 429) throw providerError('PROVIDER_RATE_LIMIT')
      if (!response.ok) throw providerError('PROVIDER_ERROR')
      if (!response.body) throw providerError('INVALID_MODEL_OUTPUT')
      const chunks = []
      let size = 0
      for await (const chunk of response.body) {
        size += chunk.length
        if (size > MAX_RESPONSE_BYTES) throw providerError('INVALID_MODEL_OUTPUT')
        chunks.push(chunk)
      }
      let data
      try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')) }
      catch { throw providerError('INVALID_MODEL_OUTPUT') }
      if (combined.aborted) throw providerError('CANCELLED')
      if (agentTurn) {
        if (!['stop', 'tool_calls'].includes(data?.choices?.[0]?.finish_reason)) throw providerError('INVALID_MODEL_OUTPUT')
        return agentResult(data.choices[0].message, fromChatCompletions(data.usage))
      }
      if (data?.choices?.[0]?.finish_reason !== 'stop') throw providerError('INVALID_MODEL_OUTPUT')
      const text = data?.choices?.[0]?.message?.content
      if (typeof text !== 'string' || !text.trim() || text.length > 4000000) throw providerError('INVALID_MODEL_OUTPUT')
      const usage = fromChatCompletions(data.usage)
      return { kind: 'message', text: text.trim(), ...(usage ? { usage } : {}) }
    } catch (error) {
      if (signal?.aborted) throw providerError('CANCELLED')
      if (timeout.aborted) throw providerError('PROVIDER_TIMEOUT')
      if (['PROVIDER_REJECTED', 'PROVIDER_RATE_LIMIT', 'PROVIDER_ERROR', 'INVALID_MODEL_OUTPUT', 'INVALID_INPUT', 'TOOLS_NOT_SUPPORTED'].includes(error?.code)) throw error
      throw providerError('PROVIDER_ERROR')
    }
  }
  return { chat }
}

module.exports = { createKimiCodeClient, KIMI_CODE_MODELS: MODELS }
