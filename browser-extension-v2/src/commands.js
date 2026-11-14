// NAJD Browser 2.0: runs NAJD's commands through the Chrome DevTools Protocol (chrome.debugger). Pages are observed from the accessibility
// tree; clicks and typing are real input events at the element's position. Tabs are either owned (NAJD opened them, grouped as "NAJD")
// or attached (the owner's tab, chosen by its exact address with approval in NAJD): attached tabs are never navigated away or closed.
import { allowedUrl, SITE_ORIGINS, BRIDGE_PORTS, privateIp, matchTabs } from './protocol.js'
import { najdBanner, najdLogin } from './page-scripts.js'
import { axToElements, checkTarget, canNavigate, keyEvents } from './observe.js'
import { FORM_INFO } from './form-info.js'

const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
const fail = code => Object.assign(new Error(code), { code })

// ---- where pages really came from (same rule as 1.x: no local or private network pages) ----
const connections = new Map()
function recordConnection(details) { if (details.frameId !== 0 || details.tabId < 0) return; let origin = ''; try { origin = new URL(details.url).origin } catch {} const record = { origin, ip: details.ip || '' }; connections.set(details.tabId, record); void chrome.storage.session.set({ ['conn:' + details.tabId]: record }).catch(() => {}) }
const mainFrame = { urls: ['<all_urls>'], types: ['main_frame'] }
chrome.webRequest.onResponseStarted.addListener(recordConnection, mainFrame)
chrome.webRequest.onCompleted.addListener(recordConnection, mainFrame)
async function connectionAllowed(tab) {
  const { najdAllowLocal, najdPorts } = await chrome.storage.local.get(['najdAllowLocal', 'najdPorts'])
  if (najdAllowLocal === true) return true
  const url = tab.url || ''
  if (url === '' || url === 'about:blank') return true
  const ports = Array.isArray(najdPorts) ? [...BRIDGE_PORTS, ...najdPorts] : BRIDGE_PORTS
  if (ports.some(port => url.startsWith(`http://127.0.0.1:${port}/demo`))) return true
  let origin = ''
  try { origin = new URL(url).origin } catch { return false }
  let record = connections.get(tab.id)
  if (record === undefined) { const key = 'conn:' + tab.id; record = (await chrome.storage.session.get(key))[key] }
  return !!record && record.origin === origin && !!record.ip && !privateIp(record.ip)
}
export const hasSiteAccess = async () => { try { return await chrome.permissions.contains({ origins: SITE_ORIGINS }) } catch { return false } }

// ---- tab sessions, kept across service-worker sleep ----
async function tabs() { return (await chrome.storage.session.get('najdTabs')).najdTabs || { current: null, owned: [], attached: [] } }
async function saveTabs(value) { await chrome.storage.session.set({ najdTabs: value }) }
async function current() {
  const state = await tabs()
  if (!Number.isInteger(state.current)) return null
  const tab = await chrome.tabs.get(state.current).catch(() => null)
  if (!tab) { await saveTabs({ ...state, current: null }); return null }
  return { tab, ownership: state.owned.includes(tab.id) ? 'owned' : 'attached' }
}
chrome.tabs.onRemoved.addListener(id => { void tabs().then(state => saveTabs({ current: state.current === id ? null : state.current, owned: state.owned.filter(item => item !== id), attached: state.attached.filter(item => item !== id) })) })

// ---- the debugger, attached on demand and again after sleep ----
const attached = new Set()
chrome.debugger.onDetach.addListener(source => { attached.delete(source.tabId) })
async function cdp(tabId, method, params = {}) {
  if (!attached.has(tabId)) {
    try { await chrome.debugger.attach({ tabId }, '1.3') } catch (error) { if (!/already attached/i.test(String(error?.message))) throw fail('DEBUGGER_REFUSED') }
    attached.add(tabId)
  }
  return chrome.debugger.sendCommand({ tabId }, method, params)
}
async function waitLoad(tabId) {
  for (let i = 0; i < 80; i++) { const tab = await chrome.tabs.get(tabId).catch(() => null); if (!tab) throw fail('TAB_CLOSED'); if (tab.status === 'complete') break; await pause(250) }
  await pause(400)
}

