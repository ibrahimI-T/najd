// Resource budget for an installed NAJD (docs/PRODUCT-READINESS-PLAN.md, acceptance 1). Reads the report.json written by scripts/profile-najd.cjs and exits
// nonzero on any violation OR any missing measurement. CPU is percent of ONE logical core, unrounded from cpuOneCorePercent.
// Usage: node scripts/perf-budget.cjs <report.json>
const fs = require('node:fs')

const LIMITS = { idleVisibleCpu: 1.0, idleMinimizedCpu: 0.3, privateMemoryMB: 600, growthPercent: 5 }

function evaluateBudget(report) {
  const problems = []
  if (!report || typeof report !== 'object') return ['REPORT_MISSING']
  if (report.valid !== true) problems.push('RUN_INVALID: the profiler did not mark the run valid (identity, continuity, shutdown or ownership evidence is incomplete)')
  const phases = Array.isArray(report.phases) ? report.phases : []
  const phase = name => phases.find(item => item.name === name)
  const finite = value => typeof value === 'number' && Number.isFinite(value)
  for (const [name, limit, label] of [['idle-visible', LIMITS.idleVisibleCpu, 'idleVisibleCpu'], ['idle-minimized', LIMITS.idleMinimizedCpu, 'idleMinimizedCpu']]) {
    const item = phase(name)
    if (!item || !finite(item.cpuOneCorePercent)) { problems.push(`MISSING: ${name} CPU measurement`); continue }
    if (!(item.cpuOneCorePercent < limit)) problems.push(`CPU: ${name} ${item.cpuOneCorePercent}% of one core is not below ${limit}% (${label})`)
    if (item.seconds < 60) problems.push(`SHORT: ${name} measured for ${item.seconds}s, at least 60s required`)
  }
  for (const name of ['idle-visible', 'idle-minimized']) {
    const item = phase(name)
    if (!item) continue
    const peak = item.privateMB?.peak
    if (!finite(peak)) problems.push(`MISSING: ${name} private memory`)
    else if (!(peak < LIMITS.privateMemoryMB)) problems.push(`MEMORY: ${name} private memory peak ${peak} MB is not below ${LIMITS.privateMemoryMB} MB`)
    if (!item.handles || !finite(item.handles.growthPercent)) problems.push(`MISSING: ${name} handle growth`)
    else if (item.handles.growthPercent > LIMITS.growthPercent) problems.push(`HANDLES: ${name} handle growth ${item.handles.growthPercent}% exceeds ${LIMITS.growthPercent}%`)
    if (!item.threads || !finite(item.threads.start) || !finite(item.threads.end) || item.threads.start <= 0) problems.push(`MISSING: ${name} thread counts`)
    else if ((item.threads.end - item.threads.start) / item.threads.start * 100 > LIMITS.growthPercent) problems.push(`THREADS: ${name} thread growth exceeds ${LIMITS.growthPercent}%`)
  }
  return problems
}

module.exports = { LIMITS, evaluateBudget }
if (require.main === module) {
  let report = null
  try { report = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')) } catch { /* reported as missing */ }
  const problems = evaluateBudget(report)
  if (problems.length) { console.error('Resource budget NOT met:\n- ' + problems.join('\n- ')); process.exitCode = 1 } else console.log('Resource budget met.')
}
