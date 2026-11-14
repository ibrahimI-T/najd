const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createMcpHttpClient, remoteUrl } = require('../electron/mcp-http-client.cjs')
test('HTTP MCP initializes, retains session, pages tools and consumes SSE replies', async () => {
  const requests = []
  const client = createMcpHttpClient({ url: 'https://fixture.example/mcp', token: 'fixture-secret', fetchImpl: async (url, options) => {
    const body = JSON.parse(options.body); requests.push({ body, headers: options.headers })
    if (!body.id) return new Response(null, { status: 202 })
    let result = body.method === 'initialize' ? { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'fixture' } }
      : body.method === 'tools/list' ? { tools: [{ name: body.params.cursor ? 'second' : 'first' }], ...(body.params.cursor ? {} : { nextCursor: 'two' }) }
      : { content: [{ type: 'text', text: 'executed' }] }
    const message = JSON.stringify({ jsonrpc: '2.0', id: body.id, result })
    return new Response(body.method === 'tools/call' ? 'data: ' + message + '\n\n' : message, { headers: { 'content-type': body.method === 'tools/call' ? 'text/event-stream' : 'application/json', 'mcp-session-id': 'fixture-session' } })
  } })
  await client.start()
  assert.deepEqual((await client.listTools()).map(tool => tool.name), ['first', 'second'])
  assert.equal((await client.callTool('first', {})).text, 'executed')
  assert.equal(requests[1].headers['Mcp-Session-Id'], 'fixture-session')
  assert.equal(requests[1].headers.Authorization, 'Bearer fixture-secret')
  client.stop()
})
test('HTTP MCP rejects unsafe URLs and reports authentication failures', async () => {
  for (const url of ['http://example.com', 'https://user:secret@example.com', 'https://example.com/#secret']) assert.throws(() => remoteUrl(url))
  const client = createMcpHttpClient({ url: 'https://fixture.example/mcp', fetchImpl: async () => new Response(null, { status: 401 }) })
  await assert.rejects(client.start(), { code: 'AUTH_REQUIRED' })
})

// A fixture server: replies are split at awkward places, notifications and server requests are interleaved, and failures are shaped
// the way real servers send them.
function fixture(handler) {
  const seen = []
  const fetchImpl = async (url, options) => {
    if (options.method === 'DELETE') { seen.push({ delete: options.headers['Mcp-Session-Id'] }); return new Response(null, { status: 204 }) }
    const body = JSON.parse(options.body); seen.push({ body, headers: options.headers })
    if (!body.id) return new Response(null, { status: 202 })
    if (body.method === 'initialize') return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'fx' } } }), { headers: { 'content-type': 'application/json', 'mcp-session-id': 'sess-' + seen.filter(item => item.body?.method === 'initialize').length } })
    return handler(body, options)
  }
  return { seen, fetchImpl }
}
const sseChunks = chunks => new Response(new ReadableStream({ start(controller) { for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk)); controller.close() } }), { headers: { 'content-type': 'text/event-stream' } })

test('SSE replies split across chunks, with a notification and a server request first, still resolve to the right reply', async () => {
  const { fetchImpl } = fixture(body => {
    const reply = JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { content: [{ type: 'text', text: 'ok' }] } })
    const note = JSON.stringify({ jsonrpc: '2.0', method: 'notifications/progress', params: {} }), ask = JSON.stringify({ jsonrpc: '2.0', id: body.id, method: 'sampling/createMessage', params: {} })
    const all = `: keepalive\n\ndata: ${note}\n\ndata: ${ask}\n\nevent: message\r\ndata: ${reply}\r\n\r\n`
    return sseChunks([all.slice(0, 7), all.slice(7, 61), all.slice(61, 140), all.slice(140)])
  })
  const client = createMcpHttpClient({ url: 'https://fx.example/mcp', fetchImpl })
  await client.start()
  assert.equal((await client.callTool('read', {})).text, 'ok')
  client.stop()
})

test('malformed replies, server errors and empty results are refused with codes, never as text', async () => {
  for (const [reply, code] of [[() => 'not json', 'INVALID_RESPONSE'], [id => JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32602, message: 'bad' } }), 'SERVER_ERROR'], [id => JSON.stringify({ jsonrpc: '2.0', id }), 'INVALID_RESPONSE'], [id => JSON.stringify({ jsonrpc: '1.0', id, result: {} }), 'INVALID_RESPONSE']]) {
    const { fetchImpl } = fixture(body => new Response(reply(body.id), { headers: { 'content-type': 'application/json' } }))
    const client = createMcpHttpClient({ url: 'https://fx.example/mcp', fetchImpl })
    await client.start()
    await assert.rejects(client.callTool('write', {}), { code })
    client.stop()
  }
})

test('an expired session renews once for listing, a call is never replayed, and stop ends the session', async () => {
  let listed = 0, called = 0
  const { seen, fetchImpl } = fixture(body => {
    if (body.method === 'tools/list') { listed++; if (listed === 1) return new Response('gone', { status: 404 }); return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { tools: [{ name: 'only' }] } }), { headers: { 'content-type': 'application/json' } }) }
    called++; return new Response('gone', { status: 404 })
  })
  const client = createMcpHttpClient({ url: 'https://fx.example/mcp', fetchImpl })
  await client.start()
  assert.deepEqual((await client.listTools()).map(tool => tool.name), ['only'])
  assert.equal(seen.filter(item => item.body?.method === 'initialize').length, 2)
  await assert.rejects(client.callTool('write', {}), { code: 'SESSION_EXPIRED' })
  assert.equal(called, 1)
  await client.start()
  client.stop()
  assert.ok(seen.some(item => item.delete === 'sess-3'))
})

test('a call the user stops is cancelled on the server and reported as cancelled with an unknown effect', async () => {
  const { seen, fetchImpl } = fixture((body, options) => new Response(new ReadableStream({ start(controller) { options.signal.addEventListener('abort', () => controller.error(new DOMException('aborted', 'AbortError'))) } }), { headers: { 'content-type': 'text/event-stream' } }))
  const client = createMcpHttpClient({ url: 'https://fx.example/mcp', fetchImpl })
  await client.start()
  const stopper = new AbortController()
  const pending = client.callTool('slow-write', {}, { signal: stopper.signal })
  setTimeout(() => stopper.abort(), 20)
  await assert.rejects(pending, error => error.code === 'CANCELLED' && error.effectUnknown === true)
  await new Promise(resolve => setTimeout(resolve, 20))
  const cancelled = seen.find(item => item.body?.method === 'notifications/cancelled')
  assert.ok(cancelled); assert.equal(typeof cancelled.body.params.requestId, 'number')
  client.stop()
})
