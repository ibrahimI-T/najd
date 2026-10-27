// A small MCP stdio server for tests: paged tools, text/structured/error results, cancellation,
// a server-to-client request NAJD must refuse, and an environment check.
let buffer = ''
const timers = new Map()
const send = message => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n')
const tools = [
  { name: 'echo', description: 'Echo text back', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] }, annotations: { readOnlyHint: true } },
  { name: 'add', description: 'Add two numbers', inputSchema: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } }, required: ['a', 'b'] } },
  { name: 'slow', description: 'Waits 20 seconds', inputSchema: { type: 'object' } },
  { name: 'broken', description: 'Always reports a tool error', inputSchema: { type: 'object' } },
  { name: 'env', description: 'Reports whether FIXTURE_TOKEN is set', inputSchema: { type: 'object' } },
  { name: 'bad name!', description: 'invalid name is dropped by the client', inputSchema: { type: 'object' } }
]
function handle(message) {
  if (message.method === 'initialize') return send({ id: message.id, result: { protocolVersion: message.params.protocolVersion, capabilities: { tools: { listChanged: true } }, serverInfo: { name: 'fixture', version: '1.2.3' } } })
  if (message.method === 'notifications/initialized') return send({ id: 'srv-1', method: 'roots/list', params: {} })
  if (message.id === 'srv-1') return process.stderr.write('roots/list answered with ' + (message.error ? 'error ' + message.error.code : 'result') + '\n')
  if (message.method === 'tools/list') return message.params?.cursor === 'p2'
    ? send({ id: message.id, result: { tools: tools.slice(3) } })
    : send({ id: message.id, result: { tools: tools.slice(0, 3), nextCursor: 'p2' } })
  if (message.method === 'notifications/cancelled') { clearTimeout(timers.get(message.params.requestId)); return process.stderr.write('cancelled ' + message.params.requestId + '\n') }
  if (message.method === 'tools/call') {
    const { name, arguments: args } = message.params
    if (name === 'echo') return send({ id: message.id, result: { content: [{ type: 'text', text: 'echo: ' + args.text }] } })
    if (name === 'add') return send({ id: message.id, result: { content: [], structuredContent: { sum: args.a + args.b } } })
    if (name === 'broken') return send({ id: message.id, result: { isError: true, content: [{ type: 'text', text: 'it broke' }] } })
    if (name === 'env') return send({ id: message.id, result: { content: [{ type: 'text', text: process.env.FIXTURE_TOKEN === 'secret-value' ? 'token present' : 'token missing' }] } })
    if (name === 'slow') return timers.set(message.id, setTimeout(() => send({ id: message.id, result: { content: [{ type: 'text', text: 'late' }] } }), 20000))
    return send({ id: message.id, error: { code: -32602, message: 'unknown tool' } })
  }
  if (message.id !== undefined) send({ id: message.id, error: { code: -32601, message: 'no' } })
}
process.stdin.setEncoding('utf8')
process.stdin.on('data', chunk => {
  buffer += chunk
  let index
  while ((index = buffer.indexOf('\n')) >= 0) { const line = buffer.slice(0, index); buffer = buffer.slice(index + 1); if (line.trim()) handle(JSON.parse(line)) }
})
process.stdin.on('end', () => process.exit(0))
