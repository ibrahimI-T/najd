// Regression tests for the review of agent platform M1 (APR-001..008).
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { createAgentRuntime } = require('../electron/agent-runtime.cjs')
const { createAgentCatalog } = require('../electron/agent-catalog.cjs')
const { createRunReceipts } = require('../electron/run-receipts.cjs')
const { createConversationOutputs } = require('../electron/conversation-outputs.cjs')
const { createMediaGeneration } = require('../electron/media-generation.cjs')

const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'najd-apr-'))
const call = (name, args, id) => ({ kind: 'agent-tools', calls: [{ name, arguments: JSON.stringify(args), call_id: id }],
  items: [{ type: 'function_call', name, arguments: JSON.stringify(args), call_id: id }] })
const library = { list: async () => [], read: async () => ({ text: '' }), search: async () => [] }

test('APR-001: a video started from chat is bound to the conversation of the run', async () => {
  let seen = null
  const media = { services: async () => ['openai-video'], describe: { image: 'i', video: 'v' },
    startVideo: async (_args, options) => { seen = options.conversationId; return { status: 'queued', jobId: 'video_9' } } }
  const runtime = createAgentRuntime({ catalog: { search: async () => [], details: async () => ({}) }, library, media })
  let turn = 0
  await runtime.run({ request: { text: 'ولد فيديو قصير عن الصحراء', conversationId: 'conv-video' }, requestApproval: async () => 'ALLOW_ONCE',
    respond: async () => turn++ === 0 ? call('najd_video_generate', { prompt: 'desert', seconds: '4', size: '1280x720' }, 'v1') : { kind: 'message', text: 'started' } })
  assert.equal(seen, 'conv-video')
})

test('APR-002: cancelling during a sub-agent keeps the parent receipt and adds the child usage once', async () => {
  const controller = new AbortController()
  const workspace = { describe: () => ({ workspace: 'C:/w', grantedFolders: [] }), run: async () => ({ entries: [] }) }
  const runtime = createAgentRuntime({ catalog: { search: async () => [], details: async () => ({}) }, library, workspace,
    web: { available: async () => true, search: async () => ({ results: [] }), extract: async () => ({}) } })
  let parent = 0
  const failure = await runtime.run({ signal: controller.signal, request: { text: 'ابحث وقارن بين الخيارات' }, respond: async request => {
    if (request.isolated) { controller.abort(); return { kind: 'message', text: 'child', usage: { input: 7, output: 1, total: 8 } } }
    if (parent++ === 0) return { ...call('najd_delegate', { task: 'look', context: '', background: false }, 'p1'), usage: { input: 100, output: 5, total: 105 } }
    return { kind: 'message', text: 'unreachable' }
  } }).catch(error => error)
  assert.equal(failure.code, 'CANCELLED')
  assert.equal(failure.receipt.profile, 'research')
  assert.equal(failure.receipt.usage.total, 113)
  assert.equal(failure.receipt.usage.modelCalls, 2)
})

test('APR-003: cancellation and failed jobs are stored and never fetched again', async () => {
  const dir = temp(), jobs = createConversationOutputs({ filePath: path.join(dir, 'outputs.json') })
  let statusReads = 0
  const fetchImpl = async (url, init) => {
    if (init?.method === 'POST') return new Response(JSON.stringify({ id: String(url).includes('x') ? 'v' : 'video_f', status: 'queued' }))
    if (init?.method === 'DELETE') return new Response('{}')
    statusReads++
    return new Response(JSON.stringify({ id: 'video_f', status: 'failed' }))
  }
  const media = createMediaGeneration({ getOpenAIKey: async () => 'sk-test', workspace: dir, jobs, fetchImpl, saveToLibrary: async () => null })
  await media.startVideo({ prompt: 'p', seconds: '4', size: '1280x720' }, { requestApproval: async () => 'ALLOW_ONCE', conversationId: 'conv-j' })
  assert.equal((await media.videoStatus({ jobId: 'video_f', prompt: '' }, {})).status, 'failed')
  assert.equal((await media.videoStatus({ jobId: 'video_f', prompt: '' }, {})).status, 'failed')
  assert.equal(statusReads, 1)
  await jobs.putJob({ jobId: 'video_c', conversationId: 'conv-j', state: 'queued' })
  await media.cancelVideo({ jobId: 'video_c' }, {})
  assert.equal((await jobs.getJob('video_c')).state, 'cancelled')
  assert.deepEqual((await jobs.activeJobs()).map(job => job.jobId), [])
})

test('APR-006: concurrent first writes to both stores are all kept', async () => {
  const dir = temp()
  const receipts = createRunReceipts({ filePath: path.join(dir, 'receipts.json') })
  const outputs = createConversationOutputs({ filePath: path.join(dir, 'outputs.json') })
  const receipt = { outcome: 'completed', profile: 'general', toolsets: [], toolCalls: 0, usage: { input: 1, output: 1, total: 2, cached: null, modelCalls: 1 } }
  await Promise.all([
    ...Array.from({ length: 8 }, (_, index) => receipts.record({ runId: 'run-' + index, conversationId: 'conv-c', receipt })),
    ...Array.from({ length: 8 }, (_, index) => outputs.addOutput({ conversationId: 'conv-c', runId: 'run-' + index, kind: 'file', path: 'C:/w/' + index + '.txt' })),
    ...Array.from({ length: 4 }, (_, index) => outputs.putJob({ jobId: 'job_' + index, conversationId: 'conv-c', state: 'queued' }))
  ])
  const again = createRunReceipts({ filePath: path.join(dir, 'receipts.json') }), againOutputs = createConversationOutputs({ filePath: path.join(dir, 'outputs.json') })
  assert.equal((await again.list('conv-c')).length, 8)
  assert.equal((await againOutputs.outputs('conv-c')).length, 8)
  assert.equal((await againOutputs.jobs('conv-c')).length, 4)
})

