const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { createHermesAdapter } = require('../electron/hermes.cjs')
const os = require('node:os')
const root = path.resolve(__dirname, '..')
const request = { provider: 'ollama', modelName: 'qwen2.5:1.5b', text: 'Reply only with 42.' }

async function main() {
  const stateRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'najd-hermes-lifecycle-'))
  let calls = 0, entered, blocked = false, failed = false
  const adapter = createHermesAdapter({ root, stateRoot, getCore: async () => process.env.NAJD_SMOKE_CORE || null, timeoutMs: 45000, chat: async ({ history, signal, systemPrompt }) => {
    calls++
    assert.ok(systemPrompt.includes('Hermes'))
    assert.ok(systemPrompt.includes('NAJD'))
    assert.equal(history.at(-1).text, request.text)
    entered?.()
    if (blocked) await new Promise((resolve, reject) => {
      if (signal.aborted) reject(Object.assign(new Error(), { code: 'CANCELLED' }))
      else signal.addEventListener('abort', () => reject(Object.assign(new Error(), { code: 'CANCELLED' })), { once: true })
    })
    if (failed) throw Object.assign(new Error('synthetic private diagnostic'), { code: 'MODEL_NOT_FOUND' })
    return { kind: 'message', text: '42' }
  } })
  try {
    await assert.rejects(adapter.run({ ...request, provider: 'chatgpt' }), { code: 'TOOLS_NOT_SUPPORTED' })
    assert.equal(calls, 0)
    assert.equal((await adapter.run(request)).text, '42')
    assert.equal(adapter.status().state, 'stopped')
    assert.equal(adapter.status().runtimeVersion, '3.14.7')
    assert.equal(adapter.status().instanceId, null)
    assert.equal(calls, 1)
    console.log('PASS: real Hermes imports/init/tool-free turn/SDK broker/normal exit; no provider fallback.')
    blocked = true
    let reached = new Promise(resolve => { entered = resolve })
    const controller = new AbortController()
    const active = adapter.run({ ...request, signal: controller.signal })
    const cancelled = assert.rejects(active, { code: 'CANCELLED' })
    await reached
    assert.equal(adapter.status().state, 'healthy')
    await assert.rejects(adapter.run(request), { code: 'PROVIDER_BUSY' })
    controller.abort()
    await cancelled
    assert.equal(adapter.status().state, 'failed')
    assert.equal(calls, 2)
    console.log('PASS: one active lease, cancellation aborts provider and worker, no repeated inference.')
    reached = new Promise(resolve => { entered = resolve })
    const stopped = adapter.run(request)
    const stoppedCheck = assert.rejects(stopped)
    await reached
    await adapter.stop()
    await stoppedCheck
    blocked = false; failed = true; entered = null
    await assert.rejects(adapter.run(request), { code: 'MODEL_NOT_FOUND' })
    assert.equal(calls, 4)
    failed = false
    assert.equal((await adapter.run(request)).text, '42')
    assert.equal(calls, 5)
    const fast = createHermesAdapter({ root, stateRoot, getCore: async () => process.env.NAJD_SMOKE_CORE || null, timeoutMs: 1, chat: async () => { throw new Error('must not dispatch') } })
    await assert.rejects(fast.run(request), { code: 'RUNTIME_TIMEOUT' })
    await fast.stop()
    assert.deepEqual(await fs.readdir(stateRoot), [])
    console.log('PASS: stop/error/restart/timeout; all owned task profiles removed after process exit.')
  } finally { await adapter.stop(); await fs.rm(stateRoot, { recursive: true, force: true }) }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
