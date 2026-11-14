// Local bridge between NAJD and the NAJD browser extension (Chrome/Edge).
// - Loopback only, fixed port range so the extension can reconnect after restarts.
// - Pairing: the extension finds NAJD on the fixed ports and asks to connect; the user confirms in a native NAJD dialog (a code is shown on both sides),
//   or types the one-time code from NAJD Settings. Each paired browser has its own secret, stored encrypted, bound to the extension origin.
// - The extension long-polls for commands and posts results; NAJD never connects to the browser.
// - Commands act only in NAJD's own browser tab (the extension keeps it in a "NAJD" tab group).
const http = require('node:http')
const { replaceFile } = require('./atomic-file.cjs')
const fs = require('node:fs/promises')
const path = require('node:path')
const { randomBytes, randomInt, randomUUID, timingSafeEqual } = require('node:crypto')
const { flagPage } = require('./browser-policy.cjs')

// Spread across distant ranges: Windows (Hyper-V, WSL, Docker) can silently reserve whole port blocks.
const PORTS = [38127, 38128, 31227, 31228, 27127, 27128, 39127, 33127]
const extensionOrigin = /^chrome-extension:\/\/[a-p]{32}$/
// A link is identified by the extension AND its installation: the same store extension in two browser profiles has the same origin but its own instance id.
const linkKey = /^chrome-extension:\/\/[a-p]{32}(\|[a-f0-9]{32})?$/
const originOf = key => String(key).split('|')[0]
const MAX_BODY = 6 * 1024 * 1024 // one copy of a page (a 300,000-character budget, at most four bytes each, plus escaping) and one picture of it
const MAX_PICTURE = 3 * 1024 * 1024 // bytes of the picture of the visible page the owner adds in the side panel (JPEG or PNG)
const fail = code => Object.assign(new Error(code), { code })
const demoPage = language => {
  const ar = language === 'ar'
  return `<!doctype html><html lang="${ar ? 'ar' : 'en'}" dir="${ar ? 'rtl' : 'ltr'}"><meta charset="utf-8"><title>${ar ? 'تجربة متصفح نجد' : 'NAJD browser practice'}</title><style>body{font:18px system-ui;max-width:650px;margin:70px auto;padding:20px;background:#171717;color:#eee}button,input{font:inherit;padding:10px;margin:10px 0;border-radius:8px}button{cursor:pointer}</style><h1>${ar ? 'صفحة تدريب نجد' : 'NAJD practice page'}</h1><p>${ar ? 'هذه صفحة محلية للتجربة. لا تستخدم حسابًا أو بيانات مهمة.' : 'This local page is for practice. Do not enter an account or sensitive data.'}</p><button id="practice-button" type="button">${ar ? 'اضغط للتجربة' : 'Click for practice'}</button><p id="click-count">${ar ? 'عدد النقرات: ' : 'Clicks: '}<span id="count">0</span></p><label for="practice-input">${ar ? 'نص للتجربة' : 'Practice text'}</label><br><input id="practice-input" type="text" autocomplete="off"><script>document.getElementById('practice-button').addEventListener('click',()=>{const n=document.getElementById('count');n.textContent=String(Number(n.textContent)+1)})</script></html>`
}

// A paired browser extension, identified by its origin. Several can be paired (for example Chrome and Edge); commands go to the one seen most recently.
const MAX_LINKS = 4
const PAIR_TTL_MS = 2 * 60 * 1000
const MAX_ASKS = 20
const MAX_PAGE_TEXT = 12000 // characters of the open page's visible text sent with a side-panel question
const MAX_ATTACHMENT = 20000 // characters of a text file attached in the side panel
const MAX_TABS = 3, MAX_TAB_TEXT = 6000 // other open tabs the owner picked with @ in the side panel, and the characters of each
const MAX_ANSWER = 60000 // characters of an answer shown in the browser panel; a longer one is cut and the panel says so
const TERMINAL = ['done', 'failed', 'cancelled']
const MAX_STEPS = 40 // tool-call steps shown under one answer in the side panel
const STEP_KINDS = ['reasoning', 'read', 'browse', 'work', 'approval']
const SESSION_IDLE_MS = 2 * 60 * 1000 // a browser session (the banner in the browser) ends this long after NAJD's last command
const origin64 = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
const same = (left, right) => { const a = Buffer.from(String(left)), b = Buffer.from(String(right)); return a.length === b.length && a.length > 0 && timingSafeEqual(a, b) }
const digits = () => String(randomInt(0, 1000000)).padStart(6, '0')

