// The agent tool loop for providers that do not speak the Responses API. NAJD's turn is Responses-shaped (tools + input items: user messages, function_call,
// function_call_output); this module translates it to Chat Completions (OpenAI-compatible servers such as OpenRouter, LM Studio, DeepSeek, Groq, Mistral...),
// Anthropic Messages (Claude) and Gemini generateContent, and translates the answer back. One tool call per turn, like the Responses path.
const { chatTools, chatMessages, agentResult, clipThinking } = require('./chat-tools.cjs')
const { fromAnthropic, fromGemini, fromChatCompletions } = require('./usage.cjs')

const fail = code => Object.assign(new Error(code), { code })
let counter = 0
const newId = () => 'call_' + Date.now().toString(36) + '_' + (++counter)

const parseArguments = text => { try { const value = JSON.parse(text); return value && typeof value === 'object' && !Array.isArray(value) ? value : {} } catch { throw fail('INVALID_INPUT') } }

function dataUrlParts(url) {
  const match = /^data:([^;,]+);base64,(.+)$/s.exec(String(url))
  if (!match) throw fail('INVALID_INPUT')
  return { mediaType: match[1], data: match[2] }
}

// ---------- Anthropic Messages ----------
function anthropicRequest({ systemPrompt, history, input, tools, vision }) {
  const messages = []
  const push = (role, blocks) => {
    const last = messages.at(-1)
    if (last && last.role === role) last.content.push(...blocks)   // Anthropic needs strictly alternating roles
    else messages.push({ role, content: [...blocks] })
  }
  for (const { role, text } of history) push(role === 'assistant' ? 'assistant' : 'user', [{ type: 'text', text }])
  for (const item of input) {
    if (item?.role === 'user') {
      if (typeof item.content === 'string') { push('user', [{ type: 'text', text: item.content }]); continue }
      if (!Array.isArray(item.content)) throw fail('INVALID_INPUT')
      const blocks = []
      for (const part of item.content) {
        if (part.type === 'input_text') blocks.push({ type: 'text', text: part.text })
        else if (part.type === 'input_image') {
          if (!vision) throw fail('TOOLS_NOT_SUPPORTED')
          const { mediaType, data } = dataUrlParts(part.image_url)
          blocks.push({ type: 'image', source: { type: 'base64', media_type: mediaType, data } })
        }
      }
      push('user', blocks.length ? blocks : [{ type: 'text', text: '' }])
    } else if (item?.type === 'function_call') {
      push('assistant', [{ type: 'tool_use', id: item.call_id, name: item.name, input: parseArguments(item.arguments) }])
    } else if (item?.type === 'function_call_output') {
      push('user', [{ type: 'tool_result', tool_use_id: item.call_id, content: String(item.output) }])
    } else if (item?.type === 'reasoning') continue
    else throw fail('INVALID_INPUT')
  }
  if (!messages.length || messages[0].role !== 'user') messages.unshift({ role: 'user', content: [{ type: 'text', text: 'Continue.' }] })
  return {
    ...(systemPrompt ? { system: systemPrompt } : {}), messages,
    tools: tools.map(tool => ({ name: tool.name, description: String(tool.description || ''), input_schema: tool.parameters })),
    tool_choice: { type: 'auto', disable_parallel_tool_use: true }
  }
}

