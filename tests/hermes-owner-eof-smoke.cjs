const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const http = require('node:http')
const { spawn } = require('node:child_process')
const { randomUUID, randomBytes } = require('node:crypto')

async function main() {
  const root = path.resolve(__dirname, '..'), runtime = path.join(root, '.runtimes/hermes')
  const home = await fs.mkdtemp(path.join(runtime, 'eof-proof-'))
  const token = randomBytes(32).toString('hex'), instanceId = randomUUID(), taskId = randomUUID()
  let entered, child, timer
  const request = new Promise(resolve => { entered = resolve })
  const server = http.createServer((req, res) => {
    assert.equal(req.headers.authorization, `Bearer ${token}`)
    entered()
    // Keep inference waiting while its owning pipe disappears.
    req.resume()
  })
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    await fs.mkdir(path.join(home, 'profile'))
    await fs.writeFile(path.join(home, 'profile/config.yaml'), 'agent:\n  api_max_retries: 1\n  auto_recovery_cycles: 0\n')
    const system = process.env.SystemRoot || 'C:\\Windows'
    child = spawn(path.join(runtime, 'core-venv/Scripts/python.exe'), ['-I', '-B', path.join(root, 'electron/hermes-worker.py')], {
      cwd: home, windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'], env: {
        SystemRoot: system, WINDIR: system, PATH: path.join(system, 'System32'), HOME: home, USERPROFILE: home,
        APPDATA: path.join(home, 'AppData/Roaming'), LOCALAPPDATA: path.join(home, 'AppData/Local'),
        TEMP: home, TMP: home, HERMES_HOME: path.join(home, 'profile'), HERMES_RUNTIME_DIR: path.join(runtime, 'tools'), PYTHONUTF8: '1'
      }
    })
    const closed = new Promise(resolve => child.once('close', resolve))
    const timeout = new Promise((resolve, reject) => { timer = setTimeout(() => reject(new Error('Owner EOF proof timed out')), 30000) })
    child.stdout.resume()
    child.stdin.write(JSON.stringify({ instanceId, taskId, token, model: 'qwen2.5:1.5b', text: 'Reply 42.', cwd: home,
      baseUrl: `http://127.0.0.1:${server.address().port}/v1` }) + '\n')
    await Promise.race([request, timeout])
    child.stdin.destroy()
    assert.equal(await Promise.race([closed, timeout]), 1)
    console.log('PASS: genuine Hermes blocked in SDK inference exits on owner EOF; no helper kill needed.')
  } finally {
    clearTimeout(timer)
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
    if (child && child.exitCode === null) child.kill()
    if (!child || child.exitCode !== null) await fs.rm(home, { recursive: true, force: true })
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
