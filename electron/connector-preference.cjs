// The user's saved choice for the local Windows companion (connectors.json). Fails closed: only a file that does not
// exist yet (first run) reads as "no choice" (null), which lets startup connect. A file that cannot be read reads as
// off; a malformed one is copied aside and then atomically replaced by an explicit off, and reads as off. The
// original stays in place until that replacement is committed, so a failed or interrupted recovery leaves the
// malformed file (still off), never a missing one (M2-R31-003, M2-R32-001). Writes go through a temporary file and a
// rename, so an interrupted write leaves the previous choice or the new one.
const fsp = require('node:fs/promises')
const { replaceFile } = require('./atomic-file.cjs')
const path = require('node:path')

function createConnectorPreference({ filePath, fs = fsp }) {
  if (!path.isAbsolute(filePath || '')) throw Object.assign(new Error('INVALID_INPUT'), { code: 'INVALID_INPUT' })
  async function write(value) {
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    const temporary = filePath + '.tmp-' + process.pid
    await fs.writeFile(temporary, JSON.stringify({ windowsNative: value === true }))
    try { await replaceFile(temporary, filePath, { rename: (from, to) => fs.rename(from, to) }) }
    catch (error) { await fs.rm(temporary, { force: true }).catch(() => {}); throw error }
  }
  async function get() {
    let text
    try { text = await fs.readFile(filePath, 'utf8') }
    catch (error) { return error?.code === 'ENOENT' ? null : false }
    let value = null
    try { value = JSON.parse(text)?.windowsNative } catch {}
    if (typeof value === 'boolean') return value
    try { await fs.copyFile(filePath, filePath + '.corrupt-' + Date.now()); await write(false) } catch {}
    return false
  }
  return { get, set: write }
}

module.exports = { createConnectorPreference }
