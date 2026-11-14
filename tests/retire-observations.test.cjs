// Older observations shrink once the model has seen a newer one; results the model has not seen yet and other tools stay whole.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { retireObservations } = require('../electron/context-condense.cjs')

const call = (id, name) => ({ type: 'function_call', call_id: id, name, arguments: '{}' })
const output = (id, value) => ({ type: 'function_call_output', call_id: id, output: JSON.stringify(value) })
const big = label => ({ status: 'read', window: 'w1', title: label, elements: Array.from({ length: 80 }, (_, index) => `e${index} button "${label} ${index}"`) })

test('a seen window read is shortened to its status, window and title; an unseen one and other tools are kept', () => {
  const input = [call('a', 'najd_desktop_read'), output('a', big('first')), call('b', 'najd_files_read'), output('b', { text: 'x'.repeat(2000) }), call('c', 'najd_desktop_read'), output('c', big('second'))]
  const seen = new Set(['a', 'b'])
  assert.equal(retireObservations(input, item => seen.has(item.call_id)), 1)
  const first = JSON.parse(input[1].output)
  assert.equal(first.condensed, true); assert.equal(first.window, 'w1'); assert.equal(first.title, 'first'); assert.equal(first.elements, undefined)
  assert.equal(JSON.parse(input[3].output).text.length, 2000)
  assert.equal(JSON.parse(input[5].output).elements.length, 80)
  assert.equal(retireObservations(input, () => true), 1)
  assert.equal(retireObservations(input, () => true), 0)
})
