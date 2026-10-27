const { test } = require('node:test')
const assert = require('node:assert/strict')
const { buildGraph, retrieve, viewOf, terms, entitiesOf } = require('../electron/memory-graph.cjs')
const { memoryView, toolsView, soulSections } = require('../electron/graph-view.cjs')
const { DEFAULT_INSTRUCTIONS } = require('../electron/default-instructions.cjs')
const { TOOLSETS } = require('../electron/agent-toolsets.cjs')
const { EDGES } = require('../electron/tool-graph.cjs')

const note = (id, kind, title, text, day) => ({ id, kind, title, text, updatedAt: `2026-10-${String(day).padStart(2, '0')}T00:00:00.000Z` })
const NOTES = [
  note('1', 'preference', 'Language', 'I prefer short answers in Arabic. Call me Ibrahim.', 1),
  note('2', 'experience', 'Build', 'Remember for this project: run npm.cmd test before the build of NAJD AGENT using package.json', 2),
  note('3', 'experience', 'Telegram', 'The Telegram channel needs a BotFather token saved in Settings. NAJD AGENT handles the pairing code.', 3),
  note('4', 'preference', 'Style', 'أفضل الردود المختصرة والجداول للمقارنات', 4),
  note('5', 'experience', 'Release', 'Before a release run the smoke tests and update docs/PROGRESS.md and package.json', 5)
]

test('words and names are found in English and Arabic, and stop words are ignored', () => {
  assert.deepEqual(terms('The files and the Reports'), ['file', 'report'])
  assert.ok(terms('الملفات والتقارير').length === 2 && terms('الملفات')[0] === terms('ملفات')[0], 'the Arabic article is stripped')
  const entities = entitiesOf('Open C:/NAJD AGENT/package.json then ask @Sara about the BotFather token on https://api.example.com/x')
  const labels = [...entities.values()].map(entity => entity.label)
  assert.ok(labels.includes('package.json') && labels.includes('Sara') && labels.includes('BotFather') && labels.includes('api.example.com'))
})

test('notes that share a file or a name are linked through a star, and the graph counts them', () => {
  const graph = buildGraph(NOTES)
  assert.equal(graph.stats.notes, 5)
  const pkg = graph.nodes.find(node => node.type === 'star' && node.label === 'package.json')
  assert.ok(pkg && pkg.weight === 2, 'package.json joins the build and release notes')
  assert.ok(graph.edges.some(edge => edge.kind === 'related' && [edge.from, edge.to].sort().join() === 'n:experience:2,n:experience:5'))
  assert.ok(graph.edges.every(edge => graph.nodes.some(node => node.id === edge.from) && graph.nodes.some(node => node.id === edge.to)))
})

test('a request pulls only the notes that match it, the newest preferences first, plus notes linked to them', () => {
  const asked = retrieve(NOTES, 'how do I build NAJD AGENT and run the tests', { pinned: item => item.kind === 'preference' })
  const ids = asked.map(item => item.id)
  assert.deepEqual(ids.slice(0, 2).sort(), ['1', '4'], 'preferences first')
  assert.ok(ids.includes('2'), 'the build lesson matches')
  assert.ok(ids.includes('5'), 'the release note is linked to the build note by package.json')
  const unrelated = retrieve(NOTES, 'tell me a cooking recipe', { pinned: item => item.kind === 'preference' }).map(item => item.id)
  assert.deepEqual(unrelated.sort(), ['1', '4'], 'only the preferences when nothing else matches')
  assert.ok(retrieve(NOTES, 'build tests', { budgetChars: 120, pinned: () => false }).length <= 2, 'the budget bounds the result')
  assert.deepEqual(retrieve([], 'anything'), [])
})

test('the map carries short excerpts only, and the soul hangs its sections and the preferences around it', () => {
  const long = [note('9', 'note', 'Long', 'word '.repeat(500), 6)]
  assert.ok(viewOf(long).nodes[0].text.length <= 280)
  const view = memoryView({ notes: NOTES, soul: { name: 'NAJD', instructions: DEFAULT_INSTRUCTIONS, enabled: true } })
  assert.equal(view.stats.sections, soulSections(DEFAULT_INSTRUCTIONS).length); assert.ok(view.stats.sections >= 8)
  assert.ok(view.edges.some(edge => edge.from === 'soul' && edge.to === 'n:preference:1' && edge.kind === 'shapes'))
  assert.ok(!view.edges.some(edge => edge.from === 'soul' && edge.to === 'n:experience:2'), 'lessons do not hang from the soul')
  assert.equal(memoryView({ notes: [], soul: null }).nodes.length, 0)
})

