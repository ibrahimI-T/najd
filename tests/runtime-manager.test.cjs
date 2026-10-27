const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const http = require('node:http')
const net = require('node:net')
const { execPath } = require('node:process')
const { createManagedRuntime } = require('../electron/runtime-manager.cjs')

const stubServer = path.join(__dirname, 'fixtures', 'runtime-stub.cjs')

async function freePort() {
  const server = net.createServer()
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const port = server.address().port
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  return port
}

async function tempDir(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'najd-runtime-test-'))
  t.after(async () => {
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unsafe test cleanup path')
    await fs.rm(root, { recursive: true, force: true })
  })
  return root
}

test('runtime starts, reports running after readiness, and stops cleanly', async t => {
  const root = await tempDir(t)
  const port = await freePort()
  const runtime = createManagedRuntime({
    id: 'stub', command: execPath, args: [stubServer, String(port)],
    env: { STUB_ROOT: root }, readinessUrl: `http://127.0.0.1:${port}/healthz`, readyTimeoutMs: 8000, stopTimeoutMs: 4000
  })
  t.after(() => runtime.stop().catch(() => {}))
  assert.equal(runtime.state(), 'stopped')
  await runtime.start()
  assert.equal(runtime.state(), 'running')
  const health = await runtime.health()
  assert.equal(health.ok, true)
  await runtime.stop()
  assert.equal(runtime.state(), 'stopped')
})

test('start is idempotent and stop on a stopped runtime is a no-op', async t => {
  const root = await tempDir(t)
  const port = await freePort()
  const runtime = createManagedRuntime({
    id: 'stub', command: execPath, args: [stubServer, String(port)],
    env: { STUB_ROOT: root }, readinessUrl: `http://127.0.0.1:${port}/healthz`
  })
  t.after(() => runtime.stop().catch(() => {}))
  await runtime.stop()
  await runtime.start()
  await runtime.start()
  assert.equal(runtime.state(), 'running')
  await runtime.stop()
  await runtime.stop()
  assert.equal(runtime.state(), 'stopped')
})

test('a process that exits before readiness fails the runtime and is not restarted', async t => {
  const runtime = createManagedRuntime({
    id: 'stub', command: execPath, args: ['-e', 'setTimeout(() => process.exit(1), 100)'],
    readinessUrl: 'http://127.0.0.1:9/healthz', readyTimeoutMs: 120000
  })
  const started = Date.now()
  await assert.rejects(runtime.start(), { code: 'RUNTIME_FAILED' })
  assert.equal(runtime.state(), 'failed')
  // The long cold-start window (gateway: 120 s) never delays reporting a process that died.
  assert.ok(Date.now() - started < 10000, 'an exited process fails at once, not at the readiness deadline')
})

test('a process that never becomes ready is killed after the timeout', async t => {
  const root = await tempDir(t)
  const port = await freePort()
  const runtime = createManagedRuntime({
    id: 'stub', command: execPath, args: [stubServer, String(port), 'no-ready'],
    env: { STUB_ROOT: root }, readinessUrl: `http://127.0.0.1:${port}/healthz`, readyTimeoutMs: 800
  })
  await assert.rejects(runtime.start(), { code: 'RUNTIME_TIMEOUT' })
  assert.equal(runtime.state(), 'failed')
})

test('a runtime that dies while running is observed and restart recovers it', async t => {
  const root = await tempDir(t)
  const port = await freePort()
  const runtime = createManagedRuntime({
    id: 'stub', command: execPath, args: [stubServer, String(port)],
    env: { STUB_ROOT: root }, readinessUrl: `http://127.0.0.1:${port}/healthz`
  })
  t.after(() => runtime.stop().catch(() => {}))
  await runtime.start()
  await fetch(`http://127.0.0.1:${port}/die`).catch(() => {})
  await new Promise(resolve => setTimeout(resolve, 400))
  assert.equal(runtime.state(), 'failed')
  await runtime.start()
  assert.equal(runtime.state(), 'running')
})

test('spawn errors and invalid configuration fail closed', async t => {
  assert.throws(() => createManagedRuntime({ id: 'x', command: '' }), { code: 'INVALID_INPUT' })
  const runtime = createManagedRuntime({ id: 'x', command: 'definitely-not-a-real-binary-xyz', readinessUrl: 'http://127.0.0.1:9/' })
  await assert.rejects(runtime.start(), { code: 'RUNTIME_FAILED' })
  assert.equal(runtime.state(), 'failed')
  await runtime.stop()
  assert.equal(runtime.state(), 'stopped')
})

