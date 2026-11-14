// NAJD side panel: a chat with NAJD beside the page the owner is reading. Questions go to the NAJD app through the service worker and the
// local bridge; the app answers them as normal conversations (its provider, its approvals, its history). The page is read only when the owner
// sends a question with "Include this page" ticked, and it travels as untrusted data beside the question, never as the question.
import { SITE_ORIGINS } from './src/protocol.js'
import { najdPageText, najdHighlight } from './src/page-scripts.js'
import { createQueue } from './src/queue.js'
import { keepChat, takeChat } from './src/history.js'
import { MAX_MENTIONS, mentionAt, mentionChoices, dropMention, slashAt, skillChoices, skillPrompt } from './src/mention.js'

// The panel's language: the owner's choice (the button in the header, kept in storage), otherwise the browser's. chrome.i18n cannot switch language
// while running, so when the choice differs from the browser's the other language's messages are read from the package itself.
const browserLanguage = /^ar/.test(chrome.i18n.getUILanguage()) ? 'ar' : 'en'
const chosen = (await chrome.storage.local.get('najdPanelLanguage').catch(() => ({}))).najdPanelLanguage
const language = chosen === 'ar' || chosen === 'en' ? chosen : browserLanguage
const other = language === browserLanguage ? null : await fetch(chrome.runtime.getURL(`_locales/${language}/messages.json`)).then(response => response.json()).catch(() => null)
const t = key => other?.[key]?.message || chrome.i18n.getMessage(key) || key
const $ = id => document.getElementById(id)
const send = message => chrome.runtime.sendMessage(message).catch(() => ({ ok: false, error: 'FAILED' }))
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))

document.documentElement.lang = language
document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr'
$('lang-label').textContent = language === 'ar' ? 'EN' : 'ع'
$('lang').title = language === 'ar' ? 'English' : 'العربية'
$('lang').setAttribute('aria-label', language === 'ar' ? 'English' : 'العربية')
$('lang').addEventListener('click', async () => { await chrome.storage.local.set({ najdPanelLanguage: language === 'ar' ? 'en' : 'ar' }); location.reload() })
for (const node of document.querySelectorAll('[data-i18n]')) node.textContent = t(node.dataset.i18n)
for (const node of document.querySelectorAll('[data-i18n-placeholder]')) { node.placeholder = t(node.dataset.i18nPlaceholder); node.setAttribute('aria-label', t(node.dataset.i18nPlaceholder)) }
for (const node of document.querySelectorAll('[data-i18n-title]')) { node.title = t(node.dataset.i18nTitle); node.setAttribute('aria-label', t(node.dataset.i18nTitle)) }

const views = ['unlinked', 'pairing', 'linked']
const show = name => { for (const view of views) $('view-' + view).hidden = view !== name }
const STATUS_TEXT = { connected: 'statusConnected', offline: 'statusOffline', unlinked: 'statusUnlinked', pairing: 'statusPairing', searching: 'statusSearching' }
const NOTE = { 'not-found': 'notFound', denied: 'denied', expired: 'expired', busy: 'busy', rejected: 'statusUnlinked' }
const WORKING = ['queued', 'running', 'waiting_approval']
const PAGE_TEXT_CHARS = 21100 // NAJD masks saved passwords first and then cuts the page text to 12,000 characters
const TAB_TEXT_CHARS = 15100 // the same for each tab named with @, cut to 6,000 characters
const MAX_PICTURE_BYTES = 3 * 1024 * 1024 // the bridge takes one picture of the page up to this size
const MAX_THREAD = 12

// The toolbar button closes this panel when it is open (the worker tells it to).
const port = chrome.runtime.connect({ name: 'najd-panel' })
chrome.windows.getCurrent().then(window => port.postMessage({ windowId: window.id })).catch(() => {})
port.onMessage.addListener(message => { if (message?.type === 'close') window.close() })

let linkedState = { linked: false, connected: false }

async function render() {
  const state = await send({ type: 'najd:state' })
  if (!state?.ok) return
  const status = state.status?.state || (state.linked ? 'offline' : 'unlinked')
  const linked = state.linked
  const shown = linked ? (status === 'offline' ? 'offline' : 'connected') : (status === 'pairing' || status === 'searching' ? status : 'unlinked')
  $('status').dataset.state = shown
  $('status-text').textContent = t(STATUS_TEXT[shown])
  $('unlink').hidden = !linked
  $('new-ask').hidden = !linked; $('history').hidden = !linked
  linkedState = { linked, connected: linked && shown === 'connected' }
  if (!linked) {
    if (status === 'pairing') { $('pair-code').textContent = String(state.status.code || '').replace(/^(\d{3})(\d{3})$/, '$1 $2'); show('pairing'); return }
    show('unlinked')
    const note = NOTE[status]
    $('unlinked-note').hidden = !note && status !== 'searching'
    $('unlinked-note').textContent = status === 'searching' ? t('searching') : note ? t(note) : ''
    $('connect').disabled = status === 'searching'
    $('connect').textContent = note ? t('retry') : t('connectButton')
    return
  }
  show('linked')
  // NAJD is not running: the chat stays readable, and nothing can be sent until the app is back.
  $('offline').hidden = shown !== 'offline'
  $('site-access').hidden = state.siteAccess === true
  paintComposer()
  if (shown === 'connected') { void loadModels(); void pollSession(); void checkApp() } else appChat = null
  paintNotice()
  await restoreThread()
}

