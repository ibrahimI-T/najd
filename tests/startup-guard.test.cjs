const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const { createStartupGuard } = require('../electron/startup-guard.cjs')

const file = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'najd-guard-')), 'startup.json')

test('three starts that never became healthy mark the version unstable; a healthy start clears it', () => {
  const filePath = file()
  assert.equal(createStartupGuard({ filePath, version: '1.0.0' }).begin().unstable, false)
  assert.equal(createStartupGuard({ filePath, version: '1.0.0' }).begin().unstable, false)
  const third = createStartupGuard({ filePath, version: '1.0.0' })
  assert.equal(third.begin().unstable, true)
  third.markHealthy()
  assert.deepEqual(third.status(), { version: '1.0.0', attempts: 0, healthy: true, unstable: false })
  assert.equal(createStartupGuard({ filePath, version: '1.0.0' }).begin().unstable, false, 'a healthy version keeps counting from zero and stays healthy')
})

test('a new version starts clean, and a corrupt record does not block startup', () => {
  const filePath = file()
  for (let i = 0; i < 3; i++) createStartupGuard({ filePath, version: '1.0.0' }).begin()
  assert.deepEqual(createStartupGuard({ filePath, version: '1.0.1' }).begin(), { version: '1.0.1', attempts: 1, healthy: false, unstable: false })
  fs.writeFileSync(filePath, '{broken')
  assert.equal(createStartupGuard({ filePath, version: '1.0.1' }).begin().attempts, 1)
})
