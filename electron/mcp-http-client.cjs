const { cleanTool, resultText, PROTOCOL_VERSION } = require('./mcp-client.cjs')
const fail = code => Object.assign(new Error(code), { code })
function remoteUrl(value) {
  let url
  try { url = new URL(value) } catch { throw fail('INVALID_URL') }
  // https, or plain http to a server on this computer (a local MCP server under development).
  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
  if (!(url.protocol === 'https:' || (url.protocol === 'http:' && local)) || url.username || url.password || url.hash) throw fail('INVALID_URL')
  return url.href
}
function createMcpHttpClient({ url, token, clientVersion = '0.0.0', fetchImpl = globalThis.fetch }) {
  url = remoteUrl(url)
  let id = 0, session = null, info = null, capabilities = {}, version = PROTOCOL_VERSION
  const lifetime = new AbortController()
  async function rpc(method, params, options = {}, notification = false) {
    const requestId = ++id
    const bearer = typeof token === 'function' ? await token() : token
    const response = await fetchImpl(url, { method: 'POST', redirect: 'error', signal: AbortSignal.any([lifetime.signal, AbortSignal.timeout(options.timeoutMs || 60000), ...(options.signal ? [options.signal] : [])]),
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': version, ...(bearer ? { Authorization: 'Bearer ' + bearer } : {}), ...(session ? { 'Mcp-Session-Id': session } : {}) },
      body: JSON.stringify({ jsonrpc: '2.0', ...(notification ? {} : { id: requestId }), method, params }) })
    if (response.status === 404 && session) { session = null; throw fail('SESSION_EXPIRED') }
    if (!response.ok) throw Object.assign(fail(response.status === 401 || response.status === 403 ? 'AUTH_REQUIRED' : 'MCP_HTTP_' + response.status), { challenge: response.headers.get('www-authenticate') || '' })
    const nextSession = response.headers.get('mcp-session-id')
    if (method === 'initialize' && nextSession) {
      if (!/^[\x21-\x7e]{1,1024}$/.test(nextSession)) throw fail('INVALID_SESSION')
      session = nextSession
    }
    if (notification) { await response.body?.cancel(); return }
    const reader = response.body.getReader(), decoder = new TextDecoder()
    let body = '', bytes = 0
    const sse = (response.headers.get('content-type') || '').includes('text/event-stream')
    // Only the reply to this request counts; notifications and requests from the server in the same stream are skipped.
    function parse(text) { try { return JSON.parse(text) } catch { throw fail('INVALID_RESPONSE') } }
    function result(message) {
      if (!message || typeof message !== 'object' || message.jsonrpc !== '2.0' || message.id !== requestId || 'method' in message) return undefined
      if (message.error) throw Object.assign(fail('SERVER_ERROR'), { serverCode: Number.isInteger(message.error.code) ? message.error.code : null })
      if (!message.result || typeof message.result !== 'object') throw fail('INVALID_RESPONSE')
      return { value: message.result }
    }
    try {
      for (;;) {
        const chunk = await reader.read()
        if (chunk.done) break
        bytes += chunk.value.length
        if (bytes > 4 * 1024 * 1024) throw fail('MCP_RESPONSE_TOO_LARGE')
        body = (body + decoder.decode(chunk.value, { stream: true })).replace(/\r\n/g, '\n')
        if (sse) {
          let end
          while ((end = body.indexOf('\n\n')) >= 0) {
            const event = body.slice(0, end); body = body.slice(end + 2)
            const data = event.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n')
            if (data) { const found = result(parse(data)); if (found) return found.value }
          }
        }
      }
      if (!sse) { const found = result(parse(body)); if (found) return found.value }
      throw fail('INVALID_RESPONSE')
    } catch (failure) {
      // A call the owner stopped is cancelled on the server too; whether it already took effect stays unknown to the caller.
      if (options.signal?.aborted && method === 'tools/call') { void rpc('notifications/cancelled', { requestId, reason: 'cancelled by the user' }, {}, true).catch(() => {}); throw Object.assign(fail('CANCELLED'), { effectUnknown: true }) }
      if (failure?.name === 'AbortError' || failure?.name === 'TimeoutError') throw fail(method === 'tools/call' ? 'MCP_CALL_TIMEOUT' : 'MCP_TIMEOUT')
      throw failure
    } finally { await reader.cancel().catch(() => {}) }
  }
  async function start() {
    const init = await rpc('initialize', { protocolVersion: version, capabilities: {}, clientInfo: { name: 'NAJD AGENT', version: clientVersion } })
    version = init.protocolVersion || version; capabilities = init.capabilities || {}; info = init.serverInfo || {}
    await rpc('notifications/initialized', {}, {}, true)
    return info
  }
  return {
    start,
    async listTools() {
      if (!capabilities.tools) return []
      const rows = [], seen = new Set(); let cursor, renewed = false
      for (let page = 0; page < 100; page++) {
        let data
        // Listing has no effect, so an expired session is renewed once and the listing starts over.
        try { data = await rpc('tools/list', cursor ? { cursor } : {}) }
        catch (failure) { if (failure?.code !== 'SESSION_EXPIRED' || renewed) throw failure; renewed = true; await start(); rows.length = 0; seen.clear(); cursor = undefined; page = -1; continue }
        rows.push(...(data.tools || []).map(cleanTool).filter(Boolean))
        if (rows.length > 2000) throw fail('MCP_TOOL_LIMIT')
        cursor = data.nextCursor
        if (!cursor) return rows
        if (seen.has(cursor)) throw fail('MCP_CURSOR_LOOP')
        seen.add(cursor)
      }
      throw fail('MCP_PAGE_LIMIT')
    },
    async callTool(name, args, options) { const data = await rpc('tools/call', { name, arguments: args }, options); return { isError: data.isError === true, ...resultText(data) } },
    // Ends the session on the server when it has one (best effort), then stops every request in flight.
    stop() { if (session) void fetchImpl(url, { method: 'DELETE', redirect: 'error', signal: AbortSignal.timeout(3000), headers: { 'Mcp-Session-Id': session, 'MCP-Protocol-Version': version, ...(typeof token === 'string' && token ? { Authorization: 'Bearer ' + token } : {}) } }).catch(() => {}); session = null; lifetime.abort() }, info: () => info
  }
}
module.exports = { createMcpHttpClient, remoteUrl }