// ---- an older NAJD app, or an extension updated on disk but not reloaded ----
// The browser keeps an extension's messages from when it was loaded: new panel files with old messages mean it was not reloaded,
// so that notice carries its own text.
const arabic = language === 'ar'
let appChat = null // null: unknown; false: the app opens a new conversation for every question
async function checkApp() {
  if (appChat !== null) return
  const result = await send({ type: 'najd:hello' })
  if (result?.ok) { appChat = result.chat === true; paintNotice() }
}
function paintNotice() {
  const stale = !chrome.i18n.getMessage('appOldTitle')
  const old = !stale && appChat === false
  $('notice').hidden = !stale && !old
  if (stale) {
    $('notice-title').textContent = arabic ? 'أعد تحميل إضافة نجد' : 'Reload the NAJD extension'
    $('notice-body').textContent = arabic ? 'تم تحديث ملفات الإضافة لكن المتصفح لم يُعِد تحميلها. افتح edge://extensions واضغط «إعادة التحميل» على بطاقة NAJD AGENT.'
      : 'The extension files were updated but the browser has not reloaded them. Open edge://extensions (or chrome://extensions) and press Reload on the NAJD AGENT card.'
  } else if (old) { $('notice-title').textContent = t('appOldTitle'); $('notice-body').textContent = t('appOldBody') }
}

// ---- connecting ----
$('connect').addEventListener('click', async () => { $('connect').disabled = true; await send({ type: 'najd:pair' }); await render() })
$('code-form').addEventListener('submit', async event => {
  event.preventDefault()
  const result = await send({ type: 'najd:code', value: $('code').value })
  $('code-error').hidden = result?.ok === true
  $('code-error').textContent = result?.state === 'not-found' ? t('notFound') : result?.state === 'busy' ? t('busy') : t('badCode')
  if (result?.ok) $('code').value = ''
  await render()
})
$('unlink').addEventListener('click', async () => { await send({ type: 'najd:unlink' }); await clearThread(); await chrome.storage.session.remove('najdChats').catch(() => {}); closeHistory(); await render() })
$('allow-sites').addEventListener('click', async () => { try { await chrome.permissions.request({ origins: SITE_ORIGINS }) } catch {} await render(); void refreshContext() })
$('retry-offline').addEventListener('click', async () => { $('retry-offline').disabled = true; await send({ type: 'najd:state' }); await pause(600); $('retry-offline').disabled = false; await render() })

// ---- the page beside the chat: follows the active tab and its navigation ----
let contextTab = null
const readable = url => /^https?:\/\//.test(url || '')
async function currentPageTab() {
  const tabs = await chrome.tabs.query({ currentWindow: true }).catch(() => [])
  const active = tabs.find(tab => tab.active)
  // The panel opened in a tab of its own (development, tests) has no page beside it: the tab used most recently is the page.
  if (active && !String(active.url || active.pendingUrl || '').startsWith(chrome.runtime.getURL(''))) return active
  return tabs.filter(tab => readable(tab.url)).sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))[0] || null
}
async function refreshContext() {
  contextTab = await currentPageTab()
  const ok = contextTab && readable(contextTab.url)
  let host = ''
  try { host = ok ? new URL(contextTab.url).host : '' } catch {}
  $('page-title').textContent = ok ? `${contextTab.title || host} · ${host}` : t('pageNone')
  $('page-title').title = ok ? contextTab.url : ''
}
chrome.tabs.onActivated.addListener(() => { void refreshContext() })
chrome.tabs.onUpdated.addListener((_id, change) => { if (change.status === 'complete' || change.title || change.url) void refreshContext() })
chrome.windows.onFocusChanged.addListener(() => { void refreshContext() })

