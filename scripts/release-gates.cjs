// Release gates that are enforced, not advisory. `node scripts/release-gates.cjs --run` runs every required gate against the current commit and the built
// installer, and writes release/<version>/gate-evidence.json. sign-release.cjs and publish-release.cjs call assertEvidence() and refuse to continue when the
// evidence is missing, failed, stale, from another commit or version, from a dirty tree, or for a different installer.
const fs = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { execFileSync, spawnSync } = require('node:child_process')

const MAX_AGE_HOURS = 72
// name -> [npm arguments]; every one must pass for the exact commit and installer that are signed.
const GATES = {
  tests: ['test'],
  build: ['run', 'build'],
  notices: ['run', 'notices'],
  audit: ['audit', '--omit=dev', '--audit-level=high'],
  desktop: ['run', 'smoke:desktop'],
  ux: ['run', 'smoke:ux'],
  prepare: ['run', 'smoke:prepare'],
  package: ['run', 'smoke:package']
}

function sha512File(file) {
  const hash = createHash('sha512'), fd = fs.openSync(file, 'r'), buffer = Buffer.alloc(1 << 20)
  try { for (let read; (read = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0;) hash.update(buffer.subarray(0, read)) } finally { fs.closeSync(fd) }
  return hash.digest('base64')
}

// Pure check, used by the tests and by the signing and publishing commands. Returns the list of problems (empty means the evidence is acceptable).
function checkEvidence({ evidence, version, commit, clean, installerSha512, now = Date.now(), maxAgeHours = MAX_AGE_HOURS }) {
  const problems = []
  if (!evidence || typeof evidence !== 'object') return ['EVIDENCE_MISSING']
  if (evidence.format !== 'najd-gate-evidence-v1') problems.push('EVIDENCE_FORMAT')
  if (evidence.version !== version) problems.push('VERSION_MISMATCH')
  if (!commit || evidence.commit !== commit) problems.push('COMMIT_MISMATCH')
  if (evidence.clean !== true || clean !== true) problems.push('TREE_NOT_CLEAN')
  if (!installerSha512 || evidence.installerSha512 !== installerSha512) problems.push('INSTALLER_MISMATCH')
  const finished = Date.parse(evidence.finishedAt)
  if (!Number.isFinite(finished) || now - finished > maxAgeHours * 3600000 || finished > now + 60000) problems.push('EVIDENCE_STALE')
  const results = evidence.results && typeof evidence.results === 'object' ? evidence.results : {}
  for (const name of Object.keys(GATES)) if (results[name]?.status !== 'passed') problems.push('GATE_NOT_PASSED:' + name)
  return problems
}

function gitState(root) {
  const run = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true }).trim()
  const commit = run(['rev-parse', 'HEAD'])
  // Local changes anywhere except the pinned upstream submodules make the tree unclean.
  // Untracked files count too, and so do ignored files inside the packaged source folders (electron/, browser-extension/),
  // which electron-builder would copy into the installer. Python bytecode caches are left out of the installer by
  // package.json build.files ("!**/__pycache__/**"), so under electron/ they cannot ship and are not counted (browser-extension/ is copied whole, so nothing there is exempt).
  const dirty = run(['status', '--porcelain', '--untracked-files=all']).split('\n').filter(line => line && !/^\s?[mM?]\s+third_party\//.test(line) && !/ third_party\//.test(line))
  const ignoredPackaged = run(['ls-files', '--others', '--ignored', '--exclude-standard', '--', 'electron', 'browser-extension']).split('\n')
    .filter(file => file && !/^electron\/(.*\/)?__pycache__\/[^/]+\.pyc$/.test(file))
  return { commit, clean: dirty.length === 0 && ignoredPackaged.length === 0 }
}

function installerPath(root, version) { return path.join(root, 'release', version, `NAJD-AGENT-Setup-${version}.exe`) }
const evidencePath = (root, version) => path.join(root, 'release', version, 'gate-evidence.json')

function assertEvidence({ root = path.resolve(__dirname, '..'), now = Date.now() } = {}) {
  const version = require(path.join(root, 'package.json')).version
  let evidence = null
  try { evidence = JSON.parse(fs.readFileSync(evidencePath(root, version), 'utf8')) } catch { /* reported as missing */ }
  const state = gitState(root)
  let installerSha512 = null
  try { installerSha512 = sha512File(installerPath(root, version)) } catch { /* reported as a mismatch */ }
  const problems = checkEvidence({ evidence, version, commit: state.commit, clean: state.clean, installerSha512, now })
  if (problems.length) throw Object.assign(new Error('Release gates not satisfied: ' + problems.join(', ') + '. Run: node scripts/release-gates.cjs --run'), { problems })
  return evidence
}

function runGates(root = path.resolve(__dirname, '..')) {
  const version = require(path.join(root, 'package.json')).version
  const npm = path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js')
  const startState = gitState(root)
  const results = {}
  for (const [name, args] of Object.entries(GATES)) {
    const started = Date.now()
    const run = spawnSync(process.execPath, [npm, ...args], { cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024, timeout: 45 * 60000 })
    results[name] = { status: run.status === 0 ? 'passed' : 'failed', seconds: Math.round((Date.now() - started) / 1000) }
    console.log(`${results[name].status === 'passed' ? 'PASS' : 'FAIL'}: ${name} (${results[name].seconds}s)`)
    // The end of a failed gate's output says why; tests use fake credentials only, and the text is redacted as in logs.
    if (run.status !== 0) {
      const { redactBlock } = require('../electron/redact.cjs'), last = text => String(text || '').split('\n').slice(-80).join('\n')
      console.log('--- stdout (last 80 lines)\n' + redactBlock(last(run.stdout), 20000))
      console.log('--- stderr (last 80 lines)\n' + redactBlock(last(run.stderr), 20000) + (run.error ? '\n' + redactBlock(run.error.message, 2000) : ''))
    }
    if (run.status !== 0) break
  }
  const endState = gitState(root)
  let installerSha512 = null
  try { installerSha512 = sha512File(installerPath(root, version)) } catch { /* the package gate would have failed; recorded as null */ }
  const evidence = { format: 'najd-gate-evidence-v1', version, commit: endState.commit, clean: startState.clean && endState.clean && startState.commit === endState.commit,
    installerSha512, finishedAt: new Date().toISOString(), results }
  fs.mkdirSync(path.dirname(evidencePath(root, version)), { recursive: true })
  fs.writeFileSync(evidencePath(root, version), JSON.stringify(evidence, null, 2) + '\n')
  const problems = checkEvidence({ evidence, version, commit: endState.commit, clean: endState.clean, installerSha512 })
  if (problems.length) { console.error('Gates not satisfied: ' + problems.join(', ')); process.exitCode = 1 } else console.log('All release gates passed for ' + endState.commit.slice(0, 8))
}

module.exports = { GATES, MAX_AGE_HOURS, checkEvidence, assertEvidence, runGates, sha512File, gitState }
if (require.main === module) {
  if (process.argv[2] === '--run') runGates()
  else { try { assertEvidence(); console.log('Gate evidence is valid.') } catch (error) { console.error(error.message); process.exitCode = 1 } }
}
