// The Arabic interface describes every bundled skill and every NAJD tool in Arabic (owner request 2026-10-21); the
// model-facing text stays English. A new skill or tool without an Arabic description fails here.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path')
const root = path.join(__dirname, '..')
const keys = file => new Set([...fs.readFileSync(path.join(root, 'src', file), 'utf8').matchAll(/^\s+'?([\w-]+)'?: '/gm)].map(match => match[1]))

test('every bundled skill has an Arabic description', () => {
  const ar = keys('skillDescriptionsAr.ts')
  const upstream = require('../electron/upstream-skills.json').skills.map(row => row.name)
  const najd = fs.readdirSync(path.join(root, 'electron', 'najd-skills')).filter(name => name.endsWith('.md')).map(name => name.slice(0, -3))
  assert.deepEqual([...new Set([...upstream, ...najd])].filter(name => !ar.has(name)), [])
})

test('every NAJD tool has an Arabic description, and Arabic text is Arabic', () => {
  const ar = keys('toolDescriptionsAr.ts')
  const tools = [...fs.readFileSync(path.join(root, 'electron', 'agent-runtime.cjs'), 'utf8').matchAll(/^  \['(najd_[a-z_]+)'/gm)].map(match => match[1])
  assert.deepEqual(tools.filter(name => !ar.has(name)), [])
  for (const file of ['skillDescriptionsAr.ts', 'toolDescriptionsAr.ts'])
    for (const [, text] of fs.readFileSync(path.join(root, 'src', file), 'utf8').matchAll(/: '([^']+)'/g)) assert.match(text, /[؀-ۿ]/, text)
})
