const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { detectLocalWindow } = require('../electron/local-window.cjs')
const { reportedWindow } = require('../electron/model-window.cjs')
const { createProviderService } = require('../electron/provider-service.cjs')
const { tierOf } = require('../electron/context-tier.cjs')


test('llama.cpp /props and LM Studio loaded_context_length give the window the server really runs with', async () => {
  const asked = []
  const llama = await detectLocalWindow({ baseUrl: 'http://127.0.0.1:8080/v1', fetchImpl: async url => { asked.push(url); return String(url).endsWith('/props') ? new Response(JSON.stringify({ default_generation_settings: { n_ctx: 16384 } })) : new Response('{}', { status: 404 }) } })
  assert.equal(llama.default, 16384); assert.ok(asked.includes('http://127.0.0.1:8080/props'), 'the root of the server is asked, not /v1/props')
  const studio = await detectLocalWindow({ baseUrl: 'http://127.0.0.1:1234/v1', fetchImpl: async url => String(url).endsWith('/api/v0/models') ? new Response(JSON.stringify({ data: [{ id: 'qwen-35b', loaded_context_length: 12000 }, { id: 'other', max_context_length: 99999 }] })) : new Response('{}', { status: 404 }) })
  assert.deepEqual({ ...studio, models: { ...studio.models } }, { default: null, models: { 'qwen-35b': 12000 } })
  const down = await detectLocalWindow({ baseUrl: 'http://127.0.0.1:1/v1', fetchImpl: async () => { throw new Error('down') } })
  assert.deepEqual({ ...down, models: { ...down.models } }, { default: null, models: {} })
  assert.equal(reportedWindow({ max_model_len: 32768 }), 32768, 'vLLM reports max_model_len in its list')
})

test('a local server on a 16k window is lean before the first run, with no model list opened', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'najd-window-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const service = createProviderService({ directory: root, encryption: { isAsyncEncryptionAvailable: async () => true, encryptStringAsync: async value => Buffer.from(value), decryptStringAsync: async value => ({ result: value.toString() }) },
    chatGPT: { status: async () => ({ signedIn: false }) }, ollama: { listModels: async () => [] }, clientFactory: () => ({ listModels: async () => [{ id: 'qwen3-35b', label: 'qwen3-35b' }], chat: async () => ({ kind: 'message', text: 'x' }) }),
    localFetch: async url => (String(url).endsWith('/props') ? new Response(JSON.stringify({ default_generation_settings: { n_ctx: 16384 } })) : new Response('{}', { status: 404 })) })
  t.after(() => service.dispose())
  assert.equal(tierOf(service.inputBudget('llamacpp', 'qwen3-35b')).lean, false, 'unknown window: the full setup')
  await service.ensureWindow('llamacpp', 'qwen3-35b')
  assert.equal(service.inputBudget('llamacpp', 'qwen3-35b'), 16384 * 3)
  assert.equal(tierOf(service.inputBudget('llamacpp', 'qwen3-35b')).lean, true)
  const models = await service.models('llamacpp')
  assert.equal(models[0].contextWindow, 16384, 'the model list carries the real window too')
  await service.ensureWindow('openai-api', 'gpt-x'); await service.ensureWindow('ollama', 'x'); await service.ensureWindow(undefined, undefined) // never throws for other providers
})

test('a union on a local aggregator probes it, and a changed address drops what was learned about the old one', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'najd-window-union-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const asked = []
  let nCtx = 16384
  const service = createProviderService({ directory: root, encryption: { isAsyncEncryptionAvailable: async () => true, encryptStringAsync: async value => Buffer.from(value), decryptStringAsync: async value => ({ result: value.toString() }) },
    chatGPT: { status: async () => ({ signedIn: false }) }, ollama: { listModels: async () => [] }, clientFactory: () => ({ listModels: async () => [{ id: 'q', label: 'q' }], chat: async () => ({ kind: 'message', text: 'x' }) }),
    localFetch: async url => { asked.push(String(url)); return String(url).endsWith('/props') ? new Response(JSON.stringify({ default_generation_settings: { n_ctx: nCtx } })) : new Response('{}', { status: 404 }) } })
  t.after(() => service.dispose())
  await service.unions.save({ default: 'local', presets: { local: { enabled: true, references: [], aggregator: { provider: 'llamacpp', model: 'q' } } } })
  await service.ensureWindow('union', 'local')
  assert.equal(service.inputBudget('union', 'local'), Math.floor(16384 * 3 * 0.8), 'the union uses its local aggregator window (80%, the rest is kept for the advice)')
  assert.ok(asked.some(url => url.endsWith('/props')))
  await service.setEndpoint('llamacpp', 'http://127.0.0.1:8099/v1')
  nCtx = 4096
  assert.notEqual(service.inputBudget('llamacpp', 'q'), 16384 * 3, 'the old address window is forgotten when the address changes')
  await service.ensureWindow('llamacpp', 'q')
  assert.equal(service.inputBudget('llamacpp', 'q'), 4096 * 3, 'and the new address is probed at once')
})

