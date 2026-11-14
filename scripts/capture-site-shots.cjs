// Product screenshots for najdagent.si and the public README, taken from the real desktop app (Vue renderer) in an isolated test profile:
// the harness's fake model answers, the workspace holds demo files, and nothing touches the owner's data. Dark theme, Arabic and English,
// 1440x900 PNGs in release/site-shots/<name>-<lang>.png. Usage: npm run build && node scripts/capture-site-shots.cjs [ar] [en]
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { launch, stop, evaluate, click, waitFor } = require('../tests/electron-ui-smoke.cjs')

const output = path.resolve(__dirname, '../release/site-shots')
const notes = {
  en: ['q3-sales-notes.md', '# Q3 sales notes\n\nRevenue SAR 4.2M, up 18% on Q2.\nRiyadh led all regions; Jeddah grew fastest.\nPlan: hire two more people in Jeddah.\n'],
  ar: ['مبيعات-الربع-الثالث.md', '# ملاحظات مبيعات الربع الثالث\n\nالإيرادات 4.2 مليون ريال بزيادة 18% عن الربع الثاني.\nالرياض الأعلى بين المناطق، وجدة الأسرع نموًا.\nالخطة: توظيف شخصين إضافيين في جدة.\n']
}
const prompts = { en: 'Summarize the Q3 sales notes in my workspace into a short report', ar: 'لخّص ملاحظات مبيعات الربع الثالث في مساحة العمل في تقرير قصير' }
const preference = { en: 'I prefer short, direct answers.', ar: 'أفضّل الإجابات القصيرة والمباشرة.' }

