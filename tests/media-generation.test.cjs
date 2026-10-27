const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const { createMediaGeneration } = require('../electron/media-generation.cjs')
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64')

function fixture({ key = 'sk-user-own-key' } = {}) {
  const workspace = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'najd-media-'))
  const calls = [], saved = []
  let videoPolls = 0
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), method: init.method || 'GET', auth: init.headers?.Authorization, body: init.body ? JSON.parse(init.body) : null })
    if (url.endsWith('/images/generations')) return new Response(JSON.stringify({ data: [{ b64_json: PNG.toString('base64') }] }))
    if (url.endsWith('/videos') && init.method === 'POST') return new Response(JSON.stringify({ id: 'video_123', status: 'queued' }))
    if (url.endsWith('/videos/video_123') && (init.method || 'GET') === 'GET') return new Response(JSON.stringify({ id: 'video_123', status: ++videoPolls > 1 ? 'completed' : 'in_progress', progress: 40 }))
    if (url.endsWith('/videos/video_123/content')) return new Response(Buffer.from('MP4BYTES'))
    if (url.endsWith('/videos/video_123') && init.method === 'DELETE') return new Response('{}')
    return new Response('{}', { status: 404 })
  }
  const media = createMediaGeneration({ getOpenAIKey: async () => key, workspace, fetchImpl, saveToLibrary: async file => { saved.push(file); return { id: 'a'.repeat(64) } } })
  return { media, calls, saved, workspace }
}

test('no service is offered without a user key', async () => {
  assert.deepEqual(await fixture({ key: null }).media.services(), [])
  assert.deepEqual(await fixture().media.services(), ['openai-images', 'openai-video', 'openai-transcription'])
})

test('image generation is paid: it waits for approval naming billing, makes no request when denied, saves once when approved', async () => {
  const { media, calls, saved } = fixture()
  const seen = []
  const denied = await media.generateImage({ prompt: 'A Najdi castle at dusk', size: '1024x1024' }, { requestApproval: async (tool, input) => { seen.push(input); return 'DENY' } })
  assert.equal(denied.status, 'denied_by_user'); assert.equal(calls.length, 0)
  assert.match(seen[0].summary, /paid request billed by OpenAI/)
  const made = await media.generateImage({ prompt: 'A Najdi castle at dusk', size: '1024x1024' }, { requestApproval: async () => 'ALLOW_ONCE' })
  assert.equal(made.status, 'generated'); assert.equal(calls.length, 1); assert.equal(calls[0].auth, 'Bearer sk-user-own-key')
  assert.equal(calls[0].body.model, 'gpt-image-1')
  assert.deepEqual(fs.readFileSync(made.path), PNG); assert.equal(saved.length, 1)
  assert.equal(made.markdown, `![A-Najdi-castle-at-dusk](najd-library://${'a'.repeat(64)})`)
  await assert.rejects(media.generateImage({ prompt: 'x', size: '4000x4000' }, { requestApproval: async () => 'ALLOW_ONCE' }), { code: 'INVALID_INPUT' })
})

test('video generation starts one approved job, reports progress honestly, then downloads into the library', async () => {
  const { media, calls } = fixture()
  const job = await media.startVideo({ prompt: 'Palm trees in wind', seconds: '4', size: '1280x720' }, { requestApproval: async () => 'ALLOW_ONCE' })
  assert.equal(job.jobId, 'video_123'); assert.match(job.note, /not finished/)
  assert.equal((await media.videoStatus({ jobId: 'video_123', prompt: 'Palm trees' }, {})).status, 'in_progress')
  const done = await media.videoStatus({ jobId: 'video_123', prompt: 'Palm trees' }, {})
  assert.equal(done.status, 'completed'); assert.equal(fs.readFileSync(done.path, 'utf8'), 'MP4BYTES')
  assert.equal((await media.cancelVideo({ jobId: 'video_123' }, {})).status, 'cancelled')
  assert.equal(calls.filter(call => call.method === 'POST').length, 1, 'exactly one paid job was created')
})

