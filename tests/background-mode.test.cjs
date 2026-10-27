const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const { createBackgroundMode } = require('../electron/background-mode.cjs')

function make(overrides = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'najd-bg-'))
  const calls = { notified: 0, shown: 0, quit: 0, menus: [], tray: null }
  class Tray { constructor(icon) { calls.tray = this; this.icon = icon } setToolTip(text) { this.tip = text } setContextMenu(menu) { this.menu = menu } on(name, fn) { this.click = fn } destroy() { this.destroyed = true } }
  const Menu = { buildFromTemplate: template => { calls.menus.push(template); return template } }
  const nativeImage = { createFromPath: () => ({ resize: () => 'icon' }) }
  const mode = createBackgroundMode({ Tray, Menu, nativeImage, iconPath: 'x', filePath: path.join(dir, 'background.json'), showWindow: () => calls.shown++, quit: () => calls.quit++,
    isQuitting: () => false, notify: () => calls.notified++, ...overrides })
  return { mode, calls, dir, file: path.join(dir, 'background.json') }
}

test('closing hides by default, only the first hide explains where NAJD went', () => {
  const { mode, calls } = make()
  assert.equal(mode.shouldHide(), true)
  mode.hidden(); mode.hidden()
  assert.equal(calls.notified, 1)
})

test('a real quit, an automated run, or the saved off switch closes normally', () => {
  assert.equal(make({ isQuitting: () => true }).mode.shouldHide(), false)
  assert.equal(make({ disabled: true }).mode.shouldHide(), false)
  const off = make()
  off.mode.start()
  off.calls.tray.menu.find(item => item.type === 'checkbox').click({ checked: false })
  assert.equal(off.mode.shouldHide(), false)
  const again = createBackgroundMode({ Tray: class { setToolTip() {} setContextMenu() {} on() {} }, Menu: { buildFromTemplate: x => x }, nativeImage: { createFromPath: () => ({ resize: () => 1 }) }, iconPath: 'x', filePath: off.file, showWindow() {}, quit() {}, isQuitting: () => false })
  assert.equal(again.shouldHide(), false, 'the choice survives a restart')
})

test('the tray opens the window and quits completely', () => {
  const { mode, calls } = make()
  mode.start()
  calls.tray.click()
  assert.equal(calls.shown, 1)
  const quit = calls.tray.menu.find(item => /Quit/.test(item.label))
  quit.click(); assert.equal(calls.quit, 1)
  mode.dispose(); assert.equal(calls.tray, null || calls.tray)
})

test('a corrupt settings file keeps the safe default (stay in the background)', () => {
  const first = make()
  fs.writeFileSync(first.file, '{not json')
  const mode = createBackgroundMode({ Tray: class {}, Menu: {}, nativeImage: {}, iconPath: 'x', filePath: first.file, showWindow() {}, quit() {}, isQuitting: () => false })
  assert.equal(mode.shouldHide(), true)
})
