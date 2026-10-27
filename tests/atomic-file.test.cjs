// A store's temporary-file rename is retried while Windows briefly holds the file (EPERM/EBUSY/EACCES), and any other
// error, or one that lasts, is returned unchanged.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { replaceFile, replaceFileSync } = require('../electron/atomic-file.cjs')

const busy = code => Object.assign(new Error(code), { code })

test('a rename refused for a moment is retried and the file is replaced', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'najd-atomic-'))
  const from = path.join(root, 'a.tmp'), to = path.join(root, 'a.json')
  fs.writeFileSync(from, 'new'); fs.writeFileSync(to, 'old')
  const real = fsp.rename; let calls = 0
  t.after(() => { fsp.rename = real })
  fsp.rename = async (...args) => { if (++calls <= 2) throw busy('EPERM'); return real(...args) }
  await replaceFile(from, to)
  assert.equal(calls, 3); assert.equal(fs.readFileSync(to, 'utf8'), 'new')
})

test('other errors are not retried, and a lasting refusal is returned', async t => {
  const real = fsp.rename; let calls = 0
  t.after(() => { fsp.rename = real })
  fsp.rename = async () => { calls++; throw busy('ENOENT') }
  await assert.rejects(replaceFile('x', 'y'), { code: 'ENOENT' }); assert.equal(calls, 1)
  calls = 0; fsp.rename = async () => { calls++; throw busy('EBUSY') }
  await assert.rejects(replaceFile('x', 'y'), { code: 'EBUSY' }); assert.equal(calls, 11)
})

test('the synchronous form retries the same way', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'najd-atomic-'))
  const from = path.join(root, 'b.tmp'), to = path.join(root, 'b.json')
  fs.writeFileSync(from, 'new')
  const real = fs.renameSync; let calls = 0
  t.after(() => { fs.renameSync = real })
  fs.renameSync = (...args) => { if (++calls === 1) throw busy('EACCES'); return real(...args) }
  replaceFileSync(from, to)
  assert.equal(calls, 2); assert.equal(fs.readFileSync(to, 'utf8'), 'new')
})

test('C57-01: no store renames a temporary file into place without the retry', () => {
  const directory = path.join(__dirname, '..', 'electron'), found = []
  for (const name of fs.readdirSync(directory).filter(file => file.endsWith('.cjs') && file !== 'atomic-file.cjs')) {
    const lines = fs.readFileSync(path.join(directory, name), 'utf8').split('\n')
    lines.forEach((line, index) => {
      // A rename of a temporary file (or any bare imported rename) must go through replaceFile/replaceFileSync.
      if (/(?<![.\w])rename(Sync)?\(|\.rename(Sync)?\(\s*(temporary|temp|part)\b/.test(line)) found.push(name + ':' + (index + 1))
    })
  }
  assert.deepEqual(found, [])
})
