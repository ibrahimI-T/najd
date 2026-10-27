// The durable memory graph: one local SQLite file (node:sqlite, built into Electron; no server, no extra dependency).
// Memories, the entities they mention, links between memories, an FTS5 full-text index, indexed conversation chunks and
// retrieval traces live in tables and are updated one memory at a time, so nothing is rebuilt per message.
// This file knows nothing about where memories come from (memory-service.cjs does); it only stores, indexes and queries.
const { DatabaseSync } = require('node:sqlite')
const { createHash } = require('node:crypto')

const SCHEMA_VERSION = 1
const fail = code => Object.assign(new Error(code), { code })
const sha = text => createHash('sha256').update(String(text)).digest('hex')
// What identifies the content of a memory: the service compares it with the stored one before doing any analysis.
const memoryHash = m => sha([m.title, m.text, m.updatedAt, m.kind].join('\u0001'))
// A search query for the stems column: every stem quoted, so no user text can become FTS syntax.
const ftsQuery = stems => stems.slice(0, 40).map(stem => '"' + String(stem).replace(/"/g, '""') + '"').join(' OR ')

function migrate(db) {
  const version = db.prepare('PRAGMA user_version').get().user_version
  if (version > SCHEMA_VERSION) throw fail('MEMORY_DB_NEWER') // a newer app wrote this file: never touch it
  if (version === SCHEMA_VERSION) return
  db.exec('BEGIN')
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
      CREATE TABLE IF NOT EXISTS memories (
        id INTEGER PRIMARY KEY,
        uid TEXT NOT NULL UNIQUE,          -- kind:ref, e.g. preference:<id>, note:<id>
        source TEXT NOT NULL,              -- learning | notes
        kind TEXT NOT NULL,                -- preference | experience | note
        ref TEXT NOT NULL,                 -- the id inside its own store
        title TEXT NOT NULL DEFAULT '',
        text TEXT NOT NULL,
        norm TEXT NOT NULL,                -- normalised text, for duplicates
        stems TEXT NOT NULL DEFAULT '',
        scope TEXT NOT NULL DEFAULT 'global',  -- global | conversation:<id> | project:<name>
        enabled INTEGER NOT NULL DEFAULT 1,    -- available to the model
        sensitive INTEGER NOT NULL DEFAULT 0,  -- looks like a secret: never retrieved
        trust REAL NOT NULL DEFAULT 1,
        origin TEXT NOT NULL DEFAULT '',       -- how it came: user, automatic, model, import
        hash TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        superseded_by TEXT
      );
      CREATE INDEX IF NOT EXISTS memories_source ON memories(source);
      CREATE VIRTUAL TABLE IF NOT EXISTS fts_memories USING fts5(title, text, stems, tokenize = 'unicode61 remove_diacritics 2');
      CREATE TABLE IF NOT EXISTS entities (id INTEGER PRIMARY KEY, norm TEXT NOT NULL UNIQUE, label TEXT NOT NULL, type TEXT NOT NULL, df INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS mentions (memory_id INTEGER NOT NULL, entity_id INTEGER NOT NULL, PRIMARY KEY (memory_id, entity_id));
      CREATE INDEX IF NOT EXISTS mentions_entity ON mentions(entity_id);
      CREATE TABLE IF NOT EXISTS links (a INTEGER NOT NULL, b INTEGER NOT NULL, kind TEXT NOT NULL, weight REAL NOT NULL DEFAULT 1, PRIMARY KEY (a, b, kind));
      CREATE INDEX IF NOT EXISTS links_b ON links(b);
      CREATE TABLE IF NOT EXISTS chats (session_id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT '', summary TEXT NOT NULL DEFAULT '', message_count INTEGER NOT NULL DEFAULT 0, indexed INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL, allowed INTEGER NOT NULL DEFAULT 1);
      CREATE TABLE IF NOT EXISTS chunks (id INTEGER PRIMARY KEY, session_id TEXT NOT NULL, idx INTEGER NOT NULL, role TEXT NOT NULL, text TEXT NOT NULL, stems TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS chunks_session ON chunks(session_id, idx);
      CREATE VIRTUAL TABLE IF NOT EXISTS fts_chunks USING fts5(text, stems, tokenize = 'unicode61 remove_diacritics 2');
      CREATE TABLE IF NOT EXISTS traces (id INTEGER PRIMARY KEY, at TEXT NOT NULL, session_id TEXT, engine TEXT NOT NULL, budget_tokens INTEGER NOT NULL, tokens INTEGER NOT NULL, ms REAL NOT NULL, query_len INTEGER NOT NULL, items TEXT NOT NULL);
    `)
    db.exec('PRAGMA user_version = ' + SCHEMA_VERSION)
    db.exec('COMMIT')
  } catch (error) { try { db.exec('ROLLBACK') } catch { /* nothing to undo */ } throw error }
}

function openMemoryDb(filePath) {
  const db = new DatabaseSync(filePath)
  try {
    db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000')
    migrate(db)
  } catch (error) { try { db.close() } catch { /* never opened */ } throw error } // a file that cannot be used must not stay open (it could not be moved aside)
  let version = Number(db.prepare("SELECT value FROM meta WHERE key = 'version'").get()?.value || 0)
  const statements = new Map()
  const stmt = sql => { let value = statements.get(sql); if (!value) { value = db.prepare(sql); statements.set(sql, value) } return value }
  const bump = () => { version++; stmt("INSERT INTO meta(key, value) VALUES('version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(String(version)) }
  // Transactions nest (the inner ones simply join the outer one), so a batch of changes is committed - and written to disk - once.
  let depth = 0
  const transaction = work => {
    if (depth > 0) return work()
    db.exec('BEGIN'); depth++
    try { const result = work(); db.exec('COMMIT'); return result } catch (error) { try { db.exec('ROLLBACK') } catch { /* already closed */ } throw error } finally { depth-- }
  }

  // ---- entities ----
  function entityId(entity) {
    const found = stmt('SELECT id FROM entities WHERE norm = ?').get(entity.norm)
    if (found) return found.id
    return Number(stmt('INSERT INTO entities(norm, label, type, df) VALUES(?, ?, ?, 0)').run(entity.norm, entity.label.slice(0, 60), entity.type).lastInsertRowid)
  }
  function dropMentions(memoryId) {
    const rows = stmt('SELECT entity_id FROM mentions WHERE memory_id = ?').all(memoryId)
    for (const row of rows) stmt('UPDATE entities SET df = df - 1 WHERE id = ?').run(row.entity_id)
    stmt('DELETE FROM mentions WHERE memory_id = ?').run(memoryId)
    stmt('DELETE FROM entities WHERE df <= 0').run()
  }
  function dropLinks(memoryId) { stmt('DELETE FROM links WHERE a = ? OR b = ?').run(memoryId, memoryId) }

  // ---- memories ----
  // m: { uid, source, kind, ref, title, text, norm, stems (array), scope?, enabled?, sensitive, trust, origin, createdAt, updatedAt, entities: [{ norm, label, type }] }
  // Returns 'added' | 'updated' | 'same'. A memory whose content did not change is left alone (its meta - enabled, scope - is kept).
  function upsertMemory(m) {
    const hash = memoryHash(m)
    return transaction(() => {
      const existing = stmt('SELECT id, hash FROM memories WHERE uid = ?').get(m.uid)
      if (existing && existing.hash === hash) return 'same'
      let id
      if (existing) {
        id = existing.id
        stmt('UPDATE memories SET title = ?, text = ?, norm = ?, stems = ?, sensitive = ?, trust = ?, origin = ?, hash = ?, updated_at = ?, superseded_by = NULL WHERE id = ?')
          .run(m.title, m.text, m.norm, m.stems.join(' '), m.sensitive ? 1 : 0, m.trust, m.origin, hash, m.updatedAt, id)
        stmt('DELETE FROM fts_memories WHERE rowid = ?').run(id)
        dropMentions(id); dropLinks(id)
      } else {
        id = Number(stmt('INSERT INTO memories(uid, source, kind, ref, title, text, norm, stems, scope, enabled, sensitive, trust, origin, hash, created_at, updated_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
          .run(m.uid, m.source, m.kind, m.ref, m.title, m.text, m.norm, m.stems.join(' '), m.scope || 'global', m.enabled === false || m.sensitive ? 0 : 1, m.sensitive ? 1 : 0, m.trust, m.origin, hash, m.createdAt, m.updatedAt).lastInsertRowid)
      }
      stmt('INSERT INTO fts_memories(rowid, title, text, stems) VALUES(?, ?, ?, ?)').run(id, m.title, m.text, m.stems.join(' '))
      for (const entity of m.entities) { const entity_id = entityId(entity); stmt('INSERT OR IGNORE INTO mentions(memory_id, entity_id) VALUES(?, ?)').run(id, entity_id); stmt('UPDATE entities SET df = df + 1 WHERE id = ?').run(entity_id) }
      // Links to the memories that share a named entity (files, names, tags): the stored form of "these belong together".
      const named = m.entities.filter(entity => entity.type !== 'topic').map(entity => entity.norm)
      if (named.length) {
        const marks = named.map(() => '?').join(',')
        const related = db.prepare(`SELECT mm.memory_id AS other, count(*) AS shared FROM mentions mm JOIN entities e ON e.id = mm.entity_id WHERE e.norm IN (${marks}) AND mm.memory_id != ? GROUP BY mm.memory_id ORDER BY shared DESC LIMIT 8`).all(...named, id)
        for (const row of related) stmt("INSERT OR REPLACE INTO links(a, b, kind, weight) VALUES(?, ?, 'related', ?)").run(Math.min(id, row.other), Math.max(id, row.other), row.shared)
      }
      // Possible contradictions: same kind, much the same words, different text, and about the same subject. Two memories that name different
      // things (a different server, client or file) are two facts, not a conflict, however alike their wording; with no names on either side
      // the wording is all there is to go on.
      const mine = new Set(m.stems), myNames = new Set(m.entities.filter(entity => entity.type !== 'topic').map(entity => entity.norm))
      if (mine.size >= 3) {
        // Candidates share at least three of its uncommon words (found through the index of words, not by ranking the whole collection).
        const rareIds = db.prepare('SELECT e.id FROM entities e JOIN mentions mm ON mm.entity_id = e.id WHERE mm.memory_id = ? AND e.type = \'topic\' AND e.df <= 40').all(id).map(row => row.id)
        const candidates = rareIds.length < 3 ? [] : db.prepare(`SELECT x.id AS id, x.stems AS stems, x.norm AS norm FROM mentions mm JOIN memories x ON x.id = mm.memory_id WHERE mm.entity_id IN (${rareIds.map(() => '?').join(',')}) AND x.kind = ? AND x.id != ? GROUP BY x.id HAVING count(*) >= 3 ORDER BY count(*) DESC LIMIT 15`).all(...rareIds, m.kind, id)
        for (const other of candidates) {
          const theirs = new Set(String(other.stems).split(' ').filter(Boolean))
          let both = 0; for (const word of mine) if (theirs.has(word)) both++
          const overlap = both / (mine.size + theirs.size - both)
          if (!(both >= 3 && overlap >= 0.35 && other.norm !== m.norm)) continue
          const theirNames = entitiesOfMemory(other.id).filter(entity => entity.type !== 'topic').map(entity => entity.norm)
          const sameSubject = !myNames.size || !theirNames.length || theirNames.some(name => myNames.has(name))
          if (sameSubject) stmt("INSERT OR REPLACE INTO links(a, b, kind, weight) VALUES(?, ?, 'conflict', ?)").run(Math.min(id, other.id), Math.max(id, other.id), overlap)
        }
      }
      bump()
      return existing ? 'updated' : 'added'
    })
  }
  function removeMemory(uid) {
    return transaction(() => {
      const row = stmt('SELECT id FROM memories WHERE uid = ?').get(uid)
      if (!row) return false
      stmt('DELETE FROM fts_memories WHERE rowid = ?').run(row.id)
      dropMentions(row.id); dropLinks(row.id)
      stmt('DELETE FROM memories WHERE id = ?').run(row.id)
      bump()
      return true
    })
  }
  // The newest enabled memories of some kinds (the preferences that always travel with a request).
  function newest({ kinds, scopes, limit }) {
    const kindMarks = kinds.map(() => '?').join(','), scopeMarks = scopes.map(() => '?').join(',')
    return db.prepare(`SELECT * FROM memories WHERE enabled = 1 AND sensitive = 0 AND superseded_by IS NULL AND kind IN (${kindMarks}) AND scope IN (${scopeMarks}) ORDER BY updated_at DESC LIMIT ?`).all(...kinds, ...scopes, limit)
  }
  const memoryCount = () => stmt('SELECT count(*) c FROM memories').get().c
  // How many memories contain a stem (for the relevance weight: a word that is everywhere says little).
  const stemDf = stem => db.prepare('SELECT count(*) c FROM fts_memories WHERE fts_memories MATCH ?').get('stems : ' + ftsQuery([stem])).c
  const getMemory = uid => stmt('SELECT * FROM memories WHERE uid = ?').get(uid) || null
  const hashesOf = source => new Map(stmt('SELECT uid, hash FROM memories WHERE source = ?').all(source).map(row => [row.uid, row.hash]))
  function setMeta(uid, { enabled, scope }) {
    return transaction(() => {
      const row = stmt('SELECT id, sensitive FROM memories WHERE uid = ?').get(uid)
      if (!row) return false
      if (enabled !== undefined) stmt('UPDATE memories SET enabled = ? WHERE id = ?').run(enabled && !row.sensitive ? 1 : 0, row.id)
      if (scope !== undefined) stmt('UPDATE memories SET scope = ? WHERE id = ?').run(scope, row.id)
      bump(); return true
    })
  }
  const listMemories = () => stmt('SELECT id, uid, source, kind, ref, title, text, scope, enabled, sensitive, trust, origin, created_at, updated_at FROM memories ORDER BY updated_at DESC').all()

  // Candidates for a request: full-text matches on the stems, and memories that mention one of the named entities.
  function search({ stems, entityNorms = [], kinds, scopes, limit = 40 }) {
    const scopeMarks = scopes.map(() => '?').join(','), kindMarks = kinds.map(() => '?').join(',')
    const filter = `x.enabled = 1 AND x.sensitive = 0 AND x.superseded_by IS NULL AND x.scope IN (${scopeMarks}) AND x.kind IN (${kindMarks})`
    const found = new Map()
    if (stems.length) {
      const rows = db.prepare(`SELECT x.*, bm25(fts_memories, 3.0, 1.0, 2.0) AS rank FROM fts_memories JOIN memories x ON x.id = fts_memories.rowid WHERE fts_memories MATCH ? AND ${filter} ORDER BY rank LIMIT ?`)
        .all('stems : (' + ftsQuery(stems) + ')', ...scopes, ...kinds, limit)
      for (const row of rows) found.set(row.id, { ...row, rank: -row.rank, byEntity: 0 })
    }
    if (entityNorms.length) {
      const marks = entityNorms.map(() => '?').join(',')
      const rows = db.prepare(`SELECT x.*, count(*) AS hits FROM mentions mm JOIN entities e ON e.id = mm.entity_id JOIN memories x ON x.id = mm.memory_id WHERE e.norm IN (${marks}) AND ${filter} GROUP BY x.id ORDER BY hits DESC LIMIT ?`)
        .all(...entityNorms, ...scopes, ...kinds, 20)
      for (const row of rows) { const had = found.get(row.id); if (had) had.byEntity = row.hits; else found.set(row.id, { ...row, rank: 0, byEntity: row.hits }) }
    }
    return [...found.values()]
  }
  // One hop from some memories: through a stored link, or through a rare entity they share (common ones connect everything and are skipped).
  function neighbors(ids, { scopes, kinds, limit = 6, rareDf = 25 }) {
    if (!ids.length) return []
    const idMarks = ids.map(() => '?').join(','), scopeMarks = scopes.map(() => '?').join(','), kindMarks = kinds.map(() => '?').join(',')
    const filter = `x.enabled = 1 AND x.sensitive = 0 AND x.superseded_by IS NULL AND x.scope IN (${scopeMarks}) AND x.kind IN (${kindMarks}) AND x.id NOT IN (${idMarks})`
    const rows = db.prepare(`
      SELECT x.*, max(n.w) AS strength FROM (
        SELECT CASE WHEN l.a IN (${idMarks}) THEN l.b ELSE l.a END AS other, l.weight AS w FROM links l WHERE l.kind = 'related' AND (l.a IN (${idMarks}) OR l.b IN (${idMarks}))
        UNION ALL
        SELECT m2.memory_id AS other, 1.0 AS w FROM mentions m1 JOIN entities e ON e.id = m1.entity_id AND e.df <= ? AND e.type != 'topic' JOIN mentions m2 ON m2.entity_id = e.id AND m2.memory_id != m1.memory_id WHERE m1.memory_id IN (${idMarks})
      ) n JOIN memories x ON x.id = n.other WHERE ${filter} GROUP BY x.id ORDER BY strength DESC LIMIT ?`)
      .all(...ids, ...ids, ...ids, rareDf, ...ids, ...scopes, ...kinds, ...ids, limit)
    return rows
  }
  const conflictsOf = id => stmt("SELECT CASE WHEN a = ? THEN b ELSE a END AS other, weight FROM links WHERE kind = 'conflict' AND (a = ? OR b = ?)").all(id, id, id)
  const entitiesOfMemory = id => stmt('SELECT e.label, e.type, e.norm, e.df FROM mentions m JOIN entities e ON e.id = m.entity_id WHERE m.memory_id = ?').all(id)
  const linkRows = () => stmt('SELECT a, b, kind, weight FROM links').all()
  const mentionRows = () => stmt('SELECT m.memory_id, e.norm, e.label, e.type, e.df FROM mentions m JOIN entities e ON e.id = m.entity_id WHERE e.type != \'topic\' AND e.df >= 1').all()

  // ---- conversations ----
  const getChat = sessionId => stmt('SELECT * FROM chats WHERE session_id = ?').get(sessionId) || null
  const listChats = () => stmt('SELECT * FROM chats').all()
  function putChat({ sessionId, title, summary, messageCount, indexed, updatedAt, allowed = true }) {
    stmt('INSERT INTO chats(session_id, title, summary, message_count, indexed, updated_at, allowed) VALUES(?, ?, ?, ?, ?, ?, ?) ON CONFLICT(session_id) DO UPDATE SET title = excluded.title, summary = excluded.summary, message_count = excluded.message_count, indexed = excluded.indexed, updated_at = excluded.updated_at, allowed = excluded.allowed')
      .run(sessionId, title, summary, messageCount, indexed, updatedAt, allowed ? 1 : 0)
    bump()
  }
  // chunks: [{ idx, role, text, stems (array), createdAt }]
  function addChunks(sessionId, chunks) {
    return transaction(() => {
      for (const chunk of chunks) {
        const id = Number(stmt('INSERT INTO chunks(session_id, idx, role, text, stems, created_at) VALUES(?, ?, ?, ?, ?, ?)').run(sessionId, chunk.idx, chunk.role, chunk.text, chunk.stems.join(' '), chunk.createdAt).lastInsertRowid)
        stmt('INSERT INTO fts_chunks(rowid, text, stems) VALUES(?, ?, ?)').run(id, chunk.text, chunk.stems.join(' '))
      }
      if (chunks.length) bump()
    })
  }
  function removeChat(sessionId) {
    return transaction(() => {
      for (const row of stmt('SELECT id FROM chunks WHERE session_id = ?').all(sessionId)) stmt('DELETE FROM fts_chunks WHERE rowid = ?').run(row.id)
      stmt('DELETE FROM chunks WHERE session_id = ?').run(sessionId)
      const gone = stmt('DELETE FROM chats WHERE session_id = ?').run(sessionId).changes > 0
      bump(); return gone
    })
  }
  function setChatAllowed(sessionId, allowed) { const changes = stmt('UPDATE chats SET allowed = ? WHERE session_id = ?').run(allowed ? 1 : 0, sessionId).changes; bump(); return changes > 0 }
  function searchChunks({ stems, excludeSession = null, limit = 12 }) {
    if (!stems.length) return []
    const rows = db.prepare(`SELECT c.*, h.title AS chat_title, bm25(fts_chunks, 1.0, 2.0) AS rank FROM fts_chunks JOIN chunks c ON c.id = fts_chunks.rowid JOIN chats h ON h.session_id = c.session_id WHERE fts_chunks MATCH ? AND h.allowed = 1 ${excludeSession ? 'AND c.session_id != ?' : ''} ORDER BY rank LIMIT ?`)
      .all('stems : (' + ftsQuery(stems) + ')', ...(excludeSession ? [excludeSession] : []), limit)
    return rows.map(row => ({ ...row, rank: -row.rank }))
  }

  // ---- traces ----
  function addTrace({ at, sessionId = null, engine, budgetTokens, tokens, ms, queryLength, items }) {
    stmt('INSERT INTO traces(at, session_id, engine, budget_tokens, tokens, ms, query_len, items) VALUES(?, ?, ?, ?, ?, ?, ?, ?)').run(at, sessionId, engine, budgetTokens, tokens, ms, queryLength, JSON.stringify(items))
    stmt('DELETE FROM traces WHERE id NOT IN (SELECT id FROM traces ORDER BY id DESC LIMIT 100)').run()
  }
  const recentTraces = (limit = 30) => stmt('SELECT * FROM traces ORDER BY id DESC LIMIT ?').all(limit).map(row => ({ ...row, items: JSON.parse(row.items) }))

  // ---- meta and bookkeeping ----
  const getMeta = key => stmt('SELECT value FROM meta WHERE key = ?').get(key)?.value ?? null
  const putMeta = (key, value) => stmt('INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, String(value))
  const stats = () => ({
    memories: stmt('SELECT count(*) c FROM memories').get().c, enabled: stmt('SELECT count(*) c FROM memories WHERE enabled = 1 AND sensitive = 0').get().c, entities: stmt("SELECT count(*) c FROM entities WHERE type != 'topic'").get().c,
    topics: stmt("SELECT count(*) c FROM entities WHERE type = 'topic'").get().c, links: stmt('SELECT count(*) c FROM links').get().c, conflicts: stmt("SELECT count(*) c FROM links WHERE kind = 'conflict'").get().c,
    chats: stmt('SELECT count(*) c FROM chats').get().c, chunks: stmt('SELECT count(*) c FROM chunks').get().c, version })
  const check = () => db.prepare('PRAGMA integrity_check').get().integrity_check
  const close = () => { try { db.close() } catch { /* already closed */ } }

  return { upsertMemory, removeMemory, getMemory, newest, memoryCount, stemDf, hashesOf, setMeta, listMemories, search, neighbors, conflictsOf, entitiesOfMemory, linkRows, mentionRows,
    getChat, listChats, putChat, addChunks, removeChat, setChatAllowed, searchChunks, addTrace, recentTraces, getMeta, putMeta, stats, check, close, transaction,
    get version() { return version }, raw: db }
}

module.exports = { openMemoryDb, SCHEMA_VERSION, ftsQuery, memoryHash }
