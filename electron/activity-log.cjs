const fs = require('node:fs')
const path = require('node:path')

function sanitize(entry) {
  const clean = {}
  if (entry && typeof entry === 'object') {
    for (const key of ['time', 'action', 'decision', 'path', 'reason']) {
      if (typeof entry[key] === 'string') clean[key] = entry[key].slice(0, key === 'path' ? 1024 : 128)
    }
  }
  if (typeof clean.time !== 'string' || !Number.isFinite(Date.parse(clean.time))) clean.time = new Date().toISOString()
  return clean
}

function parseEntries(text) {
  const entries = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    try {
      const parsed = JSON.parse(line)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) entries.push(sanitize(parsed))
    } catch { /* skip corrupt line */ }
  }
  return entries
}

function createActivityLog({ filePath, maxEntries = 200 }) {
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) throw Object.assign(new Error('INVALID_INPUT'), { code: 'INVALID_INPUT' })
  let unchecked = 0

  function record(entry) {
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true })
      fs.appendFileSync(filePath, JSON.stringify(sanitize(entry)) + '\n')
      unchecked++
      if (unchecked < maxEntries) return
      unchecked = 0
      const entries = parseEntries(fs.readFileSync(filePath, 'utf8'))
      if (entries.length > maxEntries * 2) {
        const kept = entries.slice(-maxEntries)
        fs.writeFileSync(filePath, kept.map(item => JSON.stringify(item)).join('\n') + '\n')
      }
    } catch { /* fail closed: the log is never allowed to break the app */ }
  }

  function tail(n) {
    try {
      const count = Math.max(0, Math.min(Math.trunc(n) || 0, maxEntries))
      if (count === 0) return []
      return parseEntries(fs.readFileSync(filePath, 'utf8')).slice(-count)
    } catch { return [] }
  }

  return { record, tail }
}

module.exports = { createActivityLog }
