// Replaces a file by renaming a fully written temporary file over it. Windows can refuse that rename for a moment while
// antivirus, indexing or backup software holds one of the files (EPERM, EBUSY, EACCES); it is retried briefly (under a
// second in all) before the error is returned. Every store that saves through a temporary file uses this.
const fsp = require('node:fs/promises')
const fs = require('node:fs')

const RETRY = new Set(['EPERM', 'EBUSY', 'EACCES'])
const ATTEMPTS = 10
const delay = attempt => 15 * (attempt + 1)

// rename: a store given its own file system (tests) passes its rename.
async function replaceFile(from, to, { rename = (a, b) => fsp.rename(a, b) } = {}) {
  for (let attempt = 0; ; attempt++) {
    try { return await rename(from, to) }
    catch (error) {
      if (!RETRY.has(error?.code) || attempt >= ATTEMPTS) throw error
      await new Promise(resolve => setTimeout(resolve, delay(attempt)))
    }
  }
}

function replaceFileSync(from, to) {
  for (let attempt = 0; ; attempt++) {
    try { return fs.renameSync(from, to) }
    catch (error) {
      if (!RETRY.has(error?.code) || attempt >= ATTEMPTS) throw error
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delay(attempt))
    }
  }
}
module.exports = { replaceFile, replaceFileSync }