test('APR-008: profiles name their ready skill guides, and search says which toolset provides a capability', async () => {
  const instructions = [{ id: 'systematic-debugging', name: 'Systematic debugging', description: 'Debug failures step by step', enabled: true, source: 'hermes' },
    { id: 'poem-writing', name: 'Poems', description: 'Write poems', enabled: true, source: 'hermes' }]
  const catalog = createAgentCatalog({ registry: { list: async () => [] }, connectors: { list: () => [] }, getTools: async () => [
    { id: 'najd-terminal-run', title: 'najd_terminal_run', description: 'Run one PowerShell command', enabled: true, ready: true, effect: 'approval' }],
  getSkills: async () => instructions })
  const found = await catalog.search('powershell')
  assert.equal(found[0].toolset, 'terminal')
  assert.equal((await catalog.search('debugging'))[0].toolset, 'skills')
  const runtime = createAgentRuntime({ catalog, library, skills: { read: async () => ({ text: 'guide' }) } })
  await runtime.run({ request: { text: 'fix this bug in my code' }, respond: async request => {
    assert.match(request.instructions, /Active profile: Coding/)
    assert.match(request.instructions, /systematic-debugging \(Systematic debugging\)/)
    assert.doesNotMatch(request.instructions, /poem-writing/)
    return { kind: 'message', text: 'ok' }
  } })
})

test('APR-009: a call that was sent but never answered still counts, and the totals become partial', async () => {
  const runtime = createAgentRuntime({ catalog: { search: async () => [] }, library })
  let turn = 0
  const failure = await runtime.run({ request: { text: 'hello' }, respond: async () => {
    if (turn++ === 0) return { ...call('najd_capabilities_search', { query: 'x' }, 'c1'), usage: { input: 100, output: 5, total: 105 } }
    throw Object.assign(new Error('PROVIDER_TIMEOUT'), { code: 'PROVIDER_TIMEOUT' })
  } }).catch(error => error)
  assert.equal(failure.receipt.usage.modelCalls, 2)
  assert.equal(failure.receipt.usage.total, 105)
  assert.equal(failure.receipt.usage.partial, true)
})

test('APR-010/013/015: unknown totals stay null, failed writes are not treated as saved, deletion removes records', async () => {
  const dir = temp()
  const store = createRunReceipts({ filePath: path.join(dir, 'receipts.json') })
  const unknown = { outcome: 'completed', profile: 'general', toolsets: [], toolCalls: 0, usage: { input: null, output: null, total: null, cached: null, modelCalls: 1 } }
  await store.record({ runId: 'run-a', conversationId: 'conv-n', receipt: unknown })
  const totals = await store.totals('conv-n')
  assert.equal(totals.total, null); assert.equal(totals.input, null); assert.equal(totals.partial, true)
  // A store whose parent "directory" is a file cannot write: nothing is committed, so a retry is still possible.
  fs.writeFileSync(path.join(dir, 'blocker'), 'x')
  const broken = createRunReceipts({ filePath: path.join(dir, 'blocker', 'receipts.json') })
  await assert.rejects(broken.record({ runId: 'run-b', conversationId: 'conv-n', receipt: unknown }))
  assert.equal((await broken.list('conv-n')).length, 0)
  const outputs = createConversationOutputs({ filePath: path.join(dir, 'outputs.json') })
  await outputs.addOutput({ conversationId: 'conv-n', runId: 'run-a', kind: 'file', path: 'C:/w/a.txt' })
  await outputs.putJob({ jobId: 'job_n', conversationId: 'conv-n', state: 'queued' })
  assert.equal(await store.removeConversation('conv-n'), 1)
  assert.equal(await outputs.removeConversation('conv-n'), 2)
  assert.deepEqual(await store.list('conv-n'), []); assert.deepEqual(await outputs.jobs('conv-n'), [])
})

test('APR-011/014: a video finished in the background is listed with its conversation; a cancelled job stays cancelled', async () => {
  const dir = temp(), jobs = createConversationOutputs({ filePath: path.join(dir, 'outputs.json') })
  const recorded = []
  const fetchImpl = async (url, init) => {
    if (init?.method === 'POST') return new Response(JSON.stringify({ id: 'video_bg', status: 'queued' }))
    if (String(url).endsWith('/content')) return new Response(Buffer.from('MP4'))
    return new Response(JSON.stringify({ id: 'video_bg', status: 'completed' }))
  }
  const media = createMediaGeneration({ getOpenAIKey: async () => 'sk-test', workspace: dir, jobs, fetchImpl, saveToLibrary: async () => ({ id: 'd'.repeat(64) }),
    onJobOutput: (job, output) => jobs.addOutput({ conversationId: job.conversationId, runId: job.runId, kind: 'media', path: output.path, libraryId: output.libraryId }).then(() => recorded.push(job.jobId)) })
  await media.startVideo({ prompt: 'p', seconds: '4', size: '1280x720' }, { requestApproval: async () => 'ALLOW_ONCE', conversationId: 'conv-bg', runId: 'run-bg' })
  // The background pass (no chat run) completes it.
  await media.videoStatus({ jobId: 'video_bg', prompt: '' }, {})
  // Recorded atomically by the store together with the completion (APR-023), not by a separate callback.
  assert.deepEqual(recorded, [])
  const listed = await jobs.outputs('conv-bg')
  assert.equal(listed.length, 1); assert.equal(listed[0].runId, 'run-bg'); assert.equal(listed[0].kind, 'media')
  await jobs.putJob({ jobId: 'video_x', conversationId: 'conv-bg', state: 'cancelled' })
  const after = await jobs.putJob({ jobId: 'video_x', state: 'in_progress' })
  assert.equal(after.state, 'cancelled')
})

