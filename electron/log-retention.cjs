// Retention for the files NAJD writes that have no owner of their own (Phase 14 R2). Every other log keeps its own cap:
// errors.jsonl 256 KB, context-usage 1 MB, the activity log 200 entries, command logs exec-logs.cjs prune().
const fs = require('node:fs')
const path = require('node:path')

const DAY = 24 * 60 * 60 * 1000

// A line log over limit keeps its newest half, cut at a line boundary.
function trimFile(filePath, limit = 256 * 1024) {
  try {
    if (fs.statSync(filePath).size <= limit) return false
    const lines = fs.readFileSync(filePath, 'utf8').split('\n').filter(Boolean)
    fs.writeFileSync(filePath, lines.slice(Math.floor(lines.length / 2)).join('\n') + '\n')
    return true
  } catch { return false }
}

// Files under a directory (recursively) that match pattern: older than maxAgeMs are removed, then the oldest beyond
// maxFiles. Links are never followed and nothing outside the directory is touched.
function pruneDirectory(directory, { pattern = /\.(dmp|json|txt)$/i, maxFiles = 20, maxAgeMs = 30 * DAY, now = Date.now() } = {}) {
  let entries
  try { entries = fs.readdirSync(directory, { recursive: true, withFileTypes: true }) } catch { return 0 }
  const files = entries.filter(entry => entry.isFile() && pattern.test(entry.name))
    .map(entry => { const file = path.join(entry.parentPath || entry.path || directory, entry.name); try { return { file, time: fs.lstatSync(file).mtimeMs } } catch { return null } })
    .filter(Boolean).sort((a, b) => b.time - a.time)
  let removed = 0
  files.forEach((item, index) => {
    if (index < maxFiles && now - item.time <= maxAgeMs) return
    try { fs.rmSync(item.file, { force: true }); removed++ } catch {}
  })
  return removed
}

module.exports = { trimFile, pruneDirectory }
