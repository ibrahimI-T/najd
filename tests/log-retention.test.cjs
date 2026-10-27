const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const { trimFile, pruneDirectory } = require('../electron/log-retention.cjs')

test('Phase 14 R2: a line log over its limit keeps its newest half', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'najd-retain-')), 'install.log')
  fs.writeFileSync(file, Array.from({ length: 100 }, (_, index) => 'line ' + index).join('\n') + '\n')
  assert.equal(trimFile(file, 100000), false)
  assert.equal(trimFile(file, 200), true)
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)
  assert.equal(lines[0], 'line 50'); assert.equal(lines.at(-1), 'line 99')
  assert.equal(trimFile(path.join(os.tmpdir(), 'najd-no-such-file.log')), false)
})

test('Phase 14 R2: crash dumps keep the newest and drop the old; other files are left alone', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'najd-dumps-'))
  fs.mkdirSync(path.join(directory, 'reports'))
  const now = Date.now()
  for (let index = 0; index < 5; index++) {
    const file = path.join(directory, 'reports', 'crash-' + index + '.dmp')
    fs.writeFileSync(file, 'dump'); fs.utimesSync(file, new Date(now - index * 60000), new Date(now - index * 60000))
  }
  const old = path.join(directory, 'old.dmp'); fs.writeFileSync(old, 'dump'); fs.utimesSync(old, new Date(now - 40 * 86400000), new Date(now - 40 * 86400000))
  fs.writeFileSync(path.join(directory, 'settings.ini'), 'keep')
  assert.equal(pruneDirectory(directory, { maxFiles: 3, now }), 3)
  assert.deepEqual(fs.readdirSync(path.join(directory, 'reports')).sort(), ['crash-0.dmp', 'crash-1.dmp', 'crash-2.dmp'])
  assert.equal(fs.existsSync(old), false); assert.equal(fs.existsSync(path.join(directory, 'settings.ini')), true)
  assert.equal(pruneDirectory(path.join(directory, 'missing')), 0)
})
