// Tracks whether this version has ever started cleanly. Every launch counts an attempt; reaching a healthy state (components ready and the engine
// or the window stable) resets it. Several launches in a row that never became healthy mean the installed version is not working on this computer,
// and Settings says so and points to the previous version whose components are kept (see bundle-runtime.cjs). The record is tiny and local.
const fs = require('node:fs')
const path = require('node:path')

const UNSTABLE_AFTER = 3

function createStartupGuard({ filePath, version }) {
  let record = { version, attempts: 0, healthy: false }
  const save = () => { try { fs.mkdirSync(path.dirname(filePath), { recursive: true }); fs.writeFileSync(filePath, JSON.stringify(record)) } catch { /* the guard never blocks startup */ } }
  return {
    begin() {
      try {
        const saved = JSON.parse(fs.readFileSync(filePath, 'utf8'))
        // A new version starts with a clean slate; the same version keeps counting its failed starts.
        if (saved && saved.version === version && Number.isSafeInteger(saved.attempts) && saved.attempts >= 0) record = { version, attempts: saved.attempts, healthy: saved.healthy === true }
      } catch { /* first launch or an unreadable record: start counting */ }
      if (!record.healthy) record.attempts++
      save()
      return this.status()
    },
    markHealthy() {
      if (record.healthy && record.attempts === 0) return
      record = { version, attempts: 0, healthy: true }
      save()
    },
    status: () => ({ version, attempts: record.attempts, healthy: record.healthy, unstable: !record.healthy && record.attempts >= UNSTABLE_AFTER })
  }
}
module.exports = { createStartupGuard, UNSTABLE_AFTER }
