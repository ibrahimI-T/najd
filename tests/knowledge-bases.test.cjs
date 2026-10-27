// Knowledge bases (R-057): named collections of library documents, searched by meaning-bearing words with Arabic
// spelling folded, cited by document, and offered to the agent when a question concerns them.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const { createKnowledgeBases, normalize, terms } = require('../electron/knowledge-bases.cjs')
const { createAgentRuntime } = require('../electron/agent-runtime.cjs')
const { selectProfile } = require('../electron/agent-toolsets.cjs')
const { decideAction } = require('../electron/action-policy.cjs')

const id = n => String(n).repeat(64).slice(0, 64)
const filler = 'نص عام عن البناء والتصميم المعماري والمواد. '.repeat(40)
const docs = {
  [id(1)]: { name: 'كود البناء السعودي - السلامة.pdf', kind: 'pdf', text: filler + 'البند 1004.2: يجب ألا يقل عرض الدرج في المباني السكنية عن 110 سم، ويجب توفير درابزين على الجانبين. ' + filler },
  [id(2)]: { name: 'كود البناء السعودي - الإضاءة.pdf', kind: 'pdf', text: filler + 'المادة 12: الإضاءة الطبيعية للغرف السكنية لا تقل مساحة النوافذ فيها عن 8% من مساحة الأرضية. ' + filler },
  [id(3)]: { name: 'Company policy.docx', kind: 'docx', text: 'Annual leave: every employee is entitled to 30 days of paid annual leave after one year of service. ' + 'General text. '.repeat(200) },
  [id(4)]: { name: 'site photo.png', kind: 'image', text: '' }
}
const library = {
  list: async () => Object.entries(docs).map(([key, doc]) => ({ id: key, name: doc.name, kind: doc.kind, characters: doc.text.length })),
  fullText: async key => { const doc = docs[key]; if (!doc) throw Object.assign(new Error('x'), { code: 'NOT_FOUND' }); return { id: key, name: doc.name, kind: doc.kind, textHash: 'h' + doc.text.length, text: doc.text } }
}
function store() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'najd-kb-'))
  return createKnowledgeBases({ filePath: path.join(dir, 'knowledge-bases.json'), library })
}

test('Arabic spelling is folded and articles are indexed both ways', () => {
  assert.equal(normalize('الإضاءة'), normalize('الاضاءه'))
  assert.equal(normalize('مبنى ٣'), 'مبني 3')
  assert.ok(terms('الدرج').includes('درج'))
  assert.ok(!terms('ما هو عرض الدرج؟').includes('ما'))
})

test('bases are created, filled from the library, renamed and removed; names are unique and limits hold', async () => {
  const kb = store()
  const base = await kb.create({ name: 'كود البناء السعودي', description: 'اشتراطات البناء' })
  await assert.rejects(kb.create({ name: 'كود البناء السعودي' }), { code: 'NAME_TAKEN' })
  await assert.rejects(kb.create({ name: '' }), { code: 'INVALID_NAME' })
  const filled = await kb.addItems(base.id, [id(1), id(2), id(4), id(1)])
  assert.deepEqual(filled.items.map(item => item.id), [id(1), id(2), id(4)])
  await assert.rejects(kb.addItems(base.id, ['f'.repeat(64)]), { code: 'NOT_FOUND' })
  assert.equal((await kb.update(base.id, { name: 'SBC' })).name, 'SBC')
  assert.equal((await kb.removeItem(base.id, id(4))).items.length, 2)
  assert.deepEqual((await kb.summary()).map(row => row.documents), [2])
  await kb.remove(base.id)
  assert.deepEqual(await kb.list(), [])
})

test('a question phrased differently from the source finds the right clause first, with its document', async () => {
  const kb = store()
  const base = await kb.create({ name: 'كود البناء' })
  await kb.addItems(base.id, [id(1), id(2), id(4)])
  const stairs = await kb.search(base.id, 'كم لازم يكون عرض الدرج في البيت؟')
  assert.equal(stairs.results[0].document, 'كود البناء السعودي - السلامة.pdf')
  assert.match(stairs.results[0].passage, /110 سم/)
  const light = await kb.search(base.id, 'نسبة النوافذ للاضاءه الطبيعيه')
  assert.match(light.results[0].passage, /8%/)
  assert.deepEqual(stairs.visual, [{ id: id(4), name: 'site photo.png', kind: 'image' }])
  assert.equal((await kb.search(base.id, 'cryptocurrency mining')).results.length, 0)
})

