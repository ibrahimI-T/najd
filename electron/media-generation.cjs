// Image and video generation through services the user connected with their own key.
// Only configured services are exposed. Every generation is a paid operation: it waits for an
// explicit in-chat approval naming the service and billing, runs once, and its output is saved
// to the NAJD workspace and library. No automatic retries and no silent provider switching.
const fs = require('node:fs/promises')
const { replaceFile } = require('./atomic-file.cjs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')

const fail = code => Object.assign(new Error(code), { code })
const API = 'https://api.openai.com/v1'
const IMAGE_SIZES = new Set(['1024x1024', '1536x1024', '1024x1536', 'auto'])
const VIDEO_SIZES = new Set(['1280x720', '720x1280'])
const VIDEO_SECONDS = new Set(['4', '8', '12'])

// onJobOutput(job, output) records a finished video with its conversation, whoever noticed the completion (APR-011).
function createMediaGeneration({ getOpenAIKey, workspace, saveToLibrary, jobs = null, onJobOutput = null, fetchImpl = globalThis.fetch }) {
  // One download per finished video job, shared by concurrent status reads (AP-006); finished results whose job
  // record could not be written yet wait here for the next read (APR-018).
  const fetching = new Map(), completions = new Map()
  // Job transitions whose record could not be saved yet (APR-027): kept with their original conversation and run,
  // retried before any other step for that job, and never a reason to repeat the paid request.
  const unsaved = new Map()
  const checkpoint = async record => {
    if (!jobs) return true
    const pending = unsaved.get(record.jobId)
    const merged = pending ? { ...pending, ...Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined && value !== null)) } : record
    try { await jobs.putJob(merged); unsaved.delete(record.jobId); return true }
    catch { unsaved.set(record.jobId, merged); return false }
  }
  const retryUnsaved = async jobId => { const pending = unsaved.get(jobId); return pending ? checkpoint(pending) : true }
  const safeName = prompt => prompt.replace(/[^\p{L}\p{N} _-]+/gu, ' ').trim().slice(0, 40).replace(/\s+/g, '-') || 'generated'
  async function key() { const value = await getOpenAIKey(); if (!value) throw fail('SERVICE_NOT_CONFIGURED'); return value }
  async function request(route, init, signal) {
    let response
    try { response = await fetchImpl(API + route, { ...init, signal: AbortSignal.any([AbortSignal.timeout(180000), ...(signal ? [signal] : [])]), redirect: 'error' }) }
    // A paid request that was sent and then lost (network failure, server error) may still have been accepted and billed.
    catch { throw Object.assign(fail(signal?.aborted ? 'CANCELLED' : 'SERVICE_UNAVAILABLE'), ['POST', 'DELETE'].includes(init?.method) ? { effectUnknown: true } : {}) }
    if (response.status === 401 || response.status === 403) throw fail('AUTH_REQUIRED')
    if (response.status === 429) throw fail('PROVIDER_RATE_LIMIT')
    if (response.status === 400) throw fail('REQUEST_REJECTED')
    if (!response.ok) throw Object.assign(fail('SERVICE_UNAVAILABLE'), ['POST', 'DELETE'].includes(init?.method) ? { effectUnknown: true } : {})
    return response
  }
  async function save(bytes, name, extension) {
    const directory = path.join(workspace, 'Generated')
    await fs.mkdir(directory, { recursive: true })
    const file = path.join(directory, `${new Date().toISOString().slice(0, 10)}-${name}-${randomUUID().slice(0, 6)}.${extension}`)
    await fs.writeFile(file, bytes, { flag: 'wx' })
    const asset = await saveToLibrary(file).catch(() => null)
    return { path: file, libraryId: asset?.id || null, markdown: asset ? `![${name}](najd-library://${asset.id})` : null }
  }

  return {
    // Jobs whose record is not saved yet, for background reconciliation (APR-027).
    unsavedJobs: () => [...unsaved.values()].map(record => ({ ...record })),
    services: async () => (await getOpenAIKey().catch(() => null)) ? ['openai-images', 'openai-video', 'openai-transcription'] : [],
    describe: { image: 'OpenAI Images (gpt-image-1), billed to your OpenAI API account', video: 'OpenAI video (sora-2), billed to your OpenAI API account' },

    // Speech to text for a video's stored sound track (paid; approved per request).
    async transcribe({ wav, seconds, name }, { requestApproval, signal }) {
      if (!Buffer.isBuffer(wav) || wav.length <= 44 || wav.length > 25 * 1024 * 1024 || !Number.isFinite(seconds) || seconds <= 0) throw fail('INVALID_INPUT')
      const apiKey = await key()
      if (typeof requestApproval !== 'function') throw fail('PERMISSION_DENIED')
      const minutes = Math.max(1, Math.ceil(seconds / 60))
      const decision = await requestApproval('najd-video-transcribe', { path: 'OpenAI transcription · gpt-4o-mini-transcribe · ' + String(name || 'video').slice(0, 80),
        summary: `Transcribe about ${minutes} minute${minutes > 1 ? 's' : ''} of this video's sound with your OpenAI API key. This is a paid request billed by OpenAI.`, preview: '' })
      if (decision !== 'ALLOW_ONCE') return { status: 'denied_by_user', note: 'Nothing was sent or billed.' }
      const form = new FormData()
      form.append('model', 'gpt-4o-mini-transcribe')
      form.append('response_format', 'json')
      form.append('file', new Blob([wav], { type: 'audio/wav' }), 'audio.wav')
      const response = await request('/audio/transcriptions', { method: 'POST', headers: { Authorization: 'Bearer ' + apiKey }, body: form }, signal)
      const body = await response.json().catch(() => null)
      if (typeof body?.text !== 'string') throw Object.assign(fail('SERVICE_UNAVAILABLE'), { effectUnknown: true })
      return { status: 'transcribed', text: body.text.slice(0, 20000), truncated: body.text.length > 20000 }
    },

    async generateImage({ prompt, size }, { requestApproval, signal }) {
      if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 4000 || !IMAGE_SIZES.has(size)) throw fail('INVALID_INPUT')
      const apiKey = await key()
      if (typeof requestApproval !== 'function') throw fail('PERMISSION_DENIED')
      const decision = await requestApproval('najd-image-generate', { path: 'OpenAI Images · gpt-image-1 · ' + size,
        summary: 'Generate one image with your OpenAI API key. This is a paid request billed by OpenAI.', preview: prompt.slice(0, 1200), truncated: prompt.length > 1200 })
      if (decision !== 'ALLOW_ONCE') return { status: 'denied_by_user', note: 'Nothing was generated or billed.' }
      const response = await request('/images/generations', { method: 'POST', headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'gpt-image-1', prompt, size, n: 1 }) }, signal)
      const body = await response.json().catch(() => null)
      const data = body?.data?.[0]?.b64_json
      if (typeof data !== 'string') throw Object.assign(fail('SERVICE_UNAVAILABLE'), { effectUnknown: true })
      // The paid image exists remotely: a local save failure must not look retryable (it would bill again).
      let stored
      try { stored = await save(Buffer.from(data, 'base64'), safeName(prompt), 'png') } catch { throw Object.assign(fail('SAVE_FAILED'), { effectUnknown: true }) }
      return { status: 'generated', ...stored }
    },

    async startVideo({ prompt, seconds, size }, { requestApproval, signal, conversationId = null, runId = null }) {
      if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 4000 || !VIDEO_SECONDS.has(seconds) || !VIDEO_SIZES.has(size)) throw fail('INVALID_INPUT')
      const apiKey = await key()
      if (typeof requestApproval !== 'function') throw fail('PERMISSION_DENIED')
      const decision = await requestApproval('najd-video-generate', { path: `OpenAI video · sora-2 · ${seconds}s · ${size}`,
        summary: 'Start one video generation job with your OpenAI API key. This is a paid request billed by OpenAI.', preview: prompt.slice(0, 1200), truncated: prompt.length > 1200 })
      if (decision !== 'ALLOW_ONCE') return { status: 'denied_by_user', note: 'Nothing was generated or billed.' }
      const response = await request('/videos', { method: 'POST', headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'sora-2', prompt, seconds, size }) }, signal)
      const body = await response.json().catch(() => null)
      // The request was accepted (HTTP success) but its answer is unusable: the job may exist and be billed.
      if (typeof body?.id !== 'string' || !/^[\w-]{1,128}$/.test(body.id)) throw Object.assign(fail('SERVICE_UNAVAILABLE'), { effectUnknown: true })
      const saved = await checkpoint({ jobId: body.id, conversationId, runId, state: body.status || 'queued', prompt })
      return { status: body.status || 'queued', jobId: body.id, note: 'Check progress with najd_video_status; it is not finished yet.' +
        (saved ? '' : ' The job was started, but NAJD could not save its record yet; it will retry. Do not start it again.') }
    },

    async videoStatus({ jobId, prompt }, { signal }) {
      if (typeof jobId !== 'string' || !/^[\w-]{1,128}$/.test(jobId)) throw fail('INVALID_INPUT')
      // One status read per job at a time: concurrent reads share it, so polling never overlaps (AP-006).
      if (fetching.has(jobId)) return fetching.get(jobId)
      const work = (async () => {
        // An acknowledged cancellation whose record is still unsaved wins over any status read (APR-027).
        if (unsaved.get(jobId)?.state === 'cancelled') { await retryUnsaved(jobId); return { status: 'cancelled' } }
        await retryUnsaved(jobId)
        // A finished job is answered from its stored record: no new request, download or file.
        const known = await jobs?.getJob(jobId).catch(() => null)
        if (known?.state === 'completed' && known.output) return { status: 'completed', ...known.output }
        // Other final states are answered from the record too (APR-003): nothing is fetched again.
        if (['failed', 'cancelled', 'expired'].includes(known?.state)) return { status: known.state }
        const apiKey = await key(), headers = { Authorization: 'Bearer ' + apiKey }
        const body = await (await request('/videos/' + jobId, { headers }, signal)).json().catch(() => null)
        if (!body || typeof body.status !== 'string') throw fail('SERVICE_UNAVAILABLE')
        if (body.status !== 'completed') {
          await jobs?.putJob({ jobId, state: body.status }).catch(() => {})
          return { status: body.status, progress: Number.isFinite(body.progress) ? body.progress : null }
        }
        // One file per job (APR-018): its name comes from the job id, so a retry or a restart reuses a video that
        // was already saved instead of downloading and writing it again.
        const file = path.join(workspace, 'Generated', 'video-' + jobId + '.mp4')
        const stillWanted = async () => { const latest = await jobs?.getJob(jobId).catch(() => null); return !['failed', 'cancelled', 'expired'].includes(latest?.state) ? null : latest.state }
        let output = completions.get(jobId) || null
        if (!output) {
          // Cancelled meanwhile (APR-014/019)? Then nothing is downloaded or written.
          const stopped = await stillWanted()
          if (stopped) return { status: stopped }
          // Only a file published by a complete write is reused; partial temporary files are replaced.
          if (!await fs.stat(file).then(stat => stat.isFile() && stat.size > 0, () => false)) {
            const content = await request('/videos/' + jobId + '/content', { headers }, signal)
            const bytes = Buffer.from(await content.arrayBuffer())
            if (!bytes.length || bytes.length > 500 * 1024 * 1024) throw fail('SERVICE_UNAVAILABLE')
            const late = await stillWanted()
            if (late) return { status: late }
            await fs.mkdir(path.dirname(file), { recursive: true })
            const part = file + '.part-' + process.pid
            await fs.writeFile(part, bytes)
            await replaceFile(part, file).catch(async error => { await fs.rm(part, { force: true }).catch(() => {}); throw error })
          }
          const name = safeName(typeof prompt === 'string' && prompt ? prompt : known?.prompt || 'video')
          const asset = await saveToLibrary(file).catch(() => null)
          output = { path: file, libraryId: asset?.id || null, markdown: asset ? `![${name}](najd-library://${asset.id})` : null }
        }
        // The job record is the durable checkpoint: if it cannot be written, the result is kept and the write is
        // retried on the next read, without another download (APR-018).
        let stored
        try {
          stored = !jobs ? { state: 'completed' } : typeof jobs.completeJob === 'function' ? await jobs.completeJob(jobId, output) : await jobs.putJob({ jobId, state: 'completed', output })
        }
        catch { completions.set(jobId, output); return { status: 'completed', ...output, note: 'Saved; recording the finished job will be retried.' } }
        completions.delete(jobId)
        // A cancellation that won the race keeps the job cancelled; the file that already exists is reported, not hidden.
        if (stored.state !== 'completed') return { status: stored.state, path: output.path, note: 'The job was cancelled while the finished video was being saved.' }
        // Stores without an atomic completeJob are told separately.
        if (typeof jobs?.completeJob !== 'function' && typeof onJobOutput === 'function') await Promise.resolve(onJobOutput(stored, output)).catch(() => {})
        return { status: 'completed', ...output }
      })()
      fetching.set(jobId, work)
      try { return await work } finally { fetching.delete(jobId) }
    },

    async cancelVideo({ jobId }, { signal }) {
      if (typeof jobId !== 'string' || !/^[\w-]{1,128}$/.test(jobId)) throw fail('INVALID_INPUT')
      await request('/videos/' + jobId, { method: 'DELETE', headers: { Authorization: 'Bearer ' + await key() } }, signal)
      const saved = await checkpoint({ jobId, state: 'cancelled' })
      return { status: 'cancelled', ...(saved ? {} : { note: 'Cancelled; NAJD could not save this yet and will retry.' }) }
    }
  }
}
module.exports = { createMediaGeneration }
