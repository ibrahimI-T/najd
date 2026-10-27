// Before/after benchmark of NAJD's memory retrieval on the same corpus and the same questions.
//   before = the previous engine: learning.context (preferences and lessons only; the notes written in Settings were never sent)
//   after  = the memory graph service (preferences, lessons, notes, earlier conversations; stored graph, incremental)
//   naive  = sending every memory (what "no retrieval" would cost), for scale
// Synthetic data (seeded, deterministic), real stores and the real service on a temporary folder. It measures what the code does:
// block size in estimated tokens (script-aware estimate, not a tokenizer), retrieval time on this machine (not model or network time),
// and whether the fact a question needs is inside what would be sent (recall), plus how much unrelated material comes along.
// Usage: node scripts/benchmark-memory.cjs [--sizes 50,1000,5000] [--write-doc]
const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path')
const { randomUUID } = require('node:crypto')
const { createLearning } = require('../electron/learning.cjs')
const { createMemoryStore } = require('../electron/memory-store.cjs')
const { createSessionStore } = require('../electron/session-store.cjs')
const { createMemoryService } = require('../electron/memory-service.cjs')
const { estimateTokens } = require('../electron/token-estimate.cjs')

const argument = name => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : null }
const SIZES = (argument('--sizes') || '50,1000,5000').split(',').map(Number)
const rng = seed => () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296 }
const pick = (random, list) => list[Math.floor(random() * list.length)]

const NAMES = ['Falcon', 'Orion', 'Nimbus', 'Atlas', 'Zephyr', 'Borealis', 'Cinder', 'Delta', 'Ember', 'Fjord', 'Gryphon', 'Helix', 'Indigo', 'Juniper', 'Kestrel', 'Lumen', 'Mistral', 'Nebula', 'Onyx', 'Pylon']
const NOISE_NAMES = ['Harbor', 'Quartz', 'Raven', 'Sable', 'Tundra', 'Umbra', 'Vortex', 'Willow', 'Xenon', 'Yarrow']
const THINGS = [['staging server', 'test machine'], ['invoice portal', 'billing site'], ['backup job', 'archive task'], ['release branch', 'shipping line'], ['analytics dashboard', 'metrics board']]
const ATTRS = [{ noun: 'port', verb: 'listens on port', value: i => String(9100 + i) }, { noun: 'owner', verb: 'is owned by', value: i => ['Sara', 'Omar', 'Lina', 'Yusuf', 'Mona'][i % 5] + i }, { noun: 'deadline', verb: 'has its deadline on', value: i => '2027-0' + (1 + i % 9) + '-' + (10 + i % 18) }, { noun: 'folder', verb: 'is stored in the folder', value: i => '/srv/data-' + i }]
const COMMON = ['server', 'report', 'release', 'staging', 'review', 'backup', 'invoice', 'dashboard', 'checklist', 'deploy', 'pipeline', 'rollback', 'meeting', 'budget', 'client', 'template']
const AR_NAMES = ['فالكون', 'أوريون', 'نيمبوس', 'أطلس', 'زيفير', 'بوريالس']
const UNRELATED = ['What is the capital of France?', 'Tell me a short cooking recipe for pasta', 'How do I convert Celsius to Fahrenheit?', 'Write a haiku about the sea', 'What is the boiling point of water at altitude?', 'Explain how photosynthesis works', 'Translate good morning into Spanish', 'Who painted the Mona Lisa?', 'Give me three tips for better sleep', 'What does the acronym HTTP stand for?',
  'ما هي عاصمة اليابان؟', 'اكتب لي بيتاً من الشعر عن الصحراء', 'كيف أحسب مساحة الدائرة؟', 'اشرح لي معنى الاستدامة', 'ما أفضل وقت لشرب الماء؟']