// ---- the chat ----
// Kept in this browser session only (memory, cleared when the browser closes): the answers are also saved in NAJD's conversation.
let thread = [] // { id, text, page: { title, url, read } | null, state, progress, output, outputTruncated, steps, tabId }
const nodes = new Map() // ask id -> { root, ... } of the message on screen
let restored = false
const save = () => chrome.storage.session.set({ najdThread: thread.slice(-MAX_THREAD) }).catch(() => {})
async function restoreThread() {
  if (!restored) {
    restored = true
    const { najdThread } = await chrome.storage.session.get('najdThread')
    thread = Array.isArray(najdThread) ? najdThread.filter(item => item && /^[a-f0-9]{24}$/.test(item.id)) : []
    for (const item of thread) paintItem(item, false)
    scrollToEnd()
  }
  for (const item of thread) if (WORKING.includes(item.state)) void follow(item)
  await takePrompt()
  paintComposer()
}
async function clearThread({ keep = false } = {}) {
  // "New chat" keeps the chat it closes in this session's list (src/history.js); unlinking forgets both.
  if (keep && thread.length) { const { najdChats } = await chrome.storage.session.get('najdChats'); await chrome.storage.session.set({ najdChats: keepChat(najdChats, thread) }).catch(() => {}) }
  thread = []; restored = true
  for (const { root } of nodes.values()) root.remove()
  nodes.clear()
  await chrome.storage.session.remove(['najdThread'])
  $('empty').hidden = false
  paintComposer()
}
// ---- earlier chats of this browser session ----
function closeHistory() { $('history-menu').hidden = true; $('history-menu').replaceChildren(); $('history').setAttribute('aria-expanded', 'false') }
async function openHistory() {
  const { najdChats } = await chrome.storage.session.get('najdChats')
  const chats = keepChat(najdChats, [])
  const list = $('history-menu')
  const heading = document.createElement('strong'); heading.textContent = t('historyTitle')
  if (!chats.length) { const note = document.createElement('p'); note.textContent = t('historyEmpty'); list.replaceChildren(heading, note) }
  else list.replaceChildren(heading, ...chats.map(chat => {
    const option = document.createElement('button'); option.type = 'button'; option.dataset.chat = chat.id
    const name = document.createElement('span'); name.dir = 'auto'; name.textContent = chat.title || '…'
    const when = document.createElement('small')
    when.textContent = new Date(chat.at).toLocaleTimeString(language === 'ar' ? 'ar-SA' : 'en-US', { hour: 'numeric', minute: '2-digit' }) + ' · ' + t(chat.count === 1 ? 'historyOne' : 'historyMany').replace('$1', String(chat.count))
    option.append(name, when)
    option.addEventListener('click', () => { void reopen(chat.id) })
    return option
  }))
  list.hidden = false; $('history').setAttribute('aria-expanded', 'true')
}
// Reopens an earlier chat: the open one (if any) goes into the list first; a question asked next continues that chat in NAJD.
async function reopen(id) {
  if (running()) return
  const { najdChats } = await chrome.storage.session.get('najdChats')
  const { chat, rest } = takeChat(keepChat(najdChats, []), id)
  if (!chat) { closeHistory(); return }
  await chrome.storage.session.set({ najdChats: keepChat(rest, thread) }).catch(() => {})
  for (const { root } of nodes.values()) root.remove()
  nodes.clear()
  thread = chat.items.slice(-MAX_THREAD); restored = true
  for (const item of thread) paintItem(item, false)
  void save(); closeHistory(); scrollToEnd(); paintComposer()
  for (const item of thread) if (WORKING.includes(item.state)) void follow(item)
}
$('history').addEventListener('click', () => { if (!$('history-menu').hidden) closeHistory(); else void openHistory() })
const running = () => thread.find(item => WORKING.includes(item.state)) || null
function scrollToEnd() { const box = $('thread'); box.scrollTop = box.scrollHeight }

function paintComposer() {
  const busy = !!running(), offline = !linkedState.connected
  $('send').hidden = busy; $('stop').hidden = !busy
  // Typing stays possible while NAJD works: the question waits and is sent when the running one ends (src/queue.js).
  $('send').disabled = offline; $('ask-text').disabled = offline; $('send').hidden = busy && !$('ask-text').value.trim() ? true : false; $('stop').hidden = !busy
  for (const chip of document.querySelectorAll('[data-quick]')) chip.disabled = busy || offline
  $('new-ask').disabled = busy
  $('empty').hidden = thread.length > 0
  queue.settle()
}

const label = progress => {
  const tool = String(progress || '').split(':')[0]
  const key = /files|library|log/.test(tool) ? 'toolFiles' : /search|knowledge|chats|capabilities/.test(tool) ? 'toolSearch' : /web/.test(tool) ? 'toolWeb' : /browser/.test(tool) ? 'toolBrowser'
    : /terminal|process/.test(tool) ? 'toolCommand' : /python/.test(tool) ? 'toolPython' : /skill/.test(tool) ? 'toolSkill' : /desktop|screen/.test(tool) ? 'toolDesktop' : 'toolOther'
  return t(key)
}
const STEP_TEXT = { reasoning: 'stepReasoning', page: 'stepReadPage', read: 'stepRead', browse: 'stepBrowse', work: 'stepWork', approval: 'stepApproval' }
const stateText = ask => ask.state === 'queued' ? t('queued') : ask.state === 'waiting_approval' ? t('waitingApproval') : ask.state === 'running' ? (ask.progress && ask.progress !== 'STOPPING' ? label(ask.progress) : t('working'))
  : ask.state === 'done' ? '' : ask.state === 'cancelled' ? t('cancelled') : /UNKNOWN_EFFECT/.test(ask.progress || '') ? t('unconfirmed') : t('failed')

