// The memory graph: remembered notes are nodes; the things they talk about (files, names, projects, key words) are
// "star" nodes that connect the notes sharing them. A request pulls only the notes that match it and their
// neighbours instead of every note, and the same graph is what the owner sees in the app (Memory > Graph).
// Built by rules, with no model call, so it costs nothing on a small GPU. Works on plain note objects:
// { id, kind, title, text, updatedAt }.

// A note is identified by where it is stored AND its id: two stores that hold the same imported backup share ids, never identities.
const keyOf = note => (note.kind || 'note') + ':' + note.id
const MAX_NOTES = 5000

const STOP = new Set(('the and for this that with from before after please you your are was were has have had not but can will would should about into than then them they their there here what when where which while also only just very more most some any all each other such like use used using ' +
  'workflow lesson remember project user prefer always never ' +
  'في من على إلى الى عن مع هذا هذه ذلك التي الذي التى اللي ان أن إن كان كانت يكون تكون ما لا لم لن قد كل بعد قبل عند بين حتى حتي او أو ثم هو هي هم نحن انا أنا انت أنت').split(/\s+/))

const normalize = text => String(text).normalize('NFKC').toLowerCase()
  .replace(/[ً-ٰٟـ]/g, '').replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')

// A light stem: Arabic definite article and plural endings, English plural / -ing / -ed. Never shorter than three letters.
function stem(word) {
  let value = word
  if (/^[؀-ۿ]/.test(value)) { value = value.replace(/^(?:وال|بال|كال|فال|لل|ال)/, ''); value = value.replace(/(?:ات|ون|ين|ها|هم)$/, '') }
  else value = value.replace(/(?:ing|ed)$/, '').replace(/([^s])s$/, '$1')
  return value.length >= 3 ? value : word
}

function terms(text) {
  const out = []
  for (const raw of normalize(text).match(/[\p{L}\p{N}][\p{L}\p{N}_.-]*[\p{L}\p{N}]|[\p{L}\p{N}]{3,}/gu) || []) {
    const word = raw.replace(/^[._-]+|[._-]+$/g, '')
    if (word.length < 3 || STOP.has(word) || /^\d+$/.test(word)) continue
    out.push(stem(word))
  }
  return out
}