// ---- observation ----
const observations = new Map() // tabId -> { doc, snap, url, elements }
let snapCounter = 0
async function observe(tabId) {
  const tab = await chrome.tabs.get(tabId)
  await cdp(tabId, 'DOM.enable')
  await cdp(tabId, 'Accessibility.enable')
  const { nodes } = await cdp(tabId, 'Accessibility.getFullAXTree')
  const wanted = new Set(nodes.filter(node => !node.ignored && Number.isInteger(node.backendDOMNodeId) && ['link', 'textbox', 'searchbox', 'combobox'].includes(node.role?.value)).slice(0, 220).map(node => node.backendDOMNodeId))
  const attributes = new Map()
  for (const backendNodeId of wanted) {
    try { const { node } = await cdp(tabId, 'DOM.describeNode', { backendNodeId }); const list = node.attributes || [], row = {}; for (let i = 0; i < list.length; i += 2) row[list[i]] = list[i + 1]; attributes.set(backendNodeId, row) } catch {}
  }
  const elements = axToElements(nodes, id => attributes.get(id))
  // Absolute addresses for links (the attribute can be relative).
  for (const item of elements) if (item.role === 'link' && !item.href) { const raw = attributes.get(item.ref)?.href; if (raw) { try { const url = new URL(raw, tab.url); if (/^https?:$/.test(url.protocol)) item.href = url.href.slice(0, 500) } catch {} } }
  const { result } = await cdp(tabId, 'Runtime.evaluate', { expression: '(document.body ? document.body.innerText : "").replace(/\\n{3,}/g, "\\n\\n").slice(0, 100000)', returnByValue: true })
  // The document's identity: a new id whenever the page's root node or address changes (a navigation), kept while it stays the same.
  const { root } = await cdp(tabId, 'DOM.getDocument', { depth: 0 })
  const key = root.backendNodeId + '|' + tab.url
  const previous = observations.get(tabId)
  const doc = previous && previous.key === key ? previous.doc : [...crypto.getRandomValues(new Uint8Array(8))].map(byte => byte.toString(36).padStart(2, '0')).join('').slice(0, 12)
  for (const item of elements) if (item.href) item.target = item.href
  for (const item of elements) if (['field', 'button', 'select'].includes(item.role)) Object.assign(item, await formInfo(tabId, item.ref).catch(() => ({})))
  const observation = { key, doc, snap: ++snapCounter, url: tab.url, elements }
  observations.set(tabId, observation)
  return { doc: observation.doc, snap: observation.snap, url: (tab.url || '').slice(0, 500), title: (tab.title || '').slice(0, 200), text: String(result?.value || ''), elements: elements.map(({ ref, ...rest }) => rest), lang: '' }
}

async function formInfo(tabId, backendNodeId) {
  const { object } = await cdp(tabId, 'DOM.resolveNode', { backendNodeId })
  const { result } = await cdp(tabId, 'Runtime.callFunctionOn', { objectId: object.objectId, functionDeclaration: FORM_INFO, returnByValue: true })
  const info = result?.value || {}
  return Object.fromEntries(Object.entries(info).filter(([key, value]) => key !== 'submits' || value === true))
}

