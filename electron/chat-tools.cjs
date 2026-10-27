// Translate NAJD's Responses-style agent turn (tools + input items) to Chat Completions style messages
// for providers without the Responses API (Ollama native /api/chat, Kimi and other OpenAI-compatible APIs),
// and translate their tool calls back. One tool call per turn, like the Responses path.
const fail = code => Object.assign(new Error(code), { code })

function chatTools(tools) {
  if (!Array.isArray(tools) || tools.length > 24) throw fail('INVALID_INPUT')
  return tools.map(tool => {
    if (tool?.type !== 'function' || typeof tool.name !== 'string' || !tool.parameters) throw fail('INVALID_INPUT')
    return { type: 'function', function: { name: tool.name, description: String(tool.description || ''), parameters: tool.parameters } }
  })
}

// dialect: 'ollama' (arguments as objects, images as base64 list) or 'openai' (arguments as JSON strings, image parts).
function chatMessages({ systemPrompt, history, input, dialect, vision = false }) {
  const messages = []
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt })
  for (const { role, text } of history) messages.push({ role, content: text })
  for (const item of input) {
    if (item?.role === 'user') {
      if (typeof item.content === 'string') { messages.push({ role: 'user', content: item.content }); continue }
      if (!Array.isArray(item.content)) throw fail('INVALID_INPUT')
      const text = item.content.filter(part => part.type === 'input_text').map(part => part.text).join('\n')
      const images = item.content.filter(part => part.type === 'input_image').map(part => String(part.image_url))
      if (images.length && !vision) throw fail('TOOLS_NOT_SUPPORTED')
      messages.push(dialect === 'ollama'
        ? { role: 'user', content: text, ...(images.length ? { images: images.map(url => url.replace(/^data:[^;]+;base64,/, '')) } : {}) }
        : { role: 'user', content: [{ type: 'text', text }, ...images.map(url => ({ type: 'image_url', image_url: { url } }))] })
    } else if (item?.type === 'function_call') {
      let args
      try { args = JSON.parse(item.arguments) } catch { throw fail('INVALID_INPUT') }
      messages.push({ role: 'assistant', content: '', tool_calls: [dialect === 'ollama'
        ? { function: { name: item.name, arguments: args } }
        : { id: item.call_id, type: 'function', function: { name: item.name, arguments: item.arguments } }] })
    } else if (item?.type === 'function_call_output') {
      messages.push(dialect === 'ollama' ? { role: 'tool', content: String(item.output) } : { role: 'tool', tool_call_id: item.call_id, content: String(item.output) })
    } else if (item?.type === 'reasoning') continue
    else throw fail('INVALID_INPUT')
  }
  return messages
}

// Normalize one assistant message to NAJD's agent result. Only the first tool call is used.
let counter = 0
// The model's own reasoning, shown to the owner as it thinks (owner request 2026-10-24, like LM Studio): reasoning_content (Kimi, DeepSeek,
// LM Studio), reasoning or thinking (OpenRouter, Ollama), or a leading <think> block in the answer, which is taken out of the answer.
const MAX_THINKING = 12000
const clipThinking = text => { const value = typeof text === 'string' ? text.trim() : ''; return value.length > MAX_THINKING ? value.slice(0, MAX_THINKING) + '…' : value }
function splitThinking(message) {
  let content = typeof message?.content === 'string' ? message.content : ''
  let thinking = [message?.reasoning_content, message?.reasoning, message?.thinking].find(value => typeof value === 'string' && value.trim()) || ''
  const tagged = /^\s*<think>([\s\S]*?)<\/think>\s*/i.exec(content)
  if (tagged) { thinking ||= tagged[1]; content = content.slice(tagged[0].length) }
  return { content, thinking: clipThinking(thinking) }
}

function agentResult(message, usage) {
  const { content, thinking } = splitThinking(message)
  const thought = thinking ? { thinking } : {}
  const calls = Array.isArray(message?.tool_calls) ? message.tool_calls : []
  if (calls.length) {
    const first = calls[0]
    const name = first?.function?.name
    const raw = first?.function?.arguments
    const args = typeof raw === 'string' ? raw : JSON.stringify(raw ?? {})
    if (typeof name !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(name) || args.length > 220000) throw fail('INVALID_MODEL_OUTPUT')
    const id = typeof first.id === 'string' && /^[A-Za-z0-9_.:-]{1,120}$/.test(first.id) ? first.id : 'call_' + Date.now().toString(36) + '_' + (++counter)
    return { kind: 'agent-tools', calls: [{ name, arguments: args, call_id: id }], items: [{ type: 'function_call', name, arguments: args, call_id: id }], usage, ...thought }
  }
  const text = content.trim()
  if (!text || text.length > 4000000) throw fail('INVALID_MODEL_OUTPUT')
  return { kind: 'message', text, usage, ...thought }
}
module.exports = { chatTools, chatMessages, agentResult, splitThinking, clipThinking }
