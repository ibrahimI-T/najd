// NAJD AGENT browser extension: links this browser to the NAJD desktop app, runs its commands in NAJD's own tab, and carries questions
// typed in the side panel to the app. The app decides what needs the owner's approval; this worker additionally refuses password and
// payment fields, except through the 'login' command that NAJD sends for an account the owner authorized (see najdLogin).
import { parsePairCode } from './src/protocol.js'
import { run, hasSiteAccess, banner, isAgentTab } from './src/commands.js'
import { call, getLink, getStatus, setStatus, startPairing, connectWithCode, unlink, ask, askStatus, askCancel, askShow, models, skills, session, sessionStop, hello } from './src/link.js'
import { checkSelfUpdate } from './src/self-update.js'

let running = false, executing = false

// ---- link loop: long-poll NAJD for commands ----
async function loop() {
  if (running) return
  running = true
  try {
    while (true) {
      if (!(await getLink())) return
      let response
      try { response = await call('/v2/command/next', { signal: AbortSignal.timeout(35000) }) }
      catch (failure) {
        if (failure?.code === 'REJECTED' || failure?.code === 'NOT_LINKED') return
        await setStatus('offline'); return // the alarm tries again
      }
      await setStatus('connected')
      if (response.status === 200) {
        const command = await response.json()
        executing = true
        let outcome
        try { outcome = await run(command) } finally { executing = false }
        // If the result cannot be delivered (too large, or refused), the command is answered with an explicit error instead of silence.
        const delivered = await call('/v2/command/result', { method: 'POST', body: JSON.stringify({ id: command.id, ...outcome }) }).catch(() => null)
        if (!delivered?.ok) await call('/v2/command/result', { method: 'POST', body: JSON.stringify({ id: command.id, ok: false, error: 'RESULT_NOT_DELIVERED' }) }).catch(() => {})
        // A task is working in this browser: NAJD's tab shows the banner with Cancel (after the result, so it is never part of a page NAJD reads).
        if (command.session === true && outcome.ok && command.kind !== 'park') void banner(true)
      }
    }
  } finally { running = false }
}

chrome.alarms.create('najd-link', { periodInMinutes: 0.5 })
chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === 'najd-link') { void loop(); void updateWhenIdle() } })

// After a NAJD update the newer extension waiting in NAJD's folder is loaded by itself (src/self-update.js), but never while NAJD is
// running a command or a task in this browser, or a question from the panel is still being answered: those wait for the next check.
let lastUpdateCheck = 0
async function updateWhenIdle(force = false) {
  if (!force && Date.now() - lastUpdateCheck < 2 * 60 * 1000) return 'later'
  lastUpdateCheck = Date.now()
  return checkSelfUpdate({ busy: async () => {
    if (executing) return true
    const { najdThread } = await chrome.storage.session.get('najdThread').catch(() => ({}))
    if (Array.isArray(najdThread) && najdThread.some(item => ['queued', 'running', 'waiting_approval'].includes(item?.state))) return true
    try { return (await session()).active === true } catch { return false }
  } })
}

// The toolbar button opens the side panel and, when it is open in that window, closes it.
const panels = new Map() // window id -> the open panel's port
chrome.runtime.onConnect.addListener(port => {
  if (port.name !== 'najd-panel' || port.sender?.id !== chrome.runtime.id || !String(port.sender?.url || '').startsWith(chrome.runtime.getURL('sidepanel.html'))) return
  let windowId = null
  port.onMessage.addListener(message => { if (Number.isInteger(message?.windowId)) { windowId = message.windowId; panels.set(windowId, port) } })
  port.onDisconnect.addListener(() => { if (windowId !== null && panels.get(windowId) === port) panels.delete(windowId) })
})
chrome.action.onClicked.addListener(tab => {
  const open = panels.get(tab.windowId)
  if (open) { try { open.postMessage({ type: 'close' }) } catch { panels.delete(tab.windowId) } return }
  // Called at once (no await before it): opening the panel needs the click itself.
  void chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {})
})

function setup() {
  void chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: false }).catch(() => {})
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'najd-ask-selection', title: chrome.i18n.getMessage('contextAskSelection'), contexts: ['selection'] })
    chrome.contextMenus.create({ id: 'najd-ask-page', title: chrome.i18n.getMessage('contextAskPage'), contexts: ['page'] })
  })
  void loop()
}
chrome.runtime.onInstalled.addListener(setup)
chrome.runtime.onStartup.addListener(setup)

