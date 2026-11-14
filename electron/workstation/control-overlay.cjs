// While NAJD works on the desktop, every display shows a glowing frame, a "NAJD CONTROL" badge and the current step. The overlay never
// takes a click (mouse events pass through), never takes focus, and is excluded from screen capture so it never appears in what the
// model sees.
//
// The frame belongs to the agent run, not to each call (owner report 2026-11-09: it lit up and went dark about five times while one
// task opened Chrome, because the model thinks for 3-4 s between calls and the frame hid 2.5 s after each call). It turns on with the
// run's first desktop call and stays on, showing "thinking" between steps, until the run ends (desktop.endRun, called in the runtime's
// finally for completed, failed and cancelled runs alike). A call without a run id still gets the short per-call frame. A run that
// stops calling the desktop for `idle` ms releases the frame, so a run stuck elsewhere never leaves the screen glowing.
const path = require('node:path')

function createControlOverlay({ BrowserWindow, screen, linger = 2500, idle = 10 * 60 * 1000 }) {
  const windows = new Map()
  const runs = new Map() // run id -> idle timer
  let active = 0, timer = null, caption = ''
  function ensure() {
    for (const display of screen.getAllDisplays()) {
      if (windows.has(display.id)) continue
      const { x, y, width, height } = display.bounds
      const win = new BrowserWindow({ x, y, width, height, frame: false, transparent: true, resizable: false, movable: false, focusable: false, skipTaskbar: true, alwaysOnTop: true, hasShadow: false, show: false,
        webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } })
      win.setIgnoreMouseEvents(true)
      win.setAlwaysOnTop(true, 'screen-saver')
      win.setContentProtection(true)
      void win.loadFile(path.join(__dirname, 'control-overlay.html'))
      win.on('closed', () => windows.delete(display.id))
      windows.set(display.id, win)
    }
  }
  const send = () => { for (const win of windows.values()) if (!win.isDestroyed()) win.webContents.executeJavaScript('window.setCaption && window.setCaption(' + JSON.stringify(caption) + ')').catch(() => {}) }
  function show() { ensure(); for (const win of windows.values()) if (!win.isDestroyed() && !win.isVisible()) win.showInactive(); send() }
  function hide() { for (const win of windows.values()) if (!win.isDestroyed()) win.hide() }
  const busy = () => active > 0 || runs.size > 0
  function settle() { clearTimeout(timer); if (!busy()) timer = setTimeout(() => { if (!busy()) hide() }, linger) }
  function touch(runId) {
    clearTimeout(runs.get(runId))
    runs.set(runId, setTimeout(() => { runs.delete(runId); settle() }, idle))
  }
  function caption_(text) { caption = String(text || '').slice(0, 120); try { show() } catch { /* a missing overlay never blocks the work */ } }
  // A ring at a point in physical screen pixels (as the desktop host reports them): converted to the display it is on and drawn there.
  function ring(points) {
    try {
      ensure()
      let drawn = false
      for (const [index, point] of points.entries()) {
        const dip = typeof screen.screenToDipPoint === 'function' ? screen.screenToDipPoint(point) : point
        const display = typeof screen.getDisplayNearestPoint === 'function' ? screen.getDisplayNearestPoint(dip) : screen.getAllDisplays()[0]
        const win = display && windows.get(display.id)
        if (!win || win.isDestroyed()) continue
        if (!win.isVisible()) win.showInactive()
        const draw = () => { if (!win.isDestroyed()) win.webContents.executeJavaScript('window.ring && window.ring(' + Math.round(dip.x - display.bounds.x) + ',' + Math.round(dip.y - display.bounds.y) + ',' + (index > 0) + ')').catch(() => {}) }
        // A page that is still loading has no ring() yet (a cold start): draw as soon as it has loaded instead of silently doing nothing.
        if (typeof win.webContents.isLoading === 'function' && win.webContents.isLoading() && typeof win.webContents.once === 'function') win.webContents.once('did-finish-load', draw)
        else draw()
        drawn = true
      }
      if (drawn) settle()
      return drawn
    } catch { return false } // a missing ring never blocks the work
  }
  return {
    ring,
    // Wraps one desktop call. With a run id the frame stays up after the call until that run ends.
    async around(label, work, runId = null) {
      active++; clearTimeout(timer)
      if (runId) touch(runId)
      caption_(label)
      try { return await work() } finally {
        active--
        if (runId && runs.has(runId) && !active) caption_('thinking…')
        settle()
      }
    },
    end(runId) { if (!runs.has(runId)) return; clearTimeout(runs.get(runId)); runs.delete(runId); settle() },
    runs: () => runs.size,
    dispose() { clearTimeout(timer); for (const id of runs.keys()) clearTimeout(runs.get(id)); runs.clear(); for (const win of windows.values()) if (!win.isDestroyed()) win.destroy(); windows.clear() }
  }
}

// Adds the overlay around the effectful and observing calls of the desktop tools, without changing their results; ending a run ends
// its frame.
// Where an act really happened, from the host's result: one point (click, type, scroll) or two (drag: start, then end).
const finite = value => Number.isFinite(value?.x) && Number.isFinite(value?.y)
function placesOf(result) {
  if (!result || typeof result !== 'object') return []
  if (finite(result.from) && finite(result.to)) return [{ x: result.from.x, y: result.from.y }, { x: result.to.x, y: result.to.y }]
  return finite(result.at) ? [{ x: result.at.x, y: result.at.y }] : []
}
// pointerMode(): with 'off' the owner chose no visible pointer movement, and no ring either.
function withControlOverlay(desktopTools, overlay, { pointerMode = () => 'follow' } = {}) {
  const label = (name, args) => name === 'act' ? `${args?.action || 'act'} · ${args?.element || ''}` : name === 'open' ? `open · ${args?.target || args?.appId || ''}` : name === 'capture' ? 'screenshot' : name === 'read' ? 'reading the window' : 'listing windows'
  const wrapped = { ...desktopTools }
  for (const name of ['windows', 'open', 'read', 'act', 'capture']) if (typeof desktopTools[name] === 'function') wrapped[name] = async (args, ctx) => {
    const result = await overlay.around(label(name, args), () => desktopTools[name](args, ctx), typeof ctx?.runId === 'string' ? ctx.runId : null)
    if (name === 'act') { try { if (pointerMode() !== 'off' && typeof overlay.ring === 'function') overlay.ring(placesOf(result)) } catch { /* decoration only */ } }
    return result
  }
  wrapped.endRun = runKey => { try { overlay.end(runKey) } finally { if (typeof desktopTools.endRun === 'function') return desktopTools.endRun(runKey) } }
  return wrapped
}

module.exports = { createControlOverlay, withControlOverlay }
