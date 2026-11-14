// Built-in browser of the right workbench: each tab is a sandboxed WebContentsView in its own session partition, placed by the renderer's
// bounds. Pages get no preload and no Node. No cookies are imported from another profile, and pop-ups become tabs instead of windows.
const MAX_TABS = 12
const { randomUUID } = require('node:crypto')
// Runs in an isolated world. Controls that hold or ask for secrets are marked sensitive: they stay with the owner.
const OBSERVE = "(() => { const secret = /pass|otp|code|cvv|card|pin\\b/i; const out = []; for (const element of document.querySelectorAll('a[href],button,input,textarea,select,[role=button],[role=link]')) { const box = element.getBoundingClientRect(); if (!box.width || !box.height || out.length >= 200) continue; const name = (element.getAttribute('aria-label') || element.innerText || element.placeholder || element.name || '').trim().slice(0, 80); const hidden = element.type === 'password' || secret.test((element.name || '') + (element.id || '') + (element.autocomplete || '')); out.push({ tag: element.tagName.toLowerCase(), type: element.type || null, name, sensitive: hidden }); element.dataset.najdIndex = out.length - 1 } return out })()"
const ACT = (index, kind, text) => '(() => { const element = document.querySelector(\'[data-najd-index="' + Number(index) + '"]\'); if (!element) return { ok: false, code: "ELEMENT_GONE" }; if (element.type === "password") return { ok: false, code: "SENSITIVE" }; ' + (kind === 'click' ? 'element.click()' : 'element.focus(); element.value = ' + JSON.stringify(text) + '; element.dispatchEvent(new Event("input", { bubbles: true })); element.dispatchEvent(new Event("change", { bubbles: true }))') + '; return { ok: true } })()'
const error = code => Object.assign(new Error(code), { code })
const safeUrl = value => {
  const text = String(value || '').trim()
  if (!text) throw error('INVALID_URL')
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(text) ? text : (/^[^\s]+\.[^\s]+$/.test(text) ? 'https://' + text : 'https://duckduckgo.com/?q=' + encodeURIComponent(text))
  const url = new URL(candidate)
  if (!['http:', 'https:'].includes(url.protocol)) throw error('INVALID_URL')
  return url.href
}

