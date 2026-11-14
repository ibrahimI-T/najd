// Memory and personality in the real desktop app (Vue renderer, isolated profile): the personality is on by default and its instructions are
// saved and kept after a restart (and Reset restores the default); a memory note is added, corrected in place and deleted, and survives a restart;
// the recall control keeps one earlier conversation out of memory and flips the notes/conversations switches; and a corrupt memory file is preserved: the page says so and a save fails closed instead of resetting the data.
// Rewritten for the Vue renderer (docs/OPUS-BLOCKERS.md B-003). Export/Import use the system file dialogs and stay covered by the unit tests of
// electron/memory-store.cjs. Usage: npm run smoke:memory
const assert = require('node:assert/strict')
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os')
const { launch, stop, click, evaluate, waitFor } = require('./electron-ui-smoke.cjs')

async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'najd-desktop-test-'))
  const memoryFile = () => path.join(root, 'najd-data', 'memory.json')
  let instance
  try {
    instance = await launch(root)
    let client = instance.client
    const run = async expression => { const result = await client.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); assert.ok(!result.exceptionDetails, JSON.stringify(result.exceptionDetails)); return result.result.value }
    const exists = selector => evaluate(client, `document.querySelector(${JSON.stringify(selector)}) !== null`)
    const ready = () => waitFor(async () => await evaluate(client, 'document.querySelector("[data-shell=workstation]")?.dataset.renderer === "vue" && !!document.querySelector("[data-nav=account]")'), 60000)
    const settings = async route => {
      await run(`document.querySelector('[data-nav="account"]').click()`)
      await waitFor(async () => await exists('.n-account + .w-menu'))
      await run(`document.querySelector('.n-account + .w-menu button:last-child').click()`)
      await waitFor(async () => await exists(`[data-settings-route=${route}]`))
      await run(`document.querySelector('[data-settings-route=${route}]').click()`)
    }
    const typeInto = async (selector, text) => {
      await waitFor(async () => await exists(selector))
      await click(client, selector)
      await client.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', modifiers: 2, windowsVirtualKeyCode: 65 })
      await client.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', modifiers: 2, windowsVirtualKeyCode: 65 })
      await client.send('Input.insertText', { text })
    }
    const pressText = (scope, text) => run(`(() => { const b = [...document.querySelectorAll(${JSON.stringify(scope + ' button')})].find(item => item.textContent.trim() === ${JSON.stringify(text)} && !item.disabled); if (!b) throw Error('no button ' + ${JSON.stringify(text)}); b.click(); return true })()`)
    const notes = () => run('window.najdMemory.list()')
    const toast = text => waitFor(async () => (await evaluate(client, `[...document.querySelectorAll('[data-toast]')].map(t => t.innerText).join(' ')`)).includes(text), 20000)

    await ready()
    await client.send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false })

    // Personality: on by default (owner directive 2026-10-17); instructions saved, kept after a restart, and Reset restores the default.
    await settings('chat-settings')
    await waitFor(async () => await exists('.w-section textarea'))
    assert.equal((await run('window.najdPersonality.get()')).enabled, true, 'the NAJD personality is on by default')
    const defaults = await run('window.najdPersonality.get()')
    await typeInto('.w-section textarea', 'PERSONALITY-WARM-FIXTURE: Speak warmly in Saudi Arabic.')
    await pressText('.w-section', 'حفظ')
    await toast('حُفظت إعدادات المحادثة.')
    assert.equal((await run('window.najdPersonality.get()')).instructions, 'PERSONALITY-WARM-FIXTURE: Speak warmly in Saudi Arabic.')

    // Notes: add, correct in place, delete.
    await settings('conversation-memory')
    await waitFor(async () => await exists('.s-form input'))
    await typeInto('.s-form input', 'تفضيل محلي')
    await typeInto('.s-form textarea', 'MEMORY-PRIVATE-ONLY · original')
    await pressText('.s-form', 'حفظ')
    await toast('حُفظت الملاحظة.')
    await waitFor(async () => (await notes()).length === 1)
    await run(`document.querySelector('[data-note-edit]').click()`)
    await waitFor(async () => (await evaluate(client, 'document.querySelector(".s-form textarea")?.value')) === 'MEMORY-PRIVATE-ONLY · original')
    await typeInto('.s-form textarea', 'MEMORY-PRIVATE-ONLY · corrected')
    await pressText('.s-form', 'حفظ')
    await toast('حُدّثت الملاحظة.')
    await waitFor(async () => { const list = await notes(); return list.length === 1 && list[0].text === 'MEMORY-PRIVATE-ONLY · corrected' })
    const kept = (await notes())[0]

    // Recall control: two earlier conversations exist; one is kept out of recall from the page, the two switches change the stored settings.
    await run(`(async () => { for (const [title, text] of [['Recall alpha', 'alpha plan for the garden'], ['Recall beta', 'beta budget for the trip']]) { const session = await window.najdSessions.create(); await window.najdSessions.append(session.id, 'user', text); await window.najdSessions.append(session.id, 'assistant', 'noted: ' + text); await window.najdSessions.rename?.(session.id, title) } await window.najdMemoryGraph.rebuild(); return true })()`)
    await waitFor(async () => (await run('window.najdMemoryGraph.chats({ limit: 50 })')).rows.length >= 2, 20000)
    await settings('conversation-memory')
    await waitFor(async () => await exists('[data-recall] [data-recall-chat]'))
    assert.equal(await evaluate(client, 'document.querySelector("[data-recall-switch=chats]").getAttribute("aria-checked")'), 'true', 'earlier conversations may be remembered by default')
    assert.equal(await evaluate(client, 'document.querySelector("[data-recall-switch=notes]").getAttribute("aria-checked")'), 'true')
    const before = await run('window.najdMemoryGraph.chats({ limit: 50 })')
    assert.ok(before.rows.every(row => row.allowed), 'every chat is allowed by default')
    await run(`document.querySelector('[data-recall-chat] [data-recall-chat-switch]').click()`)
    await waitFor(async () => (await run('window.najdMemoryGraph.chats({ limit: 50 })')).rows.filter(row => !row.allowed).length === 1)
    assert.equal(await evaluate(client, 'document.querySelectorAll("[data-recall-chat][data-allowed=false]").length'), 1, 'the page shows the chat as kept out')
    await run(`document.querySelector('[data-recall-switch=notes]').click()`)
    await waitFor(async () => (await run('window.najdMemoryGraph.status()')).settings.shareNotes === false)
    await waitFor(async () => await evaluate(client, `!document.querySelector('[data-recall-switch=chats]').disabled`))
    await run(`document.querySelector('[data-recall-switch=chats]').click()`)
    await waitFor(async () => (await run('window.najdMemoryGraph.status()')).settings.shareChats === false)
    await waitFor(async () => !(await exists('[data-recall-chat]')), 10000)
    // The switches are disabled while a change is being saved, so each one is pressed when it is free again.
    for (const name of ['notes', 'chats']) {
      await waitFor(async () => await evaluate(client, `(() => { const e = document.querySelector('[data-recall-switch=${name}]'); return !!e && !e.disabled })()`))
      await run(`document.querySelector('[data-recall-switch=${name}]').click()`)
      await waitFor(async () => (await evaluate(client, `document.querySelector('[data-recall-switch=${name}]')?.getAttribute('aria-checked')`)) === 'true')
    }
    { const status = await run('window.najdMemoryGraph.status()'); assert.ok(status.settings.shareNotes && status.settings.shareChats) }

    // A restart keeps the personality and the note.
    await stop(instance); instance = null
    instance = await launch(root); client = instance.client
    await ready()
    assert.equal((await run('window.najdPersonality.get()')).instructions, 'PERSONALITY-WARM-FIXTURE: Speak warmly in Saudi Arabic.')
    assert.deepEqual((await notes()).map(note => [note.id, note.text]), [[kept.id, 'MEMORY-PRIVATE-ONLY · corrected']])
    await settings('chat-settings')
    await waitFor(async () => await exists('.w-section textarea'))
    await pressText('.w-section', 'استعادة')
    await toast('استُعيدت الإعدادات الافتراضية.')
    assert.deepEqual(await run('window.najdPersonality.get()'), defaults, 'Reset restores the default personality')
    await settings('conversation-memory')
    await waitFor(async () => await exists('[data-note-edit]'))
    await run(`document.querySelector('.w-icon[aria-label="حذف"]').click()`)
    await waitFor(async () => (await notes()).length === 0)
    assert.deepEqual(JSON.parse(await fs.readFile(memoryFile(), 'utf8')).notes, [], 'no canonical note is left')

    // A corrupt memory file is preserved: the page reports it and a save fails closed.
    await stop(instance); instance = null
    await fs.writeFile(memoryFile(), '{"corrupt":')
    instance = await launch(root); client = instance.client
    await ready()
    await settings('conversation-memory')
    await waitFor(async () => await exists('.w-banner.error'))
    await typeInto('.s-form input', 'must not overwrite')
    await typeInto('.s-form textarea', 'must not overwrite')
    await pressText('.s-form', 'حفظ')
    await new Promise(resolve => setTimeout(resolve, 800))
    assert.equal(await fs.readFile(memoryFile(), 'utf8'), '{"corrupt":', 'the corrupt file is left as it was')
    console.log('PASS (Vue): recall control (one chat kept out, both switches); personality on by default, saved and kept after a restart, Reset restores the default; a note is added, corrected in place, deleted and kept across a restart; a corrupt memory file is preserved and a save fails closed.')
  } finally {
    if (instance && instance.process.exitCode === null) await stop(instance)
    const resolved = path.resolve(root)
    assert.ok(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep)); assert.match(path.basename(resolved), /^najd-desktop-test-/)
    for (const dir of [resolved, resolved + '-documents']) await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 }).catch(() => {})
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