function makeCorpus(size, random) {
  const facts = []
  const memories = []
  let fact = 0
  const now = Date.now()
  // 40 English facts (half lessons, half notes) and 6 Arabic ones; the rest is distractor material in the same vocabulary.
  for (let i = 0; i < 40; i++) {
    const name = NAMES[i % NAMES.length] + (i >= NAMES.length ? ' ' + (i / NAMES.length + 1 | 0) : '')
    const [thing, synonym] = THINGS[i % THINGS.length], attr = ATTRS[i % ATTRS.length], value = attr.value(i)
    const kind = i % 2 ? 'note' : 'experience'
    facts.push({ id: 'f' + fact++, kind, text: `The ${name} ${thing} ${attr.verb} ${value}.`, value, question: `Which ${attr.noun} does the ${name} ${thing} have?`, paraphrase: `${name}: what is the ${attr.noun} of the ${synonym}?`, nameless: `What is the ${attr.noun} of the ${synonym}?`, lang: 'en' })
  }
  for (let i = 0; i < 6; i++) {
    const value = String(7300 + i)
    facts.push({ id: 'f' + fact++, kind: i % 2 ? 'note' : 'experience', text: `منفذ خادم الاختبار ${AR_NAMES[i]} هو ${value}.`, value, question: `ما هو منفذ خادم الاختبار ${AR_NAMES[i]}؟`, paraphrase: `${AR_NAMES[i]}: على أي رقم يعمل جهاز الفحص؟`, nameless: 'على أي رقم يعمل جهاز الفحص؟', lang: 'ar' })
  }
  for (const item of facts) memories.push({ kind: item.kind, title: ('Fact ' + item.id).slice(0, 80), text: item.text })
  const preferences = ['I prefer short answers.', 'Call me Ibrahim.', 'Use tables for comparisons.', 'Write dates as 2027-01-31.', 'أفضل الردود المختصرة بالعربية.']
  for (const text of preferences) memories.push({ kind: 'preference', title: 'Preference', text })
  let n = 0
  while (memories.length < size) {
    const word = () => pick(random, COMMON), noise = pick(random, NOISE_NAMES) + ' ' + (n % 97), [thing] = pick(random, THINGS)
    const text = pick(random, [`Remember that the ${noise} ${thing} needs a ${word()} before the ${word()} number ${n}.`, `Note ${n}: the ${word()} for ${noise} is reviewed every week and the ${word()} is archived.`, `Before each ${word()}, check the ${word()} and the ${word()} of ${noise}; item ${n}.`, `The ${noise} ${thing} was discussed in the ${word()} meeting ${n}; no ${word()} is pending.`, `ملاحظة ${n}: راجع ${word()} الخاص بالمشروع ${noise} قبل الاجتماع.`])
    memories.push({ kind: pick(random, ['note', 'note', 'note', 'experience']), title: 'Memory ' + n, text })
    n++
  }
  return { facts, memories: memories.slice(0, Math.max(size, facts.length + preferences.length)) }
}
const snapshot = (items, now) => JSON.stringify({ format: 'najd-memory', version: 1, notes: items.map((item, i) => { const at = new Date(now - i * 3600000).toISOString(); return { id: randomUUID(), title: item.title.slice(0, 80), text: item.text, createdAt: at, updatedAt: at } }) })
const percentile = (values, p) => { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] }
const mean = values => values.reduce((a, b) => a + b, 0) / Math.max(1, values.length)