test('the agent is told about bases, searches the named one and gets cited passages', async () => {
  const kb = store()
  const base = await kb.create({ name: 'سياسات الشركة' })
  await kb.addItems(base.id, [id(3)])
  const call = (name, args, cid) => ({ kind: 'agent-tools', calls: [{ name, arguments: JSON.stringify(args), call_id: cid }], items: [{ type: 'function_call', name, arguments: JSON.stringify(args), call_id: cid }] })
  const runtime = createAgentRuntime({ catalog: { search: async () => [], details: async () => ({}) }, library: { list: async () => [], read: async () => ({}) }, logs: { read: async () => ({}) }, knowledge: kb })
  let turn = 0, instructions = '', offered = [], last = null
  await runtime.run({ request: { text: 'كم يوم الإجازة السنوية حسب سياسات الشركة؟', conversationId: 'c' },
    respond: async request => {
      if (turn === 0) { instructions = request.instructions; offered = request.tools.map(tool => tool.name) }
      last = request.input
      return turn++ === 0 ? call('najd_knowledge_search', { base: 'سياسات الشركة', query: 'annual leave days' }, 'k1') : { kind: 'message', text: '30 يوم' }
    } })
  assert.match(instructions, /"سياسات الشركة" \(1 documents\)/)
  assert.match(instructions, /what complies, each point that does not with the governing clause/)
  assert.ok(offered.includes('najd_knowledge_search'))
  const output = JSON.parse(last.find(item => item.type === 'function_call_output').output)
  assert.equal(output.results[0].document, 'Company policy.docx'); assert.match(output.results[0].passage, /30 days/)
})

test('without bases nothing is added; knowledge search is a scoped read', async () => {
  const runtime = createAgentRuntime({ catalog: { search: async () => [], details: async () => ({}) }, library: { list: async () => [] }, logs: { read: async () => ({}) }, knowledge: store() })
  let instructions = '', offered = []
  await runtime.run({ request: { text: 'وش سياسة الإجازات؟', conversationId: 'c' }, respond: async request => { instructions = request.instructions; offered = request.tools.map(tool => tool.name); return { kind: 'message', text: 'ok' } } })
  assert.doesNotMatch(instructions, /knowledge bases/)
  assert.ok(!offered.includes('najd_knowledge_search'))
  assert.equal(decideAction('knowledge.search', { kind: 'knowledge', validated: true }).decision, 'allow')
  assert.equal(selectProfile({ text: 'hello' }).profile, 'general')
})

test('NAJD-R06: the index cache forgets removed documents and bases, and a cancelled search stops', async () => {
  const kb = store()
  const base = await kb.create({ name: 'كود' })
  await kb.addItems(base.id, [id(1), id(2)])
  await kb.search(base.id, 'عرض الدرج')
  assert.equal(kb.cacheInfo().documents, 2); assert.ok(kb.cacheInfo().bytes > 0)
  await kb.removeItem(base.id, id(2))
  assert.equal(kb.cacheInfo().documents, 1)
  await kb.remove(base.id)
  assert.deepEqual(kb.cacheInfo(), { documents: 0, bytes: 0 })
  const again = await kb.create({ name: 'كود ٢' })
  await kb.addItems(again.id, [id(1)])
  const controller = new AbortController(); controller.abort()
  await assert.rejects(kb.search(again.id, 'الدرج', { signal: controller.signal }), { code: 'CANCELLED' })
})

test('I2-003: a large base is searched one document at a time within the cache limit, and the right passage still wins', async () => {
  const keys = Array.from({ length: 30 }, (_, n) => (n.toString(16).padStart(2, '0')).repeat(32))
  const text = n => ('Section ' + n + ' covers general building practice and materials. ').repeat(4000) + (n === 25 ? ' Fire exits must be at most 30 metres apart. ' : '')
  const largeLibrary = {
    list: async () => keys.map((key, n) => ({ id: key, name: 'volume-' + n + '.pdf', kind: 'pdf', characters: text(n).length })),
    fullText: async key => { const n = keys.indexOf(key); return { id: key, name: 'volume-' + n + '.pdf', kind: 'pdf', text: text(n) } }
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'najd-kb-big-'))
  const kb = createKnowledgeBases({ filePath: path.join(dir, 'kb.json'), library: largeLibrary, maxCacheBytes: 4 * 1024 * 1024 })
  const base = await kb.create({ name: 'Large code' })
  await kb.addItems(base.id, keys)
  const found = await kb.search(base.id, 'fire exits distance metres')
  assert.equal(found.results[0].document, 'volume-25.pdf'); assert.match(found.results[0].passage, /30 metres/)
  const { bytes } = kb.cacheInfo()
  assert.ok(bytes <= 4 * 1024 * 1024 + 2 * 1024 * 1024, 'cache stays within its limit plus the document in use')
})

test('I4-002: a document deleted from the library leaves its bases, and its place can be filled again', async () => {
  const present = new Set([id(1), id(2)])
  const shrinking = { list: async () => (await library.list()).filter(item => present.has(item.id)), fullText: library.fullText }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'najd-kb-membership-'))
  const file = path.join(dir, 'kb.json')
  const kb = createKnowledgeBases({ filePath: file, library: shrinking })
  const base = await kb.create({ name: 'Policies' })
  await kb.addItems(base.id, [id(1), id(2)])
  present.delete(id(2))
  await kb.list()
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).bases[0].items, [id(1)], 'the stale membership is removed and saved')
  present.add(id(3))
  assert.deepEqual((await kb.addItems(base.id, [id(3)])).items.map(item => item.id), [id(1), id(3)])
})