test('APR-017: shutdown waits for a receipt queued by a run that ends during shutdown', async () => {
  const { createNajdCore } = require('../electron/najd-core.cjs')
  const recorded = []
  const core = createNajdCore({
    onReceipt: async entry => { await new Promise(resolve => setTimeout(resolve, 30)); recorded.push(entry.runId) },
    model: ({ signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => setTimeout(() =>
      reject(Object.assign(new Error('CANCELLED'), { code: 'CANCELLED', receipt: { outcome: 'cancelled', profile: 'general', toolsets: [], toolCalls: 0, usage: { input: null, output: null, total: null, cached: null, modelCalls: 1 } } })), 10)))
  })
  const task = core.startTask({ text: 'hello', intentId: 'd'.repeat(32), provider: 'ollama', conversationId: 'conv-q' })
  await new Promise(resolve => setTimeout(resolve, 20))
  await core.shutdown()
  assert.deepEqual(recorded, [task.id])
})

test('APR-018/019: a failed job checkpoint never causes a second download; cancellation during download writes nothing', async () => {
  const dir = temp(), store = createConversationOutputs({ filePath: path.join(dir, 'outputs.json') })
  let failCompletedOnce = true, downloads = 0
  const jobs = { ...store, completeJob: async (id, output) => {
    if (failCompletedOnce) { failCompletedOnce = false; throw new Error('disk full') }
    return store.completeJob(id, output)
  } }
  const fetchImpl = async url => {
    if (String(url).endsWith('/content')) { downloads++; return new Response(Buffer.from('MP4')) }
    return new Response(JSON.stringify({ id: 'video_k', status: 'completed' }))
  }
  const media = createMediaGeneration({ getOpenAIKey: async () => 'sk-test', workspace: dir, jobs, fetchImpl, saveToLibrary: async () => null })
  await store.putJob({ jobId: 'video_k', conversationId: 'conv-k', state: 'in_progress' })
  const first = await media.videoStatus({ jobId: 'video_k', prompt: '' }, {})
  assert.equal(first.status, 'completed'); assert.match(first.note, /retried/)
  const second = await media.videoStatus({ jobId: 'video_k', prompt: '' }, {})
  assert.equal(second.status, 'completed'); assert.equal(downloads, 1)
  assert.equal((await store.getJob('video_k')).state, 'completed')
  // Cancellation lands while the content is downloading: nothing is written, the job stays cancelled.
  const dir2 = temp(), store2 = createConversationOutputs({ filePath: path.join(dir2, 'outputs.json') })
  await store2.putJob({ jobId: 'video_r', conversationId: 'conv-r', state: 'in_progress' })
  const media2 = createMediaGeneration({ getOpenAIKey: async () => 'sk-test', workspace: dir2, jobs: store2, saveToLibrary: async () => null,
    fetchImpl: async url => {
      if (String(url).endsWith('/content')) { await store2.putJob({ jobId: 'video_r', state: 'cancelled' }); return new Response(Buffer.from('MP4')) }
      return new Response(JSON.stringify({ id: 'video_r', status: 'completed' }))
    } })
  assert.equal((await media2.videoStatus({ jobId: 'video_r', prompt: '' }, {})).status, 'cancelled')
  assert.equal(fs.existsSync(path.join(dir2, 'Generated', 'video-video_r.mp4')), false)
})

test('APR-020: an approved write that finished as the run was cancelled is still listed as an output', async () => {
  const controller = new AbortController(), outputs = []
  const workspace = { describe: () => ({ workspace: 'C:/w', grantedFolders: [] }),
    run: async () => { controller.abort(); return { status: 'written', path: 'C:/w/late.txt' } } }
  const runtime = createAgentRuntime({ catalog: { search: async () => [], details: async () => ({}) }, library, workspace })
  const failure = await runtime.run({ signal: controller.signal, request: { text: 'احفظ ملف', conversationId: 'conv-l' }, onOutput: entry => outputs.push(entry),
    requestApproval: async () => 'ALLOW_ONCE', respond: async () => call('najd_files_write', { path: 'late.txt', content: 'x' }, 'w1') }).catch(error => error)
  assert.equal(failure.code, 'CANCELLED')
  assert.deepEqual(outputs, [{ kind: 'file', path: 'C:/w/late.txt', libraryId: null }])
})

test('APR-022/025: a partial video file is never reused; conversation totals survive trimming of detailed runs', async () => {
  const dir = temp(), jobs = createConversationOutputs({ filePath: path.join(dir, 'outputs.json') })
  // A crash left only a temporary part file: the video is downloaded again and published completely.
  fs.mkdirSync(path.join(dir, 'Generated'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'Generated', 'video-video_p.mp4.part-1234'), 'PART')
  let downloads = 0
  const media = createMediaGeneration({ getOpenAIKey: async () => 'sk-test', workspace: dir, jobs, saveToLibrary: async () => null,
    fetchImpl: async url => String(url).endsWith('/content') ? (downloads++, new Response(Buffer.from('FULLVIDEO'))) : new Response(JSON.stringify({ id: 'video_p', status: 'completed' })) })
  await jobs.putJob({ jobId: 'video_p', conversationId: 'conv-p', state: 'in_progress' })
  const result = await media.videoStatus({ jobId: 'video_p', prompt: '' }, {})
  assert.equal(downloads, 1); assert.equal(fs.readFileSync(result.path, 'utf8'), 'FULLVIDEO')
  assert.equal((await jobs.outputs('conv-p')).length, 1)
  // Detailed runs are bounded; the lifetime totals of a conversation are not.
  const store = createRunReceipts({ filePath: path.join(dir, 'receipts.json'), maxRuns: 2 })
  const receipt = total => ({ outcome: 'completed', profile: 'general', toolsets: [], toolCalls: 1, usage: { input: total, output: 0, total, cached: null, modelCalls: 1 } })
  await store.record({ runId: 'r1', conversationId: 'conv-t', receipt: receipt(10) })
  await store.record({ runId: 'r2', conversationId: 'conv-other', receipt: receipt(20) })
  await store.record({ runId: 'r3', conversationId: 'conv-other', receipt: receipt(30) })
  assert.equal((await store.list('conv-t')).length, 0)
  const totals = await createRunReceipts({ filePath: path.join(dir, 'receipts.json'), maxRuns: 2 }).totals('conv-t')
  assert.equal(totals.total, 10); assert.equal(totals.runs, 1); assert.equal(totals.toolCalls, 1)
})

