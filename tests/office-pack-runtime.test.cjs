// M3 runtime integration (docs/AGENT-PLATFORM-M3-PLAN.md, M3-3..M3-5, M3-007, M3-008): the python block says truthfully
// what Python can import, the pack's state is in the capability catalog, the design profile has Python, and files a
// Python run creates are kept in the library (at most 10, failures reported, nothing for a denied run).
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createAgentRuntime } = require('../electron/agent-runtime.cjs')
const { createAgentCatalog } = require('../electron/agent-catalog.cjs')
const profiles = require('../electron/agent-profiles.json')

const call = (name, args, id) => ({ kind: 'agent-tools', calls: [{ name, arguments: JSON.stringify(args), call_id: id }],
  items: [{ type: 'function_call', name, arguments: JSON.stringify(args), call_id: id }] })
const catalog = { search: async () => [], details: async () => ({}) }

async function instructionsWith(packState) {
  let seen = ''
  const runtime = createAgentRuntime({ catalog, library: { list: async () => [] }, python: { available: async () => true, run: async () => ({}) },
    logs: { read: async () => ({}) }, pack: packState ? { describe: () => ({ state: packState }) } : null })
  await runtime.run({ request: { text: 'اعمل لي ملف اكسل فيه ميزانية', conversationId: 'c' }, respond: async request => { seen = request.instructions; return { kind: 'message', text: 'ok' } } })
  return seen
}

test('the python block names the pack when it is ready and never claims formula evaluation', async () => {
  const ready = await instructionsWith('ready')
  assert.match(ready, /Office and design pack is installed: python-docx/)
  assert.match(ready, /does not calculate them/)
  assert.doesNotMatch(ready, /recalculat(e|es) (it|them) for|evaluates formulas|can recalculate/i)
  for (const state of [null, 'not-installed']) {
    const text = await instructionsWith(state)
    assert.match(text, /Only the Python standard library is available right now \(no third-party packages, not even Pillow\)/)
    assert.match(text, /installs the Office and design pack automatically/); assert.match(text, /Never ask the user to install Python/)
  }
  assert.match(await instructionsWith('damaged'), /installs the Office and design pack automatically/)
})

test('the design profile has Python and the catalog reports the pack state', async () => {
  assert.ok(profiles.design.toolsets.includes('python'))
  assert.ok(profiles.office.toolsets.includes('python'))
  for (const [state, status] of [['ready', 'ready'], ['not-installed', 'not-installed'], ['incompatible', 'needs-reinstall'], ['damaged', 'damaged']]) {
    const agentCatalog = createAgentCatalog({ registry: { list: async () => [] }, connectors: { list: async () => [] }, getPacks: () => [{ id: 'office-pack', state, packages: ['python-docx'] }] })
    const [row] = await agentCatalog.search('excel')
    assert.equal(row.id, 'office-pack'); assert.equal(row.status, status); assert.equal(row.toolset, 'python'); assert.equal(row.ready, state === 'ready')
  }
})

