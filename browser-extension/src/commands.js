// Runs one command from NAJD in NAJD's own browser tab (a "NAJD" tab group). Other tabs are never read or controlled.
import { allowedUrl, SITE_ORIGINS, BRIDGE_PORTS, privateIp } from './protocol.js'
import { najdSnapshot, najdAct, najdLogin, najdScroll } from './page-scripts.js'

const pause = ms => new Promise(resolve => setTimeout(resolve, ms))

// The address a page was really loaded from. NAJD never reads a page that the browser fetched from this computer or a private network, whatever the
// name looked like: the address is the one the browser connected to (webRequest reports it), so DNS tricks and redirects change nothing.
// Authorization belongs to ONE navigation: it is withdrawn the moment a main-frame request starts (a hostname that rebinds cannot ride on an earlier, public
// connection) and given only when the response starts, by the address that answered. A navigation that never answers stays unauthorized (fail closed).
// Kept in memory (synchronous, so the order of events is exact) and mirrored in session storage (the service worker may sleep).
const connections = new Map() // tab id -> { origin, ip } | null (withdrawn)
const mainFrame = { urls: ['<all_urls>'], types: ['main_frame'] }
const mirror = (tabId, value) => { void chrome.storage.session.set({ ['conn:' + tabId]: value }) }
chrome.webRequest.onBeforeRequest.addListener(details => {
  if (details.tabId < 0) return
  connections.set(details.tabId, null)
  mirror(details.tabId, null)
}, mainFrame)
function recordConnection(details) {
  if (details.tabId < 0) return
  let origin = ''
  try { origin = new URL(details.url).origin } catch { return }
  const previous = connections.get(details.tabId)
  // A page served from the cache has no address of its own: it keeps the address of the earlier load from the same origin.
  const ip = details.ip || (details.fromCache && previous?.origin === origin ? previous.ip : '')
  const value = { origin, ip }
  connections.set(details.tabId, value)
  mirror(details.tabId, value)
}
chrome.webRequest.onResponseStarted.addListener(recordConnection, mainFrame)
chrome.webRequest.onCompleted.addListener(recordConnection, mainFrame)

async function connectionAllowed(tab) {
  // Tests and development builds can allow this computer (extension-private storage; no web page can write it). The practice page of NAJD is always allowed.
  const { najdAllowLocal, najdPorts } = await chrome.storage.local.get(['najdAllowLocal', 'najdPorts'])
  if (najdAllowLocal === true) return true
  const url = tab.url || ''
  if (url === '' || url === 'about:blank') return true
  const ports = Array.isArray(najdPorts) ? [...BRIDGE_PORTS, ...najdPorts] : BRIDGE_PORTS
  if (ports.some(port => url.startsWith(`http://127.0.0.1:${port}/demo`))) return true
  let origin = ''
  try { origin = new URL(url).origin } catch { return false }
  let record = connections.get(tab.id)
  if (record === undefined) { const key = 'conn:' + tab.id; record = (await chrome.storage.session.get(key))[key] } // the worker slept: read the mirror
  return !!record && record.origin === origin && !!record.ip && !privateIp(record.ip)
}
// Empties the tab when it is somewhere NAJD must not read; the caller reports PAGE_ADDRESS_NOT_ALLOWED.
async function refuseIfPrivate(tab) {
  const current = await chrome.tabs.get(tab.id).catch(() => null)
  if (!current || await connectionAllowed(current)) return false
  await chrome.tabs.update(tab.id, { url: 'about:blank' }).catch(() => {})
  return true
}

export const hasSiteAccess = async () => { try { return await chrome.permissions.contains({ origins: SITE_ORIGINS }) } catch { return false } }

async function agentTab() {
  const { najdTab } = await chrome.storage.session.get('najdTab')
  if (Number.isInteger(najdTab)) { try { return await chrome.tabs.get(najdTab) } catch {} }
  return null
}
async function waitLoad(tabId) {
  for (let i = 0; i < 80; i++) {
    const tab = await chrome.tabs.get(tabId).catch(() => null)
    if (!tab) throw new Error('TAB_CLOSED')
    if (tab.status === 'complete') break
    await pause(250)
  }
  await pause(500)
}
async function openInAgentTab(url) {
  let tab = await agentTab()
  if (!tab) {
    tab = await chrome.tabs.create({ url, active: true })
    await chrome.storage.session.set({ najdTab: tab.id })
    try { const group = await chrome.tabs.group({ tabIds: [tab.id] }); await chrome.tabGroups.update(group, { title: 'NAJD', color: 'yellow' }) } catch {}
  } else tab = await chrome.tabs.update(tab.id, { url, active: true })
  await waitLoad(tab.id)
  return tab
}
async function inject(tabId, func, args) {
  try { const [result] = await chrome.scripting.executeScript({ target: { tabId }, func, args }); return result?.result }
  catch { throw Object.assign(new Error('PAGE_NOT_ACCESSIBLE'), { code: 'PAGE_NOT_ACCESSIBLE' }) }
}
const snapshot = tabId => inject(tabId, najdSnapshot, [150, 12000])