async function runSize(size) {
  const random = rng(size * 7 + 3), directory = await fs.mkdtemp(path.join(os.tmpdir(), 'najd-bench-'))
  try {
    const { facts, memories } = makeCorpus(size, random)
    const learning = createLearning({ directory: path.join(directory, 'learning') }), notes = createMemoryStore(path.join(directory, 'memory.json')), sessions = createSessionStore(path.join(directory, 'sessions.json'))
    const now = Date.now()
    await learning.importKind('preference', snapshot(memories.filter(item => item.kind === 'preference'), now))
    await learning.importKind('experience', snapshot(memories.filter(item => item.kind === 'experience'), now))
    await notes.importSnapshot(snapshot(memories.filter(item => item.kind === 'note'), now))
    const files = { preference: path.join(directory, 'learning', 'preference.json'), experience: path.join(directory, 'learning', 'experience.json'), notes: path.join(directory, 'memory.json'), sessions: path.join(directory, 'sessions.json') }
    const service = createMemoryService({ directory, learning, notes, sessions, files })
    let began = performance.now()
    await service.start()
    const buildMs = performance.now() - began
    const stats = (await service.status()).stats
    const dbSize = (await fs.stat(path.join(directory, 'memory-graph.db'))).size
    const all = memories.map(item => item.text).join('\n')
    const result = { size: memories.length, buildMs, dbSizeKb: Math.round(dbSize / 1024), entities: stats.entities, links: stats.links, naiveTokens: estimateTokens(all) }
    const sets = { question: facts.map(fact => [fact, fact.question]), paraphrase: facts.map(fact => [fact, fact.paraphrase]), nameless: facts.map(fact => [fact, fact.nameless]) }
    for (const [setName, pairs] of Object.entries(sets)) {
      const before = { hits: { note: 0, experience: 0 }, tokens: [], ms: [] }, after = { hits: { note: 0, experience: 0 }, tokens: [], ms: [], cached: [] }
      const total = { note: 0, experience: 0 }
      for (const [fact, query] of pairs) {
        total[fact.kind]++
        let started = performance.now()
        const old = await learning.context(query, { chars: 2400 })
        before.ms.push(performance.now() - started); before.tokens.push(estimateTokens(old || ''))
        if (old && old.includes(fact.value)) before.hits[fact.kind]++
        started = performance.now()
        const fresh = await service.context({ query, budgetTokens: 750, record: false })
        after.ms.push(performance.now() - started); after.tokens.push(fresh.tokens)
        if (fresh.text && fresh.text.includes(fact.value)) after.hits[fact.kind]++
        started = performance.now(); await service.context({ query, budgetTokens: 750, record: false }); after.cached.push(performance.now() - started)
      }
      result[setName] = { total, before: { recall: before.hits, tokens: mean(before.tokens), tokensMax: Math.max(...before.tokens), msP50: percentile(before.ms, 0.5), msP95: percentile(before.ms, 0.95) },
        after: { recall: after.hits, tokens: mean(after.tokens), tokensMax: Math.max(...after.tokens), msP50: percentile(after.ms, 0.5), msP95: percentile(after.ms, 0.95), cachedP50: percentile(after.cached, 0.5) } }
    }
    // Unrelated questions: what comes along when nothing is relevant.
    const unrelated = { before: [], after: [], afterItems: [], beforeMs: [], afterMs: [] }
    for (const query of UNRELATED) {
      let started = performance.now()
      const old = await learning.context(query, { chars: 2400 }); unrelated.beforeMs.push(performance.now() - started)
      started = performance.now()
      const fresh = await service.context({ query, budgetTokens: 750, record: false }); unrelated.afterMs.push(performance.now() - started)
      unrelated.before.push(estimateTokens(old || '')); unrelated.after.push(fresh.tokens); unrelated.afterItems.push(fresh.items.filter(item => item.kind !== 'preference').length)
    }
    result.unrelated = { beforeTokens: mean(unrelated.before), afterTokens: mean(unrelated.after), afterNonPreferenceItems: mean(unrelated.afterItems), beforeMsP50: percentile(unrelated.beforeMs, 0.5), afterMsP50: percentile(unrelated.afterMs, 0.5) }
    // One edit and one delete, against rebuilding.
    const sample = (await notes.list())[0]
    began = performance.now(); await notes.save({ id: sample.id, title: sample.title, text: sample.text + ' Edited once.' }); const changed = await service.sync(); result.editMs = performance.now() - began; result.editChanged = changed
    began = performance.now(); await notes.remove(sample.id); const removed = await service.sync(); result.deleteMs = performance.now() - began; result.deleteChanged = removed
    began = performance.now(); await service.rebuild(); result.rebuildMs = performance.now() - began
    service.close()
    return result
  } finally { await fs.rm(directory, { recursive: true, force: true }).catch(() => {}) }
}