function createBrowserTabs({ WebContentsView, session, getWindow, onChange = () => {} }) {
  const tabs = new Map()
  let visibleId = null, bounds = null, nextId = 1
  const view = id => { const tab = tabs.get(id); if (!tab) throw error('TAB_NOT_FOUND'); return tab }
  const info = tab => { const contents = tab.view.webContents; return { id: tab.id, url: contents.getURL(), title: contents.getTitle() || tab.title, favicon: tab.favicon, loading: contents.isLoading(), canGoBack: contents.navigationHistory.canGoBack(), canGoForward: contents.navigationHistory.canGoForward(), error: tab.error } }
  const list = () => [...tabs.values()].map(info)
  const changed = () => { try { onChange(list()) } catch {} }
  function place() {
    const window = getWindow()
    for (const tab of tabs.values()) {
      const show = tab.id === visibleId && !!bounds && !!window
      tab.view.setVisible(show)
      if (show) tab.view.setBounds(bounds)
    }
  }
  function open(address) {
    if (tabs.size >= MAX_TABS) throw error('TOO_MANY_TABS')
    const window = getWindow()
    if (!window) throw error('NO_WINDOW')
    const url = safeUrl(address)
    const id = 'tab-' + nextId++
    const instance = new WebContentsView({ webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, session: session.fromPartition('persist:najd-browser'), spellcheck: false } })
    const tab = { id, view: instance, title: '', favicon: null, error: null }
    tabs.set(id, tab)
    const contents = instance.webContents
    contents.setWindowOpenHandler(({ url: target }) => { try { open(target) } catch {} return { action: 'deny' } })
    contents.on('did-start-navigation', () => { tab.error = null })
    contents.on('did-fail-load', (_event, code, description, _url, mainFrame) => { if (mainFrame && code !== -3) { tab.error = description; changed() } })
    for (const name of ['page-title-updated', 'did-navigate', 'did-navigate-in-page', 'did-stop-loading', 'did-start-loading']) contents.on(name, changed)
    contents.on('page-favicon-updated', (_event, icons) => { tab.favicon = typeof icons[0] === 'string' && /^https?:/.test(icons[0]) ? icons[0].slice(0, 500) : null; changed() })
    window.contentView.addChildView(instance)
    visibleId = id
    place()
    void contents.loadURL(url).catch(() => {})
    changed()
    return info(tab)
  }
  function close(id) {
    const tab = view(id)
    tabs.delete(id)
    getWindow()?.contentView.removeChildView(tab.view)
    tab.view.webContents.close()
    if (visibleId === id) visibleId = null
    place(); changed()
    return list()
  }
  return {
    list, open, close,
    navigate: (id, address) => { const tab = view(id); void tab.view.webContents.loadURL(safeUrl(address)).catch(() => {}); return info(tab) },
    back: id => { view(id).view.webContents.navigationHistory.goBack(); return info(view(id)) },
    forward: id => { view(id).view.webContents.navigationHistory.goForward(); return info(view(id)) },
    reload: id => { view(id).view.webContents.reload(); return info(view(id)) },
    // id null hides every page, for example while a menu or another tab covers the panel.
    show: (id, area) => {
      visibleId = id && tabs.has(id) ? id : null
      bounds = area && [area.x, area.y, area.width, area.height].every(Number.isFinite) && area.width > 0 && area.height > 0 ? { x: Math.round(area.x), y: Math.round(area.y), width: Math.round(area.width), height: Math.round(area.height) } : null
      place()
    },
    // Observation for the owner's view and the agent: bounded visible text, read in an isolated world.
    read: async id => {
      const contents = view(id).view.webContents
      const text = await contents.executeJavaScriptInIsolatedWorld(999, [{ code: 'document.body ? document.body.innerText.slice(0, 40000) : ""' }])
      return { ...info(view(id)), text: String(text || '') }
    },
    // A fresh observation: its id binds a later action to this page state. A navigation or a newer observation makes it stale.
    observe: async id => {
      const tab = view(id), elements = await tab.view.webContents.executeJavaScriptInIsolatedWorld(999, [{ code: OBSERVE }])
      tab.observation = { id: randomUUID(), url: tab.view.webContents.getURL(), elements }
      return { observation: tab.observation.id, url: tab.observation.url, title: tab.view.webContents.getTitle(), elements: elements.map((element, index) => ({ index, ...element })) }
    },
    target: (id, observation, index) => {
      const tab = view(id), seen = tab.observation
      if (!seen || seen.id !== observation || seen.url !== tab.view.webContents.getURL()) throw error('STALE_OBSERVATION')
      const element = seen.elements[index]
      if (!element) throw error('ELEMENT_NOT_FOUND')
      if (element.sensitive) throw error('SENSITIVE_TARGET')
      return { url: seen.url, element }
    },
    act: async (id, index, kind, text) => {
      const tab = view(id), result = await tab.view.webContents.executeJavaScriptInIsolatedWorld(999, [{ code: ACT(index, kind, text) }])
      tab.observation = null // one effect per observation; the next step observes again
      return result
    },
    // WebMCP: only tools the visible page itself declares; never invented.
    webmcp: async id => {
      const contents = view(id).view.webContents
      const tools = await contents.executeJavaScript('(() => { try { const list = navigator.modelContext?.tools || []; return Array.from(list).slice(0, 100).map(tool => ({ name: String(tool.name).slice(0, 80), description: String(tool.description || "").slice(0, 500) })) } catch { return [] } })()', false)
      return Array.isArray(tools) ? tools : []
    },
    dispose: () => { for (const id of [...tabs.keys()]) close(id) }
  }
}

module.exports = { createBrowserTabs, safeUrl }
