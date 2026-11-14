// UI crawl of the Vue workstation in the real app with an isolated profile (R-080): every page the rail and Settings reach, both hub
// tabs, and every enabled button on each, pressed one at a time from a fresh page. For each press it records what happened: the page
// changed, a dialog or menu opened, a link/file was asked to open (recorded, never opened: NAJD_TEST_RECORD_SHELL), an error banner,
// a renderer exception or console error, or no visible change. Buttons that delete, remove, sign out, unlink or install are listed and
// skipped. Output: <out>/ui-crawl.json and a short summary; it fails only when the app throws or a button raises an error.
// Run: node tests/ui-crawl.cjs [--out <folder>] [--lang en]
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os')
process.env.NAJD_TEST_RECORD_SHELL = '1'
const { launch, stop, evaluate, waitFor } = require('./electron-ui-smoke.cjs')

const outArg = process.argv.indexOf('--out')
const out = path.resolve(outArg > 0 ? process.argv[outArg + 1] : path.join(os.tmpdir(), 'najd-ui-crawl'))
const SKIP = /حذف|إزالة|ازالة|تسجيل الخروج|فك الربط|فصل|سحب|تثبيت|تجهيز|تحديث الآن|إعادة التشغيل|إعادة تعيين|مسح|delete|remove|sign out|log out|unlink|disconnect|revoke|install|prepare|restart|reset|clear|uninstall/i
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
const LIST = "[...document.querySelectorAll('.ws-main button, .ws-side button')].filter(b => !b.disabled && b.offsetParent !== null).map(b => ({ b, label: (b.getAttribute('aria-label') || b.innerText || b.title || '').trim().replace(/\\s+/g, ' ').slice(0, 80), data: Object.keys(b.dataset).map(k => k + '=' + b.dataset[k]).join(' ') })).map((item, i, all) => ({ ...item, nth: all.slice(0, i).filter(other => other.label === item.label && other.data === item.data).length }))"

