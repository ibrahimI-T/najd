// Publisher-only: sign the runtime catalog for packaged components with the existing
// DPAPI-protected publisher key. Must run in the Windows user context that holds it;
// never generates or exports a key.
//   node scripts/sign-runtime.cjs .runtimes/runtime-release-0.1.0
const fs = require('node:fs/promises'), path = require('node:path')
const { sign } = require('node:crypto')
const { publisherKey } = require('./publisher-key.cjs')
const { verifyRuntimeManifest, verifyRuntimeArchive } = require('../electron/runtime-manifest.cjs')
const updateConfig = require('../electron/update-config.json'), runtimeConfig = require('../electron/runtime-config.json')

async function main() {
  const directory = path.resolve(process.argv[2] || '')
  if (!directory.startsWith(path.resolve(__dirname, '../.runtimes') + path.sep)) throw Error('Release directory must be beneath .runtimes')
  const components = []
  for (const id of runtimeConfig.components) {
    const row = JSON.parse(await fs.readFile(path.join(directory, 'component.json'), 'utf8'))
    if (row.id !== id) throw Error('Unexpected component ' + row.id)
    await verifyRuntimeArchive(path.join(directory, row.file.name), row)
    components.push(row)
  }
  const record = { format: 'najd-runtime-v1', channel: runtimeConfig.channel, platform: 'win32-x64', version: runtimeConfig.catalogVersion,
    minAppVersion: require('../package.json').version, components }
  const key = await publisherKey(), bytes = Buffer.from(JSON.stringify(record))
  const envelope = JSON.stringify({ payload: bytes.toString('base64'), signature: sign(null, bytes, key).toString('base64') }) + '\n'
  verifyRuntimeManifest(envelope, { ...updateConfig, channel: runtimeConfig.channel, catalogVersion: runtimeConfig.catalogVersion, appVersion: record.minAppVersion })
  await fs.writeFile(path.join(directory, 'najd-runtime.json'), envelope, { flag: 'wx' })
  console.log(`Signed runtime catalog ${record.version}. Upload najd-runtime.json and the archive to release tag runtime-v${record.version}.`)
}
main().catch(error => { console.error('Runtime signing failed; existing files preserved.', error.message); process.exitCode = 1 })