function anthropicResult(data) {
  if (!Array.isArray(data?.content) || !['end_turn', 'tool_use', 'stop_sequence', 'max_tokens'].includes(data.stop_reason)) throw fail('INVALID_MODEL_OUTPUT')
  const usage = fromAnthropic(data.usage)
  const thinking = clipThinking(data.content.filter(block => block.type === 'thinking' && typeof block.thinking === 'string').map(block => block.thinking).join('\n\n'))
  const thought = thinking ? { thinking } : {}
  const use = data.content.find(block => block.type === 'tool_use')
  if (use) {
    const args = JSON.stringify(use.input ?? {})
    if (typeof use.name !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(use.name) || args.length > 4000000) throw fail('INVALID_MODEL_OUTPUT')
    const id = typeof use.id === 'string' && /^[A-Za-z0-9_.:-]{1,120}$/.test(use.id) ? use.id : newId()
    return { kind: 'agent-tools', calls: [{ name: use.name, arguments: args, call_id: id }], items: [{ type: 'function_call', name: use.name, arguments: args, call_id: id }], usage, ...thought }
  }
  const text = data.content.filter(block => block.type === 'text' && typeof block.text === 'string').map(block => block.text).join('').trim()
  if (!text) throw fail('INVALID_MODEL_OUTPUT')
  return { kind: 'message', text, usage, ...thought }
}

// ---------- Gemini ----------
const GEMINI_KEYS = new Set(['type', 'format', 'description', 'nullable', 'enum', 'properties', 'required', 'items', 'minItems', 'maxItems', 'minimum', 'maximum', 'title'])
// Gemini accepts an OpenAPI-style subset of JSON Schema: unsupported keywords are dropped and a nullable union becomes "nullable".
function geminiSchema(schema) {
  if (Array.isArray(schema)) return schema.map(geminiSchema)
  if (!schema || typeof schema !== 'object') return schema
  const out = {}
  for (const [key, value] of Object.entries(schema)) {
    if (key === 'type' && Array.isArray(value)) {
      const types = value.filter(type => type !== 'null')
      out.type = types[0] || 'string'
      if (types.length !== value.length) out.nullable = true
    } else if (key === 'properties' && value && typeof value === 'object') out.properties = Object.fromEntries(Object.entries(value).map(([name, child]) => [name, geminiSchema(child)]))
    else if (key === 'items') out.items = geminiSchema(value)
    else if (GEMINI_KEYS.has(key)) out[key] = value
  }
  if (out.type === 'object' && !out.properties) out.properties = {}
  return out
}

function geminiRequest({ systemPrompt, history, input, tools, vision }) {
  const contents = []
  const names = new Map()
  const push = (role, parts) => {
    const last = contents.at(-1)
    if (last && last.role === role) last.parts.push(...parts)
    else contents.push({ role, parts: [...parts] })
  }
  for (const { role, text } of history) push(role === 'assistant' ? 'model' : 'user', [{ text }])
  for (const item of input) {
    if (item?.role === 'user') {
      if (typeof item.content === 'string') { push('user', [{ text: item.content }]); continue }
      if (!Array.isArray(item.content)) throw fail('INVALID_INPUT')
      const parts = []
      for (const part of item.content) {
        if (part.type === 'input_text') parts.push({ text: part.text })
        else if (part.type === 'input_image') {
          if (!vision) throw fail('TOOLS_NOT_SUPPORTED')
          const { mediaType, data } = dataUrlParts(part.image_url)
          parts.push({ inlineData: { mimeType: mediaType, data } })
        }
      }
      push('user', parts.length ? parts : [{ text: '' }])
    } else if (item?.type === 'function_call') {
      names.set(item.call_id, item.name)
      push('model', [{ functionCall: { name: item.name, args: parseArguments(item.arguments) }, ...(typeof item.thoughtSignature === 'string' ? { thoughtSignature: item.thoughtSignature } : {}) }])
    } else if (item?.type === 'function_call_output') {
      const name = names.get(item.call_id)
      if (!name) throw fail('INVALID_INPUT')
      let response
      try { const parsed = JSON.parse(item.output); response = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : { result: parsed } } catch { response = { result: String(item.output) } }
      push('user', [{ functionResponse: { name, response } }])
    } else if (item?.type === 'reasoning') continue
    else throw fail('INVALID_INPUT')
  }
  if (!contents.length || contents[0].role !== 'user') contents.unshift({ role: 'user', parts: [{ text: 'Continue.' }] })
  return {
    ...(systemPrompt ? { systemInstruction: { parts: [{ text: systemPrompt }] } } : {}), contents,
    tools: [{ functionDeclarations: tools.map(tool => ({ name: tool.name, description: String(tool.description || ''), parameters: geminiSchema(tool.parameters) })) }],
    toolConfig: { functionCallingConfig: { mode: 'AUTO' } }
  }
}

