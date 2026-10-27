const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { createLearning } = require('../electron/learning.cjs')
const { createMemoryStore } = require('../electron/memory-store.cjs')
const { createSessionStore } = require('../electron/session-store.cjs')
const { createMemoryService } = require('../electron/memory-service.cjs')

async function fixture(t, { setup } = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'najd-memory-svc-'))
  const learning = createLearning({ directory: path.join(directory, 'learning') })
  const notes = createMemoryStore(path.join(directory, 'memory.json'))
  const sessions = createSessionStore(path.join(directory, 'sessions.json'))
  if (setup) await setup({ learning, notes, sessions, directory })
  const files = { preference: path.join(directory, 'learning', 'preference.json'), experience: path.join(directory, 'learning', 'experience.json'), notes: path.join(directory, 'memory.json'), sessions: path.join(directory, 'sessions.json') }
  const services = []
  const make = () => { const created = createMemoryService({ directory, learning, notes, sessions, files }); services.push(created); return created }
  const service = make()
  // Every service closes its database before the folder is removed (Windows will not delete an open file).
  t.after(async () => { for (const created of services) created.close(); await fs.rm(directory, { recursive: true, force: true }) })
  return { directory, learning, notes, sessions, files, service, make }
}
const ids = result => (result?.items || []).map(item => item.id)
const texts = result => (result?.text || '')

test('the first start backs the sources up, builds the graph from approved memories and notes only, and keeps proposals out', async t => {
  const { service, directory, learning } = await fixture(t, { setup: async ({ learning, notes }) => {
    await learning.remember({ kind: 'preference', text: 'I prefer short answers in Arabic' })
    await learning.remember({ kind: 'experience', text: 'Run npm.cmd test before the build of NAJD' })
    await notes.save({ title: 'Release checklist', text: 'Update package.json and run the smoke tests before a release' })
    await learning.setSettings({ mode: 'review', sharePreferences: true, shareExperiences: true })
    await learning.remember({ kind: 'preference', text: 'I prefer green buttons' }) // only a proposal now
  } })
  const status = await service.status()
  assert.equal(status.graphReady, true); assert.equal(status.stats.memories, 3, 'two learned memories and one note; the pending proposal is not a memory')
  assert.equal(status.migration.expected, 3); assert.equal(status.migration.stored, 3)
  const backup = await fs.readdir(status.migration.backup)
  assert.ok(backup.includes('preference.json') && backup.includes('experience.json') && backup.includes('memory.json') && backup.includes('README.txt'))
  assert.equal((await learning.list()).pending.preference.length, 1, 'the proposal is still waiting for the owner')
  assert.ok(directory)
})

test('the graph survives a restart without being rebuilt, and the backup is taken once', async t => {
  const { service, make, directory } = await fixture(t, { setup: async ({ learning, notes }) => { await learning.remember({ kind: 'preference', text: 'I prefer tables for comparisons' }); await notes.save({ title: 'Telegram', text: 'The Telegram bot needs a BotFather token saved in Settings' }) } })
  await service.start()
  const first = await service.context({ query: 'telegram token', budgetTokens: 700 })
  assert.ok(first.items.some(item => item.id.startsWith('note:')))
  service.close()
  const again = make()
  const status = await again.status()
  assert.equal(status.stats.memories, 2); assert.equal((await again.sync()), 0, 'nothing changed, so nothing was analysed again')
  assert.equal((await fs.readdir(path.join(directory, 'backups'))).length, 1, 'one backup, not one per start')
  assert.ok((await again.context({ query: 'telegram token', budgetTokens: 700 })).items.some(item => item.id.startsWith('note:')))
})

