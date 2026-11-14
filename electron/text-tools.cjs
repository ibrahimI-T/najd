// Structured tool calls for local models without native tool calling (owner request 2026-11-09: every model reaches every capability).
// The tools are described in the system prompt and the model answers a call as one tagged JSON object, the Hermes/Qwen convention most
// open models were trained on:
//   <tool_call>{"name": "najd_files_read", "arguments": {"path": "C:\\notes.txt"}}</tool_call>
// NAJD parses the reply, validates the call against the tool's own schema (name, required fields, types, enums) and only then hands it
// to the agent loop, where the usual approvals apply: a text call is never more trusted than a native one. An invalid call is sent back
// to the model with the reason so it can correct itself; it never runs. Tool results return as tagged text in a user turn, because a
// template without tool support has no tool role. Live 2026-11-09 with the owner's Ollama: LFM2.5-8B (completion only) read a file through
// this protocol and answered from it in Arabic. Families Ollama parses itself (qwen3, qwen3.5, qwen3-vl) declare native tools and take the
// native path; forced onto this one they lose the tag inside Ollama, so a declared native capability is always preferred.
const fail = code => Object.assign(new Error(code), { code })
const NAME = /^[a-zA-Z0-9_-]{1,64}$/
const MAX_ARGS = 220000

// One compact line of parameters per tool: name, type, required, enum and a short description each.
function describeParameters(schema) {
  const props = schema && typeof schema === 'object' && schema.properties && typeof schema.properties === 'object' ? schema.properties : {}
  const required = new Set(Array.isArray(schema?.required) ? schema.required : [])
  const parts = Object.entries(props).map(([key, spec]) => {
    const type = Array.isArray(spec?.type) ? spec.type.join('|') : spec?.type || 'any'
    const items = type === 'array' && spec?.items?.type ? '<' + spec.items.type + '>' : ''
    const choices = Array.isArray(spec?.enum) ? ' one of ' + spec.enum.map(value => JSON.stringify(value)).join('/') : ''
    const note = typeof spec?.description === 'string' && spec.description.trim() ? ' — ' + spec.description.trim().replace(/\s+/g, ' ').slice(0, 160) : ''
    return '    ' + key + (required.has(key) ? '' : '?') + ': ' + type + items + choices + note
  })
  return parts.length ? parts.join('\n') : '    (no arguments)'
}

function toolPrompt(tools) {
  if (!Array.isArray(tools) || tools.length > 24) throw fail('INVALID_INPUT')
  const lines = tools.map(tool => {
    if (tool?.type !== 'function' || typeof tool.name !== 'string' || !NAME.test(tool.name)) throw fail('INVALID_INPUT')
    return '- ' + tool.name + ': ' + String(tool.description || '').replace(/\s+/g, ' ').trim() + '\n' + describeParameters(tool.parameters)
  })
  return [
    '# Tools',
    'You can call the tools below. To call one, reply with exactly one block and nothing after it:',
    '<tool_call>{"name": "TOOL_NAME", "arguments": {...}}</tool_call>',
    'The arguments are a JSON object that follows the tool parameters (a name ending in ? is optional). One call per reply. NAJD runs the tool and',
    'returns its result as <tool_response name="TOOL_NAME">…</tool_response>; then call another tool or give your final answer as plain text.',
    'Never invent a tool result. When no tool is needed, answer directly without a <tool_call> block.',
    '',
    ...lines
  ].join('\n')
}

// NAJD's chat messages (chat-tools.cjs, ollama dialect) in a form a template without tool support can hold.
function textMessages(messages) {
  return messages.map(message => {
    if (message.role === 'assistant' && Array.isArray(message.tool_calls) && message.tool_calls.length) {
      const call = message.tool_calls[0].function || {}
      const args = typeof call.arguments === 'string' ? safeParse(call.arguments) ?? {} : call.arguments ?? {}
      return { role: 'assistant', content: (message.content ? message.content + '\n' : '') + '<tool_call>' + JSON.stringify({ name: call.name, arguments: args }) + '</tool_call>' }
    }
    if (message.role === 'tool') return { role: 'user', content: '<tool_response name="' + (message.name || 'tool') + '">\n' + String(message.content) + '\n</tool_response>' }
    return message
  })
}
// The name of each tool result, taken from the call before it (the ollama dialect has no name on tool messages).
function nameToolResults(messages) {
  let last = null
  return messages.map(message => {
    if (message.role === 'assistant' && message.tool_calls?.length) last = message.tool_calls[0]?.function?.name || null
    return message.role === 'tool' && last ? { ...message, name: last } : message
  })
}

