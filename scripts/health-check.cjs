// NAJD functional health check. Runs the capability matrix from isolated tests and smokes (temporary profiles, fake
// credentials; the owner's real AppData, chats and accounts are never read) and writes the result to a dedicated folder.
//   node scripts/health-check.cjs [--out <dir>] [--only <id,id>] [--skip-smoke]
// Each check has a timeout, its process tree is ended on timeout, output is kept in a bounded log file, and a failing
// check is retried at most RETRIES times (declared in the report) before the run moves on.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os')
const { spawn, spawnSync } = require('node:child_process')

const root = path.resolve(__dirname, '..')
const args = process.argv.slice(2)
const flag = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null }
const outDir = flag('--out') || path.join(os.homedir(), 'Documents', 'NAJD-health-check')
const only = (flag('--only') || '').split(',').filter(Boolean)
const skipSmoke = args.includes('--skip-smoke')
const RETRIES = 1, LOG_LIMIT = 200 * 1024
const exists = file => fs.existsSync(path.join(root, file))

// Status vocabulary: PASS / FAIL / BLOCKED (needs something outside NAJD) / NOT_TESTED / NOT_APPLICABLE.
// `cause` separates a NAJD defect (najd) from an unsupported tool (unsupported), missing setup (setup) and untested (untested).
const unit = (...files) => ({ kind: 'node', args: ['--test', ...files.map(f => 'tests/' + f)] })
const smoke = (file, ...extra) => ({ kind: 'node', args: ['tests/' + file, ...extra], smoke: true })
const MATRIX = [
  { id: 'boot-ui', capability: 'Startup and UI responsiveness', needs: 'build, Electron, temporary profile', method: 'Desktop smoke boots the app on a temporary profile and drives the UI', expected: 'Window opens, core screens respond', checks: [smoke('electron-ui-smoke.cjs')] },
  { id: 'engine-gateway', capability: 'Engine, gateway and process lifecycle', needs: 'bundled runtime for smokes', method: 'Unit tests of runtime manager/service and gateway adapter', expected: 'Start, health probe, stop leave no orphan', checks: [unit('runtime-manager.test.cjs', 'runtime-service.test.cjs', 'openclaw-gateway.test.cjs', 'engine-router.test.cjs')] },
  { id: 'chat-stream', capability: 'Chat, streaming and consecutive messages', needs: 'fake provider', method: 'Agent end-to-end smoke and chat presentation smoke with a scripted provider', expected: 'Streamed answer, ordered consecutive turns', checks: [smoke('agent-e2e-smoke.cjs'), smoke('chat-presentation-smoke.cjs')] },
  { id: 'tool-discovery', capability: 'Tool discovery, selection and input passing', needs: 'none', method: 'Agent runtime, toolsets, capability registry and MCP health unit tests', expected: 'Right schemas offered, arguments passed exactly, failures keep real codes', checks: [unit('agent-runtime.test.cjs', 'agent-toolsets.test.cjs', 'capability-registry.test.cjs', 'mcp-health.test.cjs')] },
  { id: 'access-approval', capability: 'Access modes, approval and denial', needs: 'none', method: 'Policy unit tests and workspace approval smoke', expected: 'Denied stays denied, approval shows exact scope', checks: [unit('action-policy.test.cjs', 'action-journal.test.cjs'), smoke('workspace-approval-smoke.cjs')] },
  { id: 'files-attachments', capability: 'Files and attachments', needs: 'none', method: 'File tool tests, attachment input smoke', expected: 'Scoped reads/writes, sensitive paths refused, attachments grounded', checks: [unit('file-tools.test.cjs', 'workspace-tools.test.cjs'), smoke('attachment-input-smoke.cjs')] },
  { id: 'powershell-python', capability: 'PowerShell and Python', needs: 'bundled Python/host for smokes', method: 'Process and Python tool tests; host smokes', expected: 'Approved run returns output, cancel ends the tree', checks: [unit('process-tools.test.cjs', 'python-tools.test.cjs'), smoke('process-host-smoke.cjs'), smoke('python-host-smoke.cjs')] },
  { id: 'browser-extension', capability: 'Browser and extension', needs: 'Edge with temporary profile', method: 'Bridge and tool unit tests; extension smoke in real Edge on a temporary profile', expected: 'Link, read, approved action; live acceptance in the owner browser is separate', checks: [unit('browser-bridge.test.cjs', 'browser-tools.test.cjs', 'browser-extension.test.cjs'), smoke('browser-extension-smoke.cjs')] },
  { id: 'desktop-control', capability: 'Desktop control', needs: 'bundled desktop host', method: 'Desktop tool tests and host smoke (fixture window only)', expected: 'Read/act only on approved fixture window', checks: [unit('desktop-tools.test.cjs'), smoke('desktop-host-smoke.cjs')] },
  { id: 'skills-plugins', capability: 'Skills and plugins', needs: 'none', method: 'Skill discovery, external skills, extensions tests', expected: 'Discovered, integrity-checked, loaded on demand', checks: [unit('skill-discovery.test.cjs', 'external-skills.test.cjs', 'extensions.test.cjs', 'instruction-skills.test.cjs')] },
  { id: 'mcp-fixture', capability: 'MCP client, lifecycle and per-tool readiness', needs: 'none', method: 'Fixture servers: connect, list, call, fail permanently, cancel, family kill', expected: 'Real error codes, no repeat of permanent failures, helpers end with the server', checks: [unit('mcp-servers.test.cjs', 'mcp-connectors.test.cjs', 'mcp-family.test.cjs', 'mcp-install-round2.test.cjs', 'mcp-health.test.cjs')] },
  { id: 'mcp-installed', capability: 'Installed MCP servers of the owner (REA, Trail-Code, Canva, fal)', needs: 'owner server list and credentials (AppData is not read here)', method: 'Not run by the health check: servers are only visible in the owner profile', expected: 'Connect, list tools, one harmless call per tool', checks: [], fixed: { status: 'BLOCKED', cause: 'setup', code: 'OWNER_PROFILE_NOT_READ', evidence: 'The owner server list lives in AppData; reading it is outside the allowed scope. Use Settings > Tools in the app: each tool now shows installed / connected / compatible / configured / last test.' } },
  { id: 'memory', capability: 'Memory (save, recall, edit, delete)', needs: 'none', method: 'Memory store tests with temporary data', expected: 'Test items saved, recalled, edited, deleted', checks: [unit('memory-store.test.cjs')] },
  { id: 'office', capability: 'Office files: create and review', needs: 'Office pack for smoke', method: 'Office pack tests and office smoke', expected: 'Files created and reviewed with findings', checks: [unit('office-pack.test.cjs', 'office-scan.test.cjs', 'office-review.test.cjs'), smoke('office-smoke.cjs')] },
  { id: 'media', capability: 'Images, audio and video generation', needs: 'provider key and credit (paid)', method: 'Unit tests with a fake service; real generation needs the owner approval of the cost', expected: 'Request shape, library storage, refusal without key', checks: [unit('media-generation.test.cjs', 'asset-library.test.cjs')], note: 'Real paid generation is NOT_TESTED until the owner approves the cost.' },
  { id: 'cancel-recovery', capability: 'Cancel, timeout, disconnect and recovery', needs: 'Electron', method: 'Run receipts, durable core tests, kill-recovery smoke', expected: 'Cancel ends work and says why; kill mid-write recovers', checks: [unit('run-receipts.test.cjs', 'durable-core.test.cjs', 'quit-watchdog.test.cjs'), smoke('electron-kill-recovery.cjs')] },
  { id: 'conversation-store', capability: 'Conversation save and restore', needs: 'none', method: 'Session store tests; corrupt data is preserved', expected: 'Round trip and corrupt-file quarantine', checks: [unit('session-store.test.cjs')] },
  { id: 'update-path', capability: 'Update path and verification (no publish, no install)', needs: 'none', method: 'Manifest, signature envelope and updater tests', expected: 'Altered or unsigned update refused', checks: [unit('update-manifest.test.cjs', 'updates.test.cjs')] },
  { id: 'diagnostics', capability: 'Redacted diagnostics export', needs: 'none', method: 'Diagnostics tests', expected: 'No secrets, shortened profile paths', checks: [unit('diagnostics.test.cjs', 'redact.test.cjs')] },
  { id: 'providers', capability: 'Model providers (catalog, endpoints, tool loop)', needs: 'keys for live calls', method: 'Provider unit tests with fakes; live calls need owner keys', expected: 'Routing, policy and tool-loop translation correct', checks: [unit('provider-service.test.cjs', 'provider-agent.test.cjs', 'provider-client.test.cjs', 'provider-policy.test.cjs')], note: 'Live model replies are NOT_TESTED without a key.' }
]

