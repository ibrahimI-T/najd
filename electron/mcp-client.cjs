// Minimal Model Context Protocol client over stdio (newline-delimited JSON-RPC 2.0).
// The server is an external program the user configured; everything it returns is untrusted data.
const { spawn } = require('node:child_process')
const fail = (code, detail) => Object.assign(new Error(code), { code, ...(detail ? { detail } : {}) })
const PROTOCOL_VERSION = '2025-06-18'
const MAX_LINE = 4 * 1024 * 1024, MAX_TOOLS = 128, MAX_SCHEMA = 16384, MAX_RESULT = 20000

function cleanTool(tool) {
  if (!tool || typeof tool.name !== 'string' || !/^[A-Za-z0-9_.\-/]{1,64}$/.test(tool.name)) return null
  const schema = tool.inputSchema && typeof tool.inputSchema === 'object' && !Array.isArray(tool.inputSchema) ? tool.inputSchema : { type: 'object' }
  if (JSON.stringify(schema).length > MAX_SCHEMA) return null
  const annotations = tool.annotations && typeof tool.annotations === 'object' ? tool.annotations : {}
  return { name: tool.name, title: typeof tool.title === 'string' ? tool.title.slice(0, 120) : typeof annotations.title === 'string' ? annotations.title.slice(0, 120) : '',
    description: typeof tool.description === 'string' ? tool.description.slice(0, 1000) : '', inputSchema: schema,
    // Server-declared hints are shown to the user but never relax NAJD's approval rule.
    hints: { readOnly: annotations.readOnlyHint === true, destructive: annotations.destructiveHint === true, openWorld: annotations.openWorldHint !== false } }
}

// Flatten an MCP tool result into bounded text for the model.
function resultText(result) {
  const parts = []
  for (const item of Array.isArray(result?.content) ? result.content : []) {
    if (item?.type === 'text' && typeof item.text === 'string') parts.push(item.text)
    else if (item?.type === 'resource' && typeof item.resource?.text === 'string') parts.push(item.resource.text)
    else if (item?.type === 'resource_link' && typeof item.uri === 'string') parts.push('[resource] ' + item.uri)
    else if (item?.type === 'image' || item?.type === 'audio') parts.push(`[${item.type} omitted: ${String(item.mimeType || 'binary').slice(0, 60)}]`)
  }
  if (!parts.length && result?.structuredContent !== undefined) parts.push(JSON.stringify(result.structuredContent))
  const text = parts.join('\n')
  return { text: text.slice(0, MAX_RESULT), truncated: text.length > MAX_RESULT }
}