test('a run that starts while the window probe is still going waits for it, and an answer from a changed address is never published', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'najd-window-race-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  let release
  const gate = new Promise(resolve => { release = resolve })
  const service = createProviderService({ directory: root, encryption: { isAsyncEncryptionAvailable: async () => true, encryptStringAsync: async value => Buffer.from(value), decryptStringAsync: async value => ({ result: value.toString() }) },
    chatGPT: { status: async () => ({ signedIn: false }) }, ollama: { listModels: async () => [] }, clientFactory: () => ({ listModels: async () => [{ id: 'q', label: 'q' }], chat: async () => ({ kind: 'message', text: 'x' }) }),
    localFetch: async url => { await gate; return String(url).endsWith('/props') ? new Response(JSON.stringify({ default_generation_settings: { n_ctx: 16384 } })) : new Response('{}', { status: 404 }) } })
  t.after(() => service.dispose())
  const first = service.ensureWindow('llamacpp', 'q'), second = service.ensureWindow('llamacpp', 'q')
  let secondDone = false
  void second.then(() => { secondDone = true })
  await new Promise(resolve => setTimeout(resolve, 30))
  assert.equal(secondDone, false, 'the second run is still waiting for the same probe')
  release(); await Promise.all([first, second])
  assert.equal(service.inputBudget('llamacpp', 'q'), 16384 * 3)
  // An answer that arrives after the address changed is dropped.
  const root2 = await fs.mkdtemp(path.join(os.tmpdir(), 'najd-window-race2-'))
  t.after(() => fs.rm(root2, { recursive: true, force: true }))
  let release2
  const gate2 = new Promise(resolve => { release2 = resolve })
  const other = createProviderService({ directory: root2, encryption: { isAsyncEncryptionAvailable: async () => true, encryptStringAsync: async value => Buffer.from(value), decryptStringAsync: async value => ({ result: value.toString() }) },
    chatGPT: { status: async () => ({ signedIn: false }) }, ollama: { listModels: async () => [] }, clientFactory: () => ({ listModels: async () => [{ id: 'q', label: 'q' }], chat: async () => ({ kind: 'message', text: 'x' }) }),
    localFetch: async () => { await gate2; return new Response(JSON.stringify({ default_generation_settings: { n_ctx: 131072 } })) } })
  t.after(() => other.dispose())
  const stale = other.ensureWindow('llamacpp', 'q')
  await other.setEndpoint('llamacpp', 'http://127.0.0.1:8123/v1')
  release2(); await stale
  assert.notEqual(other.inputBudget('llamacpp', 'q'), 131072 * 3, 'the old address answer was not published')
})

test('what a running server reported is not replaced by a later list whose probes failed', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'najd-window-observed-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  let answer = true
  const service = createProviderService({ directory: root, encryption: { isAsyncEncryptionAvailable: async () => true, encryptStringAsync: async value => Buffer.from(value), decryptStringAsync: async value => ({ result: value.toString() }) },
    chatGPT: { status: async () => ({ signedIn: false }) }, ollama: { listModels: async () => [] },
    clientFactory: () => ({ listModels: async () => [{ id: 'q', label: 'q', contextWindow: 131072 }], chat: async () => ({ kind: 'message', text: 'x' }) }),
    localFetch: async url => (answer && String(url).endsWith('/props') ? new Response(JSON.stringify({ default_generation_settings: { n_ctx: 16384 } })) : new Response('{}', { status: 500 })) })
  t.after(() => service.dispose())
  await service.ensureWindow('llamacpp', 'q')
  assert.equal(service.inputBudget('llamacpp', 'q'), 16384 * 3)
  answer = false
  const models = await service.models('llamacpp')
  assert.equal(models[0].contextWindow, 16384, 'the list shows the observed window, not the advertised 131072')
  assert.equal(service.inputBudget('llamacpp', 'q'), 16384 * 3, 'and the budget keeps it')
})