test('APR-026: ordinary replies keep the usage each protocol reports', async () => {
  const { createProviderClient } = require('../electron/provider-client.cjs')
  const reply = body => async () => new Response(JSON.stringify(body))
  const deepseek = createProviderClient('deepseek-api', { fetchImpl: reply({ choices: [{ finish_reason: 'stop', message: { content: 'hi' } }],
    usage: { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15, prompt_tokens_details: { cached_tokens: 8 } } }) })
  assert.deepEqual((await deepseek.chat({ apiKey: 'k', modelName: 'deepseek-chat', history: [{ role: 'user', text: 'hi' }] })).usage, { input: 12, output: 3, total: 15, cached: 8 })
  const anthropic = createProviderClient('anthropic-api', { fetchImpl: reply({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'hi' }],
    usage: { input_tokens: 20, output_tokens: 4, cache_read_input_tokens: 16 } }) })
  assert.deepEqual((await anthropic.chat({ apiKey: 'k', modelName: 'claude-test', history: [{ role: 'user', text: 'hi' }] })).usage, { input: 20, output: 4, total: 24, cached: 16 })
  const gemini = createProviderClient('gemini-api', { fetchImpl: reply({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'hi' }] } }],
    usageMetadata: { promptTokenCount: 9, candidatesTokenCount: 2, totalTokenCount: 11 } }) })
  assert.deepEqual((await gemini.chat({ apiKey: 'k', modelName: 'gemini-test', history: [{ role: 'user', text: 'hi' }] })).usage, { input: 9, output: 2, total: 11, cached: null })
  const silent = createProviderClient('deepseek-api', { fetchImpl: reply({ choices: [{ finish_reason: 'stop', message: { content: 'hi' } }] }) })
  assert.equal((await silent.chat({ apiKey: 'k', modelName: 'deepseek-chat', history: [{ role: 'user', text: 'hi' }] })).usage, undefined)
})

test('APR-027: a job whose record could not be saved keeps its conversation, and an unsaved cancellation still wins', async () => {
  const dir = temp(), store = createConversationOutputs({ filePath: path.join(dir, 'outputs.json') })
  let failWrites = 1, statusReads = 0
  const jobs = { ...store, putJob: async record => { if (failWrites > 0) { failWrites--; throw new Error('disk full') } return store.putJob(record) } }
  const fetchImpl = async (url, init) => {
    if (init?.method === 'POST') return new Response(JSON.stringify({ id: 'video_u', status: 'queued' }))
    if (init?.method === 'DELETE') return new Response('{}')
    statusReads++
    return new Response(JSON.stringify({ id: 'video_u', status: 'in_progress', progress: 40 }))
  }
  const media = createMediaGeneration({ getOpenAIKey: async () => 'sk-test', workspace: dir, jobs, fetchImpl, saveToLibrary: async () => null })
  const started = await media.startVideo({ prompt: 'p', seconds: '4', size: '1280x720' }, { requestApproval: async () => 'ALLOW_ONCE', conversationId: 'conv-u', runId: 'run-u' })
  assert.match(started.note, /Do not start it again/)
  assert.deepEqual(media.unsavedJobs().map(job => job.conversationId), ['conv-u'])
  await media.videoStatus({ jobId: 'video_u', prompt: '' }, {})
  const saved = await store.getJob('video_u')
  assert.equal(saved.conversationId, 'conv-u'); assert.equal(saved.runId, 'run-u')
  // Cancellation whose record fails to save: later reads answer cancelled without asking the provider.
  failWrites = 1
  const cancelled = await media.cancelVideo({ jobId: 'video_u' }, {})
  assert.match(cancelled.note, /retry/)
  const reads = statusReads
  assert.equal((await media.videoStatus({ jobId: 'video_u', prompt: '' }, {})).status, 'cancelled')
  assert.equal(statusReads, reads)
  assert.equal((await store.getJob('video_u')).state, 'cancelled')
})

test('M2-R15: output excerpts fit what is left of the real request budget, and nothing when it is spent', async () => {
  const seen = []
  const python = { available: async () => true, run: async (_args, options) => { seen.push(options.maxBytes); return { status: 'finished', output: '' } } }
  const once = async inputBudget => {
    let turn = 0
    const runtime = createAgentRuntime({ catalog: { search: async () => [], details: async () => ({}) }, library, python, logs: { read: async () => ({}) } })
    await runtime.run({ request: { text: 'run it', conversationId: 'conv-budget', contextMode: 'full', inputBudget, profile: 'coding' }, requestApproval: async () => 'ALLOW_ONCE',
      respond: async () => turn++ === 0 ? call('najd_python_run', { code: 'print(1)', cwd: '' }, 'p1') : { kind: 'message', text: 'done' } })
  }
  await once(400000)
  // With no room left Python is refused before it starts (M2-R17-002) and, since even the next request cannot fit,
  // the run stops explicitly (M2-R19-003).
  await assert.rejects(once(10), { code: 'CONTEXT_LIMIT' })
  assert.equal(seen[0], 8192); assert.equal(seen.length, 1)
})

