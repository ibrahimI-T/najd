// Fixture engine used by runtime-manager tests: a tiny HTTP server whose
// /healthz becomes ready only when told, /die exits the process, /shutdown stops.
const http = require('node:http')
const port = Number(process.argv[2])
const mode = process.argv[3] || 'normal'
const server = http.createServer((request, response) => {
  response.setHeader('Content-Type', 'application/json')
  if (request.url === '/healthz') {
    if (mode === 'no-ready') { response.writeHead(503); response.end('{"ok":false}'); return }
    response.end('{"ok":true}'); return
  }
  if (request.url === '/die') { response.end('{"dying":true}'); setTimeout(() => process.exit(1), 50); return }
  if (request.url === '/shutdown') { response.end('{"bye":true}'); server.close(() => process.exit(0)); return }
  response.writeHead(404); response.end('{}')
})
server.listen(port, '127.0.0.1', () => {
  if (mode === 'descendant' && process.connected) process.send({ port: server.address().port, pid: process.pid })
})
if (mode === 'ignore-shutdown' && process.env.STUB_ROOT) {
  const { spawn } = require('node:child_process')
  const fs = require('node:fs')
  const path = require('node:path')
  const child = spawn(process.execPath, [__filename, '0', 'descendant'], { windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] })
  child.once('message', data => fs.writeFileSync(path.join(process.env.STUB_ROOT, 'descendant.json'), JSON.stringify(data)))
}
process.on('message', message => {
  if (message?.type === 'shutdown' && mode !== 'ignore-shutdown') server.close(() => process.exit(0))
})
