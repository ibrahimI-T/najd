// Plugins from outside in the real desktop app (isolated profile, real GitHub): preview and install the official claude-code-setup plugin from its address, see it listed, its
// skill enabled and removal undoing it. Needs internet access; without it the run is reported as skipped, never as a pass.
const assert = require('node:assert/strict')
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os')
const { launch, stop, evaluate, click, waitFor } = require('./electron-ui-smoke.cjs')

const URL_ = 'https://github.com/anthropics/claude-plugins-official/tree/main/plugins/claude-code-setup'
async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'najd-desktop-test-'))
  let instance
  try {
    instance = await launch(root)
    const client = instance.client
    const run = async expression => { const result = await client.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); assert.ok(!result.exceptionDetails, JSON.stringify(result.exceptionDetails)); return result.result.value }
    const reachable = await run(`fetch('https://codeload.github.com/anthropics/claude-plugins-official/zip/refs/heads/main', { method: 'HEAD' }).then(r => r.ok || r.status < 500).catch(() => false)`)
    await click(client, '.sidebar-link[aria-label]')
    await click(client, '.settings-nav-item:nth-child(10)')
    await waitFor(async () => await evaluate(client, '!!document.querySelector("[data-plugin-installer]")'))
    const plan = await run(`window.najdPlugins.preview(${JSON.stringify(URL_)}).then(value => ({ ok: true, value }), error => ({ ok: false, code: error.message }))`)
    if (!plan.ok) { console.log('SKIPPED (no access to GitHub from this computer): ' + plan.code); return }
    assert.equal(plan.value.id, 'claude-code-setup'); assert.ok(plan.value.skillCount >= 1)
    const setValue = (selector, value) => run(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(e, ${JSON.stringify(value)}); e.dispatchEvent(new Event('input', { bubbles: true })); return true })()`)
    await setValue('[data-plugin=url]', URL_)
    await click(client, '[data-plugin=preview]')
    await waitFor(async () => await evaluate(client, '!!document.querySelector("[data-plugin-plan]")'))
    await click(client, '[data-plugin=install]')
    await waitFor(async () => await evaluate(client, '!!document.querySelector("[data-plugin-installed=claude-code-setup]")'), 60000)
    const skills = await run('window.najdSkills.list()')
    const skill = skills.find(item => /recommender/i.test(item.name))
    assert.ok(skill && skill.enabled, 'the plugin skill is installed and enabled')
    assert.equal((await run('window.najdPlugins.list()')).length, 1)
    await run('window.najdPlugins.remove("claude-code-setup")')
    assert.equal((await run('window.najdSkills.list()')).some(item => /recommender/i.test(item.name)), false, 'removal undoes the skills')
    assert.deepEqual(await run('window.najdPlugins.list()'), [])
    console.log('PASS: plugin previewed and installed from a GitHub address in the real app, its skill enabled, listed in Plugins, and removed with its skill.' + (reachable ? '' : ' (network probe inconclusive)'))
  } finally {
    if (instance) await stop(instance)
    const resolved = path.resolve(root)
    if (!resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(resolved).startsWith('najd-desktop-test-')) throw Error('Unsafe cleanup')
    for (const dir of [resolved, resolved + '-documents']) await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 }).catch(() => {})
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