// A small, safe Markdown subset built as DOM nodes (never HTML from the answer): paragraphs, headings, lists, code blocks, `code` and **bold**.
function inline(parent, text) {
  for (const part of String(text).split(/(`[^`\n]+`|\*\*[^*\n]+\*\*)/g)) {
    if (!part) continue
    if (/^`[^`]+`$/.test(part)) { const code = document.createElement('code'); code.textContent = part.slice(1, -1); parent.append(code) }
    else if (/^\*\*[^*]+\*\*$/.test(part)) { const strong = document.createElement('strong'); strong.textContent = part.slice(2, -2); parent.append(strong) }
    else parent.append(part)
  }
}
function markdown(target, text) {
  target.replaceChildren()
  const lines = String(text).split('\n')
  let list = null, para = null
  const end = () => { list = null; para = null }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (/^```/.test(line)) {
      end()
      const pre = document.createElement('pre'), body = []
      for (i++; i < lines.length && !/^```/.test(lines[i]); i++) body.push(lines[i])
      pre.textContent = body.join('\n'); target.append(pre); continue
    }
    const heading = /^#{1,6}\s+(.*)$/.exec(line)
    const bullet = /^\s*(?:[-*•]|\d+[.)])\s+(.*)$/.exec(line)
    if (!line.trim()) { end(); continue }
    if (heading) { end(); const h = document.createElement('h3'); inline(h, heading[1]); target.append(h); continue }
    if (bullet) {
      para = null
      if (!list) { list = document.createElement(/^\s*\d/.test(line) ? 'ol' : 'ul'); target.append(list) }
      const li = document.createElement('li'); li.dir = 'auto'; inline(li, bullet[1]); list.append(li); continue
    }
    list = null
    if (!para) { para = document.createElement('p'); para.dir = 'auto'; target.append(para) } else para.append(document.createElement('br'))
    inline(para, line)
  }
}
// Text NAJD quoted from the page (in quotation marks): offered as "highlight on page" buttons.
const quotesOf = text => [...new Set([...String(text).matchAll(/[“"«]([^”"»\n]{6,160})[”"»]/g)].map(match => match[1].trim()))].slice(0, 3)

function paintItem(item, live) {
  let view = nodes.get(item.id)
  if (!view) {
    const user = document.createElement('article'); user.className = 'msg user'
    const bubble = document.createElement('div'); bubble.className = 'bubble'; bubble.dir = 'auto'; bubble.textContent = item.text
    user.append(bubble)
    if (item.page?.title || item.page?.url) { const meta = document.createElement('div'); meta.className = 'meta'; meta.dir = 'auto'; meta.textContent = '🔗 ' + (item.page.title || item.page.url); user.append(meta) }
    if (item.picture) { const meta = document.createElement('div'); meta.className = 'meta'; meta.dir = 'auto'; meta.textContent = '📷 ' + t('captureSent'); user.append(meta) }
    for (const name of Array.isArray(item.tabs) ? item.tabs : []) { const meta = document.createElement('div'); meta.className = 'meta'; meta.dir = 'auto'; meta.textContent = '@ ' + name; user.append(meta) }
    const najd = document.createElement('article'); najd.className = 'msg najd'; najd.dataset.ask = item.id
    const card = document.createElement('div'); card.className = 'card'
    const tools = document.createElement('details'); tools.className = 'tools'
    const summary = document.createElement('summary'), spin = document.createElement('i'), title = document.createElement('span'), current = document.createElement('span')
    spin.className = 'spin'; title.textContent = t('toolCalls'); current.className = 'current'
    summary.append(spin, title, current)
    const steps = document.createElement('ol'); steps.className = 'steps'
    tools.append(summary, steps)
    const state = document.createElement('p'); state.className = 'state'; state.setAttribute('role', 'status')
    const answer = document.createElement('div'); answer.className = 'answer'
    const truncated = document.createElement('p'); truncated.className = 'hint'; truncated.textContent = t('answerTruncated'); truncated.hidden = true
    const actions = document.createElement('div'); actions.className = 'actions'
    card.append(tools, state, answer, truncated, actions)
    najd.append(card)
    const root = document.createElement('div'); root.className = 'pair'; root.style.display = 'contents'
    root.append(user, najd)
    $('thread').append(root)
    view = { root, spin, current, steps, state, answer, truncated, actions, shown: '' }
    nodes.set(item.id, view)
  }
  const ask = item
  const working = WORKING.includes(ask.state)
  // Tool calls: "Read page" from this panel, then the steps NAJD reports as its tools run.
  const list = [...(item.page?.read ? [{ kind: 'page', state: 'done' }] : []), ...(Array.isArray(ask.steps) ? ask.steps : [])]
  if (working && !list.some(step => step.state === 'running')) list.push({ kind: ask.state === 'waiting_approval' ? 'approval' : 'reasoning', state: 'running' })
  view.steps.replaceChildren(...list.map(step => {
    const li = document.createElement('li'); li.className = 'step ' + step.state
    const dot = document.createElement('i'), name = document.createElement('span')
    name.textContent = t(STEP_TEXT[step.kind] || 'stepWork') + (step.tool ? ' · ' + label(step.tool) : '')
    li.append(dot, name)
    if (step.detail) { const small = document.createElement('small'); small.dir = 'auto'; small.textContent = step.detail; li.append(small) }
    return li
  }))
  const open = [...list].reverse().find(step => step.state === 'running')
  view.spin.hidden = !working
  view.current.textContent = (open ? '· ' + t(STEP_TEXT[open.kind] || 'stepWork') : list.length ? '· ' + list.length : '')
  view.steps.parentElement.hidden = !list.length
  view.state.textContent = stateText(ask)
  view.state.dataset.state = ask.state
  view.state.hidden = !view.state.textContent
  view.truncated.hidden = ask.outputTruncated !== true
  // The answer appears as it arrives: revealed progressively when it comes in live, at once when restored.
  if ((ask.output || '') !== view.shown) {
    const full = ask.output || ''
    view.shown = full
    if (live && full) void reveal(view, full)
    else markdown(view.answer, full)
  }
  view.actions.replaceChildren()
  if (ask.state === 'waiting_approval') view.actions.append(button(t('reviewInNajd'), () => { void send({ type: 'najd:ask-show', id: ask.id }) }, 'review'))
  if (ask.output && !working) {
    view.actions.append(button(t('copy'), async event => { try { await navigator.clipboard.writeText(ask.output); event.target.textContent = t('copied'); setTimeout(() => { event.target.textContent = t('copy') }, 1500) } catch {} }))
    for (const quote of quotesOf(ask.output)) view.actions.append(button('⌖ ' + quote, () => { void highlight(quote, item.tabId) }))
  }
}
async function reveal(view, full) {
  const steps = Math.min(24, Math.max(4, Math.ceil(full.length / 120)))
  for (let i = 1; i <= steps; i++) {
    if (view.shown !== full) return
    markdown(view.answer, full.slice(0, Math.ceil(full.length * i / steps)))
    scrollToEnd()
    await pause(28)
  }
}
function button(text, onClick, className = '') { const node = document.createElement('button'); node.type = 'button'; node.textContent = text; node.title = text; if (className) node.className = className; node.addEventListener('click', onClick); return node }

// Follows one question until it ends: progress, tool calls and the answer, as NAJD reports them.
const following = new Set()
async function follow(item) {
  if (following.has(item.id)) return
  following.add(item.id)
  try {
    while (WORKING.includes(item.state)) {
      const result = await send({ type: 'najd:ask-status', id: item.id })
      if (!result?.ok || !result.ask) { if (result?.error === 'REJECTED') break; await pause(1500); continue }
      const before = JSON.stringify([item.state, item.progress, item.output, item.steps])
      Object.assign(item, { state: result.ask.state, progress: result.ask.progress || '', output: result.ask.output || '', outputTruncated: result.ask.outputTruncated === true, steps: Array.isArray(result.ask.steps) ? result.ask.steps : item.steps || [] })
      if (JSON.stringify([item.state, item.progress, item.output, item.steps]) !== before) { paintItem(item, true); void save(); scrollToEnd() }
      if (!WORKING.includes(item.state)) break
      await pause(900)
    }
  } finally { following.delete(item.id); paintComposer() }
}

// ---- asking ----
let pendingPrompt = null
async function takePrompt() {
  const { najdPrompt } = await chrome.storage.session.get('najdPrompt')
  if (!najdPrompt) return
  await chrome.storage.session.remove('najdPrompt')
  pendingPrompt = najdPrompt
  // The selected text stays out of the question box: it travels as page context, and the question is the user's own words.
  if (najdPrompt.text) $('selection-chip').hidden = false
  $('ask-text').focus()
}
let attachment = null // { name, text }
let pageNoteShown = false, selectionNoteShown = false
// The page details for this question: what the owner selected, and (with the box ticked) the page's address, title and visible text.
async function pageInfo() {
  const selection = pendingPrompt?.text ? String(pendingPrompt.text).slice(0, 11100) : ''
  let page = null
  if ($('include-page').checked) {
    const tab = Number.isInteger(pendingPrompt?.tabId) ? await chrome.tabs.get(pendingPrompt.tabId).catch(() => null) : contextTab || await currentPageTab()
    if (tab && readable(tab.url)) {
      try {
        const [result] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: najdPageText, args: [PAGE_TEXT_CHARS] })
        const read = result?.result
        if (read && readable(read.url)) page = { url: read.url, title: read.title || tab.title || '', text: read.text || '', lang: read.lang || '', tabId: tab.id, read: true }
      } catch {}
      // Without website access the page cannot be read; with the right-click menu its address and title are still known.
      if (!page && pendingPrompt?.page?.url) page = { url: pendingPrompt.page.url, title: pendingPrompt.page.title || '', text: '', lang: '', tabId: tab.id, read: false }
    } else if (pendingPrompt?.page?.url) page = { url: pendingPrompt.page.url, title: pendingPrompt.page.title || '', text: '', lang: '', tabId: null, read: false }
  }
  // Tabs named with @ are read now, each only when it is still open and a web page; one that cannot be read goes with its address and title.
  const tabs = []
  for (const chosen of mentioned) {
    const tab = await chrome.tabs.get(chosen.id).catch(() => null)
    if (!tab || !readable(tab.url)) continue
    let text = ''
    try { const [result] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: najdPageText, args: [TAB_TEXT_CHARS] }); text = String(result?.result?.text || '') } catch {}
    tabs.push({ url: tab.url, title: tab.title || '', text })
  }
  if (!page && !selection && !attachment && !tabs.length && !picture) return null
  return { url: page?.url || '', title: page?.title || '', text: page?.text || '', lang: page?.lang || '', tabId: page?.tabId ?? null, read: page?.read === true, attachment, selection, tabs, picture: picture?.data || null }
}
const queue = createQueue({ busy: () => !!running(), send: text => { void ask(text) }, onChange: waiting => { $('queue-note').hidden = !waiting } })
async function ask(text) {
  if (!text || running() || !linkedState.connected) return
  $('ask-error').hidden = true; $('send').disabled = true
  const page = await pageInfo()
  // A selection longer than NAJD takes (2000 characters) is said before sending, so an answer is never taken for one about all of it.
  if ((page?.selection?.length || 0) > 2000 && !selectionNoteShown) { selectionNoteShown = true; $('selection-note').hidden = false; $('send').disabled = false; return }
  // The page cannot be read (no website access, or a browser page): the owner is told before anything is sent (and can allow access or send
  // without it), instead of the page silently going missing.
  if ($('include-page').checked && !page?.read && !pageNoteShown) { pageNoteShown = true; $('page-note').hidden = false; $('send').disabled = false; return }
  const previous = [...thread].reverse().find(item => item.state === 'done' || item.state === 'failed') // NAJD continues that conversation
  const model = modelChoice()
  const result = await send({ type: 'najd:ask', text, after: previous?.id || null, model,
    page: page ? { url: page.url, title: page.title, text: page.text, lang: page.lang, selection: page.selection, ...(page.attachment ? { attachment: page.attachment } : {}), ...(page.tabs.length ? { tabs: page.tabs } : {}), ...(page.picture ? { picture: page.picture } : {}) } : null })
  $('send').disabled = false
  if (!result?.ok) { $('ask-error').hidden = false; $('ask-error').textContent = result?.error === 'TOO_MANY_REQUESTS' ? t('tooMany') : t('askFailed'); return }
  const item = { id: result.id, text, page: page && (page.url || page.title) ? { title: page.title, url: page.url, read: page.read } : null, tabId: page?.tabId ?? null, tabs: (page?.tabs || []).map(tab => tab.title || tab.url), picture: !!page?.picture, state: result.state || 'queued', progress: '', output: '', steps: [] }
  thread.push(item)
  while (thread.length > MAX_THREAD) { const old = thread.shift(); nodes.get(old.id)?.root.remove(); nodes.delete(old.id) }
  pendingPrompt = null; pageNoteShown = false; selectionNoteShown = false; attachment = null; mentioned = []; paintMentions(); picture = null; $('capture-chip').hidden = true
  $('page-note').hidden = true; $('selection-note').hidden = true; $('selection-chip').hidden = true; $('attach-chip').hidden = true
  $('ask-text').value = ''; fit()
  paintItem(item, true); void save(); scrollToEnd(); paintComposer()
  void follow(item)
}
$('ask-form').addEventListener('submit', event => {
  event.preventDefault()
  // With a selection and no typed question, a fixed question is used; the selected text itself is never promoted to the question.
  const text = $('ask-text').value.trim() || (pendingPrompt?.text ? t('defaultSelectionQuestion') : '')
  if (!text) return
  if (queue.offer(text) === 'queued') { $('ask-text').value = ''; fit(); paintComposer() }
})
$('queue-cancel').addEventListener('click', () => queue.clear())
// The selection button on pages (src/selection-bar.js) can be switched off here; the choice is kept.
async function paintSelectionBar() {
  const on = (await chrome.storage.local.get('najdSelectionBar').catch(() => ({}))).najdSelectionBar !== false
  $('selection-bar').textContent = t(on ? 'selectionBarOn' : 'selectionBarOff'); $('selection-bar').setAttribute('aria-pressed', String(on))
}
$('selection-bar').addEventListener('click', async () => { const on = $('selection-bar').getAttribute('aria-pressed') === 'true'; await chrome.storage.local.set({ najdSelectionBar: !on }); await paintSelectionBar() })
void paintSelectionBar()
$('ask-text').addEventListener('keydown', event => {
  if (menuOpen() && !event.isComposing && ['ArrowDown', 'ArrowUp', 'Enter', 'Tab', 'Escape'].includes(event.key)) { event.preventDefault(); menuKey(event.key); return }
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); $('ask-form').requestSubmit() }
})

