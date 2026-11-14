// The visual route on the real NAJD desktop host (2026-11-10): typing and clicking at points of a test-owned WinForms window, given as
// thousandths of the window as the model's screenshot coordinates become, with the real pointer moving there. The result is checked by
// reading the window; a point covered by nothing but this window is required. Usage: node tests/desktop-point-smoke.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const { spawn, execFileSync } = require('node:child_process')
const { randomUUID } = require('node:crypto')
const { createWindowsNode } = require('../electron/windows-node.cjs')
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

const title = 'NAJD Point Fixture ' + randomUUID().slice(0, 8)
const form = `
Add-Type -AssemblyName System.Windows.Forms
$form = New-Object System.Windows.Forms.Form; $form.Text = '${title}'; $form.StartPosition = 'Manual'; $form.Left = 120; $form.Top = 120; $form.Width = 420; $form.Height = 260; $form.TopMost = $true
$box = New-Object System.Windows.Forms.TextBox; $box.Name = 'box'; $box.Left = 20; $box.Top = 20; $box.Width = 300
$button = New-Object System.Windows.Forms.Button; $button.Text = 'Go'; $button.Left = 20; $button.Top = 70; $button.Width = 120; $button.Height = 40
$result = New-Object System.Windows.Forms.Label; $result.Text = 'Waiting'; $result.Left = 20; $result.Top = 130; $result.Width = 360
$button.Add_Click({ $result.Text = 'Clicked: ' + $box.Text })
$list = New-Object System.Windows.Forms.ListBox; $list.AccessibleName = 'Items'; $list.Left = 250; $list.Top = 60; $list.Width = 140; $list.Height = 60; 1..200 | ForEach-Object { [void]$list.Items.Add('Row ' + $_) }
$pad = New-Object System.Windows.Forms.Panel; $pad.Left = 20; $pad.Top = 160; $pad.Width = 360; $pad.Height = 40; $pad.BackColor = 'LightGray'; $script:downX = -1
$pad.Add_MouseDown({ $script:downX = $_.X }); $pad.Add_MouseUp({ if ($script:downX -ge 0 -and [Math]::Abs($_.X - $script:downX) -gt 40) { $result.Text = 'Dragged' } })
$drop = New-Object System.Windows.Forms.TextBox; $drop.AccessibleName = 'Drop target'; $drop.Left = 150; $drop.Top = 78; $drop.Width = 90
$button.Add_MouseUp({ if ($drop.ClientRectangle.Contains($drop.PointToClient([System.Windows.Forms.Cursor]::Position))) { $result.Text = 'Dropped on target' } })
$form.Controls.AddRange(@($box, $button, $result, $list, $pad, $drop))
[System.Windows.Forms.Application]::Run($form)`

// The window rectangle and its client origin in screen pixels, and its DPI scale, from Win32: the controls' centres follow from the
// form's own layout (client coordinates times the scale).
const geometry = handle => JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-Command', `
Add-Type @'
using System; using System.Runtime.InteropServices;
public static class G { [StructLayout(LayoutKind.Sequential)] public struct R { public int L, T, Ri, B; } [StructLayout(LayoutKind.Sequential)] public struct P { public int X, Y; }
 [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out R r); [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr h, ref P p);
 [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr h); [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr c); }
