const { fromChatCompletions, fromAnthropic, fromGemini } = require('./usage.cjs')
const catalog = require('./provider-catalog.json')
const { jsonRequest, providerError, outputTokenLimit, validateSystemPrompt } = require('./provider-http.cjs')
const { createChatGPTInference } = require('./chatgpt-inference.cjs')
const { resolveReasoning } = require('./reasoning-policy.cjs')
const { buildAgentRequest, parseAgentResponse } = require('./provider-agent.cjs')
const { modelWindow } = require('./model-window.cjs')
const { agentResult } = require('./chat-tools.cjs')
const { textTurn, textTurnMessages, parseReply } = require('./text-tools.cjs')
const modelPattern = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/

// A server refusing pictures says so in words like these (llama.cpp: "image input is not supported - ... mmproj").
const IMAGE_REFUSAL = /image input|images? (?:are|is) not supported|does not support (?:image|vision)|vision (?:is )?not supported|mmproj|multimodal|image_url/i
const carriesImages = input => Array.isArray(input) && input.some(item => Array.isArray(item?.content) && item.content.some(part => part?.type === 'input_image'))
// Pictures replaced by a note the model must pass on, so the user learns why the pictures were not looked at.
function withoutImages(input) {
  return input.map(item => {
    if (!Array.isArray(item?.content) || !item.content.some(part => part?.type === 'input_image')) return item
    const count = item.content.filter(part => part?.type === 'input_image').length
    const note = `NAJD_NOTE: the user attached ${count} picture(s), but the selected model cannot see pictures, so they were not sent. Tell the user this in their language at the start of your reply, suggest choosing a model that can see pictures (for example ChatGPT) or describing what the picture shows, then help with the text you have.`
    const text = item.content.filter(part => part?.type === 'input_text').map(part => part.text)
    return { ...item, content: [...text, note].map(value => ({ type: 'input_text', text: value })) }
  })
}

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
  // Local models that turned out to have no native tool calling on this server (the server rejected the tools field), for this client's life.
  const textModels = new Set()
  // Models whose server refused pictures in this run (provider|model); their turns leave pictures out from then on.
  const noVision = new Set()
  async function localTextTurn(request, { authHeaders, signal, agentTurn }) {
    const { tools: _tools, tool_choice: _choice, parallel_tool_calls: _parallel, messages, ...body } = request.body
    const { message, usage } = await textTurn({ messages: textTurnMessages(messages, agentTurn.tools), tools: agentTurn.tools, send: async list => {
      const data = await jsonRequest(fetchImpl, request.endpoint, { method: 'POST', headers: authHeaders, body: JSON.stringify({ ...body, messages: list }) }, signal, 3600000, 64 * 1024 * 1024)
      const choice = data?.choices?.[0]
      if (!['stop', 'length', 'eos', null, undefined].includes(choice?.finish_reason) || !choice?.message) throw providerError('INVALID_MODEL_OUTPUT')
      return { message: choice.message, usage: fromChatCompletions(data.usage), cut: choice.finish_reason === 'length' }
    } })
    try { return agentResult(message, usage) } catch { throw providerError('INVALID_MODEL_OUTPUT') }
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
      // Pictures the user attaches go to every API model (owner request 2026-10-31). A model whose server refuses pictures (a text-only
      // local model: "image input is not supported", owner's live use 2026-11-10) gets the same turn again without them and a note that
      // pictures were attached, and is remembered so later turns leave pictures out at once (R-083).
      const visionKey = provider + '|' + modelName
      if (noVision.has(visionKey) && carriesImages(agentTurn.input)) agentTurn = { ...agentTurn, input: withoutImages(agentTurn.input) }
      try { request = buildAgentRequest(config, { modelName, systemPrompt, history, agentTurn, vision: config.vision !== false, maxTokens, effort }) }
      catch (error) { throw providerError(error?.code === 'TOOLS_NOT_SUPPORTED' ? 'TOOLS_NOT_SUPPORTED' : 'INVALID_INPUT') }
      if (carriesImages(agentTurn.input)) {
        try { return await agentCall(request, agentTurn) }
        catch (error) {
          if (error?.code !== 'PROVIDER_REJECTED' || !IMAGE_REFUSAL.test(String(error.detail || ''))) throw error
          noVision.add(visionKey)
          agentTurn = { ...agentTurn, input: withoutImages(agentTurn.input) }
          try { request = buildAgentRequest(config, { modelName, systemPrompt, history, agentTurn, vision: config.vision !== false, maxTokens, effort }) }
          catch { throw error }
        }
      }
      return agentCall(request, agentTurn)
    }
    async function agentCall(request, agentTurn) {
      if (provider === 'openrouter-api') request.body.provider = { allow_fallbacks: false }
      // A local OpenAI-compatible server whose model has no native tool calling (llama.cpp without --jinja rejects the tools field; some
      // templates make the model write the call as text) gets the validated text protocol instead of losing its tools (R-082).
      const local = config.kind === 'local' && config.protocol === 'chat'
      if (local && textModels.has(modelName)) return localTextTurn(request, { authHeaders, signal, agentTurn })
      let data
      try { data = await jsonRequest(fetchImpl, request.endpoint, { method: 'POST', headers: authHeaders, body: JSON.stringify(request.body) }, signal, 3600000, 64 * 1024 * 1024) }
      catch (error) {
        if (!local || error?.code !== 'PROVIDER_REJECTED') throw error
        // Remembered only when the text protocol works; a rejection for another reason (too long, model not loaded) stays the error.
        let result
        try { result = await localTextTurn(request, { authHeaders, signal, agentTurn }) } catch (second) { if (['CANCELLED', 'CONTEXT_LIMIT'].includes(second?.code)) throw second; throw error }
        textModels.add(modelName)
        return result
      }
      if (local) {
        const message = data?.choices?.[0]?.message
        if (message && !message.tool_calls?.length && typeof message.content === 'string' && /<tool_call>|"name"\s*:|<\|tool_call_start\|>|\[TOOL_CALLS\]|<function=|^\s*\[\s*[A-Za-z_][\w-]*\(/.test(message.content)) {
          const parsed = parseReply(message, agentTurn.tools)
          if (parsed.message?.tool_calls) return agentResult(parsed.message, fromChatCompletions(data.usage))
        }
      }
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
