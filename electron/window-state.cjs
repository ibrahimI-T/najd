// The main window opens as the owner left it: size, place and maximized (owner live test 2026-10-25: it always opened small).
// A saved place that is no longer on any screen (a monitor was removed) falls back to the default size, centred.
const fs = require('node:fs')
const { replaceFileSync } = require('./atomic-file.cjs')
const path = require('node:path')

const DEFAULT = { width: 1280, height: 820 }
const MIN = { width: 760, height: 560 }

function sane(value) {
  if (!value || typeof value !== 'object') return null
  const { x, y, width, height, maximized } = value
  if (![x, y, width, height].every(Number.isSafeInteger) || width < MIN.width || height < MIN.height || width > 20000 || height > 20000) return null
  return { x, y, width, height, maximized: maximized === true }
}

// Bounds to open with: the saved ones when at least 100x60 pixels of the title area fall inside a display's work area.
function restore(saved, workAreas) {
  const state = sane(saved)
  if (!state) return { ...DEFAULT, maximized: false }
  const visible = workAreas.some(area => {
    const left = Math.max(state.x, area.x), right = Math.min(state.x + state.width, area.x + area.width)
    const top = Math.max(state.y, area.y), bottom = Math.min(state.y + 60, area.y + area.height)
    return right - left >= 100 && bottom - top >= 30
  })
  return visible ? state : { ...DEFAULT, maximized: state.maximized }
}

function createWindowState({ filePath }) {
  function read() {
    try { const text = fs.readFileSync(filePath, 'utf8'); return text.length <= 4096 ? JSON.parse(text) : null } catch { return null }
  }
  let timer = null
  function save(window) {
    if (!window || window.isDestroyed() || window.isMinimized()) return
    // The normal (not maximized) bounds are kept, so un-maximizing later returns to them.
    const bounds = window.getNormalBounds()
    const state = sane({ ...bounds, maximized: window.isMaximized() })
    if (!state) return
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true })
      const temporary = filePath + '.tmp'
      fs.writeFileSync(temporary, JSON.stringify(state))
      replaceFileSync(temporary, filePath)
    } catch {}
  }
  return {
    restore: workAreas => restore(read(), workAreas),
    // Saved shortly after the window stops moving or resizing, and once more when it closes.
    track(window) {
      const later = () => { clearTimeout(timer); timer = setTimeout(() => save(window), 500) }
      for (const name of ['resize', 'move', 'maximize', 'unmaximize']) window.on(name, later)
      window.on('close', () => { clearTimeout(timer); save(window) })
    }
  }
}

module.exports = { createWindowState, restore }
