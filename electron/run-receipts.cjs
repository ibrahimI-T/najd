// Main-owned run receipts (docs/AGENT-PLATFORM-PLAN.md AP-004/AP-005): one record per agent run, keyed by the
// core task id, bound to its conversation, saved for completed, failed and cancelled runs alike. Idempotent per
// run id, bounded, written atomically; a corrupt file is preserved and never silently replaced.
const fs = require('node:fs/promises')
const { replaceFile } = require('./atomic-file.cjs')
const path = require('node:path')
const FORMAT = 'najd-run-receipts-v1', MAX = 3000
const fail = code => Object.assign(new Error(code), { code })
const validId = value => typeof value === 'string' && /^[A-Za-z0-9-]{1,80}$/.test(value)
const { validWindow } = require('./model-window.cjs')
const num = value => Number.isFinite(value) && value >= 0 ? Math.round(value) : null

// Effective execution windows NAJD knows for certain: Ollama runs with num_ctx 16384 in NAJD (ollama.cjs).
const KNOWN_WINDOWS = { ollama: 16384 }
function clean({ runId, conversationId, state, receipt, at, provider, modelName, contextWindow }) {
  const usage = receipt?.usage || {}
  const request = receipt?.request || null
  return {
    runId, conversationId, state: String(state || '').slice(0, 20), at: Number.isFinite(at) ? at : Date.now(),
    provider: typeof provider === 'string' ? provider.slice(0, 30) : null, modelName: typeof modelName === 'string' ? modelName.slice(0, 128) : null,
    // The window of the model the run used, as its provider listed it (model-window.cjs) when NAJD does not fix it.
    contextWindow: KNOWN_WINDOWS[provider] || validWindow(contextWindow) || null,
    outcome: String(receipt?.outcome || '').slice(0, 20), profile: String(receipt?.profile || '').slice(0, 30),
    toolsets: Array.isArray(receipt?.toolsets) ? receipt.toolsets.filter(name => typeof name === 'string').slice(0, 24) : [],
    toolCalls: num(receipt?.toolCalls) ?? 0,
    usage: { input: num(usage.input), output: num(usage.output), total: num(usage.total), cached: num(usage.cached),
      modelCalls: num(usage.modelCalls) ?? 0, partial: usage.partial === true || (Array.isArray(usage.partialFields) && usage.partialFields.length > 0) },
    request: request ? { instructionsBytes: num(request.instructionsBytes), toolsBytes: num(request.toolsBytes), turnBytes: num(request.turnBytes),
      historyBytes: num(request.historyBytes), opaqueBytes: num(request.opaqueBytes), images: num(request.images) ?? 0 } : null
  }
}

// Lifetime totals of one conversation: a field is null when no run reported it, partial when some did not (APR-010).
function addRun(total, run) {
  const next = total ? { ...total } : { runs: 0, input: null, output: null, total: null, cached: null, modelCalls: 0, toolCalls: 0, partial: false }
  if (!run) return next
  next.runs++
  for (const key of ['input', 'output', 'total', 'cached']) {
    if (run.usage[key] === null) { if (key !== 'cached') next.partial = true }
    else next[key] = (next[key] ?? 0) + run.usage[key]
  }
  next.partial = next.partial || run.usage.partial
  next.modelCalls += run.usage.modelCalls; next.toolCalls += run.toolCalls
  return next
}
function rebuild(runs) { const result = {}; for (const run of runs) result[run.conversationId] = addRun(result[run.conversationId], run); return result }

function createRunReceipts({ filePath, maxRuns = MAX }) {
  if (!path.isAbsolute(filePath || '')) throw fail('INVALID_INPUT')
  let cache = null, aggregates = null, loading = null, queue = Promise.resolve(), corrupt = false
  // Every operation runs in order on one authoritative state (APR-006).
  const serial = work => { const next = queue.then(work); queue = next.catch(() => {}); return next }
  const load = () => cache ? Promise.resolve(cache) : (loading ||= loadOnce())
  async function loadOnce() {
    try {
      const data = JSON.parse(await fs.readFile(filePath, 'utf8'))
      if (data?.format !== FORMAT || !Array.isArray(data.runs)) throw new Error('format')
      cache = data.runs
      // Files written before aggregates existed get them from their detailed runs once.
      aggregates = data.aggregates && typeof data.aggregates === 'object' ? data.aggregates : rebuild(data.runs)
    } catch (error) {
      if (error.code === 'ENOENT') { cache = []; aggregates = {} }
      else {
        // Keep the unreadable file for inspection; continue with an empty in-memory list.
        corrupt = true
        await fs.rename(filePath, filePath + '.corrupt-' + Date.now()).catch(() => {})
        cache = []; aggregates = {}
      }
    }
    return cache
  }
  // A change becomes the authoritative state only after it reached the disk (APR-013): a failed write leaves
  // the previous state, so the same receipt can be recorded again.
  async function commit(next, nextAggregates) {
    const temp = filePath + '.tmp-' + process.pid
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(temp, JSON.stringify({ format: FORMAT, runs: next, aggregates: nextAggregates }))
    await replaceFile(temp, filePath)
    cache = next; aggregates = nextAggregates
  }
  return {
    record(entry) {
      if (!validId(entry?.runId) || !validId(entry?.conversationId)) return Promise.reject(fail('INVALID_INPUT'))
      return serial(async () => {
        const runs = await load()
        if (runs.some(run => run.runId === entry.runId)) return false // idempotent per run
        const row = clean(entry)
        const next = [...runs, row]
        await commit(next.length > maxRuns ? next.slice(next.length - maxRuns) : next, { ...aggregates, [row.conversationId]: addRun(aggregates[row.conversationId], row) })
        return true
      })
    },
    async list(conversationId) {
      if (!validId(conversationId)) throw fail('INVALID_INPUT')
      return (await serial(load)).filter(run => run.conversationId === conversationId).map(run => structuredClone(run))
    },
    // Totals for a conversation (APR-010): a field is null when no run reported it, and partial when some did not.
    async totals(conversationId) {
      if (!validId(conversationId)) throw fail('INVALID_INPUT')
      await serial(load)
      return { ...(aggregates[conversationId] || addRun(null, null)) }
    },
    async lastProfile(conversationId) {
      if (!validId(conversationId)) return null
      return (await serial(load)).filter(run => run.conversationId === conversationId && run.profile).at(-1)?.profile || null
    },
    // Deleting a conversation removes its receipts (APR-015).
    removeConversation(conversationId) {
      if (!validId(conversationId)) return Promise.reject(fail('INVALID_INPUT'))
      return serial(async () => {
        const runs = await load()
        if (!runs.some(run => run.conversationId === conversationId) && !aggregates[conversationId]) return 0
        const next = runs.filter(run => run.conversationId !== conversationId)
        const nextAggregates = { ...aggregates }; delete nextAggregates[conversationId]
        await commit(next, nextAggregates)
        return runs.length - next.length
      })
    },
    corrupt: () => corrupt,
    // Resolves once every queued write has finished (used before quitting).
    flush: () => serial(() => undefined)
  }
}
module.exports = { createRunReceipts }