test('files from an approved Python run are kept in the library; failures are reported; at most 10 imports', async () => {
  const files = ['report.docx', 'broken.xlsx', 'data.xlsx', 'deck.pptx', 'chart.png', 'logo.svg', 'notes.txt', ...Array.from({ length: 8 }, (_, i) => `extra${i}.png`)]
    .map(name => 'C:\\work\\' + name)
  const imported = [], outputs = []
  const library = { list: async () => [], importFile: async file => { if (file.endsWith('broken.xlsx') || file.endsWith('extra7.png')) throw Object.assign(new Error('x'), { code: 'EXTRACTION_FAILED' }); imported.push(file); return { id: 'lib-' + imported.length } } }
  const python = { available: async () => true, run: async () => ({ status: 'finished', exitCode: 0, output: '', files }) }
  let seen = null, turn = 0
  const runtime = createAgentRuntime({ catalog, library, python, logs: { read: async () => ({}) } })
  await runtime.run({ request: { text: 'make the files', conversationId: 'c', profile: 'office' }, requestApproval: async () => 'ALLOW_ONCE', onOutput: entry => outputs.push(entry),
    respond: async request => { if (turn++ === 0) return call('najd_python_run', { code: 'x', cwd: '' }, 'p1'); seen = JSON.parse(request.input.find(item => item.type === 'function_call_output').output); return { kind: 'message', text: 'done' } } })
  assert.equal(outputs.length, files.length, 'every file is still a conversation output')
  assert.equal(imported.length + seen.notInLibrary.length, 10, 'at most 10 import attempts')
  assert.ok(!imported.some(file => /\.(svg|txt)$/.test(file)), 'svg and txt are not imported')
  assert.equal(seen.library[0].file, 'C:\\work\\report.docx')
  assert.ok(seen.notInLibrary.some(row => row.error === 'EXTRACTION_FAILED'))
  assert.equal(outputs.find(entry => entry.path.endsWith('report.docx')).libraryId, 'lib-1')
  assert.equal(outputs.find(entry => entry.path.endsWith('logo.svg')).libraryId, null)
})

test('a denied Python run imports nothing', async () => {
  const imported = []
  const library = { list: async () => [], importFile: async file => { imported.push(file); return { id: 'x' } } }
  const python = { available: async () => true, run: async () => ({ status: 'denied_by_user', note: 'The code was not run.' }) }
  let turn = 0
  const runtime = createAgentRuntime({ catalog, library, python, logs: { read: async () => ({}) } })
  await runtime.run({ request: { text: 'make the files', conversationId: 'c', profile: 'office' }, requestApproval: async () => 'DENY',
    respond: async () => turn++ === 0 ? call('najd_python_run', { code: 'x', cwd: '' }, 'p1') : { kind: 'message', text: 'done' } })
  assert.deepEqual(imported, [])
})

test('M3-I008: office previews reach only vision models; others get the structural review and a note', async () => {
  const officeReview = { review: async () => ({ status: 'reviewed', officeRoute: { state: 'done' }, imageUrls: ['data:image/jpeg;base64,AA'] }) }
  for (const vision of [true, false]) {
    let seen = null, turn = 0
    const runtime = createAgentRuntime({ catalog, library: { list: async () => [] }, python: { available: async () => true, run: async () => ({}) }, logs: { read: async () => ({}) }, officeReview,
      pack: { describe: () => ({ state: 'ready' }) } })
    await runtime.run({ request: { text: 'check my deck', conversationId: 'c', profile: 'office', vision }, requestApproval: async () => 'ALLOW_ONCE',
      respond: async request => { if (turn++ === 0) return call('najd_office_review', { path: 'deck.pptx', playback: false, from: 0, pdf: false }, 'r1'); seen = request.input; return { kind: 'message', text: 'ok' } } })
    const result = JSON.parse(seen.find(item => item.type === 'function_call_output').output)
    const images = seen.filter(item => Array.isArray(item.content) && item.content.some(part => part.type === 'input_image'))
    assert.equal(images.length, vision ? 1 : 0)
    assert.equal(result.imageUrls, undefined)
    assert.equal(!!result.previewsNotAttached, !vision)
  }
})

