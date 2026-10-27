const { test } = require('node:test')
const assert = require('node:assert/strict')
const { decide } = require('../scripts/host-preflight.cjs')

test('preflight blocks heavy steps on low available RAM or high commit, and allows them otherwise', () => {
  assert.equal(decide({ availableMB: 8000, committedMB: 20000, commitLimitMB: 45000 }).ok, true)
  const lowRam = decide({ availableMB: 3000, committedMB: 20000, commitLimitMB: 45000 })
  assert.equal(lowRam.ok, false); assert.match(lowRam.reasons[0], /available RAM 3000 MB < 4096 MB/)
  const highCommit = decide({ availableMB: 8000, committedMB: 40000, commitLimitMB: 45000 })
  assert.equal(highCommit.ok, false); assert.match(highCommit.reasons[0], /commit 89% >= 80%/)
  assert.equal(decide({ availableMB: 4096, committedMB: 35999, commitLimitMB: 45000 }).ok, true, 'boundary values pass')
  assert.equal(decide({ availableMB: 8000, committedMB: 36000, commitLimitMB: 45000 }).ok, false, '80% exactly is blocked')
  assert.equal(decide({ availableMB: NaN, committedMB: 0, commitLimitMB: 0 }).ok, false, 'unreadable values block')
})