test('M2-R17: the tool catalog reports execution tools as not ready without the desktop host or engine', async () => {
  const off = { available: async () => false }
  const runtime = createAgentRuntime({ catalog: { search: async () => [], details: async () => ({}) }, library, python: off, processes: off, desktop: off })
  const tools = await runtime.describeTools()
  for (const name of ['najd_python_run', 'najd_process_start', 'najd_desktop_act', 'najd_screen_capture']) {
    const item = tools.find(entry => entry.title === name)
    assert.ok(item, name); assert.equal(item.ready, false); assert.equal(item.reason, 'DESKTOP_HOST_OR_ENGINE_NOT_READY')
  }
  assert.equal(tools.find(entry => entry.title === 'najd_desktop_act').effect, 'change-with-approval')
  const on = createAgentRuntime({ catalog: { search: async () => [], details: async () => ({}) }, library, python: { available: async () => true } })
  assert.equal((await on.describeTools()).find(entry => entry.title === 'najd_python_run').ready, true)
})

test('M2-R2-006: each run has its own desktop state, released when the run completes or fails', async () => {
  const ended = [], seen = []
  const desktop = { available: async () => true, endRun: key => ended.push(key),
    windows: async (_args, ctx) => { seen.push(ctx.runId); return { windows: [] } } }
  const runtime = createAgentRuntime({ catalog: { search: async () => [], details: async () => ({}) }, library, desktop })
  for (const finalTurn of [{ kind: 'message', text: 'done' }, { kind: 'broken' }]) {
    let turn = 0
    await runtime.run({ request: { text: 'list my windows', profile: 'office' }, requestApproval: async () => 'ALLOW_ONCE',
      respond: async () => turn++ === 0 ? call('najd_desktop_windows', {}, 'd' + ended.length) : finalTurn }).catch(() => {})
  }
  assert.equal(seen.length, 2); assert.notEqual(seen[0], seen[1])
  assert.deepEqual(ended, seen)
})

test('M2-R3-005: an uncertain process start reaches the model as an unknown effect with its id and log', async () => {
  const processes = { available: async () => true, start: async () => { throw Object.assign(new Error('PROCESS_FAILED'), { code: 'PROCESS_FAILED', effectUnknown: true, startId: 'proc-1', logId: 'log-1' }) } }
  let turn = 0, seen = null
  const runtime = createAgentRuntime({ catalog: { search: async () => [], details: async () => ({}) }, library, processes, logs: { read: async () => ({}) }, workspace: { describe: () => ({ workspace: 'C:/w', grantedFolders: [] }), run: async () => ({}) } })
  await runtime.run({ request: { text: 'start the dev server', profile: 'coding' }, requestApproval: async () => 'ALLOW_ONCE',
    respond: async request => { if (turn++ === 0) return call('najd_process_start', { command: 'npm run dev', cwd: '' }, 'p1'); seen = request.input.find(item => item.type === 'function_call_output'); return { kind: 'message', text: 'ok' } } })
  const output = JSON.parse(seen.output)
  assert.equal(output.error, 'PROCESS_FAILED'); assert.equal(output.effectUnknown, true); assert.equal(output.id, 'proc-1'); assert.equal(output.logId, 'log-1')
})

async function firstRequestSize(deps, profile = 'coding') {
  let size = 0
  await createAgentRuntime({ catalog: { search: async () => [], details: async () => ({}) }, library, ...deps }).run({ request: { text: 'x', profile, contextMode: 'full', inputBudget: 400000 },
    respond: async request => { size = request.instructions.length + JSON.stringify(request.tools).length + JSON.stringify(request.input).length; return { kind: 'message', text: 'ok' } } })
  return size
}

test('M2-R17-002: an effect whose result could not fit the next request is refused before it is approved or run', async () => {
  let ran = false, asked = false
  const python = { available: async () => true, run: async () => { ran = true; return { status: 'finished', output: '' } } }
  let turn = 0, seen = null
  const runtime = createAgentRuntime({ catalog: { search: async () => [], details: async () => ({}) }, library, python, logs: { read: async () => ({}) } })
  const base = await firstRequestSize({ python, logs: { read: async () => ({}) } })
  await runtime.run({ request: { text: 'run python', conversationId: 'conv-full', contextMode: 'full', inputBudget: base + 2500, profile: 'coding' }, requestApproval: async () => { asked = true; return 'ALLOW_ONCE' },
    respond: async request => { if (turn++ === 0) return call('najd_python_run', { code: 'x'.repeat(1500), cwd: '' }, 'p1'); seen = request.input.find(item => item.type === 'function_call_output'); return { kind: 'message', text: 'done' } } })
  assert.equal(ran, false); assert.equal(asked, false)
  assert.equal(JSON.parse(seen.output).error, 'CONTEXT_LIMIT')
})

