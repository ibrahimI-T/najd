// The memory graph in the real desktop app (isolated profile, fixture model): a note written in Settings reaches the model's
// instructions on its own when a request needs it and not when it does not (the fixture model rejects the request otherwise),
// the retrieval trace says why, and the graph is stored on disk and survives a restart.
const assert = require('node:assert/strict')
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os')
const { launch, stop } = require('./electron-ui-smoke.cjs')

async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'najd-desktop-test-'))
  let instance
  try {
    instance = await launch(root)
    const run = async expression => { const result = await instance.client.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); assert.ok(!result.exceptionDetails, JSON.stringify(result.exceptionDetails)); return result.result.value }
    await run(`window.najdProviders.saveKey('openai-api','sk-najd-API-TEST-KEY')`)
    await run(`window.najdMemory.save({ title: 'Rollback rule', text: 'The green-pipeline-rollback-rule says staging deployments need a rollback plan and a second reviewer' })`)
    const ask = async text => {
      let task = await run(`window.najdCore.startTask(${JSON.stringify(text)},crypto.randomUUID(),'openai-api','gpt-6.1-sol',[{role:'user',text:${JSON.stringify(text)}}],'low',[],${JSON.stringify('graph-e2e-' + Date.now() + '-' + Math.floor(Math.random() * 1e6))})`)
      for (let n = 0; n < 300 && !['COMPLETED', 'FAILED', 'CANCELLED'].includes(task.state); n++) { await new Promise(resolve => setTimeout(resolve, 100)); task = await run(`window.najdCore.getTask(${JSON.stringify(task.id)})`) }
      return task
    }
    const related = await ask('graph note proof: what does the green pipeline rollback rule require for staging deployments?')
    assert.equal(related.state, 'COMPLETED', 'the note reached the model: ' + related.errorCode)
    const unrelated = await ask('graph unrelated proof: tell me a short cooking recipe for pasta')
    assert.equal(unrelated.state, 'COMPLETED', 'an unrelated request did not get the note: ' + unrelated.errorCode)
    const traces = await run(`window.najdMemoryGraph.traces()`)
    const used = traces.find(trace => trace.items.some(item => item.id.startsWith('note:')))
    assert.ok(used, 'a trace shows the note was used'); assert.ok(used.items.find(item => item.id.startsWith('note:')).reason.includes('request'))
    assert.ok(!JSON.stringify(traces).includes('cooking recipe'), 'questions are not kept in traces')
    const status = await run(`window.najdMemoryGraph.status()`)
    assert.equal(status.graphReady, true); assert.ok(status.stats.memories >= 1); assert.ok(status.migration)
    await fs.access(path.join(root, 'najd-data', 'memory-graph.db'))
    // An earlier conversation is indexed a moment after it changes; the owner can keep it out, and deleting it removes it at once.
    const chat = await run(`window.najdSessions.create()`)
    await run(`window.najdSessions.append(${JSON.stringify(chat.id)}, 'user', 'How do I configure the nginx reverse proxy for the dashboard?')`)
    let indexed = []
    for (let n = 0; n < 100 && !indexed.some(row => row.id === chat.id); n++) { await new Promise(resolve => setTimeout(resolve, 100)); indexed = (await run(`window.najdMemoryGraph.chats()`)).rows }
    assert.ok(indexed.find(row => row.id === chat.id)?.allowed === true, 'the conversation was indexed')
    await run(`window.najdMemoryGraph.setChatAllowed(${JSON.stringify(chat.id)}, false)`)
    assert.equal((await run(`window.najdMemoryGraph.chats()`)).rows.find(row => row.id === chat.id).allowed, false)
    await run(`window.najdSessions.delete(${JSON.stringify(chat.id)})`)
    assert.ok(!(await run(`window.najdMemoryGraph.chats()`)).rows.some(row => row.id === chat.id), 'gone from the index at once')
    // The graph is on disk: a restart finds it and the note is still retrievable.
    await stop(instance); instance = await launch(root)
    await run(`window.najdProviders.saveKey('openai-api','sk-najd-API-TEST-KEY')`)
    const again = await ask('graph note proof: remind me of the green pipeline rollback rule')
    assert.equal(again.state, 'COMPLETED', 'after a restart: ' + again.errorCode)
    const after = await run(`window.najdMemoryGraph.status()`)
    assert.equal(after.stats.memories, status.stats.memories)
    console.log('PASS: memory graph in the real app: a Settings note reaches the model only when a request needs it, traces explain why without keeping questions, a conversation can be kept out and leaves the index when deleted, and the graph persists across a restart.')
  } finally {
    if (instance) await stop(instance)
    const resolved = path.resolve(root)
    if (!resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(resolved).startsWith('najd-desktop-test-')) throw Error('Unsafe cleanup')
    for (const dir of [resolved, resolved + '-documents']) await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 }).catch(() => {})
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
