const { test } = require('node:test')
const assert = require('node:assert/strict')
const { GATES, checkEvidence } = require('../scripts/release-gates.cjs')

const base = () => ({
  evidence: { format: 'najd-gate-evidence-v1', version: '1.2.3', commit: 'abc', clean: true, installerSha512: 'SHA', finishedAt: new Date(Date.UTC(2026, 0, 1, 12)).toISOString(),
    results: Object.fromEntries(Object.keys(GATES).map(name => [name, { status: 'passed', seconds: 1 }])) },
  version: '1.2.3', commit: 'abc', clean: true, installerSha512: 'SHA', now: Date.UTC(2026, 0, 1, 13)
})

test('complete, fresh evidence for this commit and installer is accepted', () => {
  assert.deepEqual(checkEvidence(base()), [])
})

test('missing, failed, stale, mismatched or dirty evidence is refused with a reason', () => {
  assert.deepEqual(checkEvidence({ ...base(), evidence: null }), ['EVIDENCE_MISSING'])
  const failed = base(); failed.evidence.results.desktop.status = 'failed'
  assert.deepEqual(checkEvidence(failed), ['GATE_NOT_PASSED:desktop'])
  const absent = base(); delete absent.evidence.results.package
  assert.deepEqual(checkEvidence(absent), ['GATE_NOT_PASSED:package'])
  assert.deepEqual(checkEvidence({ ...base(), now: Date.UTC(2026, 0, 5) }), ['EVIDENCE_STALE'])
  assert.deepEqual(checkEvidence({ ...base(), commit: 'def' }), ['COMMIT_MISMATCH'])
  assert.deepEqual(checkEvidence({ ...base(), version: '1.2.4' }), ['VERSION_MISMATCH'])
  assert.deepEqual(checkEvidence({ ...base(), installerSha512: 'OTHER' }), ['INSTALLER_MISMATCH'])
  assert.deepEqual(checkEvidence({ ...base(), installerSha512: null }), ['INSTALLER_MISMATCH'])
  assert.deepEqual(checkEvidence({ ...base(), clean: false }), ['TREE_NOT_CLEAN'])
  const dirty = base(); dirty.evidence.clean = false
  assert.deepEqual(checkEvidence(dirty), ['TREE_NOT_CLEAN'])
  const future = base(); future.evidence.finishedAt = new Date(Date.UTC(2026, 0, 3)).toISOString()
  assert.deepEqual(checkEvidence(future), ['EVIDENCE_STALE'])
})

test('every gate the release depends on is required', () => {
  assert.deepEqual(Object.keys(GATES).sort(), ['audit', 'build', 'desktop', 'notices', 'package', 'prepare', 'tests', 'ux'])
})
test('a clean tree has no untracked files and no ignored files inside packaged folders (C78-01)', t => {
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), { execFileSync } = require('node:child_process')
  const { gitState } = require('../scripts/release-gates.cjs')
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'najd-gates-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true })
  git('init', '-q'); git('config', 'user.email', 'test@example.invalid'); git('config', 'user.name', 'test')
  fs.mkdirSync(path.join(root, 'electron/packs/x/__pycache__'), { recursive: true })
  fs.writeFileSync(path.join(root, '.gitignore'), '*.log\n__pycache__/\ndist/\n')
  fs.writeFileSync(path.join(root, 'electron/main.cjs'), '')
  git('add', '.'); git('commit', '-q', '-m', 'base')
  assert.equal(gitState(root).clean, true)
  fs.mkdirSync(path.join(root, 'dist')); fs.writeFileSync(path.join(root, 'dist/app.js'), '')
  fs.writeFileSync(path.join(root, 'electron/packs/x/__pycache__/a.cpython-314.pyc'), '')
  assert.equal(gitState(root).clean, true, 'generated output outside source folders and bytecode caches are allowed')
  fs.writeFileSync(path.join(root, 'electron/extra.log'), '')
  assert.equal(gitState(root).clean, false, 'an ignored file inside electron/ would be packaged')
  fs.rmSync(path.join(root, 'electron/extra.log'))
  fs.writeFileSync(path.join(root, 'notes.txt'), '')
  assert.equal(gitState(root).clean, false, 'untracked files make the tree unclean')
})
test('Python bytecode caches can never reach the installer (C79-01)', () => {
  const files = require('../package.json').build.files
  assert.ok(files.includes('!**/__pycache__/**'))
  assert.ok(files.indexOf('!**/__pycache__/**') > files.indexOf('electron/**'))
})
test('bytecode outside electron/ is not exempt from the clean-tree check (C79-01)', t => {
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), { execFileSync } = require('node:child_process')
  const { gitState } = require('../scripts/release-gates.cjs')
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'najd-gates-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true })
  git('init', '-q'); git('config', 'user.email', 'test@example.invalid'); git('config', 'user.name', 'test')
  fs.mkdirSync(path.join(root, 'browser-extension/__pycache__'), { recursive: true })
  fs.writeFileSync(path.join(root, '.gitignore'), '__pycache__/\n'); fs.writeFileSync(path.join(root, 'browser-extension/a.js'), '')
  git('add', '.'); git('commit', '-q', '-m', 'base')
  fs.writeFileSync(path.join(root, 'browser-extension/__pycache__/a.cpython-314.pyc'), '')
  assert.equal(gitState(root).clean, false)
})