// The live "Tool calls" list of a side-panel answer, derived from the task's recorded activity (task-activity.cjs events).
// Only kinds, states, tool names and short redacted details leave NAJD; the model's own thinking text never does.
function stepsFromEvents(events) {
  const steps = []
  const close = (state, match) => { for (let i = steps.length - 1; i >= 0; i--) if (steps[i].state === 'running' && match(steps[i])) { steps[i].state = state; return } }
  const closeAll = state => { for (const step of steps) if (step.state === 'running') step.state = state }
  const kindOf = tool => /browser/.test(tool) ? 'browse' : /read|web|fetch|search|knowledge|chats|files|document/.test(tool) ? 'read' : 'work'
  const acting = step => step.kind !== 'reasoning' && step.kind !== 'approval'
  for (const event of Array.isArray(events) ? events : []) {
    if (!event || typeof event !== 'object') continue
    const tool = typeof event.tool === 'string' && /^najd-[a-z-]{1,60}$/.test(event.tool) ? event.tool : undefined
    const detail = typeof event.detail === 'string' ? event.detail.replace(/[\x00-\x1f]+/g, ' ').trim().slice(0, 160) : ''
    switch (event.type) {
      case 'task.started': steps.push({ kind: 'reasoning', state: 'running' }); break
      case 'reasoning.summary': {
        const open = [...steps].reverse().find(step => step.kind === 'reasoning' && step.state === 'running')
        if (open) { if (detail) open.detail = detail } else steps.push({ kind: 'reasoning', state: 'running', ...(detail ? { detail } : {}) })
        break
      }
      case 'tool.started': close('done', step => step.kind === 'reasoning'); steps.push({ kind: kindOf(tool || ''), state: 'running', ...(tool ? { tool } : {}), ...(detail ? { detail } : {}) }); break
      case 'tool.completed': close('done', step => acting(step) && step.tool === tool); break
      case 'tool.failed': close('failed', step => acting(step) && step.tool === tool); break
      case 'approval.requested': steps.push({ kind: 'approval', state: 'running' }); break
      case 'approval.resolved': close(event.decision === 'DENY' ? 'failed' : 'done', step => step.kind === 'approval'); break
      case 'task.completed': closeAll('done'); break
      case 'task.failed': case 'task.cancelled': case 'task.unknown_effect': closeAll('failed'); break
    }
  }
  return steps.slice(-MAX_STEPS)
}
// What the bridge accepts as steps (the app derives them; anything else is dropped).
const cleanSteps = value => Array.isArray(value) ? value.slice(-MAX_STEPS).filter(step => step && typeof step === 'object' && STEP_KINDS.includes(step.kind) && ['running', 'done', 'failed'].includes(step.state))
  .map(step => ({ kind: step.kind, state: step.state, ...(typeof step.tool === 'string' && /^najd-[a-z-]{1,60}$/.test(step.tool) ? { tool: step.tool } : {}),
    ...(typeof step.detail === 'string' && step.detail.trim() ? { detail: step.detail.replace(/[\x00-\x1f]+/g, ' ').trim().slice(0, 160) } : {}) })) : null