// ---- actions at the element, by real input ----
async function center(tabId, backendNodeId) {
  await cdp(tabId, 'DOM.scrollIntoViewIfNeeded', { backendNodeId }).catch(() => {})
  const { model } = await cdp(tabId, 'DOM.getBoxModel', { backendNodeId })
  const q = model.content
  return { x: (q[0] + q[2] + q[4] + q[6]) / 4, y: (q[1] + q[3] + q[5] + q[7]) / 4 }
}
// The point is checked just before pressing: the element must be what is under it. Coordinates taken while the page is still moving (the browser's
// "started debugging" bar slides in at the top on the first action and pushes the page down) made a press land above a link, so nothing happened
// and the model pressed again (owner's Outlook sign-in, 2026-11-14). The point is measured again until it holds; if it never does, the element is
// clicked directly.
async function click(tabId, backendNodeId) {
  const { object } = await cdp(tabId, 'DOM.resolveNode', { backendNodeId })
  for (let attempt = 0; attempt < 6; attempt++) {
    const { x, y } = await center(tabId, backendNodeId)
    const { result } = await cdp(tabId, 'Runtime.callFunctionOn', { objectId: object.objectId, returnByValue: true, arguments: [{ value: x }, { value: y }],
      functionDeclaration: 'function (x, y) { const hit = document.elementFromPoint(x, y); return !!hit && (hit === this || this.contains(hit) || hit.contains(this)) }' })
    if (result?.value === true) {
      for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await cdp(tabId, 'Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: type === 'mouseMoved' ? 0 : 1 })
      return
    }
    await pause(200)
  }
  await cdp(tabId, 'Runtime.callFunctionOn', { objectId: object.objectId, functionDeclaration: 'function () { this.click() }' })
}
async function type(tabId, backendNodeId, text, submit) {
  await cdp(tabId, 'DOM.focus', { backendNodeId })
  const { object } = await cdp(tabId, 'DOM.resolveNode', { backendNodeId })
  await cdp(tabId, 'Runtime.callFunctionOn', { objectId: object.objectId, functionDeclaration: 'function () { if ("value" in this) { this.value = ""; this.dispatchEvent(new Event("input", { bubbles: true })) } else if (this.isContentEditable) this.textContent = "" }' })
  await cdp(tabId, 'Input.insertText', { text })
  if (submit) for (const event of keyEvents('Enter')) await cdp(tabId, 'Input.dispatchKeyEvent', event)
}
async function select(tabId, backendNodeId, option) {
  const { object } = await cdp(tabId, 'DOM.resolveNode', { backendNodeId })
  const { result } = await cdp(tabId, 'Runtime.callFunctionOn', { objectId: object.objectId, returnByValue: true, arguments: [{ value: option }],
    functionDeclaration: 'function (wanted) { if (this.localName !== "select") return false; const index = /^#\\d+$/.test(wanted) ? Number(wanted.slice(1)) : [...this.options].findIndex(o => o.label === wanted || o.value === wanted); if (index < 0 || index >= this.options.length) return false; this.selectedIndex = index; this.dispatchEvent(new Event("input", { bubbles: true })); this.dispatchEvent(new Event("change", { bubbles: true })); return true }' })
  if (result?.value !== true) throw fail('OPTION_NOT_FOUND')
}
// ---- signing in with an account the owner authorized in NAJD ----
// NAJD sends the saved user name and password for one approved page, password field and form. Everything is checked against the
// observation the approval was made on (document, address, labels, form key), and again in the page while the fields are filled, by
// the same rules as 1.x (najdLogin): one visible password field, an affirmative sign-in form posting to the account's own site over https,
// no registration, reset, change or verification-code field. The page code runs in its own isolated world, so the page cannot see or
// replace the code that writes the password. The password never comes back in the result.
const LOGIN_IN_WORLD = `function (user, host, username, password, submit) {
  globalThis.__najd = { doc: '', snap: '', nav: location.href, title: document.title, labels: new Map(), byId: new Map([['P', new WeakRef(this)], ...(user ? [['U', new WeakRef(user)]] : [])]) }
  try { return (${najdLogin.toString()})(host, user ? 'U' : '', 'P', username, password, submit, null) } finally { delete globalThis.__najd }
}`
async function login(tab, observation, args) {
  const host = String(args.host || '').toLowerCase()
  let url
  try { url = new URL(tab.url) } catch { return { ok: false, error: 'HOST_MISMATCH' } }
  if (!host || !(url.hostname === host || url.hostname.endsWith('.' + host))) return { ok: false, error: 'HOST_MISMATCH' }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) return { ok: false, error: 'INSECURE_PAGE' }
  const expect = args.expect && typeof args.expect === 'object' ? args.expect : null
  if (!observation || !expect || expect.doc !== observation.doc || String(expect.snap) !== String(observation.snap) || observation.url !== tab.url) return { ok: false, error: 'PAGE_CHANGED' }
  const pass = observation.elements.find(item => item.id === String(args.passId || ''))
  if (!pass || pass.role !== 'field' || pass.type !== 'password' || observation.elements.filter(item => item.type === 'password').length !== 1) return { ok: false, error: 'NOT_A_LOGIN_FORM' }
  if (String(expect.passLabel || '') !== pass.label) return { ok: false, error: 'ELEMENT_CHANGED' }
  const user = args.userId ? observation.elements.find(item => item.id === String(args.userId)) : null
  if (args.userId && (!user || user.role !== 'field' || user.sensitive || String(expect.userLabel || '') !== user.label)) return { ok: false, error: 'ELEMENT_CHANGED' }
  const { root } = await cdp(tab.id, 'DOM.getDocument', { depth: 0 })
  if (root.backendNodeId + '|' + tab.url !== observation.key) return { ok: false, error: 'PAGE_CHANGED' }
  const live = await formInfo(tab.id, pass.ref).catch(() => ({}))
  if ((live.formKey || '') !== (pass.formKey || '') || (expect.formKey && live.formKey !== expect.formKey)) return { ok: false, error: 'ELEMENT_CHANGED' }
  const { frameTree } = await cdp(tab.id, 'Page.getFrameTree')
  const { executionContextId } = await cdp(tab.id, 'Page.createIsolatedWorld', { frameId: frameTree.frame.id, worldName: 'najd-sign-in' })
  const resolve = async ref => (await cdp(tab.id, 'DOM.resolveNode', { backendNodeId: ref, executionContextId })).object.objectId
  const passObject = await resolve(pass.ref), userObject = user ? await resolve(user.ref) : null
  const reply = await cdp(tab.id, 'Runtime.callFunctionOn', { objectId: passObject, returnByValue: true, functionDeclaration: LOGIN_IN_WORLD,
    arguments: [userObject ? { objectId: userObject } : { value: null }, { value: host }, { value: String(args.username || '') }, { value: String(args.password || '') }, { value: args.submit === true }] })
  if (reply.exceptionDetails) return { ok: false, error: 'BROWSER_ACTION_FAILED' }
  const outcome = reply.result?.value
  return outcome && typeof outcome === 'object' ? { ok: outcome.ok === true, error: outcome.error } : { ok: false, error: 'BROWSER_ACTION_FAILED' }
}
const inject = async (tabId, func, args) => { try { const [result] = await chrome.scripting.executeScript({ target: { tabId }, func, args }); return result?.result } catch { throw fail('PAGE_NOT_ACCESSIBLE') } }

