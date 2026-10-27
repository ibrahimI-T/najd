const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const { zipSync, strToU8 } = require('fflate')
const { createExternalSkills, parseSource } = require('../electron/external-skills.cjs')

const skill = (name, extra = '') => `---\nname: ${name}\ndescription: Does ${name} things\nlicense: MIT\n${extra}---\n# ${name}\nUse the available NAJD tools.`
function serve(routes) {
  return new Promise(resolve => {
    const server = http.createServer((request, response) => {
      const route = routes[request.url]
      if (!route) { response.statusCode = 404; return response.end() }
      if (route.redirect) { response.statusCode = 302; response.setHeader('location', route.redirect); return response.end() }
      response.end(route.body)
    }).listen(0, '127.0.0.1', () => resolve({ server, base: `http://127.0.0.1:${server.address().port}` }))
  })
}
const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'najd-ext-'))

test('source parsing accepts GitHub repos and https URLs and rejects credentials, other schemes and unknown hosts', () => {
  assert.equal(parseSource('https://github.com/acme/skills').download, 'https://codeload.github.com/acme/skills/zip/HEAD')
  const tree = parseSource('https://github.com/acme/skills/tree/main/tools/deploy')
  assert.equal(tree.download, 'https://codeload.github.com/acme/skills/zip/refs/heads/main'); assert.equal(tree.subdirectory, 'tools/deploy')
  for (const bad of ['ftp://x/y.zip', 'https://user:pw@github.com/a/b', 'https://example.com/page', 'not a url', 'file:///c:/x.zip']) assert.throws(() => parseSource(bad), /INVALID_INPUT|UNSUPPORTED_SOURCE/)
  assert.equal(parseSource('https://example.com/pack.zip').kind, 'archive')
})

test('an archive installs disabled skills with honest compatibility, then enable, read, update and remove work', async () => {
  const archive = zipSync({
    'repo-main/a/SKILL.md': strToU8(skill('Plain Helper')),
    'repo-main/b/SKILL.md': strToU8(skill('Script Helper', 'requires: python\n')),
    'repo-main/b/scripts/run.py': strToU8('print(1)'),
    'repo-main/c/SKILL.md': strToU8(skill('Mac Only', 'platforms: [macos]\n')),
    'repo-main/d/SKILL.md': strToU8('no frontmatter')
  })
  const { server, base } = await serve({ '/pack.zip': { body: Buffer.from(archive) } })
  const skills = createExternalSkills({ directory: temp() })
  try {
    const rows = await skills.install(base + '/pack.zip')
    const byId = Object.fromEntries(rows.map(row => [row.id, row]))
    assert.deepEqual(Object.keys(byId).sort(), ['ext-mac-only', 'ext-plain-helper', 'ext-script-helper'])
    assert.equal(byId['ext-plain-helper'].compatibility, 'instructions-only')
    assert.equal(byId['ext-script-helper'].compatibility, 'needs-runtime')
    assert.equal(byId['ext-mac-only'].compatibility, 'platform-mismatch')
    assert.ok(rows.every(row => row.enabled === false))
    await assert.rejects(skills.read('ext-plain-helper', 0, 100), { code: 'PERMISSION_DENIED' })
    await skills.setEnabled('ext-plain-helper', true)
    const page = await skills.read('ext-plain-helper', 0, 4000)
    assert.match(page.text, /Use the available NAJD tools/); assert.match(page.notice, /untrusted/)
    // Tampering with the stored body disables reading and enabling.
    await skills.update('ext-plain-helper')
    assert.equal((await skills.list()).find(row => row.id === 'ext-plain-helper').enabled, true, 'identical content keeps consent')
    await skills.remove('ext-plain-helper')
    assert.equal((await skills.list()).some(row => row.id === 'ext-plain-helper'), false)
    await assert.rejects(skills.remove('ext-plain-helper'), { code: 'NOT_FOUND' })
  } finally { server.close() }
})

test('changed upstream content does not inherit consent; tampered files and unsafe archives are refused', async () => {
  const dir = temp()
  let version = 1
  const bodies = () => zipSync({ 'r-main/x/SKILL.md': strToU8(skill('Evolving') + ` v${version}`) })
  const { server, base } = await serve({})
  const routes = { get '/p.zip'() { return { body: Buffer.from(bodies()) } } }
  server.removeAllListeners('request')
  server.on('request', (request, response) => { const route = routes[request.url]; if (!route) { response.statusCode = 404; return response.end() }; response.end(route.body) })
  const skills = createExternalSkills({ directory: dir })
  try {
    await skills.install(base + '/p.zip'); await skills.setEnabled('ext-evolving', true)
    version = 2
    await skills.update('ext-evolving')
    assert.equal((await skills.list())[0].enabled, false)
    await skills.setEnabled('ext-evolving', true)
    // The body the index names (stored by digest since I4-001) is tampered with.
    fs.appendFileSync(path.join(dir, 'ext-evolving', (await skills.list())[0].digest + '.md'), '\nINJECTED')
    await assert.rejects(skills.read('ext-evolving', 0, 100), { code: 'LIBRARY_CORRUPT' })
    const evil = zipSync({ '../escape/SKILL.md': strToU8(skill('Escape')) })
    routes['/evil.zip'] = { body: Buffer.from(evil) }
    await assert.rejects(skills.install(base + '/evil.zip'), { code: 'ARCHIVE_INVALID' })
    await assert.rejects(skills.install(base + '/missing.zip'), { code: 'NOT_FOUND' })
    routes['/one.md'] = { body: Buffer.from(skill('Direct File')) }
    assert.equal((await skills.install(base + '/one.md'))[0].id, 'ext-direct-file')
  } finally { server.close() }
})

