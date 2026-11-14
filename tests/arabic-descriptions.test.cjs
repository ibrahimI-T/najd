// The Arabic interface describes every bundled skill and every NAJD tool in Arabic (owner request 2026-10-21); the
// model-facing text stays English. A new skill or tool without an Arabic description fails here.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path')
const root = path.join(__dirname, '..')
const toolsFile = path.join(root, 'src', 'workstation', 'toolDescriptionsAr.ts')
const keys = () => new Set([...fs.readFileSync(toolsFile, 'utf8').matchAll(/^\s+'?([\w-]+)'?: '/gm)].map(match => match[1]))

test('every shipped catalog entry has an Arabic name and description', () => {
  const { entries } = require('../electron/workstation/seed.cjs')
  assert.deepEqual(entries.filter(entry => !entry.metadataOnly && !(entry.i18n?.ar?.displayName && entry.i18n?.ar?.description)).map(entry => entry.id), [])
})

test('every NAJD tool has an Arabic description, and Arabic text is Arabic', () => {
  const ar = keys()
  const tools = [...fs.readFileSync(path.join(root, 'electron', 'agent-runtime.cjs'), 'utf8').matchAll(/^  \['(najd_[a-z_]+)'/gm)].map(match => match[1])
  assert.deepEqual(tools.filter(name => !ar.has(name)), [])
  for (const [, text] of fs.readFileSync(toolsFile, 'utf8').matchAll(/: '([^']+)'/g)) assert.match(text, /[؀-ۿ]/, text)
})
