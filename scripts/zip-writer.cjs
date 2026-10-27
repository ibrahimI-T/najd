// Publisher-only ZIP writer. Every local header carries sizes and CRC (no data
// descriptors), so NAJD's streaming extractor never guesses where data ends.
const fsp = require('node:fs/promises'), path = require('node:path')
const { createHash } = require('node:crypto')
const { deflateRawSync, crc32 } = require('node:zlib')

async function* walk(directory, prefix = '') {
  for (const entry of await fsp.readdir(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw Error('Links are not packaged: ' + prefix + entry.name)
    const full = path.join(directory, entry.name), relative = prefix + entry.name
    if (entry.isDirectory()) yield* walk(full, relative + '/')
    else if (entry.isFile()) yield { full, relative }
    else throw Error('Unsupported entry ' + relative)
  }
}

// entries: async iterable of { relative, bytes | full }. Returns { size, sha512, files, bytes }.
async function writeZip(target, entries) {
  const handle = await fsp.open(target, 'wx')
  const hash = createHash('sha512'), central = []
  let offset = 0, total = 0
  const write = async buffer => { hash.update(buffer); await handle.write(buffer); offset += buffer.length }
  try {
    for await (const item of entries) {
      const bytes = item.bytes || await fsp.readFile(item.full)
      const nameBytes = Buffer.from(item.relative, 'utf8')
      const deflated = deflateRawSync(bytes, { level: 6 })
      const stored = deflated.length >= bytes.length
      const data = stored ? bytes : deflated, crc = crc32(bytes)
      if (bytes.length >= 0xffffffff || offset + data.length >= 0xffffffff) throw Error('ZIP64 required; split the component')
      const header = Buffer.alloc(30)
      header.writeUInt32LE(0x04034b50, 0); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x0800, 6)
      header.writeUInt16LE(stored ? 0 : 8, 8); header.writeUInt16LE(0, 10); header.writeUInt16LE(0x21, 12)
      header.writeUInt32LE(crc, 14); header.writeUInt32LE(data.length, 18); header.writeUInt32LE(bytes.length, 22)
      header.writeUInt16LE(nameBytes.length, 26); header.writeUInt16LE(0, 28)
      central.push({ nameBytes, crc, compressed: data.length, size: bytes.length, method: stored ? 0 : 8, offset })
      await write(header); await write(nameBytes); await write(data)
      total += bytes.length
    }
    if (central.length >= 0xffff) throw Error('ZIP64 required; too many entries')
    const start = offset
    for (const entry of central) {
      const record = Buffer.alloc(46)
      record.writeUInt32LE(0x02014b50, 0); record.writeUInt16LE(20, 4); record.writeUInt16LE(20, 6); record.writeUInt16LE(0x0800, 8)
      record.writeUInt16LE(entry.method, 10); record.writeUInt16LE(0, 12); record.writeUInt16LE(0x21, 14)
      record.writeUInt32LE(entry.crc, 16); record.writeUInt32LE(entry.compressed, 20); record.writeUInt32LE(entry.size, 24)
      record.writeUInt16LE(entry.nameBytes.length, 28); record.writeUInt32LE(entry.offset, 42)
      await write(record); await write(entry.nameBytes)
    }
    const end = Buffer.alloc(22)
    end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(central.length, 8); end.writeUInt16LE(central.length, 10)
    end.writeUInt32LE(offset - start, 12); end.writeUInt32LE(start, 16)
    await write(end)
  } finally { await handle.close() }
  return { size: offset, sha512: hash.digest('base64'), files: central.length, bytes: total }
}
module.exports = { writeZip, walk }