// ---- "@": other open tabs sent with the question (src/mention.js); read only when the question is sent ----
let mentioned = [] // { id, title, url }
let menu = { kind: 'tab', items: [], index: 0, mention: null }
const menuOpen = () => !$('tab-menu').hidden
function closeMenu() { $('tab-menu').hidden = true; $('tab-menu').replaceChildren(); menu = { kind: 'tab', items: [], index: 0, mention: null } }
function menuOption(index, title, detail, onPick) {
  const option = document.createElement('button'); option.type = 'button'; option.setAttribute('role', 'option')
  option.setAttribute('aria-selected', String(index === menu.index))
  const name = document.createElement('span'); name.dir = 'auto'; name.textContent = title
  const where = document.createElement('small'); where.dir = 'auto'; where.textContent = detail
  option.append(name, where)
  option.addEventListener('mousedown', event => event.preventDefault()) // the box keeps the caret
  option.addEventListener('click', onPick)
  return option
}
function menuNote(key) { const note = document.createElement('p'); note.textContent = t(key); $('tab-menu').replaceChildren(note) }
function paintMentions() {
  const box = $('mention-chips')
  box.replaceChildren(...mentioned.map(tab => {
    const chip = document.createElement('p'); chip.className = 'tag'
    const name = document.createElement('span'); name.dir = 'auto'; name.textContent = '@ ' + (tab.title || tab.url); name.title = tab.url
    const remove = button('×', () => { mentioned = mentioned.filter(item => item.id !== tab.id); paintMentions() }, 'x'); remove.title = t('mentionRemove'); remove.setAttribute('aria-label', t('mentionRemove'))
    chip.append(name, remove); return chip
  }))
  box.hidden = mentioned.length === 0
}
async function openMenu(mention) {
  const tabs = await chrome.tabs.query({ currentWindow: true }).catch(() => [])
  const exclude = [...mentioned.map(tab => tab.id), ...(contextTab && $('include-page').checked ? [contextTab.id] : [])]
  menu = { kind: 'tab', items: mentionChoices(tabs, { query: mention?.query || '', exclude }), index: 0, mention }
  const list = $('tab-menu')
  if (mentioned.length >= MAX_MENTIONS) menuNote('mentionMax')
  else if (!menu.items.length) menuNote('mentionNone')
  else list.replaceChildren(...menu.items.map((tab, index) => {
    let host = ''; try { host = new URL(tab.url).host } catch {}
    return menuOption(index, tab.title || host, host, () => pick(tab))
  }))
  list.hidden = false
}
// "/": NAJD's skills that are switched on (loaded from the app, kept for two minutes).
let skillList = null, skillsAt = 0
async function openSkills(mention) {
  if (!skillList || Date.now() - skillsAt > 120000) {
    const result = await send({ type: 'najd:skills' })
    if (result?.ok && Array.isArray(result.skills)) { skillList = result.skills; skillsAt = Date.now() }
  }
  menu = { kind: 'skill', items: skillChoices(skillList || [], { query: mention?.query || '' }), index: 0, mention }
  if (!menu.items.length) menuNote(skillList ? 'skillNone' : 'skillUnavailable')
  else $('tab-menu').replaceChildren(...menu.items.map((skill, index) => menuOption(index, skill.name || skill.id, skill.description || skill.id, () => pick(skill))))
  $('tab-menu').hidden = false
}
function menuKey(key) {
  if (key === 'Escape') return closeMenu()
  if (!menu.items.length) { if (key === 'Enter' || key === 'Tab') closeMenu(); return }
  if (key === 'ArrowDown' || key === 'ArrowUp') {
    menu.index = (menu.index + (key === 'ArrowDown' ? 1 : -1) + menu.items.length) % menu.items.length
    $('tab-menu').querySelectorAll('[role=option]').forEach((node, index) => node.setAttribute('aria-selected', String(index === menu.index)))
    return
  }
  pick(menu.items[menu.index])
}
function pick(item) {
  const box = $('ask-text')
  if (menu.kind === 'skill') {
    // The skill's opening replaces the "/word"; the rest of the box (if any) follows it, and the caret waits after it for the task.
    const rest = menu.mention ? box.value.slice(box.selectionStart).replace(/^ /, '') : box.value
    const opening = skillPrompt(item, language === 'ar')
    box.value = opening + rest; box.setSelectionRange(opening.length, opening.length); fit()
    closeMenu(); box.focus(); return
  }
  if (item && mentioned.length < MAX_MENTIONS && !mentioned.some(tab => tab.id === item.id)) mentioned.push({ id: item.id, title: item.title || '', url: item.url })
  if (menu.mention) { const caret = box.selectionStart; box.value = dropMention(box.value, menu.mention, caret); box.setSelectionRange(menu.mention.start, menu.mention.start); fit() }
  closeMenu(); paintMentions(); box.focus()
}
$('ask-text').addEventListener('input', () => {
  const box = $('ask-text'), slash = slashAt(box.value, box.selectionStart), mention = slash ? null : mentionAt(box.value, box.selectionStart)
  if (slash) void openSkills(slash); else if (mention) void openMenu(mention); else if (menu.mention) closeMenu()
})
$('slash').addEventListener('click', () => { if (menuOpen() && menu.kind === 'skill') closeMenu(); else void openSkills(null) })
$('ask-text').addEventListener('blur', () => { setTimeout(() => { if (document.activeElement !== $('ask-text') && menu.mention) closeMenu() }, 150) })
$('mention').addEventListener('click', () => { if (menuOpen() && menu.kind === 'tab') closeMenu(); else void openMenu(null) })
chrome.tabs.onRemoved.addListener(id => { if (mentioned.some(tab => tab.id === id)) { mentioned = mentioned.filter(tab => tab.id !== id); paintMentions() } })
const fit = () => { const box = $('ask-text'); box.style.height = 'auto'; box.style.height = Math.min(160, box.scrollHeight) + 'px' }
$('ask-text').addEventListener('input', fit)
$('ask-text').addEventListener('input', () => { if (running()) paintComposer() }) // the send arrow shows while typing a queued question
const QUICK = { summarize: 'promptSummarize', translate: 'promptTranslate', explain: 'promptExplain' }
for (const chip of document.querySelectorAll('[data-quick]')) chip.addEventListener('click', () => {
  $('include-page').checked = true
  void ask(chip.dataset.quick === 'explain' && pendingPrompt?.text ? t('defaultSelectionQuestion') : t(QUICK[chip.dataset.quick]))
})
$('stop').addEventListener('click', async () => { queue.clear(); const item = running(); if (item) await send({ type: 'najd:ask-cancel', id: item.id }) })
$('new-ask').addEventListener('click', () => { if (!running()) { closeHistory(); void clearThread({ keep: true }) } })