test('M2-R18-002: a result is shortened to its real transcript cost (escaping included), keeping its log id', async () => {
  const { agentTurnSize } = require('../electron/agent-context.cjs')
  const heavy = '\u0001'.repeat(1800) // each becomes six characters once escaped twice
  const python = { available: async () => true, run: async () => ({ status: 'finished', exitCode: 0, output: heavy, logId: 'log-keep', nextOffset: 1800,
    files: Array.from({ length: 20 }, (_, i) => 'C:/work/' + 'deep/'.repeat(30) + 'file' + i + '.txt') }) }
  let turn = 0, item = null, budgetSeen = null
  const runtime = createAgentRuntime({ catalog: { search: async () => [], details: async () => ({}) }, library, python, logs: { read: async () => ({}) } })
  const base = await firstRequestSize({ python, logs: { read: async () => ({}) } })
  await runtime.run({ request: { text: 'run python', conversationId: 'conv-cost', contextMode: 'full', inputBudget: base + 9000, profile: 'coding' }, requestApproval: async () => 'ALLOW_ONCE',
    respond: async request => {
      if (turn++ === 0) { budgetSeen = 9000; return call('najd_python_run', { code: 'print(1)', cwd: '' }, 'p1') }
      item = request.input.find(entry => entry.type === 'function_call_output'); return { kind: 'message', text: 'done' }
    } })
  const result = JSON.parse(item.output)
  // The excerpt is left out whole and its cursor points back to the page start, so paging from it misses nothing
  // (M2-R19-002).
  assert.equal(result.shortened, true); assert.equal(result.logId, 'log-keep'); assert.equal(result.output, ''); assert.equal(result.nextOffset, 0)
  assert.ok(agentTurnSize({ input: [item] }) < Math.max(2000, budgetSeen), 'the shortened result fits the room left')
})

test('M2-R19-002: a log page that has to be shortened is left out whole, with its cursor back at the page start', async () => {
  const logsTool = { read: async ({ offset }) => ({ logId: 'log-p', offset, text: '\u0001'.repeat(1800), nextOffset: offset + 1800, totalBytes: 9000 }) }
  const python = { available: async () => true, run: async () => ({ status: 'finished' }) }
  const base = await firstRequestSize({ python, logs: logsTool })
  let turn = 0, item = null
  const runtime = createAgentRuntime({ catalog: { search: async () => [], details: async () => ({}) }, library, python, logs: logsTool })
  await runtime.run({ request: { text: 'read the log', conversationId: 'conv-page', contextMode: 'full', inputBudget: base + 5000, profile: 'coding' }, requestApproval: async () => 'ALLOW_ONCE',
    respond: async request => { if (turn++ === 0) return call('najd_log_read', { logId: 'log-p', offset: 500 }, 'r1'); item = request.input.find(entry => entry.type === 'function_call_output'); return { kind: 'message', text: 'ok' } } })
  const page = JSON.parse(item.output)
  assert.equal(page.shortened, true); assert.equal(page.text, ''); assert.equal(page.nextOffset, 500, 'paging resumes where this page began')
})

test('M2-R20-001: a shortened file read says there is more and where to continue; the process list keeps every live command', async () => {
  const text = '\u0001'.repeat(8000)
  const workspace = { describe: () => ({ workspace: 'C:/w', grantedFolders: [] }), run: async () => ({ text, offset: 0, characters: 8000, hasMore: false }) }
  const processes = { available: async () => true, list: async () => ({ processes: [{ id: 'live-1', command: 'npm run dev', state: 'running' },
    ...Array.from({ length: 40 }, (_, i) => ({ id: 'old-' + i, command: 'x'.repeat(300), state: 'exited', exitCode: 0 }))] }) }
  const deps = { workspace, processes, logs: { read: async () => ({}) } }
  const base = await firstRequestSize(deps)
  for (const [tool, args] of [['najd_files_read', { path: 'a.txt', offset: 0, limit: 8000 }], ['najd_process_list', {}]]) {
    let turn = 0, item = null
    const runtime = createAgentRuntime({ catalog: { search: async () => [], details: async () => ({}) }, library, ...deps })
    await runtime.run({ request: { text: 'read it', conversationId: 'conv-r20', contextMode: 'full', inputBudget: base + 7000, profile: 'coding' }, requestApproval: async () => 'ALLOW_ONCE',
      respond: async request => { if (turn++ === 0) return call(tool, args, 'c1'); item = request.input.find(entry => entry.type === 'function_call_output'); return { kind: 'message', text: 'ok' } } })
    const result = JSON.parse(item.output)
    assert.equal(result.shortened, true, tool)
    if (tool === 'najd_files_read') { assert.equal(result.hasMore, true); assert.equal(result.nextOffset, result.text.length); assert.ok(result.text.length < 8000) }
    else { assert.ok(result.processes.some(entry => entry.id === 'live-1')); assert.ok(result.olderHistoryOmitted > 0) }
  }
})

test('M2-R21-001: under tight budgets a file read is cut with its offset, left as an empty page that continues from its start, or the run stops', async () => {
  const workspace = { describe: () => ({ workspace: 'C:/w', grantedFolders: [] }), run: async () => ({ text: ''.repeat(8000), offset: 120, characters: 9000, hasMore: true }) }
  const deps = { workspace, logs: { read: async () => ({}) } }
  const base = await firstRequestSize(deps)
  const attempt = async margin => {
    let turn = 0, item = null
    const runtime = createAgentRuntime({ catalog: { search: async () => [], details: async () => ({}) }, library, ...deps })
    const outcome = await runtime.run({ request: { text: 'read it', conversationId: 'conv-tight', contextMode: 'full', inputBudget: base + margin, profile: 'coding' }, requestApproval: async () => 'ALLOW_ONCE',
      respond: async request => { if (turn++ === 0) return call('najd_files_read', { path: 'a.txt', offset: 120, limit: 8000 }, 'c1'); item = request.input.find(entry => entry.type === 'function_call_output'); return { kind: 'message', text: 'ok' } } })
      .then(() => 'ok', error => error.code)
    return { outcome, result: item ? JSON.parse(item.output) : null }
  }
  const cut = await attempt(1000)
  assert.ok(cut.result.text.length > 0 && cut.result.text.length < 8000); assert.equal(cut.result.hasMore, true); assert.equal(cut.result.nextOffset, 120 + cut.result.text.length)
  const empty = await attempt(700)
  assert.equal(empty.result.text, ''); assert.equal(empty.result.hasMore, true); assert.equal(empty.result.nextOffset, 120, 'nothing delivered, so it continues from its own start')
  assert.equal((await attempt(300)).outcome, 'CONTEXT_LIMIT', 'no room at all: the run stops explicitly')
})