test('the window reported to the side panel and the run receipts is the observed one, like the budget', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'najd-window-report-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  let nCtx = 131072
  const service = createProviderService({ directory: root, encryption: { isAsyncEncryptionAvailable: async () => true, encryptStringAsync: async value => Buffer.from(value), decryptStringAsync: async value => ({ result: value.toString() }) },
    chatGPT: { status: async () => ({ signedIn: false }) }, ollama: { listModels: async () => [] },
    clientFactory: () => ({ listModels: async () => [{ id: 'q', label: 'q', contextWindow: 131072 }], chat: async () => ({ kind: 'message', text: 'x' }) }),
    localFetch: async url => (String(url).endsWith('/props') ? new Response(JSON.stringify({ default_generation_settings: { n_ctx: nCtx } })) : new Response('{}', { status: 404 })) })
  t.after(() => service.dispose())
  await service.ensureWindow('llamacpp', 'q')
  assert.equal(service.contextWindow('llamacpp', 'q'), 131072, 'observed before any list was opened')
  await service.models('llamacpp')
  nCtx = 16384
  const clock = Date.now
  Date.now = () => clock() + 120000 // the next run asks the server again after a minute
  t.after(() => { Date.now = clock })
  await service.ensureWindow('llamacpp', 'q')
  assert.equal(service.contextWindow('llamacpp', 'q'), 16384, 'a restart of the server at a smaller window is reported at once')
  assert.equal(service.inputBudget('llamacpp', 'q'), 16384 * 3)
})

test('a server that reports its window only in its model list (vLLM) is read at run time, and again when the probe expires', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'najd-window-vllm-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  let listed = 8192
  const service = createProviderService({ directory: root, encryption: { isAsyncEncryptionAvailable: async () => true, encryptStringAsync: async value => Buffer.from(value), decryptStringAsync: async value => ({ result: value.toString() }) },
    chatGPT: { status: async () => ({ signedIn: false }) }, ollama: { listModels: async () => [] },
    clientFactory: () => ({ listModels: async () => [{ id: 'm', label: 'm', contextWindow: listed }], chat: async () => ({ kind: 'message', text: 'x' }) }),
    localFetch: async () => new Response('{}', { status: 404 }) })
  t.after(() => service.dispose())
  assert.equal(service.inputBudget('vllm', 'm'), 64000 * 3, 'nothing is known before the first run')
  await service.ensureWindow('vllm', 'm')
  assert.equal(service.inputBudget('vllm', 'm'), 8192 * 3, 'the first run learns the window from the model list without anyone opening it')
  listed = 4096
  const clock = Date.now
  Date.now = () => clock() + 120000
  t.after(() => { Date.now = clock })
  await service.ensureWindow('vllm', 'm')
  assert.equal(service.inputBudget('vllm', 'm'), 4096 * 3, 'a restart at a smaller window is picked up when the probe expires')
})

const makeService = async (t, over) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'najd-window-more-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const service = createProviderService({ directory: root, encryption: { isAsyncEncryptionAvailable: async () => true, encryptStringAsync: async value => Buffer.from(value), decryptStringAsync: async value => ({ result: value.toString() }) },
    chatGPT: { status: async () => ({ signedIn: false }) }, ollama: { listModels: async () => [] }, ...over })
  t.after(() => service.dispose())
  return service
}

test('a local server that asks for a key is probed with the saved key, and only that key', async t => {
  const seen = []
  const service = await makeService(t, { clientFactory: () => ({ listModels: async () => [{ id: 'q', label: 'q' }], chat: async () => ({ kind: 'message', text: 'x' }) }),
    localFetch: async (url, init) => { seen.push(init?.headers?.authorization || null); return init?.headers?.authorization === 'Bearer local-secret-key' && String(url).endsWith('/props') ? new Response(JSON.stringify({ default_generation_settings: { n_ctx: 16384 } })) : new Response('{}', { status: 401 }) } })
  await service.ensureWindow('llamacpp', 'q')
  assert.equal(service.inputBudget('llamacpp', 'q'), 64000 * 3, 'without a saved key the server refuses and nothing is learned')
  await service.saveKey('llamacpp', 'local-secret-key')
  const clock = Date.now
  Date.now = () => clock() + 120000
  t.after(() => { Date.now = clock })
  await service.ensureWindow('llamacpp', 'q')
  assert.equal(service.inputBudget('llamacpp', 'q'), 16384 * 3, 'with the key the authenticated /props answers')
  assert.ok(seen.every(header => header === null || header === 'Bearer local-secret-key'))
})