// ---- a picture of the visible page (taken only when the owner presses the button; sent with the next question) ----
let picture = null // { data: base64, title }
async function capturePage() {
  const fail = key => { $('ask-error').hidden = false; $('ask-error').textContent = t(key) }
  const tab = contextTab || await currentPageTab()
  if (!tab || !readable(tab.url)) return fail('captureNoPage')
  // In the side panel the page is the active tab already; a panel opened in a tab of its own (development, tests) shows the page first.
  if (!tab.active) { await chrome.tabs.update(tab.id, { active: true }).catch(() => {}); await pause(300) }
  let data = ''
  for (const quality of [72, 45]) {
    try { data = String(await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality })).replace(/^data:image\/jpeg;base64,/, '') } catch { data = '' }
    if (data && data.length * 3 / 4 <= MAX_PICTURE_BYTES) break
  }
  if (!data) return fail('captureFailed')
  if (data.length * 3 / 4 > MAX_PICTURE_BYTES) return fail('captureTooBig')
  picture = { data, title: tab.title || '' }
  $('capture-name').textContent = '📷 ' + t('captureChip'); $('capture-chip').hidden = false; $('ask-error').hidden = true
}
$('capture').addEventListener('click', () => { void capturePage() })
$('capture-remove').addEventListener('click', () => { picture = null; $('capture-chip').hidden = true })

