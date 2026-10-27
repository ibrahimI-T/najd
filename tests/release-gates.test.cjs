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
