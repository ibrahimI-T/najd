// User-configured external MCP servers (stdio). Only the user adds a server, through Settings, and main
// shows the exact command line in a native confirmation before anything is saved or started. The model can
// list and call tools of connected servers; every call is approved in chat by NAJD (see agent-runtime).
const fs = require('node:fs'), fsp = require('node:fs/promises'), path = require('node:path')
const { replaceFile } = require('./atomic-file.cjs')
const { createMcpClient } = require('./mcp-client.cjs')
const { classifyFailure, createHealthBook, readiness } = require('./mcp-health.cjs')
const fail = code => Object.assign(new Error(code), { code })
const ENV_PASS = ['SystemRoot', 'WINDIR', 'PATH', 'PATHEXT', 'COMSPEC', 'TEMP', 'TMP', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'APPDATA', 'LOCALAPPDATA',
  'ProgramData', 'ProgramFiles', 'ProgramFiles(x86)', 'CommonProgramFiles', 'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE', 'OS', 'USERNAME', 'COMPUTERNAME']
const CMD_META = /["&|<>^%!\r\n]/
const BUNDLED = 'najd-node'

function slug(name, taken) {
  const base = (name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'server').replace(/^[^a-z]+/, '').slice(0, 24) || 'server'
  let id = base.length > 1 ? base : 'mcp-' + base, n = 2
  while (taken.has(id)) id = base.slice(0, 20) + '-' + n++
  return id
}
// Resolve a bare program name ("npx", "uvx", "node") the way a terminal would, so the confirmation shows the real file.
function resolveCommand(command, envPath = process.env.PATH || '') {
  if (path.isAbsolute(command)) return fs.existsSync(command) && fs.statSync(command).isFile() ? command : null
  if (!/^[A-Za-z0-9_.-]{1,64}$/.test(command)) return null
  const exts = path.extname(command) ? [''] : ['.exe', '.cmd', '.bat']
  for (const dir of envPath.split(path.delimiter).filter(Boolean)) for (const ext of exts) {
    const candidate = path.join(dir, command + ext)
    try { if (fs.statSync(candidate).isFile()) return candidate } catch {}
  }
  return null
}

function createMcpServers({ filePath, encryption, confirm, getBundledNode = () => null, clientVersion = '0.0.0', spawnImpl, env = process.env }) {
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath) || typeof confirm !== 'function') throw fail('INVALID_INPUT')
  let record = null, queue = Promise.resolve()
  const live = new Map()
  const health = createHealthBook()
  const serialize = work => { const next = queue.then(work); queue = next.catch(() => {}); return next }

  async function load() {
    if (record) return record
    try {
      const raw = await fsp.readFile(filePath)
      if (raw.length > 262144) throw fail('MCP_STORE_UNAVAILABLE')
      const parsed = JSON.parse(raw.toString('utf8'))
      if (parsed.version !== 1 || !Array.isArray(parsed.servers) || typeof parsed.secrets !== 'object') throw fail('MCP_STORE_UNAVAILABLE')
      record = parsed
    } catch (error) {
      if (error.code !== 'ENOENT') throw fail('MCP_STORE_UNAVAILABLE')
      record = { version: 1, servers: [], secrets: {} }
    }
    return record
  }
  async function save() {
    await fsp.mkdir(path.dirname(filePath), { recursive: true })
    const temp = filePath + '.' + process.pid + '.tmp'
    await fsp.writeFile(temp, JSON.stringify(record, null, 2)); await replaceFile(temp, filePath)
  }

  function validate(input) {
    if (!input || typeof input !== 'object') throw fail('INVALID_INPUT')
    const name = typeof input.name === 'string' ? input.name.trim() : ''
    if (!name || name.length > 40 || /[\x00-\x1f]/.test(name)) throw fail('INVALID_NAME')
    const args = input.args ?? []
    if (!Array.isArray(args) || args.length > 32 || args.some(arg => typeof arg !== 'string' || arg.length > 1000 || /[\x00\r\n]/.test(arg))) throw fail('INVALID_ARGS')
    const secrets = input.env ?? {}
    if (typeof secrets !== 'object' || Array.isArray(secrets) || Object.keys(secrets).length > 20 ||
        Object.entries(secrets).some(([key, value]) => !/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(key) || typeof value !== 'string' || value.length > 4000 || /[\x00\r\n]/.test(value))) throw fail('INVALID_ENV')
    let command = typeof input.command === 'string' ? input.command.trim() : ''
    if (command !== BUNDLED) {
      command = resolveCommand(command, env.PATH)
      if (!command || !/\.(exe|cmd|bat)$/i.test(command)) throw fail('COMMAND_NOT_FOUND')
      if (/\.(cmd|bat)$/i.test(command) && args.some(arg => CMD_META.test(arg))) throw fail('INVALID_ARGS')
    } else if (!getBundledNode()) throw fail('RUNTIME_NOT_READY')
    let cwd = typeof input.cwd === 'string' && input.cwd.trim() ? input.cwd.trim() : null
    if (cwd && (!path.isAbsolute(cwd) || !fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory())) throw fail('INVALID_CWD')
    return { name, command, args, cwd, secrets }
  }
  const display = server => (server.command === BUNDLED ? 'NAJD Node' : server.command) + (server.args.length ? ' ' + server.args.map(arg => /\s/.test(arg) ? '"' + arg + '"' : arg).join(' ') : '')

  function launchSpec(server) {
    const base = {}
    for (const key of ENV_PASS) if (env[key] !== undefined) base[key] = env[key]
    let secrets = {}
    const sealed = record.secrets[server.id]
    if (sealed) { try { secrets = JSON.parse(encryption.decryptString(Buffer.from(sealed, 'base64'))) } catch { throw fail('CREDENTIAL_UNAVAILABLE') } }
    const merged = { ...base, ...secrets }
    if (server.command === BUNDLED) {
      const node = getBundledNode()
      if (!node) throw fail('RUNTIME_NOT_READY')
      merged.PATH = path.dirname(node) + path.delimiter + (merged.PATH || '')
      return { command: node, args: server.args, env: merged }
    }
    merged.PATH = path.dirname(server.command) + path.delimiter + (merged.PATH || '')
    if (/\.(cmd|bat)$/i.test(server.command)) {
      // Batch launchers need cmd.exe; arguments were checked for cmd metacharacters when saved.
      const line = '"' + [server.command, ...server.args].map(part => '"' + part + '"').join(' ') + '"'
      return { command: path.join(env.SystemRoot || 'C:\\Windows', 'System32', 'cmd.exe'), args: ['/d', '/s', '/c', line], env: merged, verbatim: true }
    }
    return { command: server.command, args: server.args, env: merged }
  }

  // Installed = the program resolves; connected = the live session answered; the rest comes from real calls (mcp-health.cjs).
  function toolReadiness(server, state, toolName) {
    const installed = server.command === BUNDLED ? !!getBundledNode() : fs.existsSync(server.command)
    return readiness({ installed, connected: state?.state === 'connected', row: health.get(server.id, toolName) })
  }
  function view(server) {
    const state = live.get(server.id)
    return { id: server.id, name: server.name, commandLine: display(server), cwd: server.cwd, envNames: server.envNames, enabled: server.enabled,
      state: state?.state || 'disconnected', error: state?.error || null, serverInfo: state?.client?.info() || null,
      tools: state?.state === 'connected' ? state.tools.map(({ name, title, description, hints }) => ({ name, title, description, hints, readiness: toolReadiness(server, state, name) })) : [] }
  }

  // A connection started for a cancelled task stops before it is enabled (NAJD-R03).
  async function connect(id, { signal } = {}) {
    if (signal?.aborted) throw fail('CANCELLED')
    const rec = await load()
    const server = rec.servers.find(row => row.id === id)
    if (!server) throw fail('NOT_FOUND')
    const current = live.get(id)
    if (current?.state === 'connected') return view(server)
    if (current?.state === 'connecting') return current.ready
    const entry = { state: 'connecting', tools: [], error: null, client: null }
    health.clearServer(id) // a new session may follow a fixed setup
    live.set(id, entry)
    // A cancel stops the program at once, during start-up or tool listing, and it is never enabled (I2-002).
    const onAbort = () => { entry.cancelled = true; entry.client?.stop() }
    signal?.addEventListener('abort', onAbort, { once: true })
    entry.ready = (async () => {
      try {
        if (signal?.aborted) throw fail('CANCELLED')
        const spec = launchSpec(server)
        const spawnFn = spawnImpl || ((command, args, options) => require('node:child_process').spawn(command, args, { ...options, windowsVerbatimArguments: !!spec.verbatim }))
        entry.client = createMcpClient({ command: spec.command, args: spec.args, cwd: server.cwd || undefined, env: spec.env, clientVersion, spawnImpl: spawnFn,
          onExit: () => { if (live.get(id) === entry && entry.state !== 'disconnected') { entry.state = 'failed'; entry.error = 'SERVER_EXITED' } },
          onToolsChanged: () => { entry.client.listTools().then(tools => { entry.tools = tools }).catch(() => {}) } })
        await entry.client.start()
        entry.tools = await entry.client.listTools()
        if (signal?.aborted) throw fail('CANCELLED')
        entry.state = 'connected'
        if (!server.enabled) await serialize(async () => { server.enabled = true; await save() })
      } catch (error) {
        entry.client?.stop(); entry.state = 'failed'
        entry.error = entry.cancelled || signal?.aborted ? 'CANCELLED'
          : ['COMMAND_NOT_FOUND', 'START_FAILED', 'SERVER_EXITED', 'TIMEOUT', 'SERVER_ERROR', 'CREDENTIAL_UNAVAILABLE', 'RUNTIME_NOT_READY'].includes(error.code) ? error.code : 'START_FAILED'
      } finally { signal?.removeEventListener('abort', onAbort) }
      return view(server)
    })()
    return entry.ready
  }
  async function disconnect(id, { keepEnabled = false } = {}) {
    const rec = await load()
    const server = rec.servers.find(row => row.id === id)
    if (!server) throw fail('NOT_FOUND')
    const entry = live.get(id)
    if (entry) { entry.state = 'disconnected'; entry.client?.stop(); live.delete(id) }
    if (!keepEnabled && server.enabled) await serialize(async () => { server.enabled = false; await save() })
    return view(server)
  }

  return {
    BUNDLED,
    async list() { return (await load()).servers.map(view) },
    // Adding requires the user's native confirmation of the exact command; a renderer cannot skip it. The agent's
    // install path (extensions.cjs) passes approvedInChat after the user approved the exact package in chat.
    add: (input, { approvedInChat = false, signal } = {}) => serialize(async () => {
      if (signal?.aborted) throw fail('CANCELLED')
      const rec = await load()
      if (rec.servers.length >= 500) throw fail('LIMIT_REACHED')
      const clean = validate(input)
      const id = slug(clean.name, new Set(rec.servers.map(row => row.id)))
      const server = { id, name: clean.name, command: clean.command, args: clean.args, cwd: clean.cwd, envNames: Object.keys(clean.secrets), enabled: false, addedAt: new Date().toISOString() }
      if (!approvedInChat && !await confirm({ name: server.name, commandLine: display(server), cwd: server.cwd, envNames: server.envNames })) return { status: 'cancelled' }
      if (server.envNames.length) {
        if (!encryption?.isEncryptionAvailable?.()) throw fail('CREDENTIAL_UNAVAILABLE')
        rec.secrets[id] = encryption.encryptString(JSON.stringify(clean.secrets)).toString('base64')
      }
      if (signal?.aborted) throw fail('CANCELLED')
      rec.servers.push(server); await save()
      return { status: 'added', server: view(server) }
    }),
    remove: async id => {
      await disconnect(id).catch(() => {})
      return serialize(async () => {
        const rec = await load()
        const index = rec.servers.findIndex(row => row.id === id)
        if (index < 0) throw fail('NOT_FOUND')
        rec.servers.splice(index, 1); delete rec.secrets[id]; await save()
        return { status: 'removed' }
      })
    },
    connect, disconnect,
    // Start servers the user left enabled (after app start). Failures stay visible in Settings.
    async resume() { for (const server of (await load()).servers.filter(row => row.enabled)) connect(server.id).catch(() => {}) },
    async tools() {
      const rec = await load()
      return rec.servers.flatMap(server => { const entry = live.get(server.id); return entry?.state === 'connected' ? entry.tools.map(tool => ({ server: server.id, serverName: server.name, ...tool, readiness: toolReadiness(server, entry, tool.name) })) : [] })
    },
    health,
    async call(serverId, toolName, args, { signal } = {}) {
      const entry = live.get(serverId)
      if (entry?.state !== 'connected') throw fail('NOT_CONNECTED')
      if (!entry.tools.some(tool => tool.name === toolName)) throw fail('UNSUPPORTED_TOOL')
      const started = Date.now()
      let result
      try { result = await entry.client.callTool(toolName, args, { signal }) }
      catch (failure) {
        // The real code, tool and duration are kept; a cancel is not a tool failure.
        if (failure?.code !== 'CANCELLED') health.recordFailure(serverId, toolName, classifyFailure({ code: failure?.code, detail: failure?.detail }), Date.now() - started)
        throw Object.assign(failure, { stage: 'call', durationMs: Date.now() - started })
      }
      const durationMs = Date.now() - started
      if (result.isError) { const info = classifyFailure({ text: result.text, structured: result.structured }); health.recordFailure(serverId, toolName, info, durationMs); return { ...result, durationMs, failure: info } }
      health.recordSuccess(serverId, toolName, durationMs)
      return { ...result, durationMs }
    },
    stopAll() { for (const [id, entry] of live) { entry.state = 'disconnected'; entry.client?.stop(); live.delete(id) } }
  }
}
module.exports = { createMcpServers, resolveCommand }