test('M2-R21-002: a conversation can page its saved output with the desktop host off', async () => {
  const read = []
  const logs = { read: async options => { read.push(options); return { logId: options.logId, offset: options.offset, text: 'saved line', nextOffset: null, totalBytes: 10 } } }
  const off = { available: async () => false }
  let turn = 0, item = null
  const runtime = createAgentRuntime({ catalog: { search: async () => [], details: async () => ({}) }, library, logs, python: off, processes: off })
  await runtime.run({ request: { text: 'show the earlier output', conversationId: 'conv-logs', profile: 'coding' }, requestApproval: async () => 'ALLOW_ONCE',
    respond: async request => { if (turn++ === 0) return call('najd_log_read', { logId: 'log-1', offset: 0 }, 'l1'); item = request.input.find(entry => entry.type === 'function_call_output'); return { kind: 'message', text: 'ok' } } })
  assert.equal(JSON.parse(item.output).text, 'saved line'); assert.equal(read[0].conversationId, 'conv-logs')
})

test('M2-R23-001: after a restart a new task finds the conversation\'s saved output without being told its log id', async () => {
  const { createExecLogs } = require('../electron/exec-logs.cjs')
  const directory = temp()
  const earlier = createExecLogs({ directory })
  const saved = earlier.createExternal({ conversationId: 'conv-saved', kind: 'python' })
  fs.writeFileSync(saved.file, 'result: 42\n')
  earlier.createExternal({ conversationId: 'conv-other', kind: 'python' })
  const logs = createExecLogs({ directory }) // NAJD restarted
  let turn = 0, listed = null, page = null
  const runtime = createAgentRuntime({ catalog: { search: async () => [], details: async () => ({}) }, library, logs })
  await runtime.run({ request: { text: 'show the earlier result', conversationId: 'conv-saved', profile: 'general' }, requestApproval: async () => 'ALLOW_ONCE',
    respond: async request => {
      const outputs = request.input.filter(item => item.type === 'function_call_output')
      if (turn === 0) { turn++; return call('najd_log_list', { from: 0 }, 'l1') }
      if (turn === 1) { turn++; listed = JSON.parse(outputs[0].output); return call('najd_log_read', { logId: listed.logs[0].logId, offset: 0 }, 'l2') }
      page = JSON.parse(outputs[1].output); return { kind: 'message', text: 'ok' }
    } })
  assert.equal(listed.logs.length, 1, 'only this conversation\'s logs'); assert.equal(listed.logs[0].logId, saved.logId)
  assert.equal(page.text, 'result: 42\n')
})

test('M2-R25-001: a shortened list of saved logs continues from the first entry not delivered', async () => {
  const entries = Array.from({ length: 30 }, (_, i) => ({ logId: 'log-' + String(i).padStart(18, '0'), kind: 'python', created: '2026-10-18T00:00:00.000Z', retainedBytes: 1000, note: '\u0001'.repeat(60) }))
  const logs = { read: async () => ({}), list: ({ from }) => ({ logs: entries.slice(0, 30), total: 35 + (from || 0), nextFrom: (from || 0) + 30 }) }
  const base = await firstRequestSize({ logs }, 'general')
  for (const from of [0, 5]) {
    let turn = 0, item = null
    const runtime = createAgentRuntime({ catalog: { search: async () => [], details: async () => ({}) }, library, logs })
    await runtime.run({ request: { text: 'list saved output', conversationId: 'conv-ll', contextMode: 'full', inputBudget: base + 4000, profile: 'general' }, requestApproval: async () => 'ALLOW_ONCE',
      respond: async request => { if (turn++ === 0) return call('najd_log_list', { from }, 'l1'); item = request.input.find(entry => entry.type === 'function_call_output'); return { kind: 'message', text: 'ok' } } })
    const page = JSON.parse(item.output)
    assert.equal(page.shortened, true); assert.ok(page.logs.length < 30)
    assert.equal(page.nextFrom, from + page.logs.length, 'continues right after what was delivered')
  }
})

test('M2-R28-001: a Python run that fails keeps its file inventory and whether it is complete, even when empty', async () => {
  const python = { available: async () => true, run: async () => { throw Object.assign(new Error('TIMEOUT'), { code: 'TIMEOUT', effectUnknown: true, familyClosed: true, logId: 'log-t', files: [], filesComplete: false }) } }
  let turn = 0, item = null
  const runtime = createAgentRuntime({ catalog: { search: async () => [], details: async () => ({}) }, library, python, logs: { read: async () => ({}) } })
  await runtime.run({ request: { text: 'run python', conversationId: 'conv-inv', profile: 'coding' }, requestApproval: async () => 'ALLOW_ONCE',
    respond: async request => { if (turn++ === 0) return call('najd_python_run', { code: 'print(1)', cwd: '' }, 'p1'); item = request.input.find(entry => entry.type === 'function_call_output'); return { kind: 'message', text: 'ok' } } })
  const result = JSON.parse(item.output)
  assert.equal(result.error, 'TIMEOUT'); assert.deepEqual(result.files, []); assert.equal(result.filesComplete, false)
})

