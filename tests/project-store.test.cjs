// Projects (owner request 2026-10-31): instructions, files and a folder for the chats in a project only; a damaged file
// is preserved and reported, never rewritten.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const { randomUUID } = require('node:crypto')
const { createProjectStore, projectPrompt } = require('../electron/project-store.cjs')

const temp = t => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'najd-projects-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return path.join(dir, 'projects.json') }
const file = (char, name) => ({ id: char.repeat(64), name })

test('a project keeps its instructions, files, folder and chats; other chats get nothing', async t => {
  const filePath = temp(t)
  const store = createProjectStore({ filePath })
  const project = await store.save({ name: '  Restaurant   site ', instructions: 'Write in Arabic.\r\nUse the brand colours.' })
  assert.equal(project.name, 'Restaurant site'); assert.equal(project.instructions, 'Write in Arabic.\nUse the brand colours.')
  await store.setFiles(project.id, [file('a', 'menu.pdf'), file('a', 'menu.pdf'), file('b', 'logo.png')])
  await store.setFolder(project.id, path.join(os.tmpdir(), 'site'))
  const chat = randomUUID(), other = randomUUID()
  await store.assign(chat, project.id)
  const inChat = await store.forChat(chat)
  assert.deepEqual(inChat.files.map(item => item.name), ['menu.pdf', 'logo.png'])
  assert.deepEqual(inChat.chats, [chat])
  assert.equal(await store.forChat(other), null)
  const prompt = projectPrompt(inChat)
  assert.match(prompt, /project "Restaurant site"/); assert.match(prompt, /Use the brand colours/); assert.match(prompt, /menu\.pdf, logo\.png/); assert.match(prompt, /Project folder/)
  assert.equal(projectPrompt(null), '')
  // Saved to disk and read back by a new store.
  const again = createProjectStore({ filePath })
  assert.equal((await again.list())[0].files.length, 2)
  // Removing the project keeps its chats, outside any project.
  await again.remove(project.id)
  assert.equal(await again.forChat(chat), null)
  assert.deepEqual(await again.list(), [])
})

test('invalid input is refused and a damaged file is preserved', async t => {
  const filePath = temp(t)
  const store = createProjectStore({ filePath })
  await assert.rejects(store.save({ name: '   ', instructions: '' }), { code: 'INVALID_INPUT' })
  const project = await store.save({ name: 'X', instructions: '' })
  await assert.rejects(store.setFiles(project.id, [{ id: 'nope', name: 'a' }]), { code: 'INVALID_INPUT' })
  await assert.rejects(store.setFolder(project.id, 'relative/folder'), { code: 'INVALID_INPUT' })
  await assert.rejects(store.assign('not-a-chat', project.id), { code: 'INVALID_INPUT' })
  await assert.rejects(store.assign(randomUUID(), randomUUID()), { code: 'NOT_FOUND' })
  fs.writeFileSync(filePath, '{"version":1,"projects":"broken"')
  const damaged = createProjectStore({ filePath })
  await assert.rejects(damaged.list(), { code: 'PROJECTS_CORRUPT' })
  await assert.rejects(damaged.save({ name: 'Y', instructions: '' }), { code: 'PROJECTS_CORRUPT' })
  assert.equal(fs.readFileSync(filePath, 'utf8'), '{"version":1,"projects":"broken"', 'the damaged file is left as it was')
})