test('an address change while the model-list fallback is pending leaves no freshness behind, so the next run asks the new address', async t => {
  let release, calls = 0
  const gate = new Promise(resolve => { release = resolve })
  const service = await makeService(t, { clientFactory: () => ({ listModels: async () => { calls++; if (calls === 1) await gate; return [{ id: 'm', label: 'm', contextWindow: calls === 1 ? 131072 : 4096 }] }, chat: async () => ({ kind: 'message', text: 'x' }) }),
    localFetch: async () => new Response('{}', { status: 404 }) })
  const first = service.ensureWindow('vllm', 'm')
  await new Promise(resolve => setTimeout(resolve, 30))
  await service.setEndpoint('vllm', 'http://127.0.0.1:8124/v1')
  release(); await first
  assert.equal(service.inputBudget('vllm', 'm'), 64000 * 3, 'the answer of the old address was not published')
  await service.ensureWindow('vllm', 'm')
  assert.equal(service.inputBudget('vllm', 'm'), 4096 * 3, 'and the next run asked the new address at once')
})

test('a probe answer larger than the limit is dropped without being parsed, and the model entries are bounded', async () => {
  const huge = JSON.stringify({ default_generation_settings: { n_ctx: 16384 }, pad: 'x'.repeat(400 * 1024) })
  const big = await detectLocalWindow({ baseUrl: 'http://127.0.0.1:8080/v1', fetchImpl: async url => (String(url).endsWith('/props') ? new Response(huge) : new Response('{}', { status: 404 })) })
  assert.deepEqual({ ...big, models: { ...big.models } }, { default: null, models: {} }, 'an oversize /props says nothing instead of exhausting memory')
  const many = { data: Array.from({ length: 2000 }, (_, i) => ({ id: 'm' + i, loaded_context_length: 8192 })) }
  const studio = await detectLocalWindow({ baseUrl: 'http://127.0.0.1:1234/v1', fetchImpl: async url => (String(url).endsWith('/api/v0/models') ? new Response(JSON.stringify(many)) : new Response('{}', { status: 404 })) })
  assert.ok(Object.keys(studio.models).length <= 500 && studio.models.m0 === 8192)
})

test('changing or clearing the key forgets the window at once, and an answer that was on its way under the old key is dropped', async t => {
  let release, asked = 0, key = null
  const gate = new Promise(resolve => { release = resolve })
  const service = await makeService(t, { clientFactory: () => ({ listModels: async () => [{ id: 'q', label: 'q' }], chat: async () => ({ kind: 'message', text: 'x' }) }),
    localFetch: async (url, init) => { asked++; if (asked === 1) await gate; key = init?.headers?.authorization || null; return String(url).endsWith('/props') ? new Response(JSON.stringify({ default_generation_settings: { n_ctx: key ? 16384 : 8192 } })) : new Response('{}', { status: 404 }) } })
  await service.saveKey('llamacpp', 'first-local-key')
  const slow = service.ensureWindow('llamacpp', 'q')
  await new Promise(resolve => setTimeout(resolve, 30))
  await service.saveKey('llamacpp', 'second-local-key')
  release(); await slow
  assert.equal(service.inputBudget('llamacpp', 'q'), 64000 * 3, 'the answer given under the old key was not published')
  await service.ensureWindow('llamacpp', 'q')
  assert.equal(service.inputBudget('llamacpp', 'q'), 16384 * 3)
  await service.clearKey('llamacpp')
  assert.equal(service.inputBudget('llamacpp', 'q'), 64000 * 3, 'clearing the key forgets what was learned with it, immediately')
})

test('model names that are also names of inherited properties never become a window', async t => {
  const names = ['constructor', 'toString', '__proto__', 'hasOwnProperty']
  const service = await makeService(t, { clientFactory: () => ({ listModels: async () => names.map(id => ({ id, label: id })), chat: async () => ({ kind: 'message', text: 'x' }) }),
    localFetch: async url => (String(url).endsWith('/api/v0/models') ? new Response(JSON.stringify({ data: [{ id: 'real', loaded_context_length: 8192 }] })) : new Response('{}', { status: 404 })) })
  for (const name of names) {
    await service.ensureWindow('lmstudio', name)
    const budget = service.inputBudget('lmstudio', name)
    assert.ok(Number.isFinite(budget) && budget === 64000 * 3, name + ': a plain unknown window, never a function')
  }
  const listed = await service.models('lmstudio')
  assert.ok(listed.every(model => model.contextWindow === null || Number.isFinite(model.contextWindow)), 'what crosses to the window is always a number or null')
})