test('concurrent starts share readiness and concurrent stops share termination', async t => {
  const port = await freePort()
  const runtime = createManagedRuntime({
    id: 'stub', command: execPath, args: [stubServer, String(port)],
    readinessUrl: `http://127.0.0.1:${port}/healthz`
  })
  t.after(() => runtime.stop())
  const first = runtime.start()
  assert.equal(runtime.start(), first)
  await first
  const stop = runtime.stop()
  assert.equal(runtime.stop(), stop)
  await stop
  await assert.rejects(fetch(`http://127.0.0.1:${port}/healthz`))
  await runtime.start()
  assert.equal((await runtime.health()).ok, true)
})

test('stop during startup cancels readiness without leaving a failed or running engine', async t => {
  const runtime = createManagedRuntime({
    id: 'stub', command: execPath, args: ['-e', 'setInterval(() => {}, 1000)'],
    readinessUrl: 'http://127.0.0.1:9/healthz', readyTimeoutMs: 8000
  })
  t.after(() => runtime.stop())
  const started = assert.rejects(runtime.start(), { code: 'RUNTIME_CANCELLED' })
  await runtime.stop()
  await started
  assert.equal(runtime.state(), 'stopped')
  assert.deepEqual(await runtime.health(), { ok: false, state: 'stopped' })
})

test('start requested during stop waits for termination before restarting', async t => {
  const port = await freePort()
  const runtime = createManagedRuntime({
    id: 'stub', command: execPath, args: [stubServer, String(port)],
    readinessUrl: `http://127.0.0.1:${port}/healthz`
  })
  t.after(() => runtime.stop())
  await runtime.start()
  const stopped = runtime.stop()
  const restarted = runtime.start()
  await stopped
  await restarted
  assert.equal((await runtime.health()).ok, true)
})

test('configuration rejects missing, remote, credential-bearing URLs and invalid bounds', () => {
  const base = { id: 'stub', command: execPath, readinessUrl: 'http://127.0.0.1:9/' }
  for (const readinessUrl of [undefined, 'http://example.com/', 'file:///tmp/a', 'http://user:secret@127.0.0.1/', 'http://127.0.0.1/#fragment']) {
    assert.throws(() => createManagedRuntime({ ...base, readinessUrl }), { code: 'INVALID_INPUT' })
  }
  for (const options of [{ readyTimeoutMs: 0 }, { stopTimeoutMs: Infinity }, { pollIntervalMs: -1 }, { args: 'shell command' }]) {
    assert.throws(() => createManagedRuntime({ ...base, ...options }), { code: 'INVALID_INPUT' })
  }
})

test('an occupied readiness port fails startup and leaves the existing listener intact', async t => {
  const listener = http.createServer((_request, response) => {
    response.writeHead(503); response.end('occupied fixture')
  })
  await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => listener.close(resolve)))
  const port = listener.address().port
  const runtime = createManagedRuntime({
    id: 'stub', command: execPath, args: [stubServer, String(port)],
    readinessUrl: `http://127.0.0.1:${port}/healthz`, readyTimeoutMs: 3000
  })
  t.after(() => runtime.stop())
  await assert.rejects(runtime.start(), { code: 'RUNTIME_FAILED' })
  assert.equal(runtime.state(), 'failed')
  assert.equal((await fetch(`http://127.0.0.1:${port}/healthz`)).status, 503)
})

test('private IPC shutdown waits for the owned server to close', async t => {
  const port = await freePort()
  const runtime = createManagedRuntime({ id: 'stub', command: execPath,
    args: [stubServer, String(port)], readinessUrl: `http://127.0.0.1:${port}/healthz`, ipcShutdown: true })
  t.after(() => runtime.stop())
  await runtime.start()
  await runtime.stop()
  assert.equal(runtime.state(), 'stopped')
  await assert.rejects(fetch(`http://127.0.0.1:${port}/healthz`))
})

test('Windows forced shutdown terminates a non-cooperative owned process tree', { skip: process.platform !== 'win32' }, async t => {
  const root = await tempDir(t)
  const port = await freePort()
  const runtime = createManagedRuntime({ id: 'stub', command: execPath,
    args: [stubServer, String(port), 'ignore-shutdown'], env: { STUB_ROOT: root },
    readinessUrl: `http://127.0.0.1:${port}/healthz`, ipcShutdown: true, stopTimeoutMs: 1000 })
  t.after(() => runtime.stop())
  await runtime.start()
  let descendant
  for (let attempt = 0; attempt < 30; attempt++) {
    try { descendant = JSON.parse(await fs.readFile(path.join(root, 'descendant.json'), 'utf8')); break }
    catch { await new Promise(resolve => setTimeout(resolve, 100)) }
  }
  assert.ok(descendant?.port)
  await runtime.stop()
  assert.equal(runtime.state(), 'stopped')
  await assert.rejects(fetch(`http://127.0.0.1:${port}/healthz`))
  await assert.rejects(fetch(`http://127.0.0.1:${descendant.port}/healthz`))
})
