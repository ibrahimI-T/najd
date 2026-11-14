// A skill the user names travels with the request as one line of metadata, so a definition needs no search or full read.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { namedSkillRows } = require('../electron/agent-runtime.cjs')
const rows = [
  { id: 'brainstorming', name: 'brainstorming', description: 'Explore intent before building.', enabled: true },
  { id: 'najd-deep-research', name: 'Deep research', description: 'Iterative research with sources.', enabled: true },
  { id: 'test', name: 'test', description: 'Too short to match.', enabled: true },
  { id: 'off-skill', name: 'Disabled one', description: 'x', enabled: false }
]
test('matches whole names, Arabic text around them, the id without its prefix, and nothing disabled or too short', () => {
  assert.deepEqual(namedSkillRows(rows, 'وش هي مهارة brainstorming؟').map(row => row.id), ['brainstorming'])
  assert.deepEqual(namedSkillRows(rows, 'explain deep research please').map(row => row.id), ['najd-deep-research'])
  assert.deepEqual(namedSkillRows(rows, 'what is brainstormingly'), [])
  assert.deepEqual(namedSkillRows(rows, 'run the test and the disabled one'), [])
  assert.deepEqual(namedSkillRows(rows, ''), [])
})
test('bounds the count and the text', () => {
  const many = Array.from({ length: 10 }, (_, index) => ({ id: 'skill-' + index + '-long', name: 'skill-' + index + '-long', description: 'd'.repeat(900), enabled: true }))
  const found = namedSkillRows(many, many.map(row => row.id).join(' '))
  assert.equal(found.length, 3); assert.equal(found[0].description.length, 300)
})

test('a request for the NAJD browser browses and never loads desktop window control', () => {
  const { selectProfile } = require('../electron/agent-toolsets.cjs')
  const own = selectProfile({ text: 'باستخدام متصفح نجد ابحث عن سعر الذهب ثم افتح أول نتيجة' })
  assert.equal(own.profile, 'research'); assert.ok(!own.extra.includes('desktop')); assert.ok(own.extra.includes('workstation'))
  assert.equal(selectProfile({ text: 'افتح برنامج المفكرة' }).profile, 'computer')
})