// ---- attaching a text file ----
$('attach').addEventListener('click', () => $('file').click())
$('file').addEventListener('change', async () => {
  const file = $('file').files?.[0]
  $('file').value = ''
  if (!file) return
  const fail = key => { $('ask-error').hidden = false; $('ask-error').textContent = t(key) }
  if (file.size > 512 * 1024) return fail('attachTooBig')
  const text = await file.text().catch(() => '')
  if (!text.trim() || (text.match(/\u0000|�/g) || []).length > 8) return fail('attachNotText')
  attachment = { name: file.name.slice(0, 120), text: text.slice(0, 29100) }
  $('attach-name').textContent = '📎 ' + attachment.name; $('attach-chip').hidden = false; $('ask-error').hidden = true
})
$('attach-remove').addEventListener('click', () => { attachment = null; $('attach-chip').hidden = true })

// ---- voice typing (the browser's own speech recognition) ----
let recognition = null
$('voice').addEventListener('click', () => {
  if (recognition) { recognition.stop(); return }
  const Speech = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition
  if (!Speech) return toast(t('voiceUnavailable'))
  recognition = new Speech()
  recognition.lang = /^ar/.test(chrome.i18n.getUILanguage()) ? 'ar-SA' : 'en-US'
  recognition.interimResults = false
  recognition.continuous = false
  const base = $('ask-text').value
  recognition.onresult = event => { const words = [...event.results].map(result => result[0].transcript).join(' '); $('ask-text').value = (base ? base + ' ' : '') + words; fit() }
  recognition.onerror = event => { toast(event.error === 'not-allowed' || event.error === 'service-not-allowed' ? t('voiceDenied') : t('voiceUnavailable')) }
  recognition.onend = () => { recognition = null; $('voice').setAttribute('aria-pressed', 'false') }
  try { recognition.start(); $('voice').setAttribute('aria-pressed', 'true'); toast(t('voiceListening')) } catch { recognition = null; toast(t('voiceUnavailable')) }
})

