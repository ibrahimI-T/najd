const assert = require('node:assert/strict')
const { spawn } = require('node:child_process')
const { randomBytes } = require('node:crypto')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const net = require('node:net')
const http = require('node:http')
const { once } = require('node:events')
const readline = require('node:readline')

async function main() {
  assert.equal(process.platform, 'win32')
  const root = path.resolve(__dirname, '..')
  const state = await fs.mkdtemp(path.join(os.tmpdir(), 'najd-native-node-'))
  const listener = net.createServer()
  listener.listen(0, '127.0.0.1'); await once(listener, 'listening')
  const port = listener.address().port
  await new Promise(resolve => listener.close(resolve))
  const token = randomBytes(32).toString('hex')
  const sdk = path.join(root, '.runtimes/dotnet-sdk-10.0.400')
  const system = process.env.SystemRoot
  const child = spawn(path.join(sdk, 'dotnet.exe'), [path.join(root, '.runtimes/windows-node-host/Najd.WindowsNode.dll')], {
    cwd: state, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
    env: { SystemRoot: system, WINDIR: system, DOTNET_ROOT: sdk,
      PATH: path.join(system, 'System32'), PATHEXT: '.EXE',
      HOME: state, USERPROFILE: state, APPDATA: state, LOCALAPPDATA: state, TEMP: state, TMP: state,
      DOTNET_CLI_HOME: state, DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_GENERATE_ASPNET_CERTIFICATE: 'false' }
  })
  let closed = false
  const closure = once(child, 'close').then(result => { closed = true; return result })
  const timeout = setTimeout(() => child.kill(), 25000)
  const lines = readline.createInterface({ input: child.stdout })
  const url = `http://127.0.0.1:${port}/`
  async function rpc(method, params, overrides = {}) {
    // Native MCP client: fetch adds Sec-Fetch-Mode, correctly refused by the
    // upstream browser/CSRF gate. Do not weaken that server-side check.
    return new Promise((resolve, reject) => {
      const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
      const request = http.request(url, { method: 'POST', headers: { 'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body), Authorization: `Bearer ${token}`, ...overrides } }, response => {
        let text = ''
        response.setEncoding('utf8')
        response.on('data', chunk => { text += chunk; if (text.length > 65536) request.destroy(new Error('Oversized MCP response')) })
        response.on('error', reject)
        response.on('end', () => resolve({ status: response.statusCode, json: async () => JSON.parse(text) }))
      })
      request.setTimeout(5000, () => request.destroy(new Error('MCP timeout')))
      request.on('error', reject)
      request.end(body)
    })
  }
  try {
    child.stdin.write(JSON.stringify({ port, token }) + '\n')
    const [ready] = await Promise.race([once(lines, 'line'), closure.then(() => { throw new Error('Node exited before readiness') })])
    assert.deepEqual(JSON.parse(ready), { state: 'ready', port })
    const discovered = await (await rpc('tools/list', {})).json()
    assert.equal(discovered.result.tools.length, 1)
    const name = discovered.result.tools[0].name
    const result = await (await rpc('tools/call', { name, arguments: { bins: ['notepad', 'calc'] } })).json()
    assert.ok(!result.result.isError, JSON.stringify(result))
    const content = JSON.parse(result.result.content[0].text)
    assert.equal(content.bins.notepad.toLowerCase(), path.join(system, 'System32/notepad.exe').toLowerCase())
    assert.equal(content.bins.calc.toLowerCase(), path.join(system, 'System32/calc.exe').toLowerCase())
    const browsers = await (await rpc('tools/call', { name, arguments: { bins: ['chrome', 'edge'] } })).json()
    const installed = JSON.parse(browsers.result.content[0].text)
    for (const id of ['chrome', 'edge']) {
      assert.equal(installed.sources[id], 'app-paths', `${id} registry discovery did not match the protected installed path`)
      assert.match(installed.bins[id], /^C:\\Program Files(?: \(x86\))?\\/i)
    }
    const denied = await (await rpc('tools/call', { name, arguments: { bins: ['cmd.exe'] } })).json()
    assert.equal(denied.result.isError, true)
    const execution = await (await rpc('tools/call', { name: 'system.run', arguments: { command: 'calc' } })).json()
    assert.ok(execution.error || execution.result?.isError)
    assert.equal((await rpc('tools/list', {}, { Authorization: 'Bearer wrong' })).status, 401)
    assert.equal((await rpc('tools/list', {}, { Origin: 'https://example.invalid' })).status, 403)
    // Owner EOF shuts down without any existing profile or on-disk token.
    child.stdin.end()
    assert.equal((await closure)[0], 0)
    await assert.rejects(rpc('tools/list', {}))
    console.log('PASS: real native MCP discovery, bounded app lookup, denied shell lookup, token/origin refusal and owner-EOF listener shutdown.')
  } finally {
    clearTimeout(timeout)
    lines.close()
    if (!closed) { child.stdin.end(); child.kill(); await closure }
    if (!path.resolve(state).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unsafe fixture path')
    await fs.rm(state, { recursive: true, force: true })
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