test('a note written in Settings reaches the model on its own when a request needs it, and not otherwise', async t => {
  const { service, notes } = await fixture(t)
  await service.start()
  await notes.save({ title: 'Deployment', text: 'Staging deploys go through the blue pipeline and need a rollback plan' })
  const hit = await service.context({ query: 'how do we deploy to staging?', budgetTokens: 700 })
  assert.ok(ids(hit).some(id => id.startsWith('note:')), 'found without anyone pressing a button'); assert.match(texts(hit), /blue pipeline/)
  const miss = await service.context({ query: 'tell me a cooking recipe', budgetTokens: 700 })
  assert.deepEqual(ids(miss).filter(id => id.startsWith('note:')), [], 'an unrelated request does not get it')
})

test('editing and deleting go through the whole graph: index, entities, links and cache', async t => {
  const { service, notes } = await fixture(t)
  await service.start()
  const a = await notes.save({ title: 'Deploy A', text: 'Run deploy.ps1 for the staging site, then check Grafana' })
  const b = await notes.save({ title: 'Deploy B', text: 'The deploy.ps1 script lives in the tools folder of the staging repository' })
  let hit = await service.context({ query: 'what does deploy.ps1 do', budgetTokens: 900 })
  assert.equal(ids(hit).filter(id => id.startsWith('note:')).length, 2)
  const before = (await service.status()).stats
  assert.ok(before.entities >= 1 && before.links >= 1, 'a shared file is stored as an entity with a link between the notes')
  await notes.save({ id: a.id, title: 'Deploy A', text: 'Staging now uses the green pipeline instead' })
  assert.equal(await service.sync(), 1, 'only the edited note was re-analysed')
  hit = await service.context({ query: 'what does deploy.ps1 do', budgetTokens: 900 })
  assert.deepEqual(ids(hit).filter(id => id.startsWith('note:')), ['note:' + b.id], 'the edit removed the old words from the index')
  await notes.remove(b.id)
  await service.sync()
  hit = await service.context({ query: 'what does deploy.ps1 do', budgetTokens: 900 })
  assert.deepEqual(ids(hit).filter(id => id.startsWith('note:')), [])
  const after = (await service.status()).stats
  assert.equal(after.memories, 1); assert.equal(after.links, 0, 'no link is left')
  assert.equal(service.db.raw.prepare('SELECT count(*) c FROM entities WHERE df <= 0').get().c, 0, 'no orphan entity')
  assert.equal(service.db.raw.prepare('SELECT count(*) c FROM mentions WHERE memory_id NOT IN (SELECT id FROM memories)').get().c, 0, 'no mention of a deleted memory')
  assert.equal(service.db.raw.prepare('SELECT count(*) c FROM fts_memories').get().c, 1, 'and the full-text index holds only what is left')
})

test('a memory can be switched off, a secret is never retrieved, and sharing switches and policies are respected', async t => {
  const { service, notes, learning } = await fixture(t, { setup: async ({ learning, notes }) => {
    await learning.remember({ kind: 'preference', text: 'I prefer concise answers' }); await learning.remember({ kind: 'experience', text: 'Always verify the build output of the installer' })
    await notes.save({ title: 'Wifi', text: 'The office wifi password: hunter2-secret-value for the installer room' })
    await notes.save({ title: 'Installer', text: 'The installer is built with electron-builder in the release folder' })
  } })
  await service.start()
  const query = 'how is the installer built'
  let hit = await service.context({ query, budgetTokens: 900 })
  assert.ok(ids(hit).some(id => id.startsWith('note:')) && ids(hit).some(id => id.startsWith('experience:')))
  assert.ok(!texts(hit).includes('hunter2'), 'the secret-looking note is stored but never retrieved')
  const secret = service.db.listMemories().find(row => row.title === 'Wifi')
  assert.equal(secret.sensitive, 1); assert.equal(secret.enabled, 0)
  assert.equal(await service.setEnabled(secret.uid, true), true); assert.equal(service.db.getMemory(secret.uid).enabled, 0, 'it cannot be switched back on')
  const installer = service.db.listMemories().find(row => row.title === 'Installer')
  await service.setEnabled(installer.uid, false)
  assert.ok(!ids(await service.context({ query, budgetTokens: 900 })).includes(installer.uid), 'a memory that is off is not retrieved')
  await service.setEnabled(installer.uid, true)
  await service.setSettings({ shareNotes: false })
  assert.ok(!ids(await service.context({ query, budgetTokens: 900 })).some(id => id.startsWith('note:')), 'notes off: none shared')
  await service.setSettings({ shareNotes: true })
  await learning.setSettings({ mode: 'preferences', sharePreferences: false, shareExperiences: false })
  assert.deepEqual(ids(await service.context({ query, budgetTokens: 900 })).filter(id => !id.startsWith('note:')), [], 'the owner\'s preference and lesson switches still apply')
  hit = await service.context({ query, budgetTokens: 900 })
  assert.ok(hit.items.every(item => !/hunter2/.test(JSON.stringify(item))))
})

