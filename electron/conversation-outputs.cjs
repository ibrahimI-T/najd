// Per-conversation outputs and background jobs (docs/AGENT-PLATFORM-PLAN.md AP-005/AP-006).
// Outputs are references {conversationId, runId, kind, path, libraryId, name, at}, separate from the content-
// addressed library so identical content created twice is still listed for each conversation. Video jobs are
// durable records {jobId, conversationId, runId, state, output}. Bounded, atomic writes; a corrupt file is preserved.
const fs = require('node:fs/promises')
const { replaceFile } = require('./atomic-file.cjs')
const path = require('node:path')
const FORMAT = 'najd-conversation-outputs-v1', MAX_OUTPUTS = 2000, MAX_JOBS = 200
const TERMINAL = new Set(['completed', 'failed', 'cancelled', 'expired'])
const fail = code => Object.assign(new Error(code), { code })
const validId = value => typeof value === 'string' && /^[A-Za-z0-9-]{1,80}$/.test(value)
const text = (value, size) => typeof value === 'string' ? value.slice(0, size) : null

function createConversationOutputs({ filePath }) {
  if (!path.isAbsolute(filePath || '')) throw fail('INVALID_INPUT')
  let data = null, loading = null, queue = Promise.resolve()
  // Every operation runs in order on one authoritative state (APR-006).
  const serial = work => { const next = queue.then(work); queue = next.catch(() => {}); return next }
  const load = () => data ? Promise.resolve(data) : (loading ||= loadOnce())
  async function loadOnce() {
    try {
      const parsed = JSON.parse(await fs.readFile(filePath, 'utf8'))
      if (parsed?.format !== FORMAT || !Array.isArray(parsed.outputs) || !Array.isArray(parsed.jobs)) throw new Error('format')
      data = parsed
    } catch (error) {
      if (error.code !== 'ENOENT') await fs.rename(filePath, filePath + '.corrupt-' + Date.now()).catch(() => {})
      data = { format: FORMAT, outputs: [], jobs: [] }
    }
    return data
  }
  // A change becomes the authoritative state only after it reached the disk (APR-013).
  async function commit(next) {
    const temp = filePath + '.tmp-' + process.pid
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(temp, JSON.stringify(next))
    await replaceFile(temp, filePath)
    data = next
  }
  return {
    async addOutput({ conversationId, runId, kind, path: target, libraryId, name }) {
      if (!validId(conversationId) || (runId != null && !validId(runId))) throw fail('INVALID_INPUT')
      return serial(async () => {
        const store = await load()
        const entry = { conversationId, runId: runId || null, kind: text(kind, 20) || 'file', path: text(target, 1000), libraryId: text(libraryId, 64),
          name: text(name, 200) || (target ? path.basename(String(target)) : 'output'), at: Date.now() }
        // The same output recorded twice (e.g. write then edit, or a video seen by chat and in the background) is one.
        if (store.outputs.some(item => item.conversationId === conversationId && item.path === entry.path && item.libraryId === entry.libraryId &&
          (item.runId === entry.runId || entry.kind === 'media'))) return false
        const outputs = [...store.outputs, entry]
        await commit({ ...store, outputs: outputs.length > MAX_OUTPUTS ? outputs.slice(outputs.length - MAX_OUTPUTS) : outputs })
        return true
      })
    },
    async outputs(conversationId) {
      if (!validId(conversationId)) throw fail('INVALID_INPUT')
      return (await serial(load)).outputs.filter(item => item.conversationId === conversationId).map(item => ({ ...item }))
    },
    // A final state is final (APR-014): a late status read can never reopen a cancelled, failed or finished job.
    // Returns the stored record after the call (unchanged when the update was rejected).
    async putJob({ jobId, conversationId = null, runId = null, state, prompt, output }) {
      if (typeof jobId !== 'string' || !/^[\w-]{1,128}$/.test(jobId) || (conversationId !== null && !validId(conversationId)) || (runId !== null && !validId(runId))) throw fail('INVALID_INPUT')
      return serial(async () => {
        const store = await load()
        const existing = store.jobs.find(job => job.jobId === jobId)
        if (existing && TERMINAL.has(existing.state)) return { ...existing }
        const next = { jobId, conversationId: existing?.conversationId ?? conversationId, runId: existing?.runId ?? runId,
          state: text(state, 20) || existing?.state || 'queued', prompt: text(prompt, 200) ?? existing?.prompt ?? null,
          output: output ?? existing?.output ?? null, updatedAt: Date.now() }
        const jobs = existing ? store.jobs.map(job => job.jobId === jobId ? next : job) : [...store.jobs, next]
        await commit({ ...store, jobs: jobs.length > MAX_JOBS ? jobs.slice(jobs.length - MAX_JOBS) : jobs })
        return { ...next }
      })
    },
    // Completion and the conversation's output reference in one commit (APR-023), so a finished video can never be
    // missing from its conversation. Final states stay final (APR-014).
    completeJob(jobId, output) {
      if (typeof jobId !== 'string' || !/^[\w-]{1,128}$/.test(jobId) || typeof output?.path !== 'string') return Promise.reject(fail('INVALID_INPUT'))
      return serial(async () => {
        const store = await load()
        const existing = store.jobs.find(job => job.jobId === jobId)
        if (existing && TERMINAL.has(existing.state)) return { ...existing }
        const next = { jobId, conversationId: existing?.conversationId ?? null, runId: existing?.runId ?? null, state: 'completed',
          prompt: existing?.prompt ?? null, output: { path: text(output.path, 1000), libraryId: text(output.libraryId, 64), markdown: text(output.markdown, 300) }, updatedAt: Date.now() }
        const jobs = existing ? store.jobs.map(job => job.jobId === jobId ? next : job) : [...store.jobs, next]
        let outputs = store.outputs
        if (next.conversationId && !outputs.some(item => item.conversationId === next.conversationId && item.path === next.output.path)) {
          outputs = [...outputs, { conversationId: next.conversationId, runId: next.runId, kind: 'media', path: next.output.path, libraryId: next.output.libraryId,
            name: path.basename(next.output.path), at: Date.now() }]
          if (outputs.length > MAX_OUTPUTS) outputs = outputs.slice(outputs.length - MAX_OUTPUTS)
        }
        await commit({ ...store, jobs, outputs })
        return { ...next }
      })
    },
    async getJob(jobId) { const job = (await serial(load)).jobs.find(item => item.jobId === jobId); return job ? { ...job } : null },
    // Jobs not yet in a final state, for background reconciliation (APR-003).
    async activeJobs() { return (await serial(load)).jobs.filter(job => !TERMINAL.has(job.state)).map(job => ({ ...job })) },
    async jobs(conversationId) {
      if (!validId(conversationId)) throw fail('INVALID_INPUT')
      return (await serial(load)).jobs.filter(job => job.conversationId === conversationId).map(job => ({ ...job }))
    },
    // Deleting a conversation removes its output references and job records; the files themselves stay where the
    // user's workspace and library keep them (APR-015).
    removeConversation(conversationId) {
      if (!validId(conversationId)) return Promise.reject(fail('INVALID_INPUT'))
      return serial(async () => {
        const store = await load()
        const outputs = store.outputs.filter(item => item.conversationId !== conversationId)
        const jobs = store.jobs.filter(job => job.conversationId !== conversationId)
        if (outputs.length === store.outputs.length && jobs.length === store.jobs.length) return 0
        await commit({ ...store, outputs, jobs })
        return store.outputs.length - outputs.length + store.jobs.length - jobs.length
      })
    },
    flush: () => serial(() => undefined)
  }
}
module.exports = { createConversationOutputs }
