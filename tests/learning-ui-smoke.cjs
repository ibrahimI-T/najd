// What NAJD learned, in the real desktop app (Vue renderer, isolated profile, the harness's fake model provider): an explicit preference is saved on its
// own in the default mode, in "Suggest, I approve" mode a proposal waits until the owner approves it (and a lesson needs its own approval), an
// approved item is corrected in place and removed, the sharing switches and the mode persist, and everything survives a restart.
// Rewritten for the Vue renderer (docs/OPUS-BLOCKERS.md B-003) together with the review screen it lacked (Settings > Conversation memory).
// Usage: npm run smoke:learning
const assert = require('node:assert/strict')
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os')
const { launch, stop, click, evaluate, waitFor } = require('./electron-ui-smoke.cjs')

async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'najd-desktop-test-'))
  let instance
  try {
    instance = await launch(root)
    let client = instance.client
    const run = async expression => { const result = await client.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); assert.ok(!result.exceptionDetails, JSON.stringify(result.exceptionDetails)); return result.result.value }
    const exists = selector => evaluate(client, `document.querySelector(${JSON.stringify(selector)}) !== null`)
    const ready = () => waitFor(async () => await evaluate(client, 'document.querySelector("[data-shell=workstation]")?.dataset.renderer === "vue" && !!document.querySelector("[data-nav=account]")'), 60000)
    const page = async () => {
      await run(`document.querySelector('[data-nav="account"]').click()`)
      await waitFor(async () => await exists('.n-account + .w-menu'))
      await run(`document.querySelector('.n-account + .w-menu button:last-child').click()`)
      await waitFor(async () => await exists('[data-settings-route=conversation-memory]'))
      await run(`document.querySelector('[data-settings-route=conversation-memory]').click()`)
      await waitFor(async () => await exists('[data-learned] [data-learning-mode]'))
    }
    const idle = () => waitFor(async () => !(await evaluate(client, 'document.querySelector("[data-learning-mode]").disabled')))
    const mode = async value => {
      await idle()
      await run(`(() => { const e = document.querySelector('[data-learning-mode]'); e.value = ${JSON.stringify(value)}; e.dispatchEvent(new Event('change', { bubbles: true })); return true })()`)
      await waitFor(async () => (await run('window.najdLearning.list()')).settings.mode === value)
    }
    const press = async selector => { await waitFor(async () => await evaluate(client, `(() => { const e = document.querySelector(${JSON.stringify(selector)}); return !!e && !e.disabled })()`)); await run(`document.querySelector(${JSON.stringify(selector)}).click()`) }
    const kind = name => `[data-learning-kind=${name}]`
    const items = (name, status) => run(`[...document.querySelectorAll('${kind(name)} [data-learning-status=${status}]')].map(e => e.textContent)`)
    // One model turn through the fake provider; the learning service reads the request text as the owner's.
    const chat = async text => {
      const task = await run(`(async () => {
        let task = await window.najdCore.startTask(${JSON.stringify(text)}, crypto.randomUUID(), 'openai-api', 'gpt-6.1-sol', undefined, 'low');
        for (let i = 0; i < 200 && ['QUEUED', 'RUNNING'].includes(task.state); i++) { await new Promise(resolve => setTimeout(resolve, 50)); task = await window.najdCore.getTask(task.id) }
        await new Promise(resolve => setTimeout(resolve, 150));
        return { state: task.state, output: task.output, code: task.errorCode } })()`)
      assert.deepEqual(task, { state: 'COMPLETED', output: 'NAJD API test OK', code: null })
    }

    await ready()
    await client.send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false })
    await run(`(async () => { await window.najdProviders.saveKey('openai-api', 'sk-najd-API-TEST-KEY'); const { policy } = await window.najdProviders.limits(); await window.najdProviders.setLimits({ ...policy, maxOutputTokens: 1024, maxCloudAttempts: 30 }); return true })()`)

    // Default: learning is on and saves an explicit preference on its own; it shows as approved with its text.
    await page()
    assert.equal(await evaluate(client, 'document.querySelector("[data-learning-mode]").value'), 'preferences')
    assert.equal(await evaluate(client, 'document.querySelector("[data-learning-share=preference]").getAttribute("aria-checked")'), 'true')
    assert.equal(await evaluate(client, 'document.querySelectorAll("[data-learning-empty]").length'), 2, 'nothing learned yet')
    await chat('I prefer concise answers.')
    await client.send('Page.reload'); await ready(); await page()
    await waitFor(async () => (await items('preference', 'approved')).some(text => text.includes('I prefer concise answers.')))
    assert.equal((await items('preference', 'pending')).length, 0, 'an explicit preference needs no approval in the default mode')

    // "Suggest, I approve": a statement waits as a proposal until the owner approves it in the screen.
    await mode('review')
    await chat('I prefer detailed answers.')
    await client.send('Page.reload'); await ready(); await page()
    await waitFor(async () => (await items('preference', 'pending')).some(text => text.includes('I prefer detailed answers.')))
    await press(`${kind('preference')} [data-learning-status=pending] [data-learning-accept]`)
    await waitFor(async () => (await items('preference', 'approved')).length === 2 && (await items('preference', 'pending')).length === 0)

    // Correct the second approved preference in place.
    await press(`${kind('preference')} [data-learning-status=approved]:last-of-type [data-learning-edit]`)
    await waitFor(async () => await exists(`${kind('preference')} [data-learning-form]`)) // the form opens in the preferences list, where the item was
    assert.equal(await evaluate(client, `document.querySelectorAll('${kind('preference')} [data-learning-status=approved]').length`), 1, 'the edited item is replaced by its form')
    await click(client, '[data-learning-edit-text]')
    await client.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', modifiers: 2, windowsVirtualKeyCode: 65 })
    await client.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', modifiers: 2, windowsVirtualKeyCode: 65 })
    await client.send('Input.insertText', { text: 'I prefer balanced answers.' })
    await press('[data-learning-save]')
    await waitFor(async () => (await items('preference', 'approved')).some(text => text.includes('I prefer balanced answers.')))
    assert.equal((await items('preference', 'approved')).filter(text => text.includes('detailed')).length, 0, 'the old wording is gone')

    // A workflow lesson is proposed, not approved, and has its own sharing switch.
    await chat('Workflow lesson: verify results.')
    await client.send('Page.reload'); await ready(); await page()
    await waitFor(async () => (await items('experience', 'pending')).some(text => text.includes('verify results')))
    assert.equal((await items('experience', 'approved')).length, 0)
    await press(`${kind('experience')} [data-learning-accept]`)
    await waitFor(async () => (await items('experience', 'approved')).length === 1)
    await press('[data-learning-share=experience]')
    await waitFor(async () => (await run('window.najdLearning.list()')).settings.shareExperiences === false)
    await press('[data-learning-share=preference]')
    await waitFor(async () => (await run('window.najdLearning.list()')).settings.sharePreferences === false)

    // A rejected proposal disappears for good.
    await chat('I prefer long answers.')
    await client.send('Page.reload'); await ready(); await page()
    await waitFor(async () => (await items('preference', 'pending')).length === 1)
    await press(`${kind('preference')} [data-learning-reject]`)
    await waitFor(async () => (await items('preference', 'pending')).length === 0)
    assert.equal((await items('preference', 'approved')).length, 2, 'a rejected proposal is not kept')

    // Everything survives a restart: mode, both switches, the items.
    await stop(instance); instance = null
    instance = await launch(root); client = instance.client
    await ready(); await page()
    assert.equal(await evaluate(client, 'document.querySelector("[data-learning-mode]").value'), 'review')
    assert.equal(await evaluate(client, 'document.querySelector("[data-learning-share=preference]").getAttribute("aria-checked")'), 'false')
    assert.equal(await evaluate(client, 'document.querySelector("[data-learning-share=experience]").getAttribute("aria-checked")'), 'false')
    assert.equal((await items('preference', 'approved')).length, 2)
    assert.equal((await items('experience', 'approved')).length, 1)

    // Remove an approved preference and a lesson.
    await press(`${kind('preference')} [data-learning-status=approved] [data-learning-remove]`)
    await press('[data-confirm="cancel"]') // a first press only asks; cancelling keeps the item
    assert.equal((await items('preference', 'approved')).length, 2, 'cancelling the confirmation keeps the item')
    await press(`${kind('preference')} [data-learning-status=approved] [data-learning-remove]`)
    await press('[data-confirm="ok"]')
    await waitFor(async () => (await items('preference', 'approved')).length === 1)
    await press(`${kind('experience')} [data-learning-remove]`)
    await press('[data-confirm="ok"]')
    await waitFor(async () => (await items('experience', 'approved')).length === 0)
    await mode('off')
    console.log('PASS (Vue): learned preferences and lessons: saved on their own in the default mode, proposals wait for approval in the screen, approve, correct in place, reject and remove work, the lesson has its own approval and sharing switch, and mode and switches survive a restart.')
  } finally {
    if (instance && instance.process.exitCode === null) await stop(instance)
    const resolved = path.resolve(root)
    assert.ok(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep)); assert.match(path.basename(resolved), /^najd-desktop-test-/)
    for (const dir of [resolved, resolved + '-documents']) await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 }).catch(() => {})
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