async function main() {
  await fs.mkdir(out, { recursive: true })
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'najd-desktop-test-'))
  const instance = await launch(root)
  const client = instance.client
  const problems = []
  const value = async expression => { const result = await client.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails).slice(0, 300)); return result.result.value }
  const shellCalls = async () => (await fs.readFile(path.join(root, 'shell-calls.jsonl'), 'utf8').catch(() => '')).split('\n').filter(Boolean).length
  // Renderer errors are collected in the page itself (unhandled errors and rejections, console.error).
  const instrument = () => value(`(() => { if (window.__najdErrors) return true; window.__najdErrors = [];
    addEventListener('error', e => window.__najdErrors.push('error: ' + (e.message || e.type)));
    addEventListener('unhandledrejection', e => window.__najdErrors.push('rejection: ' + String(e.reason && (e.reason.message || e.reason)).slice(0, 300)));
    const original = console.error.bind(console); console.error = (...args) => { window.__najdErrors.push('console: ' + args.map(String).join(' ').slice(0, 300)); original(...args) }; return true })()`)
  const state = () => value(`(() => { const main = document.querySelector('.ws'); const text = main ? main.innerText : ''; let h = 0; const html = main ? main.innerHTML : ''; for (let i = 0; i < html.length; i++) h = (h * 31 + html.charCodeAt(i)) | 0;
    return { hash: h, route: document.querySelector('[data-route]')?.dataset.route || '', settings: document.querySelector('[data-settings-route].on, [data-settings-route][aria-current]')?.dataset.settingsRoute || '',
      dialogs: document.querySelectorAll('[role=dialog]').length, menus: document.querySelectorAll('[role=menu]').length, hiddenMenus: [...document.querySelectorAll('[role=menu]')].filter(m => { const r = m.getBoundingClientRect(); const hit = document.elementFromPoint(Math.min(innerWidth - 1, Math.max(0, r.left + r.width / 2)), Math.min(innerHeight - 1, Math.max(0, r.top + 10))); return r.left < 0 || r.right > innerWidth || r.bottom > innerHeight || !hit || !m.contains(hit) }).length, banners: [...document.querySelectorAll('.w-banner.error')].map(b => b.innerText.trim()).filter(Boolean),
      errors: (window.__najdErrors || []).length, toasts: [...document.querySelectorAll('[data-toast]')].map(t => t.dataset.toast + ': ' + t.innerText.trim()), prompt: document.querySelector('#prompt')?.value || '', textLength: text.length } })()`)
  const errorsSince = from => value(`(window.__najdErrors || []).slice(${from})`)

  try {
    await waitFor(async () => await evaluate(client, 'document.querySelector("[data-shell=workstation]")?.dataset.renderer === "vue"'), 60000)
    await client.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
    await instrument()
    if (process.argv.includes('--lang') && process.argv[process.argv.indexOf('--lang') + 1] === 'en') await value(`(async () => { localStorage.setItem('najd-ws-prefs', JSON.stringify({ ...JSON.parse(localStorage.getItem('najd-ws-prefs') || '{}'), language: 'en' })); location.reload() })()`).catch(() => {})
    await pause(1500); await instrument()

    // Pages: the rail routes, the hub tabs, and every Settings page.
    const rail = await value(`[...document.querySelectorAll('[data-nav]')].map(b => b.dataset.nav).filter(id => !['new', 'account', 'apps'].includes(id))`)
    const pages = [{ id: 'home', go: `document.querySelector('[data-nav=new]').click()` }, ...rail.map(id => ({ id, go: `document.querySelector('[data-nav="${id}"]').click()` })),
      { id: 'skills-plugins/skill', go: `document.querySelector('[data-nav="skills-plugins"]').click(); setTimeout(() => document.querySelector('[data-hub-tab=skill]')?.click(), 200)` },
      { id: 'apps', go: `document.querySelector('[data-nav=apps]').click()` }]
    const openSettings = `document.querySelector('[data-nav=account]').click(); setTimeout(() => document.querySelector('.n-account + .w-menu button:last-child')?.click(), 150)`
    await value(openSettings); await pause(800)
    const settingsRoutes = await value(`[...document.querySelectorAll('[data-settings-route]')].map(b => b.dataset.settingsRoute)`)
    for (const id of settingsRoutes) pages.push({ id: 'settings/' + id, go: `${openSettings}; setTimeout(() => document.querySelector('[data-settings-route="${id}"]')?.click(), 450)` })

    const report = []
    for (const page of pages) {
      const visit = async () => { await value(`(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); document.querySelectorAll('.w-scrim').forEach(s => s.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))); ${page.go} })()`); await pause(900) }
      await visit()
      const pageErrors = await errorsSince(0)
      // Buttons of the page, outside the rail (the rail is crawled as pages), identified by their label and position.
      const buttons = await value(`${LIST}.map(({ label, data, nth }) => ({ label, data, nth }))`)
      const results = []
      for (const button of buttons) {
        if (SKIP.test(button.label)) { results.push({ ...button, outcome: 'skipped' }); continue }
        await visit()
        const start = await state(), calls = await shellCalls()
        const clicked = await value(`(() => { const hit = ${LIST}.find(item => item.label === ${JSON.stringify(button.label)} && item.data === ${JSON.stringify(button.data)} && item.nth === ${button.nth}); if (!hit) return false; hit.b.click(); return true })()`)
        if (!clicked) { results.push({ ...button, outcome: 'moved' }); continue }
        await pause(700)
        const after = await state(), newErrors = await errorsSince(start.errors), opened = (await shellCalls()) - calls
        const outcome = newErrors.length ? 'error' : after.banners.length > start.banners.length || after.toasts.some(t => t.startsWith('error') && !start.toasts.includes(t)) ? 'error-banner' : opened ? 'opened-external' :
          after.route !== start.route || after.settings !== start.settings ? 'navigated' : after.dialogs > start.dialogs ? 'dialog' : after.menus > start.menus ? (after.hiddenMenus > start.hiddenMenus ? 'menu-off-screen' : 'menu') :
          after.prompt !== start.prompt ? 'filled-composer' : after.toasts.some(t => t.startsWith('ok')) && after.toasts.join() !== start.toasts.join() ? 'confirmed' : after.hash !== start.hash ? 'changed' : 'no-visible-change'
        const row = { ...button, outcome, ...(newErrors.length ? { errors: newErrors } : {}), ...(outcome === 'error-banner' ? { banner: after.banners.at(-1) || after.toasts.at(-1) } : {}), ...(outcome === 'confirmed' ? { toast: after.toasts.at(-1) } : {}) }
        results.push(row)
        if (outcome === 'error' || outcome === 'error-banner' || outcome === 'menu-off-screen') problems.push({ page: page.id, ...row })
      }
      report.push({ page: page.id, pageErrors, buttons: results })
      const shot = await client.send('Page.captureScreenshot', { format: 'png' }).catch(() => null)
      if (shot) await fs.writeFile(path.join(out, page.id.replace(/[\\/]/g, '_') + '.png'), Buffer.from(shot.data, 'base64'))
    }
    await fs.writeFile(path.join(out, 'ui-crawl.json'), JSON.stringify({ at: new Date().toISOString(), pages: report, problems, shellCalls: (await fs.readFile(path.join(root, 'shell-calls.jsonl'), 'utf8').catch(() => '')).split('\n').filter(Boolean).map(line => JSON.parse(line)) }, null, 1))
    const count = outcome => report.reduce((sum, page) => sum + page.buttons.filter(b => b.outcome === outcome).length, 0)
    console.log(`UI crawl: ${report.length} pages, ${report.reduce((sum, page) => sum + page.buttons.length, 0)} buttons; changed ${count('changed')}, navigated ${count('navigated')}, dialog ${count('dialog')}, menu ${count('menu')}, composer ${count('filled-composer')}, confirmed ${count('confirmed')}, external ${count('opened-external')}, no visible change ${count('no-visible-change')}, skipped ${count('skipped')}, errors ${problems.length}. Report: ${path.join(out, 'ui-crawl.json')}`)
    if (problems.length) process.exitCode = 1
  } finally { await stop(instance) }
}
main().catch(error => { console.error(error); process.exit(1) })
