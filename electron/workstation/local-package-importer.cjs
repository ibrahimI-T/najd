// Imports compatible skill packages already present on this computer into NAJD's verified package pipeline.
// Only the declared skills tree is copied. Credentials, application state, caches and vendor executables outside it are never read.
const fs = require('node:fs/promises')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { zipSync, unzipSync } = require('fflate')
const { payloadDigest } = require('./packages.cjs')
const { ID_MAP, najdId, skillId, rebrand, adapters, rewriteSkill } = require('./compat-names.cjs')

const error = (code, detail) => Object.assign(new Error(code), { code }, detail ? { detail } : {})
const MAX_MANIFESTS = 128, MAX_FILES = 1800, MAX_TOTAL = 192 * 1024 * 1024, PLAN_LIFETIME = 10 * 60 * 1000
const EXECUTABLE = /\.(exe|dll|msi|bat|cmd|ps1|psm1|vbs|vbe|wsf|scr|com|cpl|node|sys|jar|lnk)$/i
const SOURCE_MANIFEST = 'kimi.plugin.json'
const { mcpDeclarations } = require('./mcp-declarations.cjs')
const category = value => ({ DEVELOPER: 'developer-tools', PRODUCTIVITY: 'productivity', CREATIVE: 'creativity-design' }[String(value || '').toUpperCase()] || 'personal')

