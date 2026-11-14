// Universal discovery (owner request 2026-11-09): a plain conversation carries no task tools, a task gets its tools, every capability
// stays reachable through discovery, and what is loaded changes over a run without ever limiting what the model may use.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { isConversational, createToolsetManager, TOOLSETS, LOADABLE } = require('../electron/agent-toolsets.cjs')
const { createAgentRuntime } = require('../electron/agent-runtime.cjs')
const { createAgentCatalog } = require('../electron/agent-catalog.cjs')

const call = (name, args, id) => ({ kind: 'agent-tools', calls: [{ name, arguments: JSON.stringify(args), call_id: id }],
  items: [{ type: 'function_call', name, arguments: JSON.stringify(args), call_id: id }] })
const names = request => request.tools.map(tool => tool.name)
function runtime(extra = {}) {
  const workspace = { describe: () => ({ workspace: 'C:/w', grantedFolders: [] }), run: async () => ({ status: 'written', path: 'C:/w/a.txt' }) }
  return createAgentRuntime({ catalog: { search: async () => [], details: async id => ({ id, kind: 'tool', ready: true }), summary: async () => '' },
    library: { list: async () => [], read: async () => ({ text: '' }), search: async () => [] },
    skills: { read: async () => ({ text: 'guide' }) }, connectors: { readApps: async () => ({ apps: [] }) }, workspace,
    web: { available: async () => true, search: async () => ({ results: [] }), extract: async () => ({ text: '' }) },
    memory: { remember: async () => ({ status: 'saved' }), forget: async () => ({}) },
    media: { services: async () => ['openai-images', 'openai-video'], describe: { image: 'images', video: 'video' } },
    browser: { available: () => true, describe: () => 'linked.', run: async () => ({ status: 'ok' }) },
    python: { available: async () => true }, logs: { read: async () => ({}) }, processes: { available: () => true }, desktop: { available: () => true }, ...extra })
}
// A 400k-token cloud model (the balanced setup); contextMode 'full' is the setting local models get (R-081).
const CLOUD = 400000 * 3
async function firstTools(text, { extra, contextMode = null, inputBudget = CLOUD } = {}) {
  let first = null
  await runtime(extra).run({ request: { text, inputBudget, contextMode }, respond: async request => { first ||= names(request); return { kind: 'message', text: 'ok' } } })
  return first
}

test('plain conversation is told apart from a task in Arabic and English', () => {
  for (const text of ['مرحبا', 'كيف حالك اليوم؟', 'وش رأيك في القهوة العربية؟', 'hello there', 'What is the capital of France?', 'thanks!'])
    assert.equal(isConversational({ text }), true, text)
  for (const text of ['اكتب ملف وورد عن القهوة', 'افتح المتصفح', 'ابحث عن أسعار الذهب', 'create an excel sheet', 'fix this bug in my code', 'read C:\\notes.txt',
    'summarize https://example.com', 'سو لي تطبيق أندرويد', 'ارسم صورة قطة'])
    assert.equal(isConversational({ text }), false, text)
  assert.equal(isConversational({ text: 'hello', attachmentKinds: ['image'] }), false, 'an attachment is a task')
  assert.equal(isConversational({ text: 'x'.repeat(400) }), false, 'a long message is treated as a task')
  assert.equal(isConversational({ text: '' }), false)
})

test('normal chat starts with discovery only, and a task starts with its tools', async () => {
  const chat = await firstTools('كيف حالك؟')
  for (const name of TOOLSETS.core) assert.ok(chat.includes(name), 'discovery is always there: ' + name)
  assert.equal(chat.some(name => /files_write|browser|office|python_run|terminal/.test(name)), false, 'no task tools in a plain chat: ' + chat.join(','))
  assert.ok(chat.includes('najd_memory'), 'memory stays in a plain chat')
  const local = await firstTools('كيف حالك؟', { contextMode: 'full' })
  assert.ok(local.length > chat.length, 'a local model (the full setting, R-081) keeps its profile tools even in a plain chat')
  const office = await firstTools('اكتب ملف وورد عن تاريخ نجد')
  assert.ok(office.includes('najd_files_write') || office.some(name => /office|document/.test(name)), 'an office task gets its tools: ' + office.join(','))
  const coding = await firstTools('fix the failing test in C:\\w\\app.js')
  assert.ok(coding.includes('najd_files_read') && coding.length > chat.length, 'a coding task gets file tools: ' + coding.join(','))
  // A short news question reads like conversation but needs the web from its first call (daily-use test 2026-11-14).
  for (const text of ['لخص لي أهم 3 أخبار تقنية عن الذكاء الاصطناعي من هذا الأسبوع', 'وش الطقس في الرياض بكرة؟'])
    assert.ok((await firstTools(text)).includes('najd_web_search'), 'web search from the first call: ' + text)
})

