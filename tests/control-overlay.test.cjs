// The control overlay wraps desktop calls without changing their results, stays up while calls overlap and hides after the last one.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createControlOverlay, withControlOverlay } = require('../electron/workstation/control-overlay.cjs')

function fakeElectron() {
  const created = []
  class BrowserWindow {
    constructor(options) { this.options = options; this.visible = false; this.calls = []; this.webContents = { executeJavaScript: async code => { this.calls.push(code) } }; created.push(this) }
    setIgnoreMouseEvents(value) { this.ignore = value } setAlwaysOnTop() {} setContentProtection(value) { this.protected = value } loadFile() { return Promise.resolve() } on() {}
    isDestroyed() { return false } isVisible() { return this.visible } showInactive() { this.visible = true } hide() { this.visible = false } destroy() {}
  }
  return { created, BrowserWindow, screen: { getAllDisplays: () => [{ id: 1, bounds: { x: 0, y: 0, width: 800, height: 600 } }, { id: 2, bounds: { x: 800, y: 0, width: 800, height: 600 } }] } }
}

test('every display gets a click-through, capture-excluded frame while a desktop call runs, and it hides after', async () => {
  const electron = fakeElectron()
  const overlay = createControlOverlay({ ...electron, linger: 10 })
  const tools = withControlOverlay({ act: async args => ({ status: 'done', echo: args.element }), read: async () => ({ elements: [] }) }, overlay)
  const result = await tools.act({ action: 'invoke', element: 'e3' }, {})
  assert.deepEqual(result, { status: 'done', echo: 'e3' })
  assert.equal(electron.created.length, 2)
  for (const win of electron.created) { assert.equal(win.ignore, true); assert.equal(win.protected, true); assert.equal(win.options.focusable, false); assert.equal(win.visible, true) }
  assert.match(electron.created[0].calls.at(-1), /invoke · e3/)
  await new Promise(resolve => setTimeout(resolve, 30))
  assert.equal(electron.created.every(win => !win.visible), true)
})

test('a failing call still releases the frame and the error reaches the caller unchanged', async () => {
  const electron = fakeElectron()
  const overlay = createControlOverlay({ ...electron, linger: 5 })
  const tools = withControlOverlay({ act: async () => { throw Object.assign(new Error('STALE_TARGET'), { code: 'STALE_TARGET' }) } }, overlay)
  await assert.rejects(tools.act({ action: 'invoke', element: 'x' }, {}), { code: 'STALE_TARGET' })
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.equal(electron.created.every(win => !win.visible), true)
})

test('within one run the frame stays up between calls, shows thinking, and goes only when the run ends (owner report 2026-11-09)', async () => {
  const electron = fakeElectron()
  const overlay = createControlOverlay({ ...electron, linger: 10 })
  const ended = []
  const tools = withControlOverlay({ open: async () => ({ status: 'opened' }), act: async () => ({ status: 'done' }), endRun: id => { ended.push(id) } }, overlay)
  await tools.open({ appId: 'chrome' }, { runId: 'desktop-1' })
  // The model thinks for longer than the per-call linger: the frame must not go dark.
  await new Promise(resolve => setTimeout(resolve, 40))
  assert.equal(electron.created.every(win => win.visible), true)
  assert.match(electron.created[0].calls.at(-1), /thinking/)
  await tools.act({ action: 'invoke', element: 'e9' }, { runId: 'desktop-1' })
  assert.equal(electron.created.every(win => win.visible), true)
  tools.endRun('desktop-1')
  assert.deepEqual(ended, ['desktop-1'])
  await new Promise(resolve => setTimeout(resolve, 30))
  assert.equal(electron.created.every(win => !win.visible), true)
  assert.equal(overlay.runs(), 0)
})

test('a run that stops calling the desktop releases the frame after the idle limit', async () => {
  const electron = fakeElectron()
  const overlay = createControlOverlay({ ...electron, linger: 5, idle: 20 })
  const tools = withControlOverlay({ read: async () => ({ elements: [] }) }, overlay)
  await tools.read({}, { runId: 'desktop-2' })
  await new Promise(resolve => setTimeout(resolve, 60))
  assert.equal(electron.created.every(win => !win.visible), true)
})

test('a ring is drawn on the display where an act happened, in that display\'s own coordinates; drag draws start and end', async () => {
  const electron = fakeElectron()
  // Display 2 is at 150% scale: physical pixels (1200, 300) are DIP (800, 200), which is x = 0 on display 2 after its origin 800.
  electron.screen.screenToDipPoint = point => ({ x: Math.round(point.x / 1.5), y: Math.round(point.y / 1.5) })
  electron.screen.getDisplayNearestPoint = point => electron.screen.getAllDisplays().find(display => point.x >= display.bounds.x && point.x < display.bounds.x + display.bounds.width)
  const overlay = createControlOverlay({ ...electron, linger: 10 })
  const tools = withControlOverlay({ act: async () => ({ status: 'done', at: { x: 1200, y: 300 } }) }, overlay)
  await tools.act({ action: 'click', element: 'e1' }, {})
  const ringCalls = win => win.calls.filter(code => code.startsWith('window.ring'))
  assert.deepEqual(ringCalls(electron.created[1]), ['window.ring && window.ring(0,200,false)'])
  assert.deepEqual(ringCalls(electron.created[0]), [])
  const drag = withControlOverlay({ act: async () => ({ status: 'done', from: { x: 300, y: 150 }, to: { x: 600, y: 150 } }) }, overlay)
  await drag.act({ action: 'drag', element: 'e1', text: 'e2' }, {})
  assert.deepEqual(ringCalls(electron.created[0]).slice(-2), ['window.ring && window.ring(200,100,false)', 'window.ring && window.ring(400,100,true)'])
})

test('no ring when the pointer mode is off, when the result has no position, or when the overlay fails; the result is unchanged', async () => {
  const electron = fakeElectron()
  const overlay = createControlOverlay({ ...electron, linger: 10 })
  const result = { status: 'done', at: { x: 10, y: 10 } }
  const off = withControlOverlay({ act: async () => result }, overlay, { pointerMode: () => 'off' })
  assert.deepEqual(await off.act({ action: 'click', element: 'e1' }, {}), result)
  assert.equal(electron.created.some(win => win.calls.some(code => code.startsWith('window.ring'))), false)
  const none = withControlOverlay({ act: async () => ({ status: 'refused', error: 'USER_ACTIVE' }) }, overlay)
  await none.act({ action: 'click', element: 'e1' }, {})
  assert.equal(electron.created.some(win => win.calls.some(code => code.startsWith('window.ring'))), false)
  const broken = withControlOverlay({ act: async () => result }, { ...overlay, ring: () => { throw new Error('boom') } })
  assert.deepEqual(await broken.act({ action: 'click', element: 'e1' }, {}), result)
})