function safeParse(text) { try { return JSON.parse(text) } catch { return undefined } }

// Python-style call arguments: name='text', n=3, flag=True, items=['a', 'b'] (LFM2 and Llama 3.2 write calls this way). Only literals:
// strings, numbers, booleans, None and lists of them. Returns null when the text is not exactly that.
function pythonArgs(source) {
  let at = 0
  const out = {}
  const space = () => { while (/\s/.test(source[at] || '')) at++ }
  function literal() {
    space()
    const quote = source[at]
    if (quote === '"' || quote === "'") {
      let text = ''
      for (at++; at < source.length && source[at] !== quote; at++) {
        if (source[at] === '\\' && at + 1 < source.length) { const next = source[++at]; text += next === 'n' ? '\n' : next === 't' ? '\t' : next }
        else text += source[at]
      }
      if (source[at] !== quote) throw new Error('string')
      at++; return text
    }
    if (quote === '[') {
      at++; const list = []; space()
      while (source[at] !== ']') { list.push(literal()); space(); if (source[at] === ',') { at++; space() } else if (source[at] !== ']') throw new Error('list') }
      at++; return list
    }
    const word = /^(?:-?\d+(?:\.\d+)?|True|False|None|true|false|null)/.exec(source.slice(at))
    if (!word) throw new Error('value')
    at += word[0].length
    return /^(True|true)$/.test(word[0]) ? true : /^(False|false)$/.test(word[0]) ? false : /^(None|null)$/.test(word[0]) ? null : Number(word[0])
  }
  try {
    space()
    while (at < source.length) {
      const key = /^[A-Za-z_]\w*/.exec(source.slice(at)); if (!key) return null
      at += key[0].length; space(); if (source[at] !== '=') return null
      at++; out[key[0]] = literal(); space()
      if (source[at] === ',') { at++; space() } else if (at < source.length) return null
    }
    return out
  } catch { return null }
}

// The native call formats of common open models, written as text when the server does not parse them (live 2026-11-09: LFM2.5 inside
// NAJD answered with its own <|tool_call_start|>[name(path='…')]<|tool_call_end|> instead of the <tool_call> JSON it was shown).
function nativeCall(value) {
  // LFM2 / Liquid, and Llama 3.2 Python style: [name(arg='v', ...)], optionally between <|tool_call_start|> and <|tool_call_end|>.
  const python = /(?:<\|tool_call_start\|>\s*)?\[\s*([A-Za-z_][\w-]{0,63})\(([\s\S]*?)\)\s*\](?:\s*<\|tool_call_end\|>)?/.exec(value)
  if (python && (python[0].includes('<|tool_call_start|>') || value.trim() === python[0].trim())) {
    const args = pythonArgs(python[2])
    if (args) return { name: python[1], arguments: args, raw: python[0], text: value.slice(0, python.index).trim() }
  }
  // Mistral: [TOOL_CALLS][{"name": ..., "arguments": {...}}] (or one object).
  const mistral = /\[TOOL_CALLS\]\s*(\[[\s\S]*\]|\{[\s\S]*\})/.exec(value)
  if (mistral) {
    const parsed = safeParse(mistral[1]), first = Array.isArray(parsed) ? parsed[0] : parsed
    if (first && typeof first.name === 'string') return { name: first.name, arguments: first.arguments ?? first.parameters ?? {}, raw: mistral[0], text: value.slice(0, mistral.index).trim() }
  }
  // Llama 3.1 custom: <function=name>{"arg": ...}</function>; qwen3-coder: <function=name><parameter=arg>value</parameter></function>.
  const fn = /<function=([A-Za-z_][\w-]{0,63})>([\s\S]*?)(?:<\/function>|$)/.exec(value)
  if (fn) {
    const body = fn[2].trim(), json = body.startsWith('{') ? safeParse(body) : undefined
    const params = {}
    for (const part of body.matchAll(/<parameter=([A-Za-z_]\w*)>\s*([\s\S]*?)\s*<\/parameter>/g)) { const parsed = safeParse(part[2]); params[part[1]] = parsed === undefined || typeof parsed === 'string' ? part[2] : parsed }
    const args = json && typeof json === 'object' ? json : Object.keys(params).length || !body ? params : null
    if (args) return { name: fn[1], arguments: args, raw: fn[0], text: value.slice(0, fn.index).trim() }
  }
  return null
}

