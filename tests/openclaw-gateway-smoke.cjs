// Real native Gateway proof with temporary state, no accounts, models or device actions.
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const net = require('node:net')
const { randomBytes } = require('node:crypto')
const { spawn, execFileSync } = require('node:child_process')

const project = path.resolve(__dirname, '..')
const node = path.join(project, '.runtimes/node-v24.21.0-win-x64/node.exe')
const entry = path.join(project, '.runtimes/openclaw-runtime-2026.10.3/node_modules/openclaw/openclaw.mjs')
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))

async function freePort() {
  const listener = net.createServer()
  await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve))
  const port = listener.address().port
  await new Promise(resolve => listener.close(resolve))
  return port
}

async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'najd-gateway-smoke-'))
  const port = await freePort()
  const token = randomBytes(32).toString('hex')
  const config = path.join(root, 'openclaw.json')
  await fs.mkdir(path.join(root, 'workspace'))
  await fs.writeFile(config, JSON.stringify({
    gateway: { mode: 'local', bind: 'loopback', port, auth: { mode: 'token' }, controlUi: { enabled: false } },
    tools: { deny: ['*'] }, plugins: { enabled: false }, cron: { enabled: false },
    agents: { defaults: { workspace: path.join(root, 'workspace') } }
  }))
  const env = {
    SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR,
    PATH: path.dirname(node) + path.delimiter + path.join(process.env.SystemRoot, 'System32'),
    TEMP: root, TMP: root, USERPROFILE: root, HOME: root,
    APPDATA: root, LOCALAPPDATA: root,
    OPENCLAW_STATE_DIR: root, OPENCLAW_CONFIG_PATH: config,
    OPENCLAW_GATEWAY_TOKEN: token, OPENCLAW_NO_RESPAWN: '1',
    OPENCLAW_DISABLE_COMPILE_CACHE: '1'
  }
  let child
  let diagnostics = ''
  try {
    execFileSync(node, [path.join(path.dirname(entry), 'scripts/postinstall-bundled-plugins.mjs')], {
      env, cwd: root, windowsHide: true, timeout: 30000, encoding: 'utf8', maxBuffer: 1024 * 1024
    })
    const version = execFileSync(node, [entry, '--version'], { env, windowsHide: true, timeout: 30000, encoding: 'utf8' })
    assert.match(version, /2026\.10\.3/)
    child = spawn(node, [entry, 'gateway', 'run'], { env, cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let spawnError
    child.once('error', error => { spawnError = error.code })
    for (const stream of [child.stdout, child.stderr]) stream.on('data', data => {
      diagnostics = (diagnostics + data.toString('utf8').split(token).join('[redacted]')).slice(-8000)
    })
    const deadline = Date.now() + 45000
    let ready = false
    while (Date.now() < deadline) {
      if (spawnError || child.exitCode !== null || child.signalCode !== null) throw new Error('Gateway process failed: ' + (spawnError || diagnostics))
      try {
        const response = await fetch(`http://127.0.0.1:${port}/healthz`, { signal: AbortSignal.timeout(1500), redirect: 'error' })
        await response.body?.cancel()
        if (response.ok) { ready = true; break }
      } catch {}
      await pause(250)
    }
    if (!ready) throw new Error('Gateway readiness timeout: ' + diagnostics)
    let output
    try {
      // The pinned CLI rejects env credentials with --url; use the private config's loopback port.
      output = execFileSync(node, [entry, 'gateway', 'call', 'health', '--json', '--timeout', '10000'], {
        env, cwd: root, windowsHide: true, timeout: 30000, encoding: 'utf8', maxBuffer: 1024 * 1024
      })
    } catch (error) {
      throw new Error(`Gateway RPC failed (${error.code || error.status}): ${String(error.stderr || error.stdout || error.message).split(token).join('[redacted]').slice(-3000)}`)
    }
    assert.equal(JSON.parse(output).ok, true)
    const wrongClient = path.join(root, 'wrong-client')
    await fs.mkdir(wrongClient)
    assert.throws(() => execFileSync(node, [entry, 'gateway', 'call', 'health', '--json', '--timeout', '5000'], {
      env: { ...env, HOME: wrongClient, USERPROFILE: wrongClient, APPDATA: wrongClient, LOCALAPPDATA: wrongClient,
        OPENCLAW_STATE_DIR: wrongClient, OPENCLAW_GATEWAY_TOKEN: 'invalid-fixture-token' },
      cwd: wrongClient, windowsHide: true, timeout: 20000, encoding: 'utf8', maxBuffer: 1024 * 1024
    }), error => error.status !== null && error.status !== 0 && /unauthorized|token mismatch|AUTH_TOKEN_MISMATCH/i.test(String(error.stderr) + String(error.stdout)))
    console.log('Real Gateway version, native startup, authenticated health RPC and wrong-token denial passed.')
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) {
      const exited = new Promise(resolve => child.once('close', resolve))
      child.kill('SIGTERM')
      let timer
      try { await Promise.race([exited, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Gateway shutdown timeout')), 8000) })]) }
      finally { clearTimeout(timer) }
    }
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(root).startsWith('najd-gateway-smoke-')) throw new Error('Unsafe smoke cleanup path.')
    await fs.rm(root, { recursive: true, force: true })
  }
  await assert.rejects(fetch(`http://127.0.0.1:${port}/healthz`))
  console.log('Gateway owned-process exit and listener closure passed; no model or account request was made.')
}

main().catch(error => { console.error(error.message); process.exitCode = 1 })
