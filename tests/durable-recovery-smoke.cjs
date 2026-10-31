const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const { launch, stop, waitFor, evaluate, click } = require('./electron-ui-smoke.cjs')
async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'najd-desktop-test-'))
  const previous = process.env.NAJD_TEST_DURABLE_ACTION
  process.env.NAJD_TEST_DURABLE_ACTION = '1'
  let instance
  const journal = async () => JSON.parse(await fs.readFile(path.join(root, 'najd-data/actions.json'), 'utf8')).actions
  const dispatches = async () => (await fs.readFile(path.join(root, 'durable-dispatch.jsonl'), 'utf8').catch(e => { if (e.code === 'ENOENT') return ''; throw e })).trim().split('\n').filter(Boolean).length
  const run = async expression => {
    const result = await instance.client.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    assert.ok(!result.exceptionDetails, JSON.stringify(result.exceptionDetails))
    return result.result.value
  }
  const start = intent => run(`window.najdCore.startTask('/windows chrome',${JSON.stringify(intent)})`)
  const settled = async (id, state) => { await waitFor(async () => (await run(`window.najdCore.getTask(${JSON.stringify(id)})`)).state === state); return run(`window.najdCore.getTask(${JSON.stringify(id)})`) }
  async function killOwned() {
    const owned = instance
    instance = undefined
    owned.client.close()
    const exited = new Promise(resolve => owned.process.once('exit', resolve))
    await promisify(execFile)('taskkill.exe', ['/PID', String(owned.process.pid), '/T', '/F'], { windowsHide: true })
    let timer
    try { await Promise.race([exited, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Owned process did not die')), 10000) })]) }
    finally { clearTimeout(timer) }
  }
  try {
    await fs.writeFile(path.join(root, 'durable-mode'), 'verified')
    instance = await launch(root)
    const pending = await start('crash-before-approval')
    const approval = await settled(pending.id, 'WAITING_APPROVAL')
    const nonce = (await journal())[0].nonce
    await killOwned()
    instance = await launch(root)
    const recovery = await run('window.najdCore.recovery()')
    assert.equal(recovery.actions[0].state, 'AWAITING_APPROVAL')
    assert.notEqual((await journal())[0].nonce, nonce)
    assert.equal(await dispatches(), 0)
    assert.equal(await run(`window.najdCore.respondApproval(${JSON.stringify(approval.approvalId)},'ALLOW_ONCE').then(()=>false,()=>true)`), true)
    await waitFor(async () => await evaluate(instance.client, '!!document.querySelector(".action-recovery")'))
    const fresh = await start('crash-before-approval')
    const freshApproval = await settled(fresh.id, 'WAITING_APPROVAL')
    await run(`window.najdCore.respondApproval(${JSON.stringify(freshApproval.approvalId)},'ALLOW_ONCE')`)
    await settled(fresh.id, 'COMPLETED')
    assert.equal(await dispatches(), 1)
    await fs.writeFile(path.join(root, 'durable-mode'), 'hang')
    const inflight = await start('crash-after-dispatch')
    const inflightApproval = await settled(inflight.id, 'WAITING_APPROVAL')
    await run(`window.najdCore.respondApproval(${JSON.stringify(inflightApproval.approvalId)},'ALLOW_ONCE')`)
    await waitFor(async () => await dispatches() === 2)
    assert.equal((await journal()).at(-1).state, 'EXECUTING')
    await killOwned()
    instance = await launch(root)
    const uncertain = await run('window.najdCore.recovery()')
    assert.equal(uncertain.actions.at(-1).state, 'UNKNOWN_EFFECT')
    assert.equal(JSON.stringify(uncertain).includes('nonce'), false)
    const replay = await start('crash-after-dispatch')
    await settled(replay.id, 'UNKNOWN_EFFECT')
    const completedReplay = await start('crash-before-approval')
    const blocked = await settled(completedReplay.id, 'FAILED')
    assert.equal(blocked.errorCode, 'ACTION_REPLAY_BLOCKED')
    assert.equal(await dispatches(), 2)
    // The owner settles the unconfirmed action from the recovery panel: recorded as a statement, listed no more, never executed again.
    await waitFor(async () => await evaluate(instance.client, '!!document.querySelector(".action-recovery [data-recovery-state=UNKNOWN_EFFECT] [data-recovery=not-done]")'))
    // The panel is one closed line until the owner opens it.
    assert.equal(await evaluate(instance.client, 'document.querySelector(".action-recovery").open'), false)
    await click(instance.client, '.action-recovery summary')
    await click(instance.client, '.action-recovery [data-recovery-state=UNKNOWN_EFFECT] [data-recovery=not-done]')
    await waitFor(async () => !(await run('window.najdCore.recovery()')).actions.some(item => item.state === 'UNKNOWN_EFFECT'))
    assert.equal((await journal()).find(item => item.state === 'RECONCILED_NOT_DONE') !== undefined, true)
    assert.equal(await dispatches(), 2, 'reconciling started nothing')
    console.log('PASS: actual Electron process death before approval and after durable dispatch; nonce rotation, stale approval rejection, recovery UI/IPC, verified completion and uncertain/completed replay prevention. Owned executor fixture only.')
  } finally {
    if (instance) await stop(instance)
    if (previous === undefined) delete process.env.NAJD_TEST_DURABLE_ACTION
    else process.env.NAJD_TEST_DURABLE_ACTION = previous
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(root).startsWith('najd-desktop-test-')) throw Error('Unsafe cleanup')
    await fs.rm(root, { recursive: true, force: true })
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
