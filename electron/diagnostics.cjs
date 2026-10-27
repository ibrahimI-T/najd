// A local diagnostics bundle the owner can save and share by choice: versions, platform, component states, recent activity and recent errors.
// Nothing is sent anywhere. Every text value passes the same secret masking as the activity timeline, paths under the user's profile are shortened,
// and conversation text, memory, keys and settings are never included.
const fs = require('node:fs')
const path = require('node:path')
const { redactText } = require('./redact.cjs')

const ERROR_LOG_LIMIT = 256 * 1024

// Appends one error line to a size-capped log: when the file passes the limit the older half is dropped.
function createErrorLog({ filePath, limit = ERROR_LOG_LIMIT }) {
  function record(kind, error) {
    try {
      const message = String(error && error.stack ? error.stack : error).slice(0, 4000)
      fs.mkdirSync(path.dirname(filePath), { recursive: true })
      fs.appendFileSync(filePath, JSON.stringify({ at: new Date().toISOString(), kind, message: redactText(message, 4000) }) + '\n')
      if (fs.statSync(filePath).size > limit) {
        const lines = fs.readFileSync(filePath, 'utf8').split('\n').filter(Boolean)
        fs.writeFileSync(filePath, lines.slice(Math.floor(lines.length / 2)).join('\n') + '\n')
      }
    } catch { /* the error log must never break the app */ }
  }
  function tail(count = 50) {
    try { return fs.readFileSync(filePath, 'utf8').split('\n').filter(Boolean).slice(-count).map(line => { try { return JSON.parse(line) } catch { return null } }).filter(Boolean) } catch { return [] }
  }
  return { record, tail }
}

// Activity entries are reduced to an allowlist: when, what kind of action, the decision and a reason code. Free-form text (commands, paths, messages)
// is never exported, so a secret in an unusual form cannot leave through the bundle; masking below is only a second layer.
const CODE = /^[A-Za-z][A-Za-z0-9_:.-]{0,40}$/
function safeActivity(entry) {
  const out = {}
  if (typeof entry?.time === 'string' && Number.isFinite(Date.parse(entry.time))) out.time = new Date(entry.time).toISOString()
  for (const key of ['action', 'decision', 'reason']) if (typeof entry?.[key] === 'string' && CODE.test(entry[key])) out[key] = entry[key]
  return out
}

const slashes = text => text.split(String.fromCharCode(92)).join('/')

function createDiagnostics({ versions, platform, homeDirectory, components = {}, activityTail = () => [], errorTail = () => [], crashDirectory = null, now = () => new Date() }) {
  const home = homeDirectory ? slashes(homeDirectory).toLowerCase() : null
  // Any "<drive>:/Users/<name>" path: the owner's own profile becomes %USERPROFILE%, other profiles a placeholder.
  const profilePath = /[A-Za-z]:[\\/]Users[\\/][^\\/\s"']+/gi
  const clean = value => {
    let text = redactText(String(value), 1200)
    text = text.replace(profilePath, match => (home && slashes(match).toLowerCase() === home ? '%USERPROFILE%' : 'C:/Users/<user>'))
    return text
  }
  const scrub = value => {
    if (typeof value === 'string') return clean(value)
    if (Array.isArray(value)) return value.map(scrub)
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, scrub(item)]))
    return value
  }
  async function bundle() {
    const states = {}
    for (const [name, read] of Object.entries(components)) {
      try { states[name] = scrub(await read()) } catch (error) { states[name] = { error: String(error?.code || error?.message || 'UNAVAILABLE').slice(0, 80) } }
    }
    let crashes = []
    try {
      if (crashDirectory) crashes = fs.readdirSync(crashDirectory, { recursive: true, withFileTypes: true }).filter(entry => entry.isFile() && /\.(dmp|json|txt)$/i.test(entry.name))
        .map(entry => ({ name: entry.name, bytes: fs.statSync(path.join(entry.parentPath || entry.path || crashDirectory, entry.name)).size })).slice(0, 20)
    } catch { crashes = [] }
    return {
      schema: 1, createdAt: now().toISOString(),
      note: 'Created locally by NAJD. No conversations, memory, keys or settings values are included; text is secret-masked and profile paths are shortened.',
      versions: scrub(versions), platform: scrub(platform), components: states,
      recentErrors: scrub(errorTail()), recentActivity: activityTail().map(safeActivity), crashDumps: crashes
    }
  }
  return { bundle }
}
module.exports = { createDiagnostics, createErrorLog, ERROR_LOG_LIMIT }
