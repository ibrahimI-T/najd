// Fail-closed external-content scan (docs/AGENT-PLATFORM-M3-PLAN.md, M3-010/M3-014): run on a private copy before any
// Office application may open it. Any reason found keeps the Office route closed for that file. The work happens in a
// worker thread with a memory budget, byte limits and a time limit, and can be cancelled (M3-I005).
const path = require('node:path')
const { Worker } = require('node:worker_threads')

const LIMITS = { maxInput: 100 * 1024 * 1024, maxParts: 4000, maxPart: 64 * 1024 * 1024, maxTotal: 256 * 1024 * 1024 }
// Reasons meaning the package itself was not read through (as opposed to risky content found in a package that was).
const UNCHECKED = new Set(['package too large to check', 'not an Office Open XML package (encrypted or damaged)', 'package could not be checked',
  'package could not be checked in time', 'scan cancelled'])

function scanOffice(file, { signal, timeoutMs = 60000, limits = LIMITS } = {}) {
  return new Promise(resolve => {
    if (signal?.aborted) { resolve(['scan cancelled']); return }
    const worker = new Worker(path.join(__dirname, 'office-scan-worker.cjs'), { workerData: { file, limits }, resourceLimits: { maxOldGenerationSizeMb: 768, maxYoungGenerationSizeMb: 64 } })
    let settled = false
    const finish = reasons => { if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort); void worker.terminate(); resolve(reasons) }
    const abort = () => finish(['scan cancelled'])
    const timer = setTimeout(() => finish(['package could not be checked in time']), timeoutMs)
    signal?.addEventListener('abort', abort, { once: true })
    worker.once('message', message => finish(Array.isArray(message?.reasons) ? message.reasons : ['package could not be checked']))
    worker.once('error', () => finish(['package could not be checked']))
    worker.once('exit', () => finish(['package could not be checked']))
  })
}

module.exports = { scanOffice, LIMITS, UNCHECKED }
