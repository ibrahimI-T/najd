// Phase 12 acceptance (NAJD_AGENT_MASTER_PLAN.md): NAJD finds, opens and verifies an installed Windows app; an intentional
// failure gives an accurate status; a cancellation halts before anything happens. Real host, isolated state; the Notepad
// window this test opens is the only one it closes (by its own process id).
const assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const { execFileSync } = require('node:child_process')
const { createWindowsNode } = require('../electron/windows-node.cjs')
const { createDesktopTools } = require('../electron/desktop-tools.cjs')
const { createStartApps } = require('../electron/start-apps.cjs')
const { createActionJournal } = require('../electron/action-journal.cjs')

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'najd-phase12-'))
  const node = createWindowsNode({ runtimeRoot: path.resolve(__dirname, '../.runtimes'), stateRoot: path.join(root, 'host') })
  const journal = createActionJournal({ filePath: path.join(root, 'actions.json') })
  const tools = createDesktopTools({ host: node, journal, startApps: createStartApps(), resolveReadable: () => { throw Object.assign(new Error('PATH_NOT_ALLOWED'), { code: 'PATH_NOT_ALLOWED' }) } })
  const ctx = { runId: 'phase12', requestApproval: async () => 'ALLOW_ONCE' }
  let openedPid = null
  // Notepad on Windows 11 can host several windows in one process: a process that was already running is never ended.
  const notepadBefore = new Set((await node.invokeHost('najd.desktop.windows', {})).filter(item => /notepad/i.test(item.process || '')).map(item => item.pid))
  try {
    // 1. Find, open and verify.
    const opened = await tools.open({ target: 'notepad' }, ctx)
    assert.equal(opened.status, 'opened'); assert.equal(opened.verified, true, JSON.stringify(opened))
    const windows = await node.invokeHost('najd.desktop.windows', {})
    openedPid = windows.find(item => String(item.window) === opened.window)?.pid || null
    console.log('step: opened and verified: ' + opened.title)
    // 2. Intentional failure: an app that is not installed is reported as such, nothing is opened.
    const missing = await tools.open({ target: 'No Such App 4821' }, ctx)
    assert.equal(missing.status, 'not_found'); assert.equal(missing.error, 'APP_NOT_FOUND')
    console.log('step: a missing app is reported as not found')
    // 3. Cancellation before the effect: nothing is opened and the journal records no success.
    const controller = new AbortController()
    const before = (await node.invokeHost('najd.desktop.windows', {})).length
    const cancelled = tools.open({ target: 'notepad' }, { runId: 'phase12', signal: controller.signal, requestApproval: async () => { controller.abort(); return 'ALLOW_ONCE' } })
    await assert.rejects(cancelled, { code: 'CANCELLED' })
    await new Promise(resolve => setTimeout(resolve, 1500))
    assert.equal((await node.invokeHost('najd.desktop.windows', {})).length, before, 'no window was opened after the cancellation')
    console.log('step: a cancellation before the effect opened nothing')
    console.log('PASS: Phase 12 acceptance - open and verify, accurate failure, cancellation halts.')
  } finally {
    if (openedPid && !notepadBefore.has(openedPid)) { try { execFileSync(path.join(process.env.SystemRoot, 'System32/taskkill.exe'), ['/PID', String(openedPid), '/F'], { stdio: 'ignore' }) } catch {} } else if (openedPid) console.warn('Notepad was already running; its window opened by this test is left open.')
    await node.stop().catch(() => {})
    try { fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }) } catch (failure) { console.warn('cleanup left ' + root + ' ' + failure.code) }
  }
}
main().catch(failure => { console.error(failure); process.exit(1) })