test('I4-001: an update cancelled before its index commit leaves the earlier version readable', async () => {
  const fsx = require('node:fs'), osx = require('node:os'), pathx = require('node:path')
  const { createExternalSkills } = require('../electron/external-skills.cjs')
  const { zipSync, strToU8 } = require('fflate')
  const dir = fsx.mkdtempSync(pathx.join(osx.tmpdir(), 'najd-skill-commit-'))
  const make = text => zipSync({ 'repo-main/SKILL.md': strToU8('---\nname: steady\ndescription: A steady skill\n---\n' + text) })
  let archive = make('Version one.')
  const skills = createExternalSkills({ directory: dir, fetchImpl: async () => new Response(archive) })
  await skills.install('https://github.com/acme/steady')
  await skills.setEnabled('ext-steady', true)
  archive = make('Version two.')
  const controller = new AbortController()
  const pending = skills.install('https://github.com/acme/steady', controller.signal)
  controller.abort()
  await pending.catch(() => {})
  const read = await skills.read('ext-steady', 0, 200)
  assert.match(read.text, /Version one\./)
})

test('I5-002: two skills of one archive with the same id keep the committed body readable', async () => {
  const fsx = require('node:fs'), osx = require('node:os'), pathx = require('node:path')
  const { createExternalSkills } = require('../electron/external-skills.cjs')
  const { zipSync, strToU8 } = require('fflate')
  const dir = fsx.mkdtempSync(pathx.join(osx.tmpdir(), 'najd-skill-dupe-'))
  const body = text => strToU8('---\nname: twin\ndescription: A twin skill\n---\n' + text)
  let archive = zipSync({ 'repo-main/SKILL.md': body('Body A.') })
  const skills = createExternalSkills({ directory: dir, fetchImpl: async () => new Response(archive) })
  await skills.install('https://github.com/acme/twin')
  archive = zipSync({ 'repo-main/one/SKILL.md': body('Body B.'), 'repo-main/two/SKILL.md': body('Body A.') })
  await skills.install('https://github.com/acme/twin')
  await skills.setEnabled('ext-twin', true)
  assert.match((await skills.read('ext-twin', 0, 200)).text, /Body [AB]\./)
})

test('R8-002: an archive of thousands of large unrelated files installs its skill without expanding them', async () => {
  const fsx = require('node:fs'), osx = require('node:os'), pathx = require('node:path')
  const { createExternalSkills } = require('../electron/external-skills.cjs')
  const { zipSync, strToU8 } = require('fflate')
  const entries = { 'repo-main/SKILL.md': strToU8('---\nname: lean\ndescription: A lean skill\n---\nBody.') }
  const filler = new Uint8Array(1024 * 1024) // compresses to almost nothing
  for (let n = 0; n < 1500; n++) entries['repo-main/data/file-' + n + '.bin'] = filler
  const archive = zipSync(entries, { level: 9 })
  const skills = createExternalSkills({ directory: fsx.mkdtempSync(pathx.join(osx.tmpdir(), 'najd-skill-bomb-')), fetchImpl: async () => new Response(archive) })
  const before = process.memoryUsage().rss
  const [row] = await skills.install('https://github.com/acme/lean')
  assert.equal(row.id, 'ext-lean')
  assert.ok(process.memoryUsage().rss - before < 400 * 1024 * 1024, 'the 1.5 GB of filler was not expanded')
})

test('R9-001: an oversized SKILL.md stops inflating at the limit and is left out; the rest of the archive installs', async () => {
  const fsx = require('node:fs'), osx = require('node:os'), pathx = require('node:path')
  const { createExternalSkills } = require('../electron/external-skills.cjs')
  const { zipSync, strToU8 } = require('fflate')
  const big = '---\nname: huge\ndescription: Too big\n---\n' + 'x'.repeat(20 * 1024 * 1024)
  const archive = zipSync({ 'repo-main/huge/SKILL.md': strToU8(big), 'repo-main/ok/SKILL.md': strToU8('---\nname: fine\ndescription: Fine\n---\nBody.') }, { level: 9 })
  const skills = createExternalSkills({ directory: fsx.mkdtempSync(pathx.join(osx.tmpdir(), 'najd-skill-big-')), fetchImpl: async () => new Response(archive) })
  const rows = await skills.install('https://github.com/acme/mixed')
  assert.deepEqual(rows.map(row => row.id), ['ext-fine'])
  const controller = new AbortController(); controller.abort()
  await assert.rejects(skills.install('https://github.com/acme/mixed', controller.signal), { code: 'CANCELLED' })
})