// ---- tabs ----
async function openOwned(url) {
  const state = await tabs()
  const known = await current()
  let tab
  if (known?.ownership === 'owned') tab = await chrome.tabs.update(known.tab.id, { url, active: true })
  else {
    tab = await chrome.tabs.create({ url, active: true })
    try { const group = await chrome.tabs.group({ tabIds: [tab.id] }); await chrome.tabGroups.update(group, { title: 'NAJD', color: 'yellow' }) } catch {}
    state.owned = [...new Set([...state.owned, tab.id])]
  }
  await saveTabs({ ...state, current: tab.id })
  observations.delete(tab.id)
  await waitLoad(tab.id)
  return chrome.tabs.get(tab.id)
}
async function attach(target) {
  const found = matchTabs(await chrome.tabs.query({}), target)
  if (!found.length) throw fail('NO_MATCHING_TAB')
  if (found.length > 1) throw fail('AMBIGUOUS_TAB')
  if (!(await connectionAllowed(found[0]))) throw fail('PAGE_ADDRESS_NOT_ALLOWED')
  const state = await tabs()
  await saveTabs({ ...state, current: found[0].id, attached: [...new Set([...state.attached, found[0].id])] })
  return found[0]
}

export async function banner(show) {
  const known = await current()
  if (!known) return false
  try { await inject(known.tab.id, najdBanner, [show, chrome.i18n.getMessage('bannerText'), chrome.i18n.getMessage('bannerCancel'), chrome.i18n.getMessage('@@bidi_dir')]); return true } catch { return false }
}
export const isAgentTab = async tabId => (await current())?.tab.id === tabId

