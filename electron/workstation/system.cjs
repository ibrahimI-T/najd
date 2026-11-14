// Startup, quick summon, finish notifications and the desktop pet. All off until the owner turns them on in Settings.
const fs = require('node:fs/promises')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { replaceFile } = require('../atomic-file.cjs')
const ACCELERATOR = /^(Control|Alt|Shift|Super)(\+(Control|Alt|Shift|Super))*\+[A-Z0-9]$/
// pointerMode: how the real mouse pointer shows NAJD's desktop actions ('follow' glides, 'fast' jumps, 'off' only for real clicks).
// stopShortcut: the emergency stop for every running task (2026-11-10).
const POINTER_MODES = ['follow', 'fast', 'off']
const STOP_ACCELERATOR = 'Control+Alt+Q'
const defaults = { quickSummon: false, accelerator: 'Control+Alt+N', notifyFinished: true, pet: false, pointerMode: 'follow' }

function createSystem({ electron, app, directory, mainWindow, iconPath, onEmergencyStop = null }) {
  const { BrowserWindow, globalShortcut, Notification } = electron
  const filename = path.join(directory, 'system.json')
  let pet = null, registered = null, stopRegistered = false
  // The emergency stop is always on while NAJD runs: Ctrl+Alt+Q cancels every running task at once.
  function applyStop() {
    if (stopRegistered || typeof onEmergencyStop !== 'function') return
    try { stopRegistered = globalShortcut.register(STOP_ACCELERATOR, () => { try { onEmergencyStop() } catch {} }) } catch { stopRegistered = false }
  }
  async function load() {
    try { const value = JSON.parse(await fs.readFile(filename, 'utf8')); return { ...defaults, ...value } } catch { return { ...defaults } }
  }
  async function save(state) {
    await fs.mkdir(directory, { recursive: true })
    const temporary = filename + '.' + randomUUID() + '.tmp'
    await fs.writeFile(temporary, JSON.stringify(state) + '\n', { flag: 'wx' })
    await replaceFile(temporary, filename)
  }
  const show = () => { const window = mainWindow(); if (window) { if (window.isMinimized()) window.restore(); window.show(); window.focus() } }
  function applyShortcut(state) {
    if (registered) { globalShortcut.unregister(registered); registered = null }
    if (state.quickSummon && ACCELERATOR.test(state.accelerator) && globalShortcut.register(state.accelerator, show)) registered = state.accelerator
    return !state.quickSummon || !!registered
  }
  function applyPet(state) {
    if (!state.pet) { if (pet && !pet.isDestroyed()) pet.close(); pet = null; return }
    if (pet && !pet.isDestroyed()) return
    pet = new BrowserWindow({ width: 96, height: 96, frame: false, transparent: true, resizable: false, alwaysOnTop: true, skipTaskbar: true, hasShadow: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } })
    void pet.loadFile(path.join(__dirname, 'pet.html'), { query: { icon: 'file://' + iconPath.replace(/\\/g, '/') } })
    // The sandboxed page has no bridge: a double click only changes its title, which main reads.
    pet.webContents.on('page-title-updated', (_event, title) => { if (title.startsWith('open')) show() })
    pet.on('closed', () => { pet = null })
  }
  async function status() {
    const state = await load()
    return { ...state, launchAtLogin: app.getLoginItemSettings().openAtLogin, packaged: app.isPackaged, shortcutActive: !!registered, stopShortcut: stopRegistered ? STOP_ACCELERATOR : null }
  }
  return {
    status,
    start: async () => { const state = await load(); applyShortcut(state); applyPet(state); applyStop() },
    pointerMode: async () => { const state = await load(); return POINTER_MODES.includes(state.pointerMode) ? state.pointerMode : 'follow' },
    stop: () => { if (registered) globalShortcut.unregister(registered); if (stopRegistered) { globalShortcut.unregister(STOP_ACCELERATOR); stopRegistered = false } if (pet && !pet.isDestroyed()) pet.destroy() },
    set: async patch => {
      const state = await load()
      for (const key of ['quickSummon', 'notifyFinished', 'pet']) if (typeof patch?.[key] === 'boolean') state[key] = patch[key]
      if (typeof patch?.accelerator === 'string' && ACCELERATOR.test(patch.accelerator)) state.accelerator = patch.accelerator
      if (POINTER_MODES.includes(patch?.pointerMode)) state.pointerMode = patch.pointerMode
      if (typeof patch?.launchAtLogin === 'boolean' && app.isPackaged) app.setLoginItemSettings({ openAtLogin: patch.launchAtLogin })
      await save(state); applyShortcut(state); applyPet(state)
      return status()
    },
    notify: async (title, body) => { const state = await load(); if (state.notifyFinished && Notification.isSupported()) { const item = new Notification({ title: String(title).slice(0, 80), body: String(body).slice(0, 200) }); item.on('click', show); item.show() } }
  }
}
module.exports = { createSystem }
