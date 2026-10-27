const { fromChatCompletions, fromAnthropic, fromGemini } = require('./usage.cjs')
const catalog = require('./provider-catalog.json')
const { jsonRequest, providerError, outputTokenLimit, validateSystemPrompt } = require('./provider-http.cjs')
const { createChatGPTInference } = require('./chatgpt-inference.cjs')
const { resolveReasoning } = require('./reasoning-policy.cjs')
const { buildAgentRequest, parseAgentResponse } = require('./provider-agent.cjs')
const { modelWindow } = require('./model-window.cjs')
const modelPattern = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/

// baseUrl: the address the owner set for providers with an editable address (OpenAI-compatible services and local servers); otherwise the catalog address.
function createProviderClient(provider, { fetchImpl = fetch, baseUrl: override } = {}) {
  const entry = catalog.find(p => p.id === provider && typeof p.baseUrl === 'string')
  if (!entry) throw providerError('INVALID_INPUT')
  const config = { ...entry, baseUrl: String(override || entry.baseUrl || '').replace(/\/+$/, '') }
  const optionalKey = entry.auth === 'optional-key'
  const responses = config.protocol === 'responses' ? createChatGPTInference({ fetchImpl, apiBase: config.baseUrl, catalog: 'api' }) : null
  function headers(key) {
    if (!config.baseUrl) throw providerError('ENDPOINT_REQUIRED')
    if (optionalKey && !key) return { 'Content-Type': 'application/json' } // a local server that needs no key
    if (typeof key !== 'string' || !key || key.length > 1024 || /[\r\n]/.test(key)) throw providerError('AUTH_REQUIRED')
    return { 'Content-Type': 'application/json', ...(config.protocol === 'anthropic'
      ? { 'x-api-key': key, 'anthropic-version': '2023-06-01' }
      : config.protocol === 'gemini' ? { 'x-goog-api-key': key } : { Authorization: `Bearer ${key}` }) }
  }
  async function listModels(apiKey, signal) {
    const authHeaders = headers(apiKey)
    if (config.models) return config.models.map(id => ({ id, label: id, contextWindow: modelWindow(null, id) }))
    if (responses) return responses.listModels(apiKey, signal)
    const data = await jsonRequest(fetchImpl, `${config.baseUrl}/models${config.protocol === 'gemini' ? '?pageSize=1000' : ''}`,
      { headers: authHeaders }, signal, 30000, 8 * 1024 * 1024)
    const list = config.protocol === 'gemini' ? data?.models : data?.data
    if (!Array.isArray(list) || list.length > 2000) throw providerError('INVALID_MODEL_OUTPUT')
    return list.filter(m => m && (config.protocol !== 'gemini' || (Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes('generateContent'))) &&
      m.capabilities?.completion_chat !== false && (!m.architecture?.output_modalities || (Array.isArray(m.architecture.output_modalities) && m.architecture.output_modalities.includes('text'))))
      .map(m => ({ id: config.protocol === 'gemini' ? (typeof m.name === 'string' ? m.name.replace(/^models\//, '') : null) : m.id,
        label: m.display_name || m.displayName || m.name || m.id, raw: m }))
      .filter(m => typeof m.id === 'string' && modelPattern.test(m.id) && !/whisper|tts|embed|moderation/i.test(m.id))
      .map(m => ({ id: m.id, label: typeof m.label === 'string' ? m.label.slice(0, 150) : m.id, contextWindow: modelWindow(m.raw, m.id) }))
  }
  async function chat({ apiKey, modelName, history, signal, reasoningEffort = 'auto', readPath, maxOutputTokens = 0, systemPrompt, agentTurn }) {
    validateSystemPrompt(systemPrompt)
    const maxTokens = outputTokenLimit(maxOutputTokens) // 0: no cap is sent, the provider's own maximum applies (Claude requires one, so it gets a high value)
    if (readPath !== undefined && provider !== 'openai-api') throw providerError('TOOLS_NOT_SUPPORTED')
    const authHeaders = headers(apiKey)
    if (!modelPattern.test(modelName || '') || (config.models && !config.models.includes(modelName)) ||
        !Array.isArray(history) || !history.length || history.length > 500 || history.at(-1)?.role !== 'user' ||
        history.some(m => !m || !['user', 'assistant'].includes(m.role) || typeof m.text !== 'string' || !m.text.trim() ||
          m.text.length > 4000000) || history.reduce((n, m) => n + m.text.length, 0) > 20000000) throw providerError('INVALID_INPUT')
    const effort = resolveReasoning(provider, modelName, history.at(-1).text, reasoningEffort)
    if (responses) return responses.chat({ accessToken: apiKey, modelName, history, signal, reasoningEffort: effort, readPath, maxOutputTokens, systemPrompt, agentTurn })
    if (agentTurn) {
      // The agent tool loop over Chat Completions, Anthropic Messages or Gemini (provider-agent.cjs).
      if (!Array.isArray(agentTurn.input) || !Array.isArray(agentTurn.tools) || agentTurn.tools.length > 24) throw providerError('INVALID_INPUT')
      let request
      try { request = buildAgentRequest(config, { modelName, systemPrompt, history, agentTurn, vision: config.vision === true, maxTokens, effort }) }
      catch (error) { throw providerError(error?.code === 'TOOLS_NOT_SUPPORTED' ? 'TOOLS_NOT_SUPPORTED' : 'INVALID_INPUT') }
      if (provider === 'openrouter-api') request.body.provider = { allow_fallbacks: false }
      const data = await jsonRequest(fetchImpl, request.endpoint, { method: 'POST', headers: authHeaders, body: JSON.stringify(request.body) }, signal, 3600000, 64 * 1024 * 1024)
      try { return parseAgentResponse(config, data) } catch (error) { throw providerError(error?.code === 'INVALID_MODEL_OUTPUT' ? 'INVALID_MODEL_OUTPUT' : 'INVALID_INPUT') }
    }
    const messages = history.map(({ role, text }) => ({ role, content: text }))
    let endpoint = `${config.baseUrl}/chat/completions`
    let body = { model: modelName, messages, stream: false, ...(maxTokens ? { max_tokens: maxTokens } : {}), ...(effort ? { reasoning_effort: effort } : {}) }
    if (provider === 'minimax-plan' && maxTokens) { delete body.max_tokens; body.max_completion_tokens = maxTokens }
    if (config.protocol === 'anthropic') { endpoint = `${config.baseUrl}/messages`; body = { model: modelName, messages, max_tokens: maxTokens || 32000, stream: false } }
    if (config.protocol === 'gemini') {
      endpoint = `${config.baseUrl}/models/${encodeURIComponent(modelName)}:generateContent`
      body = { contents: history.map(({ role, text }) => ({ role: role === 'assistant' ? 'model' : 'user', parts: [{ text }] })), ...(maxTokens ? { generationConfig: { maxOutputTokens: maxTokens } } : {}) }
    }
    if (provider === 'openrouter-api') body.provider = { allow_fallbacks: false }
    if (systemPrompt !== undefined) {
      if (config.protocol === 'anthropic') body.system = systemPrompt
      else if (config.protocol === 'gemini') body.systemInstruction = { parts: [{ text: systemPrompt }] }
      else body.messages.unshift({ role: 'system', content: systemPrompt })
    }
    const data = await jsonRequest(fetchImpl, endpoint, { method: 'POST', headers: authHeaders, body: JSON.stringify(body) }, signal, 3600000, 64 * 1024 * 1024)
    let text
    if (config.protocol === 'anthropic') {
      if (data.stop_reason !== 'end_turn' || !Array.isArray(data.content)) throw providerError('INVALID_MODEL_OUTPUT')
      text = data.content.filter(c => c.type === 'text' && typeof c.text === 'string').map(c => c.text).join('')
    } else if (config.protocol === 'gemini') {
      const candidate = data.candidates?.[0]
      if (candidate?.finishReason !== 'STOP' || !Array.isArray(candidate.content?.parts)) throw providerError('INVALID_MODEL_OUTPUT')
      text = candidate.content.parts.filter(p => typeof p.text === 'string' && !p.thought).map(p => p.text).join('')
    } else {
      const choice = data.choices?.[0]
      if (choice?.finish_reason !== 'stop') throw providerError('INVALID_MODEL_OUTPUT')
      text = choice.message?.content
    }
    if (typeof text !== 'string' || !text.trim() || text.length > 4000000) throw providerError('INVALID_MODEL_OUTPUT')
    const usage = config.protocol === 'anthropic' ? fromAnthropic(data.usage) : config.protocol === 'gemini' ? fromGemini(data.usageMetadata) : fromChatCompletions(data.usage)
    return { kind: 'message', text: text.trim(), ...(usage ? { usage } : {}) }
  }
  return { listModels, chat }
}

module.exports = { createProviderClient }
