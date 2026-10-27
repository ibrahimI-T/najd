const fs = require('node:fs/promises')
const path = require('node:path')
const net = require('node:net')
const { randomUUID, randomBytes, createHash } = require('node:crypto')
const { spawn, execFile } = require('node:child_process')
const pins = require('./runtime-pins.json')
const { createManagedRuntime } = require('./runtime-manager.cjs')
const gatewayError = code => Object.assign(new Error(code), { code })
// Read through Electron's fs (works inside app.asar); the external Node process cannot
// open asar paths, so each launch writes this owned copy into the Gateway state folder.
const launcherSource = require('node:fs').readFileSync(path.join(__dirname, 'openclaw-launcher.cjs'), 'utf8')

async function freePort() {
  const listener = net.createServer()
  await new Promise((resolve, reject) => { listener.once('error', reject); listener.listen(0, '127.0.0.1', resolve) })
  const port = listener.address().port
  await new Promise(resolve => listener.close(resolve))
  return port
}

async function listenerOwner(port) {
  const output = await new Promise((resolve, reject) => execFile(path.join(process.env.SystemRoot, 'System32', 'netstat.exe'),
    ['-ano', '-p', 'TCP'], { windowsHide: true, timeout: 5000, maxBuffer: 4 * 1024 * 1024 },
    (error, stdout) => error ? reject(gatewayError('RUNTIME_FAILED')) : resolve(stdout)))
  for (const line of output.split(/\r?\n/)) {
    const fields = line.trim().split(/\s+/)
    if (fields[0] === 'TCP' && fields[1] === `127.0.0.1:${port}` && fields[2] === '0.0.0.0:0') return Number(fields.at(-1))
  }
  return null
}