test('M3-I015: the result names exactly the previews that fit the image limit', async () => {
  const urls = Array.from({ length: 8 }, (_, index) => 'data:image/jpeg;base64,A' + index)
  const officeReview = { review: async () => ({ status: 'reviewed', officeRoute: { state: 'done' }, previews: 12, imageUrls: urls, previewIndexes: [1, 2, 3, 4, 5, 6, 7, 8], previewNote: 'x' }) }
  const { MAX_IMAGES } = require('../electron/agent-context.cjs')
  let seen = null, turn = 0
  // An attached video already carries frames, leaving room for only some previews.
  const held = MAX_IMAGES - 3, clip = 'a'.repeat(64)
  const library = { list: async () => [{ id: clip, name: 'clip.mp4', kind: 'video' }], video: async () => ({ duration: 9, frames: Array.from({ length: held }, (_, time) => ({ url: 'data:image/png;base64,AA', time })) }) }
  const runtime = createAgentRuntime({ catalog, library, python: { available: async () => true, run: async () => ({}) }, logs: { read: async () => ({}) }, officeReview,
    pack: { describe: () => ({ state: 'ready' }) } })
  await runtime.run({ request: { text: 'check my deck', conversationId: 'c', profile: 'office', vision: true }, assetIds: [clip], requestApproval: async () => 'ALLOW_ONCE',
    respond: async request => { if (turn++ === 0) return call('najd_office_review', { path: 'deck.pptx', playback: false, from: 0, pdf: false }, 'r1'); seen = request.input; return { kind: 'message', text: 'ok' } } })
  const result = JSON.parse(seen.find(item => item.type === 'function_call_output').output)
  const sent = seen.filter(item => Array.isArray(item.content) && item.content.some(part => part.type === 'input_text' && /NAJD_OFFICE_PREVIEWS \(/.test(part.text)))
  const attachedImages = sent.flatMap(item => item.content.filter(part => part.type === 'input_image')).length
  assert.equal(attachedImages, 3); assert.deepEqual(result.previewsAttached, [1, 2, 3], 'the result and the attached images agree')
  assert.deepEqual(result.previewsOmitted.pages, [1, 2, 3, 4, 5, 6, 7, 8].slice(attachedImages))
  assert.match(result.previewNote, new RegExp('Previews 1' + (attachedImages > 1 ? '-' + attachedImages : '') + ' of 12'))
  assert.equal(result.imageUrls, undefined); assert.equal(result.previewIndexes, undefined)
})

test('earlier chats: the model is told about recent chats, loads the chats tools and reads them; the current chat is excluded', async () => {
  const seen = []
  const chats = {
    recent: async exclude => [{ id: 'old-1', title: 'خطة رحلة جدة', updatedAt: '2026-10-18T10:00:00.000Z' }].filter(chat => chat.id !== exclude),
    search: async (query, exclude) => { seen.push(['search', query, exclude]); return { results: [{ id: 'old-1', title: 'خطة رحلة جدة', updatedAt: '2026-10-18T10:00:00.000Z', messageCount: 4, snippet: 'الفندق على الكورنيش' }] } },
    read: async (id, offset, exclude) => { seen.push(['read', id, offset, exclude]); return { id, title: 'خطة رحلة جدة', messages: [{ role: 'user', text: 'احجز فندق على الكورنيش' }] } }
  }
  let turn = 0, instructions = '', lastInput = null
  const runtime = createAgentRuntime({ catalog, library: { list: async () => [] }, python: { available: async () => true, run: async () => ({}) }, logs: { read: async () => ({}) }, chats })
  await runtime.run({ request: { text: 'وش قلت لك عن الفندق في المحادثة الثانية؟', conversationId: 'current-1' }, requestApproval: async () => 'ALLOW_ONCE',
    respond: async request => {
      if (turn === 0) instructions = request.instructions
      lastInput = request.input
      turn++
      if (turn === 1) return call('najd_tools_load', { toolset: 'chats' }, 'l1')
      if (turn === 2) return call('najd_chats_search', { query: 'الفندق' }, 's1')
      if (turn === 3) return call('najd_chats_read', { id: 'old-1', offset: 0 }, 'r1')
      return { kind: 'message', text: 'قلت احجز فندق على الكورنيش.' }
    } })
  assert.match(instructions, /old-1 "خطة رحلة جدة" \(2026-10-18\)/)
  assert.deepEqual(seen, [['search', 'الفندق', 'current-1'], ['read', 'old-1', 0, 'current-1']])
  assert.ok(lastInput.some(item => item.type === 'function_call_output' && item.output.includes('الكورنيش')))
})