test('a screenshot the task took is shown under its answer (once), so the chat and a channel can show it', async () => {
  const id = 'd'.repeat(64)
  const desktop = { available: async () => true, endRun: () => {}, capture: async () => ({ status: 'captured', path: 'C:/c/capture.png', libraryId: id, width: 10, height: 10 }) }
  const runtime = createAgentRuntime({ catalog: { search: async () => [], details: async () => ({}) }, library, desktop })
  for (const [finalText, expected] of [['Here is your screen.', `Here is your screen.\n\n![](najd-library://${id})`], [`Here: ![screen](najd-library://${id})`, `Here: ![screen](najd-library://${id})`]]) {
    let turn = 0
    const result = await runtime.run({ request: { text: 'send me a screenshot', profile: 'office', vision: true }, requestApproval: async () => 'ALLOW_ONCE',
      respond: async () => turn++ === 0 ? call('najd_screen_capture', { window: '' }, 's1') : { kind: 'message', text: finalText } })
    assert.equal(result.text, expected)
  }
  // A capture the owner denied shows nothing.
  const denied = createAgentRuntime({ catalog: { search: async () => [], details: async () => ({}) }, library, desktop: { ...desktop, capture: async () => ({ status: 'denied_by_user' }) } })
  let turn = 0
  const result = await denied.run({ request: { text: 'screenshot', profile: 'office', vision: true }, requestApproval: async () => 'DENY', respond: async () => turn++ === 0 ? call('najd_screen_capture', { window: '' }, 's2') : { kind: 'message', text: 'No picture.' } })
  assert.equal(result.text, 'No picture.')
})

test('a model that cannot see pictures can still take a screenshot for the owner: it is shown under the answer, never sent to the model as an image', async () => {
  const id = 'f'.repeat(64)
  const desktop = { available: async () => true, endRun: () => {}, capture: async () => ({ status: 'captured', path: 'C:/c/capture.png', libraryId: id, imageUrl: 'data:image/png;base64,AAAA', width: 10, height: 10 }) }
  const runtime = createAgentRuntime({ catalog: { search: async () => [], details: async () => ({}) }, library, desktop })
  let turn = 0, offered = false, sent = null
  const result = await runtime.run({ request: { text: 'send me a screenshot', profile: 'office', vision: false }, requestApproval: async () => 'ALLOW_ONCE',
    respond: async request => {
      if (turn === 0) { turn++; offered = /najd_tools_load: [^.]*screen/.test(request.instructions); return call('najd_tools_load', { toolset: 'screen', unload: '' }, 'l1') }
      if (turn++ === 1) return call('najd_screen_capture', { window: '' }, 'n1')
      sent = request.input; return { kind: 'message', text: 'Here it is.' }
    } })
  assert.equal(offered, true, 'offered to a model without vision')
  assert.ok(!JSON.stringify(sent).includes('input_image'), 'no image reaches a model that cannot see it')
  assert.match(JSON.stringify(sent), /cannot see pictures/)
  assert.equal(result.text, `Here it is.\n\n![](najd-library://${id})`)
  assert.deepEqual(result.images, [id])
})

test('screenshots taken on the way are not sent: only the last one is shown, unless the answer names its own', async () => {
  const ids = ['1', '2', '3'].map(n => n.repeat(64))
  let index = 0
  const desktop = { available: async () => true, endRun: () => {}, capture: async () => ({ status: 'captured', path: 'C:/c/x.png', libraryId: ids[index++ % 3], width: 1, height: 1 }) }
  const runtime = createAgentRuntime({ catalog: { search: async () => [], details: async () => ({}) }, library, desktop })
  const runWith = async finalText => {
    index = 0
    let turn = 0
    return runtime.run({ request: { text: 'open the site and show me the login page', profile: 'office', vision: true }, requestApproval: async () => 'ALLOW_ONCE',
      respond: async () => turn < 3 ? call('najd_screen_capture', { window: '' }, 'c' + turn++) : { kind: 'message', text: finalText } })
  }
  const plain = await runWith('Here is the login page.')
  assert.deepEqual(plain.images, [ids[2]]); assert.equal(plain.text, `Here is the login page.\n\n![](najd-library://${ids[2]})`)
  const named = await runWith(`First: ![](najd-library://${ids[0]})`)
  assert.deepEqual(named.images, [ids[0]]); assert.equal(named.text, `First: ![](najd-library://${ids[0]})`)
})

test('messages the owner adds while a task works reach the model at its next step; one that arrives with the final answer makes it revise', async () => {
  const runtime = createAgentRuntime({ catalog: { search: async () => [], details: async () => ({}) }, library })
  const queue = [], seen = []
  let turn = 0
  const result = await runtime.run({ request: { text: 'find a TV remote', profile: 'coding' }, takeNotes: () => queue.splice(0),
    respond: async request => {
      seen.push(JSON.stringify(request.input))
      turn++
      if (turn === 1) { queue.push('it must work with impex TVs'); return call('najd_plan', { steps: [{ text: 'search', status: 'doing' }] }, 'p1') }
      if (turn === 2) { queue.push('and send links'); return { kind: 'message', text: 'Here are remotes.' } }
      return { kind: 'message', text: 'Here are impex remotes with links.' }
    } })
  assert.match(seen[1], /NAJD_USER_ADDED[^"]*it must work with impex TVs/, 'added before the second step')
  assert.match(seen[2], /NAJD_DRAFT_ANSWER[^"]*Here are remotes\./); assert.match(seen[2], /NAJD_USER_ADDED[^"]*and send links/)
  assert.equal(result.text, 'Here are impex remotes with links.')
  assert.equal(turn, 3)
})
