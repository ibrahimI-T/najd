import { SITE_ORIGINS } from './src/protocol.js'

const t = key => chrome.i18n.getMessage(key) || key
const $ = id => document.getElementById(id)
const send = message => chrome.runtime.sendMessage(message).catch(() => ({ ok: false, error: 'FAILED' }))

document.documentElement.lang = chrome.i18n.getUILanguage()
document.documentElement.dir = chrome.i18n.getMessage('@@bidi_dir') || 'ltr'
for (const node of document.querySelectorAll('[data-i18n]')) node.textContent = t(node.dataset.i18n)
for (const node of document.querySelectorAll('[data-i18n-placeholder]')) { node.placeholder = t(node.dataset.i18nPlaceholder); node.setAttribute('aria-label', t(node.dataset.i18nPlaceholder)) }

const views = ['unlinked', 'pairing', 'linked']
const show = name => { for (const view of views) $('view-' + view).hidden = view !== name }
const STATUS_TEXT = { connected: 'statusConnected', offline: 'statusOffline', unlinked: 'statusUnlinked', pairing: 'statusPairing', searching: 'statusSearching' }
const NOTE = { 'not-found': 'notFound', denied: 'denied', expired: 'expired', busy: 'busy', rejected: 'statusUnlinked' }

let current = { ask: null, polling: null }