test('scope keeps a memory to its conversation; another conversation and the global view never see it', async t => {
  const { service, notes } = await fixture(t)
  await service.start()
  const saved = await notes.save({ title: 'Client plan', text: 'The client wants the quarterly report in landscape format' })
  await service.sync()
  const uid = 'note:' + saved.id
  const mine = '11111111-2222-3333-4444-555555555555', other = '99999999-2222-3333-4444-555555555555'
  await service.setScope(uid, 'conversation:' + mine)
  assert.ok(ids(await service.context({ query: 'quarterly report format', conversationId: mine, budgetTokens: 900 })).includes(uid))
  assert.ok(!ids(await service.context({ query: 'quarterly report format', conversationId: other, budgetTokens: 900 })).includes(uid), 'another conversation')
  assert.ok(!ids(await service.context({ query: 'quarterly report format', budgetTokens: 900 })).includes(uid), 'no conversation at all')
  await service.setScope(uid, 'project:Client X')
  assert.ok(!ids(await service.context({ query: 'quarterly report format', conversationId: mine, budgetTokens: 900 })).includes(uid), 'a project memory is not shared until its project is the active one')
  await assert.rejects(service.setScope(uid, 'everyone'), { code: 'INVALID_INPUT' })
})

test('earlier conversations are indexed in pieces, found by the question with a way back to the original, and removed with the conversation', async t => {
  const { service, sessions } = await fixture(t)
  await service.start()
  const old = await sessions.createSession()
  await sessions.appendMessage(old.id, 'user', 'How do I configure the nginx reverse proxy for the dashboard on port 8443?')
  await sessions.appendMessage(old.id, 'assistant', 'Add a server block with proxy_pass to http://127.0.0.1:8443 and set the proxy headers.')
  const current = await sessions.createSession()
  await sessions.appendMessage(current.id, 'user', 'Remind me what we decided about the nginx proxy')
  await service.indexChats()
  const hit = await service.context({ query: 'what did we decide about the nginx reverse proxy', conversationId: current.id, budgetTokens: 900 })
  assert.ok(hit.items.some(item => item.kind === 'chat' && item.id.startsWith('chat:' + old.id)), 'an excerpt of the earlier conversation')
  assert.match(texts(hit), new RegExp(old.id)); assert.match(texts(hit), /najd_chats_read/)
  assert.ok(!hit.items.some(item => item.id.startsWith('chat:' + current.id)), 'never the current conversation')
  await service.setSettings({ shareChats: false })
  assert.ok(!(await service.context({ query: 'nginx reverse proxy', conversationId: current.id, budgetTokens: 900 })).items.some(item => item.kind === 'chat'), 'chats off')
  await service.setSettings({ shareChats: true })
  await sessions.deleteSession(old.id)
  await service.indexChats()
  assert.equal((await service.status()).stats.chunks, 1 /* only the current conversation's own message remains */)
  assert.ok(!(await service.context({ query: 'nginx reverse proxy', conversationId: current.id, budgetTokens: 900 })).items.some(item => item.kind === 'chat'))
})

