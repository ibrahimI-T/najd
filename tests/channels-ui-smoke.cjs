// Channels in the real desktop app (Vue renderer, isolated profile): the Channels page opens, a fake token is rejected (by Telegram, or as unreachable) and never stored, and nothing starts without a model.
const assert = require('node:assert/strict')
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os')
const { launch, stop, evaluate, click, waitFor } = require('./electron-ui-smoke.cjs')

async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'najd-desktop-test-'))
  let instance
  try {
    instance = await launch(root)
    const client = instance.client
    const run = async expression => { const result = await client.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); assert.ok(!result.exceptionDetails, JSON.stringify(result.exceptionDetails)); return result.result.value }
    // Vue renderer (B-003): Settings > Channels is reached from the account menu; the token box is `.s-inline input[type=password]`.
    await waitFor(async () => await evaluate(client, 'document.querySelector("[data-shell=workstation]")?.dataset.renderer === "vue" && !!document.querySelector("[data-nav=account]")'), 60000)
    await client.send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false })
    const press = selector => run(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e || e.disabled) throw Error('no control ' + ${JSON.stringify(selector)}); e.click(); return true })()`)
    await press('[data-nav="account"]')
    await waitFor(async () => await evaluate(client, '!!document.querySelector(".n-account + .w-menu")'))
    await press('.n-account + .w-menu button:last-child')
    await waitFor(async () => await evaluate(client, '!!document.querySelector("[data-settings-route=channels]")'))
    await press('[data-settings-route=channels]')
    await waitFor(async () => await evaluate(client, '!!document.querySelector(".s-inline input[type=password]")'))
    const first = await run('window.najdChannels.status()')
    assert.equal(first.tokenSaved, false); assert.equal(first.state, 'stopped'); assert.deepEqual(first.allowed, [])
    assert.equal(first.notify, true, 'notifications start on')
    // A well-formed token that Telegram does not know (or cannot be reached): refused with a message, never stored.
    await click(client, '.s-inline input[type=password]')
    await client.send('Input.insertText', { text: '123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij' })
    await run(`(() => { const b = [...document.querySelectorAll('.s-inline button')].find(item => item.textContent.trim() === 'حفظ'); if (!b) throw Error('no save button'); b.click(); return true })()`)
    await waitFor(async () => (await evaluate(client, `[...document.querySelectorAll('[data-toast=error], .w-banner.error, [role=alert]')].map(e => e.innerText).join(' ')`)).length > 0, 40000)
    const after = await run('window.najdChannels.status()')
    assert.equal(after.tokenSaved, false, 'a token Telegram did not accept is never stored')
    assert.equal(JSON.stringify(after).includes('ABCDEFGHIJ'), false)
    await assert.rejects(run('window.najdChannels.pair()'), () => true)
    console.log('PASS (Vue): Channels page opens, a rejected Telegram token is refused and not stored, pairing is unavailable until the channel runs.')
  } finally {
    if (instance) await stop(instance)
    const resolved = path.resolve(root)
    if (!resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(resolved).startsWith('najd-desktop-test-')) throw Error('Unsafe cleanup')
    for (const dir of [resolved, resolved + '-documents']) await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 }).catch(() => {})
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