// Finds a call in the reply: a <tool_call> block (also with a missing closing tag), a ```json fence, a reply that is only the JSON object,
// or a common open model's own call format (nativeCall). Returns null when the reply is an answer, or { name, arguments, text, raw }.
function extractCall(content) {
  const value = String(content || '')
  const tagged = /<tool_call>\s*([\s\S]*?)\s*(?:<\/tool_call>|$)/i.exec(value)
  if (!tagged) { const native = nativeCall(value); if (native) return native }
  const fenced = !tagged && /```(?:json|tool_call)?\s*(\{[\s\S]*?\})\s*```/i.exec(value)
  const whole = !tagged && !fenced && /^\s*(\{[\s\S]*\})\s*$/.exec(value)
  const match = tagged || fenced || whole
  if (!match) return null
  const parsed = safeParse(match[1].trim())
  const looksLikeCall = parsed && typeof parsed === 'object' && !Array.isArray(parsed) && typeof parsed.name === 'string'
  // A plain JSON answer (no "name") is an answer, not a call; a malformed tagged block is a broken call.
  if (!looksLikeCall) return tagged ? { broken: true, raw: match[0], text: value.slice(0, match.index).trim() } : null
  const args = parsed.arguments ?? parsed.parameters ?? {}
  return { name: parsed.name, arguments: typeof args === 'string' ? safeParse(args) ?? args : args, raw: match[0], text: value.slice(0, match.index).trim() }
}

const typeOk = (type, value) => type === 'string' ? typeof value === 'string'
  : type === 'integer' ? Number.isInteger(value)
  : type === 'number' ? typeof value === 'number' && Number.isFinite(value)
  : type === 'boolean' ? typeof value === 'boolean'
  : type === 'array' ? Array.isArray(value)
  : type === 'object' ? !!value && typeof value === 'object' && !Array.isArray(value)
  : type === 'null' ? value === null : true

// Validation against the tool's JSON schema: the parts that decide whether a call means what the model intended (top level and one
// level into objects and arrays). Returns a list of problems, empty when the call is valid.
function schemaProblems(schema, value, at = 'arguments', depth = 0) {
  const problems = []
  if (!schema || typeof schema !== 'object') return problems
  const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : []
  if (types.length && !types.some(type => typeOk(type, value))) return [at + ' must be ' + types.join(' or ')]
  if (Array.isArray(schema.enum) && !schema.enum.some(item => JSON.stringify(item) === JSON.stringify(value))) problems.push(at + ' must be one of ' + schema.enum.map(item => JSON.stringify(item)).join(', '))
  if (depth > 3) return problems
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const key of Array.isArray(schema.required) ? schema.required : []) if (value[key] === undefined) problems.push(at + '.' + key + ' is required')
    const props = schema.properties && typeof schema.properties === 'object' ? schema.properties : {}
    for (const [key, item] of Object.entries(value)) {
      if (props[key]) problems.push(...schemaProblems(props[key], item, at + '.' + key, depth + 1))
      else if (schema.additionalProperties === false) problems.push(at + '.' + key + ' is not a parameter of this tool')
    }
  }
  if (Array.isArray(value) && schema.items) value.slice(0, 50).forEach((item, index) => problems.push(...schemaProblems(schema.items, item, at + '[' + index + ']', depth + 1)))
  return problems
}

// Edit distance with adjacent swaps counted once (optimal string alignment), stopped early past `limit`.
function editDistance(a, b, limit = 3) {
  if (Math.abs(a.length - b.length) > limit) return limit + 1
  const rows = [Array.from({ length: b.length + 1 }, (_, j) => j)]
  for (let i = 1; i <= a.length; i++) {
    rows[i] = [i]
    for (let j = 1; j <= b.length; j++) {
      rows[i][j] = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) rows[i][j] = Math.min(rows[i][j], rows[i - 2][j - 2] + 1)
    }
  }
  return rows[a.length][b.length]
}
// A misspelled tool name (live 2026-11-09: a 9B model wrote "nadj_files_read" on every attempt, corrections included) is read as the one
// loaded tool within two edits of it; ambiguous or distant names stay unknown. The tool's schema and approvals still apply.
function closeTool(name, tools) {
  const value = String(name || '').toLowerCase()
  if (value.length < 6) return null
  const near = tools.filter(item => editDistance(value, item.name.toLowerCase(), 2) <= 2)
  return near.length === 1 ? near[0] : null
}

