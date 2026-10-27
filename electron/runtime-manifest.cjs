const { readSignedJson } = require('./signed-envelope.cjs')
const { newer, verifyInstaller } = require('./update-manifest.cjs')
const fail = code => Object.assign(new Error(code), { code })
const exact = (value, fields) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join(',') === fields.split(',').sort().join(',')
const version = value => typeof value === 'string' && /^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/.test(value)
const entries = {
  node: 'node.exe', python: 'python.exe', uv: 'uv.exe', hermes: 'run_agent.py',
  openclaw: 'node_modules/openclaw/openclaw.mjs', dotnet: 'dotnet.exe',
  'windows-node': 'windows-node-host/Najd.WindowsNode.dll',
  'agent-core': 'hermes-agent/run_agent.py'
}
const runtimeComponentIds = Object.freeze(Object.keys(entries))
const required = { hermes: ['python', 'uv'], openclaw: ['node'], 'windows-node': ['dotnet'] }

function planRuntimeComponents(manifest, requested) {
  if (!Array.isArray(requested) || requested.length > 16 || requested.some(id => typeof id !== 'string')) throw fail('RUNTIME_MANIFEST_INVALID')
  const rows = new Map(manifest.components.map(row => [row.id, row])), visiting = new Set(), done = new Set(), ordered = []
  function visit(id) {
    if (visiting.has(id)) throw fail('RUNTIME_MANIFEST_INVALID')
    if (done.has(id)) return
    const row = rows.get(id)
    if (!row) throw fail('RUNTIME_COMPONENT_MISSING')
    visiting.add(id)
    for (const dependency of row.dependencies) visit(dependency)
    visiting.delete(id); done.add(id); ordered.push(row)
  }
  for (const id of requested) visit(id)
  return ordered
}
function verifyRuntimeManifest(raw, config) {
  try {
    const manifest = readSignedJson(raw, config.publicKey, 65536)
    if (!exact(manifest, 'format,channel,platform,version,minAppVersion,components') || manifest.format !== 'najd-runtime-v1' ||
        manifest.channel !== config.channel || manifest.platform !== 'win32-x64' || !version(manifest.version) || manifest.version !== config.catalogVersion || !version(manifest.minAppVersion) ||
        !Array.isArray(manifest.components) || !manifest.components.length || manifest.components.length > Object.keys(entries).length) throw fail('RUNTIME_MANIFEST_INVALID')
    const ids = new Set(manifest.components.map(row => row?.id))
    if (ids.size !== manifest.components.length) throw fail('RUNTIME_MANIFEST_INVALID')
    for (const row of manifest.components) {
      if (!exact(row, 'id,version,sourceRevision,entry,dependencies,file') || !Object.hasOwn(entries, row.id) || !version(row.version) ||
          row.entry !== entries[row.id] || !(row.sourceRevision === null || typeof row.sourceRevision === 'string' && /^[a-f0-9]{40}$/.test(row.sourceRevision)) ||
          !Array.isArray(row.dependencies) || row.dependencies.length > runtimeComponentIds.length - 1 || new Set(row.dependencies).size !== row.dependencies.length ||
          row.dependencies.some(id => !ids.has(id)) || (required[row.id] || []).some(id => !row.dependencies.includes(id)) ||
          !exact(row.file, 'name,size,sha512') || row.file.name !== `NAJD-Runtime-${row.id}-${row.version}-win32-x64.zip` ||
          !Number.isSafeInteger(row.file.size) || row.file.size < 1 || row.file.size > 2 * 1024 ** 3 ||
          typeof row.file.sha512 !== 'string' || Buffer.from(row.file.sha512, 'base64').length !== 64 ||
          Buffer.from(row.file.sha512, 'base64').toString('base64') !== row.file.sha512) throw fail('RUNTIME_MANIFEST_INVALID')
    }
    planRuntimeComponents(manifest, [...ids])
    if (!version(config.appVersion) || newer(manifest.minAppVersion, config.appVersion)) throw fail('INCOMPATIBLE_RUNTIME')
    return manifest
  } catch (error) {
    throw fail(error.code === 'SIGNATURE_INVALID' ? 'RUNTIME_SIGNATURE_INVALID' : error.code === 'INCOMPATIBLE_RUNTIME' ? error.code : 'RUNTIME_MANIFEST_INVALID')
  }
}
function runtimeAssetUrl(manifest, component, config) {
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(config.owner || '') || !/^[A-Za-z0-9_.-]{1,100}$/.test(config.repo || '') ||
      !version(manifest.version) || manifest.version !== config.catalogVersion || !manifest.components.some(row => JSON.stringify(row) === JSON.stringify(component)) ||
      !Object.hasOwn(entries, component.id) || !version(component.version) || component.file.name !== `NAJD-Runtime-${component.id}-${component.version}-win32-x64.zip`) throw fail('RUNTIME_MANIFEST_INVALID')
  return `https://github.com/${config.owner}/${config.repo}/releases/download/runtime-v${manifest.version}/${component.file.name}`
}
async function verifyRuntimeArchive(filename, component) {
  try { await verifyInstaller(filename, component) }
  catch { throw fail('RUNTIME_SIGNATURE_INVALID') }
}
module.exports = { verifyRuntimeManifest, planRuntimeComponents, runtimeAssetUrl, verifyRuntimeArchive, runtimeComponentIds }
