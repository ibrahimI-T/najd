// Background mode: closing the window hides NAJD to the system tray instead of quitting, so a running task or connection keeps working.
// The tray icon is the visible proof that NAJD is still running; "Quit completely" in its menu is the real exit.
// The choice is saved (default on) and can be switched from the same menu.
const fs = require('node:fs')
const path = require('node:path')

function createBackgroundMode({ Tray, Menu, nativeImage, iconPath, filePath, showWindow, quit, isQuitting, notify = () => {}, disabled = false }) {
  let keepRunning = true, tray = null, informed = false
  try { const saved = JSON.parse(fs.readFileSync(filePath, 'utf8')); if (saved && saved.keepRunning === false) keepRunning = false; informed = saved?.informed === true } catch {}
  const save = () => { try { fs.mkdirSync(path.dirname(filePath), { recursive: true }); fs.writeFileSync(filePath, JSON.stringify({ keepRunning, informed })) } catch {} }
  const menu = () => Menu.buildFromTemplate([
    { label: 'فتح NAJD / Open NAJD', click: showWindow },
    { type: 'separator' },
    { label: 'البقاء في الخلفية عند إغلاق النافذة / Keep running when the window is closed', type: 'checkbox', checked: keepRunning, click: item => { keepRunning = item.checked; save() } },
    { type: 'separator' },
    { label: 'إنهاء NAJD تمامًا / Quit NAJD completely', click: quit }
  ])
  return {
    // Whether a window close should hide instead of quit. Never while the app is already quitting or when an automated run drives it.
    shouldHide: () => keepRunning && !disabled && !isQuitting(),
    // The first time the window is hidden, say where NAJD went (once per profile).
    hidden() { if (informed) return; informed = true; save(); notify('NAJD', 'ما زال يعمل في الخلفية. الأيقونة بجانب الساعة؛ اختر «إنهاء NAJD تمامًا» لإغلاقه. / Still running in the background. Use the tray icon to quit.') },
    start() {
      if (tray || disabled) return
      tray = new Tray(nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 }))
      tray.setToolTip('NAJD AGENT')
      tray.setContextMenu(menu())
      tray.on('click', showWindow)
    },
    dispose() { try { tray?.destroy() } catch {} tray = null },
    isKeepRunning: () => keepRunning
  }
}
module.exports = { createBackgroundMode }
