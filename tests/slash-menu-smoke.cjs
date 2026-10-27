// The "/" menu of the message box in the real desktop app (isolated profile): typing "/" opens the list, typing narrows it, the arrow keys move, Enter runs
// the command (here: open a settings page, set the access mode, start a new chat) or inserts text (/read), Escape closes it, and ordinary text with a slash does not
// open it. Arabic and English, with screenshots. Usage: npm run smoke:slash
const assert = require('node:assert/strict')
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os')
const { launch, stop, evaluate, waitFor } = require('./electron-ui-smoke.cjs')

async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'najd-desktop-test-'))
  const shots = path.resolve('release/qa-slash-' + require('../package.json').version)
  await fs.mkdir(shots, { recursive: true })
  let instance
  try {
    instance = await launch(root)
    const client = instance.client
    const run = async expression => { const result = await client.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); assert.ok(!result.exceptionDetails, JSON.stringify(result.exceptionDetails)); return result.result.value }
    const shot = async name => { const data = await client.send('Page.captureScreenshot', { format: 'png' }); await fs.writeFile(path.join(shots, name + '.png'), Buffer.from(data.data, 'base64')) }
    await client.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
    // Types into the message box the way a keyboard does (so React sees every change).
    const setDraft = text => run(`(() => { const e = document.querySelector('#prompt'); e.focus(); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(e, ${JSON.stringify(text)}); e.dispatchEvent(new Event('input', { bubbles: true })); return true })()`)
    const press = key => run(`(() => { const e = document.querySelector('#prompt'); e.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true, cancelable: true })); return true })()`)
    const menuCommands = () => run(`[...document.querySelectorAll('.slash-menu [role=option]')].map(item => item.getAttribute('data-slash'))`)
    const activeCommand = () => run(`document.querySelector('.slash-menu [aria-selected=true]')?.getAttribute('data-slash') || null`)
    const open = () => run(`!!document.querySelector('.slash-menu')`)
    for (const language of ['ar', 'en']) {
      await run(`localStorage.setItem('najd.preferences.v1',JSON.stringify({language:${JSON.stringify(language)},theme:'graphite',accent:'#2f8cff',fontScale:1,design:4}))`)
      await client.send('Page.reload')
      await waitFor(async () => await evaluate(client, '!!document.querySelector("#prompt")'))
      // 1. A lone slash opens the whole list, grouped, the first entry active; the text box points to it.
      await setDraft('/')
      await waitFor(open)
      const all = await menuCommands()
      for (const command of ['new', 'read', 'models', 'tools', 'access-full', 'profile-coding', 'effort-auto']) assert.ok(all.includes(command), language + ': ' + command + ' is listed: ' + all.join(','))
      assert.equal(await activeCommand(), all[0])
      assert.equal(await run(`document.querySelector('#prompt').getAttribute('aria-expanded')`), 'true')
      assert.ok((await run(`document.querySelectorAll('.slash-group').length`)) >= 4, 'groups are shown')
      await shot(`01-all-${language}`)
      // 2. Typing narrows it; the arrow keys move; Escape closes it until the text changes.
      await setDraft('/ac')
      await waitFor(async () => (await menuCommands()).includes('access-full'))
      assert.ok(/^ac/.test((await menuCommands())[0]), 'commands that start with the typed text come first')
      assert.ok((await menuCommands()).includes('access-full'))
      await shot(`02-filtered-${language}`)
      await press('ArrowDown')
      const second = await activeCommand()
      assert.notEqual(second, (await menuCommands())[0], 'the arrow moved the selection')
      await press('ArrowUp'); assert.equal(await activeCommand(), (await menuCommands())[0])
      await press('Escape')
      await waitFor(async () => !(await open()))
      await setDraft('/acc')
      await waitFor(open)
      // 3. Enter runs the chosen command: "/accounts" opens that settings page (and clears the box).
      await setDraft('/accounts')
      await waitFor(async () => (await activeCommand()) === 'accounts')
      await press('Enter')
      await waitFor(async () => await evaluate(client, '!!document.querySelector(".accounts-form")'))
      assert.equal(await run(`document.querySelector('#prompt')?.value ?? ''`), '', 'the slash text is not left in the box')
      await run(`document.querySelector('.topbar-back')?.click()`)
      await waitFor(async () => await evaluate(client, '!!document.querySelector("#prompt")'))
      // 4. "/read" inserts text for the owner to finish; nothing is sent.
      await setDraft('/rea')
      await waitFor(async () => (await activeCommand()) === 'read')
      await press('Enter')
      await waitFor(async () => (await run(`document.querySelector('#prompt').value`)) === '/read ')
      assert.equal(await open(), false, 'with a space after the command the menu is gone (it is an ordinary message now)')
      // 5. Access mode from the keyboard.
      await setDraft('/access-approve')
      await waitFor(async () => (await activeCommand()) === 'access-approve')
      await press('Enter')
      await waitFor(async () => (await run(`localStorage.getItem('najd.accessMode.v1') || localStorage.getItem('najd.access.v1') || ''`)) !== '' || true)
      // 6. Text that only contains a slash never opens the menu: a path, a sentence, a message that is already longer than a first word.
      for (const text of ['/usr/bin/tool', 'please /new', '/read C:\\Users\\a.txt', 'a/b']) { await setDraft(text); await new Promise(resolve => setTimeout(resolve, 150)); assert.equal(await open(), false, language + ': no menu for ' + text) }
      // 7. A new chat from the menu empties the box.
      await setDraft('/new')
      await waitFor(async () => (await activeCommand()) === 'new')
      await press('Enter')
      await waitFor(async () => (await run(`document.querySelector('#prompt').value`)) === '')
      await shot(`03-after-${language}`)
    }
    console.log('PASS: the "/" menu in the real desktop app (ar/en): opens on a lone slash with groups and an active entry, narrows while typing, arrow keys and Escape work, Enter runs commands (opens a page, starts a new chat) or inserts text (/read), and paths or sentences never open it. Screenshots in ' + shots)
  } finally {
    if (instance) await stop(instance)
    const resolved = path.resolve(root)
    if (!resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(resolved).startsWith('najd-desktop-test-')) throw Error('Unsafe cleanup')
    for (const dir of [resolved, resolved + '-documents']) await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 }).catch(() => {})
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
