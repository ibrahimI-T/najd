const { createHash } = require('node:crypto')
const { readSignedJson } = require('./signed-envelope.cjs')
const fs = require('node:fs/promises')
const failure = code => Object.assign(new Error(code), { code })
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join(',') === keys.split(',').sort().join(',')
const validVersion = value => typeof value === 'string' && /^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/.test(value)
const newer = (a, b) => {
  if (!validVersion(a) || !validVersion(b)) throw failure('UPDATE_INVALID')
  const left = a.split('.').map(Number), right = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i] > right[i]
  return false
}
function verifyManifest(raw, config) {
  try {
    const record = readSignedJson(raw, config.publicKey)
    if (!exact(record, 'format,channel,platform,version,publishedAt,notes,file') || record.format !== 'najd-update-v1' ||
      record.channel !== config.channel || record.platform !== 'win32-x64' || !validVersion(record.version) ||
      typeof record.publishedAt !== 'string' || new Date(record.publishedAt).toISOString() !== record.publishedAt ||
      typeof record.notes !== 'string' || record.notes.length > 3000 || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(record.notes) ||
      !exact(record.file, 'name,size,sha512') || record.file.name !== `NAJD-AGENT-Setup-${record.version}.exe` ||
      !Number.isSafeInteger(record.file.size) || record.file.size < 1 || record.file.size > 2 * 1024 ** 3 ||
      typeof record.file.sha512 !== 'string' || Buffer.from(record.file.sha512, 'base64').length !== 64 ||
      Buffer.from(record.file.sha512, 'base64').toString('base64') !== record.file.sha512) throw failure('UPDATE_INVALID')
    return record
  } catch (error) { throw failure(error.code === 'SIGNATURE_INVALID' ? 'UPDATE_SIGNATURE_INVALID' : 'UPDATE_INVALID') }
}
async function verifyInstaller(filename, record) {
  let handle
  try {
    const stat = await fs.lstat(filename)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== record.file.size) throw failure('UPDATE_SIGNATURE_INVALID')
    handle = await fs.open(filename, 'r')
    if ((await handle.stat()).size !== record.file.size) throw failure('UPDATE_SIGNATURE_INVALID')
    const hash = createHash('sha512'), buffer = Buffer.alloc(1024 * 1024)
    let size = 0
    while (true) {
      const { bytesRead } = await handle.read(buffer)
      if (!bytesRead) break
      size += bytesRead
      if (size > record.file.size) throw failure('UPDATE_SIGNATURE_INVALID')
      hash.update(buffer.subarray(0, bytesRead))
    }
    if (size !== record.file.size || hash.digest('base64') !== record.file.sha512) throw failure('UPDATE_SIGNATURE_INVALID')
  } catch { throw failure('UPDATE_SIGNATURE_INVALID') }
  finally { await handle?.close() }
}
module.exports = { verifyManifest, verifyInstaller, newer, failure }
