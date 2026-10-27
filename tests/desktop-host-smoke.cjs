// Real NAJD desktop host (M2d) against a WinForms window this test creates: list, read, type into a normal field,
// refusal of password and card fields inside the host itself, press a button and verify the result by reading
// again, and STALE_TARGET for a changed identity. No user window is touched.
// Usage: node tests/desktop-host-smoke.cjs   (needs the host built: node scripts/build-windows-node.cjs)
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn, execFileSync } = require('node:child_process')
const { randomUUID } = require('node:crypto')
const { createWindowsNode } = require('../electron/windows-node.cjs')
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

const title = 'NAJD Desktop Fixture ' + randomUUID().slice(0, 8)
const form = `
Add-Type -AssemblyName System.Windows.Forms
$form = New-Object System.Windows.Forms.Form; $form.Text = '${title}'; $form.Width = 420; $form.Height = 360
$name = New-Object System.Windows.Forms.TextBox; $name.AccessibleName = 'Full name'; $name.Name = 'fullName'; $name.Top = 10; $name.Left = 10; $name.Width = 300
$secret = New-Object System.Windows.Forms.TextBox; $secret.AccessibleName = 'Secret'; $secret.UseSystemPasswordChar = $true; $secret.Top = 40; $secret.Left = 10
$card = New-Object System.Windows.Forms.TextBox; $card.AccessibleName = 'Card number'; $card.Name = 'cardNumber'; $card.Top = 70; $card.Left = 10
$result = New-Object System.Windows.Forms.Label; $result.Text = 'Waiting'; $result.Top = 140; $result.Left = 10; $result.Width = 380
$button = New-Object System.Windows.Forms.Button; $button.Text = 'Submit'; $button.Top = 100; $button.Left = 10
$button.Add_Click({ $result.Text = 'Submitted: ' + $name.Text })
# Controls that change shortly after being armed, while an action is held before its effect (M2-R13-001).
$save = New-Object System.Windows.Forms.Button; $save.Text = 'Save'; $save.Top = 170; $save.Left = 10
$save.Add_Click({ $result.Text = 'Saved by the old button' })
$armRename = New-Object System.Windows.Forms.Button; $armRename.Text = 'Arm rename'; $armRename.Top = 170; $armRename.Left = 120; $armRename.Width = 100
$renameTimer = New-Object System.Windows.Forms.Timer; $renameTimer.Interval = 2500; $renameTimer.Add_Tick({ $save.Text = 'Delete'; $renameTimer.Stop() })
$armRename.Add_Click({ $renameTimer.Start() })
$notes = New-Object System.Windows.Forms.TextBox; $notes.AccessibleName = 'Notes'; $notes.Name = 'notes'; $notes.Top = 210; $notes.Left = 10
$armSensitive = New-Object System.Windows.Forms.Button; $armSensitive.Text = 'Arm sensitive'; $armSensitive.Top = 210; $armSensitive.Left = 160; $armSensitive.Width = 110
$sensitiveTimer = New-Object System.Windows.Forms.Timer; $sensitiveTimer.Interval = 2500; $sensitiveTimer.Add_Tick({ $notes.AccessibleName = 'Card number'; $sensitiveTimer.Stop() })
$armSensitive.Add_Click({ $sensitiveTimer.Start() })
$armRetitle = New-Object System.Windows.Forms.Button; $armRetitle.Text = 'Arm retitle'; $armRetitle.Top = 250; $armRetitle.Left = 10; $armRetitle.Width = 100
$retitleTimer = New-Object System.Windows.Forms.Timer; $retitleTimer.Interval = 2500; $retitleTimer.Add_Tick({ $form.Text = $form.Text + ' - other document'; $retitleTimer.Stop() })
$armRetitle.Add_Click({ $retitleTimer.Start() })
$form.Controls.AddRange(@($name, $secret, $card, $button, $result, $save, $armRename, $notes, $armSensitive, $armRetitle))
[System.Windows.Forms.Application]::Run($form)`

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'najd-desktop-host-'))
  const fixture = spawn('powershell.exe', ['-NoProfile', '-STA', '-Command', form], { windowsHide: false, stdio: 'ignore' })
  const node = createWindowsNode({ runtimeRoot: path.resolve(__dirname, '../.runtimes'), stateRoot: path.join(root, 'state'), testHooks: true })
  let bank = null, plain = null, longForm = null, wide = null
  try {
    let window
    for (let i = 0; i < 50 && !window; i++) { await sleep(200); window = (await node.invokeHost('najd.desktop.windows', {})).find(item => item.title === title) }
    assert.ok(window, 'fixture window listed')
    const identity = { window: window.window, pid: window.pid, created: window.created }
    const read = async () => (await node.invokeHost('najd.desktop.read', { ...identity, title })).elements
    const elements = await read()
    // A window that no longer shows the approved title is not read (M2-R22-001).
    await assert.rejects(node.invokeHost('najd.desktop.read', { ...identity, title: title + ' - other document' }), { code: 'STALE_TARGET' })
    const find = name => elements.find(item => item.name === name)
    const nameField = find('Full name'), secret = find('Secret'), card = find('Card number'), submit = find('Submit')
    assert.ok(nameField && secret && card && submit, JSON.stringify(elements.map(item => item.name)))
    assert.equal(secret.sensitive, true); assert.equal(card.sensitive, true); assert.equal(nameField.sensitive, false)
    assert.equal(secret.value, null)
    const act = (item, action, text = '') => node.invokeHost('najd.desktop.act', { ...identity, element: item.id, name: item.name, automationId: item.automationId, controlType: item.controlType, key: item.key, title, action, text })
    const typed = await act(nameField, 'setValue', 'NAJD test')
    assert.equal(typed.verified, true)
    // The host itself refuses sensitive fields, even when called directly with the live attributes.
    await assert.rejects(act(card, 'setValue', '4111111111111111'), { code: 'SENSITIVE_FIELD' })
    await assert.rejects(act(secret, 'setValue', 'hunter2'), { code: 'SENSITIVE_FIELD' })
    await act(submit, 'invoke')
    let after
    for (let i = 0; i < 20; i++) { after = (await read()).find(item => item.name === 'Submitted: NAJD test' || item.value === 'Submitted: NAJD test'); if (after) break; await sleep(150) }
    assert.ok(after, 'button result visible after re-reading')
    // A changed identity (wrong creation time) or changed attributes are stale.
    await assert.rejects(node.invokeHost('najd.desktop.act', { ...identity, created: String(BigInt(identity.created) + 1n), element: submit.id, name: submit.name, automationId: submit.automationId, controlType: submit.controlType, key: submit.key, title, action: 'invoke', text: '' }), { code: 'STALE_TARGET' })
    // A window that now shows something else (another title) with the same controls is stale (M2-R9-002).
    await assert.rejects(node.invokeHost('najd.desktop.act', { ...identity, element: submit.id, name: submit.name, automationId: submit.automationId, controlType: submit.controlType, key: submit.key, title: title + ' - other document', action: 'invoke', text: '' }), { code: 'STALE_TARGET' })
    // Typing held just before the effect (test pause) and cancelled meanwhile changes nothing (M2-R12-002).
    const cancelTyping = new AbortController()
    const typing = node.invokeHost('najd.desktop.act', { ...identity, element: nameField.id, name: nameField.name, automationId: nameField.automationId,
      controlType: nameField.controlType, key: nameField.key, title, action: 'setValue', text: 'SHOULD NOT APPEAR', testPauseMs: 2000 }, 20000, { signal: cancelTyping.signal })
    setTimeout(() => cancelTyping.abort(), 400)
    await assert.rejects(typing, error => error.code === 'CANCELLED')
    assert.equal((await read()).find(item => item.name === 'Full name').value, 'NAJD test', 'the cancelled typing did not happen')
    // A control that changes while the action is held before its effect is not acted on (M2-R13-001): a Save button
    // renamed to Delete is stale, and a field that turns into a card-number field is refused.
    const fresh = await read()
    const named = label => fresh.find(item => item.name === label)
    const held = (item, action, text = '') => node.invokeHost('najd.desktop.act', { ...identity, element: item.id, name: item.name, automationId: item.automationId,
      controlType: item.controlType, key: item.key, title, action, text, testPauseMs: 4500 }, 20000)
    await act(named('Arm rename'), 'invoke')
    await assert.rejects(held(named('Save'), 'invoke'), { code: 'STALE_TARGET' })
    assert.ok(!(await read()).some(item => item.name === 'Saved by the old button' || item.value === 'Saved by the old button'), 'the renamed button was not pressed')
    await act(named('Arm sensitive'), 'invoke')
    await assert.rejects(held(named('Notes'), 'setValue', 'should not be typed'), error => ['STALE_TARGET', 'SENSITIVE_FIELD'].includes(error.code))
    assert.ok(!(await read()).some(item => item.value === 'should not be typed'), 'nothing was typed into the changed field')
    // A different full-attribute key (as when text past the shown 200 characters changed) is stale too (M2-R5-005).
    await assert.rejects(node.invokeHost('najd.desktop.act', { ...identity, element: submit.id, name: submit.name, automationId: submit.automationId, controlType: submit.controlType, key: '0'.repeat(64), title, action: 'invoke', text: '' }), { code: 'STALE_TARGET' })
    await assert.rejects(node.invokeHost('najd.desktop.act', { ...identity, element: submit.id, name: 'Something else', automationId: submit.automationId, controlType: submit.controlType, action: 'invoke', text: '' }), { code: 'STALE_TARGET' })
    // Screenshot of the fixture window: a real PNG no larger than 1280 px.
    const png = path.join(root, 'shot.png')
    const shot = await node.invokeHost('najd.screen.capture', { output: png, window: identity.window, pid: identity.pid, created: identity.created, title }, 30000)
    const bytes = fs.readFileSync(png)
    if (process.env.NAJD_KEEP_SHOT) fs.copyFileSync(png, process.env.NAJD_KEEP_SHOT)
    assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a')
    assert.ok(shot.width > 100 && shot.width <= 1280 && shot.height <= 1280)
    await assert.rejects(node.invokeHost('najd.screen.capture', { output: png, window: identity.window, pid: identity.pid, created: String(BigInt(identity.created) + 1n), title }), { code: 'STALE_TARGET' })
    // A window that switches to another document while the capture is held before taking the picture is not
    // captured, and no picture is written (M2-R14-004). This changes the fixture's title, so it runs last for it.
    const latePng = path.join(root, 'late.png')
    await act((await read()).find(item => item.name === 'Arm retitle'), 'invoke')
    await assert.rejects(node.invokeHost('najd.screen.capture', { output: latePng, window: identity.window, pid: identity.pid, created: identity.created, title, testPauseMs: 4500 }, 30000), { code: 'STALE_TARGET' })
    assert.equal(fs.existsSync(latePng), false, 'no picture of the other document was written')
    // A window now showing something else (another title) is not captured under the old approval (M2-R10-001).
    await assert.rejects(node.invokeHost('najd.screen.capture', { output: png, window: identity.window, pid: identity.pid, created: identity.created, title: title + ' - other tab' }), { code: 'STALE_TARGET' })
    // A field with no label of its own in a sign-in window is refused, even when other text sits next to it and the
    // window's title is its parent's name (M2-R2-001).
    const bankTitle = 'NAJD Bank sign in ' + randomUUID().slice(0, 8)
    bank = spawn('powershell.exe', ['-NoProfile', '-STA', '-Command', `
Add-Type -AssemblyName System.Windows.Forms
$form = New-Object System.Windows.Forms.Form; $form.Text = '${bankTitle}'; $form.Width = 360; $form.Height = 200
$hello = New-Object System.Windows.Forms.Label; $hello.Text = 'Welcome back'; $hello.Top = 10; $hello.Left = 10; $hello.TabIndex = 5
$box = New-Object System.Windows.Forms.TextBox; $box.Name = 'textBox1'; $box.Top = 40; $box.Left = 10; $box.TabIndex = 0
$form.Controls.AddRange(@($hello, $box))
[System.Windows.Forms.Application]::Run($form)`], { windowsHide: false, stdio: 'ignore' })
    let bankWindow
    for (let i = 0; i < 50 && !bankWindow; i++) { await sleep(200); bankWindow = (await node.invokeHost('najd.desktop.windows', {})).find(item => item.title === bankTitle) }
    assert.ok(bankWindow, 'sign-in fixture listed')
    const bankIdentity = { window: bankWindow.window, pid: bankWindow.pid, created: bankWindow.created }
    const box = (await node.invokeHost('najd.desktop.read', { ...bankIdentity, title: bankTitle })).elements.find(item => item.role === 'edit')
    assert.ok(box, 'unlabeled field read'); assert.equal(box.sensitive, true, JSON.stringify(box)); assert.equal(box.value, null)
    await assert.rejects(node.invokeHost('najd.desktop.act', { ...bankIdentity, element: box.id, name: box.name, automationId: box.automationId, controlType: box.controlType, key: box.key, title: bankTitle, action: 'setValue', text: 'x' }), { code: 'SENSITIVE_FIELD' })
    // Fields with no accessible name whose automation ids are card_number and account_number, in an ordinary window:
    // their values are hidden and typing into them is refused by the host (M2-R26-003).
    const idsTitle = 'NAJD Plain form ' + randomUUID().slice(0, 8)
    plain = spawn('powershell.exe', ['-NoProfile', '-STA', '-Command', `
Add-Type -AssemblyName System.Windows.Forms
$form = New-Object System.Windows.Forms.Form; $form.Text = '${idsTitle}'; $form.Width = 360; $form.Height = 200
$card = New-Object System.Windows.Forms.TextBox; $card.Name = 'card_number'; $card.Text = '4111111111111111'; $card.Top = 10; $card.Left = 10; $card.TabIndex = 0
$account = New-Object System.Windows.Forms.TextBox; $account.Name = 'account-number'; $account.Text = '0123456789'; $account.Top = 40; $account.Left = 10; $account.TabIndex = 1
$notes = New-Object System.Windows.Forms.TextBox; $notes.Name = 'notes'; $notes.AccessibleName = 'Meeting notes'; $notes.Text = ('n' * 500); $notes.Top = 70; $notes.Left = 10; $notes.TabIndex = 2
$form.Controls.AddRange(@($card, $account, $notes))
[System.Windows.Forms.Application]::Run($form)`], { windowsHide: false, stdio: 'ignore' })
    let plainWindow
    for (let i = 0; i < 50 && !plainWindow; i++) { await sleep(200); plainWindow = (await node.invokeHost('najd.desktop.windows', {})).find(item => item.title === idsTitle) }
    assert.ok(plainWindow, 'plain fixture listed')
    const plainIdentity = { window: plainWindow.window, pid: plainWindow.pid, created: plainWindow.created }
    const plainElements = (await node.invokeHost('najd.desktop.read', { ...plainIdentity, title: idsTitle })).elements
    // A 500-character value is returned cut, and marked as cut by the host (M2-R29-001).
    const notesField = plainElements.find(item => item.automationId === 'notes')
    assert.equal(notesField.valueTruncated, true); assert.equal(notesField.value.length, 300)
    const fields = plainElements.filter(item => item.role === 'edit' && item.automationId !== 'notes')
    assert.equal(fields.length, 2, JSON.stringify(fields))
    for (const field of fields) {
      assert.equal(field.sensitive, true, field.automationId); assert.equal(field.value, null, field.automationId)
      await assert.rejects(node.invokeHost('najd.desktop.act', { ...plainIdentity, element: field.id, name: field.name, automationId: field.automationId, controlType: field.controlType, key: field.key, title: idsTitle, action: 'setValue', text: '1' }), { code: 'SENSITIVE_FIELD' })
    }
    // A long title that changes after its 600th character while an action is held is still a different window
    // (M2-R27-001): the whole title is compared, not a fixed-size prefix.
    const longTitle = 'NAJD long ' + randomUUID().slice(0, 8) + ' ' + 'x'.repeat(650)
    longForm = spawn('powershell.exe', ['-NoProfile', '-STA', '-Command', `
Add-Type -AssemblyName System.Windows.Forms
$form = New-Object System.Windows.Forms.Form; $form.Text = '${longTitle}'; $form.Width = 360; $form.Height = 200
$press = New-Object System.Windows.Forms.Button; $press.Text = 'Press'; $press.Top = 10; $press.Left = 10
$arm = New-Object System.Windows.Forms.Button; $arm.Text = 'Arm suffix'; $arm.Top = 50; $arm.Left = 10; $arm.Width = 100
$timer = New-Object System.Windows.Forms.Timer; $timer.Interval = 2500; $timer.Add_Tick({ $form.Text = $form.Text + ' other'; $timer.Stop() })
$arm.Add_Click({ $timer.Start() })
$form.Controls.AddRange(@($press, $arm))
[System.Windows.Forms.Application]::Run($form)`], { windowsHide: false, stdio: 'ignore' })
    let longWindow
    for (let i = 0; i < 50 && !longWindow; i++) { await sleep(200); longWindow = (await node.invokeHost('najd.desktop.windows', {})).find(item => item.title === longTitle) }
    assert.ok(longWindow, 'the full long title is listed')
    const longIdentity = { window: longWindow.window, pid: longWindow.pid, created: longWindow.created, title: longTitle }
    const longElements = (await node.invokeHost('najd.desktop.read', longIdentity)).elements
    const longAct = (item, extra = {}) => node.invokeHost('najd.desktop.act', { ...longIdentity, element: item.id, name: item.name, automationId: item.automationId, controlType: item.controlType, key: item.key, action: 'invoke', text: '', ...extra }, 20000)
    await longAct(longElements.find(item => item.name === 'Arm suffix'))
    await assert.rejects(longAct(longElements.find(item => item.name === 'Press'), { testPauseMs: 4500 }), { code: 'STALE_TARGET' })
    // A window with more controls than the host reads is reported as incomplete; one it reads whole is complete
    // (M2-R28-002).
    assert.equal((await node.invokeHost('najd.desktop.read', { ...plainIdentity, title: idsTitle })).complete, true)
    const wideTitle = 'NAJD wide ' + randomUUID().slice(0, 8)
    wide = spawn('powershell.exe', ['-NoProfile', '-STA', '-Command', `
Add-Type -AssemblyName System.Windows.Forms
$form = New-Object System.Windows.Forms.Form; $form.Text = '${wideTitle}'; $form.Width = 900; $form.Height = 700; $form.AutoScroll = $true
for ($i = 0; $i -lt 320; $i++) { $b = New-Object System.Windows.Forms.Button; $b.Text = 'Button ' + $i; $b.Top = 10 + [Math]::Floor($i / 8) * 30; $b.Left = 10 + ($i % 8) * 105; $b.Width = 100; $form.Controls.Add($b) }
[System.Windows.Forms.Application]::Run($form)`], { windowsHide: false, stdio: 'ignore' })
    let wideWindow
    for (let i = 0; i < 75 && !wideWindow; i++) { await sleep(200); wideWindow = (await node.invokeHost('najd.desktop.windows', {})).find(item => item.title === wideTitle) }
    assert.ok(wideWindow, 'wide fixture listed')
    const wideRead = await node.invokeHost('najd.desktop.read', { window: wideWindow.window, pid: wideWindow.pid, created: wideWindow.created, title: wideTitle }, 60000)
    assert.equal(wideRead.complete, false, 'more than the host reads'); assert.ok(wideRead.elements.length <= 300)
    console.log('Desktop host smoke passed: list, read, type, sensitive refusal in the host (labelled and unlabeled), press and verify, stale targets, window screenshot.')
  } finally {
    await node.stop().catch(() => {})
    try { execFileSync('taskkill', ['/PID', String(fixture.pid), '/T', '/F'], { stdio: 'ignore' }) } catch {}
    if (bank) try { execFileSync('taskkill', ['/PID', String(bank.pid), '/T', '/F'], { stdio: 'ignore' }) } catch {}
    if (plain) try { execFileSync('taskkill', ['/PID', String(plain.pid), '/T', '/F'], { stdio: 'ignore' }) } catch {}
    if (longForm) try { execFileSync('taskkill', ['/PID', String(longForm.pid), '/T', '/F'], { stdio: 'ignore' }) } catch {}
    if (wide) try { execFileSync('taskkill', ['/PID', String(wide.pid), '/T', '/F'], { stdio: 'ignore' }) } catch {}
    // A file can stay locked briefly by an exiting process or antivirus; leftovers in TEMP are not a test failure.
    try { fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 }) } catch (error) { console.warn('cleanup left', root, error.code) }
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
