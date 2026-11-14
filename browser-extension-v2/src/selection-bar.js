// A small "Ask NAJD" button beside text the owner selects on a page (like the selection toolbar of other assistants). Nothing is read or sent
// until the owner presses it: then the side panel opens with the selected text ready, exactly as the right-click "Ask NAJD" does.
// It stays out of text fields and password fields, and the owner can switch it off in the panel (storage key najdSelectionBar = false).
(() => {
  if (window.top !== window || window.__najdSelectionBar) return
  window.__najdSelectionBar = true
  let host = null, enabled = true
  try { chrome.storage.local.get('najdSelectionBar').then(value => { enabled = value.najdSelectionBar !== false }).catch(() => {}) } catch {}
  try { chrome.storage.onChanged.addListener(changes => { if (changes.najdSelectionBar) { enabled = changes.najdSelectionBar.newValue !== false; if (!enabled) hide() } }) } catch {}
  const label = (() => { try { return chrome.i18n.getMessage('selectionBarAsk') || 'Ask NAJD' } catch { return 'Ask NAJD' } })()
  function hide() { if (host) { host.remove(); host = null } }
  function inField(node) {
    const element = node && (node.nodeType === 1 ? node : node.parentElement)
    return !!element?.closest?.('input, textarea, [contenteditable=""], [contenteditable="true"]')
  }
  function show(rect, text) {
    hide()
    host = document.createElement('najd-selection-bar')
    host.style.cssText = 'all: initial; position: fixed; z-index: 2147483647; top: ' + Math.max(4, rect.top - 40) + 'px; left: ' + Math.max(4, Math.min(innerWidth - 150, rect.left)) + 'px;'
    const root = host.attachShadow({ mode: 'closed' })
    const button = document.createElement('button')
    button.type = 'button'; button.textContent = label; button.setAttribute('data-najd-ask', '')
    button.style.cssText = 'font: 600 13px system-ui, sans-serif; color: #fff; background: #1f6feb; border: 0; border-radius: 8px; padding: 6px 10px; cursor: pointer; box-shadow: 0 4px 14px rgba(0,0,0,.25);'
    button.addEventListener('mousedown', event => event.preventDefault()) // keep the selection
    button.addEventListener('click', () => {
      try { void chrome.runtime.sendMessage({ type: 'najd:selection-ask', text: text.slice(0, 11100) }) } catch {}
      hide()
    })
    root.append(button)
    document.documentElement.append(host)
  }
  document.addEventListener('mouseup', event => {
    if (!enabled || (host && event.composedPath().includes(host))) return
    setTimeout(() => {
      const selection = document.getSelection()
      const text = selection ? String(selection).trim() : ''
      if (!text || text.length < 2 || !selection.rangeCount || inField(selection.anchorNode)) { hide(); return }
      const rect = selection.getRangeAt(0).getBoundingClientRect()
      if (!rect.width && !rect.height) { hide(); return }
      show(rect, text)
    }, 0)
  }, true)
  document.addEventListener('mousedown', event => { if (host && !event.composedPath().includes(host)) hide() }, true)
  document.addEventListener('scroll', hide, true)
  document.addEventListener('keydown', event => { if (event.key === 'Escape') hide() }, true)
})()
