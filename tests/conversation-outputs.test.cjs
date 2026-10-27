const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { createConversationOutputs } = require('../electron/conversation-outputs.cjs')
const { createMediaGeneration } = require('../electron/media-generation.cjs')
const { createAgentRuntime } = require('../electron/agent-runtime.cjs')

const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'najd-outputs-'))
const call = (name, args, id) => ({ kind: 'agent-tools', calls: [{ name, arguments: JSON.stringify(args), call_id: id }],
  items: [{ type: 'function_call', name, arguments: JSON.stringify(args), call_id: id }] })

test('outputs are listed per conversation, even when two conversations produce identical content', async () => {
  const store = createConversationOutputs({ filePath: path.join(temp(), 'outputs.json') })
  await store.addOutput({ conversationId: 'conv-a', runId: 'run-1', kind: 'media', path: 'C:/w/Generated/a.png', libraryId: 'f'.repeat(64) })
  await store.addOutput({ conversationId: 'conv-b', runId: 'run-2', kind: 'media', path: 'C:/w/Generated/a.png', libraryId: 'f'.repeat(64) })
  assert.equal(await store.addOutput({ conversationId: 'conv-a', runId: 'run-1', kind: 'media', path: 'C:/w/Generated/a.png', libraryId: 'f'.repeat(64) }), false)
  assert.equal((await store.outputs('conv-a')).length, 1); assert.equal((await store.outputs('conv-b')).length, 1)
  await assert.rejects(store.outputs('../x'), { code: 'INVALID_INPUT' })
})

test('repeated status reads of a finished video download and write it only once (AP-006)', async () => {
  const dir = temp(), jobs = createConversationOutputs({ filePath: path.join(dir, 'outputs.json') })
  let downloads = 0, imports = 0
  const fetchImpl = async (url, init) => {
    if (init?.method === 'POST') return new Response(JSON.stringify({ id: 'video_1', status: 'queued' }))
    if (String(url).endsWith('/content')) { downloads++; return new Response(Buffer.from('MP4DATA')) }
    return new Response(JSON.stringify({ id: 'video_1', status: 'completed' }))
  }
  const media = createMediaGeneration({ getOpenAIKey: async () => 'sk-test', workspace: dir, jobs, fetchImpl,
    saveToLibrary: async () => { imports++; return { id: 'e'.repeat(64) } } })
  const started = await media.startVideo({ prompt: 'a calm desert', seconds: '4', size: '1280x720' }, { requestApproval: async () => 'ALLOW_ONCE', conversationId: 'conv-v' })
  assert.equal(started.jobId, 'video_1')
  const [first, second] = await Promise.all([media.videoStatus({ jobId: 'video_1', prompt: '' }, {}), media.videoStatus({ jobId: 'video_1', prompt: '' }, {})])
  const third = await media.videoStatus({ jobId: 'video_1', prompt: '' }, {})
  assert.equal(downloads, 1); assert.equal(imports, 1)
  assert.equal(first.path, second.path); assert.equal(first.path, third.path)
  assert.equal(fs.readdirSync(path.join(dir, 'Generated')).length, 1)
  const [job] = await jobs.jobs('conv-v')
  assert.equal(job.state, 'completed'); assert.equal(job.output.path, first.path)
})

test('a run reports approved file writes as outputs and ignores denied ones', async () => {
  const outputs = []
  const decisions = ['ALLOW_ONCE', 'DENY']
  const workspace = { describe: () => ({ workspace: 'C:/w', grantedFolders: [] }),
    run: async (_operation, args, { requestApproval }) => (await requestApproval('najd-files-write', { path: args.path })) === 'ALLOW_ONCE'
      ? { status: 'written', path: 'C:/w/' + args.path } : { status: 'denied_by_user' } }
  const runtime = createAgentRuntime({ catalog: { search: async () => [], details: async () => ({}) }, library: { list: async () => [], read: async () => ({}), search: async () => [] }, workspace })
  let turn = 0
  await runtime.run({ request: { text: 'احفظ ملفين', conversationId: 'conv-f' }, onOutput: entry => outputs.push(entry), requestApproval: async () => decisions.shift(),
    respond: async () => turn++ === 0 ? call('najd_files_write', { path: 'a.txt', content: 'A' }, 'w1')
      : turn === 2 ? call('najd_files_write', { path: 'b.txt', content: 'B' }, 'w2') : { kind: 'message', text: 'done' } })
  assert.deepEqual(outputs, [{ kind: 'file', path: 'C:/w/a.txt', libraryId: null }])
})