test('a conversation whose first message looks like a secret keeps no title or summary, so its later excerpts and traces never carry it', async t => {
  const { service, sessions } = await fixture(t)
  await service.start()
  const chat = await sessions.createSession()
  await sessions.appendMessage(chat.id, 'user', 'password: Hunter2-SECRET-value')
  await sessions.appendMessage(chat.id, 'assistant', 'The nginx reverse proxy for the dashboard listens on port 8443.')
  await service.indexChats()
  const hit = await service.context({ query: 'nginx reverse proxy dashboard port', budgetTokens: 900 })
  assert.ok(hit.items.some(item => item.kind === 'chat'), 'the harmless message is still found')
  assert.doesNotMatch(texts(hit), /Hunter2|password/i)
  assert.doesNotMatch(JSON.stringify(await service.traces()), /Hunter2|password/i)
  assert.doesNotMatch(JSON.stringify(service.db.listChats()), /Hunter2|password/i)
})

test('a conversation the owner keeps out is never retrieved, and the choice holds across new messages, a rebuild and a restart', async t => {
  const { service, sessions, make } = await fixture(t)
  await service.start()
  const chat = await sessions.createSession()
  await sessions.appendMessage(chat.id, 'user', 'How do I configure the nginx reverse proxy for the dashboard on port 8443?')
  await service.indexChats()
  const query = { query: 'nginx reverse proxy dashboard', budgetTokens: 900 }
  const found = async target => (await target.context(query)).items.some(item => item.kind === 'chat')
  assert.ok(await found(service))
  await service.setChatAllowed(chat.id, false)
  assert.equal(await found(service), false, 'kept out at once')
  assert.equal((await service.chats()).rows.find(row => row.id === chat.id).allowed, false)
  await sessions.appendMessage(chat.id, 'assistant', 'Use proxy_pass to the nginx dashboard port.')
  await service.indexChats()
  assert.equal(await found(service), false, 'new messages do not share it again')
  await service.rebuild()
  assert.equal(await found(service), false, 'a rebuild does not share it again')
  service.close()
  const again = make()
  await again.indexChats()
  assert.equal(await found(again), false, 'nor a restart')
  await again.setChatAllowed(chat.id, true)
  assert.ok(await found(again), 'and it can be shared again')
  await assert.rejects(again.setChatAllowed('', false), { code: 'INVALID_INPUT' })
})

test('every indexed conversation can be reached by search and pages, and the true total is reported', async t => {
  const { service, sessions } = await fixture(t)
  await service.start()
  const made = []
  for (let n = 0; n < 230; n++) { const chat = await sessions.createSession(); await sessions.appendMessage(chat.id, 'user', `Question number ${n} about topic${n}`); made.push(chat.id) }
  await service.indexChats()
  const first = await service.chats({ limit: 200 })
  assert.equal(first.total, 230); assert.equal(first.matching, 230); assert.equal(first.rows.length, 200)
  const rest = await service.chats({ offset: 200, limit: 200 })
  assert.equal(rest.rows.length, 30)
  assert.equal(new Set([...first.rows, ...rest.rows].map(row => row.id)).size, 230, 'the pages together reach every conversation')
  const oldest = made[0]
  const found = await service.chats({ query: oldest })
  assert.deepEqual(found.rows.map(row => row.id), [oldest]); assert.equal(found.total, 230); assert.equal(found.matching, 1)
  assert.equal((await service.chats({ limit: 100000 })).rows.length, 200, 'a page is bounded')
})

