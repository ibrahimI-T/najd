// Skill loading through the real integration boundary (owner live test 2026-10-31: najd-computer-control and
// najd-web-builder were refused as NOT_FOUND). The real NAJD guides, the shipped skill packs and the learned-skill store
// sit behind the same surface main.cjs uses, and the model reaches them only through the runtime's najd_skills_read and
// najd_skill_save calls.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const { createAgentRuntime } = require('../electron/agent-runtime.cjs')
const { createInstructionSkills } = require('../electron/instruction-skills.cjs')
const { createExternalSkills } = require('../electron/external-skills.cjs')
const { createSkillPacks } = require('../electron/skill-packs.cjs')
const { createSkillSurface, najdGuideRows } = require('../electron/skill-surface.cjs')
const upstream = require('../electron/upstream-skills.json')

const temp = t => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'najd-skill-surface-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir }
function surface(t) {
  const dir = temp(t)
  const packs = createSkillPacks({ root: path.join(__dirname, '..', 'skill-packs') })
  const bundled = createInstructionSkills({ filePath: path.join(dir, 'instruction-skills.json'), bundle: { ...upstream, skills: [...upstream.skills, ...najdGuideRows(path.join(__dirname, '..', 'electron', 'najd-skills')), ...packs.rows()] } })
  const external = createExternalSkills({ directory: path.join(dir, 'external-skills') })
  return { packs, external, skills: createSkillSurface({ bundled, external, packs }) }
}
// Runs one model turn per entry of calls through the runtime and returns each tool result the model received.
async function drive(skills, calls, { extensions = null, approve = 'ALLOW_ONCE' } = {}) {
  const runtime = createAgentRuntime({ catalog: { search: async () => [], details: async () => ({}), summary: async () => '' }, library: { list: async () => [] }, skills, extensions })
  const outputs = [], queue = calls.map(([name, args], index) => ({ kind: 'agent-tools', calls: [{ name, arguments: JSON.stringify(args), call_id: 'c' + index }], items: [] }))
  await runtime.run({ request: { text: 'Use the NAJD guides for this task.', conversationId: 'skills' }, requestApproval: async () => approve,
    respond: async ({ input }) => {
      const last = input.at(-1)
      if (last?.type === 'function_call_output') outputs.push(JSON.parse(last.output))
      return queue.shift() || { kind: 'message', text: 'done' }
    } })
  return outputs
}

test('every NAJD guide reads by its id with any spelling of the main file the model uses', async t => {
  const { skills } = surface(t)
  const ids = najdGuideRows(path.join(__dirname, '..', 'electron', 'najd-skills')).map(row => row.id)
  assert.ok(ids.includes('najd-computer-control') && ids.includes('najd-web-builder'))
  const calls = ids.flatMap(id => ['', 'SKILL.md', id + '.md', 'najd-skills/' + id + '.md'].map(file => ['najd_skills_read', { id, file, offset: 0, limit: 0 }]))
  const outputs = await drive(skills, calls)
  assert.equal(outputs.length, calls.length)
  for (const [index, output] of outputs.entries()) {
    assert.equal(output.error, undefined, JSON.stringify(calls[index]) + ' -> ' + JSON.stringify(output))
    assert.match(output.text, new RegExp('name: ' + calls[index][1].id))
  }
})

