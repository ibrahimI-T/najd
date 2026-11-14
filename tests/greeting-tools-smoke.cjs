// A plain greeting through the real desktop app (isolated profile, fixture cloud model) carries only discovery and memory, while a
// task carries its tools (R-082). Owner's own Telegram "هلا" on 2026-11-09 was sent with 13 tools, which this guards against.
const assert = require('node:assert/strict')
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os')
const { launch, stop } = require('./electron-ui-smoke.cjs')

async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'najd-desktop-test-'))
  let instance
  try {
    instance = await launch(root)
    const run = async expression => {
      const result = await instance.client.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
      if (result.exceptionDetails) throw new Error(String(JSON.stringify(result.exceptionDetails)).slice(0, 500))
      return result.result.value
    }
    await run(`(async()=>{await window.najdProviders.saveKey('openai-api','sk-najd-API-TEST-KEY')})()`)
    // Like a real install, the library already holds a file (it once turned plain-chat detection off for every message).
    const added = await run(`(async()=>{ try { return await window.najdLibrary.importBytes('dot.png', Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='), c => c.charCodeAt(0))) } catch (error) { return { error: String(error && error.message || error) } } })()`)
    const listed = await run(`window.najdLibrary.list().then(items => items.length)`)
    assert.ok(listed >= 1, 'the library holds a file before the greeting: ' + JSON.stringify(added).slice(0, 200))
    async function chat(text, conversationId) {
      let task = await run(`window.najdCore.startTask(${JSON.stringify(text)},crypto.randomUUID(),'openai-api','gpt-6.1-sol',[{role:'user',text:${JSON.stringify(text)}}],'auto',[],${JSON.stringify(conversationId)})`)
      for (let n = 0; n < 300 && !['COMPLETED', 'FAILED', 'CANCELLED', 'UNKNOWN_EFFECT'].includes(task.state); n++) {
        await new Promise(resolve => setTimeout(resolve, 100))
        task = await run(`window.najdCore.getTask(${JSON.stringify(task.id)})`)
        if (task.state === 'WAITING_APPROVAL' && task.approvalId) task = await run(`window.najdCore.respondApproval(${JSON.stringify(task.approvalId)},'DENY')`)
      }
      return task
    }
    const greeting = await chat('هلا', 'greet-1')
    const fixtureErrors = await fs.readFile(path.join(root, 'fixture-errors.log'), 'utf8').catch(() => '')
    console.log('greeting:', greeting.state, greeting.errorCode || '', JSON.stringify(greeting.receipt?.toolsets), fixtureErrors.slice(0, 300))
    assert.deepEqual(greeting.receipt?.toolsets?.filter(name => name !== 'mcp'), ['core', 'memory'], 'a greeting starts with discovery and memory only')
    console.log('PASS: a plain greeting through the app carried only discovery and memory.')
  } finally {
    if (instance) await stop(instance)
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(root).startsWith('najd-desktop-test-')) throw Error('Unsafe cleanup')
    for (const dir of [root, root + '-documents']) await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 }).catch(() => {})
  }
}
main().catch(error => { console.error('FAIL:', error.message || error); process.exitCode = 1 })
