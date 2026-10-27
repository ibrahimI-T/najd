// Long-lived bridge to allowlisted original Hermes tools running inside the activated
// sealed agent core. Started lazily on first use, one request at a time, bounded
// results, isolated throwaway profile, scrubbed environment, stopped when idle or on quit.
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { spawn } = require('node:child_process')

const REVISION = 'c70332f88886932337619a1e57029bd885c28b9d'
const workerSource = fs.readFileSync(path.join(__dirname, 'hermes-tools-worker.py'), 'utf8')
const fail = code => Object.assign(new Error(code), { code })

function createHermesTools({ getCoreDirectory, stateRoot, idleMs = 120000, startTimeoutMs = 90000, callTimeoutMs = 60000 }) {
  if (typeof getCoreDirectory !== 'function' || !path.isAbsolute(stateRoot || '')) throw fail('INVALID_INPUT')
  let worker = null, starting = null, queue = Promise.resolve(), idleTimer = null, nextId = 1

  async function start() {
    const core = await getCoreDirectory()
    if (!core) throw fail('RUNTIME_NOT_READY')
    const receipt = JSON.parse(await fsp.readFile(path.join(core, 'najd-core.json'), 'utf8'))
    const python = path.resolve(core, receipt.python)
    const relative = path.relative(core, python)
    if (receipt.sourceRevision !== REVISION || !relative || relative.startsWith('..') || !['python.exe', 'najd-engine.exe'].includes(path.basename(python).toLowerCase())) throw fail('INCOMPATIBLE_RUNTIME')
    await fsp.mkdir(stateRoot, { recursive: true })
    const home = await fsp.mkdtemp(path.join(stateRoot, 'tools-'))
    const systemRoot = process.env.SystemRoot || 'C:\\Windows'
    const env = { SystemRoot: systemRoot, WINDIR: systemRoot, SystemDrive: path.parse(systemRoot).root.slice(0, 2), PATH: path.join(systemRoot, 'System32'),
      HOME: home, USERPROFILE: home, APPDATA: path.join(home, 'Roaming'), LOCALAPPDATA: path.join(home, 'Local'), TEMP: home, TMP: home,
      HERMES_HOME: path.join(home, 'profile'), HERMES_RUNTIME_DIR: path.join(core, 'tools'), PYTHONUTF8: '1', PYTHONDONTWRITEBYTECODE: '1' }
    const child = spawn(python, ['-I', '-S', '-B', '-c', workerSource, core, REVISION], { cwd: home, env, windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] })
    const state = { child, home, pending: new Map(), buffer: '', ready: null }
    state.ready = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(fail('RUNTIME_TIMEOUT')), startTimeoutMs)
      state.pending.set(0, { resolve: value => { clearTimeout(timer); resolve(value) }, reject: error => { clearTimeout(timer); reject(error) } })
    })
    child.stdout.on('data', chunk => {
      state.buffer += chunk.toString('utf8')
      if (state.buffer.length > 1024 * 1024) { stop(state); return }
      let end
      while ((end = state.buffer.indexOf('\n')) !== -1) {
        const line = state.buffer.slice(0, end); state.buffer = state.buffer.slice(end + 1)
        let frame
        try { frame = JSON.parse(line) } catch { continue }
        const waiting = state.pending.get(frame.id)
        if (!waiting) continue
        state.pending.delete(frame.id)
        if (frame.ok) waiting.resolve({ result: frame.result, truncated: frame.truncated === true })
        else waiting.reject(fail(typeof frame.error === 'string' && /^[A-Z_]{3,40}$/.test(frame.error) ? frame.error : 'TOOL_FAILED'))
      }
    })
    child.on('error', () => stop(state))
    child.on('close', () => {
      for (const waiting of state.pending.values()) waiting.reject(fail('RUNTIME_FAILED'))
      state.pending.clear()
      if (worker === state) worker = null
      void fsp.rm(home, { recursive: true, force: true }).catch(() => {})
    })
    child.stdin.on('error', () => {})
    const hello = await state.ready.catch(error => { stop(state); throw error })
    state.tools = hello.result.tools
    return state
  }

  function stop(state = worker) {
    if (!state) return
    if (worker === state) worker = null
    try { state.child.stdin.end() } catch {}
    if (state.child.exitCode === null && state.child.pid) {
      try { spawn(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/taskkill.exe'), ['/PID', String(state.child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }) } catch {}
    }
  }

  async function ensure() {
    if (worker) return worker
    if (!starting) starting = start().then(state => { worker = state; return state }).finally(() => { starting = null })
    return starting
  }

  function call(tool, args, signal) {
    const run = queue.then(async () => {
      if (signal?.aborted) throw fail('CANCELLED')
      clearTimeout(idleTimer)
      const state = await ensure()
      if (!state.tools.includes(tool)) throw fail('UNSUPPORTED_TOOL')
      const id = nextId++
      try {
        return await new Promise((resolve, reject) => {
          const timer = setTimeout(() => { reject(fail('RUNTIME_TIMEOUT')); stop(state) }, callTimeoutMs)
          const abort = () => { reject(fail('CANCELLED')); stop(state) }
          signal?.addEventListener('abort', abort, { once: true })
          const settle = fn => value => { clearTimeout(timer); signal?.removeEventListener('abort', abort); fn(value) }
          state.pending.set(id, { resolve: settle(resolve), reject: settle(reject) })
          state.child.stdin.write(JSON.stringify({ id, tool, args }) + '\n')
        })
      } finally {
        idleTimer = setTimeout(() => stop(), idleMs)
        idleTimer.unref?.()
      }
    })
    queue = run.catch(() => {})
    return run
  }

  return {
    available: async () => !!(await getCoreDirectory()),
    search: (query, signal) => call('web_search', { query }, signal),
    extract: (url, signal) => call('web_extract', { urls: [url] }, signal),
    stop: () => { clearTimeout(idleTimer); stop() }
  }
}
module.exports = { createHermesTools }
