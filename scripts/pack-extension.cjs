// Builds the store package of the NAJD AGENT browser extension (one zip for the Chrome Web Store and Microsoft Edge Add-ons).
//   node scripts/pack-extension.cjs        -> release/extension/najd-agent-browser-<version>.zip (+ .sha256)
// The package carries the store manifest (website access is optional and requested by the user), only the reviewed files, and is
// checked by the same rules as the unit tests. The signing key is never touched: the stores sign their own packages.
const fs = require('node:fs'), path = require('node:path'), zlib = require('node:zlib'), { createHash } = require('node:crypto')
const { validateExtension, storeManifest, walk } = require('./extension-checks.cjs')

const source = path.join(__dirname, '..', 'browser-extension')
const output = path.join(__dirname, '..', 'release', 'extension')

// A small ZIP writer: forward-slash names, UTF-8 names, deflate, fixed timestamp (the same input gives the same bytes).
function zip(entries) {
  const locals = [], central = []
  let offset = 0
  const date = ((2026 - 1980) << 9) | (1 << 5) | 1, time = 0
  for (const { name, data } of entries) {
    const nameBytes = Buffer.from(name, 'utf8'), packed = zlib.deflateRawSync(data, { level: 9 }), crc = zlib.crc32(data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(8, 8); local.writeUInt16LE(time, 10); local.writeUInt16LE(date, 12)
    local.writeUInt32LE(crc >>> 0, 14); local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBytes.length, 26)
    locals.push(local, nameBytes, packed)
    const header = Buffer.alloc(46)
    header.writeUInt32LE(0x02014b50, 0); header.writeUInt16LE(20, 4); header.writeUInt16LE(20, 6); header.writeUInt16LE(0x0800, 8); header.writeUInt16LE(8, 10); header.writeUInt16LE(time, 12); header.writeUInt16LE(date, 14)
    header.writeUInt32LE(crc >>> 0, 16); header.writeUInt32LE(packed.length, 20); header.writeUInt32LE(data.length, 24); header.writeUInt16LE(nameBytes.length, 28); header.writeUInt32LE(offset, 42)
    central.push(header, nameBytes)
    offset += local.length + nameBytes.length + packed.length
  }
  const directory = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, directory, end])
}

function main() {
  const development = validateExtension(source)
  if (development.errors.length) { console.error('Extension checks failed:\n- ' + development.errors.join('\n- ')); process.exit(1) }
  const stage = path.join(output, 'stage')
  fs.rmSync(stage, { recursive: true, force: true })
  for (const file of walk(source)) { const target = path.join(stage, file); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(path.join(source, file), target) }
  fs.writeFileSync(path.join(stage, 'manifest.json'), JSON.stringify(storeManifest(development.manifest), null, 2) + '\n')
  const store = validateExtension(stage, { store: true })
  if (store.errors.length) { console.error('Store package checks failed:\n- ' + store.errors.join('\n- ')); process.exit(1) }
  // README.md of the folder is developer documentation, not part of the package.
  const files = walk(stage).filter(file => file !== 'README.md').sort()
  const entries = files.map(name => ({ name, data: fs.readFileSync(path.join(stage, name)) }))
  const archive = zip(entries)
  const target = path.join(output, `najd-agent-browser-${store.manifest.version}.zip`)
  fs.writeFileSync(target, archive)
  const digest = createHash('sha256').update(archive).digest('hex')
  fs.writeFileSync(target + '.sha256', `${digest}  ${path.basename(target)}\n`)
  fs.rmSync(stage, { recursive: true, force: true })
  console.log(`Packed ${path.relative(process.cwd(), target)} (${archive.length} bytes, ${files.length} files)\nSHA-256 ${digest}`)
  console.log('Permissions: ' + store.manifest.permissions.join(', ') + ' | host: ' + store.manifest.host_permissions.join(', ') + ' | optional host: ' + store.manifest.optional_host_permissions.join(', '))
  if (store.warnings.length) console.log('Warnings:\n- ' + store.warnings.join('\n- '))
}
main()