export async function run(command) {
  try {
    const { kind, args = {} } = command
    if (kind !== 'focus' && kind !== 'park' && !(await hasSiteAccess())) return { ok: false, error: 'SITE_ACCESS_NEEDED' }
    // NAJD asks for the tab to be emptied when it ended up somewhere it must not read.
    if (kind === 'park') { const tab = await agentTab(); if (tab) await chrome.tabs.update(tab.id, { url: 'about:blank' }); return { ok: true, result: { parked: true } } }
    if (kind === 'open') {
      if (!allowedUrl(args.url)) return { ok: false, error: 'URL_NOT_ALLOWED' }
      const tab = await openInAgentTab(args.url)
      if (await refuseIfPrivate(tab)) return { ok: false, error: 'PAGE_ADDRESS_NOT_ALLOWED' }
      const page = await snapshot(tab.id)
      return { ok: true, result: null, resultIsPage: true, page }
    }
    const tab = await agentTab()
    if (!tab) return { ok: false, error: 'NO_NAJD_TAB' }
    if (kind !== 'focus' && await refuseIfPrivate(tab)) return { ok: false, error: 'PAGE_ADDRESS_NOT_ALLOWED' }
    if (kind === 'focus') { await chrome.tabs.update(tab.id, { active: true }); await chrome.windows.update(tab.windowId, { focused: true }); return { ok: true, result: { focused: true } } }
    if (kind === 'back') {
      // goBack resolves before the page changes: wait for the address to change, then for loading to finish.
      const before = tab.url
      // The browser's own Back skips entries created without a user gesture (history intervention); the page's
      // history.back() goes to the previous entry as expected.
      await inject(tab.id, () => { history.back(); return true }, []).catch(() => chrome.tabs.goBack(tab.id).catch(() => {}))
      for (let i = 0; i < 20; i++) { const current = await chrome.tabs.get(tab.id).catch(() => null); if (!current || current.url !== before) break; await pause(150) }
      await waitLoad(tab.id)
    } else if (kind === 'login') {
      const outcome = await inject(tab.id, najdLogin, [String(args.host || ''), String(args.userId || ''), String(args.passId || ''), String(args.username || ''), String(args.password || ''), args.submit === true,
        args.expect && typeof args.expect === 'object' ? { doc: String(args.expect.doc || ''), snap: String(args.expect.snap || ''), passLabel: String(args.expect.passLabel || ''), formKey: String(args.expect.formKey || ''), userLabel: String(args.expect.userLabel || '') } : null])
      if (!outcome?.ok) return { ok: false, error: outcome?.error || 'BROWSER_ACTION_FAILED' }
      // A sign-in usually navigates: wait for the address to change (up to ~4 s), then for loading to finish, before looking at the page.
      for (let i = 0; i < 27; i++) { const current = await chrome.tabs.get(tab.id).catch(() => null); if (!current || current.url !== tab.url) break; await pause(150) }
      await pause(500); await waitLoad(tab.id)
    } else if (kind === 'scroll') await inject(tab.id, najdScroll, [args.direction === 'up' ? 'up' : 'down'])
    else if (['click', 'type', 'select'].includes(kind)) {
      const outcome = await inject(tab.id, najdAct, [kind, String(args.id || ''), String(args.text || ''), args.submit === true,
        args.expect && typeof args.expect === 'object' ? { doc: String(args.expect.doc || ''), snap: String(args.expect.snap || ''), role: String(args.expect.role || ''), label: String(args.expect.label || ''), optionIndex: Number.isInteger(args.expect.optionIndex) ? args.expect.optionIndex : null, formKey: String(args.expect.formKey || ''), plain: args.expect.plain === true } : null])
      if (!outcome?.ok) return { ok: false, error: outcome?.error || 'BROWSER_ACTION_FAILED' }
      await pause(700); await waitLoad(tab.id)
    } else if (kind !== 'read') return { ok: false, error: 'INVALID_INPUT' }
    // After the action the tab may have moved (a link, a redirect): the address it ended up on is judged before anything is read.
    if (await refuseIfPrivate(tab)) return { ok: false, error: 'PAGE_ADDRESS_NOT_ALLOWED' }
    const page = await snapshot(tab.id)
    return { ok: true, result: null, resultIsPage: true, page }
  } catch (error) { return { ok: false, error: error?.code || 'BROWSER_ACTION_FAILED' } }
}
