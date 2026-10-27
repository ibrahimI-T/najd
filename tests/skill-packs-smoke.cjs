// The real desktop app (isolated profile) lists every shipped design skill pack as an enabled guide with its source and license.
const assert = require('node:assert/strict')
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os')
const { launch, stop } = require('./electron-ui-smoke.cjs')
const { createSkillPacks } = require('../electron/skill-packs.cjs')
async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'najd-desktop-test-'))
  let instance
  try {
    instance = await launch(root)
    const result = await instance.client.send('Runtime.evaluate', { expression: 'window.najdSkills.list()', awaitPromise: true, returnByValue: true })
    assert.ok(!result.exceptionDetails, JSON.stringify(result.exceptionDetails))
    const rows = result.result.value
    const expected = createSkillPacks({ root: path.join(__dirname, '../skill-packs') }).rows()
    for (const row of expected) {
      const listed = rows.find(item => item.id === row.id)
      assert.ok(listed, 'listed: ' + row.id)
      assert.equal(listed.enabled, true, 'enabled: ' + row.id)
      assert.equal(listed.source, 'pack'); assert.equal(listed.license, row.license); assert.equal(listed.digest, row.digest)
    }
    assert.ok(rows.some(item => item.id === 'najd-web-builder' && item.enabled))
    console.log(`PASS: ${expected.length} design skill packs listed and enabled in the desktop app`)
  } finally { if (instance) await stop(instance); await fs.rm(root, { recursive: true, force: true }).catch(() => {}) }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