async function capture(language) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'najd-desktop-test-'))
  const workspace = path.join(root + '-documents', 'NAJD')
  await fs.mkdir(workspace, { recursive: true })
  await fs.writeFile(path.join(workspace, notes[language][0]), notes[language][1])
  let instance
  try {
    instance = await launch(root)
    const client = instance.client
    const run = async expression => {
      const result = await client.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
      if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails).slice(0, 400))
      return result.result.value
    }
    const exists = selector => evaluate(client, `document.querySelector(${JSON.stringify(selector)}) !== null`)
    const press = async selector => { await waitFor(async () => await evaluate(client, `(() => { const e = document.querySelector(${JSON.stringify(selector)}); return !!e && !e.disabled })()`), 30000); await run(`document.querySelector(${JSON.stringify(selector)}).click()`) }
    // The harness's test model shows under the name of the model the owner uses (the screenshots show the real app, not the test setup).
    // The test profile's folder shows as an ordinary Documents folder.
    const rename = () => run(`(() => { const folder = ${JSON.stringify(root + '-documents')}, shown = ${JSON.stringify('C:\\Users\\Ibrahim\\Documents')}; const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); let node; while ((node = walk.nextNode())) { const value = node.nodeValue.split(folder).join(shown).replace(/gpt-6\\.1-sol|NAJD test model/gi, 'GPT-5.6-Luna'); if (value !== node.nodeValue) node.nodeValue = value } return true })()`)
    const closeDetails = () => run(`(() => { const toggle = document.querySelector('[data-workbench-toggle]'); if (toggle && toggle.getAttribute('aria-pressed') === 'true') toggle.click(); return true })()`)
    const shot = async name => {
      await new Promise(resolve => setTimeout(resolve, 900))
      await rename()
      const image = await client.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
      await fs.writeFile(path.join(output, `${name}-${language}.png`), Buffer.from(image.data, 'base64'))
    }
    const ready = () => waitFor(async () => await evaluate(client, 'document.querySelector("[data-shell=workstation]")?.dataset.renderer === "vue" && !!document.querySelector("#prompt")'), 60000)
    await client.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
    await ready()
    // Dark theme, the chosen language, Work mode; a model "connected" through the harness's fake provider.
    await run(`(async () => { const key = 'najd.workstation.preferences.v1'; const value = JSON.parse(localStorage.getItem(key) || '{}');
      localStorage.setItem(key, JSON.stringify({ ...value, version: 1, language: ${JSON.stringify(language)}, theme: 'dark', mode: 'work', displayName: 'Ibrahim' }));
      localStorage.setItem('najd.provider.v1', 'openai-api'); localStorage.setItem('najd.models.v2', JSON.stringify({ 'openai-api': 'gpt-6.1-sol' }));
      await window.najdProviders.saveKey('openai-api', 'sk-najd-API-TEST-KEY'); const { policy } = await window.najdProviders.limits(); await window.najdProviders.setLimits({ ...policy, maxOutputTokens: 1024 }); return true })()`)
    await client.send('Page.reload'); await ready()
    await waitFor(async () => await evaluate(client, `document.documentElement.lang === ${JSON.stringify(language)}`), 20000).catch(() => {})
    await closeDetails()
    await shot('home')

    // The "/" menu of commands and saved prompts.
    await click(client, '#prompt')
    await client.send('Input.insertText', { text: '/' })
    await new Promise(resolve => setTimeout(resolve, 600))
    await shot('commands')
    await run(`(() => { const box = document.querySelector('#prompt'); box.value = ''; box.dispatchEvent(new Event('input', { bubbles: true })); return true })()`)

    // A real task in the workspace: NAJD asks before writing the report, then shows its steps and the file it made.
    await click(client, '#prompt')
    await client.send('Input.insertText', { text: prompts[language] })
    await press('.k-send[type=submit]')
    await waitFor(() => exists('[data-approval]'), 60000)
    await shot('approvals')
    await run(`[...document.querySelectorAll('[data-approval] button')].find(b => /Allow once/.test(b.textContent)).click()`)
    await waitFor(async () => await evaluate(client, `[...document.querySelectorAll('.c-msg.assistant')].some(m => /Done|تم/.test(m.textContent))`), 60000)
    await run(`(() => { const head = [...document.querySelectorAll('.a-head')].at(-1); if (head && head.getAttribute('aria-expanded') !== 'true') head.click(); return true })()`)
    await closeDetails()
    await shot('task')

    // Skills and plugins.
    await press('[data-nav="skills-plugins"]')
    await waitFor(() => exists('[data-hub-tab=skill]'))
    await press('[data-hub-tab=skill]')
    await waitFor(() => exists('[data-entry]'))
    await closeDetails()
    await shot('skills')
    await press('[data-hub-tab=plugin]')
    await new Promise(resolve => setTimeout(resolve, 800))
    await shot('plugins')

    // What NAJD learned about the owner (a preference stated in a chat), in Settings > Conversation memory.
    // The learning service picks up an explicit preference stated in English; the Arabic shot then shows it in the owner's own words.
    await run(`(async () => { let task = await window.najdCore.startTask('I prefer short, direct answers.', crypto.randomUUID(), 'openai-api', 'gpt-6.1-sol', undefined, 'low');
      for (let i = 0; i < 200 && ['QUEUED', 'RUNNING'].includes(task.state); i++) { await new Promise(r => setTimeout(r, 50)); task = await window.najdCore.getTask(task.id) }
      await new Promise(r => setTimeout(r, 300)); const listed = await window.najdLearning.list(); const note = listed.approved.preference[0];
      if (note && ${JSON.stringify(language)} === 'ar') await window.najdLearning.edit('preference', { id: note.id, title: note.title, text: ${JSON.stringify(preference.ar)} });
      return !!note })()`)
    await press('[data-nav="account"]')
    await waitFor(() => exists('.n-account + .w-menu'))
    await run(`document.querySelector('.n-account + .w-menu button:last-child').click()`)
    await press('[data-settings-route=conversation-memory]')
    await waitFor(() => exists('[data-learned]'), 20000)
    await run(`document.querySelector('[data-learned]')?.scrollIntoView({ block: 'start' }); true`)
    await closeDetails()
    await shot('memory')
  } finally {
    if (instance) await stop(instance)
    const resolved = path.resolve(root)
    if (!resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(resolved).startsWith('najd-desktop-test-')) throw new Error('Unsafe cleanup')
    for (const directory of [resolved, resolved + '-documents']) await fs.rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 }).catch(() => {})
  }
}

async function main() {
  await fs.mkdir(output, { recursive: true })
  for (const language of process.argv.slice(2).length ? process.argv.slice(2) : ['ar', 'en']) await capture(language)
  console.log('PASS: site screenshots captured in ' + output)
}

main().catch(error => { console.error(error); process.exitCode = 1 })
