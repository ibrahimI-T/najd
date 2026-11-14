// Runs every automated check of NAJD in sequence on the current build and writes one report (R-080): unit tests, the build, the UI and
// flow smokes from source and packaged, the engine and host smokes, the browser-extension smokes in Edge, the real third-party MCP
// servers, Blender and the Android build on the emulator. Each check runs on its own with a time limit; a failure does not stop the
// rest. Usage: node scripts/verify-all.cjs [--out report.json]
const { spawnSync } = require('node:child_process')
const fs = require('node:fs'), path = require('node:path')

const root = path.join(__dirname, '..')
const CHECKS = [
  ['unit tests', 'npm.cmd', ['test']],
  ['build (types, Vue check, bundle)', 'npm.cmd', ['run', 'build']],
  ['workstation UI', 'node', ['tests/workstation-ui-smoke.cjs']],
  ['desktop flows', 'node', ['tests/desktop-flows-smoke.cjs']],
  ['feature flows', 'node', ['tests/vue-features-smoke.cjs']],
  ['packaged: desktop flows', 'node', ['tests/desktop-flows-smoke.cjs', '--packaged']],
  ['packaged: workstation UI', 'node', ['tests/workstation-ui-smoke.cjs', '--packaged']],
  ['packaged: feature flows', 'node', ['tests/vue-features-smoke.cjs', '--packaged']],
  ['agent end to end (real Python)', 'node', ['tests/agent-e2e-smoke.cjs']],
  ['desktop host (real window)', 'node', ['tests/desktop-host-smoke.cjs']],
  ['Python host', 'node', ['tests/python-host-smoke.cjs']],
  ['process host', 'node', ['tests/process-host-smoke.cjs']],
  ['Office pack', 'node', ['tests/office-smoke.cjs']],
  ['Blender (real)', 'node', ['tests/blender-host-smoke.cjs']],
  ['Android build + emulator', 'node', ['tests/android-build-smoke.cjs', '--emulator']],
  ['real MCP servers from npm', 'node', ['tests/mcp-real-servers-smoke.cjs']],
  ['browser extension 2.x (Edge)', 'node', ['tests/browser-extension-v2-smoke.cjs']],
  ['browser sign-in 2.x (Edge)', 'node', ['tests/browser-login-smoke.cjs', '--v2']],
  ['browser sign-in 1.x (Edge)', 'node', ['tests/browser-login-smoke.cjs']],
  ['kill recovery', 'node', ['tests/electron-kill-recovery.cjs']],
  ['single instance', 'node', ['tests/app-instance-smoke.cjs']],
  ['tray quit', 'node', ['tests/tray-quit-smoke.cjs']],
  ['quit with the desktop pet shown', 'node', ['tests/pet-quit-smoke.cjs']],
  ['plain greeting carries only discovery', 'node', ['tests/greeting-tools-smoke.cjs']]
]

const outIndex = process.argv.indexOf('--out')
const out = outIndex > 0 ? process.argv[outIndex + 1] : path.join(root, 'release', 'verify-all.json')
const results = []
for (const [name, command, args] of CHECKS) {
  const began = Date.now()
  const run = spawnSync(command, args, { cwd: root, encoding: 'utf8', shell: command.endsWith('.cmd'), timeout: 30 * 60 * 1000, maxBuffer: 64 * 1024 * 1024 })
  const text = `${run.stdout || ''}${run.stderr || ''}`
  const lines = text.split(/\r?\n/).filter(line => line.trim())
  const summary = lines.filter(line => /^(PASS|SKIPPED)|passed|ℹ (pass|fail)|Tests +\d/.test(line)).slice(-3).join(' | ') || lines.slice(-2).join(' | ')
  const row = { name, ok: run.status === 0 && !/^SKIPPED/m.test(text), skipped: /^SKIPPED/m.test(text), seconds: Math.round((Date.now() - began) / 1000), summary: summary.slice(0, 400) }
  results.push(row)
  console.log(`${row.ok ? 'PASS' : row.skipped ? 'SKIP' : 'FAIL'} ${name} (${row.seconds}s): ${row.summary}`)
  fs.mkdirSync(path.dirname(out), { recursive: true })
  fs.writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), version: require(path.join(root, 'package.json')).version, results }, null, 1))
}
const failed = results.filter(row => !row.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed${failed.length ? '; failed: ' + failed.map(row => row.name).join(', ') : ''}.`)
process.exitCode = failed.length ? 1 : 0