// Conversations: a long current conversation (history) and earlier conversations (index).
async function runConversations() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'najd-bench-chat-'))
  try {
    const learning = createLearning({ directory: path.join(directory, 'learning') }), notes = createMemoryStore(path.join(directory, 'memory.json')), sessions = createSessionStore(path.join(directory, 'sessions.json'))
    const files = { preference: path.join(directory, 'learning', 'preference.json'), experience: path.join(directory, 'learning', 'experience.json'), notes: path.join(directory, 'memory.json'), sessions: path.join(directory, 'sessions.json') }
    const service = createMemoryService({ directory, learning, notes, sessions, files })
    await service.start()
    const random = rng(99)
    // Earlier conversations: 150 of them, 12 messages each; the fact sits in one of them.
    const facts = []
    for (let i = 0; i < 150; i++) {
      const session = await sessions.createSession()
      for (let m = 0; m < 12; m++) {
        const text = i % 25 === 0 && m === 3 ? `The ${NAMES[i / 25]} migration will happen on port ${9500 + i} after the freeze.` : `Discussion ${i}.${m} about the ${pick(random, COMMON)} and the ${pick(random, COMMON)} of project ${pick(random, NOISE_NAMES)}. ` + 'Details follow. '.repeat(6)
        await sessions.appendMessage(session.id, m % 2 ? 'assistant' : 'user', text)
      }
      if (i % 25 === 0) facts.push({ name: NAMES[i / 25], value: String(9500 + i), session: session.id })
    }
    const current = await sessions.createSession()
    let began = performance.now()
    await service.indexChats()
    const indexMs = performance.now() - began
    let hits = 0, tokens = []
    for (const fact of facts) {
      const hit = await service.context({ query: `Which port will the ${fact.name} migration use?`, conversationId: current.id, budgetTokens: 750, record: false })
      tokens.push(hit.tokens); if (hit.text && hit.text.includes(fact.value)) hits++
    }
    const stored = await sessions.listSessions()
    let everything = 0
    for (const item of stored) { const full = await sessions.getSession(item.id); everything += estimateTokens(full.messages.map(message => message.text).join('\n')) }
    // The current conversation: 80 turns, the fact in turn 3.
    const history = []
    for (let i = 0; i < 80; i++) history.push({ role: i % 2 ? 'assistant' : 'user', text: (i === 2 ? 'Our archive server is called Kestrel and its port is 6420. ' : `Turn ${i}: ` + pick(random, COMMON) + ' ') + 'padding text for the turn. '.repeat(25) })
    const compact = service.compactHistory({ history, query: 'which port does the archive server use', recentChars: 12000 })
    const full = estimateTokens(history.map(message => message.text).join('\n')), kept = estimateTokens(compact.history.map(message => message.text).join('\n'))
    service.close()
    return { sessions: stored.length, indexMs, facts: facts.length, recall: hits, excerptTokensMean: mean(tokens), everythingTokens: everything, currentFullTokens: full, currentCompactTokens: kept, currentKeptFact: compact.history.some(message => message.text.includes('6420')), compacted: compact.compacted }
  } finally { await fs.rm(directory, { recursive: true, force: true }).catch(() => {}) }
}

