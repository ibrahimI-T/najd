// Generic managed-runtime lifecycle for internal engines (OpenClaw gateway, Hermes bridge).
// NAJD owns start/stop/health; engines never manage themselves.
const { spawn, execFile } = require('node:child_process')
const path = require('node:path')

function runtimeError(code) { return Object.assign(new Error(code), { code }) }

function createManagedRuntime({ id, command, args = [], env = {}, cwd, readinessUrl,
    readyTimeoutMs = 30000, stopTimeoutMs = 8000, pollIntervalMs = 250,
    inheritEnv = true, ipcShutdown = false } = {}) {
  if (typeof id !== 'string' || !/^[a-z][a-z0-9-]{0,30}$/.test(id)) throw runtimeError('INVALID_INPUT')
  if (typeof command !== 'string' || !command) throw runtimeError('INVALID_INPUT')
  if (typeof inheritEnv !== 'boolean' || typeof ipcShutdown !== 'boolean') throw runtimeError('INVALID_INPUT')
  let url
  try { url = new URL(readinessUrl) } catch { throw runtimeError('INVALID_INPUT') }
  if (!['http:', 'https:'].includes(url.protocol) || url.hostname !== '127.0.0.1' || url.username || url.password || url.hash) throw runtimeError('INVALID_INPUT')
  if (!Array.isArray(args) || args.some(arg => typeof arg !== 'string') ||
      [readyTimeoutMs, stopTimeoutMs, pollIntervalMs].some(ms => !Number.isSafeInteger(ms) || ms < 1 || ms > 300000)) throw runtimeError('INVALID_INPUT')
  let state = 'stopped'
  let current = null
  let starting = null
  let stopping = null

  const asleep = ms => new Promise(resolve => setTimeout(resolve, ms))

  // Clear each probe's timeout as soon as the request finishes.
  function withTimeout(ms) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), ms)
    if (typeof timer.unref === 'function') timer.unref()
    return { signal: controller.signal, cancel: () => clearTimeout(timer) }
  }

  async function probe(timeoutMs) {
    const { signal, cancel } = withTimeout(timeoutMs)
    try {
      const response = await fetch(url, { signal, redirect: 'error' })
      await response.body?.cancel()
      return response.ok
    } catch { return false }
    finally { cancel() }
  }

  async function pollReady(run, deadline) {
    while (Date.now() < deadline) {
      if (state !== 'starting' || current !== run || run.failed || run.exited) return false
      const ready = await probe(Math.min(pollIntervalMs, 1000, deadline - Date.now()))
      if (state !== 'starting' || current !== run || run.failed || run.exited) return false
      if (ready) return true
      await asleep(Math.min(pollIntervalMs, Math.max(0, deadline - Date.now())))
    }
    return false
  }

  async function waitClosed(run) {
    let timer
    try {
      return await Promise.race([run.closed.then(() => true), new Promise(resolve => {
        timer = setTimeout(() => resolve(false), stopTimeoutMs)
      })])
    } finally { clearTimeout(timer) }
  }

  function terminate(run) {
    if (run.termination) return run.termination
    run.stopping = true
    run.termination = (async () => {
      if (run.done) return
      if (ipcShutdown && run.child.connected) {
        try { run.child.send({ type: 'shutdown' }, () => {}) }
        catch { run.child.kill('SIGTERM') }
      } else run.child.kill('SIGTERM')
      if (await waitClosed(run)) return
      if (process.platform === 'win32' && !run.exited && Number.isInteger(run.child.pid)) {
        await new Promise(resolve => execFile(path.join(process.env.SystemRoot, 'System32', 'taskkill.exe'),
          ['/PID', String(run.child.pid), '/T', '/F'], { windowsHide: true, timeout: stopTimeoutMs }, () => resolve()))
      } else if (!run.exited) run.child.kill('SIGKILL')
      if (!await waitClosed(run)) throw runtimeError('RUNTIME_STOP_FAILED')
    })()
    return run.termination
  }

  async function launch() {
    if (current && !current.done) throw runtimeError('RUNTIME_STOP_FAILED')
    state = 'starting'
    let spawned
    try {
      spawned = spawn(command, args, { cwd, env: inheritEnv ? { ...process.env, ...env } : env,
        windowsHide: true, stdio: ipcShutdown ? ['ignore', 'ignore', 'ignore', 'ipc'] : 'ignore' })
    } catch (error) {
      state = 'failed'
      throw runtimeError('RUNTIME_FAILED')
    }
    let resolveClosed
    const run = { child: spawned, failed: false, exited: false, done: false, stopping: false,
      closed: new Promise(resolve => { resolveClosed = resolve }) }
    current = run
    spawned.once('error', () => {
      run.failed = true
      if (current === run && !run.stopping) state = 'failed'
    })
    spawned.once('exit', () => {
      run.exited = true
      if (current === run && !run.stopping) state = 'failed'
    })
    spawned.once('close', () => { run.done = true; resolveClosed() })
    const ready = await pollReady(run, Date.now() + readyTimeoutMs)
    if (ready) { state = 'running'; return }
    const code = run.stopping ? 'RUNTIME_CANCELLED' : run.failed || run.exited ? 'RUNTIME_FAILED' : 'RUNTIME_TIMEOUT'
    try { await terminate(run) }
    catch (error) { state = 'failed'; throw error }
    if (state !== 'stopping') state = 'failed'
    throw runtimeError(code)
  }

  function start() {
    if (stopping) return stopping.then(() => start())
    if (starting) return starting
    if (state === 'running') return Promise.resolve()
    starting = launch().finally(() => { starting = null })
    return starting
  }

  function stop() {
    if (stopping) return stopping
    if (state === 'stopped') return Promise.resolve()
    state = 'stopping'
    const run = current
    stopping = (async () => {
      try {
        if (run) await terminate(run)
        await starting?.catch(() => {})
        current = null
        state = 'stopped'
      } catch (error) { state = 'failed'; throw error }
    })().finally(() => { stopping = null })
    return stopping
  }

  async function health() {
    if (state !== 'running') return { ok: false, state }
    const run = current
    const ok = await probe(2000)
    return { ok: ok && current === run && state === 'running' && !run.exited && !run.failed, state }
  }

  return { id, start, stop, health, state: () => state,
    processId: () => current && !current.exited && !current.done ? current.child.pid ?? null : null }
}

module.exports = { createManagedRuntime }
