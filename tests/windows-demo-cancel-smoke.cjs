const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { createWindowsNode } = require('../electron/windows-node.cjs')
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
async function main() {
  const stateRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'najd-native-cancel-'))
  const node = createWindowsNode({ runtimeRoot: path.resolve(__dirname, '../.runtimes'), stateRoot })
  async function waitForProfile() {
    for (let attempt = 0; attempt < 1000; attempt++) {
      for (const name of (await fs.readdir(stateRoot)).filter(name => /^windows-demo-[a-f0-9]{32}$/.test(name)))
        if (await fs.access(path.join(stateRoot, name, 'profile')).then(() => true, () => false)) return true
      await pause(5)
    }
    return false
  }
  try {
    await assert.rejects(node.runDemo('chrome', AbortSignal.abort()), { code: 'CANCELLED' })
    await node.discoverApps()
    const controller = new AbortController()
    const outcome = node.runDemo('chrome', controller.signal).then(value => ({ value }), reason => ({ reason }))
    const sawProfile = await waitForProfile()
    controller.abort()
    const { reason, value } = await outcome
    assert.equal(sawProfile, true, 'Cancellation must interrupt an actually started isolated browser')
    assert.equal(value, undefined)
    assert.equal(reason?.code, 'CANCELLED')
    const proof = JSON.parse(reason.output)
    assert.equal(proof.stage, 'cancelled')
    assert.equal(proof.closed, true)
    assert.equal(proof.cleaned, true)
    assert.equal((await fs.readdir(stateRoot)).some(name => name.startsWith('windows-demo-')), false)
    await node.discoverApps()
    const interrupted = node.runDemo('edge').then(value => ({ value }), reason => ({ reason }))
    assert.equal(await waitForProfile(), true)
    const queued = node.runDemo('chrome').then(value => ({ value }), reason => ({ reason }))
    const stopped = node.stop()
    const final = await interrupted
    await stopped
    assert.equal(final.reason, undefined)
    assert.equal(final.value.stage, 'cancelled')
    assert.equal(final.value.closed, true)
    assert.equal(final.value.cleaned, true)
    assert.equal((await queued).reason?.code, 'CANCELLED')
    assert.equal((await fs.readdir(stateRoot)).some(name => name.startsWith('windows-demo-')), false)
    await node.discoverApps()
    console.log('PASS: pre-cancel, active Chrome cancellation, active Edge owner-EOF shutdown, queued-action refusal, owned job/profile cleanup and restart.')
  } finally {
    await node.stop()
    if (!path.resolve(stateRoot).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unsafe fixture root')
    await fs.rm(stateRoot, { recursive: true, force: true })
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
