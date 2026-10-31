// Desktop tools over the real NAJD desktop host (owner live test 2026-10-31: an opened Notepad could not be read, and
// after "New tab" changed its title every read was STALE_TARGET). A WinForms fixture this test creates behaves like a
// tabbed editor: pressing "New tab" adds an empty document field and changes the window title. The model-facing tools
// must read the window by the id they were given, recover the read after the title change for the same window and
// process, type into the new document and verify it from the observation returned with the action. A window of another
// process with the same title is never followed, and nothing is saved anywhere.
// Usage: node tests/desktop-recovery-smoke.cjs   (needs the host built: node scripts/build-windows-node.cjs)
const assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const { spawn } = require('node:child_process')
const { randomUUID } = require('node:crypto')
const { createWindowsNode } = require('../electron/windows-node.cjs')
const { createDesktopTools } = require('../electron/desktop-tools.cjs')
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

const title = 'NAJD Tabs Fixture ' + randomUUID().slice(0, 8)
const form = `
Add-Type -AssemblyName System.Windows.Forms
$form = New-Object System.Windows.Forms.Form; $form.Text = 'Existing notes - ${title}'; $form.Width = 520; $form.Height = 320
$existing = New-Object System.Windows.Forms.TextBox; $existing.AccessibleName = 'Existing document'; $existing.Text = 'keep me'; $existing.Top = 10; $existing.Left = 10; $existing.Width = 300
$newTab = New-Object System.Windows.Forms.Button; $newTab.Text = 'New tab'; $newTab.Top = 40; $newTab.Left = 10
$newTab.Add_Click({
  $doc = New-Object System.Windows.Forms.TextBox; $doc.AccessibleName = 'New document'; $doc.Top = 80; $doc.Left = 10; $doc.Width = 300
  $form.Controls.Add($doc); $form.Text = 'Untitled - ${title}'
})
$form.Controls.AddRange(@($existing, $newTab))
[System.Windows.Forms.Application]::Run($form)`

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'najd-desktop-recovery-'))
  const fixture = spawn('powershell.exe', ['-NoProfile', '-STA', '-Command', form], { windowsHide: false, stdio: 'ignore' })
  const node = createWindowsNode({ runtimeRoot: path.resolve(__dirname, '../.runtimes'), stateRoot: path.join(root, 'state'), testHooks: true })
  const calls = []
  const host = { invokeHost: (name, args, ...rest) => { calls.push(name); return node.invokeHost(name, args, ...rest) } }
  const tools = createDesktopTools({ host, journal: null, resolveReadable: input => input })
  const approvals = []
  const ctx = { runId: 'recovery', requestApproval: async (tool, card) => { approvals.push([tool, card.summary]); return 'ALLOW_ONCE' } }
  try {
    let window
    for (let i = 0; i < 50 && !window; i++) { await sleep(200); window = (await node.invokeHost('najd.desktop.windows', {})).find(item => item.title.endsWith(title)) }
    assert.ok(window, 'fixture window listed')
    // The id alone is enough: no separate najd_desktop_windows call in this run.
    const first = await tools.read({ window: window.window }, ctx)
    assert.equal(first.title, 'Existing notes - ' + title)
    const button = first.elements.find(item => item.name === 'New tab')
    assert.ok(button, JSON.stringify(first.elements))
    const pressed = await tools.act({ window: window.window, element: button.id, action: 'invoke', text: '' }, ctx)
    assert.equal(pressed.status, 'done', JSON.stringify(pressed))
    // The window changed its title; the observation after the action follows it (same handle, process and creation time).
    assert.equal(pressed.after.title, 'Untitled - ' + title)
    const fresh = pressed.after.elements.find(item => item.name === 'New document')
    assert.ok(fresh, JSON.stringify(pressed.after.elements))
    const typed = await tools.act({ window: window.window, element: fresh.id, action: 'setValue', text: 'NAJD TEST' }, ctx)
    assert.equal(typed.status, 'done')
    assert.equal(typed.after.elements.find(item => item.name === 'New document').value, 'NAJD TEST')
    assert.equal(typed.after.elements.find(item => item.name === 'Existing document').value, 'keep me', 'the existing document is unchanged')
    // A plain read after a title change recovers by itself too.
    const reread = await tools.read({ window: window.window, from: 0 }, ctx)
    assert.equal(reread.title, 'Untitled - ' + title)
    // One read approval for this window and one per action, nothing else.
    assert.deepEqual(approvals.map(([tool]) => tool), ['najd-desktop-read', 'najd-desktop-act', 'najd-desktop-act'])
    assert.equal(calls.filter(name => name === 'najd.desktop.act').length, 2, 'each action was sent exactly once')
    // An element id from before the change is refused (nothing done), with directions.
    await assert.rejects(tools.act({ window: window.window, element: 'e999', action: 'invoke', text: '' }, ctx), { code: 'STALE_TARGET', hint: /latest najd_desktop_read/ })
    console.log('PASS: desktop tools read a window by its id, follow a title change of the same window and process, type into the new document and verify it from the observation after the action, leaving the existing document unchanged')
  } finally {
    try { fixture.kill() } catch {}
    await node.stop?.().catch?.(() => {})
    fs.rmSync(root, { recursive: true, force: true })
  }
}
main().then(() => process.exit(0), error => { console.error(error); process.exit(1) })
