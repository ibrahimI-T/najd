const modelNamePattern = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/
const MAX_RESPONSE_BYTES = 1024 * 1024
const { readTool, parseReadProposal } = require('./model-file-tool.cjs')
const { outputTokenLimit } = require('./provider-http.cjs')
const { chatTools, chatMessages, agentResult } = require('./chat-tools.cjs')
const { fromOllama } = require('./usage.cjs')
const { agentTurnSize } = require('./agent-context.cjs')
// Pictures count as a fixed cost (each bounded in size and number), not by their base64 length (M2-R10-002).
const agentTurnSizeSafe = turn => { try { return agentTurnSize(turn) } catch { return Infinity } }

function providerError(code) { return Object.assign(new Error(code), { code }) }

// A local model may need a long time on a slow computer; the hour is only a safety net (owner decision 2026-10-24).
function createOllamaClient({ baseUrl = 'http://127.0.0.1:11434', timeoutMs = 3600000 } = {}) {
  let endpoint
  try { endpoint = new URL(baseUrl) }
  catch { throw providerError('INVALID_INPUT') }
  if (endpoint.protocol !== 'http:' || endpoint.hostname !== '127.0.0.1' ||
      !endpoint.port || endpoint.username || endpoint.password || endpoint.pathname !== '/' ||
      endpoint.search || endpoint.hash || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 3600000) {
    throw providerError('INVALID_INPUT')
  }

  async function request(route, options = {}, signal) {
    const timeout = AbortSignal.timeout(timeoutMs)
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout
    let response
    try {
      response = await fetch(new URL(route, endpoint), { ...options, signal: combined, redirect: 'error' })
      if (!response.ok) throw providerError(response.status === 404 ? 'MODEL_NOT_FOUND' : 'PROVIDER_ERROR')
      if (!response.body) throw providerError('INVALID_MODEL_OUTPUT')
      const chunks = []
      let size = 0
      for await (const chunk of response.body) {
        size += chunk.length
        if (size > MAX_RESPONSE_BYTES) throw providerError('INVALID_MODEL_OUTPUT')
        chunks.push(chunk)
      }
      try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) }
      catch { throw providerError('INVALID_MODEL_OUTPUT') }
    } catch (error) {
      if (typeof error?.code === 'string' && ['MODEL_NOT_FOUND', 'PROVIDER_ERROR', 'INVALID_MODEL_OUTPUT'].includes(error.code)) throw error
      if (timeout.aborted) throw providerError('PROVIDER_TIMEOUT')
      if (signal?.aborted) throw providerError('CANCELLED')
      throw providerError(response ? 'INVALID_MODEL_OUTPUT' : 'OLLAMA_UNAVAILABLE')
    }
  }

  async function listModels() {
    const result = await request('/api/tags')
    if (!result || !Array.isArray(result.models) || result.models.length > 500) throw providerError('INVALID_MODEL_OUTPUT')
    return result.models.map(model => model?.name).filter(name => typeof name === 'string' && modelNamePattern.test(name))
  }

  // Model capabilities reported by Ollama itself (e.g. "completion", "tools", "vision").
  async function capabilities(modelName, signal) {
    if (typeof modelName !== 'string' || !modelNamePattern.test(modelName)) throw providerError('INVALID_INPUT')
    const details = await request('/api/show', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: modelName }) }, signal)
    return Array.isArray(details?.capabilities) ? details.capabilities.filter(item => typeof item === 'string').slice(0, 20) : []
  }

  async function chat({ modelName, history, signal, readPath, maxOutputTokens = 0, systemPrompt, agentTurn } = {}) {
    if (systemPrompt !== undefined && (typeof systemPrompt !== 'string' || !systemPrompt.trim() || systemPrompt.length > 400000 || readPath !== undefined)) throw providerError('INVALID_INPUT')
    const maxTokens = outputTokenLimit(maxOutputTokens)
    if (typeof modelName !== 'string' || !modelNamePattern.test(modelName) ||
        !Array.isArray(history) || history.length === 0 || history.length > 500 ||
        history.at(-1)?.role !== 'user' ||
        history.some(message => !message || !['user', 'assistant'].includes(message.role) ||
          typeof message.text !== 'string' || !message.text.trim() ||
          message.text.length > 4000000) ||
        history.reduce((total, message) => total + message.text.length, 0) > 20000000) {
      throw providerError('INVALID_INPUT')
    }
    if (agentTurn) {
      // Local agent turn: the model must declare tool support; pictures need a vision model.
      if (readPath !== undefined || !Array.isArray(agentTurn.input) || agentTurnSizeSafe(agentTurn) > 40000000) throw providerError('INVALID_INPUT')
      const caps = await capabilities(modelName, signal)
      if (!caps.includes('tools')) throw providerError('TOOLS_NOT_SUPPORTED')
      const result = await request('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: modelName, stream: false, truncate: false, shift: false,
          // Tool schemas and instructions need more than Ollama's small default context.
          options: { ...(outputTokenLimit(maxOutputTokens) ? { num_predict: outputTokenLimit(maxOutputTokens) } : {}), num_ctx: 16384 },
          tools: chatTools(agentTurn.tools),
          messages: chatMessages({ systemPrompt, history, input: agentTurn.input, dialect: 'ollama', vision: caps.includes('vision') }) }) }, signal)
      if (result?.done !== true || result.done_reason && result.done_reason !== 'stop') throw providerError('INVALID_MODEL_OUTPUT')
      return agentResult(result.message, fromOllama(result))
    }
    const tool = readPath === undefined ? null : readTool(readPath)
    if (tool) {
      const details = await request('/api/show', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: modelName }) }, signal)
      if (!Array.isArray(details?.capabilities) || !details.capabilities.includes('tools')) throw providerError('TOOLS_NOT_SUPPORTED')
    }
    const result = await request('/api/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: modelName, stream: false, truncate: false, shift: false,
        options: { ...(maxTokens ? { num_predict: maxTokens } : {}), ...(tool ? { temperature: 0, seed: 0 } : {}) },
        ...(tool ? { tools: [{ type: 'function', function: tool }] } : {}),
        messages: [
          ...(systemPrompt === undefined ? [] : [{ role: 'system', content: systemPrompt }]),
          ...(tool ? [{ role: 'system', content: 'For this explicit request, call preview_requested_file once with empty JSON arguments {}. NAJD already bound the file path from user intent. Do not supply or change a path. Do not invent file contents. Reading waits for separate approval.' }] : []),
          ...history.map(({ role, text }) => ({ role, content: text }))
        ]
      })
    }, signal)
    if (result?.done !== true || result.done_reason && result.done_reason !== 'stop') throw providerError('INVALID_MODEL_OUTPUT')
    if (tool) {
      const calls = result?.message?.tool_calls
      if (!Array.isArray(calls) || calls.length !== 1) throw providerError('INVALID_MODEL_OUTPUT')
      const proposal = parseReadProposal(calls[0]?.function?.name, calls[0]?.function?.arguments, readPath)
      const usage = fromOllama(result)
      return usage && proposal && typeof proposal === 'object' ? { ...proposal, usage } : proposal
    }
    const text = result?.message?.content
    if (typeof text !== 'string' || !text.trim() || text.length > 4000000) throw providerError('INVALID_MODEL_OUTPUT')
    const usage = fromOllama(result)
    return { kind: 'message', text: text.trim(), ...(usage ? { usage } : {}) }
  }

  return { listModels, chat, capabilities }
}

module.exports = { createOllamaClient }