test('R14-001: a folder link installs its skill even when the repository holds many skills', async () => {
  const fsx = require('node:fs'), osx = require('node:os'), pathx = require('node:path')
  const { createExternalSkills } = require('../electron/external-skills.cjs')
  const { zipSync, strToU8 } = require('fflate')
  const entries = {}
  for (let n = 0; n < 80; n++) entries[`repo-main/skills/s${n}/SKILL.md`] = strToU8(`---\nname: s${n}\ndescription: Skill ${n}\n---\nBody ${n}.`)
  const archive = zipSync(entries)
  const skills = createExternalSkills({ directory: fsx.mkdtempSync(pathx.join(osx.tmpdir(), 'najd-skill-folder-')), fetchImpl: async () => new Response(archive) })
  const rows = await skills.install('https://github.com/acme/many/tree/main/skills/s42')
  assert.deepEqual(rows.map(row => row.id), ['ext-s42'])
  assert.equal((await skills.install('https://github.com/acme/many')).length, 80, 'there is no small skill-count limit: the whole repository installs too')
})

test('a skill owned by a plugin can be replaced or removed only by that plugin', async () => {
  const archive = zipSync({ 'repo-main/a/SKILL.md': strToU8(skill('Owned Helper')) })
  const { server, base } = await serve({ '/pack.zip': { body: Buffer.from(archive) } })
  const owned = new Map()
  const skills = createExternalSkills({ directory: temp(), owners: async () => owned })
  try {
    const [row] = await skills.install(`${base}/pack.zip`, undefined, null, { owner: 'plug' }).catch(() => skills.install(`${base}/pack.zip`))
    owned.set(row.id, 'plug')
    await assert.rejects(skills.install(`${base}/pack.zip`), { code: 'SKILL_OWNED' })
    await assert.rejects(skills.remove(row.id), { code: 'SKILL_OWNED' })
    assert.equal(await skills.remove(row.id, { owner: 'plug' }), true)
  } finally { server.close() }
})

test('a plugin install never overwrites a standalone skill; a reinstall may replace the ones it had', async () => {
  const archive = zipSync({ 'repo-main/a/SKILL.md': strToU8(skill('Shared Name')) })
  const { server, base } = await serve({ '/pack.zip': { body: Buffer.from(archive) } })
  const skills = createExternalSkills({ directory: temp() })
  try {
    const [row] = await skills.install(`${base}/pack.zip`)
    await assert.rejects(skills.install(`${base}/pack.zip`, undefined, null, { owner: 'plug', mayReplace: [] }), { code: 'SKILL_EXISTS' })
    assert.equal((await skills.install(`${base}/pack.zip`, undefined, null, { owner: 'plug', mayReplace: [row.id] })).length, 1)
  } finally { server.close() }
})

test('a learned skill is saved enabled, read back, replaced only by a learned skill of the same name, and never updated from a source', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'najd-learned-'))
  const skills = createExternalSkills({ directory: dir })
  const row = await skills.saveLearned({ name: 'Monthly report', description: 'Turn the monthly CSV into an Excel report', steps: '1. convert("data.csv", "xlsx")\n2. add the totals row\n3. review it' })
  assert.equal(row.id, 'my-monthly-report'); assert.equal(row.enabled, true); assert.equal(row.learned, true)
  const read = await skills.read('my-monthly-report', 0, 8000)
  assert.match(read.text, /^---\nname: Monthly report\ndescription: Turn the monthly CSV/); assert.match(read.text, /convert\("data.csv", "xlsx"\)/)
  const again = await skills.saveLearned({ name: 'Monthly report', description: 'Turn the monthly CSV into an Excel report', steps: 'Updated steps that are long enough.' })
  assert.notEqual(again.digest, row.digest)
  assert.equal((await skills.list()).length, 1)
  await assert.rejects(skills.update('my-monthly-report'), { code: 'NOT_UPDATABLE' })
  for (const bad of [{ name: 'تقرير', description: 'a valid description', steps: 'steps that are long enough' }, { name: 'ok name', description: 'short', steps: 'steps that are long enough' },
    { name: 'ok name', description: 'a valid description', steps: 'tiny' }, { name: 'ok name', description: 'a valid description', steps: 'x'.repeat(3001) }, { name: 'ok name', description: 'a valid description', steps: 'hidden\u0007 bell in the steps' }]) await assert.rejects(skills.saveLearned(bad), { code: 'INVALID_INPUT' })
  fs.rmSync(dir, { recursive: true, force: true })
})