// ---- model selector: NAJD's own choice, or one of the models set up in NAJD ----
// Loaded again from time to time (sooner while NAJD has none set up), so a provider added in NAJD appears here.
let modelsAt = 0, modelsCount = 0, modelsLoading = false
const modelChoice = () => { try { const value = $('model').value; return value ? JSON.parse(value) : null } catch { return null } }
async function loadModels() {
  if (modelsLoading || Date.now() - modelsAt < (modelsCount ? 120000 : 4000)) return
  modelsLoading = true
  const result = await send({ type: 'najd:models' }).finally(() => { modelsLoading = false })
  if (!result?.ok || !Array.isArray(result.models)) return
  modelsAt = Date.now(); modelsCount = result.models.length
  const najdModel = $('model').value || (await chrome.storage.local.get('najdModel')).najdModel
  const select = $('model'), groups = new Map()
  select.replaceChildren(new Option(t('modelDefault'), ''))
  for (const item of result.models) {
    if (!groups.has(item.provider)) { const group = document.createElement('optgroup'); group.label = item.providerName; groups.set(item.provider, group); select.append(group) }
    const value = JSON.stringify({ provider: item.provider, model: item.model })
    groups.get(item.provider).append(new Option(item.name, value, false, value === najdModel))
  }
}
$('model').addEventListener('change', () => { void chrome.storage.local.set({ najdModel: $('model').value }) })

// ---- marking text on the page ----
let toastTimer = null
function toast(text) { clearTimeout(toastTimer); $('toast').textContent = text; $('toast').hidden = false; toastTimer = setTimeout(() => { $('toast').hidden = true }, 2600) }
async function highlight(text, tabId) {
  const tab = Number.isInteger(tabId) ? await chrome.tabs.get(tabId).catch(() => null) : contextTab
  if (!tab || !readable(tab.url)) return toast(t('highlightBlocked'))
  try {
    await chrome.scripting.insertCSS({ target: { tabId: tab.id }, css: '::highlight(najd){background-color:#f2c14e;color:#111}' })
    const [result] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: najdHighlight, args: [String(text).slice(0, 300)] })
    toast(result?.result?.found ? t('highlightFound') : t('highlightMissing'))
  } catch { toast(t('highlightBlocked')) }
}
// Selecting words in an answer offers "Highlight on page".
document.addEventListener('selectionchange', () => {
  const selection = getSelection(), text = String(selection || '').trim()
  const inAnswer = text.length >= 2 && text.length <= 300 && selection.anchorNode && selection.anchorNode.parentElement?.closest('.najd .answer')
  $('highlight-selection').hidden = !inAnswer
  if (inAnswer) $('highlight-selection').dataset.ask = selection.anchorNode.parentElement.closest('.najd').dataset.ask
})
$('highlight-selection').addEventListener('mousedown', event => event.preventDefault())
$('highlight-selection').addEventListener('click', () => {
  const item = thread.find(entry => entry.id === $('highlight-selection').dataset.ask)
  void highlight(String(getSelection()).trim(), item?.tabId)
  $('highlight-selection').hidden = true
})

// ---- NAJD working in this browser: the banner and Cancel ----
let sessionPolling = false
async function pollSession() {
  if (sessionPolling) return
  sessionPolling = true
  try {
    while (linkedState.connected) {
      const result = await send({ type: 'najd:session' })
      void loadModels()
      $('session-banner').hidden = !(result?.ok && result.active)
      await pause(2000)
    }
  } finally { sessionPolling = false }
}
$('session-stop').addEventListener('click', async () => { $('session-stop').disabled = true; await send({ type: 'najd:session-stop' }); $('session-banner').hidden = true; $('session-stop').disabled = false })

chrome.storage.onChanged.addListener((changes, area) => { if (area === 'session' && Object.keys(changes).every(key => key === 'najdThread' || key === 'najdChats')) return; void render() })
void refreshContext()
void render()
