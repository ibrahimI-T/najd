// The "/" menu of the message box in the real desktop app (Vue renderer, isolated profile): typing "/" opens the list, typing narrows it, the arrow
// keys move, Enter runs the command (here: open a settings page, start a new chat) or inserts text (/read), Escape closes it, and ordinary text
// with a slash does not open it. Arabic and English. Usage: npm run smoke:slash
// Rewritten for the Vue composer (docs/OPUS-BLOCKERS.md B-003): the list is `#k-suggest [role=option]`, the box is `#prompt`.
const assert = require('node:assert/strict')
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os')
const { launch, stop, evaluate, waitFor } = require('./electron-ui-smoke.cjs')

async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'najd-desktop-test-'))
  let instance
  try {
    instance = await launch(root)
    const client = instance.client
    const run = async expression => { const result = await client.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); assert.ok(!result.exceptionDetails, JSON.stringify(result.exceptionDetails)); return result.result.value }
    await client.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
    const ready = () => waitFor(async () => await evaluate(client, 'document.querySelector("[data-shell=workstation]")?.dataset.renderer === "vue" && !!document.querySelector("#prompt")'), 60000)
    // Types into the message box the way a keyboard does: focus, replace the selection, so the component sees every change.
    const setDraft = async text => {
      await run(`(() => { const e = document.querySelector('#prompt'); e.focus(); e.select(); return true })()`)
      if (text) await client.send('Input.insertText', { text })
      else await client.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Delete', code: 'Delete', windowsVirtualKeyCode: 46 })
    }
    const KEYS = { ArrowDown: 40, ArrowUp: 38, Enter: 13, Escape: 27 }
    const press = async key => { for (const type of ['rawKeyDown', 'keyUp']) await client.send('Input.dispatchKeyEvent', { type, key, code: key, windowsVirtualKeyCode: KEYS[key], ...(key === 'Enter' && type === 'rawKeyDown' ? { text: '\r' } : {}) }) }
    // "/command  Label" -> "command"
    const menuCommands = () => run(`[...document.querySelectorAll('#k-suggest [role=option]')].map(item => (item.querySelector('span')?.textContent || '').trim().split(/\\s+/)[0].replace(/^\\//, ''))`)
    const activeCommand = () => run(`(() => { const item = document.querySelector('#k-suggest [aria-selected=true]'); return item ? (item.querySelector('span')?.textContent || '').trim().split(/\\s+/)[0].replace(/^\\//, '') : null })()`)
    const open = () => run(`!!document.querySelector('#k-suggest')`)
    const draft = () => run(`document.querySelector('#prompt')?.value ?? ''`)

    await ready()
    for (const language of ['ar', 'en']) {
      const current = await run(`document.documentElement.lang`)
      if (current !== language) {
        // The interface language is switched from the account menu, as the owner does it.
        await run(`document.querySelector('[data-nav="account"]').click()`)
        await waitFor(async () => await evaluate(client, '!!document.querySelector(".n-account + .w-menu")'))
        await run(`document.querySelector('[data-account-language]').click()`)
        await waitFor(async () => (await run(`document.documentElement.lang`)) === language)
        await ready()
      }
      // 1. A lone slash opens the whole list with the first entry active, and the box points to it.
      await setDraft('/')
      await waitFor(open)
      const all = await menuCommands()
      for (const command of ['new', 'read', 'models', 'tools', 'access-full', 'profile-coding', 'effort-auto']) assert.ok(all.includes(command), language + ': ' + command + ' is listed: ' + all.join(','))
      assert.equal(await activeCommand(), all[0])
      assert.equal(await run(`document.querySelector('#prompt').getAttribute('aria-expanded')`), 'true')
      assert.equal(await run(`document.querySelector('#prompt').getAttribute('role')`), 'combobox')
      // 2. Typing narrows it; commands starting with the typed text come first; the arrow keys move; Escape closes it until the text changes.
      await setDraft('/ac')
      await waitFor(async () => (await menuCommands()).includes('access-full'))
      const narrowed = await menuCommands()
      assert.ok(/^ac/.test(narrowed[0]), language + ': commands that start with the typed text come first: ' + narrowed.join(','))
      assert.ok(narrowed.length < all.length, 'the list is shorter')
      await press('ArrowDown')
      await waitFor(async () => (await activeCommand()) !== narrowed[0])
      await press('ArrowUp')
      await waitFor(async () => (await activeCommand()) === narrowed[0])
      await press('Escape')
      await waitFor(async () => !(await open()))
      await setDraft('/acc')
      await waitFor(open)
      // 3. Enter runs the chosen command: "/accounts" opens that settings page and clears the box.
      await setDraft('/accounts')
      await waitFor(async () => (await activeCommand()) === 'accounts')
      await press('Enter')
      await waitFor(async () => await evaluate(client, '!!document.querySelector("[data-settings]")'))
      assert.equal(await run(`document.querySelector('[data-settings]').dataset.settings`), 'account-security', language + ': the Accounts and security page opened')
      // Back to the conversation (the rail's New task button), where the box is.
      await run(`document.querySelector('[data-nav="new"], [data-nav="home"]')?.click()`)
      await waitFor(async () => await evaluate(client, '!!document.querySelector("#prompt")'))
      assert.equal(await draft(), '', language + ': the slash text is not left in the box')
      // 4. "/read" inserts text for the owner to finish; nothing is sent, and the menu is gone (it is an ordinary message now).
      await setDraft('/rea')
      await waitFor(async () => (await activeCommand()) === 'read')
      await press('Enter')
      await waitFor(async () => (await draft()) === '/read ')
      assert.equal(await open(), false, language + ': with a space after the command the menu is gone')
      // 5. Text that only contains a slash never opens the menu: a path, a sentence, a message longer than a first word.
      for (const text of ['/usr/bin/tool', 'please /new', '/read C:\\Users\\a.txt', 'a/b']) { await setDraft(text); await new Promise(resolve => setTimeout(resolve, 150)); assert.equal(await open(), false, language + ': no menu for ' + text) }
      // 6. A new chat from the menu empties the box.
      await setDraft('/new')
      await waitFor(async () => (await activeCommand()) === 'new')
      await press('Enter')
      await waitFor(async () => (await draft()) === '')
    }
    console.log('PASS: the "/" menu in the real desktop app (Vue, ar/en): opens on a lone slash with an active entry, narrows while typing, arrow keys and Escape work, Enter runs commands (opens a settings page, starts a new chat) or inserts text (/read), and text that only contains a slash never opens it.')
  } finally {
    if (instance) await stop(instance)
    const resolved = path.resolve(root)
    if (!resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(resolved).startsWith('najd-desktop-test-')) throw Error('Unsafe cleanup')
    for (const dir of [resolved, resolved + '-documents']) await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 }).catch(() => {})
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