test('kept-out choices are never dropped to make room and are removed when their conversation is deleted', async t => {
  const { service, sessions, directory, make } = await fixture(t)
  await service.start()
  const chat = await sessions.createSession()
  await sessions.appendMessage(chat.id, 'user', 'Keep this one out please')
  await service.indexChats()
  await service.setChatAllowed(chat.id, false)
  const settingsFile = path.join(directory, 'memory-engine.json')
  const saved = JSON.parse(await fs.readFile(settingsFile, 'utf8'))
  assert.deepEqual(saved.excludedChats, [chat.id])
  // A full list refuses a new choice instead of evicting an existing one.
  await fs.writeFile(settingsFile, JSON.stringify({ ...saved, excludedChats: [chat.id, ...Array.from({ length: 4999 }, (_, n) => 'gone-' + n)] }))
  service.close()
  const full = make()
  const another = await sessions.createSession()
  await assert.rejects(full.setChatAllowed(another.id, false), { code: 'LIMIT_REACHED' })
  await assert.rejects(full.setChatAllowed('not-a-session', false), { code: 'NOT_FOUND' }, 'an id that is not a conversation is refused')
  // An indexing pass drops choices of conversations that no longer exist, and keeps the existing one.
  await full.indexChats()
  assert.deepEqual(JSON.parse(await fs.readFile(settingsFile, 'utf8')).excludedChats, [chat.id])
  // Deleting the conversation drops its choice too.
  await sessions.deleteSession(chat.id); full.forgetChat(chat.id)
  for (let n = 0; n < 50 && JSON.parse(await fs.readFile(settingsFile, 'utf8')).excludedChats.length; n++) await new Promise(resolve => setTimeout(resolve, 10))
  assert.deepEqual(JSON.parse(await fs.readFile(settingsFile, 'utf8')).excludedChats, [])
})

test('a deleted conversation leaves the index at once and an indexing pass already running never writes it back', async t => {
  const { service, sessions } = await fixture(t)
  await service.start()
  const old = await sessions.createSession()
  await sessions.appendMessage(old.id, 'user', 'How do I configure the nginx reverse proxy for the dashboard on port 8443?')
  await service.indexChats()
  const query = { query: 'nginx reverse proxy dashboard', budgetTokens: 900 }
  assert.ok((await service.context(query)).items.some(item => item.kind === 'chat'))
  // A pass that read the listing before the deletion is paused inside getSession while the conversation is deleted.
  await sessions.appendMessage(old.id, 'assistant', 'Use proxy_pass to the local port.')
  const realGet = sessions.getSession.bind(sessions)
  let release
  sessions.getSession = async id => { await new Promise(resolve => { release = resolve }); return realGet(id) }
  const running = service.indexChats()
  while (!release) await new Promise(resolve => setImmediate(resolve))
  await sessions.deleteSession(old.id)
  service.forgetChat(old.id)
  assert.ok(!(await service.context(query)).items.some(item => item.kind === 'chat'), 'gone before any re-indexing')
  sessions.getSession = realGet
  release()
  await running
  assert.ok(!(await service.context(query)).items.some(item => item.kind === 'chat'), 'the running pass did not bring it back')
  assert.ok(!service.db.getChat(old.id))
})

test('memories that may contradict each other are both sent with the older one marked; an exact copy is sent once; a similar memory is never dropped', async t => {
  const { service, notes } = await fixture(t)
  await service.start()
  await notes.save({ title: 'Format old', text: 'Always write the weekly report as a long detailed document' })
  await new Promise(resolve => setTimeout(resolve, 15))
  const newer = await notes.save({ title: 'Format new', text: 'Always write the weekly report as a short summary' })
  await notes.save({ title: 'Format copy', text: 'Always write the weekly report as a short summary' })
  const hit = await service.context({ query: 'how should I write the weekly report', budgetTokens: 900 })
  const sent = JSON.parse(texts(hit).split('\n')[1])
  assert.equal(sent.filter(item => item.text.includes('short summary')).length, 1, 'the exact copy is sent once')
  const older = sent.find(item => item.text.includes('long detailed'))
  assert.ok(older, 'the older one is not lost'); assert.equal(older.olderThan, sent.find(item => item.text.includes('short summary')).id, 'and it says which entry is newer')
  assert.ok(newer)
  // Facts that look alike but name different things are not conflicts and both arrive.
  await notes.save({ title: 'A', text: 'The Falcon staging server listens on port 9100' }); await notes.save({ title: 'B', text: 'The Orion staging server listens on port 9101' })
  const both = await service.context({ query: 'which port do the Falcon staging server and the Orion staging server use', budgetTokens: 900 })
  assert.match(texts(both), /9100/); assert.match(texts(both), /9101/)
})