test('a plain chat stays plain when the library already holds files (only this request\'s attachments count)', async () => {
  const library = { list: async () => [{ id: 'a'.repeat(64), name: 'old.png', kind: 'image', characters: 0 }], read: async () => ({ text: '' }), search: async () => [] }
  const chat = await firstTools('هلا', { extra: { library } })
  assert.equal(chat.some(name => /files_|web_|library|skills_read|toolbox/.test(name)), false, 'owner\'s Telegram greeting got 13 tools on 2026-11-09: ' + chat.join(','))
})

test('from a plain chat, the model discovers and loads any capability it needs', async () => {
  let turn = 0
  const seen = []
  const result = await runtime().run({ request: { text: 'hello' }, respond: async request => {
    seen.push(names(request))
    turn++
    if (turn === 1) return call('najd_tools_load', { toolset: 'browser', unload: '' }, 'load-browser')
    if (turn === 2) return call('najd_tools_load', { toolset: 'files', unload: '' }, 'load-files')
    return { kind: 'message', text: 'ok' }
  } })
  assert.equal(seen[0].includes('najd_browser'), false)
  assert.ok(seen.at(-1).includes('najd_browser') && seen.at(-1).includes('najd_files_write'))
  assert.ok(result.toolsets.includes('browser') && result.toolsets.includes('files'))
})

test('every loadable toolset can be loaded on its own once a run has started, whatever was loaded first', () => {
  const definitions = [...new Set(Object.values(TOOLSETS).flat())].map(name => ({ name }))
  for (const name of LOADABLE) {
    const manager = createToolsetManager({ definitions, ready: () => true })
    manager.addToolset('core'); manager.tick()
    assert.equal(manager.addToolset(name), 'LOADED', name)
  }
})

test('a full tool set makes room by dropping the least recently used toolset instead of refusing', () => {
  const all = [...new Set(Object.values(TOOLSETS).flat())].map(name => ({ name }))
  const manager = createToolsetManager({ definitions: all, ready: () => true })
  for (const name of ['core', 'memory', 'browser', 'web']) assert.equal(manager.addToolset(name), 'LOADED', name)
  // A limit just under what one more toolset needs.
  const next = 'media'
  manager.setLimit(manager.tools().length + TOOLSETS[next].length - 1)
  assert.equal(manager.addToolset(next), 'TOOL_LIMIT', 'before the first model call the selection must fit as chosen')
  manager.tick(); manager.touch(TOOLSETS.web[0]) // web was used just now, browser not since it was loaded
  manager.tick()
  assert.equal(manager.addToolset(next), 'LOADED')
  assert.deepEqual(manager.takeEvicted(), ['browser'], 'the least recently used goes first, and only as much as needed')
  assert.ok(['core', 'memory', 'web', next].every(name => manager.loaded().includes(name)), manager.loaded().join(','))
  assert.deepEqual(manager.takeEvicted(), [], 'reported once')
  assert.equal(manager.wasUnloaded('browser'), false, 'it can come back by itself')
})

test('idle toolsets are unloaded softly, only while the set is large, and come back when the model calls their tool', async () => {
  const all = [...new Set(Object.values(TOOLSETS).flat())].map(name => ({ name }))
  const manager = createToolsetManager({ definitions: all, ready: () => true })
  for (const name of ['core', 'memory', 'browser', 'web', 'files']) manager.addToolset(name)
  const size = manager.tools().length
  assert.deepEqual(manager.dropIdle(1, size), [], 'nothing is dropped while the set is not above the threshold')
  for (let i = 0; i < 5; i++) { manager.tick(); manager.touch(TOOLSETS.files[0]) }
  const dropped = manager.dropIdle(4, 4)
  assert.ok(dropped.includes('browser') && dropped.includes('web') && !dropped.includes('files'), 'only idle ones: ' + dropped.join(','))
  assert.equal(manager.wasUnloaded('browser'), false, 'a soft drop is not an unload the model asked for')
  // In a run, calling a tool of a dropped toolset loads it again.
  let turn = 0
  const result = await runtime().run({ request: { text: 'hello' }, respond: async () => {
    turn++
    if (turn === 1) return call('najd_web_search', { query: 'najd' }, 'search-1')
    return { kind: 'message', text: 'ok' }
  } })
  assert.ok(result.toolsets.includes('web'), 'a call to a tool that was not loaded brings its toolset')
})

test('discovery search finds the toolset for Arabic and English requests even when nothing is loaded', async () => {
  const catalog = createAgentCatalog({ registry: { list: async () => [] }, connectors: { list: () => [] } })
  for (const [query, toolset] of [['اكتب مستند وورد', 'office'], ['create a spreadsheet', 'office'], ['مجسم ثلاثي الأبعاد', '3d'], ['build an android app', 'mobile'], ['ابحث في الإنترنت', 'web']]) {
    const rows = await catalog.search(query)
    assert.ok(rows.some(row => row.kind === 'toolset' && row.toolsetName === toolset), query + ' → ' + rows.slice(0, 5).map(row => row.id).join(','))
  }
})