async function manifestFiles(root) {
  const found = []
  async function walk(directory, depth = 0) {
    if (depth > 9 || found.length >= MAX_MANIFESTS) return
    let entries
    try { entries = await fs.readdir(directory, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      if (found.length >= MAX_MANIFESTS) break
      if (entry.isSymbolicLink()) continue
      const full = path.join(directory, entry.name)
      if (entry.isFile() && entry.name === SOURCE_MANIFEST) found.push(full)
      else if (entry.isDirectory() && !['node_modules', '.git', 'cache', 'logs', 'sessions'].includes(entry.name.toLowerCase())) await walk(full, depth + 1)
    }
  }
  await walk(root)
  return found
}

async function collect(directory, prefix, files, tally) {
  const entries = await fs.readdir(directory, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue
    const full = path.join(directory, entry.name), relative = prefix ? prefix + '/' + entry.name : entry.name
    if (entry.isDirectory()) await collect(full, relative, files, tally)
    else if (entry.isFile()) {
      const stat = await fs.stat(full)
      tally.count++; tally.total += stat.size
      if (tally.count > MAX_FILES || tally.total > MAX_TOTAL) throw error('LOCAL_PACKAGE_TOO_LARGE')
      files[relative] = new Uint8Array(await fs.readFile(full))
    }
  }
}

async function readCandidate(filename) {
  let source
  try { source = JSON.parse(await fs.readFile(filename, 'utf8')) } catch { return null }
  if (!source || typeof source.name !== 'string' || typeof source.version !== 'string' || !/^\d+\.\d+\.\d+/.test(source.version)) return null
  const packageDirectory = path.dirname(filename), skillsDirectory = path.resolve(packageDirectory, typeof source.skills === 'string' ? source.skills : './skills')
  if (!skillsDirectory.startsWith(packageDirectory + path.sep)) return null
  let skillFolders
  try { skillFolders = (await fs.readdir(skillsDirectory, { withFileTypes: true })).filter(item => item.isDirectory() && !item.isSymbolicLink()) } catch { skillFolders = [] }
  if (!skillFolders.length) return null
  const id = najdId(source.name), displayName = rebrand(source.interface?.displayName || source.name)
  return { id, sourceId: source.name, version: source.version, displayName, description: rebrand(source.interface?.shortDescription || source.interface?.longDescription || displayName),
    publisher: { name: 'NAJD Local Import' }, license: { spdx: /^(MIT|Apache-2\.0|BSD-[23]-Clause|ISC)$/i.test(source.license || '') ? source.license : 'LicenseRef-Local-Source' },
    categories: [category(source.interface?.category)], mcpServers: mcpDeclarations(source.mcpServers), packageDirectory, skillsDirectory, skillFolders: skillFolders.map(item => item.name), manifestPath: filename }
}

async function archive(candidate) {
  const files = {}, skills = [], tally = { count: 0, total: 0 }
  for (const folder of candidate.skillFolders) {
    const target = skillId(folder), prefix = 'skills/' + target
    await collect(path.join(candidate.skillsDirectory, folder), prefix, files, tally)
    const main = prefix + '/SKILL.md'
    if (!files[main]) continue
    files[main] = rewriteSkill(files[main], folder, target)
    skills.push(prefix)
  }
  if (!skills.length) throw error('LOCAL_PACKAGE_SKILLS_MISSING')
  const notice = `Locally imported compatibility package.\nOriginal package: ${candidate.sourceId}@${candidate.version}\nOriginal manifest: ${candidate.manifestPath}\nOriginal license declaration: ${candidate.license.spdx}\nThis package is for this owner's local installation and is not a redistribution grant.\n`
  files['SOURCE-NOTICE.txt'] = new TextEncoder().encode(notice)
  const executables = Object.keys(files).filter(name => EXECUTABLE.test(name))
  const manifest = { schemaVersion: 1, id: candidate.id, displayName: candidate.displayName, version: candidate.version, publisher: candidate.publisher, description: candidate.description,
    categories: candidate.categories, skills, mcpServers: candidate.mcpServers || [], permissions: executables.length ? [{ id: 'execute', scope: 'package', reason: 'Imported skill helper files include executable scripts.' }] : [], dependencies: [],
    compatibility: { os: ['win32'], arch: ['x64', 'arm64'], minNajd: '0.10.0' }, integrity: { sha256: payloadDigest(files) }, license: { ...candidate.license, noticePath: 'SOURCE-NOTICE.txt' },
    provenance: { kind: 'local-import', sourceId: candidate.sourceId, manifestPath: candidate.manifestPath } }
  return zipSync({ ...files, 'najd-package.json': new TextEncoder().encode(JSON.stringify(manifest)) })
}

function convertCompatibleArchive(bytes, source = 'compatible-market') {
  let raw
  try { raw = unzipSync(bytes) } catch { throw error('PACKAGE_ARCHIVE_INVALID') }
  const manifestName = Object.keys(raw).find(name => name === SOURCE_MANIFEST || name.endsWith('/' + SOURCE_MANIFEST))
  if (!manifestName || manifestName.split('/').length > 3) throw error('PACKAGE_MANIFEST_MISSING')
  let original
  try { original = JSON.parse(Buffer.from(raw[manifestName]).toString('utf8')) } catch { throw error('PACKAGE_MANIFEST_INVALID') }
  if (!original || typeof original.name !== 'string' || !/^\d+\.\d+\.\d+/.test(original.version || '')) throw error('PACKAGE_MANIFEST_INVALID')
  const root = manifestName.slice(0, -SOURCE_MANIFEST.length), declared = String(original.skills || './skills/').replace(/^\.\//, '').replace(/^\/+|\/+$/g, '')
  if (!declared || declared.split('/').some(part => part === '..' || part === '.')) throw error('PACKAGE_MANIFEST_INVALID')
  const sourcePrefix = root + declared + '/', folders = [...new Set(Object.keys(raw).filter(name => name.startsWith(sourcePrefix) && name.endsWith('/SKILL.md')).map(name => name.slice(sourcePrefix.length).split('/')[0]))]
  const files = {}, skills = []
  for (const folder of folders) {
    const target = skillId(folder), from = sourcePrefix + folder + '/', to = 'skills/' + target + '/'
    for (const [name, data] of Object.entries(raw)) {
      if (!name.startsWith(from) || name.endsWith('/')) continue
      const tail = name.slice(from.length)
      if (!tail || tail.includes('\\') || tail.split('/').some(part => !part || part === '..' || part === '.')) throw error('PACKAGE_ARCHIVE_INVALID')
      files[to + tail] = data
    }
    const main = to + 'SKILL.md'
    if (files[main]) { files[main] = rewriteSkill(files[main], folder, target); skills.push('skills/' + target) }
  }
  const knownAdapter = original.name === 'kimi-browser-extension' || original.name === 'kimi-webbridge' ? 'najd-webbridge' : original.name === 'kimi-cu-win' ? 'najd-computer-use' : null
  if (!skills.length && knownAdapter) {
    files['skills/' + knownAdapter + '/SKILL.md'] = new TextEncoder().encode(adapters[knownAdapter])
    skills.push('skills/' + knownAdapter)
  }
  if (!skills.length) throw error('LOCAL_PACKAGE_SKILLS_MISSING')
  const license = /^(MIT|Apache-2\.0|BSD-[23]-Clause|ISC)$/i.test(original.license || '') ? original.license : 'LicenseRef-Local-Source'
  files['SOURCE-NOTICE.txt'] = new TextEncoder().encode(`Compatible marketplace conversion for this owner's local NAJD installation.\nOriginal package: ${original.name}@${original.version}\nOriginal license declaration: ${original.license || 'not stated'}\nSource: ${source}\nForeign runtimes, credentials and application state were not imported.\n`)
  const executables = Object.keys(files).filter(name => EXECUTABLE.test(name))
  const manifest = { schemaVersion: 1, id: najdId(original.name), displayName: rebrand(original.interface?.displayName || original.name), version: original.version,
    publisher: { name: 'NAJD Compatible Marketplace' }, description: rebrand(original.interface?.shortDescription || original.interface?.longDescription || original.name), categories: [category(original.interface?.category)], skills, mcpServers: mcpDeclarations(original.mcpServers),
    permissions: executables.length ? [{ id: 'execute', scope: 'package', reason: 'Imported skill helper files include executable scripts.' }] : [], dependencies: [], compatibility: { os: ['win32'], arch: ['x64', 'arm64'], minNajd: '0.10.0' },
    integrity: { sha256: payloadDigest(files) }, license: { spdx: license, noticePath: 'SOURCE-NOTICE.txt' }, provenance: { kind: 'compatible-market', sourceId: original.name, source } }
  return zipSync({ ...files, 'najd-package.json': new TextEncoder().encode(JSON.stringify(manifest)) })
}

function createLocalPackageImporter({ roots, packages }) {
  if (!Array.isArray(roots) || !packages?.planFromBytes || !packages?.install) throw error('INVALID_INPUT')
  const plans = new Map()
  async function discover() {
    const byId = new Map()
    for (const root of roots) {
      if (!path.isAbsolute(root || '')) continue
      for (const filename of await manifestFiles(root)) {
        const item = await readCandidate(filename)
        if (!item) continue
        const known = byId.get(item.id)
        if (!known || known.version < item.version || filename.includes(path.join('plugins', 'managed'))) byId.set(item.id, item)
      }
    }
    return [...byId.values()].sort((a, b) => a.displayName.localeCompare(b.displayName)).map(item => ({ id: item.id, version: item.version, displayName: item.displayName, description: item.description, publisher: item.publisher, license: item.license, categories: item.categories, skills: item.skillFolders.map(skillId) }))
  }
  async function plan(ids) {
    const wanted = new Set(Array.isArray(ids) ? ids : []), candidates = []
    for (const root of roots) for (const filename of await manifestFiles(root)) {
      const item = await readCandidate(filename)
      if (item && (!wanted.size || wanted.has(item.id)) && !candidates.some(row => row.id === item.id)) candidates.push(item)
    }
    if (!candidates.length) throw error('LOCAL_PACKAGES_NOT_FOUND')
    const prepared = []
    for (const item of candidates) prepared.push(await packages.planFromBytes(await archive(item), 'local-import:' + item.id))
    const planId = randomUUID()
    plans.set(planId, { createdAt: Date.now(), prepared })
    for (const [id, value] of plans) if (Date.now() - value.createdAt > PLAN_LIFETIME) plans.delete(id)
    return { planId, packages: prepared, count: prepared.length }
  }
  async function install(planId) {
    const value = plans.get(planId)
    if (!value) throw error('PLAN_EXPIRED')
    plans.delete(planId)
    const installed = [], failed = []
    for (const item of value.prepared) {
      try { installed.push(await packages.install(item.planId)) } catch (reason) { failed.push({ id: item.id, code: reason.code || 'INSTALL_FAILED' }) }
    }
    return { installed, failed }
  }
  return { discover, plan, install }
}

module.exports = { createLocalPackageImporter, convertCompatibleArchive, ID_MAP, najdId, skillId, rebrand, rewriteSkill, adapters }
