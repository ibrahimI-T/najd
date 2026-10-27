const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { createWindowsNode } = require('../electron/windows-node.cjs')
async function main() {
  const stateRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'najd-windows-demo-'))
  const node = createWindowsNode({ runtimeRoot: path.resolve(__dirname, '../.runtimes'), stateRoot })
  try {
    await assert.rejects(node.runDemo('cmd.exe'), { code: 'INVALID_INPUT' })
    for (const app of ['chrome', 'edge']) {
      const result = await node.runDemo(app)
      console.log(JSON.stringify(result))
      assert.equal(result.verified, true, `${app} did not prove all postconditions`)
      assert.equal((await fs.readdir(stateRoot)).some(name => name.startsWith('windows-demo-')), false)
    }
    console.log('PASS: two real isolated applications; owned window, native UIA input verification, job-family termination and profile cleanup.')
  } finally {
    await node.stop()
    if (!path.resolve(stateRoot).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unsafe fixture root')
    await fs.rm(stateRoot, { recursive: true, force: true })
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
