// The NAJD desktop host exposes exactly these commands (tools/list is checked on every start).
const HOST_TOOLS = ['najd.desktop.act', 'najd.desktop.open', 'najd.desktop.read', 'najd.desktop.windows', 'najd.process.list', 'najd.process.start', 'najd.process.stop', 'najd.screen.capture', 'najd.windows.demo', 'system.which']
// Commands NAJD calls through invokeHost (background commands M2c, desktop M2d).
const INVOKABLE = ['najd.process.start', 'najd.process.list', 'najd.process.stop', 'najd.desktop.windows', 'najd.desktop.open', 'najd.desktop.read', 'najd.desktop.act', 'najd.screen.capture']
const fs = require('node:fs/promises')
const path = require('node:path')
const { spawn, execFile } = require('node:child_process')
const error = code => Object.assign(new Error(code), { code })

// Main-only MCP over owned stdio; no public device endpoint.
// testHooks: smoke tests only; lets the host honour a test pause before effects. NAJD never sets it.
function createWindowsNode({ runtimeRoot, stateRoot, nodeConnection = null, layout = null, testHooks = false }) {
  runtimeRoot = path.resolve(runtimeRoot); stateRoot = path.resolve(stateRoot)
  let run = null, sequence = 0, queue = Promise.resolve(), epoch = 0, instances = 0
  // NAJD's own desktop tools run over stdio; the gateway link only adds OpenClaw node features. When the gateway
  // cannot be reached (for example another OpenClaw installation holds its port), the host starts without it for the
  // rest of this session instead of leaving desktop control unavailable.
  let gatewayUnavailable = false
  // The gateway still starting (it can take 30 s to 2 min after NAJD opens) never holds up NAJD's own tools: this host start goes
  // without it, and the next host start tries the gateway again (owner live test 2026-10-25: a first Python run waited 80 s).
  let gatewayDeferred = false
  const serialize = action => { const result = queue.then(action); queue = result.catch(() => {}); return result }
  async function terminate(active) {
    if (active.closed) return
    active.child.stdin.end()
    let timer
    const wait = () => Promise.race([active.closure.then(() => true), new Promise(resolve => { timer = setTimeout(() => resolve(false), 4000) })])
    try {
      if (await wait()) return
      if (!active.closed && !active.exited) await new Promise(resolve => execFile(path.join(process.env.SystemRoot, 'System32/taskkill.exe'),
        ['/PID', String(active.child.pid), '/T', '/F'], { windowsHide: true, timeout: 4000 }, () => resolve()))
      clearTimeout(timer)
      if (!await wait()) throw error('WINDOWS_NODE_FAILED')
    } finally { clearTimeout(timer) }
  }
  // toolErrors: a tool's own error (for example NOT_FOUND) is returned as that code instead of a host failure.
  // signal: cancelling the task while the host works sends "cancel"; the host stops that request before any effect
  // it has not made yet and answers (CANCELLED, or the result if the effect had already happened) (M2-R11-002).
  async function rpc(active, method, params, timeoutMs = 5000, { toolErrors = false, signal = null } = {}) {
    if (active.closed || active.pending) throw error('WINDOWS_NODE_FAILED')
    const id = ++sequence
    let timer, onAbort = null
    try {
      return await new Promise((resolve, reject) => {
        active.pending = { id, resolve, reject, toolErrors }
        timer = setTimeout(() => reject(error('WINDOWS_NODE_FAILED')), timeoutMs)
        active.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
        if (signal) {
          onAbort = () => { if (!active.closed && active.pending?.id === id) active.child.stdin.write('cancel\n') }
          if (signal.aborted) onAbort(); else signal.addEventListener('abort', onAbort, { once: true })
        }
      })
    } finally { clearTimeout(timer); active.pending = null; if (onAbort) signal.removeEventListener('abort', onAbort) }
  }
  async function start() {
    if (run && !run.closed) return run
    const sdk = layout ? layout.dotnetRoot : path.join(runtimeRoot, 'dotnet-sdk-10.0.400')
    const command = path.join(sdk, 'dotnet.exe'), entry = layout ? layout.entry : path.join(runtimeRoot, 'windows-node-host/Najd.WindowsNode.dll')
    try { await fs.access(command); await fs.access(entry) } catch { throw error('WINDOWS_NODE_NOT_INSTALLED') }
    await fs.mkdir(stateRoot, { recursive: true })
    const home = path.join(stateRoot, 'home')
    const roaming = path.join(home, 'AppData/Roaming')
    const local = path.join(home, 'AppData/Local')
    for (const directory of [roaming, local, path.join(home, 'AppData/LocalLow'), path.join(home, 'Desktop'), path.join(home, 'Documents')])
      await fs.mkdir(directory, { recursive: true })
    const system = process.env.SystemRoot
    const child = spawn(command, [entry], { cwd: stateRoot, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
      env: { SystemRoot: system, WINDIR: system, PATH: path.join(system, 'System32'), PATHEXT: '.EXE', DOTNET_ROOT: sdk,
        HOME: home, USERPROFILE: home, APPDATA: roaming, LOCALAPPDATA: local, TEMP: stateRoot, TMP: stateRoot,
        DOTNET_CLI_HOME: stateRoot, DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_GENERATE_ASPNET_CERTIFICATE: 'false',
        // The user's own environment, used only for programs the user asks NAJD to open, so they start with the user's
        // profiles and sign-ins rather than the host's private folders.
        ...Object.fromEntries(['USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'TEMP', 'TMP', 'HOMEDRIVE', 'HOMEPATH', 'PATH', 'PATHEXT', 'PUBLIC', 'ProgramData', 'ProgramFiles', 'ProgramFiles(x86)', 'CommonProgramFiles', 'USERNAME', 'USERDOMAIN', 'COMPUTERNAME', 'OneDrive']
          .filter(name => typeof process.env[name] === 'string').map(name => ['NAJD_USER_' + name, process.env[name]])), ...(testHooks ? { NAJD_HOST_TEST: '1' } : {}) } })
    let closeResolve, readyResolve, readyReject
    const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject })
    void ready.catch(() => {}) // Connection provisioning may fail before awaiting readiness.
    // Each host process gets its own number, so work it received can be tied to it (M2-R25-002).
    const active = { child, closed: false, pending: null, instance: ++instances, closure: new Promise(resolve => { closeResolve = resolve }) }
    run = active
    let diagnostic = ''
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', chunk => { diagnostic = (diagnostic + chunk).slice(0, 256) })
    const fail = () => { readyReject(error('WINDOWS_NODE_FAILED')); active.pending?.reject(error('WINDOWS_NODE_FAILED')) }
    child.on('error', fail); child.stdin.on('error', fail)
    child.once('exit', () => { active.exited = true })
    child.once('close', () => { active.closed = true; fail(); closeResolve() })
    let buffer = ''
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', chunk => {
      buffer += chunk
      // Desktop reads are bounded in the host (300 elements, clipped texts); 4 MB is far above that (M2-R07).
      if (buffer.length > 4 * 1024 * 1024) { fail(); child.kill(); return }
      let index
      while ((index = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, index); buffer = buffer.slice(index + 1)
        try {
          const value = JSON.parse(line)
          if (value.state === 'pairing' && active.approvePairing && !active.pairing) {
            active.pairing = active.approvePairing({ nodeId: value.nodeId, requestId: value.requestId })
              .then(() => { if (!active.closed) child.stdin.write('pairing-approved\n') })
              .catch(reason => readyReject(reason))
          } else if (value.state === 'ready' && value.transport === 'stdio') {
            active.gatewayConnected = value.gatewayConnected === true
            active.verifiedAt = new Date().toISOString()
            active.nodeId = typeof value.nodeId === 'string' && /^[a-f0-9]{64}$/i.test(value.nodeId) ? value.nodeId : null
            readyResolve()
          }
          else if (active.pending && value.id === active.pending.id) {
            // NAJD's own host tools report their refusal codes as they are (an elevated host's ADMIN_NOT_ALLOWED stays a
            // known refusal and keeps the host running, M2-R9-001); other callers keep PERMISSION_DENIED.
            if (value.result?.isError && active.pending.toolErrors && /^[A-Z_]{2,40}$/.test(String(value.result.content?.[0]?.text)))
              active.pending.reject(Object.assign(error(value.result.content[0].text), { toolError: true }))
            else if (value.result?.isError && ['ADMIN_NOT_ALLOWED', 'PERMISSION_DENIED'].includes(value.result.content?.[0]?.text))
              active.pending.reject(Object.assign(error('PERMISSION_DENIED'), { effectStarted: false }))
            else if (value.error || value.result?.isError) active.pending.reject(error('WINDOWS_NODE_FAILED'))
            else active.pending.resolve(value.result)
          } else fail()
        } catch { fail() }
      }
    })
    const useGateway = !!nodeConnection && !gatewayUnavailable && !gatewayDeferred
    gatewayDeferred = false
    const timer = setTimeout(() => readyReject(error('WINDOWS_NODE_FAILED')), useGateway ? 60000 : 15000)
    try {
      const configure = connection => {
        active.approvePairing = connection?.approvePairing
        child.stdin.write(JSON.stringify({ transport: 'stdio', ...(connection ? { gateway: {
          ...connection, identityPath: path.join(stateRoot, 'identity') } } : {}) }) + '\n')
        return ready
      }
      if (useGateway) await nodeConnection(configure)
      else await configure(null)
      await ready
      const negotiated = await rpc(active, 'initialize', { protocolVersion: '2024-11-05', capabilities: {},
        clientInfo: { name: 'NAJD AGENT', version: '0.5.0' } })
      if (negotiated.protocolVersion !== '2024-11-05' || negotiated.capabilities?.tools?.listChanged !== false ||
          typeof negotiated.serverInfo?.name !== 'string' || typeof negotiated.serverInfo?.version !== 'string') throw error('WINDOWS_NODE_FAILED')
      active.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n')
      const tools = await rpc(active, 'tools/list', {})
      if (JSON.stringify(tools.tools?.map(item => item.name).sort()) !== JSON.stringify(HOST_TOOLS)) throw error('WINDOWS_NODE_FAILED')
      active.mcp = { protocolVersion: negotiated.protocolVersion, serverInfo: { name: negotiated.serverInfo.name, version: negotiated.serverInfo.version },
        tools: ['system.which', 'najd.windows.demo'] }
      return active
    } catch (reason) {
      if (useGateway && reason?.code === 'GATEWAY_STARTING') { gatewayDeferred = true; await terminate(active); run = null; return start() }
      if (useGateway && reason?.code !== 'CANCELLED') { gatewayUnavailable = true; await terminate(active); run = null; return start() }
      await terminate(active); run = null; const failure = error('WINDOWS_NODE_FAILED'); failure.diagnostic = [diagnostic.match(/NODE_(?:CONNECT|PROTOCOL|REASON|PAIRING)_[A-Za-z_]+/g)?.join(', '), /^[A-Z_]{1,40}$/.test(reason?.code) ? reason.code : null, /^[A-Z_]{1,160}$/.test(reason?.diagnostic) ? reason.diagnostic : null].filter(Boolean).join(', '); throw failure }
    finally { clearTimeout(timer) }
  }
  function discoverApps() {
    const requestedEpoch = epoch
    return serialize(async () => {
      if (requestedEpoch !== epoch) throw Object.assign(error('CANCELLED'), { effectStarted: false })
      const active = await start()
      if (requestedEpoch !== epoch) throw Object.assign(error('CANCELLED'), { effectStarted: false })
      try {
        const result = await rpc(active, 'tools/call', { name: 'system.which', arguments: { bins: ['notepad', 'calc', 'mspaint', 'chrome', 'edge'] } })
        const bins = JSON.parse(result.content[0].text).bins
        return ['notepad', 'calc', 'mspaint', 'chrome', 'edge'].map(id => ({ id, found: typeof bins?.[id] === 'string' }))
      } catch { await terminate(active); run = null; throw error('WINDOWS_NODE_FAILED') }
    })
  }
  // NAJD-started background commands (M2c). Only these three host commands are callable this way; the host
  // contains each command in a Job object, so stopping or losing the host ends them.
  // Every failure says whether the request reached the host (dispatched): a request refused before sending, or a
  // tool's own error, is a known outcome; a lost or late answer after sending is not (M2-R11).
  // check: an optional async test run right before the request is sent (after any wait in the queue); when it
  // refuses, nothing is sent (M2-R14-003).
  // onDispatch(instance): called with the receiving host process's number right before the request is sent, so the
  // caller can tie the request to that process whatever happens next (M2-R26-001).
  function invokeHost(name, args, timeoutMs = 20000, { signal, check, onDispatch } = {}) {
    if (!INVOKABLE.includes(name)) return Promise.reject(Object.assign(error('INVALID_INPUT'), { dispatched: false }))
    // Owner frames are bounded (the host reads at most 64 KB per line); refuse larger requests here (M2-R07).
    if (JSON.stringify({ jsonrpc: '2.0', id: 0, method: 'tools/call', params: { name, arguments: args } }).length > 60000)
      return Promise.reject(Object.assign(error('INVALID_INPUT'), { dispatched: false }))
    // A stop (for example the user disconnecting the companion) invalidates requests already queued: they neither
    // restart the host nor reach it (M2-R5-001).
    const requestedEpoch = epoch
    return serialize(async () => {
      // Cancelled while waiting for an earlier host operation: nothing is sent (M2-R04).
      if (signal?.aborted || requestedEpoch !== epoch) throw Object.assign(error('CANCELLED'), { dispatched: false })
      let active
      try { active = await start() } catch (failure) { throw Object.assign(failure, { dispatched: false }) }
      if (signal?.aborted || requestedEpoch !== epoch) throw Object.assign(error('CANCELLED'), { dispatched: false })
      if (check) {
        const refusal = await Promise.resolve().then(check).catch(() => 'PATH_NOT_ALLOWED')
        if (refusal) throw Object.assign(error(refusal), { dispatched: false })
        // Cancelled or stopped while the check ran: still nothing is sent (M2-R16-001).
        if (signal?.aborted || requestedEpoch !== epoch) throw Object.assign(error('CANCELLED'), { dispatched: false })
      }
      try { onDispatch?.(active.instance) } catch {}
      let result
      try { result = await rpc(active, 'tools/call', { name, arguments: args }, timeoutMs, { toolErrors: true, signal }) }
      catch (failure) {
        // A tool's own error leaves the host (and the commands it contains) running; anything else restarts it.
        if (failure?.toolError) throw Object.assign(error(failure.code), { dispatched: true, toolError: true })
        await terminate(active); run = null; throw Object.assign(error('WINDOWS_NODE_FAILED'), { dispatched: true, hostTerminated: true })
      }
      // An answer that cannot be understood after the request was sent: the host is ended too, so whatever it started
      // ends with its jobs rather than running untracked (M2-R24-002).
      try { return JSON.parse(result?.content?.[0]?.text) } catch { await terminate(active); run = null; throw Object.assign(error('WINDOWS_NODE_FAILED'), { dispatched: true, hostTerminated: true }) }
    })
  }
  // The host files are present (the command list itself is verified on every start).
  async function installed() {
    const sdk = layout ? layout.dotnetRoot : path.join(runtimeRoot, 'dotnet-sdk-10.0.400')
    const entry = layout ? layout.entry : path.join(runtimeRoot, 'windows-node-host/Najd.WindowsNode.dll')
    try { await fs.access(path.join(sdk, 'dotnet.exe')); await fs.access(entry); return true } catch { return false }
  }
  const isRunning = () => !!run && !run.closed && !run.exited
  // The current host process's number, and whether a given one has ended: closed, or replaced after it was ended
  // (a replacement is only started after the previous process was terminated) (M2-R25-002).
  const currentInstance = () => isRunning() ? run.instance : null
  const instanceEnded = instance => Number.isInteger(instance) && !(run && run.instance === instance && !run.closed)
  function stop() {
    epoch++ // Invalidate already queued work; a later explicit request may restart.
    const active = run
    let timer
    if (active && !active.closed && !active.exited) {
      active.child.stdin.end() // Owner EOF cooperatively cancels an active native operation.
      timer = setTimeout(() => { if (!active.closed && !active.exited) active.child.kill() }, 8000)
    }
    return serialize(async () => { if (run) { await terminate(run); run = null } }).finally(() => clearTimeout(timer))
  }
  function runDemo(app, signal) {
    if (!['chrome', 'edge'].includes(app)) return Promise.reject(error('INVALID_INPUT'))
    const requestedEpoch = epoch
    return serialize(async () => {
      if (requestedEpoch !== epoch) throw Object.assign(error('CANCELLED'), { effectStarted: false })
      if (signal?.aborted) throw Object.assign(error('CANCELLED'), { effectStarted: false })
      let active
      try { active = await start() } catch (reason) { reason.effectStarted = false; throw reason }
      if (requestedEpoch !== epoch) throw Object.assign(error('CANCELLED'), { effectStarted: false })
      let killTimer
      const abort = () => {
        if (active.pending && !active.closed && !active.exited) {
          active.child.stdin.write('cancel\n')
          killTimer = setTimeout(() => { if (!active.closed && !active.exited) active.child.kill() }, 8000)
        }
      }
      signal?.addEventListener('abort', abort, { once: true })
      try {
        if (signal?.aborted) { abort(); throw Object.assign(error('CANCELLED'), { effectStarted: false }) }
        const result = await rpc(active, 'tools/call', { name: 'najd.windows.demo', arguments: { app } }, 35000)
        const proof = JSON.parse(result.content[0].text)
        if (!['discovery', 'open', 'window', 'focus', 'find-input', 'input-not-found', 'input-pattern', 'set-input', 'verify-input', 'cancelled'].includes(proof.stage)) throw error('WINDOWS_NODE_FAILED')
        if (proof.app !== app || ['opened', 'owned', 'focused', 'inputVerified', 'closed', 'cleaned', 'verified'].some(key => typeof proof[key] !== 'boolean')) throw error('WINDOWS_NODE_FAILED')
        // Focus is reported, not required (Windows may keep the window behind the owner's app); ownership is (C51-01).
        if (proof.verified !== ['opened', 'owned', 'inputVerified', 'closed', 'cleaned'].every(key => proof[key])) throw error('WINDOWS_NODE_FAILED')
        if (signal?.aborted) throw Object.assign(error('CANCELLED'), { effectStarted: true, effectResolved: proof.closed, output: JSON.stringify(proof) })
        return Object.fromEntries(['app', 'opened', 'owned', 'focused', 'inputVerified', 'closed', 'cleaned', 'verified', 'stage'].map(key => [key, proof[key]]))
      } catch (reason) { await terminate(active); run = null; throw reason }
      finally { clearTimeout(killTimer); signal?.removeEventListener('abort', abort) }
    })
  }
  // A handshake receipt is not a live connection-health indicator.
  const pairingReceipt = () => run && !run.closed && run.gatewayConnected ? { nodeId: run.nodeId, verifiedAt: run.verifiedAt } : null
  const connect = () => {
    const requestedEpoch = epoch
    return serialize(async () => {
      if (requestedEpoch !== epoch) throw Object.assign(error('CANCELLED'), { effectStarted: false })
      const active = await start()
      if (requestedEpoch !== epoch) throw Object.assign(error('CANCELLED'), { effectStarted: false })
      return JSON.parse(JSON.stringify(active.mcp))
    })
  }
  const mcpReceipt = () => run && !run.closed && run.mcp ? JSON.parse(JSON.stringify(run.mcp)) : null
  // The running host's process id, so a pack installer's folder is kept while that host could still run it (M3-005).
  const hostPid = () => run && !run.closed && Number.isInteger(run.child?.pid) ? run.child.pid : null
  return { discoverApps, runDemo, stop, pairingReceipt, connect, mcpReceipt, invokeHost, invokeProcess: invokeHost, isRunning, installed, currentInstance, instanceEnded, hostPid }
}
module.exports = { createWindowsNode }
