// Link/junction checks that survive Windows path aliases. Comparing realpath(target) with
// path.resolve(target) wrongly fails whenever an ancestor has another spelling (8.3 short
// names such as C:\Users\RUNNER~1, or a redirected/junctioned profile folder). The target is
// direct when its real path equals its parent's real path joined with its own name: a link
// or junction at the target itself still fails, while ancestor aliases are accepted.
const fs = require('node:fs')
const path = require('node:path')

const same = (a, b) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b

function expectedReal(parentReal, target) {
  const resolved = path.resolve(target)
  // A filesystem root has no parent entry to compare against.
  return path.dirname(resolved) === resolved ? resolved : path.join(parentReal, path.basename(resolved))
}

async function isDirectEntry(target) {
  const resolved = path.resolve(target)
  const [real, parent] = await Promise.all([fs.promises.realpath(resolved), fs.promises.realpath(path.dirname(resolved))])
  return same(real, expectedReal(parent, resolved))
}

function isDirectEntrySync(target) {
  const resolved = path.resolve(target)
  return same(fs.realpathSync(resolved), expectedReal(fs.realpathSync(path.dirname(resolved)), resolved))
}

module.exports = { isDirectEntry, isDirectEntrySync, samePath: same }
