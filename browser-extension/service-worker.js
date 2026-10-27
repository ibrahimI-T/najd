// NAJD AGENT browser extension: links this browser to the NAJD desktop app, runs its commands in NAJD's own tab, and carries questions
// typed in the side panel to the app. The app decides what needs the owner's approval; this worker additionally refuses password and
// payment fields, except through the 'login' command that NAJD sends for an account the owner authorized (see najdLogin).
import { parsePairCode } from './src/protocol.js'
import { run, hasSiteAccess } from './src/commands.js'
import { call, getLink, getStatus, setStatus, startPairing, connectWithCode, unlink, ask, askStatus, askCancel } from './src/link.js'

let running = false

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
        const outcome = await run(command)
        // If the result cannot be delivered (too large, or refused), the command is answered with an explicit error instead of silence.
        const delivered = await call('/v2/command/result', { method: 'POST', body: JSON.stringify({ id: command.id, ...outcome }) }).catch(() => null)
        if (!delivered?.ok) await call('/v2/command/result', { method: 'POST', body: JSON.stringify({ id: command.id, ok: false, error: 'RESULT_NOT_DELIVERED' }) }).catch(() => {})
      }
    }
  } finally { running = false }
}

chrome.alarms.create('najd-link', { periodInMinutes: 0.5 })
chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === 'najd-link') void loop() })

function setup() {
  void chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: true }).catch(() => {})
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
  void chrome.storage.session.set({ najdPrompt: { text: info.menuItemId === 'najd-ask-selection' ? String(info.selectionText || '').slice(0, 11100) : '', page: { url: info.pageUrl || tab.url || '', title: tab.title || '' } } })
  void chrome.sidePanel.open({ tabId: tab.id }).catch(() => {})
})

// Messages come only from this extension's own pages (the side panel).
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || !String(sender.url || '').startsWith(chrome.runtime.getURL(''))) return
  const reply = work => { void Promise.resolve().then(work).then(value => sendResponse(value), () => sendResponse({ ok: false, error: 'FAILED' })); return true }
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
    case 'najd:ask': return reply(async () => {
      const text = typeof message.text === 'string' ? message.text.trim() : ''
      if (!text || text.length > 4000) return { ok: false, error: 'INVALID_INPUT' }
      try { return await ask(text, message.page) } catch (failure) { return { ok: false, error: failure?.code || 'FAILED' } }
    })
    case 'najd:ask-status': return reply(async () => { try { return { ok: true, ask: await askStatus(String(message.id || '')) } } catch (failure) { return { ok: false, error: failure?.code || 'FAILED' } } })
    case 'najd:ask-cancel': return reply(async () => { try { await askCancel(String(message.id || '')); return { ok: true } } catch (failure) { return { ok: false, error: failure?.code || 'FAILED' } } })
    default: return
  }
})
void loop()
