// Publisher-only: package a staged, audited runtime payload into the archive format
// the app's runtime setup accepts, with original notices included, and write the
// unsigned catalog payload. Signing happens separately (scripts/sign-runtime.cjs)
// in the Windows user context that holds the publisher key.
//
// node scripts/package-runtime.cjs --component agent-core --version 1.0.0 \
//   --payload .runtimes/runtime-packs/agent-core-004 --notices .runtimes/agent-core-notices-002 \
//   --audit .runtimes/agent-core-audit-004.json --out .runtimes/runtime-release-0.1.0
const fs = require('node:fs'), fsp = require('node:fs/promises'), path = require('node:path')
const { createHash } = require('node:crypto')
const { deflateRawSync, crc32 } = require('node:zlib')

const ROOT = path.resolve(__dirname, '..')
const RUNTIMES = path.join(ROOT, '.runtimes')
const entries = { 'agent-core': 'hermes-agent/run_agent.py' }
const sourceRevision = { 'agent-core': 'c70332f88886932337619a1e57029bd885c28b9d' }
const uvLicenses = [
  { name: 'uv-LICENSE-MIT', url: 'https://raw.githubusercontent.com/astral-sh/uv/507230998c9541d67814b57463ac00e454ff6991/LICENSE-MIT', size: 1077, sha256: '860e3d7a86b84e6a7012c7a635fc64df475cebc6cce34dfeb73a5982ec58176c' },
  { name: 'uv-LICENSE-APACHE', url: 'https://raw.githubusercontent.com/astral-sh/uv/507230998c9541d67814b57463ac00e454ff6991/LICENSE-APACHE', size: 11357, sha256: 'c71d239df91726fc519c6eb72d318ec65820627232b2f796219e87dcf35d0ab4' }
]

function arg(name) {
  const index = process.argv.indexOf('--' + name)
  if (index < 0 || !process.argv[index + 1]) throw Error('Missing --' + name)
  return process.argv[index + 1]
}
function owned(value, mustExist) {
  const resolved = path.resolve(ROOT, value)
  if (!resolved.startsWith(RUNTIMES + path.sep)) throw Error('Paths must stay beneath .runtimes')
  if (mustExist !== fs.existsSync(resolved)) throw Error(mustExist ? 'Missing input ' + value : 'Output exists; choose a fresh directory')
  return resolved
}
async function* walk(directory, prefix = '') {
  for (const entry of await fsp.readdir(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw Error('Links are not packaged: ' + prefix + entry.name)
    const full = path.join(directory, entry.name), relative = prefix + entry.name
    if (entry.isDirectory()) yield* walk(full, relative + '/')
    else if (entry.isFile()) yield { full, relative }
    else throw Error('Unsupported entry ' + relative)
  }
}

async function main() {
  const component = arg('component'), version = arg('version')
  if (!entries[component] || !/^\d+\.\d+\.\d+$/.test(version)) throw Error('Unsupported component or version')
  const payload = owned(arg('payload'), true), notices = owned(arg('notices'), true), auditPath = owned(arg('audit'), true), out = owned(arg('out'), false)
  const audit = JSON.parse(await fsp.readFile(auditPath, 'utf8'))
  if (audit.complete !== true || audit.vulnerabilityRecords !== 0) throw Error('Audit gate not passed: ' + audit.vulnerabilityRecords + ' advisory records')
  const recovered = JSON.parse(await fsp.readFile(path.join(notices, 'inventory.json'), 'utf8'))
  const recoveredNames = new Set(recovered.packages.filter(row => row.notices.length).map(row => row.name))
  const missing = audit.missingNotices.map(value => value.split(':').at(-1)).filter(name => !recoveredNames.has(name))
  if (missing.length) throw Error('Notice gate not passed: ' + missing.join(', '))
  await fsp.access(path.join(payload, entries[component]))

  const extra = []
  for (const license of uvLicenses) {
    const response = await fetch(license.url, { redirect: 'error' })
    const bytes = Buffer.from(await response.arrayBuffer())
    if (!response.ok || bytes.length !== license.size || createHash('sha256').update(bytes).digest('hex') !== license.sha256) throw Error('uv license identity mismatch')
    extra.push({ relative: `NAJD-NOTICES/${license.name}.txt`, bytes })
  }
  for (const name of await fsp.readdir(notices)) extra.push({ relative: `NAJD-NOTICES/recovered/${name}`, bytes: await fsp.readFile(path.join(notices, name)) })
  for (const name of ['agent-core-overrides.txt', 'core-notice-sources.json']) extra.push({ relative: `NAJD-NOTICES/${name}`, bytes: await fsp.readFile(path.join(__dirname, name)) })
  extra.push({ relative: 'NAJD-NOTICES/README.txt', bytes: Buffer.from('NAJD internal agent core. Original licenses and notices of every bundled component are preserved in place\n(Python LICENSE.txt, package dist-info license files, hermes-agent/LICENSE) and in this folder for\ndistributions whose packages omit them. Security overrides and exclusions are listed with their evidence.\n') })

  await fsp.mkdir(out)
  const name = `NAJD-Runtime-${component}-${version}-win32-x64.zip`
  const target = path.join(out, name)
  // Sizes and CRCs live in each local header (no data descriptors), so the app's
  // streaming extractor never has to guess where compressed data ends.
  const handle = await fsp.open(target, 'wx')
  const hash = createHash('sha512'), central = []
  let offset = 0, files = 0
  const write = async buffer => { hash.update(buffer); await handle.write(buffer); offset += buffer.length }
  async function add(relative, bytes) {
    const nameBytes = Buffer.from(relative, 'utf8')
    const deflated = deflateRawSync(bytes, { level: 6 })
    const stored = deflated.length >= bytes.length
    const data = stored ? bytes : deflated, crc = crc32(bytes)
    if (bytes.length >= 0xffffffff || offset >= 0xffffffff) throw Error('ZIP64 required; split the component')
    const header = Buffer.alloc(30)
    header.writeUInt32LE(0x04034b50, 0); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x0800, 6)
    header.writeUInt16LE(stored ? 0 : 8, 8); header.writeUInt16LE(0, 10); header.writeUInt16LE(0x21, 12)
    header.writeUInt32LE(crc, 14); header.writeUInt32LE(data.length, 18); header.writeUInt32LE(bytes.length, 22)
    header.writeUInt16LE(nameBytes.length, 26); header.writeUInt16LE(0, 28)
    central.push({ nameBytes, crc, compressed: data.length, size: bytes.length, method: stored ? 0 : 8, offset })
    await write(header); await write(nameBytes); await write(data); files++
  }
  try {
    for await (const item of walk(payload)) await add(item.relative, await fsp.readFile(item.full))
    for (const item of extra) await add(item.relative, item.bytes)
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
  const size = offset
  const row = { id: component, version, sourceRevision: sourceRevision[component], entry: entries[component], dependencies: [],
    file: { name, size, sha512: hash.digest('base64') } }
  await fsp.writeFile(path.join(out, 'component.json'), JSON.stringify(row, null, 2) + '\n', { flag: 'wx' })
  console.log(`Packaged ${component} ${version}: ${files} files, ${size} bytes. Sign the catalog in the publisher key context.`)
}
main().catch(error => { console.error('Runtime packaging failed:', error.message); process.exitCode = 1 })
