const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { launch, stop, click, evaluate, waitFor } = require('./electron-ui-smoke.cjs')

async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'najd-desktop-test-'))
  const fixtures = path.join(root, 'read-fixtures'), file = path.join(fixtures, 'document.txt')
  const privateText = 'SKILL-LOCAL-PREVIEW-ONLY'
  const screenshots = path.resolve(__dirname, '../release/qa-capabilities')
  await fs.mkdir(fixtures); await fs.writeFile(file, privateText); await fs.mkdir(screenshots, { recursive: true })
  let instance
  try {
    const store = require('../electron/session-store.cjs').createSessionStore(path.join(root, 'najd-data/sessions.json'))
    const session = await store.createSession()
    await store.appendMessage(session.id, 'user', 'Capability verification fixture')
    // Built-ins start installed and enabled; this flow starts from a saved "all removed" choice, which must be honored.
    await fs.mkdir(path.join(root, 'najd-data/capabilities'), { recursive: true })
    await fs.writeFile(path.join(root, 'najd-data/capabilities/registry.json'), JSON.stringify({ version: 1, installed: {} }))
    instance = await launch(root)
    const client = instance.client
    const css = id => `[data-capability="${id}"]`
    const read = 'najd-read-document'
    const el = selector => evaluate(client, `document.querySelector(${JSON.stringify(selector)}) !== null`)
    const until = predicate => waitFor(predicate, 90000)
    async function settings(section) {
      if (!await el('.settings-nav')) await click(client, '.sidebar-link[aria-label]')
      await click(client, `.settings-nav-item:nth-child(${section})`)
      await waitFor(async () => await evaluate(client, `document.querySelector('.settings-nav-item:nth-child(${section})').getAttribute('aria-current') === 'page'`))
    }
    async function input(selector, value) {
      await until(async () => await el(selector) && !await evaluate(client, `document.querySelector(${JSON.stringify(selector)}).disabled`))
      await click(client, selector)
      assert.equal(await evaluate(client, `document.activeElement === document.querySelector(${JSON.stringify(selector)})`), true, 'Input must own focus before typing')
      await client.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', modifiers: 2, windowsVirtualKeyCode: 65 })
      await client.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', modifiers: 2, windowsVirtualKeyCode: 65 })
      await client.send('Input.insertText', { text: value })
      assert.equal(await evaluate(client, `document.querySelector(${JSON.stringify(selector)}).value`), value)
    }
    async function action(id, name) {
      const selector = `${css(id)} [data-cap-action="${name}"]`
      await until(async () => await el(selector) && !await evaluate(client, `document.querySelector(${JSON.stringify(selector)}).disabled`))
      await click(client, selector)
    }
    async function runRead(decision) {
      await settings(10)
      await until(() => el(css(read)))
      await input(`${css(read)} input`, file)
      await action(read, 'run')
      await until(() => el('.approval-card'))
      assert.ok((await evaluate(client, 'document.querySelector(".approval-card").textContent')).includes(file))
      await click(client, decision === 'DENY' ? '.approval-deny' : '.approval-allow')
      await until(async () => !await el('.approval-card'))
    }
    await until(() => el('.sidebar-link[aria-label="الإعدادات"]'))
    await until(() => el('.session-open'))
    // Folder-scoped reading is what this smoke checks; whole-computer reading (the default since 2026-10-19) is off here.
    await evaluate(client, 'window.najdFiles.wholeComputer(false)')
    await settings(10)
    await until(() => el(css(read)))
    await action(read, 'install')
    await until(() => el(`${css(read)} [data-cap-action="enable"]`))
    assert.equal(await evaluate(client, `document.querySelector('${css(read)} [data-cap-action="run"]').disabled`), true)
    await action(read, 'enable')
    await runRead('ALLOW_ONCE')
    await until(() => el('.notice'))
    assert.match(await evaluate(client, 'document.querySelector(".notice").textContent'), /مجلد/)
    assert.equal(await el('.local-file-preview'), false)
    console.log('PASS: install defaults disabled; enabling does not grant a file root.')

    await settings(7)
    await click(client, '.browser-action')
    await until(() => el('.root-path'))
    for (const language of ['ar', 'en']) {
      await settings(1)
      await click(client, `.settings-group .setting-row:first-child .segmented button:${language === 'ar' ? 'first' : 'last'}-child`)
      await runRead('DENY')
      assert.equal(await el('.local-file-preview'), false)
      await runRead('ALLOW_ONCE')
      await until(async () => (await evaluate(client, 'document.querySelector(".local-file-preview")?.textContent || ""')).includes(privateText))
      await click(client, '.local-file-preview button')
      console.log(`PASS: ${language} real approval denial/allow, exact fixture read and temporary preview.`)
    }
    await settings(10)
    const finder = 'najd-find-documents'
    await action(finder, 'install'); await action(finder, 'enable')
    await input(`${css(finder)} label:first-child input`, fixtures)
    await input(`${css(finder)} label:nth-child(2) input`, 'document')
    await action(finder, 'run'); await until(() => el('.approval-card'))
    await click(client, '.approval-allow')
    await until(async () => (await evaluate(client, 'document.querySelector(".message-list")?.textContent || ""')).includes(file))
    console.log('PASS: real approved document filename search.')

    await settings(10)
    const apps = 'najd-list-apps'
    await action(apps, 'install'); await action(apps, 'enable'); await action(apps, 'run')
    await until(() => el('.approval-card')); await click(client, '.approval-allow')
    await until(async () => /Notepad/.test(await evaluate(client, 'document.querySelector(".message-list")?.textContent || ""')))
    console.log('PASS: approved app discovery through the native companion; no app was launched.')

    await settings(10)
    await click(client, '[data-cap-sources]')
    await until(() => el('[data-skill-source="hermes"]'))
    assert.equal(await evaluate(client, 'document.querySelectorAll(".capability-sources [data-cap-action]").length'), 0)
    for (const source of ['openclaw', 'hermes']) await click(client, `[data-skill-source="${source}"] > summary`)
    await settings(3)
    // Connection management sits in a folded section below the connections catalog.
    await click(client, 'details.catalog-manage > summary')
    // The companion may already be connected from the app discovery above (desktop control starts it on demand).
    await until(async () => await el('[data-mcp-action="connect"]') || await el('[data-mcp-state="connected"]'))
    if (await el('[data-mcp-action="connect"]')) await click(client, '[data-mcp-action="connect"]')
    await until(() => el('[data-mcp-state="connected"]'))
    await click(client, '[data-mcp] summary')
    assert.match(await evaluate(client, 'document.querySelector(".mcp-panel").textContent'), /2024-11-05/)
    await click(client, '[data-mcp-action="disconnect"]')
    await until(() => el('[data-mcp-state="disconnected"]'))
    console.log('PASS: real native MCP connect/protocol receipt/disconnect; upstream metadata stays read-only.')

    for (const language of ['ar', 'en']) {
      await settings(1)
      await click(client, `.settings-group .setting-row:first-child .segmented button:${language === 'ar' ? 'first' : 'last'}-child`)
      for (const theme of ['dark', 'light', 'navy', 'system']) {
        await settings(1); await click(client, `[data-theme="${theme}"]`)
        for (const width of [360, 480, 768, 1024, 1440]) {
          await client.send('Emulation.setDeviceMetricsOverride', { width, height: 800, deviceScaleFactor: 1, mobile: false })
          // MatchMedia updates React state, then the sidebar transition runs.
          // Measure the final layout, not an intermediate animation frame.
          await waitFor(async () => await evaluate(client, `(() => {
            // Narrow windows keep only the navigation rail; wider ones show the conversation list too.
            if (innerWidth<=680) return document.querySelector('.sidebar').getBoundingClientRect().width===0 && Math.abs(document.querySelector('.app-rail').getBoundingClientRect().width-56)<1;
            return Math.abs(document.querySelector('.sidebar').getBoundingClientRect().width-(innerWidth<=1100 ? 228 : 264))<1;
          })()`))
          for (const section of [1, 6, 3, 5, 8, 9, 10]) {
            await settings(section)
            const overflow = await evaluate(client, `['html','.settings-scroll','.settings-panel'].map(selector => {
              const e=document.querySelector(selector);return {selector,width:e.clientWidth,scroll:e.scrollWidth};
            }).filter(e=>e.scroll>e.width+1)`)
            assert.deepEqual(overflow, [], `${language}/${theme}/${width}/${section} overflow`)
            if (section === 6) {
              await settings(10)
              await waitFor(() => el(css(read)))
              await client.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 })
              await client.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 })
              assert.equal(await evaluate(client, 'document.activeElement !== document.body'), true)
              if (['dark', 'light'].includes(theme) && [360, 1440].includes(width)) {
                await evaluate(client, 'document.querySelector(".settings-scroll").scrollTop=0')
                const capture = await client.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
                await fs.writeFile(path.join(screenshots, `${language}-${theme}-${width}.png`), Buffer.from(capture.data, 'base64'))
              }
            }
          }
        }
        console.log(`PASS: ${language}/${theme} requested responsive widths.`)
      }
    }
    await client.send('Emulation.clearDeviceMetricsOverride')
    console.log('PASS: 120 page/language/theme/viewport checks at 360/480/768/1024/1440 CSS px; keyboard focus and fixture screenshots.')

    await stop(instance); instance = null
    instance = await launch(root)
    const restarted = instance.client
    await waitFor(async () => await evaluate(restarted, 'document.querySelector(".sidebar-link[aria-label=Settings]") !== null'))
    await click(restarted, '.sidebar-link[aria-label="Settings"]'); await click(restarted, '.settings-nav-item:nth-child(10)')
    await waitFor(async () => await evaluate(restarted, `document.querySelector('${css(read)} [data-cap-action="disable"]') !== null`))
    await click(restarted, `${css(read)} [data-cap-action="disable"]`)
    await waitFor(async () => await evaluate(restarted, `document.querySelector('${css(read)} [data-cap-action="enable"]') !== null`))
    assert.equal(await evaluate(restarted, `document.querySelector('${css(read)} [data-cap-action="run"]').disabled`), true)
    await click(restarted, `${css(read)} [data-cap-action="remove"]`)
    await waitFor(async () => await evaluate(restarted, `document.querySelector('${css(read)} [data-cap-action="install"]') !== null`))
    const registry = JSON.parse(await fs.readFile(path.join(root, 'najd-data/capabilities/registry.json'), 'utf8'))
    assert.equal(registry.installed[read], undefined)
    for (const session of JSON.parse(await fs.readFile(path.join(root, 'najd-data/sessions.json'), 'utf8')).sessions) {
      assert.equal(JSON.stringify(session).includes(privateText), false)
    }
    assert.equal(await evaluate(restarted, 'document.querySelector(".local-file-preview")'), null)
    console.log('PASS: enabled skill survives restart; disable/remove persists; private file body is absent from stored sessions and restarted UI.')
    await stop(instance); instance = null
    const registryPath = path.join(root, 'najd-data/capabilities/registry.json')
    await fs.writeFile(registryPath, '{"corrupt":')
    instance = await launch(root)
    await waitFor(async () => await evaluate(instance.client, 'document.querySelector(".sidebar-link[aria-label=Settings]") !== null'))
    await click(instance.client, '.sidebar-link[aria-label="Settings"]'); await click(instance.client, '.settings-nav-item:nth-child(10)')
    await waitFor(async () => /Data was preserved/.test(await evaluate(instance.client, 'document.querySelector(".capability-panel [role=alert]")?.textContent || ""')))
    assert.equal(await evaluate(instance.client, 'document.querySelectorAll(".capability-card").length'), 0)
    await click(instance.client, '[data-cap-refresh]')
    assert.equal(await fs.readFile(registryPath, 'utf8'), '{"corrupt":')
    console.log('PASS: corrupt registry remains intact; UI fails closed with an actionable error and no executable skill controls.')
  } catch (error) {
    if (instance) {
      try { console.error('Layout diagnostic: ' + JSON.stringify(await evaluate(instance.client, `({width:innerWidth,rail:document.querySelector('.app-shell').className,sidebar:document.querySelector('.sidebar').getBoundingClientRect().width})`))) } catch {}
      try { const capture=await instance.client.send('Page.captureScreenshot',{format:'png'}); await fs.writeFile(path.join(screenshots,'failure.png'),Buffer.from(capture.data,'base64')) } catch {}
      try { console.error('Fixture UI diagnostic: ' + (await evaluate(instance.client, 'document.body.innerText')).slice(-6000)) } catch {}
    }
    throw error
  } finally {
    if (instance && instance.process.exitCode === null) await stop(instance)
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(root).startsWith('najd-desktop-test-')) throw new Error('Unsafe test cleanup')
    await fs.rm(root, { recursive: true, force: true })
  }
}
let completed = false
process.once('beforeExit', () => { if (!completed) { console.error('Capability UI smoke incomplete'); process.exitCode = 1 } })
main().then(() => { completed = true }, error => { completed = true; console.error(error); process.exitCode = 1 })
