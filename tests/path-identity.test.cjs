const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), os = require('node:os')
const { isDirectEntry, isDirectEntrySync } = require('../electron/path-identity.cjs')
const { createAssetLibrary } = require('../electron/asset-library.cjs')

// Windows CI runners expose TEMP through an 8.3 alias (C:\Users\RUNNER~1); a junctioned
// ancestor reproduces the same "realpath differs from the given spelling" condition.
function aliasFixture(t) {
  const base = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'najd-alias-'))
  t.after(() => fs.rmSync(base, { recursive: true, force: true }))
  const real = path.join(base, 'real'), alias = path.join(base, 'alias')
  fs.mkdirSync(real)
  fs.symlinkSync(real, alias, 'junction')
  return { base, real, alias }
}

test('an aliased ancestor is accepted but a linked target itself is rejected', { skip: process.platform !== 'win32' }, async t => {
  const { real, alias } = aliasFixture(t)
  fs.writeFileSync(path.join(real, 'store.json'), '{}')
  assert.equal(await isDirectEntry(path.join(alias, 'store.json')), true)
  assert.equal(isDirectEntrySync(path.join(alias, 'store.json')), true)
  assert.equal(await isDirectEntry(alias), false, 'the junction itself is not a direct entry')
  assert.equal(isDirectEntrySync(alias), false)
})

test('library stores work through an aliased path and protected roots cannot be bypassed through an alias', { skip: process.platform !== 'win32' }, async t => {
  const { base, real, alias } = aliasFixture(t)
  const library = createAssetLibrary({ directory: path.join(alias, 'library'), protectedRoots: [path.join(alias, 'secret')] })
  fs.mkdirSync(path.join(real, 'secret'))
  fs.writeFileSync(path.join(real, 'secret', 'notes.txt'), 'private')
  fs.writeFileSync(path.join(base, 'ok.txt'), 'shareable')
  assert.equal((await library.importFile(path.join(base, 'ok.txt'))).name, 'ok.txt')
  await assert.rejects(library.importFile(path.join(real, 'secret', 'notes.txt')), { code: 'PROTECTED_RESOURCE' })
})
