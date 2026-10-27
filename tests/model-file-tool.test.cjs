const { test } = require('node:test')
const assert = require('node:assert/strict')
const { readTool, parseReadProposal } = require('../electron/model-file-tool.cjs')

test('model file schema and parser bind one exact user target without executable text', () => {
  const target = 'C:\\Fixture\\report.txt'
  const tool = readTool(target)
  assert.deepEqual(tool.parameters.properties, {})
  assert.equal(tool.parameters.additionalProperties, false)
  assert.deepEqual(parseReadProposal('preview_requested_file', '{}', target), { kind: 'tool', name: 'read-file', input: { path: target } })
  for (const [name, args] of [['shell', {}], ['preview_requested_file', { path: 'other' }], ['preview_requested_file', { path: target }], ['preview_requested_file', 'not json']])
    assert.throws(() => parseReadProposal(name, args, target), { code: 'INVALID_MODEL_OUTPUT' })
  assert.throws(() => readTool(''), { code: 'INVALID_INPUT' })
})
