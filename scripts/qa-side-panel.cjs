// Fixture screenshots of the session details panel (agent platform M1). Isolated temporary profile with a seeded
// conversation, run receipts, outputs and a video job; no provider, account or network is used.
// Usage: node scripts/qa-side-panel.cjs [outputDir]   (needs a renderer build: npm run build)
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { randomUUID } = require('node:crypto')
const electron = require('electron')
const { connect, waitForPage, freePort } = require('../tests/electron-ui-smoke.cjs')

const project = path.resolve(__dirname, '..')
const out = path.resolve(process.argv[2] || path.join(project, 'release', 'qa-side-panel'))
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

async function seed(root) {
  const data = path.join(root, 'najd-data'), id = randomUUID(), now = Date.now()
  await fs.mkdir(data, { recursive: true })
  const at = offset => new Date(now - offset).toISOString()
  await fs.writeFile(path.join(data, 'sessions.json'), JSON.stringify({ version: 1, sessions: [{ id, title: 'تقرير المبيعات الشهري', createdAt: at(600000), updatedAt: at(60000), messages: [
    { role: 'user', text: 'اكتب لي سكربت بايثون يجمع مبيعات الشهر من ملف CSV ويحفظ ملخص.', createdAt: at(600000) },
    { role: 'assistant', text: 'جهزت السكربت وحفظته في `sales_summary.py`، وحفظت الملخص في `summary.md` بعد موافقتك.\n\n| الشهر | المبيعات |\n|---|---|\n| سبتمبر | 48,200 |\n| أكتوبر | 53,900 |', createdAt: at(540000) }] }] }))
  const receipt = (runId, offset, profile, toolsets, usage, request) => ({ runId, conversationId: id, state: 'COMPLETED', at: now - offset, outcome: 'completed',
    profile, toolsets, toolCalls: 3, usage, request })
  await fs.writeFile(path.join(data, 'run-receipts.json'), JSON.stringify({ format: 'najd-run-receipts-v1', runs: [
    receipt(randomUUID(), 540000, 'coding', ['core', 'memory', 'files', 'terminal', 'web', 'skills'],
      { input: 18420, output: 1630, total: 20050, cached: 12288, modelCalls: 4, partial: false },
      { instructionsBytes: 2900, toolsBytes: 7600, historyBytes: 1800, turnBytes: 5200, images: 0 })] }))
  await fs.writeFile(path.join(data, 'conversation-outputs.json'), JSON.stringify({ format: 'najd-conversation-outputs-v1',
    outputs: [{ conversationId: id, runId: null, kind: 'file', path: 'C:/Users/user/Documents/NAJD/sales_summary.py', libraryId: null, name: 'sales_summary.py', at: now - 530000 },
      { conversationId: id, runId: null, kind: 'file', path: 'C:/Users/user/Documents/NAJD/summary.md', libraryId: null, name: 'summary.md', at: now - 520000 }],
    jobs: [{ jobId: 'video_demo', conversationId: id, state: 'in_progress', prompt: 'مقطع قصير يعرض نمو المبيعات', output: null, updatedAt: now - 30000 }] }))
  return id
}

async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'najd-desktop-test-panel-'))
  await seed(root)
  await fs.mkdir(out, { recursive: true })
  const port = await freePort()
  const child = spawn(electron, [path.join(project, 'tests', 'electron-harness.cjs')], { cwd: project, windowsHide: true, stdio: 'ignore',
    env: { ...process.env, NAJD_TEST_USER_DATA: root, NAJD_TEST_DEBUG_PORT: String(port), NAJD_TEST_PACKAGED: '0' } })
  try {
    const page = await waitForPage(port)
    const client = await connect(page.webSocketDebuggerUrl)
    const ev = async expression => (await client.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result?.value
    await client.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
    for (const language of ['ar', 'en']) {
      await ev(`(() => { const key = 'najd.preferences.v1'; const value = JSON.parse(localStorage.getItem(key) || '{}'); value.language = ${JSON.stringify(language)};
        localStorage.setItem(key, JSON.stringify(value)); localStorage.setItem('najd.sidePanel.v1', 'open') })()`)
      await sleep(300)
      await client.send('Page.reload', {})
      await sleep(2500)
      for (let i = 0; i < 40 && !await ev("!!document.querySelector('.session-open')"); i++) await sleep(250)
      await ev("document.querySelector('.session-open')?.click()")
      await sleep(400)
      if (!await ev("!!document.querySelector('#side-panel')")) await ev("document.querySelector('.topbar-panel')?.click()")
      for (let i = 0; i < 40 && !await ev("document.querySelector('.usage-grid') !== null"); i++) await sleep(250)
      await sleep(600)
      const shot = await client.send('Page.captureScreenshot', { format: 'png' })
      const file = path.join(out, `side-panel-${language}.png`)
      await fs.writeFile(file, Buffer.from(shot.data, 'base64'))
      const state = await ev("({ panel: !!document.querySelector('#side-panel'), rightEdge: Math.round(document.querySelector('#side-panel')?.getBoundingClientRect().right || 0), width: innerWidth, usage: document.querySelector('.usage-grid')?.innerText.replace(/\\s+/g, ' ').slice(0, 120) })")
      console.log(language, JSON.stringify(state), file)
    }
    client.close()
  } finally {
    child.kill()
    await sleep(500)
    for (const dir of [root, root + '-documents']) await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }).catch(() => {})
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