export async function run(command) {
  try {
    const { kind, args = {} } = command
    if (kind === 'hello') return { ok: true, result: { protocol: 2, version: chrome.runtime.getManifest().version, engine: 'cdp' } }
    if (kind === 'list_tabs') {
      const state = await tabs()
      const list = (await chrome.tabs.query({})).filter(tab => !tab.incognito && /^https?:/.test(tab.url || '')).slice(0, 60)
      return { ok: true, result: { tabs: list.map(tab => ({ url: tab.url.slice(0, 500), title: (tab.title || '').slice(0, 200), active: tab.active, ownership: state.owned.includes(tab.id) ? 'owned' : state.attached.includes(tab.id) ? 'attached' : 'other', current: state.current === tab.id })) } }
    }
    if (kind !== 'focus' && kind !== 'park' && !(await hasSiteAccess())) return { ok: false, error: 'SITE_ACCESS_NEEDED' }
    if (kind === 'park') { const known = await current(); if (known && canNavigate(known.ownership)) await chrome.tabs.update(known.tab.id, { url: 'about:blank' }); return { ok: true, result: { parked: true } } }
    if (kind === 'open') {
      if (!allowedUrl(args.url)) return { ok: false, error: 'URL_NOT_ALLOWED' }
      const tab = await openOwned(args.url)
      if (!(await connectionAllowed(tab))) { await chrome.tabs.update(tab.id, { url: 'about:blank' }); return { ok: false, error: 'PAGE_ADDRESS_NOT_ALLOWED' } }
      return { ok: true, result: null, resultIsPage: true, page: await observe(tab.id) }
    }
    if (kind === 'attach') {
      if (!allowedUrl(args.url)) return { ok: false, error: 'URL_NOT_ALLOWED' }
      const tab = await attach(String(args.url))
      return { ok: true, result: null, resultIsPage: true, page: await observe(tab.id) }
    }
    const known = await current()
    if (!known) return { ok: false, error: 'NO_NAJD_TAB' }
    const tabId = known.tab.id
    if (kind === 'focus') { await chrome.tabs.update(tabId, { active: true }); await chrome.windows.update(known.tab.windowId, { focused: true }); return { ok: true, result: { focused: true } } }
    if (kind === 'detach') { const state = await tabs(); await saveTabs({ ...state, current: null, attached: state.attached.filter(item => item !== tabId) }); try { await chrome.debugger.detach({ tabId }) } catch {} return { ok: true, result: { detached: true } } }
    if (!(await connectionAllowed(known.tab))) { if (canNavigate(known.ownership)) await chrome.tabs.update(tabId, { url: 'about:blank' }); return { ok: false, error: 'PAGE_ADDRESS_NOT_ALLOWED' } }
    if (kind === 'back') {
      if (!canNavigate(known.ownership)) return { ok: false, error: 'ATTACHED_TAB' }
      const before = known.tab.url
      await cdp(tabId, 'Runtime.evaluate', { expression: 'history.back()' })
      for (let i = 0; i < 20; i++) { const tab = await chrome.tabs.get(tabId).catch(() => null); if (!tab || tab.url !== before) break; await pause(150) }
      await waitLoad(tabId)
    } else if (kind === 'scroll') {
      await cdp(tabId, 'Runtime.evaluate', { expression: `window.scrollBy(0, ${args.direction === 'up' ? -1 : 1} * Math.round(innerHeight * 0.85))` }); await pause(300)
    } else if (kind === 'login') {
      const outcome = await login(known.tab, observations.get(tabId), args)
      if (!outcome.ok) return { ok: false, error: outcome.error || 'BROWSER_ACTION_FAILED' }
      observations.delete(tabId) // one effect per observation
      // A sign-in usually navigates: wait for the address to change (up to ~4 s), then for loading to finish, before looking at the page.
      for (let i = 0; i < 27; i++) { const tab = await chrome.tabs.get(tabId).catch(() => null); if (!tab || tab.url !== known.tab.url) break; await pause(150) }
      await pause(500); await waitLoad(tabId)
    } else if (['click', 'type', 'select'].includes(kind)) {
      const checked = checkTarget(observations.get(tabId), args.expect, String(args.id || ''))
      if (!checked.ok) return { ok: false, error: checked.error }
      if (checked.element.formKey || args.expect?.formKey) {
        const live = await formInfo(tabId, checked.element.ref).catch(() => ({}))
        if ((args.expect?.formKey && live.formKey !== args.expect.formKey) || live.formKey !== checked.element.formKey) return { ok: false, error: 'ELEMENT_CHANGED' }
      }
      observations.delete(tabId) // one effect per observation
      // A link that opens a new tab (target=_blank) would leave NAJD on the old page: it saw no change, pressed again, and opened a tab per press
      // (owner's Outlook sign-in, 2026-11-14: five sign-in tabs). In NAJD's own tab the new tab is folded back: closed, and its address opened here.
      const followsLink = kind === 'click' && checked.element.role === 'link' && !!checked.element.href
      const watchNewTab = followsLink && canNavigate(known.ownership), opened = []
      const onCreated = tab => { if (tab.openerTabId === tabId) opened.push(tab.id) }
      if (watchNewTab) chrome.tabs.onCreated.addListener(onCreated)
      try {
        if (kind === 'click') await click(tabId, checked.element.ref)
        else if (kind === 'type') await type(tabId, checked.element.ref, String(args.text || ''), args.submit === true)
        else await select(tabId, checked.element.ref, String(args.text || ''))
        // A followed link navigates after the click returns, sometimes later than the settle below on a busy computer (a slow start left the page
        // "complete" at its old address and the old page was reported as the result): wait for the address to change or a new tab, up to about 3 seconds.
        if (followsLink) {
          const before = known.tab.url
          for (let i = 0; i < 20 && !opened.length; i++) { const tab = await chrome.tabs.get(tabId).catch(() => null); if (!tab || tab.url !== before) break; await pause(150) }
        }
      } finally { if (watchNewTab) chrome.tabs.onCreated.removeListener(onCreated) }
      if (opened.length) {
        let address = ''
        for (let i = 0; i < 20 && !address; i++) { const tab = await chrome.tabs.get(opened[0]).catch(() => null); address = tab && tab.url && tab.url !== 'about:blank' ? tab.url : tab?.pendingUrl || ''; if (!address) await pause(150) }
        for (const id of opened) await chrome.tabs.remove(id).catch(() => {})
        if (/^https?:/.test(address) && (await connectionAllowed({ url: address }))) await chrome.tabs.update(tabId, { url: address })
      }
      await pause(600); await waitLoad(tabId)
    } else if (kind !== 'read') return { ok: false, error: 'INVALID_INPUT' }
    const after = await chrome.tabs.get(tabId)
    if (!(await connectionAllowed(after))) { if (canNavigate(known.ownership)) await chrome.tabs.update(tabId, { url: 'about:blank' }); return { ok: false, error: 'PAGE_ADDRESS_NOT_ALLOWED' } }
    return { ok: true, result: null, resultIsPage: true, page: await observe(tabId) }
  } catch (error) { return { ok: false, error: error?.code || 'BROWSER_ACTION_FAILED' } }
}
