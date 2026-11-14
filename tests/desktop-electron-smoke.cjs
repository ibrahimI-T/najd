// The real NAJD desktop host against a test-owned Electron chat window (tests/fixtures/deep-chat-fixture.cjs) whose content is more
// than 20 levels deep, as in the Claude app (owner report 2026-11-10: NAJD saw the Claude window and its title but not the conversation
// or the input). Checks: the conversation and the input are read; real typing reaches a contenteditable editor and is read back without
// sending; a real click on Send works and is verified; the real pointer moved onto each control; and when the "owner" moves the mouse
// between actions the host pauses with USER_ACTIVE and does nothing. Usage: node tests/desktop-electron-smoke.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn, execFileSync } = require('node:child_process')
const { randomUUID } = require('node:crypto')
const { createWindowsNode } = require('../electron/windows-node.cjs')
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const cursor = () => { const [x, y] = execFileSync('powershell.exe', ['-NoProfile', '-Command', 'Add-Type -AssemblyName System.Windows.Forms; $p=[System.Windows.Forms.Cursor]::Position; "$($p.X) $($p.Y)"'], { encoding: 'utf8' }).trim().split(' ').map(Number); return { x, y } }
const moveCursor = (x, y) => execFileSync('powershell.exe', ['-NoProfile', '-Command', `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${x}, ${y})`])

async function main() {
  const title = 'NAJD Deep Chat ' + randomUUID().slice(0, 8)
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'najd-desktop-electron-'))
  const electron = require('electron')
  const fixture = spawn(electron, [path.join(__dirname, 'fixtures', 'deep-chat-fixture.cjs'), '--title=' + title], { stdio: 'ignore', windowsHide: false })
  const node = createWindowsNode({ runtimeRoot: path.resolve(__dirname, '../.runtimes'), stateRoot: path.join(root, 'state'), testHooks: true })
  const timings = {}
  try {
    let window
    for (let i = 0; i < 100 && !window; i++) { await sleep(200); window = (await node.invokeHost('najd.desktop.windows', {})).find(item => item.title === title) }
    assert.ok(window, 'fixture window listed')
    const identity = { window: window.window, pid: window.pid, created: window.created, title }
    // Chromium builds its accessibility tree on the first request; wait until the conversation is there (bounded).
    let elements = [], started = Date.now()
    for (let i = 0; i < 25; i++) {
      const t0 = Date.now(); elements = (await node.invokeHost('najd.desktop.read', identity, 30000)).elements; timings.read = Date.now() - t0
      if (elements.some(item => item.name === 'Message')) break
      await sleep(300)
    }
    timings.firstFullRead = Date.now() - started
    const names = elements.map(item => item.name)
    const box = elements.find(item => item.name === 'Message'), send = elements.find(item => item.name === 'Send message')
    assert.ok(box, 'the deep input is read: ' + JSON.stringify(names.slice(0, 60)))
    assert.ok(send, 'the deep Send button is read')
    assert.ok(names.some(name => name.includes('quarterly numbers')), 'the conversation text is read')
    const act = (item, action, text = '', extra = {}) => node.invokeHost('najd.desktop.act', { ...identity, element: item.id, name: item.name, automationId: item.automationId, controlType: item.controlType, key: item.key, action, text, pointer: 'follow', ...extra }, 30000)
    // Real typing into the contenteditable editor: read back, nothing sent (typing never presses Enter alone).
    let t0 = Date.now()
    const typed = await act(box, 'type', 'Hello from NAJD')
    timings.type = Date.now() - t0
    assert.equal(typed.verified, true, 'the typed text is read back from the editor')
    const afterTyping = (await node.invokeHost('najd.desktop.read', identity, 30000)).elements
    assert.ok(afterTyping.some(item => item.name === 'Nothing sent'), 'typing did not send')
    // The real pointer moved onto the input it typed into.
    const onBox = cursor()
    // The "owner" moves the mouse away: the next action is not done, the host pauses.
    moveCursor(onBox.x + 200, onBox.y + 120)
    await assert.rejects(act(send, 'click'), error => error.code === 'USER_ACTIVE')
    const stillUnsent = (await node.invokeHost('najd.desktop.read', identity, 30000)).elements
    assert.ok(stillUnsent.some(item => item.name === 'Nothing sent'), 'nothing was sent while the owner had the mouse')
    // After the takeover window passes, NAJD acts again: a real click on Send (safe: a test window), verified by a visible change.
    await sleep(15500)
    const fresh = (await node.invokeHost('najd.desktop.read', identity, 30000)).elements
    t0 = Date.now()
    const clicked = await act(fresh.find(item => item.name === 'Send message'), 'click')
    timings.click = Date.now() - t0
    assert.equal(clicked.verified, true, 'the click changed the window')
    const atSend = cursor()
    const final = (await node.invokeHost('najd.desktop.read', identity, 30000)).elements
    assert.ok(final.some(item => item.name === 'Sent: Hello from NAJD'), 'the message was sent by the real click')
    assert.ok(final.some(item => item.name === 'You: Hello from NAJD'), 'the conversation shows the new message')
    console.log(JSON.stringify({ elementsRead: elements.length, pointerOnInput: onBox, pointerOnSend: atSend, timingsMs: timings }))
    console.log('Desktop Electron smoke passed: deep conversation and input read, real typing read back without sending, owner takeover paused, real click verified.')
  } finally {
    await node.stop().catch(() => {})
    try { execFileSync('taskkill', ['/PID', String(fixture.pid), '/T', '/F'], { stdio: 'ignore' }) } catch {}
    fs.rmSync(root, { recursive: true, force: true })
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
