// Host resource preflight before heavy steps (npm run dist, profiling). Read-only.
// Exit 1 when available RAM < 4 GB or committed memory >= 80% of the commit limit; prints the measured values.
const { execFileSync } = require('node:child_process')
const os = require('node:os')

const LIMITS = { minAvailableMB: 4096, maxCommitRatio: 0.8 }

function decide({ availableMB, committedMB, commitLimitMB }, limits = LIMITS) {
  const ratio = commitLimitMB > 0 ? committedMB / commitLimitMB : 1
  const reasons = []
  if (!(availableMB >= limits.minAvailableMB)) reasons.push(`available RAM ${availableMB} MB < ${limits.minAvailableMB} MB`)
  if (!(ratio < limits.maxCommitRatio)) reasons.push(`commit ${Math.round(ratio * 100)}% >= ${Math.round(limits.maxCommitRatio * 100)}% of limit`)
  return { ok: reasons.length === 0, ratio, reasons }
}

function measure() {
  // Win32_OperatingSystem: TotalVirtualMemorySize = commit limit, FreeVirtualMemory = remaining commit (KB).
  const json = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    'Get-CimInstance Win32_OperatingSystem | Select-Object FreePhysicalMemory,TotalVirtualMemorySize,FreeVirtualMemory | ConvertTo-Json -Compress'],
    { encoding: 'utf8', windowsHide: true, timeout: 60000 })
  const value = JSON.parse(json)
  const commitLimitMB = Math.round(value.TotalVirtualMemorySize / 1024)
  return { availableMB: Math.round(os.freemem() / 1048576), committedMB: commitLimitMB - Math.round(value.FreeVirtualMemory / 1024), commitLimitMB }
}

function preflight() {
  const values = measure(), result = decide(values)
  return { ...values, ...result }
}

if (require.main === module) {
  const result = preflight()
  console.log(`host preflight: available ${result.availableMB} MB, commit ${result.committedMB}/${result.commitLimitMB} MB (${Math.round(result.ratio * 100)}%) -> ${result.ok ? 'OK' : 'BLOCKED: ' + result.reasons.join('; ')}`)
  process.exitCode = result.ok ? 0 : 1
}
module.exports = { decide, measure, preflight, LIMITS }