// ready: resolves once masking is available (saved passwords loaded); a question is not read, masked or stored before that, and is refused if it fails.
// sanitize: applied to every page the extension reports, before it is stored or handed on (secrets must not outlive the moment they are seen).
function createBrowserBridge({ filePath, encryption, ports = PORTS, pollMs = 25000, now = Date.now, sanitize = value => value, ready = async () => {} } = {}) {
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) throw fail('INVALID_INPUT')
  let server = null, port = null
  const links = new Map() // origin -> { origin, secret, name, createdAt, lastSeenAt, waiting }
  let oneTimeCode = null, codeFailures = { count: 0, until: 0 }
  const pending = new Map() // pairing request id -> { id, origin, name, version, code, createdAt, state, secret, timer }
  const pairHistory = new Map() // origin -> timestamps of recent pairing requests (rate limit)
  const asks = new Map() // ask id -> { id, origin, text, page, state, taskId, progress, output, needsApproval, createdAt, updatedAt }
  const askHistory = new Map() // origin -> timestamps of recent asks
  const queue = [], inflight = new Map()
  let lastPage = null // latest page snapshot reported by the extension
  let pageGeneration = 0 // changes with every page report: an approval is only valid for the page it was given for
  let lastPageOrigin = null // the browser that page came from: element ids and approvals only ever apply to that browser
  const handlers = { onPairRequest: () => {}, onAsk: () => {}, onAskCancel: () => {}, onModels: async () => [], onSkills: async () => [], onSessionStop: () => {}, onAskShow: () => {} }
  // Models the side panel may choose from: exactly the list NAJD served last (a choice outside it is ignored, never trusted).
  let modelChoices = []
  // The task using the browser now (its commands carry it as owner). The extension shows a banner with Cancel while it lasts.
  let session = null // { owner, since, lastAt }
  const sessionActive = () => !!session && now() - session.lastAt < SESSION_IDLE_MS

  async function load() {
    try {
      const record = JSON.parse(await fs.readFile(filePath, 'utf8'))
      if (record.version !== 2 || typeof record.sealed !== 'string') throw new Error()
      const opened = JSON.parse(encryption.decryptString(Buffer.from(record.sealed, 'base64')))
      if (!Array.isArray(opened.links) || opened.links.length > MAX_LINKS) throw new Error()
      for (const item of opened.links) {
        if (!origin64(item.secret) || !linkKey.test(item.origin)) throw new Error()
        links.set(item.origin, { origin: item.origin, secret: item.secret, name: String(item.name || '').slice(0, 60), createdAt: Number(item.createdAt) || 0, lastSeenAt: 0, waiting: null })
      }
    } catch { links.clear(); await save() }
  }
  // Saves are chained so an older state can never be written after a newer one.
  let saving = Promise.resolve()
  const save = () => (saving = saving.catch(() => {}).then(writeLinks))
  async function writeLinks() {
    if (!encryption?.isEncryptionAvailable?.()) return // in-memory only: links are not remembered across restarts
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    const sealed = encryption.encryptString(JSON.stringify({ links: [...links.values()].map(({ origin, secret, name, createdAt }) => ({ origin, secret, name, createdAt })) })).toString('base64')
    const temp = filePath + '.' + randomUUID() + '.tmp'
    await fs.writeFile(temp, JSON.stringify({ version: 2, sealed }), { mode: 0o600 }); await replaceFile(temp, filePath)
  }
  const connected = link => !!link && !!link.lastSeenAt && now() - link.lastSeenAt < pollMs + 10000
  const activeLink = () => [...links.values()].filter(connected).sort((a, b) => b.lastSeenAt - a.lastSeenAt)[0] || null
  const pageToken = () => (lastPageOrigin ? lastPageOrigin + '#' + pageGeneration : null)
  const rotateCode = () => { oneTimeCode = randomBytes(32).toString('hex'); return oneTimeCode }

  async function grant(origin, name) {
    if (!links.has(origin) && links.size >= MAX_LINKS) throw fail('TOO_MANY_BROWSERS')
    const existing = links.get(origin)
    if (existing?.waiting) { clearTimeout(existing.waiting.timer); existing.waiting.writeHead(204).end() }
    const link = { origin, secret: randomBytes(32).toString('hex'), name: String(name || '').slice(0, 60), createdAt: now(), lastSeenAt: 0, waiting: null }
    links.set(origin, link)
    await save()
    return link
  }

  // ---- identity ----
  // Browsers omit Origin on requests from an extension that has site access, so the extension names itself in
  // X-NAJD-Extension. A web page cannot send that header without a CORS preflight, and a preflight from a page
  // carries the page's Origin, which is refused. Pairing and every later call still need approval or the link secret.
  function identify(request, response) {
    const sentOrigin = request.headers.origin, named = request.headers['x-najd-extension']
    if (sentOrigin !== undefined && !extensionOrigin.test(sentOrigin)) { response.writeHead(403).end(); return null }
    const base = sentOrigin || (typeof named === 'string' && /^[a-p]{32}$/.test(named) ? 'chrome-extension://' + named : null)
    if (!base) { response.writeHead(403).end(); return null }
    // The installation id is sent by the extension with every call; without it (older builds) the extension is one installation.
    const instance = request.headers['x-najd-instance']
    const identity = typeof instance === 'string' && /^[a-f0-9]{32}$/.test(instance) ? base + '|' + instance : base
    if (sentOrigin) { response.setHeader('Access-Control-Allow-Origin', sentOrigin); response.setHeader('Vary', 'Origin') }
    response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-NAJD-Extension, X-NAJD-Instance, X-NAJD-Version'); response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    response.setHeader('Cache-Control', 'no-store')
    return identity
  }
  const linkFor = (request, identity) => {
    const link = links.get(identity)
    const supplied = String(request.headers.authorization || '').replace(/^Bearer /, '')
    if (!link || !same(supplied, link.secret)) return null
    // The version of the extension actually loaded in that browser, as it reports it with every call (shown in Settings and checked by NAJD).
    const version = request.headers['x-najd-version']
    if (typeof version === 'string' && /^\d+\.\d+\.\d+$/.test(version)) link.loadedVersion = version
    return link
  }
  const json = (response, status, body) => response.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(body))
  async function readJson(request, response) {
    if (request.headers['content-type']?.split(';')[0] !== 'application/json') { response.writeHead(415).end(); return undefined }
    const chunks = []; let size = 0
    for await (const chunk of request) { size += chunk.length; if (size > MAX_BODY) { response.writeHead(413).end(); return undefined } chunks.push(chunk) }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { response.writeHead(400).end(); return undefined }
  }
  const recent = (map, key, windowMs, limit) => {
    const list = (map.get(key) || []).filter(at => now() - at < windowMs)
    if (list.length >= limit) { map.set(key, list); return false }
    list.push(now()); map.set(key, list); return true
  }

  // A command goes only to the browser it was bound to when it was queued (never to whichever browser polled last).
  function flush() {
    for (const link of links.values()) {
      if (!link.waiting) continue
      // A bound command is checked again at the last moment: if the page changed while it waited, it is refused, not sent.
      for (const stale of queue.filter(entry => entry.bind !== null && entry.bind !== pageToken())) { queue.splice(queue.indexOf(stale), 1); clearTimeout(stale.timer); stale.reject(fail('PAGE_CHANGED')) }
      const index = queue.findIndex(entry => entry.target === link.origin)
      if (index < 0) continue
      const [command] = queue.splice(index, 1), response = link.waiting
      link.waiting = null; clearTimeout(response.timer)
      command.link = link.origin
      inflight.set(command.id, command)
      response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify({ id: command.id, kind: command.kind, args: command.args, ...(command.owner ? { session: true } : {}) }))
    }
  }
  // Removes one browser: its commands end, outstanding pairing approvals for it are void, and the fallback code changes.
  function revoke(origin) {
    const link = links.get(origin)
    if (link?.waiting) { clearTimeout(link.waiting.timer); link.waiting.writeHead(204).end(); link.waiting = null }
    links.delete(origin)
    for (const item of pending.values()) {
      if (item.origin !== origin || !['pending', 'approved'].includes(item.state)) continue
      item.state = 'denied'; item.secret = null; clearTimeout(item.timer)
      for (const wake of item.waiters.splice(0)) wake()
    }
    for (const entry of [...queue]) if (entry.target === origin) { queue.splice(queue.indexOf(entry), 1); clearTimeout(entry.timer); entry.reject(fail('BROWSER_NOT_CONNECTED')) }
    for (const entry of [...inflight.values()]) if (entry.link === origin) { inflight.delete(entry.id); clearTimeout(entry.timer); entry.reject(fail('BROWSER_ACTION_UNKNOWN')) }
    if (lastPageOrigin === origin) { lastPage = null; lastPageOrigin = null; pageGeneration++ }
    rotateCode()
  }

  // Longer than the final limits by OVERLAP: values are masked first and only then cut (a password at a limit cannot leak its start).
  const OVERLAP = 9100 // the longest encoded form of a saved password (1000 characters, up to 9 each: a BMP character is nine characters under encodeURIComponent)
  const cleanUrl = value => {
    try { const parsed = new URL(String(value)); if (['http:', 'https:'].includes(parsed.protocol) && !parsed.username && !parsed.password) { parsed.hash = ''; return parsed.toString().slice(0, 500 + OVERLAP) } } catch {}
    return ''
  }
  const cleanPage = value => {
    if (!value || typeof value !== 'object') return null
    const url = cleanUrl(value.url)
    const block = (text, limit) => String(text || '').replace(/[\x00-\x08\x0b-\x1f]+/g, ' ').slice(0, limit + OVERLAP)
    const attachment = value.attachment && typeof value.attachment === 'object' && typeof value.attachment.text === 'string' && value.attachment.text.trim()
      ? { name: String(value.attachment.name || '').replace(/[\x00-\x1f\\/]+/g, ' ').trim().slice(0, 120), text: block(value.attachment.text, MAX_ATTACHMENT) } : null
    // Other tabs named with @: only web pages, at most MAX_TABS, each with its own address, title and visible text.
    const tabs = (Array.isArray(value.tabs) ? value.tabs.slice(0, MAX_TABS) : []).map(tab => tab && typeof tab === 'object'
      ? { url: cleanUrl(tab.url), title: String(tab.title || '').replace(/[\x00-\x1f]+/g, ' ').slice(0, 200 + OVERLAP), text: block(tab.text, MAX_TAB_TEXT) } : null).filter(tab => tab?.url)
    return { url, title: String(value.title || '').replace(/[\x00-\x1f]+/g, ' ').slice(0, 200 + OVERLAP), selection: block(value.selection, 2000),
      text: block(value.text, MAX_PAGE_TEXT), lang: typeof value.lang === 'string' && /^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{1,8})?$/.test(value.lang) ? value.lang : '', attachment, ...(tabs.length ? { tabs } : {}) }
  }
  // The picture of the page (base64 from the panel): a JPEG or PNG within MAX_PICTURE, recognised by its first bytes; anything else is refused.
  const cleanPicture = value => {
    if (typeof value !== 'string' || !value || value.length > Math.ceil(MAX_PICTURE / 3) * 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return null
    const bytes = Buffer.from(value, 'base64')
    if (!bytes.length || bytes.length > MAX_PICTURE) return null
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { name: 'page.jpg', bytes }
    if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { name: 'page.png', bytes }
    return null
  }
  // A selection longer than the limit is cut AND says so inside the text the model receives (the panel also warns before sending).
  const boundSelection = text => { const value = String(text || ''); return value.length > 2000 ? value.slice(0, 1900) + '\n[…only the first 1900 of ' + value.length + ' selected characters were supplied]' : value }
  // The visible text of the page and an attached text file are cut the same way, and say so inside the text.
  const boundBlock = (text, limit, what) => { const value = String(text || ''); return value.length > limit ? value.slice(0, limit - 100) + '\n[…cut: only the first ' + (limit - 100) + ' characters of the ' + what + ' were supplied]' : value }
  const boundQuestionPage = page => page ? { url: String(page.url || '').slice(0, 500), title: String(page.title || '').slice(0, 200), selection: boundSelection(page.selection),
    text: boundBlock(page.text, MAX_PAGE_TEXT, 'page text'), lang: page.lang || '',
    ...(page.attachment ? { attachment: { name: page.attachment.name, text: boundBlock(page.attachment.text, MAX_ATTACHMENT, 'attached file') } } : {}),
    ...(page.tabs?.length ? { tabs: page.tabs.map(tab => ({ url: String(tab.url).slice(0, 500), title: String(tab.title || '').slice(0, 200), text: boundBlock(tab.text, MAX_TAB_TEXT, 'tab text') })) } : {}) } : null
  // The extension's page report is masked and then cut to the limits the rest of NAJD expects.
  const boundReport = page => {
    if (!page || typeof page !== 'object') return page
    const cutString = (value, limit) => typeof value === 'string' ? value.slice(0, limit) : value
    return { ...page, url: cutString(page.url, 500), title: cutString(page.title, 200), text: cutString(page.text, 12000),
      elements: Array.isArray(page.elements) ? page.elements.map(item => item && typeof item === 'object' ? { ...item, label: cutString(item.label, 100), target: cutString(item.target, 2000), ...(item.longTarget === true || (typeof item.target === 'string' && item.target.length > 2000) ? { longTarget: true } : {}), href: cutString(item.href, 200),
        ...(Array.isArray(item.optionPairs) ? { optionPairs: item.optionPairs.slice(0, 200).map(pair => Array.isArray(pair) ? [cutString(pair[0], 120), cutString(pair[1], 120), pair[2] === true] : pair) } : {}), form: cutString(item.form, 4000), formAction: cutString(item.formAction, 2000),
        ...(item.formIncomplete === true || (typeof item.form === 'string' && item.form.length > 4000) || (typeof item.formAction === 'string' && item.formAction.length > 2000) ? { formIncomplete: true } : {}),
        ...(Array.isArray(item.options) ? { options: item.options.map(option => cutString(option, 60)) } : {}) } : item) : page.elements }
  }
  const askView = ask => ({ id: ask.id, state: ask.state, progress: ask.progress, output: ask.output, outputTruncated: (ask.outputLength || 0) > MAX_ANSWER, outputLength: ask.outputLength || 0, needsApproval: ask.needsApproval, steps: ask.steps || [], updatedAt: ask.updatedAt })

  async function handle(request, response) {
    const route = new URL(request.url, 'http://127.0.0.1')
    if (route.pathname === '/demo' && request.method === 'GET') {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer',
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; form-action 'none'; connect-src 'none'" }).end(demoPage(route.searchParams.get('lang')))
      return
    }
    const identity = identify(request, response)
    if (!identity) return
    if (request.method === 'OPTIONS') { response.writeHead(204).end(); return }

    // ---- no secret yet: discovery and pairing ----
    if (route.pathname === '/v2/discover' && request.method === 'GET') { json(response, 200, { ok: true, app: 'NAJD AGENT', protocol: 3, paired: links.has(identity) }); return }
    if (route.pathname === '/v2/pair/request' && request.method === 'POST') {
      const input = await readJson(request, response); if (input === undefined) return
      for (const [id, item] of pending) if (item.origin === identity && item.state === 'pending') { clearTimeout(item.timer); pending.delete(id) }
      // Limits that a changing installation id cannot get around: per extension origin, and for the whole bridge (so native confirmation windows cannot be created at will).
      for (const [key, list] of pairHistory) if (!list.some(at => now() - at < 10 * 60 * 1000)) pairHistory.delete(key) // old records are dropped
      // The bridge-wide limit is checked first, so requests refused by it never create per-origin records.
      if ([...pending.values()].filter(item => item.state === 'pending').length >= 3 || !recent(pairHistory, '*', 10 * 60 * 1000, 10) || !recent(pairHistory, originOf(identity), 10 * 60 * 1000, 5)) { json(response, 429, { ok: false, error: 'TOO_MANY_REQUESTS' }); return }
      const item = { id: randomBytes(16).toString('hex'), origin: identity, name: String(input?.name || '').replace(/[\x00-\x1f]+/g, ' ').slice(0, 60), version: String(input?.version || '').slice(0, 20),
        code: digits(), createdAt: now(), state: 'pending', secret: null, waiters: [] }
      item.timer = setTimeout(() => { if (item.state === 'pending') { item.state = 'expired'; for (const wake of item.waiters.splice(0)) wake() } setTimeout(() => pending.delete(item.id), 30000).unref?.() }, PAIR_TTL_MS)
      item.timer.unref?.()
      pending.set(item.id, item)
      try { handlers.onPairRequest({ id: item.id, origin: item.origin, name: item.name, version: item.version, code: item.code }) } catch {}
      json(response, 200, { ok: true, id: item.id, code: item.code, expiresInMs: PAIR_TTL_MS })
      return
    }
    if (route.pathname === '/v2/pair/status' && request.method === 'GET') {
      const item = pending.get(route.searchParams.get('id') || '')
      if (!item || item.origin !== identity) { json(response, 404, { ok: false, error: 'NOT_FOUND' }); return }
      const wait = Math.min(25000, Math.max(0, Number(route.searchParams.get('wait')) || 0))
      if (item.state === 'pending' && wait) await new Promise(resolve => { const timer = setTimeout(resolve, wait); item.waiters.push(() => { clearTimeout(timer); resolve() }); request.on('close', resolve) })
      if (item.state === 'approved') { const secret = item.secret; item.secret = null; item.state = 'delivered'; json(response, 200, { ok: true, state: 'approved', secret }); return }
      json(response, 200, { ok: true, state: item.state === 'delivered' ? 'delivered' : item.state })
      return
    }
    if (route.pathname === '/v2/pair/code' && request.method === 'POST') {
      const input = await readJson(request, response); if (input === undefined) return
      if (now() < codeFailures.until) { json(response, 429, { ok: false, error: 'TOO_MANY_ATTEMPTS' }); return }
      if (!oneTimeCode || !origin64(input?.code) || !same(input.code, oneTimeCode)) {
        codeFailures.count++; if (codeFailures.count >= 5) codeFailures = { count: 0, until: now() + 60000 }
        json(response, 401, { ok: false, error: 'BAD_CODE' }); return
      }
      codeFailures = { count: 0, until: 0 }
      // The code is spent before anything is awaited, so two requests with the same code cannot both succeed.
      const spent = oneTimeCode
      rotateCode()
      let link
      try { link = await grant(identity, input?.name) } catch (failure) { oneTimeCode = spent; json(response, 409, { ok: false, error: failure.code || 'FAILED' }); return }
      json(response, 200, { ok: true, secret: link.secret })
      return
    }

    // ---- everything else needs this browser's link secret ----
    const link = linkFor(request, identity)
    if (!link) { response.writeHead(401).end(); return }
    link.lastSeenAt = now()
    // chat: this app continues side-panel follow-ups in one conversation and takes page text, models and tool-call steps (R-067).
    if (route.pathname === '/v2/hello' && request.method === 'GET') { json(response, 200, { ok: true, app: 'NAJD AGENT', version: 3, chat: true }); return }
    if (route.pathname === '/v2/unlink' && request.method === 'POST') { revoke(identity); await save(); json(response, 200, { ok: true }); return }
    if (route.pathname === '/v2/command/next' && request.method === 'GET') {
      if (link.waiting) { clearTimeout(link.waiting.timer); link.waiting.writeHead(204).end() }
      link.waiting = response
      response.timer = setTimeout(() => { if (link.waiting === response) { link.waiting = null; response.writeHead(204, { 'Cache-Control': 'no-store' }).end() } }, pollMs)
      request.on('close', () => { if (link.waiting === response) { clearTimeout(response.timer); link.waiting = null } })
      flush()
      return
    }
    if (route.pathname === '/v2/command/result' && request.method === 'POST') {
      const input = await readJson(request, response); if (input === undefined) return
      const command = inflight.get(input?.id)
      if (!command || command.link !== identity) { response.writeHead(422).end(); return }
      inflight.delete(command.id); clearTimeout(command.timer)
      // Sensitivity is decided from the complete page first, then saved passwords are masked, then the limits apply.
      const reported = input.page ? boundReport(sanitize(flagPage(input.page))) : null
      if (reported) { lastPage = reported; lastPageOrigin = identity; pageGeneration++ }
      if (input.ok === true) command.resolve(input.resultIsPage === true && reported ? reported : sanitize(input.result ?? null))
      else command.reject(fail(typeof input.error === 'string' && /^[A-Z_]{3,40}$/.test(input.error) ? input.error : 'BROWSER_ACTION_FAILED'))
      json(response, 200, { ok: true })
      return
    }

    // ---- asking NAJD from the browser ----
    if (route.pathname === '/v2/ask' && request.method === 'POST') {
      const input = await readJson(request, response); if (input === undefined) return
      try { await ready() } catch { json(response, 503, { ok: false, error: 'PROTECTION_UNAVAILABLE' }); return }
      const text = typeof input?.text === 'string' ? sanitize(input.text.replace(/\u0000/g, '').trim()) : ''
      if (!text || text.length > 4000000) { json(response, 400, { ok: false, error: 'INVALID_INPUT' }); return }
      const picture = input?.page && typeof input.page === 'object' && input.page.picture !== undefined ? cleanPicture(input.page.picture) : undefined
      if (picture === null) { json(response, 400, { ok: false, error: 'INVALID_INPUT' }); return }
      if (!recent(askHistory, identity, 60 * 1000, 6)) { json(response, 429, { ok: false, error: 'TOO_MANY_REQUESTS' }); return }
      // Only finished questions are forgotten to make room; a running one must stay stoppable.
      while (asks.size >= MAX_ASKS) {
        const old = [...asks.values()].find(item => TERMINAL.includes(item.state))
        if (!old) break
        asks.delete(old.id)
      }
      if (asks.size >= MAX_ASKS) { json(response, 429, { ok: false, error: 'TOO_MANY_ACTIVE' }); return }
      // A follow-up continues the conversation of an earlier question from this same browser (one that reached a task); anything else starts a new one.
      const previous = typeof input?.after === 'string' ? asks.get(input.after) : null
      const after = previous && previous.origin === identity && previous.taskId ? { taskId: previous.taskId } : null
      const chosen = input?.model && typeof input.model === 'object' ? modelChoices.find(item => item.provider === input.model.provider && item.model === input.model.model) : null
      const ask = { id: randomBytes(12).toString('hex'), origin: identity, text, page: boundQuestionPage(sanitize(cleanPage(input.page))), state: 'queued', taskId: null, progress: '', output: '', needsApproval: false, steps: [], createdAt: now(), updatedAt: now() }
      asks.set(ask.id, ask)
      let accepted = true
      try { accepted = (await handlers.onAsk({ id: ask.id, text: ask.text, page: ask.page, after, model: chosen ? { provider: chosen.provider, model: chosen.model } : null, ...(picture ? { picture } : {}) })) !== false } catch { accepted = false }
      if (!accepted) { ask.state = 'failed'; ask.progress = 'NAJD_BUSY' }
      json(response, 200, { ok: accepted, id: ask.id, state: ask.state })
      return
    }
    // Models NAJD can answer with, for the panel's model selector (names only; a choice is checked against this list).
    if (route.pathname === '/v2/models' && request.method === 'GET') {
      let list
      try { list = await Promise.race([handlers.onModels(), new Promise(resolve => { setTimeout(() => resolve(null), 6000).unref?.() })]) } catch { list = null }
      if (Array.isArray(list)) modelChoices = list.filter(item => item && typeof item.provider === 'string' && /^[a-z0-9-]{1,40}$/.test(item.provider) && typeof item.model === 'string' && item.model.length > 0 && item.model.length <= 200)
        .slice(0, 200).map(item => ({ provider: item.provider, providerName: String(item.providerName || item.provider).replace(/[\x00-\x1f]+/g, ' ').slice(0, 60), model: item.model, name: String(item.name || item.model).replace(/[\x00-\x1f]+/g, ' ').slice(0, 100) }))
      json(response, 200, { ok: true, models: modelChoices })
      return
    }
    // Skills for "/" in the panel (names and short descriptions only; choosing one only writes "Use the skill ..." into the question box).
    if (route.pathname === '/v2/skills' && request.method === 'GET') {
      let list
      try { list = await Promise.race([handlers.onSkills(), new Promise(resolve => { setTimeout(() => resolve(null), 6000).unref?.() })]) } catch { list = null }
      const skills = (Array.isArray(list) ? list : []).filter(item => item && typeof item.id === 'string' && /^[a-z0-9][a-z0-9-]{0,79}$/.test(item.id)).slice(0, 400)
        .map(item => ({ id: item.id, name: String(item.name || item.id).replace(/[\x00-\x1f]+/g, ' ').trim().slice(0, 80) || item.id, description: String(item.description || '').replace(/[\x00-\x1f]+/g, ' ').trim().slice(0, 160) }))
      json(response, 200, { ok: true, skills })
      return
    }
    // The banner in the browser: whether NAJD is working in this browser now, and Cancel (which stops that task in the app).
    if (route.pathname === '/v2/session' && request.method === 'GET') { const active = sessionActive() && lastPageOrigin === identity; json(response, 200, { ok: true, active, since: active ? session.since : null }); return }
    if (route.pathname === '/v2/session/stop' && request.method === 'POST') {
      const owner = sessionActive() && lastPageOrigin === identity ? session.owner : null
      if (owner) {
        session = null
        for (const entry of [...queue]) if (entry.owner === owner) { queue.splice(queue.indexOf(entry), 1); clearTimeout(entry.timer); entry.reject(fail('CANCELLED')) }
        try { handlers.onSessionStop({ taskId: owner }) } catch {}
      }
      json(response, 200, { ok: true, stopped: !!owner }); return
    }
    const askRoute = /^\/v2\/ask\/([a-f0-9]{24})(\/cancel|\/show)?$/.exec(route.pathname)
    if (askRoute) {
      const ask = asks.get(askRoute[1])
      if (!ask || ask.origin !== identity) { json(response, 404, { ok: false, error: 'NOT_FOUND' }); return }
      // "Review in NAJD": brings the app forward where the approval waits (the decision itself is only ever made there).
      if (askRoute[2] === '/show' && request.method === 'POST') { try { handlers.onAskShow({ id: ask.id, taskId: ask.taskId }) } catch {} json(response, 200, { ok: true }); return }
      if (askRoute[2] && request.method === 'POST') {
        // Recorded by id at once: a question that has not started yet is cancelled before it can start.
        ask.cancelled = true
        if (!TERMINAL.includes(ask.state)) {
          // A task that exists is stopped by the app, which reports how it ended (cancelled, or an unknown effect if an action was already
          // sent). Until then the question is "stopping", not "stopped". A question without a task never started.
          if (ask.taskId) { ask.state = 'running'; ask.progress = 'STOPPING' } else ask.state = 'cancelled'
          ask.needsApproval = false; ask.updatedAt = now()
        }
        try { handlers.onAskCancel({ id: ask.id, taskId: ask.taskId }) } catch {}
        json(response, 200, { ok: true }); return
      }
      if (request.method === 'GET') { json(response, 200, { ok: true, ...askView(ask) }); return }
    }
    response.writeHead(404).end()
  }

  async function start() {
    if (server) return status()
    await load()
    if (!oneTimeCode) rotateCode()
    // Last resort: any free port. The link code carries the port, so linking still works until NAJD restarts.
    for (const candidate of [...ports, 0]) {
      const next = http.createServer((request, response) => { handle(request, response).catch(() => { if (!response.headersSent) response.writeHead(500).end() }) })
      try {
        await new Promise((resolve, reject) => { next.once('error', reject); next.listen(candidate, '127.0.0.1', resolve) })
        server = next; port = next.address().port
        return status()
      } catch { next.close() }
    }
    throw fail('PORT_IN_USE')
  }
  function status() {
    const list = [...links.values()].map(link => ({ version: link.loadedVersion || null, id: originOf(link.origin).slice('chrome-extension://'.length), instance: link.origin.split('|')[1] || '', name: link.name, connected: connected(link), lastSeenAt: link.lastSeenAt ? new Date(link.lastSeenAt).toISOString() : null, createdAt: link.createdAt ? new Date(link.createdAt).toISOString() : null }))
    const last = [...links.values()].sort((a, b) => b.lastSeenAt - a.lastSeenAt)[0]
    return { active: !!server, port, connected: list.some(item => item.connected), paired: links.size > 0, links: list, lastSeenAt: last?.lastSeenAt ? new Date(last.lastSeenAt).toISOString() : null,
      page: lastPage ? { title: String(lastPage.title || '').slice(0, 200), url: String(lastPage.url || '').slice(0, 500) } : null }
  }
  async function stop() {
    for (const command of [...queue, ...inflight.values()]) { clearTimeout(command.timer); command.reject(fail('BROWSER_NOT_CONNECTED')) }
    queue.length = 0; inflight.clear()
    for (const link of links.values()) if (link.waiting) { clearTimeout(link.waiting.timer); link.waiting.writeHead(204).end(); link.waiting = null }
    for (const item of pending.values()) { clearTimeout(item.timer); for (const wake of item.waiters.splice(0)) wake() }
    pending.clear()
    const current = server; server = null; port = null
    if (current) await new Promise(resolve => current.close(resolve))
  }

  // Send one command to the active extension and wait for its result (one at a time, in order).
  // bind: the page token captured before an approval. The command then goes only to that browser and only while that page is current:
  // never to another browser that happens to be connected (element ids and approvals belong to one page of one browser).
  // owner: the task (run id) sending the command; while it works, the browser shows NAJD's banner with Cancel.
  // prefer: the browser the user named ("edge", "chrome"): matched against the linked browser's name when several are connected; used only
  // by commands that choose a browser (open, attach), never by commands bound to an approved page.
  function command(kind, args = {}, { timeoutMs = 30000, signal, bind = null, owner = null, prefer = '' } = {}) {
    if (!server) return Promise.reject(fail('BROWSER_NOT_CONNECTED'))
    // Commands follow the page: the browser that reported the current page keeps getting them while it is connected.
    // Otherwise the most recently seen browser is used and the old page (its element ids) is dropped.
    if (bind !== null && bind !== pageToken()) return Promise.reject(fail('PAGE_CHANGED'))
    const bound = lastPageOrigin ? links.get(lastPageOrigin) : null
    const wanted = typeof prefer === 'string' ? prefer.trim().toLowerCase().slice(0, 30) : ''
    const named = link => !wanted || String(link?.name || '').toLowerCase().includes(wanted)
    const choose = () => [...links.values()].filter(link => connected(link) && named(link)).sort((a, b) => b.lastSeenAt - a.lastSeenAt)[0] || null
    const target = bind !== null ? (connected(bound) ? bound : null) : connected(bound) && named(bound) ? bound : wanted ? choose() : activeLink()
    if (!target) return Promise.reject(fail('BROWSER_NOT_CONNECTED'))
    if (signal?.aborted) return Promise.reject(fail('CANCELLED'))
    if (target.origin !== lastPageOrigin) { lastPage = null; lastPageOrigin = null; pageGeneration++ }
    return new Promise((resolve, reject) => {
      const id = randomUUID()
      const ownerId = typeof owner === 'string' && /^[0-9a-f-]{36}$/.test(owner) && kind !== 'park' ? owner : null
      if (ownerId) session = session?.owner === ownerId ? { ...session, lastAt: now() } : { owner: ownerId, since: now(), lastAt: now() }
      const entry = { id, kind, args, resolve, reject, link: null, target: target.origin, bind, owner: ownerId }
      entry.timer = setTimeout(() => {
        const index = queue.indexOf(entry); if (index >= 0) queue.splice(index, 1)
        inflight.delete(id); reject(fail(index >= 0 ? 'BROWSER_NOT_CONNECTED' : 'BROWSER_ACTION_UNKNOWN'))
      }, timeoutMs)
      signal?.addEventListener('abort', () => { const index = queue.indexOf(entry); if (index >= 0) { queue.splice(index, 1); clearTimeout(entry.timer); reject(fail('CANCELLED')) } }, { once: true })
      queue.push(entry); flush()
    })
  }

  return {
    start, stop, status, command,
    lastPage: () => lastPage,
    // The name of the browser that holds the current page ("Microsoft Edge"), so a result can say where it ran.
    lastBrowser: () => (lastPageOrigin ? String(links.get(lastPageOrigin)?.name || '') : ''),
    // Drops the page NAJD holds (after a refusal): no content, no element ids, no approvals bound to it.
    forgetPage() { lastPage = null; lastPageOrigin = null; pageGeneration++ },
    pageToken,
    pairingCode: () => (server && oneTimeCode ? `${port}:${oneTimeCode}` : null),
    rotateCode: () => { rotateCode(); return server ? `${port}:${oneTimeCode}` : null },
    setHandlers: next => { Object.assign(handlers, next) },
    // The user's decision on a pairing request (made in a native NAJD dialog, never by the browser or a page).
    async resolvePair(id, approved) {
      const item = pending.get(id)
      if (!item || item.state !== 'pending') return false
      if (approved === true) {
        try { item.secret = (await grant(item.origin, item.name)).secret; item.state = 'approved' } catch { item.state = 'denied' }
      } else item.state = 'denied'
      clearTimeout(item.timer)
      for (const wake of item.waiters.splice(0)) wake()
      setTimeout(() => pending.delete(id), 30000).unref?.()
      return item.state === 'approved'
    },
    // id: the extension id (all its installations), or with instance only that installation; without id, everything.
    async unpair(id, instance) {
      if (typeof id === 'string') {
        for (const key of [...links.keys()]) if (originOf(key) === 'chrome-extension://' + id && (typeof instance !== 'string' || key.endsWith('|' + instance))) revoke(key)
      } else for (const origin of [...links.keys()]) revoke(origin)
      await save(); return status()
    },
    // Progress reported by the app for an ask (validated here; the extension only ever sees this view).
    updateAsk(id, patch) {
      const ask = asks.get(id)
      if (!ask || !patch || typeof patch !== 'object') return false
      // A finished question stays finished: a late progress report cannot bring it back, and a cancelled one never becomes done.
      const finished = TERMINAL.includes(ask.state)
      // After Stop, the one outcome that may still replace "cancelled" is an action that may already have happened.
      // An action that may already have happened is the one outcome that replaces an earlier failed or cancelled one (never a completed answer).
      const unknownAfterStop = patch.state === 'failed' && patch.progress === 'UNKNOWN_EFFECT' && ask.progress !== 'UNKNOWN_EFFECT' && ['failed', 'cancelled'].includes(ask.state)
      if ((!finished || unknownAfterStop) && ['queued', 'running', 'waiting_approval', 'done', 'failed', 'cancelled'].includes(patch.state) &&
        !(ask.cancelled && !TERMINAL.includes(patch.state)) && !(ask.cancelled && patch.state === 'done')) ask.state = patch.state
      if (typeof patch.taskId === 'string' && /^[0-9a-f-]{36}$/.test(patch.taskId)) ask.taskId = patch.taskId
      if (typeof patch.progress === 'string' && (!finished || unknownAfterStop)) ask.progress = patch.progress.replace(/[\x00-\x1f]+/g, ' ').slice(0, 200)
      if (typeof patch.output === 'string' && (!finished || ((ask.state === 'done' || ask.progress === 'UNKNOWN_EFFECT') && !ask.output))) { ask.output = patch.output.slice(0, MAX_ANSWER); ask.outputLength = patch.output.length }
      const steps = cleanSteps(patch.steps)
      if (steps && (!finished || !ask.steps?.length)) ask.steps = steps
      if (TERMINAL.includes(ask.state)) ask.needsApproval = false
      else if (typeof patch.needsApproval === 'boolean') ask.needsApproval = patch.needsApproval
      ask.updatedAt = now()
      return true
    },
    getAsk: id => { const ask = asks.get(id); return ask ? { ...askView(ask), taskId: ask.taskId, cancelled: ask.cancelled === true } : null },
    // The task using the browser now, and the end of its session (the app calls this when that task finishes).
    sessionOwner: () => (sessionActive() ? session.owner : null),
    endSession: taskId => { if (session && session.owner === taskId) session = null },
    demoUrl: language => { if (!port) throw fail('BROWSER_NOT_CONNECTED'); return `http://127.0.0.1:${port}/demo?lang=${language === 'ar' ? 'ar' : 'en'}` }
  }
}
// Marks each linked extension older than the copy NAJD ships for its major version (1.x or 2.x): an unpacked extension keeps running
// its old code until the owner presses Reload in the browser, so NAJD says so instead of failing on a newer command later.
const versionParts = value => (typeof value === 'string' && /^\d+\.\d+\.\d+$/.test(value) ? value.split('.').map(Number) : null)
function markOutdated(links, bundled = {}) {
  return (Array.isArray(links) ? links : []).map(link => {
    const have = versionParts(link?.version), latest = have && versionParts(bundled[have[0]]) ? bundled[have[0]] : null
    const want = versionParts(latest)
    const older = !!(have && want) && (have[1] < want[1] || (have[1] === want[1] && have[2] < want[2]))
    return { ...link, latest, outdated: older }
  })
}
module.exports = { createBrowserBridge, stepsFromEvents, markOutdated, BRIDGE_PORTS: PORTS }
