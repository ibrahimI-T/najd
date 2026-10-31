const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { createInstructionSkills } = require('../electron/instruction-skills.cjs')
const body = 'Original upstream instructions. Do not grant new tool permissions.'
const row = { id: 'hermes-example', name: 'example', source: 'hermes', sourceRevision: 'a'.repeat(40), relativePath: 'example/SKILL.md', description: 'Testing skill', digest: createHash('sha256').update(body).digest('hex'), body, platforms: ['windows'], license: 'MIT' }
test('Windows-compatible guidance starts enabled until the user chooses; other platforms stay off; choices are durable', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'najd-skill-store-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const filePath = path.join(root, 'skills.json')
  const mac = { ...row, id: 'hermes-mac-only', platforms: ['macos'] }
  const store = createInstructionSkills({ filePath, bundle: { version: 1, skills: [row, mac] } })
  assert.deepEqual((await store.list()).map(item => item.enabled), [true, false])
  assert.equal(JSON.stringify(await store.list()).includes(body), false)
  await assert.rejects(store.read(mac.id, 0, 20), { code: 'PERMISSION_DENIED' })
  const first = await store.read(row.id, 0, 20)
  assert.equal(first.text, body.slice(0, 20)); assert.equal(first.hasMore, true)
  assert.equal(first.sourceRevision, row.sourceRevision)
  await store.setEnabled(row.id, false)
  const restarted = createInstructionSkills({ filePath, bundle: { version: 1, skills: [row, mac] } })
  assert.equal((await restarted.list())[0].enabled, false, 'a saved choice is kept after restart')
  await assert.rejects(restarted.read(row.id, 0, 20), { code: 'PERMISSION_DENIED' })
  await assert.rejects(restarted.setEnabled('../../secret', true), { code: 'INVALID_INPUT' })
  await assert.rejects(restarted.read(row.id, -1, 20), { code: 'INVALID_INPUT' })
  await fs.writeFile(filePath, '{broken')
  await assert.rejects(restarted.list(), { code: 'CAPABILITY_STORE_UNAVAILABLE' })
  assert.equal(await fs.readFile(filePath, 'utf8'), '{broken')
})
test('new NAJD execution guides are enabled on upgrade and readable on demand', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'najd-skill-store-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const ids = ['najd-computer-control', 'najd-code-engineering', 'najd-research-evidence', 'najd-skill-authoring']
  const guides = await Promise.all(ids.map(async id => {
    const body = (await fs.readFile(path.join(__dirname, '../electron/najd-skills', id + '.md'), 'utf8')).replace(/\r\n/g, '\n')
    const field = key => new RegExp('^' + key + ': (.+)$', 'm').exec(body)?.[1]
    assert.equal(field('name'), id)
    assert.ok(field('description')?.length <= 400)
    assert.ok(body.length < 5000)
    return { id, name: id, description: field('description'), source: 'najd', sourceRevision: null,
      relativePath: 'najd-skills/' + id + '.md', digest: createHash('sha256').update(body).digest('hex'), body }
  }))
  const filePath = path.join(root, 'skills.json')
  await fs.writeFile(filePath, JSON.stringify({ version: 1, enabled: {} }))
  const store = createInstructionSkills({ filePath, bundle: { version: 1, skills: guides } })
  assert.equal((await store.list()).filter(row => row.enabled && row.builtIn).length, ids.length)
  for (const guide of guides) {
    const page = await store.read(guide.id, 0, 8000)
    assert.equal(page.text, guide.body)
    assert.equal(page.hasMore, false)
    assert.equal(page.mode, 'instructions')
  }
})

test('modified bundled skill text cannot be enabled as its original revision', () => {
  assert.throws(() => createInstructionSkills({ filePath: path.resolve('unused.json'), bundle: { version: 1, skills: [{ ...row, body: 'modified' }] } }), { code: 'INCOMPATIBLE_RUNTIME' })
})

test('M3-9: NAJD guides are built in, always readable, cannot be switched off and keep their digest check', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'najd-skill-store-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const guideBody = '---\nname: najd-office-design\n---\nGuide text.'
  const guide = { id: 'najd-office-design', name: 'najd-office-design', source: 'najd', sourceRevision: null, relativePath: 'najd-skills/najd-office-design.md', description: 'Guide',
    digest: createHash('sha256').update(guideBody).digest('hex'), body: guideBody, platforms: ['windows'], license: 'NAJD' }
  const filePath = path.join(root, 'skills.json')
  const store = createInstructionSkills({ filePath, bundle: { version: 1, skills: [row, guide] } })
  await store.setEnabled(row.id, false) // a saved choice exists; the guide is still on
  const listed = (await store.list()).find(item => item.id === guide.id)
  assert.deepEqual([listed.enabled, listed.builtIn], [true, true])
  assert.equal((await store.read(guide.id, 0, 100)).text, guideBody)
  await assert.rejects(store.setEnabled(guide.id, false), { code: 'BUILT_IN_GUIDE' })
  assert.throws(() => createInstructionSkills({ filePath, bundle: { version: 1, skills: [{ ...guide, body: guideBody + ' changed' }] } }), { code: 'INCOMPATIBLE_RUNTIME' })
  assert.throws(() => createInstructionSkills({ filePath, bundle: { version: 1, skills: [{ ...guide, sourceRevision: 'a'.repeat(40) }] } }), { code: 'INCOMPATIBLE_RUNTIME' })
  // The real guide shipped with NAJD parses: name, description and a body under the size limit.
  const shipped = require('node:fs').readFileSync(path.join(__dirname, '../electron/najd-skills/najd-office-design.md'), 'utf8')
  assert.match(shipped, /^name: najd-office-design$/m); assert.ok(Buffer.byteLength(shipped) < 65536)
  assert.match(shipped, /do not calculate them/)
})
