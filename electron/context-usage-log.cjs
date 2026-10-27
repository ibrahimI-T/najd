// A small log of what each model request carried, so the owner can see what eats the context window: one JSON line
// per request with estimated token counts per part. Holds sizes and names only, never conversation text.
// Bounded: the file is cut to its newest half when it passes 1 MB.
const fs = require('node:fs/promises')
const path = require('node:path')

const MAX_BYTES = 1024 * 1024
const tokens = bytes => Math.ceil((Number(bytes) || 0) / 3.5)

function createContextUsageLog({ filePath, now = () => Date.now() }) {
  if (!path.isAbsolute(filePath || '')) throw Object.assign(new Error('INVALID_INPUT'), { code: 'INVALID_INPUT' })
  let queue = Promise.resolve()
  const serial = work => { const result = queue.then(work); queue = result.catch(() => {}); return result }
  async function trim() {
    const text = await fs.readFile(filePath, 'utf8').catch(() => '')
    if (Buffer.byteLength(text) <= MAX_BYTES) return
    const lines = text.split('\n').filter(Boolean)
    await fs.writeFile(filePath, lines.slice(Math.floor(lines.length / 2)).join('\n') + '\n')
  }
  return {
    // entry: { tier, windowTokens, profile, tools, instructionsBytes, toolsBytes, historyBytes, turnBytes, budgetBytes, condensed }
    record: entry => serial(async () => {
      const line = { at: new Date(now()).toISOString(), tier: String(entry.tier || ''), windowTokens: Number(entry.windowTokens) || null, profile: String(entry.profile || ''),
        tools: Number(entry.tools) || 0, instructions: tokens(entry.instructionsBytes), toolDefinitions: tokens(entry.toolsBytes), history: tokens(entry.historyBytes),
        taskSoFar: tokens(entry.turnBytes), condensed: Number(entry.condensed) || 0 }
      line.total = line.instructions + line.toolDefinitions + line.history + line.taskSoFar
      line.percent = entry.budgetBytes > 0 ? Math.round(((Number(entry.instructionsBytes) || 0) + (Number(entry.toolsBytes) || 0) + (Number(entry.historyBytes) || 0) + (Number(entry.turnBytes) || 0)) / entry.budgetBytes * 100) : null
      try {
        await fs.mkdir(path.dirname(filePath), { recursive: true })
        await fs.appendFile(filePath, JSON.stringify(line) + '\n')
        await trim()
      } catch { /* a log that cannot be written never stops a run */ }
    }),
    recent: (limit = 50) => serial(async () => {
      const text = await fs.readFile(filePath, 'utf8').catch(() => '')
      return text.split('\n').filter(Boolean).slice(-Math.min(500, Math.max(1, limit))).map(row => { try { return JSON.parse(row) } catch { return null } }).filter(Boolean)
    }),
    clear: () => serial(() => fs.rm(filePath, { force: true }))
  }
}

module.exports = { createContextUsageLog }