test('transcription is paid: denial sends nothing; approval sends one request with the WAV and returns the text', async () => {
  const workspace = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'najd-tr-'))
  const sent = []
  const fetchImpl = async (url, init) => { sent.push({ url: String(url), form: init.body }); return new Response(JSON.stringify({ text: 'Hello from the video' })) }
  const media = createMediaGeneration({ getOpenAIKey: async () => 'sk-user-own-key', workspace, fetchImpl, saveToLibrary: async () => null })
  const wav = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(100)])
  const prompts = []
  assert.equal((await media.transcribe({ wav, seconds: 130, name: 'talk.mp4' }, { requestApproval: async (tool, input) => { prompts.push(input); return 'DENY' } })).status, 'denied_by_user')
  assert.equal(sent.length, 0); assert.match(prompts[0].summary, /about 3 minutes.*paid request billed by OpenAI/)
  const result = await media.transcribe({ wav, seconds: 130, name: 'talk.mp4' }, { requestApproval: async () => 'ALLOW_ONCE' })
  assert.deepEqual(result, { status: 'transcribed', text: 'Hello from the video', truncated: false })
  assert.equal(sent.length, 1); assert.match(sent[0].url, /\/audio\/transcriptions$/)
  assert.equal(sent[0].form.get('model'), 'gpt-4o-mini-transcribe'); assert.equal((await sent[0].form.get('file').arrayBuffer()).byteLength, wav.length)
})

test('a paid request lost after it was sent is an unknown effect, while an explicit rejection is not', async () => {
  const workspace = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'najd-media-'))
  const make = fetchImpl => createMediaGeneration({ getOpenAIKey: async () => 'sk-user-own-key', workspace, fetchImpl, saveToLibrary: async () => ({ id: 'a'.repeat(64) }) })
  const lost = make(async () => { throw new Error('socket hang up') })
  await assert.rejects(lost.generateImage({ prompt: 'castle', size: '1024x1024' }, { requestApproval: async () => 'ALLOW_ONCE' }), failure => failure.code === 'SERVICE_UNAVAILABLE' && failure.effectUnknown === true)
  const serverError = make(async () => new Response('{}', { status: 502 }))
  await assert.rejects(serverError.generateImage({ prompt: 'castle', size: '1024x1024' }, { requestApproval: async () => 'ALLOW_ONCE' }), failure => failure.effectUnknown === true)
  const rejected = make(async () => new Response('{}', { status: 400 }))
  await assert.rejects(rejected.generateImage({ prompt: 'castle', size: '1024x1024' }, { requestApproval: async () => 'ALLOW_ONCE' }), failure => failure.code === 'REQUEST_REJECTED' && !failure.effectUnknown)
})

test('an accepted paid request with an unusable answer, and a lost cancellation, are unknown effects', async () => {
  const workspace = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'najd-media-'))
  const make = fetchImpl => createMediaGeneration({ getOpenAIKey: async () => 'sk-user-own-key', workspace, fetchImpl, saveToLibrary: async () => ({ id: 'a'.repeat(64) }) })
  const brokenAnswer = make(async () => new Response('not json', { status: 200 }))
  await assert.rejects(brokenAnswer.startVideo({ prompt: 'castle', seconds: '4', size: '1280x720' }, { requestApproval: async () => 'ALLOW_ONCE' }), failure => failure.effectUnknown === true)
  const lostDelete = make(async () => { throw new Error('socket hang up') })
  await assert.rejects(lostDelete.cancelVideo({ jobId: 'video_123' }, {}), failure => failure.effectUnknown === true)
})

test('a local save failure after a successful paid image is a non-retryable unknown effect', async () => {
  const workspace = path.join(fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'najd-media-')), 'blocked')
  fs.writeFileSync(workspace, 'a file where the workspace folder should be')
  const media = createMediaGeneration({ getOpenAIKey: async () => 'sk-user-own-key', workspace,
    fetchImpl: async () => new Response(JSON.stringify({ data: [{ b64_json: PNG.toString('base64') }] })), saveToLibrary: async () => ({ id: 'a'.repeat(64) }) })
  await assert.rejects(media.generateImage({ prompt: 'castle', size: '1024x1024' }, { requestApproval: async () => 'ALLOW_ONCE' }), failure => failure.code === 'SAVE_FAILED' && failure.effectUnknown === true)
})

test('a prompt longer than its approval preview is flagged as shown only in part', async () => {
  const { media } = fixture()
  const seen = []
  const long = 'A castle. ' + 'detail '.repeat(300) + 'SECRET-SUFFIX'
  await media.generateImage({ prompt: long, size: '1024x1024' }, { requestApproval: async (tool, input) => { seen.push(input); return 'DENY' } })
  await media.startVideo({ prompt: long, seconds: '4', size: '1280x720' }, { requestApproval: async (tool, input) => { seen.push(input); return 'DENY' } }).catch(() => {})
  assert.ok(seen.length === 2 && seen.every(input => input.truncated === true && !input.preview.includes('SECRET-SUFFIX')))
  const short = []
  await media.generateImage({ prompt: 'A castle', size: '1024x1024' }, { requestApproval: async (tool, input) => { short.push(input); return 'DENY' } })
  assert.equal(short[0].truncated, false)
})
