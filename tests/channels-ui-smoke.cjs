// Channels in the real desktop app (isolated profile): the Telegram card renders, a fake token is rejected (by Telegram, or as unreachable) and never stored, and nothing starts without a model.
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
    await click(client, '.sidebar-link[aria-label]')
    await click(client, '.settings-nav-item[data-section=channels]')
    await waitFor(async () => await evaluate(client, '!!document.querySelector("[data-channel=telegram]")'))
    const first = await run('window.najdChannels.status()')
    assert.equal(first.tokenSaved, false); assert.equal(first.state, 'stopped'); assert.deepEqual(first.allowed, [])
    assert.equal(first.notify, true, 'notifications start on')
    // Before a token: the create-your-bot steps with a QR code that opens BotFather on the phone.
    assert.ok(await evaluate(client, 'document.querySelectorAll("[data-channel=create] svg.qr-code rect").length > 100'), 'a drawn QR code')
    if (process.env.NAJD_SHOT) await fs.writeFile(process.env.NAJD_SHOT, Buffer.from((await client.send('Page.captureScreenshot', { format: 'png' })).data, 'base64'))
    await run(`(() => { const e = document.querySelector('[data-channel-token]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(e, '123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij'); e.dispatchEvent(new Event('input', { bubbles: true })); return true })()`)
    await click(client, '[data-action="channel-save-token"]')
    await waitFor(async () => await evaluate(client, '!!document.querySelector("[data-channel=telegram] [role=alert]")'), 40000)
    const after = await run('window.najdChannels.status()')
    assert.equal(after.tokenSaved, false, 'a token Telegram did not accept is never stored')
    assert.equal(JSON.stringify(after).includes('ABCDEFGHIJ'), false)
    await assert.rejects(run('window.najdChannels.pair()'), () => true)
    console.log('PASS: Channels page renders, a rejected Telegram token is refused and not stored, pairing is unavailable until the channel runs.')
  } finally {
    if (instance) await stop(instance)
    const resolved = path.resolve(root)
    if (!resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(resolved).startsWith('najd-desktop-test-')) throw Error('Unsafe cleanup')
    for (const dir of [resolved, resolved + '-documents']) await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 }).catch(() => {})
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
