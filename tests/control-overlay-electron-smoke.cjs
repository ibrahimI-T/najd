// The real control overlay in real Electron windows (one per display), end to end: the real desktop host presses a button of a
// test-owned window through the real desktop tools and the overlay wrapper, and the ring must be created and painted in the overlay.
// The overlay is excluded from screen capture on purpose, so the check reads the overlay page (webContents) and its own rendered
// pixels (capturePage), never the screen.
// Usage: node_modules/.bin/electron tests/control-overlay-electron-smoke.cjs   (npm run smoke:overlay)
const { app, BrowserWindow, screen } = require('electron')
const assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const { spawn, execFileSync } = require('node:child_process')
const { createControlOverlay, withControlOverlay } = require('../electron/workstation/control-overlay.cjs')
const { createDesktopTools } = require('../electron/desktop-tools.cjs')
const { createWindowsNode } = require('../electron/windows-node.cjs')
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

const title = 'NAJD Overlay Fixture ' + Math.random().toString(16).slice(2, 8)
const form = `
Add-Type -AssemblyName System.Windows.Forms
$form = New-Object System.Windows.Forms.Form; $form.Text = '${title}'; $form.StartPosition = 'Manual'; $form.Left = 120; $form.Top = 160; $form.Width = 360; $form.Height = 200; $form.TopMost = $true
$button = New-Object System.Windows.Forms.Button; $button.Text = 'Press me'; $button.Left = 20; $button.Top = 30; $button.Width = 140; $button.Height = 40
$label = New-Object System.Windows.Forms.Label; $label.Text = 'Not pressed'; $label.Left = 20; $label.Top = 100; $label.Width = 300
$button.Add_Click({ $label.Text = 'Pressed' })
$form.Controls.AddRange(@($button, $label))
[System.Windows.Forms.Application]::Run($form)`

app.disableHardwareAcceleration?.()
app.whenReady().then(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'najd-overlay-smoke-'))
  const fixture = spawn('powershell.exe', ['-NoProfile', '-STA', '-Command', form], { windowsHide: false, stdio: 'ignore' })
  const node = createWindowsNode({ runtimeRoot: path.resolve(__dirname, '../.runtimes'), stateRoot: path.join(root, 'state'), testHooks: true })
  let code = 1
  try {
    const overlay = createControlOverlay({ BrowserWindow, screen, linger: 4000 })
    const tools = withControlOverlay(createDesktopTools({ host: node, resolveReadable: input => input, verifyMs: 300 }), overlay)
    const ctx = { runId: 'overlay-smoke', requestApproval: async () => 'ALLOW_ONCE' }
    let window
    for (let i = 0; i < 50 && !window; i++) { await sleep(200); window = (await node.invokeHost('najd.desktop.windows', {})).find(item => item.title === title) }
    assert.ok(window, 'the test window is listed')
    await sleep(500)
    const read = await tools.read({ window: String(window.window) }, ctx)
    const button = read.elements.find(item => item.name === 'Press me')
    assert.ok(button, 'the button is read: ' + JSON.stringify(read.elements.map(item => item.name)))

    // The press, as the model does it (invoke). The ring must appear in the overlay of the display that holds the button.
    const ringsIn = win => win.webContents.executeJavaScript(`document.querySelectorAll('.ring').length`).catch(() => 0)
    const overlays = () => BrowserWindow.getAllWindows().filter(win => win.getTitle() === 'NAJD CONTROL')
    const pressed = tools.act({ window: String(window.window), element: button.id, action: 'invoke', text: '' }, ctx)
    let seen = false, painted = false, bounds = null
    // The ring lives about a second and is drawn when the act returns: poll for it while (and after) the act runs.
    for (let i = 0; i < 80 && !painted; i++) {
      await sleep(100)
      for (const win of overlays()) {
        if (await ringsIn(win)) {
          seen = true
          const image = await win.webContents.capturePage(), bitmap = image.toBitmap()
          for (let p = 0; p < bitmap.length; p += 4) { const blue = bitmap[p], green = bitmap[p + 1], red = bitmap[p + 2], alpha = bitmap[p + 3]; if (alpha > 200 && red > 230 && green > 140 && green < 210 && blue < 90) { painted = true; bounds = win.getBounds(); break } }
        }
      }
    }
    const result = await pressed
    assert.equal(result.status, 'done', 'the press was done: ' + JSON.stringify(result))
    assert.ok(Number.isFinite(result.at?.x) && Number.isFinite(result.at?.y), 'the host reported where it pressed: ' + JSON.stringify(result.at))
    assert.ok(seen, 'a ring element appeared in an overlay window')
    assert.ok(painted, 'orange ring pixels were painted in the overlay window')
    console.log(JSON.stringify({ pressedAt: result.at, overlay: bounds }))
    console.log('Control overlay smoke passed: a real press through the desktop tools draws a painted ring in the real overlay.')
    tools.endRun('overlay-smoke'); overlay.dispose(); code = 0
  } catch (error) { console.error(error) }
  finally {
    await node.stop().catch(() => {})
    try { execFileSync('taskkill', ['/PID', String(fixture.pid), '/T', '/F'], { stdio: 'ignore' }) } catch { /* already closed */ }
    fs.rmSync(root, { recursive: true, force: true })
    app.exit(code)
  }
})
