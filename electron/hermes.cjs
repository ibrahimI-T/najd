const fs = require('node:fs/promises')
const path = require('node:path')
const http = require('node:http')
const { randomBytes, randomUUID } = require('node:crypto')
const { spawn, execFile } = require('node:child_process')
const { promisify } = require('node:util')
const execute = promisify(execFile)
const REVISION = 'c70332f88886932337619a1e57029bd885c28b9d'
const problem = code => Object.assign(new Error(code), { code })

// A single tool-free planning lease. Providers, permissions and canonical sessions stay in NAJD.
const workerSource = require('node:fs').readFileSync(path.join(__dirname, 'hermes-worker.py'), 'utf8')

// getCore returns the activated sealed core directory; without it only a developer
// checkout's prepared runtime can be used.
function createHermesAdapter({ root, stateRoot = root && path.join(root, '.runtimes/hermes/tasks'), chat, timeoutMs = 3600000, diagnostic, getCore = async () => null } = {}) {
  if (typeof root !== 'string' || !path.isAbsolute(root) || typeof chat !== 'function' ||
      typeof stateRoot !== 'string' || !path.isAbsolute(stateRoot) ||
      !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 3600000) throw problem('INVALID_INPUT')
  let current = null
  let status = { engine: 'hermes', state: 'not_installed', instanceId: null, sourceRevision: REVISION,
    runtimeVersion: null, verifiedAt: null, error: null }
  async function run({ provider, modelName, text, signal, reasoningEffort = 'auto' }) {
    if (signal?.aborted) throw problem('CANCELLED')
    if (provider !== 'ollama') throw problem('TOOLS_NOT_SUPPORTED')
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/.test(modelName || '') ||
        typeof text !== 'string' || !text.trim() || text.length > 4000) throw problem('INVALID_INPUT')
    if (current) throw problem('PROVIDER_BUSY')
    const controller = new AbortController()
    const lease = { controller, done: null, instanceId: randomUUID() }
    current = lease
    status = { ...status, state: 'starting', instanceId: lease.instanceId, error: null }
    lease.done = perform({ provider, modelName, text, reasoningEffort }, signal, controller, lease.instanceId)
    try {
      const result = await lease.done
      status = { ...status, state: 'stopped', instanceId: null }
      return result
    } catch (error) {
      status = { ...status, state: error?.code === 'NOT_INSTALLED' ? 'not_installed' : 'failed', instanceId: null,
        error: error?.code || 'RUNTIME_FAILED' }
      throw error
    } finally { if (current === lease) current = null }
  }
  async function perform(request, signal, controller, instanceId) {
    const runtime = path.join(root, '.runtimes/hermes')
    let home, server, child, closed, timer, terminal, failure, brokerCalls = 0, sequence = 0
    const taskId = randomUUID(), token = randomBytes(32).toString('hex')
    const abort = () => controller.abort()
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) controller.abort()
    const abortError = () => problem(signal?.aborted ? 'CANCELLED' : 'RUNTIME_TIMEOUT')
    try {
      const core = await getCore()
      let python, workerArgs, runtimeTools
      if (core) {
        const receipt = JSON.parse(await fs.readFile(path.join(core, 'najd-core.json'), 'utf8'))
        python = path.resolve(core, receipt.python)
        const relative = path.relative(core, python)
        if (receipt.sourceRevision !== REVISION || !relative || relative.startsWith('..') ||
            !['python.exe', 'najd-engine.exe'].includes(path.basename(python).toLowerCase())) throw problem('INCOMPATIBLE_RUNTIME')
        workerArgs = ['-I', '-S', '-B', '-c', workerSource, core, REVISION]
        runtimeTools = path.join(core, 'tools')
      } else {
        const prepared = JSON.parse(await fs.readFile(path.join(runtime, 'prepared.json'), 'utf8'))
        if (prepared.sourceRevision !== REVISION) throw problem('INCOMPATIBLE_RUNTIME')
        const source = await execute('git', ['-C', path.join(root, 'third_party/hermes-agent'), 'rev-parse', 'HEAD'], { windowsHide: true, timeout: 5000 })
        if (source.stdout.trim() !== REVISION) throw problem('INCOMPATIBLE_RUNTIME')
        python = path.join(runtime, 'core-venv/Scripts/python.exe')
        workerArgs = ['-I', '-B', path.join(root, 'electron/hermes-worker.py')]
        runtimeTools = path.join(runtime, 'tools')
      }
      await fs.mkdir(stateRoot, { recursive: true })
      home = await fs.mkdtemp(path.join(stateRoot, 'task-'))
      const profile = path.join(home, 'profile')
      await fs.mkdir(profile)
      await fs.writeFile(path.join(profile, 'config.yaml'),
        'agent:\n  api_max_retries: 1\n  auto_recovery_cycles: 0\ncompression:\n  enabled: false\nmemory:\n  memory_enabled: false\n  user_profile_enabled: false\n')
      const broker = async (req, res) => {
        try {
          if (req.method !== 'POST' || req.url !== '/v1/chat/completions' || req.headers.origin ||
              req.headers.authorization !== `Bearer ${token}` || controller.signal.aborted) {
            res.writeHead(403).end(); return
          }
          // Exactly one upstream inference; retries, tool calls and auxiliary routes cannot spend again.
          if (++brokerCalls !== 1) { res.writeHead(409).end(); return }
          const chunks = []
          let bytes = 0
          for await (const chunk of req) {
            bytes += chunk.length
            if (bytes > 1024 * 1024) throw problem('INVALID_PROTOCOL')
            chunks.push(chunk)
          }
          const data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)))
          if (data.model !== request.modelName || data.tools !== undefined && (!Array.isArray(data.tools) || data.tools.length) ||
              data.stream !== undefined && typeof data.stream !== 'boolean' || !Array.isArray(data.messages) ||
              data.messages.length > 20 || data.messages.some(m => !['system', 'user', 'assistant'].includes(m.role) || typeof m.content !== 'string')) throw problem('INVALID_PROTOCOL')
          const system = data.messages.filter(m => m.role === 'system').map(m => m.content).join('\n')
          const history = data.messages.filter(m => m.role !== 'system').map(m => ({ role: m.role, text: m.content }))
          if (history.length !== 1 || history[0].role !== 'user' || history[0].text !== request.text || system.length > 20000) throw problem('INVALID_PROTOCOL')
          diagnostic?.({ history, system, stream: !!data.stream })
          const result = await chat({ ...request, history, systemPrompt: system, signal: controller.signal })
          if (result?.kind !== 'message' || typeof result.text !== 'string' || result.text.length > 20000) throw problem('INVALID_MODEL_OUTPUT')
          const response = { id: taskId, object: 'chat.completion', created: Math.floor(Date.now() / 1000), model: request.modelName,
            choices: [{ index: 0, message: { role: 'assistant', content: result.text }, finish_reason: 'stop' }] }
          if (data.stream) {
            res.writeHead(200, { 'Content-Type': 'text/event-stream' })
            res.end(`data: ${JSON.stringify({ ...response, object: 'chat.completion.chunk', choices: [{ index: 0, delta: { role: 'assistant', content: result.text }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ ...response, object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`)
          } else res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(response))
        } catch (error) {
          failure = error?.code || 'RUNTIME_FAILED'
          if (!res.headersSent) res.writeHead(502)
          res.end()
          controller.abort()
        }
      }
      server = http.createServer((req, res) => { void broker(req, res) })
      server.requestTimeout = timeoutMs
      server.headersTimeout = Math.min(10000, timeoutMs)
      await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
      if (controller.signal.aborted) throw abortError()
      const systemRoot = process.env.SystemRoot || 'C:\\Windows'
      child = spawn(python, workerArgs, {
        cwd: home, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: {
          SystemRoot: systemRoot, WINDIR: systemRoot, SystemDrive: path.parse(systemRoot).root.slice(0, 2),
          PATH: path.join(systemRoot, 'System32'), HOME: home, USERPROFILE: home,
          APPDATA: path.join(home, 'AppData/Roaming'), LOCALAPPDATA: path.join(home, 'AppData/Local'),
          TEMP: home, TMP: home, HERMES_HOME: profile, HERMES_RUNTIME_DIR: runtimeTools,
          PYTHONUTF8: '1', PYTHONDONTWRITEBYTECODE: '1'
        }
      })
      let buffer = '', stderrTail = ''
      child.stderr.on('data', chunk => { stderrTail = (stderrTail + chunk).slice(-6000) })
      child.stdout.on('data', chunk => {
        buffer += chunk.toString('utf8')
        if (Buffer.byteLength(buffer) > 1024 * 1024) { failure = 'INVALID_PROTOCOL'; controller.abort(); return }
        let end
        while ((end = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, end); buffer = buffer.slice(end + 1)
          try {
            const frame = JSON.parse(line)
            if (terminal || frame.version !== 1 || frame.instanceId !== instanceId || frame.taskId !== taskId || frame.sequence !== ++sequence ||
                !(['ready', 'completed'].includes(frame.type)) || sequence === 1 && frame.type !== 'ready' ||
                sequence === 2 && frame.type !== 'completed' || sequence > 2) throw problem('INVALID_PROTOCOL')
            if (frame.type === 'ready') {
              if (frame.runtimeVersion !== '3.14.7') throw problem('INCOMPATIBLE_RUNTIME')
              status = { ...status, state: 'healthy', runtimeVersion: frame.runtimeVersion, verifiedAt: new Date().toISOString() }
            }
            if (frame.type === 'completed') {
              if (typeof frame.output !== 'string' || !frame.output.trim() || frame.output.length > 20000 || brokerCalls !== 1) throw problem('INVALID_PROTOCOL')
              terminal = frame.output
            }
          } catch (error) { failure = error.code === 'INCOMPATIBLE_RUNTIME' ? error.code : 'INVALID_PROTOCOL'; controller.abort() }
        }
      })
      closed = new Promise(resolve => {
        child.once('error', () => { failure = 'RUNTIME_FAILED'; resolve(-1) })
        child.once('close', code => resolve(code))
      })
      child.stdin.on('error', () => {})
      child.stdin.write(JSON.stringify({ instanceId, taskId, model: request.modelName, text: request.text,
        token, baseUrl: `http://127.0.0.1:${server.address().port}/v1`, cwd: home }) + '\n')
      timer = setTimeout(() => controller.abort(), timeoutMs)
      const outcome = await Promise.race([closed, new Promise(resolve => {
        if (controller.signal.aborted) resolve('aborted')
        else controller.signal.addEventListener('abort', () => resolve('aborted'), { once: true })
      })])
      if (outcome === 'aborted') throw problem(failure || abortError().code)
      if (outcome !== 0 || !terminal || buffer.trim()) {
        diagnostic?.({ stderr: stderrTail })
        throw problem(failure || 'RUNTIME_FAILED')
      }
      return { kind: 'message', text: terminal, reasoningEffort: null }
    } catch (error) {
      if (error?.code === 'ENOENT') throw problem('NOT_INSTALLED')
      const codes = new Set(['CANCELLED', 'RUNTIME_TIMEOUT', 'RUNTIME_FAILED', 'RUNTIME_STOP_FAILED', 'INCOMPATIBLE_RUNTIME', 'INVALID_PROTOCOL',
        'INVALID_INPUT', 'INVALID_MODEL_OUTPUT', 'CONTEXT_LIMIT', 'PROVIDER_BUSY', 'PROVIDER_POLICY_UNAVAILABLE', 'OLLAMA_UNAVAILABLE', 'MODEL_NOT_FOUND', 'PROVIDER_TIMEOUT'])
      throw problem(codes.has(error?.code) ? error.code : 'RUNTIME_FAILED')
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      controller.abort()
      if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
      if (child && child.exitCode === null && child.pid) {
        child.stdin.destroy()
        await execute(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 8000 }).catch(() => {})
      }
      if (closed) {
        let stopTimer
        const stopped = await Promise.race([closed.then(() => true), new Promise(resolve => { stopTimer = setTimeout(() => resolve(false), 8000) })])
        clearTimeout(stopTimer)
        if (!stopped) throw problem('RUNTIME_STOP_FAILED')
      }
      if (home) await fs.rm(home, { recursive: true, force: true })
    }
  }
  return { run, status: () => ({ ...status }), async stop() {
    const lease = current
    if (lease) { status = { ...status, state: 'stopping' }; lease.controller.abort(); await lease.done.catch(() => {}) }
  } }
}
module.exports = { createHermesAdapter }