async function render() {
  const state = await send({ type: 'najd:state' })
  if (!state?.ok) return
  const status = state.status?.state || (state.linked ? 'offline' : 'unlinked')
  const linked = state.linked
  const shown = linked ? (status === 'offline' ? 'offline' : 'connected') : (status === 'pairing' || status === 'searching' ? status : 'unlinked')
  $('status').dataset.state = shown
  $('status-text').textContent = t(STATUS_TEXT[shown])
  $('unlink').hidden = !linked
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
  $('offline').hidden = status !== 'offline'
  $('site-access').hidden = state.siteAccess === true
  await restoreAsk()
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
$('unlink').addEventListener('click', async () => { await send({ type: 'najd:unlink' }); current.ask = null; await chrome.storage.session.remove('najdAsk'); await render() })
$('allow-sites').addEventListener('click', async () => { try { await chrome.permissions.request({ origins: SITE_ORIGINS }) } catch {} await render() })

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
let pageNoteShown = false, selectionNoteShown = false
async function pageInfo() {
  const selection = pendingPrompt?.text ? String(pendingPrompt.text).slice(0, 11100) : ''
  let page = null
  if ($('include-page').checked) {
    if (pendingPrompt?.page?.url) page = { url: pendingPrompt.page.url, title: pendingPrompt.page.title }
    else { try { const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true }); if (tab?.url) page = { url: tab.url, title: tab.title || '' } } catch {} }
  }
  if (!page && !selection) return null
  return { url: page?.url || '', title: page?.title || '', selection }
}
const label = progress => {
  const tool = String(progress || '').split(':')[0]
  const key = /files|library|log/.test(tool) ? 'toolFiles' : /search|knowledge|chats|capabilities/.test(tool) ? 'toolSearch' : /web/.test(tool) ? 'toolWeb' : /browser/.test(tool) ? 'toolBrowser'
    : /terminal|process/.test(tool) ? 'toolCommand' : /python/.test(tool) ? 'toolPython' : /skill/.test(tool) ? 'toolSkill' : /desktop|screen/.test(tool) ? 'toolDesktop' : 'toolOther'
  return t(key)
}
function paintAsk(ask) {
  const working = ['queued', 'running', 'waiting_approval'].includes(ask.state)
  $('answer').hidden = false
  $('send').hidden = working; $('stop').hidden = !working; $('ask-text').disabled = working
  $('new-ask').hidden = working
  $('answer-state').textContent = ask.state === 'queued' ? t('queued') : ask.state === 'waiting_approval' ? t('waitingApproval') : ask.state === 'running' ? t('working')
    : ask.state === 'done' ? t('done') : ask.state === 'cancelled' ? t('cancelled') : /UNKNOWN_EFFECT/.test(ask.progress || '') ? t('unconfirmed') : t('failed')
  $('answer-state').dataset.state = ask.state
  $('answer-progress').textContent = working && ask.state !== 'waiting_approval' && ask.progress ? label(ask.progress) : ''
  $('answer-output').textContent = ask.output || ''
  $('answer-output-wrap').hidden = !ask.output
  $('answer-truncated').hidden = ask.outputTruncated !== true
}
async function poll() {
  if (current.polling) return
  current.polling = true
  try {
    while (current.ask) {
      const result = await send({ type: 'najd:ask-status', id: current.ask })
      if (!result?.ok || !result.ask) { if (result?.error === 'REJECTED' || result?.error === 'OFFLINE') break; await new Promise(resolve => setTimeout(resolve, 1500)); continue }
      paintAsk(result.ask)
      if (!['queued', 'running', 'waiting_approval'].includes(result.ask.state)) break
      await new Promise(resolve => setTimeout(resolve, 1000))
    }
  } finally { current.polling = false }
}
async function restoreAsk() {
  if (!current.ask) { const { najdAsk } = await chrome.storage.session.get('najdAsk'); current.ask = najdAsk || null }
  if (current.ask) void poll()
  await takePrompt()
}
$('ask-form').addEventListener('submit', async event => {
  event.preventDefault()
  // With a selection and no typed question, a fixed question is used; the selected text itself is never promoted to the question.
  const text = $('ask-text').value.trim() || (pendingPrompt?.text ? t('defaultSelectionQuestion') : '')
  if (!text) return
  $('ask-error').hidden = true; $('send').disabled = true
  const page = await pageInfo()
  // A selection longer than NAJD takes (2000 characters) is said before sending, so an answer is never taken for one about all of it.
  if ((page?.selection?.length || 0) > 2000 && !selectionNoteShown) { selectionNoteShown = true; $('selection-note').hidden = false; $('send').disabled = false; return }
  // The address and title of a page are only available once website access is allowed. If the box is ticked and they are not, the user is told
  // before anything is sent (and can allow access or send without them), instead of the details silently going missing.
  if ($('include-page').checked && !page?.url && !pageNoteShown) { pageNoteShown = true; $('page-note').hidden = false; $('send').disabled = false; return }
  const result = await send({ type: 'najd:ask', text, page })
  $('send').disabled = false
  if (!result?.ok) { $('ask-error').hidden = false; $('ask-error').textContent = result?.error === 'TOO_MANY_REQUESTS' ? t('tooMany') : t('askFailed'); return }
  current.ask = result.id; pendingPrompt = null; pageNoteShown = false; selectionNoteShown = false; $('page-note').hidden = true; $('selection-note').hidden = true; $('selection-chip').hidden = true
  await chrome.storage.session.set({ najdAsk: result.id })
  paintAsk({ state: result.state || 'queued', progress: '', output: '' })
  void poll()
})
$('ask-text').addEventListener('keydown', event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); $('ask-form').requestSubmit() } })
$('stop').addEventListener('click', async () => { if (current.ask) await send({ type: 'najd:ask-cancel', id: current.ask }) })
$('new-ask').addEventListener('click', async () => { current.ask = null; await chrome.storage.session.remove('najdAsk'); $('answer').hidden = true; $('send').hidden = false; $('ask-text').disabled = false; $('ask-text').value = ''; $('ask-text').focus() })
$('copy').addEventListener('click', async () => { try { await navigator.clipboard.writeText($('answer-output').textContent || ''); $('copy').textContent = t('copied'); setTimeout(() => { $('copy').textContent = t('copy') }, 1500) } catch {} })

chrome.storage.onChanged.addListener(() => { void render() })
void render()