'@
[void][G]::SetThreadDpiAwarenessContext([IntPtr]-4)
$h = [IntPtr]${handle}; $r = New-Object G+R; [void][G]::GetWindowRect($h, [ref]$r); $p = New-Object G+P; [void][G]::ClientToScreen($h, [ref]$p)
@{ w = @($r.L, $r.T, ($r.Ri - $r.L), ($r.B - $r.T)); client = @($p.X, $p.Y); scale = ([G]::GetDpiForWindow($h) / 96.0) } | ConvertTo-Json -Compress`], { encoding: 'utf8' }))
// A control centre (client coordinates of the form layout, in 96-DPI units) as thousandths of the window.
const thousandths = (g, cx, cy) => ({ x: Math.round((g.client[0] + cx * g.scale - g.w[0]) / g.w[2] * 1000), y: Math.round((g.client[1] + cy * g.scale - g.w[1]) / g.w[3] * 1000) })

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'najd-desktop-point-'))
  const fixture = spawn('powershell.exe', ['-NoProfile', '-STA', '-Command', form], { windowsHide: false, stdio: 'ignore' })
  const node = createWindowsNode({ runtimeRoot: path.resolve(__dirname, '../.runtimes'), stateRoot: path.join(root, 'state'), testHooks: true })
  try {
    let window
    for (let i = 0; i < 50 && !window; i++) { await sleep(200); window = (await node.invokeHost('najd.desktop.windows', {})).find(item => item.title === title) }
    assert.ok(window, 'fixture listed')
    await sleep(500)
    const identity = { window: window.window, pid: window.pid, created: window.created, title }
    const g = geometry(window.window)
    const typed = await node.invokeHost('najd.desktop.act', { ...identity, point: thousandths(g, 20 + 150, 20 + 10), action: 'type', text: 'Point typed', pointer: 'follow' }, 30000)
    assert.equal(typed.verified, true, 'typing at the point is read back: ' + JSON.stringify(typed))
    await sleep(15500) // past the owner-takeover window, in case the test machine's pointer moved meanwhile
    const clicked = await node.invokeHost('najd.desktop.act', { ...identity, point: thousandths(g, 20 + 60, 70 + 20), action: 'click', text: '', pointer: 'follow' }, 30000)
    assert.equal(clicked.verified, true, 'the click at the point changed the window: ' + JSON.stringify(clicked))
    const elements = (await node.invokeHost('najd.desktop.read', identity, 30000)).elements
    assert.ok(elements.some(item => item.name === 'Clicked: Point typed'), 'the button saw the typed text: ' + JSON.stringify(elements.map(item => item.name)))
    // Scroll (2026-11-10): the real wheel over the list, confirmed by the list's own scroll position.
    const list = elements.find(item => item.name === 'Items' && item.role === 'list') || elements.find(item => item.name === 'Items')
    assert.ok(list, 'the list is read: ' + JSON.stringify(elements.map(item => item.role + ':' + item.name).slice(0, 12)))
    const scrolled = await node.invokeHost('najd.desktop.act', { ...identity, element: list.id, name: list.name, automationId: list.automationId, controlType: list.controlType, key: list.key, action: 'scroll', text: 'down 5', pointer: 'fast' }, 30000)
    assert.equal(scrolled.verified, true, 'the wheel moved the list: ' + JSON.stringify(scrolled))
    assert.ok(Number.isFinite(scrolled.at?.x), 'a scroll reports its position')
    // Drag (2026-11-13): press on the pad, glide 200 px, release; the form reports it.
    const dragged = await node.invokeHost('najd.desktop.act', { ...identity, point: thousandths(g, 20 + 60, 160 + 20), to: thousandths(g, 20 + 260, 160 + 20), action: 'drag', text: '', pointer: 'fast' }, 30000)
    assert.equal(dragged.verified, true, 'the drag changed the window: ' + JSON.stringify(dragged))
    assert.ok((await node.invokeHost('najd.desktop.read', identity, 30000)).elements.some(item => item.name === 'Dragged'), 'the pad saw a drag')
    // Drag between two read controls (2026-11-13): the Go button onto the "Drop target" field, by their element identities.
    const fresh = (await node.invokeHost('najd.desktop.read', identity, 30000)).elements
    const go = fresh.find(item => item.name === 'Go'), target = fresh.find(item => item.name === 'Drop target')
    assert.ok(go && target, 'both controls are read: ' + JSON.stringify(fresh.map(item => item.role + ':' + item.name)))
    const part = item => ({ element: item.id, name: item.name, automationId: item.automationId, controlType: item.controlType, key: item.key })
    const between = await node.invokeHost('najd.desktop.act', { ...identity, ...part(go), to: part(target), action: 'drag', text: '', pointer: 'fast' }, 30000)
    assert.equal(between.verified, true, 'the element drag changed the window: ' + JSON.stringify(between))
    assert.ok((await node.invokeHost('najd.desktop.read', identity, 30000)).elements.some(item => item.name === 'Dropped on target'), 'the button was released over the target')
    // The destination is checked as the source is: a changed identity is refused and nothing is dragged.
    await assert.rejects(node.invokeHost('najd.desktop.act', { ...identity, ...part(go), to: { ...part(target), name: 'Something else' }, action: 'drag', text: '', pointer: 'fast' }, 30000), { code: 'STALE_TARGET' })
    await assert.rejects(node.invokeHost('najd.desktop.act', { ...identity, ...part(go), to: part(go), action: 'drag', text: '', pointer: 'fast' }, 30000), { code: 'INVALID_INPUT' })
    console.log(JSON.stringify({ typedAt: typed.at, clickedAt: clicked.at }))
    console.log('Desktop point smoke passed: type and click at window points (visual route) with the real pointer, verified by reading; wheel scroll and drag confirmed.')
  } finally {
    await node.stop().catch(() => {})
    try { execFileSync('taskkill', ['/PID', String(fixture.pid), '/T', '/F'], { stdio: 'ignore' }) } catch {}
    fs.rmSync(root, { recursive: true, force: true })
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
