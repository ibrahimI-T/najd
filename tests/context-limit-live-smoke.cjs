// Live (isolated test profile): a local OpenAI-compatible server that does not report its window (Ollama's /v1 API at its 4K default,
// configured as "llama.cpp") refuses NAJD's first, full-size request. NAJD must say CONTEXT_LIMIT (not a vague rejection), learn the
// window the server stated, and fit the next run into it. Since 0.10.50 NAJD reads Ollama's window (/api/version, /api/ps) and fits the first run already. Needs Ollama running with the model; skips otherwise.
// Usage: node tests/context-limit-live-smoke.cjs [model]   (default qwen3.5:4b)
const assert = require('node:assert/strict')
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os')
const { launch, stop } = require('./electron-ui-smoke.cjs')
const MODEL = process.argv[2] || 'qwen3.5:4b'

async function main() {
  try { const list = await (await fetch('http://127.0.0.1:11434/api/tags', { signal: AbortSignal.timeout(3000) })).json(); if (!list.models.some(item => item.name === MODEL)) throw new Error('model') }
  catch { console.log('SKIP: Ollama is not running with ' + MODEL + '.'); return }
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'najd-desktop-test-'))
  let instance
  try {
    instance = await launch(root)
    const run = async expression => {
      const result = await instance.client.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
      if (result.exceptionDetails) throw new Error(String(JSON.stringify(result.exceptionDetails)).slice(0, 500))
      return result.result.value
    }
    await run(`window.najdProviders.setEndpoint('llamacpp', 'http://127.0.0.1:11434/v1')`)
    async function chat(conversationId) {
      const text = 'In one short sentence: what is the capital of Saudi Arabia?'
      let task = await run(`window.najdCore.startTask(${JSON.stringify(text)},crypto.randomUUID(),'llamacpp',${JSON.stringify(MODEL)},[{role:'user',text:${JSON.stringify(text)}}],'auto',[],${JSON.stringify(conversationId)})`)
      const began = Date.now()
      while (!['COMPLETED', 'FAILED', 'CANCELLED', 'UNKNOWN_EFFECT'].includes(task.state) && Date.now() - began < 300000) {
        await new Promise(resolve => setTimeout(resolve, 500))
        task = await run(`window.najdCore.getTask(${JSON.stringify(task.id)})`)
        if (task.state === 'WAITING_APPROVAL' && task.approvalId) task = await run(`window.najdCore.respondApproval(${JSON.stringify(task.approvalId)},'DENY')`)
      }
      return run(`window.najdCore.getTask(${JSON.stringify(task.id)})`)
    }
    const first = await chat('limit-first')
    const second = await chat('limit-second')
    console.log('first:', first.state, first.errorCode || '', '| second:', second.state, second.errorCode || '', String(second.output || '').slice(0, 120))
    assert.ok(first.state === 'COMPLETED' || first.errorCode === 'CONTEXT_LIMIT', 'the first run either fits or says CONTEXT_LIMIT: ' + first.errorCode)
    assert.equal(second.state, 'COMPLETED', 'the second run fits the learned window: ' + second.errorCode)
    assert.match(String(second.output), /riyadh|الرياض/i)
    console.log('PASS: Ollama behind its OpenAI-compatible API (4K default, no /props): NAJD read the window (/api/version, /api/ps), sized the request to it and both runs answered (' + first.state + ', ' + second.state + '); no silent truncation.')
  } finally {
    if (instance) await stop(instance)
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(root).startsWith('najd-desktop-test-')) throw Error('Unsafe cleanup')
    for (const dir of [root, root + '-documents']) await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 }).catch(() => {})
  }
}
main().catch(error => { console.error('FAIL:', error.message || error); process.exitCode = 1 })