test('the memory budget is kept, an unrelated request gets only the newest preferences, and a trace says why', async t => {
  const { service } = await fixture(t, { setup: async ({ learning, notes }) => {
    await learning.remember({ kind: 'preference', text: 'I prefer short answers' }); await learning.remember({ kind: 'preference', text: 'Call me Ibrahim' })
    for (let i = 0; i < 40; i++) await notes.save({ title: 'Deploy note ' + i, text: 'Deployment note number ' + i + ' about the staging pipeline and the rollback plan of release ' + i })
  } })
  await service.start()
  const tight = await service.context({ query: 'staging pipeline rollback plan', budgetTokens: 120 })
  assert.ok(tight.tokens <= 120 + 40, 'the block stays near its budget (' + tight.tokens + ' estimated tokens)')
  const unrelated = await service.context({ query: 'what is the capital of France', budgetTokens: 700 })
  assert.deepEqual(unrelated.items.map(item => item.kind).sort(), ['preference', 'preference'], 'only what always travels')
  const traces = await service.traces()
  assert.ok(traces.length >= 2 && traces[0].items.every(item => item.reason && typeof item.tokens === 'number') && !JSON.stringify(traces).includes('capital of France'), 'the trace has reasons and sizes but not the question')
})

test('a long conversation keeps its newest part word for word and replaces the older part by the relevant earlier messages', async t => {
  const { service } = await fixture(t)
  const history = []
  for (let i = 0; i < 24; i++) history.push({ role: i % 2 ? 'assistant' : 'user', text: (i === 2 ? 'Our staging server is called Falcon and runs on port 9100. ' : 'Filler message number ' + i + '. ') + 'x'.repeat(400) })
  const result = service.compactHistory({ history, query: 'which port does the staging server use', recentChars: 3000 })
  assert.equal(result.compacted, true); assert.ok(result.history.length < history.length)
  assert.equal(result.history.at(-1).text, history.at(-1).text, 'the newest message is untouched')
  assert.equal(result.history[0].role, 'user'); assert.match(result.history[0].text, /Falcon/); assert.match(result.history[0].text, /najd_chats_read/)
  assert.equal(service.compactHistory({ history: history.slice(0, 4), query: 'x', recentChars: 3000 }).compacted, false, 'a short conversation is left alone')
})

test('the previous engine can be selected, and a damaged graph file is set aside and rebuilt from the sources', async t => {
  const { service, make, directory } = await fixture(t, { setup: async ({ notes }) => { await notes.save({ title: 'Keep', text: 'Remember the quarterly invoice deadline is the fifth' }) } })
  await service.start()
  await service.setSettings({ engine: 'legacy' })
  assert.equal(await service.context({ query: 'invoice deadline', budgetTokens: 700 }), null, 'legacy: the caller uses the old engine')
  await service.setSettings({ engine: 'graph' })
  service.close()
  await fs.writeFile(path.join(directory, 'memory-graph.db'), 'this is not a database')
  const again = make()
  const hit = await again.context({ query: 'invoice deadline', budgetTokens: 700 })
  assert.ok(ids(hit).some(id => id.startsWith('note:')), 'rebuilt from memory.json')
  assert.ok((await fs.readdir(directory)).some(name => name.startsWith('memory-graph.db.corrupt-')), 'the damaged file was kept')
})

test('an unreadable source never deletes what the graph already holds', async t => {
  const { service, notes } = await fixture(t, { setup: async ({ notes }) => { await notes.save({ title: 'Safe', text: 'The vault combination hint lives in the green folder' }) } })
  await service.start()
  const original = notes.list
  notes.list = async () => { throw new Error('MEMORY_STORE_UNAVAILABLE') }
  service.touch(); await service.sync()
  notes.list = original
  assert.equal((await service.status()).stats.memories, 1)
})