function createOpenClawGateway({ runtimeRoot, stateRoot, layout = null }) {
  runtimeRoot = path.resolve(runtimeRoot)
  stateRoot = path.resolve(stateRoot)
  // Installed builds use NAJD's bundled layout; development uses provisioned .runtimes folders.
  const nodeRoot = layout ? layout.nodeRoot : path.join(runtimeRoot, `node-v${pins.node.version}-win-x64`)
  const node = layout ? layout.node : path.join(nodeRoot, 'node.exe')
  const container = layout ? layout.container : path.join(runtimeRoot, `openclaw-runtime-${pins.openclaw.version}`)
  const entry = path.join(container, 'node_modules/openclaw/openclaw.mjs')
  let state = 'not_installed', instanceId = null, verifiedAt = null, errorCode = null
  let runtime, starting, stopping, probeChild, env, generation = 0
  let localNodeUrl = null

  function status() {
    if (runtime?.state() === 'failed' && ['healthy', 'degraded'].includes(state)) { state = 'failed'; errorCode = 'RUNTIME_FAILED' }
    return { engine: 'openclaw', state, version: pins.openclaw.version, instanceId, verifiedAt, errorCode }
  }

  async function verifyPayload() {
    const record = JSON.parse(await fs.readFile(path.join(nodeRoot, 'najd-runtime.json'), 'utf8'))
    const lockData = await fs.readFile(path.join(container, 'package-lock.json'))
    const lock = JSON.parse(lockData.toString('utf8'))
    const manifest = JSON.parse(await fs.readFile(path.join(container, 'node_modules/openclaw/package.json'), 'utf8'))
    if (record.version !== pins.node.version || record.archiveSha256 !== pins.node.archiveSha256 ||
        createHash('sha256').update(await fs.readFile(node)).digest('hex') !== record.executableSha256 ||
        createHash('sha256').update(lockData).digest('hex') !== pins.openclaw.dependencyLockSha256 ||
        lock.packages?.['node_modules/openclaw']?.integrity !== pins.openclaw.integrity ||
        manifest.name !== 'openclaw' || manifest.version !== pins.openclaw.version) throw gatewayError('INCOMPATIBLE_RUNTIME')
  }

  async function callGateway(method = 'health', params = {}) {
    // CLI identity/token cache is temporary; never import or retain a user's existing identity.
    const clientRoot = await fs.mkdtemp(path.join(stateRoot, 'najd-gateway-client-'))
    const deviceCall = method === 'device.pair.list' || method === 'device.pair.approve'
    const arguments_ = method === 'device.pair.list' ? ['devices', 'list'] :
      method === 'device.pair.approve' ? ['devices', 'approve', params.requestId] :
      ['gateway', 'call', method, '--params', JSON.stringify(params)]
    try {
      return await new Promise((resolve, reject) => {
        let output = '', diagnostic = '', size = 0, timer, settled = false, failure
        const finish = (error, result) => { if (settled) return; settled = true; clearTimeout(timer); error ? reject(error) : resolve(result) }
        const child = spawn(node, [entry, ...arguments_, '--json', '--timeout', '10000'], {
          cwd: clientRoot, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
          env: { ...env, HOME: clientRoot, USERPROFILE: clientRoot, APPDATA: clientRoot, LOCALAPPDATA: clientRoot,
            // Dedicated devices CLI validates its implicit-loopback local-owner
            // fallback against the managed Gateway store. Never use user state.
            OPENCLAW_STATE_DIR: deviceCall ? stateRoot : clientRoot }
        })
        probeChild = child
        timer = setTimeout(() => { failure = gatewayError('RUNTIME_TIMEOUT'); child.kill() }, 30000)
        child.once('error', () => { failure = gatewayError('GATEWAY_AUTH_FAILED') })
        child.stderr.on('data', data => { diagnostic = (diagnostic + data.toString('utf8')).slice(0, 8192) })
        child.stdout.on('data', data => {
          size += data.length
          if (size > 1024 * 1024) { failure = gatewayError('INVALID_PROTOCOL'); child.kill() }
          else output += data.toString('utf8')
        })
        child.once('close', code => {
          if (probeChild === child) probeChild = null
          if (failure) return finish(failure)
          if (code !== 0) {
            const failure = gatewayError('GATEWAY_AUTH_FAILED')
            const text = diagnostic + output
            failure.diagnostic = ['unknown method', 'invalid', 'forbidden', 'scope', 'pairing', 'auth', 'connect', 'policy', 'option', 'permissions', 'closed', 'timeout']
              .filter(category => text.toLowerCase().includes(category)).join('_').replaceAll(' ', '_').toUpperCase()
            return finish(failure)
          }
          try { finish(null, JSON.parse(output)) }
          catch { finish(gatewayError('INVALID_PROTOCOL')) }
        })
      })
    } finally {
      if (!path.resolve(clientRoot).startsWith(stateRoot + path.sep) || !path.basename(clientRoot).startsWith('najd-gateway-client-')) throw gatewayError('INVALID_INPUT')
      await fs.rm(clientRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
    }
  }

  async function probeAuth() {
    if ((await callGateway()).ok !== true) throw gatewayError('INVALID_PROTOCOL')
  }

  async function launch() {
    const current = ++generation
    state = 'preparing'; errorCode = null; verifiedAt = null
    try {
      await verifyPayload()
      if (current !== generation) throw gatewayError('CANCELLED')
      instanceId = randomUUID()
      const port = await freePort()
      localNodeUrl = `ws://127.0.0.1:${port}`
      await fs.mkdir(path.join(stateRoot, 'workspace'), { recursive: true })
      const config = path.join(stateRoot, 'najd-openclaw.json')
      await fs.writeFile(config, JSON.stringify({ gateway: { mode: 'local', bind: 'loopback', port,
        auth: { mode: 'token' }, controlUi: { enabled: false } }, tools: { deny: ['*'] },
        plugins: { enabled: false }, cron: { enabled: false }, discovery: { mdns: { mode: 'off' } },
        agents: { defaults: { workspace: path.join(stateRoot, 'workspace') } } }) + '\n')
      const launcher = path.join(stateRoot, 'najd-gateway-launcher.cjs')
      await fs.writeFile(launcher, launcherSource)
      if (current !== generation) throw gatewayError('CANCELLED')
      env = { SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR,
        PATH: nodeRoot + path.delimiter + path.join(process.env.SystemRoot, 'System32'),
        TEMP: stateRoot, TMP: stateRoot, HOME: stateRoot, USERPROFILE: stateRoot,
        APPDATA: stateRoot, LOCALAPPDATA: stateRoot,
        OPENCLAW_STATE_DIR: stateRoot, OPENCLAW_CONFIG_PATH: config,
        OPENCLAW_GATEWAY_TOKEN: randomBytes(32).toString('hex'), OPENCLAW_NO_RESPAWN: '1', OPENCLAW_DISABLE_COMPILE_CACHE: '1' }
      // A cold first start (fresh install or upgrade, empty file cache, antivirus scanning ~42k package files)
      // was measured at ~50 s in Windows Sandbox while warm starts take ~10 s. A process that exits still
      // fails immediately; only a live, slow start gets the longer window.
      runtime = createManagedRuntime({ id: 'openclaw', command: node,
        args: [launcher, entry], env, cwd: stateRoot,
        inheritEnv: false, ipcShutdown: true, readinessUrl: `http://127.0.0.1:${port}/healthz`, readyTimeoutMs: 120000 })
      state = 'starting'
      await runtime.start()
      if (current !== generation) throw gatewayError('CANCELLED')
      const expectedPid = runtime.processId()
      if (!expectedPid) throw gatewayError('RUNTIME_FAILED')
      // Token auth authenticates the client; check the OS listener owner before sending it.
      const owner = await listenerOwner(port)
      if (current !== generation) throw gatewayError('CANCELLED')
      if (owner !== expectedPid || runtime.processId() !== expectedPid) throw gatewayError('PORT_IN_USE')
      await probeAuth()
      if (current !== generation) throw gatewayError('CANCELLED')
      verifiedAt = new Date().toISOString(); state = 'healthy'
      return status()
    } catch (error) {
      if (runtime) await runtime.stop()
      if (current === generation) {
        errorCode = error.code === 'ENOENT' ? 'NOT_INSTALLED' : ['INCOMPATIBLE_RUNTIME', 'PORT_IN_USE', 'RUNTIME_TIMEOUT', 'RUNTIME_FAILED', 'GATEWAY_AUTH_FAILED', 'INVALID_PROTOCOL'].includes(error.code) ? error.code : 'RUNTIME_FAILED'
        state = errorCode === 'NOT_INSTALLED' ? 'not_installed' : 'failed'
      }
      throw gatewayError(current !== generation ? 'CANCELLED' : errorCode)
    }
  }

  function start() {
    if (stopping) return stopping.then(start)
    if (starting) return starting
    if (state === 'healthy') return Promise.resolve(status())
    starting = launch().finally(() => { starting = null })
    return starting
  }

  function stop() {
    if (stopping) return stopping
    ++generation; state = 'stopping'
    probeChild?.kill()
    stopping = (async () => {
      try {
        await runtime?.stop(); await starting?.catch(() => {})
        runtime = null; env = null; localNodeUrl = null; instanceId = null; verifiedAt = null; errorCode = null; state = 'stopped'
        return status()
      } catch { state = 'failed'; errorCode = 'RUNTIME_STOP_FAILED'; throw gatewayError(errorCode) }
    })().finally(() => { stopping = null })
    return stopping
  }

  async function health() {
    if (!['healthy', 'degraded'].includes(state)) return status()
    const result = await runtime.health()
    if (['healthy', 'degraded'].includes(state)) state = result.ok ? 'healthy' : runtime.state() === 'failed' ? 'failed' : 'degraded'
    return status()
  }
  async function withLocalNodeConnection(operation) {
    if (typeof operation !== 'function') throw gatewayError('INVALID_INPUT')
    await start()
    const current = generation
    const expected = runtime.processId()
    if (!expected || await listenerOwner(Number(new URL(localNodeUrl).port)) !== expected || current !== generation)
      throw gatewayError('PORT_IN_USE')
    const approvePairing = async ({ nodeId, requestId }) => {
      if (!/^[a-f0-9]{64}$/i.test(nodeId) || !/^[a-f0-9-]{20,64}$/i.test(requestId) || current !== generation)
        throw gatewayError('INVALID_INPUT')
      if (await listenerOwner(Number(new URL(localNodeUrl).port)) !== runtime.processId()) throw gatewayError('PORT_IN_USE')
      const list = await callGateway('device.pair.list')
      const pending = list.pending?.find(item => item.requestId === requestId && item.deviceId === nodeId)
      const roles = pending ? [...(pending.roles || []), ...(pending.role ? [pending.role] : [])] : []
      if (!pending) throw gatewayError('PAIRING_REQUEST_NOT_FOUND')
      if (pending.clientId !== 'node-host') throw gatewayError('PAIRING_CLIENT_MISMATCH')
      if (!roles.includes('node') || roles.some(role => role !== 'node')) throw gatewayError('PAIRING_ROLE_MISMATCH')
      if ((pending.scopes || []).length || current !== generation) throw gatewayError('PAIRING_SCOPE_MISMATCH')
      await callGateway('device.pair.approve', { requestId })
    }
    const result = await operation(Object.freeze({ url: localNodeUrl, token: env.OPENCLAW_GATEWAY_TOKEN, approvePairing }))
    if (current !== generation) throw gatewayError('CANCELLED')
    return result
  }
  // Private callback only; preload intentionally exposes neither this method nor credentials.
  return { start, stop, status, health, withLocalNodeConnection }
}

module.exports = { createOpenClawGateway }