function geminiResult(data) {
  const candidate = data?.candidates?.[0]
  if (!candidate || !Array.isArray(candidate.content?.parts) || !['STOP', 'MAX_TOKENS'].includes(candidate.finishReason)) throw fail('INVALID_MODEL_OUTPUT')
  const usage = fromGemini(data.usageMetadata)
  const thinking = clipThinking(candidate.content.parts.filter(part => part.thought && typeof part.text === 'string').map(part => part.text).join('\n\n'))
  const thought = thinking ? { thinking } : {}
  const call = candidate.content.parts.find(part => part.functionCall)
  if (call) {
    const name = call.functionCall.name, args = JSON.stringify(call.functionCall.args ?? {})
    if (typeof name !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(name) || args.length > 4000000) throw fail('INVALID_MODEL_OUTPUT')
    const id = newId()
    return { kind: 'agent-tools', calls: [{ name, arguments: args, call_id: id }],
      items: [{ type: 'function_call', name, arguments: args, call_id: id, ...(typeof call.thoughtSignature === 'string' ? { thoughtSignature: call.thoughtSignature } : {}) }], usage, ...thought }
  }
  const text = candidate.content.parts.filter(part => typeof part.text === 'string' && !part.thought).map(part => part.text).join('').trim()
  if (!text) throw fail('INVALID_MODEL_OUTPUT')
  return { kind: 'message', text, usage, ...thought }
}

// ---------- entry points used by provider-client ----------
function buildAgentRequest(config, { modelName, systemPrompt, history, agentTurn, vision, maxTokens, effort }) {
  const { input, tools } = agentTurn
  if (config.protocol === 'anthropic') {
    return { endpoint: `${config.baseUrl}/messages`, body: { model: modelName, max_tokens: maxTokens || 32000, stream: false, ...anthropicRequest({ systemPrompt, history, input, tools: chatTools(tools).map(t => ({ name: t.function.name, description: t.function.description, parameters: t.function.parameters })), vision }) } }
  }
  if (config.protocol === 'gemini') {
    return { endpoint: `${config.baseUrl}/models/${encodeURIComponent(modelName)}:generateContent`,
      body: { ...geminiRequest({ systemPrompt, history, input, tools: chatTools(tools).map(t => ({ name: t.function.name, description: t.function.description, parameters: t.function.parameters })), vision }), ...(maxTokens ? { generationConfig: { maxOutputTokens: maxTokens } } : {}) } }
  }
  // Chat Completions (OpenAI-compatible)
  return { endpoint: `${config.baseUrl}/chat/completions`, body: { model: modelName, stream: false, ...(maxTokens ? { max_tokens: maxTokens } : {}),
    messages: chatMessages({ systemPrompt, history, input, dialect: 'openai', vision }), tools: chatTools(tools), tool_choice: 'auto', parallel_tool_calls: false, ...(effort ? { reasoning_effort: effort } : {}) } }
}

function parseAgentResponse(config, data) {
  if (config.protocol === 'anthropic') return anthropicResult(data)
  if (config.protocol === 'gemini') return geminiResult(data)
  const choice = data?.choices?.[0]
  if (!['stop', 'tool_calls', 'length', 'function_call'].includes(choice?.finish_reason)) throw fail('INVALID_MODEL_OUTPUT')
  return agentResult(choice.message, fromChatCompletions(data.usage))
}

module.exports = { buildAgentRequest, parseAgentResponse, geminiSchema, anthropicRequest, geminiRequest }
