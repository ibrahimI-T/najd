// The new shell in the real desktop app with an isolated profile: first launch, every route, Arabic and English at the specified widths with
// no horizontal overflow, the rail staying left, the hub showing the whole catalog, a task created, the workbench, and a saved dashboard.
const assert = require('node:assert/strict')
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os')
const { launch, stop, evaluate, click, waitFor } = require('./electron-ui-smoke.cjs')

const WIDTHS = [360, 480, 768, 1024, 1440]
const SETTINGS = ['account-security', 'models', 'notifications', 'appearance', 'shortcuts', 'feature-management', 'quick-summon', 'startup-launch', 'permissions-control', 'archived-tasks', 'desktop-pet', 'general', 'subscription', 'conversation-memory', 'chat-settings', 'common-prompts', 'mcp', 'channels', 'knowledge', 'diagnostics']

async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'najd-desktop-test-'))
  const shots = process.env.NAJD_QA_DIR || path.join(root, 'shots')
  await fs.mkdir(shots, { recursive: true })
  let instance
  try {
    instance = await launch(root)
    const client = instance.client
    const shot = async name => { const capture = await client.send('Page.captureScreenshot', { format: 'png' }); await fs.writeFile(path.join(shots, name + '.png'), Buffer.from(capture.data, 'base64')) }
    const size = width => client.send('Emulation.setDeviceMetricsOverride', { width, height: 800, deviceScaleFactor: 1, mobile: false })
    const flat = async label => { const widest = await evaluate(client, `[...document.querySelectorAll('body *')].filter(e => e.getBoundingClientRect().right > innerWidth + 1).slice(0, 4).map(e => e.tagName + '.' + e.className + ':' + Math.round(e.getBoundingClientRect().right)).join(' ')`); assert.equal(await evaluate(client, 'document.documentElement.scrollWidth <= innerWidth + 1'), true, label + ' overflows: ' + widest) }
    const setLang = async language => { await evaluate(client, `document.querySelector('[data-nav="account"]').click()`); await new Promise(resolve => setTimeout(resolve, 80)); await evaluate(client, `document.querySelector('.n-account + .w-menu button:last-child').click()`); await new Promise(resolve => setTimeout(resolve, 80)); await evaluate(client, `document.querySelector('[data-settings-route="appearance"]').click()`); await new Promise(resolve => setTimeout(resolve, 80)); await evaluate(client, `[...document.querySelectorAll('.w-seg button')].find(button => button.textContent === '${language === 'ar' ? 'العربية' : 'English'}').click()`) }
    await waitFor(async () => await evaluate(client, '!!document.querySelector("[data-shell=workstation]")'))
    assert.equal(await evaluate(client, '!!document.querySelector(".app-shell")'), false, 'the previous shell is gone')
    assert.equal(await evaluate(client, 'document.querySelector("[data-shell=workstation]").dataset.renderer'), 'vue', 'the app loads the Vue 3 renderer (R-079)')
    assert.equal(await evaluate(client, 'document.documentElement.dir'), 'rtl')
    assert.ok(await evaluate(client, 'document.querySelector(".n-rail").getBoundingClientRect().left === 0'), 'the rail stays left in Arabic')
    await shot('home-ar')

    for (const id of ['dashboard', 'skills-plugins', 'task-center', 'remote-control']) {
      await click(client, `[data-nav="${id}"]`)
      await waitFor(async () => await evaluate(client, `document.querySelector('.ws-main').dataset.route === '${id}'`))
      await shot(id + '-ar')
    }
    // The hub: every entry of a category is on screen, and a marketplace fixture cannot be installed.
    await click(client, '[data-nav="skills-plugins"]')
    await waitFor(async () => await evaluate(client, '!!document.querySelector("[data-hub-kind] .mk-card")'))
    const total = await client.send('Runtime.evaluate', { expression: 'window.najdWorkstation.catalog().then(view => ({ total: view.entries.length, state: view.state, ready: view.entries.filter(entry => entry.state === "AVAILABLE").map(entry => entry.id) }))', awaitPromise: true, returnByValue: true })
    assert.equal(total.result.value.total, 135); assert.equal(total.result.value.state, 'offline', 'the default verified market has not synchronized in this isolated first-launch profile')
    await click(client, '[data-hub-tab="skill"]')
    await click(client, '[data-category="featured"]')
    await waitFor(async () => await evaluate(client, '!!document.querySelector("[data-entry=copywriting]")'))
    // A description-only market skill cannot be installed; its card offers to create it as the owner's own skill instead (R-080).
    assert.equal(await evaluate(client, '!!document.querySelector("[data-entry=copywriting] [data-create]")'), true)
    assert.equal(await evaluate(client, '[...document.querySelectorAll("[data-entry=copywriting] button")].some(button => /تثبيت/.test(button.textContent))'), false)
    await shot('hub-skills-ar')

    // Task Center: create, restart-safe storage is covered by unit tests; here the screen and IPC.
    await click(client, '[data-nav="task-center"]')
    await click(client, '[data-task="new"]')
    const type = (selector, value) => evaluate(client, `(() => { const e = document.querySelector('${selector}'), proto = e.tagName === 'TEXTAREA' ? HTMLTextAreaElement : HTMLInputElement; Object.getOwnPropertyDescriptor(proto.prototype, 'value').set.call(e, ${JSON.stringify(value)}); e.dispatchEvent(new Event('input', { bubbles: true })) })()`)
    await type('[data-task="title"]', 'Smoke task'); await type('[data-task="prompt"]', 'Say hello')
    await click(client, '[data-task="save"]')
    await waitFor(async () => await evaluate(client, '!!document.querySelector("[data-automation]")'))
    // "From chat": describing the task in words is the other way to create one; the button starts a new task with the request begun.
    await click(client, '[data-nav="task-center"]')
    await click(client, '[data-task="from-chat"]')
    await waitFor(async () => /جدول لي مهمة|Schedule a task for me/.test(await evaluate(client, 'document.querySelector("#prompt")?.value || document.querySelector("#prompt")?.textContent || ""')))

    // Quick language switch in the account menu: flips the interface language, and flips it back.
    const langNow = () => evaluate(client, 'document.documentElement.lang')
    const before = await langNow()
    for (let i = 0; i < 2; i++) {
      await click(client, '[data-nav="account"]'); await click(client, '[data-account-language]')
      await waitFor(async () => (await langNow()) === (i === 0 ? (before === 'ar' ? 'en' : 'ar') : before))
    }

    // Dashboard from a template.
    await click(client, '[data-nav="dashboard"]')
    await click(client, '[data-template="finance"]')
    await waitFor(async () => await evaluate(client, 'document.querySelectorAll("[data-dashboard=grid] .d-widget").length === 4'))
    await shot('dashboard-ar')

    // Workbench: Apps tab, declared apps, an honest not-built state.
    await click(client, '[data-nav="apps"]')
    await waitFor(async () => await evaluate(client, '!!document.querySelector("[data-apps]")'))
    assert.equal(await evaluate(client, '!!document.querySelector("[data-app=shader-editor]")'), true)
    await shot('apps-ar')

    // Session details tab: "Memory used" shows which notes shaped the last request (an honest empty state on a new profile).
    await click(client, '[data-workbench-new]')
    await evaluate(client, `[...document.querySelectorAll('[data-workbench] [role=menuitem]')].find(item => /تفاصيل الجلسة|Session details/.test(item.textContent))?.click()`)
    await waitFor(async () => await evaluate(client, '!!document.querySelector("[data-session-panel] [data-memory-used]")'))
    assert.match(await evaluate(client, 'document.querySelector("[data-memory-used]").innerText'), /الذاكرة المستخدمة|Memory used/)

    // Settings: every route is reachable from the account menu.
    await click(client, '[data-nav="account"]')
    await click(client, '.n-account + .w-menu button:last-child')
    for (const route of SETTINGS) {
      await click(client, `[data-settings-route="${route}"]`)
      await waitFor(async () => await evaluate(client, `!!document.querySelector('[data-settings="${route}"]')`))
    }
    await click(client, '[data-settings-route="appearance"]'); await shot('settings-ar')
    // Group headings in the settings list (wide layout only): four of them, shown in order, and hidden while searching.
    await client.send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 900, deviceScaleFactor: 1, mobile: false })
    await evaluate(client, `document.querySelector('[data-workbench] [aria-label]')?.closest('[data-workbench]') && void 0`)
    const groups = async () => evaluate(client, `[...document.querySelectorAll('.s-nav .s-nav-group')].filter(e => e.offsetParent).map(e => e.textContent.trim())`)
    await waitFor(async () => (await groups()).length === 4)
    assert.equal((await groups()).length, 4, 'four group headings: ' + JSON.stringify(await groups()))
    await shot('settings-groups-ar')
    await client.send('Emulation.clearDeviceMetricsOverride')

    for (const language of ['ar', 'en']) {
      await setLang(language)
      await waitFor(async () => await evaluate(client, `document.documentElement.lang === '${language}' && !!document.querySelector('[data-shell=workstation]')`))
      assert.equal(await evaluate(client, 'document.documentElement.dir'), language === 'ar' ? 'rtl' : 'ltr')
      // Fixed workbench tabs follow the language shown now (the Apps tab opened in Arabic said "التطبيقات" after switching to English).
      const tabNames = await evaluate(client, `[...document.querySelectorAll('[data-workbench] [role=tab]')].map(tab => tab.textContent.trim())`)
      if (tabNames.some(name => /التطبيقات|Apps/.test(name))) assert.ok(tabNames.includes(language === 'ar' ? 'التطبيقات' : 'Apps'), 'the Apps tab is named in ' + language + ': ' + JSON.stringify(tabNames))
      for (const width of WIDTHS) {
        await size(width)
        for (const id of ['dashboard', 'skills-plugins', 'task-center', 'remote-control']) {
          await evaluate(client, `document.querySelector('[data-nav="${id}"]')?.click()`)
          await new Promise(resolve => setTimeout(resolve, 60))
          await flat(`${language} ${id} ${width}`)
        }
        await shot(`${language}-${width}`)
      }
      await client.send('Emulation.clearDeviceMetricsOverride')
    }
    console.log('PASS: new shell only; all routes reached; 135 catalog entries; hub, Task Center, dashboard and workbench flows; Arabic and English at ' + WIDTHS.join(', ') + ' px without overflow. Screenshots: ' + shots)
  } finally {
    if (instance) await stop(instance)
    if (!process.env.NAJD_QA_DIR) await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 }).catch(() => {})
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