// Things that identify a subject: files and paths, addresses, @names, #tags, CamelCase names, Capitalised names inside a sentence,
// and quoted names. Returned as normalised keys with a label for display.
function entitiesOf(text) {
  const found = new Map()
  const add = (label, type) => { const key = normalize(label).replace(/[\\/]+/g, '/').replace(/^\/+|\/+$/g, ''); if (key.length >= 3 && key.length <= 60 && !STOP.has(key) && !found.has(key)) found.set(key, { label: label.slice(0, 60), type }) }
  const body = String(text)
  for (const m of body.matchAll(/(?:[A-Za-z]:)?[\\/][\w.-]*[\w-](?:[\\/][\w.-]+)*|\b[\w-]+\.(?:[a-z][a-z0-9]{1,4})\b/g)) { const value = m[0].trim(); if (/[\\/.]/.test(value) && value.length <= 80) add(value.split(/[\\/]/).filter(Boolean).slice(-1)[0] || value, 'file') }
  for (const m of body.matchAll(/https?:\/\/([\w.-]+)/g)) add(m[1], 'site')
  for (const m of body.matchAll(/[@#]([\p{L}\p{N}_]{3,})/gu)) add(m[1], 'name')
  for (const m of body.matchAll(/\b[a-z]+[A-Z][A-Za-z]+\b|\b[A-Z][a-z]+[A-Z][A-Za-z]*\b/g)) add(m[0], 'name')
  for (const m of body.matchAll(/(?<![.!?]\s)(?<!^)\b([A-Z][a-z]{2,}(?:\s[A-Z][a-z]{2,})?)\b/g)) add(m[1], 'name')
  for (const m of body.matchAll(/["“«']([^"”»'\n]{3,40})["”»']/g)) add(m[1], 'name')
  return found
}

// nodes: notes ({ type: 'note' }) and stars ({ type: 'star', starType }); edges link a note to each star it mentions
// (kind 'mentions') and two notes that share a star (kind 'related', weighted by how many they share).
function buildGraph(notes, { maxStars = 400 } = {}) {
  const used = notes.slice(0, 5000)
  const docs = used.map(note => {
    const title = normalize(note.title || '')
    const entities = entitiesOf(note.title + '\n' + note.text)
    const wordSet = new Set(terms(note.title + ' ' + note.text))
    return { note, entities, words: wordSet, title }
  })
  const df = new Map()
  for (const doc of docs) for (const word of doc.words) df.set(word, (df.get(word) || 0) + 1)
  // Key words that appear in two or more notes (and are not everywhere) also become stars: they are what connects notes
  // that never name a file or a person.
  const starNotes = new Map()
  const addStar = (key, label, starType, noteId) => { const star = starNotes.get(key) || { label, starType, notes: new Set() }; star.notes.add(noteId); starNotes.set(key, star) }
  for (const doc of docs) {
    for (const [key, entity] of doc.entities) addStar('e:' + key, entity.label, entity.type, keyOf(doc.note))
    for (const word of doc.words) { const count = df.get(word); if (count >= 2 && count <= Math.max(2, Math.floor(docs.length * 0.5))) addStar('w:' + word, word, 'topic', keyOf(doc.note)) }
  }
  const stars = [...starNotes.entries()].filter(([key, star]) => star.notes.size >= 2 || key.startsWith('e:')).sort((a, b) => b[1].notes.size - a[1].notes.size).slice(0, maxStars)
  const nodes = docs.map(doc => ({ id: 'n:' + keyOf(doc.note), type: 'note', noteId: doc.note.id, label: doc.note.title || doc.note.text.slice(0, 40), kind: doc.note.kind || 'note', updatedAt: doc.note.updatedAt || null, weight: 1 }))
  const edges = []
  const pair = new Map()
  for (const [key, star] of stars) {
    nodes.push({ id: 's:' + key, type: 'star', label: star.label, starType: star.starType, weight: star.notes.size })
    const members = [...star.notes]
    for (const noteId of members) edges.push({ from: 'n:' + noteId, to: 's:' + key, kind: 'mentions', weight: 1 })
    if (members.length <= 12) for (let i = 0; i < members.length; i++) for (let j = i + 1; j < members.length; j++) {
      const id = members[i] < members[j] ? members[i] + '|' + members[j] : members[j] + '|' + members[i]
      pair.set(id, (pair.get(id) || 0) + 1)
    }
  }
  for (const [id, weight] of pair) { const [a, b] = id.split('|'); edges.push({ from: 'n:' + a, to: 'n:' + b, kind: 'related', weight }) }
  return { nodes, edges, stats: { notes: docs.length, stars: stars.length, links: edges.length }, docs, df }
}

// The notes that answer `query`, within `budgetChars` (what the notes cost once written out): the best matches first,
// then notes linked to them through a shared star. `pinned` notes (for example the newest preferences) are placed first
// and take at most `pinnedShare` of the budget.
function retrieve(notes, query, { budgetChars = 2400, maxNotes = 10, pinned = () => false, pinnedShare = 0.4, minScore = 0.3, cost = note => note.text.length + 40 } = {}) {
  if (!notes.length) return []
  const newestFirst = (a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))
  let candidates = notes
  if (notes.length > MAX_NOTES) {
    // More notes than the graph holds: the newest pinned ones (preferences) are kept first, then the notes that share most words with the
    // request, so a long list of lessons can never push a preference out of consideration.
    const pins = notes.filter(pinned).sort(newestFirst).slice(0, 500)
    const wanted = new Set(terms(query))
    const rest = notes.filter(note => !pinned(note)).map(note => ({ note, hits: [...new Set(terms(note.title + ' ' + note.text))].filter(word => wanted.has(word)).length }))
      .sort((a, b) => b.hits - a.hits || newestFirst(a.note, b.note)).slice(0, MAX_NOTES - pins.length).map(item => item.note)
    candidates = [...pins, ...rest]
  }
  const graph = buildGraph(candidates)
  const queryTerms = new Set(terms(query)), queryEntities = new Set([...entitiesOf(query).keys()])
  const total = graph.docs.length
  const idf = word => Math.log(1 + (total + 1) / ((graph.df.get(word) || 0) + 0.5))
  const scored = graph.docs.map(doc => {
    let score = 0
    for (const word of queryTerms) if (doc.words.has(word)) score += idf(word)
    for (const key of queryEntities) if (doc.entities.has(key)) score += 2 * Math.log(2 + total)
    return { note: doc.note, doc, score: score / Math.sqrt(doc.words.size + 4) }
  })
  const chosen = []
  let spent = 0
  const take = (entry, limit) => {
    const size = cost(entry.note)
    if (chosen.length >= maxNotes || spent + size > limit || chosen.some(item => keyOf(item.note) === keyOf(entry.note))) return false
    chosen.push(entry); spent += size; return true
  }
  const newest = (a, b) => String(b.note.updatedAt).localeCompare(String(a.note.updatedAt))
  for (const entry of scored.filter(item => pinned(item.note)).sort(newest)) take(entry, budgetChars * pinnedShare)
  const seeds = scored.filter(item => item.score >= minScore && !chosen.some(c => keyOf(c.note) === keyOf(item.note))).sort((a, b) => b.score - a.score || newest(a, b))
  for (const entry of seeds) take(entry, budgetChars)
  // Neighbours: notes that share a star with a chosen note but did not match the request by themselves.
  // Neighbours: through every star the graph drew (names and files, and the key words two notes share), not only through names.
  const starsOfNote = new Map()
  for (const edge of graph.edges) if (edge.kind === 'mentions') { const set = starsOfNote.get(edge.from) || new Set(); set.add(edge.to); starsOfNote.set(edge.from, set) }
  // Only notes that matched the request open the way to their neighbours; a preference that was pinned without matching does not.
  const chosenStars = new Set(chosen.filter(item => item.score >= minScore).flatMap(item => [...(starsOfNote.get('n:' + keyOf(item.note)) || [])]))
  const neighbours = scored.filter(item => item.score < minScore && [...(starsOfNote.get('n:' + keyOf(item.note)) || [])].some(star => chosenStars.has(star))).sort(newest)
  for (const entry of neighbours) take(entry, budgetChars)
  return chosen.map(item => ({ ...item.note, score: Math.round(item.score * 100) / 100 }))
}

// For the viewer: the graph without the internals, plus the notes' text trimmed so nothing large crosses to the window.
function viewOf(notes, { textChars = 280 } = {}) {
  const graph = buildGraph(notes)
  const byId = new Map(notes.map(note => [keyOf(note), note]))
  return { nodes: graph.nodes.map(node => node.type === 'note' ? { ...node, text: String(byId.get((node.kind || 'note') + ':' + node.noteId)?.text || '').slice(0, textChars) } : node), edges: graph.edges, stats: graph.stats }
}

module.exports = { buildGraph, retrieve, viewOf, terms, entitiesOf, normalize, stem, STOP }
