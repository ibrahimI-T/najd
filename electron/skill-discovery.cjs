const fs = require('node:fs/promises')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const execute = promisify(execFile)
const sources = [
  { id: 'openclaw', directory: 'third_party/openclaw', revision: '9ad5e98edb514da1ceb4d98af1b8a2817d6eb8aa' },
  { id: 'hermes', directory: 'third_party/hermes-agent', revision: 'c70332f88886932337619a1e57029bd885c28b9d' }
]

// Metadata preview only: deliberately not a YAML interpreter or instruction/executable loader.
function skillMetadata(text, source) {
  const header = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1]
  if (!header) return null
  function field(name, maximum = 512) {
    let value = header.match(new RegExp('^' + name + ': ([^\\r\\n]+)$', 'm'))?.[1]?.trim()
    if (!value || value.length > maximum || ['|', '>'].includes(value[0])) return null
    if (/^(["']).*\1$/.test(value)) value = value.slice(1, -1)
    return value
  }
  const name = field('name', 100)
  if (!name || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/.test(name)) return null
  const declared = field('platforms', 100)
  const platforms = declared && /^\[[a-zA-Z, '"-]+\]$/.test(declared)
    ? declared.slice(1, -1).split(',').map(value => value.trim().replace(/^['"]|['"]$/g, '')) : null
  return { name, description: field('description'), declaredVersion: field('version', 80),
    declaredAuthor: field('author', 200), declaredLicense: field('license', 100), platforms,
    format: source === 'hermes' ? 'hermes-skill' : 'openclaw-skill',
    compatibility: platforms && !platforms.includes('windows') ? 'platform-mismatch' : 'review-required',
    installable: false, executable: false }
}

async function scanSkillDirectory(directory, source, revision) {
  const rootStat = await fs.lstat(directory)
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw Object.assign(new Error('INVALID_INPUT'), { code: 'INVALID_INPUT' })
  const canonical = await fs.realpath(directory), rows = []
  let entries = 0, totalBytes = 0, limited = false
  async function walk(current, depth) {
    for await (const item of await fs.opendir(current)) {
      if (++entries > 3000 || rows.length >= 512) { limited = true; return }
      if (item.name.startsWith('.') || item.isSymbolicLink()) continue
      const filename = path.join(current, item.name)
      const resolved = await fs.realpath(filename)
      if (!resolved.startsWith(canonical + path.sep)) continue
      if (item.isDirectory()) { if (depth < 4) await walk(filename, depth + 1); else limited = true; continue }
      if (!item.isFile() || item.name !== 'SKILL.md') continue
      const handle = await fs.open(filename, 'r')
      let bytes
      try {
        const buffer = Buffer.alloc(65537), { bytesRead } = await handle.read(buffer)
        if (bytesRead > 65536) { limited = true; continue }
        bytes = buffer.subarray(0, bytesRead)
      } finally { await handle.close() }
      const metadata = skillMetadata(bytes.toString('utf8'), source) || { name: path.basename(current).slice(0, 100),
        description: null, declaredVersion: null, declaredAuthor: null, declaredLicense: null, platforms: null,
        format: 'unsupported', compatibility: 'unsupported-format', installable: false, executable: false }
      const row = { ...metadata, source, sourceRevision: revision,
        relativePath: path.relative(canonical, filename).split(path.sep).join('/'),
        digest: createHash('sha256').update(bytes).digest('hex') }
      totalBytes += Buffer.byteLength(JSON.stringify(row))
      if (totalBytes > 250000) { limited = true; return }
      rows.push(row)
    }
  }
  await walk(canonical, 0)
  return { source, sourceRevision: revision, skills: rows.sort((a, b) => a.relativePath.localeCompare(b.relativePath)), limited }
}

async function discoverSkillSources(root) {
  const result = []
  for (const source of sources) {
    const directory = path.join(root, source.directory)
    const revision = (await execute('git', ['-C', directory, 'rev-parse', 'HEAD'], { windowsHide: true, timeout: 5000 })).stdout.trim()
    if (revision !== source.revision) throw Object.assign(new Error('INCOMPATIBLE_RUNTIME'), { code: 'INCOMPATIBLE_RUNTIME' })
    result.push(await scanSkillDirectory(path.join(directory, 'skills'), source.id, revision))
  }
  return result
}
module.exports = { discoverSkillSources, scanSkillDirectory, skillMetadata }
