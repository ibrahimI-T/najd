const fs = require('node:fs/promises')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { createHash } = require('node:crypto')
const { skillMetadata } = require('../electron/skill-discovery.cjs')
const root = path.resolve(__dirname, '..')
const sha = body => createHash('sha256').update(body).digest('hex')
const sources = [
  { id: 'openclaw', directory: 'third_party/openclaw', revision: '9ad5e98edb514da1ceb4d98af1b8a2817d6eb8aa' },
  { id: 'hermes', directory: 'third_party/hermes-agent', revision: 'c70332f88886932337619a1e57029bd885c28b9d' }
]
async function main() {
  const bundle = { version: 1, skills: [], notices: [] }
  for (const source of sources) {
    const git = args => execFileSync('git', ['-C', path.join(root, source.directory), ...args], { encoding: 'utf8', windowsHide: true, maxBuffer: 4 * 1024 ** 2, timeout: 15000 })
    if (git(['rev-parse', 'HEAD']).trim() !== source.revision) throw Error('Source pin mismatch')
    const files = git(['ls-tree', '-r', '--name-only', source.revision, 'skills']).trim().split('\n').filter(Boolean).sort()
    const read = file => git(['show', `${source.revision}:${file}`])
    for (const filename of files.filter(file => file.endsWith('/SKILL.md'))) {
      const body = read(filename), metadata = skillMetadata(body, source.id)
      if (!metadata || Buffer.byteLength(body) > 65536) throw Error('Unsupported bounded skill source: ' + filename)
      bundle.skills.push({ id: `${source.id}-${metadata.name.toLowerCase().replaceAll('_', '-').slice(0, 42)}-${sha(filename).slice(0, 8)}`,
        name: metadata.name, description: metadata.description || metadata.name, source: source.id,
        sourceRevision: source.revision, relativePath: filename.slice('skills/'.length),
        platforms: metadata.platforms, license: metadata.declaredLicense || 'See bundled source notices',
        author: metadata.declaredAuthor, digest: sha(body), body })
    }
    for (const filename of ['LICENSE', ...files.filter(file => /\/(?:license|licence|notice|copying)(?:\.txt)?$/i.test(file))]) {
      bundle.notices.push(`${source.id} ${source.revision} / ${filename}\n${read(filename)}`)
    }
  }
  const output = JSON.stringify(bundle, null, 2) + '\n'
  const target = path.join(root, 'electron/upstream-skills.json')
  if (process.argv.includes('--check')) {
    if ((await fs.readFile(target, 'utf8')).replaceAll('\r\n', '\n') !== output) throw Error('Bundled skill content differs from pinned source')
  } else await fs.writeFile(target, output)
  console.log(`Verified ${bundle.skills.length} pinned upstream instruction skills and ${bundle.notices.length} source notices. Executable resources are not enabled by this bundle.`)
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