// Turns a reply into NAJD's assistant message shape ({ content, tool_calls }) after validation, or explains what to correct.
function parseReply(message, tools) {
  const content = typeof message?.content === 'string' ? message.content : ''
  const thinking = /^\s*<think>[\s\S]*?<\/think>\s*/i.exec(content)
  const body = thinking ? content.slice(thinking[0].length) : content
  // Ollama parses some families' tags itself (qwen3, qwen3.5, live 2026-11-09): such a call arrives in tool_calls, and is validated the same way.
  const parsedCall = Array.isArray(message?.tool_calls) && message.tool_calls[0]?.function
  const found = parsedCall ? { name: String(parsedCall.name || ''), arguments: typeof parsedCall.arguments === 'string' ? safeParse(parsedCall.arguments) ?? parsedCall.arguments : parsedCall.arguments ?? {}, text: body.trim() } : extractCall(body)
  if (!found) return { message }
  if (found.broken) return { problem: 'The <tool_call> block is not valid JSON of the form {"name": "TOOL_NAME", "arguments": {...}}.', reply: content }
  const tool = tools.find(item => item.name === found.name) || closeTool(found.name, tools)
  if (tool && tool.name !== found.name) found.name = tool.name
  if (!tool) {
    const discover = ['najd_capabilities_search', 'najd_tools_load'].filter(name => tools.some(item => item.name === name))
    return { problem: 'There is no tool named ' + JSON.stringify(found.name).slice(0, 80) + ' loaded. The loaded tools are: ' + tools.map(item => item.name).join(', ') + '.' +
      (discover.length ? ' To reach another capability, call ' + discover.join(' or ') + ' first.' : ''), reply: content }
  }
  if (!found.arguments || typeof found.arguments !== 'object' || Array.isArray(found.arguments)) return { problem: 'The arguments of ' + found.name + ' must be a JSON object.', reply: content }
  const problems = schemaProblems(tool.parameters, found.arguments).slice(0, 8)
  if (problems.length) return { problem: 'The call to ' + found.name + ' is not valid: ' + problems.join('; ') + '.', reply: content }
  if (JSON.stringify(found.arguments).length > MAX_ARGS) return { problem: 'The arguments of ' + found.name + ' are too large.', reply: content }
  return { message: { ...message, content: (thinking ? thinking[0] : '') + found.text, tool_calls: [{ function: { name: found.name, arguments: found.arguments } }] } }
}

const correction = problem => ({ role: 'user', content: '<tool_error>' + problem + ' Reply again with one corrected <tool_call> block, or answer in plain text if no tool is needed.</tool_error>' })

// Usage of several attempts of one turn, summed per field (a field stays null when no attempt reported it).
const sumUsage = (total, next) => !next ? total : !total ? next : Object.fromEntries(['input', 'output', 'total', 'cached'].map(key => [key, total[key] == null && next[key] == null ? null : (total[key] || 0) + (next[key] || 0)]))

// One agent turn over the text protocol, for any server. send(messages) makes one request and returns { message, usage, cut }, where
// cut means the reply stopped at the output limit. An invalid call goes back with the reason (up to `retries` times) and never runs;
// a cut call never runs; a cut answer is kept and marked. Returns { message, usage } in NAJD's assistant message shape.
async function textTurn({ messages, tools, send, retries = 2 }) {
  let usage = null, history = messages
  for (let attempt = 0; ; attempt++) {
    const { message, usage: used, cut } = await send(history)
    usage = sumUsage(usage, used)
    const parsed = parseReply(message, tools)
    if (parsed.message) {
      if (cut && parsed.message.tool_calls) parsed.problem = 'The reply was cut before the call was complete.'
      else return { message: cut ? { ...parsed.message, content: String(parsed.message.content || '').trimEnd() + '\n\n[…]' } : parsed.message, usage }
    }
    if (attempt >= retries) return { message: { content: 'NAJD could not run the tool the model asked for: ' + parsed.problem }, usage }
    history = [...history, { role: 'assistant', content: String(parsed.reply || message?.content || '').slice(0, 20000) }, correction(parsed.problem)]
  }
}

// The messages of a text-protocol turn: the tools in the system prompt, earlier calls and results as text.
function textTurnMessages(messages, tools) {
  const prompt = toolPrompt(tools)
  const named = textMessages(nameToolResults(messages))
  return named[0]?.role === 'system' ? [{ role: 'system', content: named[0].content + '\n\n' + prompt }, ...named.slice(1)] : [{ role: 'system', content: prompt }, ...named]
}

module.exports = { toolPrompt, textMessages, nameToolResults, extractCall, schemaProblems, parseReply, correction, sumUsage, textTurn, textTurnMessages }