function runCommand(check, logFile, timeoutMs) {
  return new Promise(resolve => {
    const started = Date.now()
    const child = spawn(process.execPath, check.args, { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, NAJD_HEALTH_CHECK: '1' } })
    let log = '', timedOut = false
    const take = chunk => { if (log.length < LOG_LIMIT) log += chunk.toString('utf8') }
    child.stdout.on('data', take); child.stderr.on('data', take)
    const timer = setTimeout(() => { timedOut = true; try { spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }) } catch { child.kill() } }, timeoutMs)
    child.on('close', code => {
      clearTimeout(timer)
      fs.appendFileSync(logFile, `\n=== node ${check.args.join(' ')} (exit ${timedOut ? 'TIMEOUT' : code}, ${Date.now() - started} ms) ===\n${log}`)
      resolve({ code: timedOut ? null : code, timedOut, ms: Date.now() - started, tail: log.split('\n').slice(-12).join('\n') })
    })
    child.on('error', () => { clearTimeout(timer); resolve({ code: -1, timedOut: false, ms: Date.now() - started, tail: 'spawn failed' }) })
  })
}

function distributionRows() {
  const rows = []
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
  const installed = 'C:\\Program Files\\NAJD AGENT\\NAJD AGENT.exe'
  let installedVersion = null
  if (fs.existsSync(installed)) {
    const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', `(Get-Item -LiteralPath '${installed}').VersionInfo.ProductVersion`], { encoding: 'utf8', windowsHide: true, timeout: 20000 })
    installedVersion = (result.stdout || '').trim() || null
  }
  rows.push({ id: 'installed-version', capability: 'Installed build vs source version', needs: 'installed app', method: 'Read the installed executable product version (no launch)', expected: 'Installed equals source',
    status: installedVersion ? (installedVersion.startsWith(pkg.version) ? 'PASS' : 'FAIL') : 'NOT_APPLICABLE', actual: installedVersion ? `installed ${installedVersion}, source ${pkg.version}` : 'No installation in Program Files (a per-user install is not read)', code: installedVersion && !installedVersion.startsWith(pkg.version) ? 'INSTALLED_BEHIND_SOURCE' : null, evidence: 'file version info', cause: 'najd' })
  const exe = fs.existsSync(installed) ? installed : null
  let signature = null
  if (exe) {
    const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', `(Get-AuthenticodeSignature -LiteralPath '${exe}').Status`], { encoding: 'utf8', windowsHide: true, timeout: 30000 })
    signature = (result.stdout || '').trim() || null
  }
  rows.push({ id: 'signature', capability: 'Code signing of the executable (distribution item)', needs: 'a certificate (not bought here)', method: 'Get-AuthenticodeSignature status of the installed executable', expected: 'Valid',
    status: signature === 'Valid' ? 'PASS' : signature ? 'BLOCKED' : 'NOT_TESTED', actual: signature || 'not read', code: signature && signature !== 'Valid' ? 'NOT_SIGNED' : null,
    evidence: 'Authenticode status', cause: 'setup', note: 'A distribution gap, not a functional defect; tracked apart from the matrix. Needs a certificate and a signing step in the release path.' })
  return rows
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true })
  const logFile = path.join(outDir, 'health-check.log')
  fs.writeFileSync(logFile, `NAJD health check ${new Date().toISOString()}\n`)
  const results = []
  for (const row of MATRIX) {
    if (only.length && !only.includes(row.id)) continue
    const out = { id: row.id, capability: row.capability, needs: row.needs, method: row.method, expected: row.expected, note: row.note || null, code: null, evidence: null, attempts: 0, ms: 0 }
    if (row.fixed) { Object.assign(out, row.fixed, { actual: row.fixed.evidence }); results.push(out); console.log(out.status.padEnd(11), out.id); continue }
    const missingUnit = row.checks.flatMap(check => check.args.filter(a => a.startsWith('tests/'))).filter(file => !exists(file))
    if (missingUnit.length) { Object.assign(out, { status: 'NOT_TESTED', cause: 'untested', actual: 'Test file missing: ' + missingUnit.join(', '), code: 'CHECK_MISSING' }); results.push(out); continue }
    let failedDetail = null, ran = 0
    for (const check of row.checks) {
      if (check.smoke && skipSmoke) continue
      let result
      for (let attempt = 0; attempt <= RETRIES; attempt++) {
        out.attempts++
        result = await runCommand(check, logFile, check.smoke ? 300000 : 240000)
        if (result.code === 0) break
      }
      ran++; out.ms += result.ms
      if (result.code !== 0) { failedDetail = { check: check.args.join(' '), result }; break }
    }
    if (failedDetail) Object.assign(out, { status: 'FAIL', cause: 'najd?', actual: failedDetail.result.timedOut ? 'Timed out: ' + failedDetail.check : 'Exit ' + failedDetail.result.code + ': ' + failedDetail.check, code: failedDetail.result.timedOut ? 'CHECK_TIMEOUT' : 'CHECK_FAILED', evidence: failedDetail.result.tail.slice(-1500) })
    else if (!ran) Object.assign(out, { status: 'NOT_TESTED', cause: 'untested', actual: 'Smoke checks skipped by --skip-smoke', code: 'SKIPPED' })
    else Object.assign(out, { status: 'PASS', actual: `${ran} check group(s) passed on a temporary profile`, evidence: 'health-check.log' })
    results.push(out)
    console.log(out.status.padEnd(11), out.id, out.ms + ' ms')
  }
  if (!only.length) for (const row of distributionRows()) { results.push(row); console.log(row.status.padEnd(11), row.id) }
  const report = { schema: 1, createdAt: new Date().toISOString(), environment: 'development source tree (not the installed build)', retriesPerCheck: RETRIES, results }
  fs.writeFileSync(path.join(outDir, 'health-results.json'), JSON.stringify(report, null, 2))
  console.log('Results written to', outDir)
}
main().catch(error => { console.error(error); process.exit(2) })
