// Vendors the open-source design skill packs into skill-packs/ at pinned commits, byte for byte, with their licenses,
// and records every file's SHA-256 in skill-packs/manifest.json. `--check` verifies the folder against the manifest
// offline (no extra, missing or changed files). Packs whose licenses forbid redistribution (React Bits, Transitions.dev)
// are not vendored; the web builder guide fetches them into the user's own project when they are used.
const fs = require('node:fs/promises')
const path = require('node:path')
const { createHash } = require('node:crypto')
const root = path.resolve(__dirname, '..')
const target = path.join(root, 'skill-packs')
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')

// copy: [source prefix in the repository, destination prefix inside the pack folder]
const PACKS = [
  { id: 'taste', title: 'Taste Skill', repo: 'Leonxlnx/taste-skill', revision: '12af471f627f866411b4bd785b19646d3672784c', license: 'MIT',
    copy: [['LICENSE', 'LICENSE'], ['skills/taste-skill/', 'taste-skill/']] },
  { id: 'impeccable', title: 'Impeccable', repo: 'pbakaus/impeccable', revision: 'd34c87e1a00989ae8dbdd7f6b30b70f23319e860', license: 'Apache-2.0',
    copy: [['LICENSE', 'LICENSE'], ['NOTICE.md', 'NOTICE.md'], ['.agents/skills/impeccable/', 'impeccable/']] },
  { id: 'gsap', title: 'GSAP Skills', repo: 'greensock/gsap-skills', revision: 'aed9cfd3277740755f6bfc1155c7aa645403b760', license: 'MIT',
    copy: [['LICENSE', 'LICENSE'], ['skills/', '']] },
  { id: 'playwright', title: 'Playwright CLI', repo: 'microsoft/playwright-cli', revision: 'b1a5903c5b633b8c9f843ad7b629c2a78437040c', license: 'Apache-2.0',
    copy: [['LICENSE', 'LICENSE'], ['skills/playwright-cli/', 'playwright-cli/']] },
  { id: 'designlang', title: 'Designlang', repo: 'Manavarya09/design-extract', revision: 'd2c28da8aae3098a7f7dc02fb4355f3f803edb6c', license: 'MIT',
    copy: [['LICENSE', 'LICENSE'], ['skills/extract-design/', 'extract-design/']] }
]

async function walk(directory, prefix = '') {
  const out = []
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const relative = prefix + entry.name
    if (entry.isSymbolicLink()) throw Error('Link in skill packs: ' + relative)
    if (entry.isDirectory()) out.push(...await walk(path.join(directory, entry.name), relative + '/'))
    else if (entry.isFile()) out.push(relative)
  }
  return out
}

async function check() {
  const manifest = JSON.parse(await fs.readFile(path.join(target, 'manifest.json'), 'utf8'))
  const expected = new Map()
  for (const pack of manifest.packs) for (const file of pack.files) expected.set(pack.id + '/' + file.path, file)
  const present = (await walk(target)).filter(file => file !== 'manifest.json')
  for (const file of present) if (!expected.has(file)) throw Error('Unlisted file in skill packs: ' + file)
  for (const [file, row] of expected) {
    const bytes = await fs.readFile(path.join(target, file)).catch(() => null)
    if (!bytes) throw Error('Missing skill pack file: ' + file)
    if (bytes.length !== row.bytes || sha256(bytes) !== row.sha256) throw Error('Changed skill pack file: ' + file)
  }
  console.log(`Verified ${expected.size} files in ${manifest.packs.length} pinned skill packs.`)
}

async function vendor() {
  const get = async url => { const response = await fetch(url, { headers: { 'User-Agent': 'NAJD-skill-vendor' } }); if (!response.ok) throw Error(response.status + ' ' + url); return response }
  await fs.rm(target, { recursive: true, force: true })
  const manifest = { version: 1, packs: [] }
  for (const pack of PACKS) {
    const tree = await (await get(`https://api.github.com/repos/${pack.repo}/git/trees/${pack.revision}?recursive=1`)).json()
    if (tree.truncated) throw Error('Tree listing truncated: ' + pack.repo)
    const files = []
    for (const [from, to] of pack.copy) {
      const blobs = tree.tree.filter(item => item.type === 'blob' && (from.endsWith('/') ? item.path.startsWith(from) : item.path === from))
      if (!blobs.length) throw Error('Nothing at ' + pack.repo + ':' + from)
      for (const blob of blobs) {
        const destination = to + blob.path.slice(from.endsWith('/') ? from.length : blob.path.length)
        const relative = from.endsWith('/') ? destination : to
        const bytes = Buffer.from(await (await get(`https://raw.githubusercontent.com/${pack.repo}/${pack.revision}/${blob.path.split('/').map(encodeURIComponent).join('/')}`)).arrayBuffer())
        if (bytes.length !== blob.size) throw Error('Size mismatch: ' + blob.path)
        await fs.mkdir(path.dirname(path.join(target, pack.id, relative)), { recursive: true })
        await fs.writeFile(path.join(target, pack.id, relative), bytes)
        files.push({ path: relative, bytes: bytes.length, sha256: sha256(bytes) })
      }
    }
    files.sort((a, b) => a.path.localeCompare(b.path))
    manifest.packs.push({ id: pack.id, title: pack.title, repo: pack.repo, revision: pack.revision, license: pack.license, files })
    console.log(`${pack.id}: ${files.length} files`)
  }
  await fs.writeFile(path.join(target, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
  await check()
}

;(process.argv.includes('--check') ? check() : vendor()).catch(error => { console.error(error.message); process.exitCode = 1 })
