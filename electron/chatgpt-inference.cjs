const { agentTurnSize } = require('./agent-context.cjs')
const { fromResponses } = require('./usage.cjs')
const agentTurnSizeSafe = turn => { try { return agentTurnSize(turn) } catch { return Infinity } }
const { providerError, jsonRequest, outputTokenLimit, validateSystemPrompt } = require('./provider-http.cjs')
const { readTool, parseReadProposal } = require('./model-file-tool.cjs')
const { modelWindow } = require('./model-window.cjs')
const { clipThinking } = require('./chat-tools.cjs')
const API = 'https://api.openai.com/v1'
const modelPattern = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/

function createChatGPTInference({ fetchImpl = fetch, apiBase = API, catalog = 'subscription' } = {}) {
  if (![API, 'https://api.x.ai/v1'].includes(apiBase) || !['subscription', 'api'].includes(catalog)) throw providerError('INVALID_INPUT')
  async function listModels(accessToken, signal) {
    const data = await jsonRequest(fetchImpl, `${apiBase}/models`, { headers: { Authorization: `Bearer ${accessToken}` } }, signal)
    if (catalog === 'api') {
      if (!Array.isArray(data?.data) || data.data.length > 2000) throw providerError('INVALID_MODEL_OUTPUT')
      return data.data.filter(m => typeof m?.id === 'string' && modelPattern.test(m.id) && !/embed|image|audio|tts|whisper|moderation|realtime/i.test(m.id))
        .map(m => ({ id: m.id, label: m.id, contextWindow: modelWindow(m, m.id) }))
    }
    if (!Array.isArray(data?.models) || data.models.length > 500) throw providerError('INVALID_MODEL_OUTPUT')
    return data.models.filter(m => m?.visibility === 'list' && typeof m.slug === 'string' && modelPattern.test(m.slug))
      .map(m => ({ id: m.slug, label: typeof m.display_name === 'string' ? m.display_name.slice(0, 150) : m.slug, contextWindow: modelWindow(m, m.slug) }))
  }

  async function chat({ accessToken, modelName, history, signal, reasoningEffort, readPath, maxOutputTokens = 0, systemPrompt, agentTurn }) {
    validateSystemPrompt(systemPrompt)
    const maxTokens = outputTokenLimit(maxOutputTokens)
    if (!accessToken) throw providerError('AUTH_REQUIRED')
    if (!modelPattern.test(modelName || '') || !Array.isArray(history) || !history.length || history.length > 500 ||
        history.at(-1)?.role !== 'user' || history.some(m => !m || !['user', 'assistant'].includes(m.role) ||
          typeof m.text !== 'string' || !m.text.trim() || m.text.length > 4000000) ||
        history.reduce((n, m) => n + m.text.length, 0) > 20000000) throw providerError('INVALID_INPUT')
    const tool = readPath === undefined ? null : readTool(readPath)
    if (agentTurn && (tool || !Array.isArray(agentTurn.tools) || agentTurn.tools.length > 24 ||
        !Array.isArray(agentTurn.input) || agentTurnSizeSafe(agentTurn) > 40000000)) throw providerError('INVALID_INPUT')
    let proposal = null, usage = null, thinking = ''
    const local = new AbortController()
    const timeout = AbortSignal.timeout(3600000) // a safety net only: one answer may take long (owner decision 2026-10-24)
    const combined = AbortSignal.any([local.signal, timeout, ...(signal ? [signal] : [])])
    let output = ''
    const streamed = []
    let completed = false
    let buffer = ''
    let bytes = 0
    function event(block) {
      const data = block.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n')
      if (!data || data === '[DONE]') return
      let item
      try { item = JSON.parse(data) } catch { throw providerError('INVALID_MODEL_OUTPUT') }
      if (item.type === 'response.output_item.done') {
        // Output items also arrive one by one; since 2026-10 the final response.completed event can carry an empty
        // output list (store: false), so the streamed items are the record of what the model produced.
        if (!item.item || typeof item.item !== 'object') throw providerError('INVALID_MODEL_OUTPUT')
        streamed.push(item.item)
        if (streamed.length > 64) throw providerError('INVALID_MODEL_OUTPUT')
      } else if (item.type === 'response.output_text.delta') {
        if (typeof item.delta !== 'string') throw providerError('INVALID_MODEL_OUTPUT')
        output += item.delta
        if (output.length > 400000) throw providerError('INVALID_MODEL_OUTPUT')
      } else if (['response.failed', 'response.incomplete', 'error'].includes(item.type)) {
        const code = item.response?.error?.code || item.error?.code || item.code
        throw providerError(code === 'subscription_sharing_usage_limit_exceeded' ? 'PROVIDER_RATE_LIMIT' :
          code === 'subscription_sharing_usage_unavailable' ? 'PLAN_NOT_ENABLED' : 'PROVIDER_ERROR')
      } else if (item.type === 'response.completed') {
        if (completed) throw providerError('INVALID_MODEL_OUTPUT')
        if (item.response?.status && item.response.status !== 'completed') throw providerError('INVALID_MODEL_OUTPUT')
        const reported = item.response?.output || []
        if (!Array.isArray(reported)) throw providerError('INVALID_MODEL_OUTPUT')
        const items = reported.length ? reported : streamed
        const calls = items.filter(item => item.type === 'function_call')
        if (tool) {
          if (calls.length !== 1) throw providerError('INVALID_MODEL_OUTPUT')
          proposal = parseReadProposal(calls[0].name, calls[0].arguments, readPath)
        } else if (calls.length) {
          // One call per step: when the model asks for several at once, the first runs now and the model sees only that
          // call (it asks again for the rest). Item kinds NAJD does not use are left out instead of failing the task, and
          // reasoning carried over a long task may be large (owner live test 2026-10-19).
          const kept = items.filter(item => ['reasoning', 'message'].includes(item.type) || item === calls[0])
          if (!agentTurn || JSON.stringify(kept).length > 4000000) throw providerError('INVALID_MODEL_OUTPUT')
          proposal = { kind: 'agent-tools', calls: [calls[0]], items: kept }
        }
        if (!output) output = items.flatMap(message => message.content || [])
          .filter(content => content.type === 'output_text' && typeof content.text === 'string').map(content => content.text).join('')
        // Provider-reported token usage (null fields when not reported; cached tokens passed through).
        usage = fromResponses(item.response?.usage)
        // The reasoning summary the account returns (asked for below), shown to the owner as the model's thinking.
        thinking = clipThinking(items.filter(entry => entry?.type === 'reasoning' && Array.isArray(entry.summary)).flatMap(entry => entry.summary)
          .filter(part => part?.type === 'summary_text' && typeof part.text === 'string').map(part => part.text).join('\n\n'))
        completed = true
      }
    }
    try {
      const response = await fetchImpl(`${apiBase}/responses`, {
        method: 'POST', redirect: 'error', signal: combined,
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify({ model: modelName, store: false, stream: true,
          ...(systemPrompt === undefined ? {} : { instructions: systemPrompt }),
          ...(maxTokens ? { max_output_tokens: maxTokens } : {}),
          ...(tool ? { tools: [{ type: 'function', ...tool, strict: true }], tool_choice: { type: 'function', name: tool.name }, parallel_tool_calls: false } : {}),
          ...(agentTurn ? { tools: agentTurn.tools, parallel_tool_calls: false, include: ['reasoning.encrypted_content'] } : {}),
          // The same key for every call of a conversation lets the service reuse its cached prompt prefix (it reported no cached tokens without it).
          ...(typeof agentTurn?.cacheKey === 'string' && /^[A-Za-z0-9-]{1,64}$/.test(agentTurn.cacheKey) ? { prompt_cache_key: agentTurn.cacheKey } : {}),
          input: [...history.map(({ role, text }) => ({ role, content: text })), ...(agentTurn?.input || [])],
          ...(reasoningEffort ? { reasoning: { effort: reasoningEffort, ...(catalog === 'subscription' ? { summary: 'auto' } : {}) } } : {}) })
      })
      if (response.status === 401) throw providerError('AUTH_REQUIRED')
      if (response.status === 429) throw providerError('PROVIDER_RATE_LIMIT')
      if (!response.ok) throw providerError('PROVIDER_REJECTED')
      if (!response.body) throw providerError('INVALID_MODEL_OUTPUT')
      const decoder = new TextDecoder('utf-8', { fatal: true })
      for await (const chunk of response.body) {
        bytes += chunk.length
        if (bytes > 2 * 1024 * 1024) throw providerError('INVALID_MODEL_OUTPUT')
        buffer += decoder.decode(chunk, { stream: true })
        let separator
        while ((separator = /\r?\n\r?\n/.exec(buffer))) {
          event(buffer.slice(0, separator.index))
          buffer = buffer.slice(separator.index + separator[0].length)
        }
      }
      buffer += decoder.decode()
      if (buffer.trim()) event(buffer)
      if (!completed) throw providerError('INVALID_MODEL_OUTPUT')
      const thought = thinking ? { thinking } : {}
      if (proposal) return { ...proposal, ...(usage ? { usage } : {}), ...thought }
      if (!output.trim() || output.length > 400000) throw providerError('INVALID_MODEL_OUTPUT')
      return { kind: 'message', text: output.trim(), ...(usage ? { usage } : {}), ...thought }
    } catch (error) {
      local.abort()
      if (signal?.aborted) throw providerError('CANCELLED')
      if (timeout.aborted) throw providerError('PROVIDER_TIMEOUT')
      if (['AUTH_REQUIRED', 'PROVIDER_RATE_LIMIT', 'PROVIDER_REJECTED', 'PLAN_NOT_ENABLED', 'INVALID_MODEL_OUTPUT', 'PROVIDER_ERROR'].includes(error?.code)) throw error
      throw providerError('PROVIDER_ERROR')
    }
  }
  return { listModels, chat }
}

module.exports = { createChatGPTInference }