test('the tool map lists every toolset, its follow-on links and the lean start', () => {
  const view = toolsView()
  assert.equal(view.nodes.length, Object.keys(TOOLSETS).length)
  assert.ok(view.nodes.find(node => node.id === 'core').start && view.nodes.find(node => node.id === 'files-read').start && !view.nodes.find(node => node.id === 'delegate').start)
  for (const [from, list] of Object.entries(EDGES)) for (const to of list) assert.ok(TOOLSETS[from] && TOOLSETS[to], `${from} -> ${to}`)
  assert.ok(view.edges.length >= 20)
})

test('retrieval reaches notes through shared key words too, not only through names and files', () => {
  const lower = [note('a', 'experience', 'First', 'compile deployment checks', 1), note('b', 'experience', 'Second', 'deployment rollback steps', 2), note('c', 'experience', 'Other', 'cooking pasta water', 3)]
  const ids = retrieve(lower, 'compile').map(item => item.id)
  assert.deepEqual(ids.sort(), ['a', 'b'], 'the rollback note is linked through the shared word deployment')
})

test('a very large memory draws only its newest notes and says how many there are; the tool map shows what is really connected', async () => {
  const many = Array.from({ length: 800 }, (_, i) => note('id' + i, 'note', 'Note ' + i, 'text about topic' + (i % 7) + ' number ' + i, 1 + (i % 28)))
  const view = memoryView({ notes: many, soul: null })
  assert.equal(view.stats.total, 800); assert.ok(view.stats.notes <= 500 && view.nodes.filter(node => node.type === 'note').length <= 500)
  const { createAgentRuntime } = require('../electron/agent-runtime.cjs')
  const bare = createAgentRuntime({ catalog: { search: async () => [], details: async () => ({}), summary: async () => '' }, library: { list: async () => [], read: async () => ({ text: '' }), search: async () => [] }, workspace: { describe: () => ({}), run: async () => ({}) } })
  const ready = await bare.toolsetReadiness()
  assert.equal(ready['files-read'], true); assert.equal(ready.browser, false); assert.equal(ready.desktop, false); assert.equal(ready.mcp, false); assert.equal(ready.media, false)
  const map = toolsView({ ready: name => ready[name] === true })
  assert.equal(map.nodes.find(node => node.id === 'browser').ready, false); assert.equal(map.nodes.find(node => node.id === 'files-read').ready, true)
  const connected = createAgentRuntime({ catalog: { search: async () => [], details: async () => ({}), summary: async () => '' }, library: { list: async () => [], read: async () => ({ text: '' }), search: async () => [] },
    browser: { available: () => true, describe: () => 'x', run: async () => ({}) }, mcp: { tools: async () => [{ server: 's', serverName: 'S', name: 't', inputSchema: {}, hints: {} }], call: async () => ({}) } })
  const on = await connected.toolsetReadiness()
  assert.equal(on.browser, true); assert.equal(on.mcp, true); assert.equal(on['files-read'], false, 'no workspace, no file tools')
})

test('the same id in two stores is two memories, and a huge list of lessons never pushes a preference out of retrieval', () => {
  const twin = [note('same', 'preference', 'Pref copy', 'I prefer tables for comparisons', 1), note('same', 'note', 'Note copy', 'tables for comparisons of another kind', 2)]
  const graph = buildGraph(twin)
  assert.equal(graph.nodes.filter(node => node.type === 'note').length, 2); assert.notEqual(graph.nodes[0].id, graph.nodes[1].id)
  const view = viewOf(twin)
  assert.deepEqual(view.nodes.filter(node => node.type === 'note').map(node => node.text).sort(), ['I prefer tables for comparisons', 'tables for comparisons of another kind'], 'each star shows its own excerpt')
  assert.deepEqual(retrieve(twin, 'tables for comparisons', { pinned: item => item.kind === 'preference' }).map(item => item.kind).sort(), ['note', 'preference'], 'both survive retrieval')
  const lessons = Array.from({ length: 5200 }, (_, i) => note('l' + i, 'experience', 'Lesson ' + i, 'lesson number ' + i + ' about deployment', 1 + (i % 28)))
  const all = [...lessons, note('p1', 'preference', 'Short', 'Prefer short answers', 3)]
  assert.ok(retrieve(all, 'deployment checks', { pinned: item => item.kind === 'preference' }).some(item => item.id === 'p1'), 'the preference is still pinned')
})

test('a preference pinned without matching the request does not pull unrelated lessons in through a shared word', () => {
  const pair = [note('p', 'preference', 'Style', 'Prefer short deployment answers', 1), note('l', 'experience', 'Rollback', 'deployment rollback steps', 2)]
  assert.deepEqual(retrieve(pair, 'tell me a cooking recipe', { pinned: item => item.kind === 'preference' }).map(item => item.id), ['p'], 'only the preference itself')
  assert.deepEqual(retrieve(pair, 'deployment rollback', { pinned: item => item.kind === 'preference' }).map(item => item.id).sort(), ['l', 'p'], 'a matching request still finds the lesson')
})