test('a long guide continues at nextOffset; a pack guide lists its files and reads a listed one; other files are refused with directions', async t => {
  const { skills, packs } = surface(t)
  const pack = packs.rows().find(row => packs.describe(row.id).files.length > 0)
  const listedFile = packs.describe(pack.id).files[0]
  const outputs = await drive(skills, [
    ['najd_skills_read', { id: 'najd-web-builder', file: '', offset: 0, limit: 0 }],
    ['najd_skills_read', { id: pack.id, file: 'SKILL.md', offset: 0, limit: 0 }],
    ['najd_skills_read', { id: pack.id, file: listedFile, offset: 0, limit: 0 }],
    ['najd_skills_read', { id: pack.id, file: 'not/listed.md', offset: 0, limit: 0 }],
    ['najd_skills_read', { id: 'najd-computer-control', file: 'scripts/run.ps1', offset: 0, limit: 0 }],
    ['najd_skills_read', { id: 'najd-web-build', file: '', offset: 0, limit: 0 }]
  ])
  const [guide, packGuide, packFile, unlisted, noFiles, unknown] = outputs
  if (guide.hasMore) {
    assert.equal(guide.nextOffset, guide.text.length)
    const [rest] = await drive(skills, [['najd_skills_read', { id: 'najd-web-builder', file: '', offset: guide.nextOffset, limit: 0 }]])
    assert.equal(rest.offset, guide.nextOffset); assert.ok(rest.text.length > 0)
  }
  assert.ok(Array.isArray(packGuide.files) && packGuide.files.includes(listedFile)); assert.equal(typeof packGuide.folder, 'string')
  assert.equal(packFile.file, listedFile); assert.equal(typeof packFile.text, 'string')
  assert.equal(unlisted.error, 'NOT_FOUND'); assert.match(unlisted.hint, /Listed files include/)
  assert.equal(noFiles.fileIgnored, true); assert.match(noFiles.text, /name: najd-computer-control/); assert.match(noFiles.note, /file ""/)
  assert.equal(unknown.error, 'NOT_FOUND'); assert.match(unknown.hint, /najd-web-builder/, 'a near id is suggested')
})

test('the same failed read is not repeated: the second identical call is answered from the first failure', async t => {
  const { skills } = surface(t)
  let reads = 0
  const counting = { ...skills, read: (...args) => { reads++; return skills.read(...args) } }
  const call = ['najd_skills_read', { id: 'no-such-guide', file: '', offset: 0, limit: 0 }]
  const [first, second] = await drive(counting, [call, call])
  assert.equal(first.error, 'NOT_FOUND'); assert.equal(second.error, 'REPEATED_FAILURE'); assert.equal(second.previous, 'NOT_FOUND')
  assert.equal(reads, 1)
})

test('a procedure saved through the approval flow is listed, read back and reused by its id', async t => {
  const { skills, external } = surface(t)
  const extensions = { saveSkill: async input => { const row = await external.saveLearned(input); return { status: 'saved', skill: { id: row.id, name: row.name } } } }
  const steps = '1. Load files with najd_tools_load.\n2. Write najd-test/test.txt with najd_files_write.\n3. Read it back with najd_files_read and compare every line.'
  const [denied] = await drive(skills, [['najd_skill_save', { name: 'Numbered test file', description: 'Create and verify a numbered text file', steps }]], { extensions, approve: 'DENY' })
  assert.equal(denied.status, 'denied_by_user')
  assert.equal((await skills.list()).some(row => row.name === 'Numbered test file'), false)
  const [saved] = await drive(skills, [['najd_skill_save', { name: 'Numbered test file', description: 'Create and verify a numbered text file', steps }]], { extensions })
  assert.equal(saved.status, 'saved')
  const id = saved.skill.id
  assert.ok((await skills.list()).some(row => row.id === id && row.enabled))
  const [read, readAsMain] = await drive(skills, [['najd_skills_read', { id, file: '', offset: 0, limit: 0 }], ['najd_skills_read', { id, file: 'SKILL.md', offset: 0, limit: 0 }]])
  assert.match(read.text, /najd_files_read and compare every line/)
  assert.equal(readAsMain.text, read.text)
  // The saved name without its "my-" prefix finds the same skill.
  assert.ok(id.startsWith('my-'))
  const [withoutPrefix] = await drive(skills, [['najd_skills_read', { id: id.slice(3), file: '', offset: 0, limit: 0 }]])
  assert.equal(withoutPrefix.text, read.text)
})