// Right-click > "Ask NAJD": the side panel opens with the selected text (and this page's address and title) ready to send.
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab?.id) return
  void chrome.storage.session.set({ najdPrompt: { text: info.menuItemId === 'najd-ask-selection' ? String(info.selectionText || '').slice(0, 11100) : '', page: { url: info.pageUrl || tab.url || '', title: tab.title || '' }, tabId: tab.id } })
  void chrome.sidePanel.open({ tabId: tab.id }).catch(() => {})
})

const failed = failure => ({ ok: false, error: failure?.code || 'FAILED' })
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return
  // The selection button on a page (src/selection-bar.js): the panel opens with the selected text, like right-click > Ask NAJD.
  if (message?.type === 'najd:selection-ask' && sender.tab?.id) {
    void chrome.storage.session.set({ najdPrompt: { text: String(message.text || '').slice(0, 11100), page: { url: sender.tab.url || '', title: sender.tab.title || '' }, tabId: sender.tab.id } })
    void chrome.sidePanel.open({ tabId: sender.tab.id }).catch(() => {})
    sendResponse({ ok: true }); return
  }
  const reply = work => { void Promise.resolve().then(work).then(value => sendResponse(value), () => sendResponse({ ok: false, error: 'FAILED' })); return true }
  // Cancel on the banner: accepted only from the top frame of NAJD's own tab (the banner's closed shadow root, a real click).
  if (message?.type === 'najd:banner-stop' && sender.tab?.id !== undefined && sender.frameId === 0) {
    return reply(async () => { if (!(await isAgentTab(sender.tab.id))) return { ok: false }; try { await sessionStop() } catch {} await banner(false); return { ok: true } })
  }
  // Everything else comes only from this extension's own pages (the side panel).
  if (!String(sender.url || '').startsWith(chrome.runtime.getURL(''))) return
  switch (message?.type) {
    case 'najd:state': return reply(async () => ({ ok: true, linked: !!(await getLink()), status: await getStatus(), siteAccess: await hasSiteAccess(), version: chrome.runtime.getManifest().version }))
    case 'najd:pair': return reply(async () => { void startPairing().then(state => { if (state === 'connected') void loop() }); return { ok: true } })
    case 'najd:code': return reply(async () => {
      const pair = parsePairCode(message.value)
      if (!pair) return { ok: false, state: 'bad-code' }
      const state = await connectWithCode(pair.port, pair.code)
      if (state === 'connected') void loop()
      return { ok: state === 'connected', state }
    })
    case 'najd:unlink': return reply(async () => { await unlink(); return { ok: true } })
    // Check now for a newer extension in NAJD's folder (the alarm does this every two minutes; tests ask at once).
    case 'najd:check-update': return reply(async () => ({ ok: true, state: await updateWhenIdle(true) }))
    case 'najd:ask': return reply(async () => {
      const text = typeof message.text === 'string' ? message.text.trim() : ''
      if (!text || text.length > 4000) return { ok: false, error: 'INVALID_INPUT' }
      const after = typeof message.after === 'string' && /^[a-f0-9]{24}$/.test(message.after) ? message.after : null
      const model = message.model && typeof message.model.provider === 'string' && typeof message.model.model === 'string' ? { provider: message.model.provider, model: message.model.model } : null
      try { return await ask(text, message.page, { after, model }) } catch (failure) { return failed(failure) }
    })
    case 'najd:ask-status': return reply(async () => { try { return { ok: true, ask: await askStatus(String(message.id || '')) } } catch (failure) { return failed(failure) } })
    case 'najd:ask-cancel': return reply(async () => { try { await askCancel(String(message.id || '')); return { ok: true } } catch (failure) { return failed(failure) } })
    case 'najd:ask-show': return reply(async () => { try { await askShow(String(message.id || '')); return { ok: true } } catch (failure) { return failed(failure) } })
    case 'najd:hello': return reply(async () => { try { return { ok: true, ...(await hello()) } } catch (failure) { return failed(failure) } })
    case 'najd:models': return reply(async () => { try { return { ok: true, models: await models() } } catch (failure) { return failed(failure) } })
    case 'najd:skills': return reply(async () => { try { return { ok: true, skills: await skills() } } catch (failure) { return failed(failure) } })
    case 'najd:session': return reply(async () => { try { return { ok: true, ...(await session()) } } catch (failure) { return failed(failure) } })
    case 'najd:session-stop': return reply(async () => { try { await sessionStop(); await banner(false); return { ok: true } } catch (failure) { return failed(failure) } })
    default: return
  }
})
void loop()
