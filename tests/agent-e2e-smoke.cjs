// Agent platform M2 end-to-end through the real desktop app (isolated profile, fixture model over the real IPC,
// real approvals, real managed Python): "sum the numbers in data.csv with Python" selects the coding profile,
// writes data.csv after approval, runs Python after approval and answers with the computed total. Also covers
// a denied Python run and cancellation while an approval is pending. The model is a fixture, not a live provider.
// Usage: node tests/agent-e2e-smoke.cjs   (needs a prepared managed engine on this machine for real Python)
const assert = require('node:assert/strict')
const fs = require('node:fs/promises'), fss = require('node:fs'), path = require('node:path'), os = require('node:os')
const { launch, stop } = require('./electron-ui-smoke.cjs')

function managedEngine() {
  const base = path.join(process.env.LOCALAPPDATA || '', 'NAJD AGENT', 'runtime')
  const name = fss.existsSync(base) ? fss.readdirSync(base).find(item => item.startsWith('engine-') && fss.existsSync(path.join(base, item, 'najd-core.json'))) : null
  return name ? path.join(base, name) : null
}

async function main() {
  const engine = managedEngine()
  if (!engine) { console.log('SKIP: no prepared managed engine on this machine; real Python is required for this proof.'); return }
  process.env.NAJD_DEV_AGENT_CORE = engine // read only by the unpackaged harness build
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'najd-desktop-test-'))
  let instance
  try {
    instance = await launch(root)
    const client = instance.client
    const run = async expression => {
      const result = await client.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
      assert.ok(!result.exceptionDetails, JSON.stringify(result.exceptionDetails))
      return result.result.value
    }
    await run(`(async()=>{await window.najdProviders.saveKey('openai-api','sk-najd-API-TEST-KEY');const l=await window.najdProviders.limits();await window.najdProviders.setLimits({...l.policy,maxOutputTokens:1024,maxCloudAttempts:40})})()`)
    // decisions: answers for each approval, in order ('ALLOW_ONCE' or 'DENY'); cancelAt: cancel at that approval.
    async function chat(conversationId, decisions, cancelAt = -1) {
      const text = 'python csv fixture: احسب مجموع الأرقام في data.csv باستخدام بايثون'
      let task = await run(`window.najdCore.startTask(${JSON.stringify(text)},crypto.randomUUID(),'openai-api','gpt-6.1-sol',[{role:'user',text:${JSON.stringify(text)}}],'auto',[],${JSON.stringify(conversationId)})`)
      const tools = []
      for (let n = 0; n < 600 && !['COMPLETED', 'FAILED', 'CANCELLED', 'UNKNOWN_EFFECT'].includes(task.state); n++) {
        await new Promise(resolve => setTimeout(resolve, 100))
        task = await run(`window.najdCore.getTask(${JSON.stringify(task.id)})`)
        if (task.state === 'WAITING_APPROVAL' && task.approvalId) {
          tools.push(task.proposedTool)
          if (tools.length - 1 === cancelAt) { task = await run(`window.najdCore.cancelTask(${JSON.stringify(task.id)})`); break }
          task = await run(`window.najdCore.respondApproval(${JSON.stringify(task.approvalId)},${JSON.stringify(decisions[tools.length - 1] || 'DENY')})`)
        }
      }
      return { task: await run(`window.najdCore.getTask(${JSON.stringify(task.id)})`), tools }
    }
    const done = await chat('e2e-sum', ['ALLOW_ONCE', 'ALLOW_ONCE'])
    assert.equal(done.task.state, 'COMPLETED', JSON.stringify({ code: done.task.errorCode, tools: done.tools, steps: done.task.steps?.slice?.(-4), state: done.task.state }).slice(0, 3000))
    assert.equal(done.task.output, 'The total is 10.')
    assert.deepEqual(done.tools, ['najd-files-write', 'najd-python-run'])
    assert.equal(done.task.receipt.profile, 'coding')
    assert.ok(done.task.receipt.toolsets.includes('python'))
    assert.equal(done.task.receipt.usage.total, 940 * 3)
    assert.equal(await fs.readFile(path.join(root + '-documents', 'NAJD', 'data.csv'), 'utf8'), 'n\n2\n3\n5\n')
    const context = await run(`window.najdAgent.context('e2e-sum')`)
    assert.ok(context.outputs.some(item => item.name === 'data.csv'))
    assert.equal(context.totals.total, 940 * 3)

    const denied = await chat('e2e-deny', ['ALLOW_ONCE', 'DENY'])
    assert.equal(denied.task.state, 'COMPLETED', denied.task.errorCode)
    assert.equal(denied.task.output, 'Python did not run: denied_by_user')

    const cancelled = await chat('e2e-cancel', ['ALLOW_ONCE'], 1)
    assert.equal(cancelled.task.state, 'CANCELLED')
    console.log('PASS: chat task wrote data.csv and ran managed Python after approvals (total 10), denial and cancellation; receipt, outputs and usage recorded. Fixture model; real Python.')
  } finally {
    if (instance) await stop(instance)
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(root).startsWith('najd-desktop-test-')) throw Error('Unsafe cleanup')
    for (const dir of [root, root + '-documents']) await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 }).catch(() => {})
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