const fmt = (value, digits = 1) => (Math.round(value * 10 ** digits) / 10 ** digits).toString()
async function main() {
  const results = []
  for (const size of SIZES) { process.stderr.write(`size ${size}...\n`); results.push(await runSize(size)) }
  process.stderr.write('conversations...\n')
  const chats = await runConversations()
  const lines = []
  lines.push('| Memories | Set | Fact in the block: before (lessons / notes) | after (lessons / notes) | Memory block tokens: before -> after (naive: all) | Retrieval ms p50 / p95: before -> after (cached) |')
  lines.push('|---|---|---|---|---|---|')
  for (const result of results) for (const setName of ['question', 'paraphrase', 'nameless']) {
    const set = result[setName]
    lines.push(`| ${result.size} | ${setName} | ${set.before.recall.experience}/${set.total.experience} · ${set.before.recall.note}/${set.total.note} | ${set.after.recall.experience}/${set.total.experience} · ${set.after.recall.note}/${set.total.note} | ${fmt(set.before.tokens, 0)} -> ${fmt(set.after.tokens, 0)} (${result.naiveTokens}) | ${fmt(set.before.msP50)} / ${fmt(set.before.msP95)} -> ${fmt(set.after.msP50)} / ${fmt(set.after.msP95)} (${fmt(set.after.cachedP50, 2)}) |`)
  }
  const storage = ['| Memories | First build (migration) ms | One edit ms | One delete ms | Full rebuild ms | Graph file KB | Entities | Links |', '|---|---|---|---|---|---|---|---|', ...results.map(result => `| ${result.size} | ${fmt(result.buildMs, 0)} | ${fmt(result.editMs)} (changed ${result.editChanged}) | ${fmt(result.deleteMs)} (changed ${result.deleteChanged}) | ${fmt(result.rebuildMs, 0)} | ${result.dbSizeKb} | ${result.entities} | ${result.links} |`)]
  const noise = ['| Memories | Unrelated questions: tokens before -> after | Non-preference items that came along (after) | Retrieval ms p50 before -> after |', '|---|---|---|---|', ...results.map(result => `| ${result.size} | ${fmt(result.unrelated.beforeTokens, 0)} -> ${fmt(result.unrelated.afterTokens, 0)} | ${fmt(result.unrelated.afterNonPreferenceItems, 2)} | ${fmt(result.unrelated.beforeMsP50)} -> ${fmt(result.unrelated.afterMsP50)} |`)]
  const chatLines = [`| Earlier conversations indexed | Index time ms | Facts found in an excerpt | Excerpt tokens (mean) | Tokens if every conversation were sent |`, '|---|---|---|---|---|', `| ${chats.sessions} | ${fmt(chats.indexMs, 0)} | ${chats.recall}/${chats.facts} | ${fmt(chats.excerptTokensMean, 0)} | ${chats.everythingTokens} |`,
    '', `Current conversation of 80 turns: ${chats.currentFullTokens} tokens sent whole -> ${chats.currentCompactTokens} after keeping the newest part and the relevant earlier messages (fact from turn 3 kept: ${chats.currentKeptFact}; compacted: ${chats.compacted}).`]
  // The whole request for one realistic turn: the fixed part (instructions and tools of the coding profile on a large window, estimated by
  // scripts/measure-context.cjs at 4,741 tokens), the memory block, and the conversation so far.
  const IDLE = 4741, middle = results.find(item => item.size >= 1000) || results[0]
  const wholeLines = ['| | Fixed part | Memory block | Conversation (80 turns) | Whole request |', '|---|---|---|---|---|',
    `| Before (previous engine, whole history) | ${IDLE} | ${fmt(middle.question.before.tokens, 0)} | ${chats.currentFullTokens} | ${IDLE + Math.round(middle.question.before.tokens) + chats.currentFullTokens} |`,
    `| After (graph, compacted history) | ${IDLE} | ${fmt(middle.question.after.tokens, 0)} | ${chats.currentCompactTokens} | ${IDLE + Math.round(middle.question.after.tokens) + chats.currentCompactTokens} |`]
  const report = ['## Retrieval quality and size', '', ...lines, '', '## Index cost', '', ...storage, '', '## Unrelated questions', '', ...noise, '', '## Conversations', '', ...chatLines, '', '## Whole request (estimated tokens)', '', ...wholeLines].join('\n')
  console.log(report)
  if (process.argv.includes('--write-doc')) await fs.writeFile(path.join(__dirname, '..', 'docs', 'MEMORY-BENCHMARK-RESULTS.md'), `# Memory benchmark results\n\nGenerated by \`node scripts/benchmark-memory.cjs --write-doc\` on ${new Date().toISOString().slice(0, 10)}, Node ${process.version}, ${os.cpus()[0].model.trim()}. See docs/SPEC-memory-graph.md for what is and is not measured.\n\n${report}\n`)
}
module.exports = { makeCorpus, snapshot, rng }
if (require.main === module) main().catch(error => { console.error(error); process.exit(1) })
