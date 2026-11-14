// Live local model through the real desktop app (isolated test profile; R-082): a real Ollama model reads a fixture file in the test
// workspace through NAJD's agent loop, once natively and once through the text tool protocol (a local "llama.cpp" endpoint that
// rejects the tools field, in front of Ollama's own OpenAI-compatible API). Needs Ollama running with the model; skips otherwise.
// Usage: node tests/local-model-live-smoke.cjs [model]   (default qwen3.5:4b)
const assert = require('node:assert/strict')
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os'), http = require('node:http')
const { launch, stop } = require('./electron-ui-smoke.cjs')
const MODEL = process.argv[2] || 'qwen3.5:4b'
// The text-protocol model must be one Ollama does not parse itself: Ollama's qwen3 parsers swallow a <tool_call> tag sent as text (live 2026-11-09).
const TEXT_MODEL = process.argv[3] || 'hf.co/gaston-parravicini/LFM2.5-8B-A1B-Uncensored-Gaston-GGUF:Q4_K_M'
// The server behind the tools-rejecting endpoint: Ollama by default, or another local OpenAI-compatible server (LM Studio: http://127.0.0.1:1234).
const TEXT_BACKEND = process.env.NAJD_LIVE_TEXT_BACKEND || 'http://127.0.0.1:11434'
const SECRET = String(10000 + Math.floor(Math.random() * 90000)) // five digits: easy to copy for a small model, impossible to guess

async function ollamaHas(model) {
  try { const list = await (await fetch('http://127.0.0.1:11434/api/tags', { signal: AbortSignal.timeout(3000) })).json(); return list.models.some(item => item.name === model) } catch { return false }
}

async function main() {
  if (!(await ollamaHas(MODEL)) || (!process.env.NAJD_LIVE_TEXT_BACKEND && !(await ollamaHas(TEXT_MODEL)))) { console.log('SKIP: Ollama is not running with ' + MODEL + ' and ' + TEXT_MODEL + ' on this computer.'); return }
  // A llama.cpp-like endpoint without tool support: rejects any request carrying tools, passes the rest to Ollama's /v1 API.
  let rejected = 0, passed = 0
  const proxy = http.createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk
    if (process.env.NAJD_LIVE_DEBUG) console.error('endpoint', req.method, req.url, raw.length); if (raw && JSON.parse(raw).tools) { rejected++; res.writeHead(500, { 'Content-Type': 'application/json' }); return res.end('{"error":"tools param requires --jinja flag"}') }
    passed++
    const upstream = await fetch(TEXT_BACKEND + req.url, { method: req.method, headers: { 'Content-Type': 'application/json' }, body: raw || undefined })
    const answer = await upstream.text(); if (process.env.NAJD_LIVE_DEBUG && !upstream.ok) console.error('upstream', upstream.status, answer.slice(0, 400), 'body keys', Object.keys(JSON.parse(raw || '{}')).join(','))
    res.writeHead(upstream.status, { 'Content-Type': 'application/json' }); res.end(answer)
  })
  await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve))
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'najd-desktop-test-'))
  let instance
  try {
    instance = await launch(root)
    const run = async expression => {
      const result = await instance.client.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
      if (result.exceptionDetails) throw new Error(String(JSON.stringify(result.exceptionDetails)).slice(0, 500))
      return result.result.value
    }
    const workspace = path.join(root + '-documents', 'NAJD')
    await fs.mkdir(workspace, { recursive: true })
    const file = path.join(workspace, 'notes.txt')
    await fs.writeFile(file, 'The meeting code is ' + SECRET + '. Bring the budget sheet.\n')
    await run(`window.najdProviders.setEndpoint('llamacpp', 'http://127.0.0.1:${proxy.address().port}/v1')`)
    async function chat(provider, model, conversationId) {
      const text = 'Read the file ' + file + ' and tell me the meeting code written in it.'
      let task = await run(`window.najdCore.startTask(${JSON.stringify(text)},crypto.randomUUID(),${JSON.stringify(provider)},${JSON.stringify(model)},[{role:'user',text:${JSON.stringify(text)}}],'auto',[],${JSON.stringify(conversationId)})`)
      const tools = [], began = Date.now()
      while (!['COMPLETED', 'FAILED', 'CANCELLED', 'UNKNOWN_EFFECT'].includes(task.state) && Date.now() - began < 600000) {
        await new Promise(resolve => setTimeout(resolve, 500))
        task = await run(`window.najdCore.getTask(${JSON.stringify(task.id)})`)
        // Approve only actions on this test's own fixture file.
        if (task.state === 'WAITING_APPROVAL' && task.approvalId) {
          tools.push(task.proposedTool)
          task = await run(`window.najdCore.respondApproval(${JSON.stringify(task.approvalId)},'ALLOW_ONCE')`)
        }
      }
      task = await run(`window.najdCore.getTask(${JSON.stringify(task.id)})`)
      return { task, tools, seconds: Math.round((Date.now() - began) / 1000) }
    }
    const native = await chat('ollama', MODEL, 'live-native')
    assert.equal(native.task.state, 'COMPLETED', 'native: ' + JSON.stringify({ code: native.task.errorCode, steps: native.task.steps?.slice?.(-3) }).slice(0, 1500))
    assert.ok(String(native.task.output).includes(SECRET), 'native answer: ' + String(native.task.output).slice(0, 300) + ' tools ' + JSON.stringify(native.tools) + ' expected ' + SECRET)
    const text = await chat('llamacpp', TEXT_MODEL, 'live-text')
    assert.equal(text.task.state, 'COMPLETED', 'text protocol: ' + JSON.stringify({ rejected, passed, code: text.task.errorCode, steps: text.task.steps?.slice?.(-3) }).slice(0, 1500))
    assert.ok(String(text.task.output).includes(SECRET), 'text-protocol answer: ' + String(text.task.output).slice(0, 300) + ' tools ' + JSON.stringify(text.tools) + ' expected ' + SECRET)
    assert.ok(rejected >= 1 && passed >= 2, 'the endpoint rejected tools and the text protocol carried the turn: ' + JSON.stringify({ rejected, passed }))
    console.log(`PASS: ${MODEL} (native) and ${TEXT_MODEL.split("/").pop()} (text protocol) read the fixture file through NAJD's agent loop natively (${native.seconds} s, tools ${JSON.stringify(native.tools)}) and through the text tool protocol on a tools-rejecting local endpoint (${text.seconds} s; ${rejected} rejected, ${passed} text requests); both answers carry the file's code.`)
  } finally {
    if (instance) await stop(instance)
    proxy.close()
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(root).startsWith('najd-desktop-test-')) throw Error('Unsafe cleanup')
    for (const dir of [root, root + '-documents']) await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 }).catch(() => {})
  }
}
main().catch(error => { console.error('FAIL:', error.message || error); process.exitCode = 1 })