function createMcpClient({ command, args = [], cwd, env, clientVersion = '0.0.0', spawnImpl = spawn, startTimeoutMs = 180000, onExit = () => {}, onToolsChanged = () => {} }) {
  let child = null, buffer = '', nextId = 1, closed = false, stderrTail = ''
  const pending = new Map()
  let serverInfo = null, capabilities = {}

  function send(message) {
    if (!child || closed) throw fail('NOT_CONNECTED')
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n')
  }
  function request(method, params, { timeoutMs = 60000, signal } = {}) {
    return new Promise((resolve, reject) => {
      if (closed) return reject(fail('NOT_CONNECTED'))
      const id = nextId++
      const finish = (fn, value) => { clearTimeout(timer); signal?.removeEventListener('abort', abort); pending.delete(id); fn(value) }
      const timer = setTimeout(() => { try { send({ method: 'notifications/cancelled', params: { requestId: id, reason: 'timeout' } }) } catch {} finish(reject, fail('TIMEOUT')) }, timeoutMs)
      const abort = () => { try { send({ method: 'notifications/cancelled', params: { requestId: id, reason: 'cancelled by user' } }) } catch {} finish(reject, fail('CANCELLED')) }
      if (signal?.aborted) return abort()
      signal?.addEventListener('abort', abort, { once: true })
      pending.set(id, { resolve: value => finish(resolve, value), reject: error => finish(reject, error) })
      try { send({ id, method, params }) } catch (error) { finish(reject, error) }
    })
  }
  function handle(message) {
    if (!message || message.jsonrpc !== '2.0') return
    if (message.id !== undefined && message.method === undefined) {
      const waiter = pending.get(message.id)
      if (!waiter) return
      if (message.error) waiter.reject(fail('SERVER_ERROR', String(message.error.message || '').slice(0, 300)))
      else waiter.resolve(message.result)
      return
    }
    if (message.method === 'notifications/tools/list_changed') return onToolsChanged()
    if (message.id !== undefined && typeof message.method === 'string') {
      // NAJD offers no sampling, roots or elicitation to servers; answer pings only.
      if (message.method === 'ping') return send({ id: message.id, result: {} })
      send({ id: message.id, error: { code: -32601, message: 'Not supported by NAJD' } })
    }
  }
  function onData(chunk) {
    buffer += chunk
    if (buffer.length > MAX_LINE) { stop(); return }
    let index
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index).trim(); buffer = buffer.slice(index + 1)
      if (!line) continue
      try { handle(JSON.parse(line)) } catch {}
    }
  }

  async function start() {
    child = spawnImpl(command, args, { cwd, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    child.stdout.setEncoding('utf8'); child.stdout.on('data', onData)
    child.stderr.setEncoding('utf8'); child.stderr.on('data', text => { stderrTail = (stderrTail + text).slice(-4000) })
    child.stdin.on('error', () => {})
    const exited = new Promise(resolve => {
      child.once('error', error => { closed = true; for (const waiter of pending.values()) waiter.reject(fail(error.code === 'ENOENT' ? 'COMMAND_NOT_FOUND' : 'START_FAILED')); resolve() })
      child.once('exit', code => { closed = true; for (const waiter of pending.values()) waiter.reject(fail('SERVER_EXITED', 'exit ' + code)); onExit(code); resolve() })
    })
    const init = await request('initialize', { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'NAJD AGENT', version: clientVersion } }, { timeoutMs: startTimeoutMs })
      .catch(async error => { stop(); await Promise.race([exited, new Promise(r => setTimeout(r, 2000))]); throw error })
    serverInfo = { name: String(init?.serverInfo?.name || '').slice(0, 120), version: String(init?.serverInfo?.version || '').slice(0, 40), protocolVersion: String(init?.protocolVersion || '').slice(0, 20) }
    capabilities = init?.capabilities || {}
    send({ method: 'notifications/initialized' })
    return serverInfo
  }
  async function listTools() {
    if (!capabilities.tools) return []
    const tools = []
    let cursor
    for (let page = 0; page < 10; page++) {
      const result = await request('tools/list', cursor ? { cursor } : {})
      for (const tool of Array.isArray(result?.tools) ? result.tools : []) { const clean = cleanTool(tool); if (clean && tools.length < MAX_TOOLS) tools.push(clean) }
      cursor = typeof result?.nextCursor === 'string' && result.nextCursor ? result.nextCursor : null
      if (!cursor) break
    }
    return tools
  }
  async function callTool(name, args, { signal, timeoutMs = 120000 } = {}) {
    const result = await request('tools/call', { name, arguments: args }, { signal, timeoutMs })
    const structured = result?.structuredContent !== undefined && JSON.stringify(result.structuredContent).length <= 4000 ? result.structuredContent : undefined
    return { isError: result?.isError === true, ...resultText(result), ...(structured !== undefined ? { structured } : {}) }
  }
  function stop() {
    if (!child || closed) return
    closed = true
    for (const waiter of pending.values()) waiter.reject(fail('NOT_CONNECTED'))
    // On Windows the whole process tree ends at once, while the server still holds its family: a helper it started
    // cannot outlive it by being orphaned when the server exits on a closed stdin (R14-003).
    const target = child
    if (process.platform === 'win32' && target.pid) {
      try { require('node:child_process').execFile('taskkill', ['/PID', String(target.pid), '/T', '/F'], { windowsHide: true, timeout: 10000 }, () => {}) } catch {}
      // stdin stays open: closing it could let the server exit before taskkill has found its children.
      return
    }
    // Elsewhere: close stdin, then end the process if it is still running.
    try { child.stdin.end() } catch {}
    setTimeout(() => {
      if (target.exitCode !== null || target.signalCode !== null) return
      try { if (process.platform === 'win32' && target.pid) require('node:child_process').execFile('taskkill', ['/PID', String(target.pid), '/T', '/F'], { windowsHide: true }, () => {}); else target.kill() } catch {}
    }, 1500).unref?.()
  }
  return { start, listTools, callTool, stop, info: () => serverInfo, stderr: () => stderrTail, running: () => !!child && !closed }
}

module.exports = { createMcpClient, resultText, cleanTool, PROTOCOL_VERSION }
