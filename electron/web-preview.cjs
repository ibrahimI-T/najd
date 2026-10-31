// Page previews for the agent (owner request 2026-10-20: build websites and check them by eye, as Kimi does with a
// headless browser). A hidden, offscreen window renders a local dev server (localhost/127.0.0.1/[::1]), a public https
// page, or an HTML file in the workspace or a granted folder, at a chosen width, and returns one picture for vision
// models plus the page's console errors.
// Containment (review findings NAJD-R01/R02/R05, I2-001/006/007/008):
// - Every request (first load, redirects, navigations, resources) passes allowRequest() for its capture's mode before it
//   leaves the session: loopback only from a local capture, files only from a file capture through resolveFile().
// - https is not fetched by Chromium at all: fetchHttps() connects from Node to the exact public address it validated
//   (the DNS answer used to connect is the one checked), with normal TLS hostname verification. Redirects come back to
//   the page as redirects and are checked again.
// - Each capture gets its own in-memory session (createSession), cleared when the capture ends, and its window is
//   destroyed; every stage, address checks and DNS included, races the deadline and cancellation.
// - Full-page pictures are taken beyond the viewport without resizing it, so 100vh sections keep their height.
const path = require('node:path'), fs = require('node:fs'), fsp = require('node:fs/promises'), net = require('node:net'), https = require('node:https')
const { Readable } = require('node:stream')
const { pathToFileURL, fileURLToPath } = require('node:url')
const fail = code => Object.assign(new Error(code), { code })
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])
const MAX_HEIGHT = 8000
const HOP_HEADERS = new Set(['host', 'connection', 'keep-alive', 'proxy-connection', 'transfer-encoding', 'upgrade', 'te', 'trailer', 'content-length'])

function privateIPv4(address) {
  const [a, b] = address.split('.').map(Number)
  const c = Number(address.split('.')[2])
  return a === 10 || a === 127 || a === 0 || a >= 224 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168 || a === 100 && b >= 64 && b <= 127 ||
    a === 192 && b === 0 || a === 198 && (b === 18 || b === 19) || a === 198 && b === 51 && c === 100 || a === 203 && b === 0 && c === 113 || a === 192 && b === 88 && c === 99
}
// IPv6 is read as its eight 16-bit groups, so every spelling of an address is classified the same way (I5-001):
// IPv4-mapped (::ffff:7f00:1 and ::ffff:127.0.0.1 alike), IPv4-compatible and NAT64 (64:ff9b::/96) addresses are judged
// by the IPv4 address inside them.
function ipv6Groups(address) {
  let value = address.toLowerCase().replace(/%.*$/, '')
  const dotted = value.match(/(\d+\.\d+\.\d+\.\d+)$/)
  if (dotted) {
    if (!net.isIPv4(dotted[1])) return null
    const [a, b, c, d] = dotted[1].split('.').map(Number)
    value = value.slice(0, -dotted[1].length) + ((a << 8) | b).toString(16) + ':' + ((c << 8) | d).toString(16)
  }
  const halves = value.split('::')
  if (halves.length > 2) return null
  const head = halves[0] ? halves[0].split(':') : [], tail = halves.length === 2 && halves[1] ? halves[1].split(':') : []
  const missing = 8 - head.length - tail.length
  if (halves.length === 1 && missing !== 0 || missing < 0) return null
  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill('0'), ...tail].map(group => /^[0-9a-f]{1,4}$/.test(group) ? parseInt(group, 16) : NaN)
  return groups.length === 8 && groups.every(Number.isInteger) ? groups : null
}
function privateAddress(address) {
  if (net.isIPv4(address)) return privateIPv4(address)
  const groups = ipv6Groups(String(address))
  if (!groups) return true // anything that cannot be read is treated as private
  const embedded = () => [groups[6] >> 8, groups[6] & 255, groups[7] >> 8, groups[7] & 255].join('.')
  const zeros = count => groups.slice(0, count).every(group => group === 0)
  if (zeros(5) && groups[5] === 0xffff) return privateIPv4(embedded()) // IPv4-mapped
  if (zeros(6)) return true // ::, ::1 and the deprecated IPv4-compatible form
  if (groups[0] === 0x64 && groups[1] === 0xff9b && groups.slice(2, 6).every(group => group === 0)) return privateIPv4(embedded()) // NAT64
  // Only global unicast (2000::/3) is public (R12-002): site-local fec0::/10, unique-local, link-local, multicast
  // and every other range are private. Inside it, documentation, Teredo and other special prefixes are refused too, and
  // 6to4 (2002::/16) is judged by its embedded IPv4 address.
  const first = groups[0]
  if ((first & 0xe000) !== 0x2000) return true
  if (first === 0x2001 && (groups[1] === 0x0db8 || groups[1] < 0x0200)) return true // documentation, Teredo, IETF special
  if (first === 0x3fff || first === 0x3ffe) return true // documentation (3fff::/20) and the retired 6bone range
  if (first === 0x2002) return privateIPv4([groups[1] >> 8, groups[1] & 255, groups[2] >> 8, groups[2] & 255].join('.'))
  return false
}

// Interaction steps for functional checks (owner live test 2026-10-31: a counter page was rendered but its buttons were
// never tested). They run inside the isolated preview page through DOM events, only for local files and the local dev
// server (never a public site), and each step reports what it found.
const MAX_STEPS = 20
const stepError = hint => Object.assign(fail('INVALID_INPUT'), { hint })
function parseSteps(value) {
  if (value === undefined || value === null || value === '') return []
  let list = value
  if (typeof value === 'string') { try { list = JSON.parse(value) } catch { throw stepError('steps must be a JSON array string, for example [{"click":"#add"},{"expect":"#count","text":"1"}].') } }
  if (!Array.isArray(list) || list.length > MAX_STEPS) throw stepError('steps must be a JSON array of at most ' + MAX_STEPS + ' steps.')
  return list.map(step => {
    const text = typeof step?.text === 'string' ? step.text.slice(0, 500) : ''
    if (typeof step?.click === 'string' && step.click.trim()) return { kind: 'click', target: step.click.slice(0, 200) }
    if (typeof step?.fill === 'string' && step.fill.trim()) return { kind: 'fill', target: step.fill.slice(0, 200), text }
    if (typeof step?.read === 'string' && step.read.trim()) return { kind: 'read', target: step.read.slice(0, 200) }
    if (typeof step?.expect === 'string' && step.expect.trim() && typeof step.text === 'string') return { kind: 'expect', target: step.expect.slice(0, 200), text }
    if (Number.isFinite(step?.wait)) return { kind: 'wait', ms: Math.min(2000, Math.max(0, Math.floor(step.wait))) }
    throw stepError('Each step is one of {"click":target}, {"fill":target,"text":...}, {"read":target}, {"expect":target,"text":...} or {"wait":ms}; target is a CSS selector or the visible text of a button or link.')
  })
}
// Runs in the page: finds a target by CSS selector, then by the exact (then partial) visible text or label of a control.
const PAGE_STEP = `(step) => {
  const visible = el => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length)
  const label = el => (el.getAttribute('aria-label') || el.innerText || el.value || el.title || '').trim().replace(/[\\s]+/g, ' ').toLowerCase()
  const find = target => {
    try { const el = document.querySelector(target); if (el) return el } catch {}
    const want = target.trim().toLowerCase()
    const all = [...document.querySelectorAll('button,a,[role=button],input,select,textarea,label,summary,[onclick],[tabindex]')].filter(visible)
    return all.find(el => label(el) === want) || all.find(el => label(el).includes(want)) || null
  }
  const shown = el => (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) ? el.value : el.innerText || el.textContent || '').trim().slice(0, 300)
  const el = find(step.target)
  if (!el) return { ok: false, error: 'ELEMENT_NOT_FOUND' }
  if (step.kind === 'click') { if (el.disabled) return { ok: false, error: 'ELEMENT_DISABLED' }; el.scrollIntoView({ block: 'center' }); el.focus?.(); el.click(); return { ok: true } }
  if (step.kind === 'fill') {
    if (!['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) return { ok: false, error: 'NOT_A_FIELD' }
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')?.set
    el.focus?.(); setter ? setter.call(el, step.text) : (el.value = step.text)
    el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }))
    return { ok: true, value: shown(el) }
  }
  const value = shown(el)
  if (step.kind === 'read') return { ok: true, value }
  return { ok: value === step.text.trim(), value, expected: step.text.trim() }
}`

function createWebPreview({ createSession, isPublicUrl, resolveFile, baseDirectory = null, files = fsp, prepareImage, lookup = require('node:dns').lookup, requestImpl = https.request, timeoutMs = 30000 }) {
  const modes = new Map() // webContents id -> 'local' | 'public' | 'file'

  // A DNS lookup for connecting that refuses any private answer: the address Node connects to is the address checked.
  function publicLookup(host, options, callback) {
    lookup(host, { all: true }, (error, rows) => {
      if (error) return callback(error)
      const list = Array.isArray(rows) ? rows : [{ address: rows, family: options?.family || 4 }]
      if (!list.length || list.some(row => privateAddress(row.address))) return callback(Object.assign(new Error('URL_NOT_ALLOWED'), { code: 'URL_NOT_ALLOWED' }))
      if (options?.all) return callback(null, list)
      callback(null, list[0].address, list[0].family)
    })
  }
  const publicHttps = value => {
    let url
    try { url = new URL(value) } catch { return null }
    if (url.protocol !== 'https:' || url.username || url.password || !isPublicUrl(url.href)) return null
    const host = url.hostname.replace(/^\[|\]$/g, '')
    if (net.isIP(host) && privateAddress(host)) return null
    return url
  }

  // The session's https handler: one request from Node to a validated public address; the response, redirects included,
  // goes back to the page unchanged.
  // The request ends with its page request and with its capture (I3-005): an abort destroys the Node request, and a
  // DNS answer that arrives after an abort never opens a connection.
  // Local http is fetched from Node as well (R11-001), so the preview session can send everything else, loopback
  // included, to a proxy that does not exist: WebRTC then has no way out. Only the previewed dev server's own origin,
  // and only reads, are fetched.
  function fetchLocal(request, { signal, origin } = {}) {
    let url
    try { url = new URL(request.url) } catch { return Promise.resolve(new Response('Blocked by NAJD preview', { status: 403 })) }
    const host = url.hostname.toLowerCase()
    if (url.protocol !== 'http:' || !origin || !LOOPBACK.has(host) || host !== origin.hostname || (url.port || '80') !== origin.port || url.username || url.password)
      return Promise.resolve(new Response('Blocked by NAJD preview', { status: 403 }))
    if (!['GET', 'HEAD'].includes(request.method)) return Promise.resolve(new Response('NAJD preview only reads pages', { status: 405 }))
    const signals = [request.signal, signal].filter(Boolean)
    const ended = signals.length ? AbortSignal.any(signals) : null
    if (ended?.aborted) return Promise.resolve(new Response('Cancelled', { status: 499 }))
    const headers = {}
    for (const [key, value] of request.headers) if (!HOP_HEADERS.has(key.toLowerCase()) && key.toLowerCase() !== 'cookie') headers[key] = value
    headers.host = url.host
    return new Promise(resolve => {
      const req = require('node:http').request({ host: host === 'localhost' ? '127.0.0.1' : host.replace(/^\[|\]$/g, ''), port: Number(url.port || 80), path: url.pathname + url.search,
        method: request.method, headers, timeout: 20000, ...(ended ? { signal: ended } : {}) }, res => {
        try {
          const status = Number(res.statusCode)
          if (!Number.isInteger(status) || status < 200 || status > 599) { res.destroy(); return resolve(new Response('NAJD preview received an invalid response', { status: 502 })) }
          const out = new Headers()
          for (const [key, value] of Object.entries(res.headers)) {
            if (HOP_HEADERS.has(key) || key === 'set-cookie' || value === undefined) continue
            try { out.set(key, Array.isArray(value) ? value.join(', ') : String(value)) } catch {}
          }
          const body = [204, 205, 304].includes(status) || request.method === 'HEAD' ? null : Readable.toWeb(res)
          resolve(new Response(body, { status, headers: out }))
        } catch { try { res.destroy() } catch {} resolve(new Response('NAJD preview received an invalid response', { status: 502 })) }
      })
      req.on('timeout', () => req.destroy(new Error('timeout')))
      req.on('error', () => resolve(new Response('NAJD preview could not load this address', { status: 502 })))
      req.end()
    })
  }
  function fetchHttps(request, { signal } = {}) {
    const url = publicHttps(request.url)
    if (!url) return Promise.resolve(new Response('Blocked by NAJD preview', { status: 403 }))
    // A preview only reads: no request that could change something on a server (R7-001).
    if (!['GET', 'HEAD'].includes(request.method)) return Promise.resolve(new Response('NAJD preview only reads pages', { status: 405 }))
    const signals = [request.signal, signal].filter(Boolean)
    const ended = signals.length ? AbortSignal.any(signals) : null
    if (ended?.aborted) return Promise.resolve(new Response('Cancelled', { status: 499 }))
    const lookupOnce = (host, options, callback) => publicLookup(host, options, (...answer) => ended?.aborted ? callback(fail('CANCELLED')) : callback(...answer))
    const headers = {}
    for (const [key, value] of request.headers) if (!HOP_HEADERS.has(key.toLowerCase()) && key.toLowerCase() !== 'cookie') headers[key] = value
    return new Promise(resolve => {
      const req = requestImpl(url, { method: request.method, headers, lookup: lookupOnce, timeout: 20000, ...(ended ? { signal: ended } : {}), servername: net.isIP(url.hostname) ? undefined : url.hostname }, res => {
        // Whatever a server answers, nothing here may throw in the main process (R7-002).
        try {
          const status = Number(res.statusCode)
          if (!Number.isInteger(status) || status < 200 || status > 599) { res.destroy(); return resolve(new Response('NAJD preview received an invalid response', { status: 502 })) }
          const out = new Headers()
          for (const [key, value] of Object.entries(res.headers)) {
            if (HOP_HEADERS.has(key) || key === 'set-cookie' || value === undefined) continue
            try { out.set(key, Array.isArray(value) ? value.join(', ') : String(value)) } catch {}
          }
          const body = [204, 205, 304].includes(status) || request.method === 'HEAD' ? null : Readable.toWeb(res)
          resolve(new Response(body, { status, headers: out }))
        } catch { try { res.destroy() } catch {} resolve(new Response('NAJD preview received an invalid response', { status: 502 })) }
      })
      req.on('timeout', () => req.destroy(new Error('timeout')))
      req.on('error', () => resolve(new Response('NAJD preview could not load this address', { status: 502 })))
      req.end()
    })
  }

  // Network and device paths are refused before anything touches the file system, so a page can never make Windows
  // reach out to a share (SMB) or block on one (R10-001).
  const localPath = value => typeof value === 'string' && /^[a-z]:[\\/]/i.test(value) && !/^[\\/]{2}/.test(value) && !value.includes('\0')
  // A local path is walked one component at a time without following anything (R12-001): a link (symbolic link
  // or junction) may only lead to another local drive path, which is walked the same way, at most eight links deep. A
  // link to a network share is refused before anything follows it, so Windows never contacts the share.
  async function localWalk(file, depth = 0) {
    if (depth > 8 || !localPath(file)) return false
    const parts = path.resolve(file).split(path.sep).filter(Boolean)
    let current = parts[0] + path.sep
    for (let index = 1; index < parts.length; index++) {
      current = path.join(current, parts[index])
      let stat
      try { stat = await files.lstat(current) } catch (error) { return error?.code === 'ENOENT' }
      if (!stat.isSymbolicLink()) continue
      let target
      try { target = await files.readlink(current) } catch { return false }
      const plain = String(target).replace(/^\\\?\?\\/, '').replace(/^\\\?\\/, '')
      if (/^[\\/]{2}/.test(target) || /^UNC[\\/]/i.test(plain) || /^[\\/]{2}/.test(plain)) return false
      const next = path.isAbsolute(plain) ? plain : path.resolve(path.dirname(current), plain)
      return localWalk(path.join(next, ...parts.slice(index + 1)), depth + 1)
    }
    return true
  }
  async function allowedFile(href) {
    let url
    try { url = new URL(href) } catch { return false }
    if (url.protocol !== 'file:' || url.host !== '') return false
    let file
    try { file = fileURLToPath(url) } catch { return false }
    if (!localPath(file) || !await localWalk(file)) return false
    try { const resolved = await resolveFile(file); return path.resolve(resolved).toLowerCase() === path.resolve(file).toLowerCase() } catch { return false }
  }
  // Called by a preview session for every request; anything not from a live capture is refused.
  async function allowRequest(webContentsId, value, method = 'GET') {
    const entry = modes.get(webContentsId)
    if (!entry) return false
    const { mode, origin } = entry
    if (!['GET', 'HEAD'].includes(String(method).toUpperCase())) return false // a preview only reads (R7-001)
    let url
    try { url = new URL(value) } catch { return false }
    if (url.protocol === 'data:' || url.protocol === 'blob:') return true
    if (url.username || url.password) return false
    // No WebSockets at all: after the handshake their messages could change things on a server (R8-001). A dev
    // server's live reload simply stays off in the preview; the page still renders.
    if (url.protocol === 'ws:' || url.protocol === 'wss:') return false
    // Loopback: only the dev server being previewed (its page and assets), nothing else local.
    if (['http:', 'https:'].includes(url.protocol) && LOOPBACK.has(url.hostname.toLowerCase()))
      return mode === 'local' && url.hostname.toLowerCase() === origin.hostname && (url.port || '80') === origin.port
    if (url.protocol === 'https:') return !!publicHttps(url.href) // fetched by fetchHttps, which pins the address
    if (url.protocol === 'file:') return mode === 'file' && allowedFile(url.href)
    return false
  }

  // The page address and its mode. A folder means its index.html, which is authorized again as the final file.
  async function address(target) {
    if (typeof target !== 'string' || !target.trim() || target.length > 2000) throw fail('INVALID_INPUT')
    const value = target.trim()
    if (/^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?(\/\S*)?$/i.test(value)) return { url: value, mode: 'local' }
    if (/^https:\/\//i.test(value)) {
      const url = publicHttps(value)
      if (!url) throw fail('URL_NOT_ALLOWED')
      await new Promise((resolve, reject) => publicLookup(url.hostname.replace(/^\[|\]$/g, ''), {}, error => error ? reject(fail('URL_NOT_ALLOWED')) : resolve()))
      return { url: url.href, mode: 'public' }
    }
    if (/^[a-z][a-z0-9+.-]*:/i.test(value) && !/^[a-z]:[\\/]/i.test(value)) throw fail('URL_NOT_ALLOWED')
    // A UNC or device path (\\server\share, \\?\, //server) never reaches the resolver.
    if (/^[\\/]{2}/.test(value)) throw fail('URL_NOT_ALLOWED')
    const absolute = path.isAbsolute(value) ? path.resolve(value) : baseDirectory ? path.resolve(baseDirectory, value) : null
    if (!absolute || !await localWalk(absolute)) throw fail('URL_NOT_ALLOWED')
    let file = await resolveFile(absolute)
    if (fs.statSync(file).isDirectory()) {
      const index = path.join(file, 'index.html')
      if (!await localWalk(index)) throw fail('URL_NOT_ALLOWED')
      file = await resolveFile(index)
    }
    if (!/\.html?$/i.test(file) || !fs.statSync(file).isFile()) throw fail('NOT_FOUND')
    return { url: pathToFileURL(file).href, mode: 'file' }
  }

  async function capture({ target, width = 1440, height = 900, fullPage = false, steps: rawSteps } = {}, { signal } = {}) {
    if (signal?.aborted) throw fail('CANCELLED')
    const steps = parseSteps(rawSteps)
    let timer, abort
    const stopped = new Promise((_, reject) => {
      timer = setTimeout(() => reject(fail('TIMEOUT')), timeoutMs)
      abort = () => reject(fail('CANCELLED'))
      signal?.addEventListener('abort', abort, { once: true })
    })
    stopped.catch(() => {})
    // Every stage that can block (DNS, a page stuck in a loop, a slow capture) gives way to the deadline or a cancel.
    const step = work => Promise.race([work, stopped])
    let preview = null
    try {
      const { url, mode } = await step(address(target))
      if (steps.length && mode === 'public') throw Object.assign(fail('URL_NOT_ALLOWED'), { hint: 'Interaction steps run only on a local HTML file or a localhost dev server, not on a public site.' })
      const w = Number.isInteger(width) ? Math.min(1920, Math.max(320, width)) : 1440
      const h = Number.isInteger(height) ? Math.min(2000, Math.max(320, height)) : 900
      const opened = new URL(url)
      // A session that finishes setting up after a cancel or timeout is closed as soon as it exists (R12-003).
      const creating = Promise.resolve().then(() => createSession({ width: w, height: h, origin: mode === 'local' ? { hostname: opened.hostname.toLowerCase(), port: opened.port || '80' } : null }))
      try { preview = await step(creating) }
      catch (error) {
        creating.then(late => { try { late.window.destroy() } catch {} return late.release?.() }, () => {}).catch(() => {})
        throw error
      }
      const win = preview.window
      const parsed = new URL(url)
      modes.set(win.webContents.id, { mode, origin: { hostname: parsed.hostname.toLowerCase(), port: parsed.port || '80' } })
      const errors = []
      win.webContents.on('console-message', (...args) => {
        const detail = args[0] && typeof args[0] === 'object' && 'message' in args[0] ? args[0] : { level: args[1], message: args[2] }
        if ((detail.level === 'error' || detail.level === 3) && errors.length < 10) errors.push(String(detail.message).slice(0, 300))
      })
      const loaded = new Promise((resolve, reject) => {
        win.webContents.once('did-finish-load', resolve)
        win.webContents.once('did-fail-load', (_event, _code, description, _url, isMainFrame) => { if (isMainFrame !== false) reject(Object.assign(fail('PAGE_NOT_ACCESSIBLE'), { detail: String(description).slice(0, 200) })) })
      })
      loaded.catch(() => {})
      await step(Promise.all([win.loadURL(url).catch(() => loaded), loaded]))
      // Scrollbars are hidden so the picture looks like the page on a real screen.
      await step(win.webContents.insertCSS('::-webkit-scrollbar{display:none!important}').catch(() => {}))
      // Fonts, images and entrance animations settle before the picture.
      await step(new Promise(resolve => setTimeout(resolve, 1200)))
      // Interaction steps, in order; the page settles briefly after each action. Errors thrown by the page's own handlers
      // show up in consoleErrors.
      const results = []
      for (const [index, item] of steps.entries()) {
        if (item.kind === 'wait') { await step(new Promise(resolve => setTimeout(resolve, item.ms))); results.push({ step: index + 1, kind: 'wait', ok: true }); continue }
        const outcome = await step(win.webContents.executeJavaScript('(' + PAGE_STEP + ')(' + JSON.stringify(item) + ')', true).catch(() => ({ ok: false, error: 'STEP_FAILED' })))
        results.push({ step: index + 1, kind: item.kind, target: item.target, ...outcome })
        if (['click', 'fill'].includes(item.kind)) await step(new Promise(resolve => setTimeout(resolve, 150)))
      }
      const page = await step(win.webContents.executeJavaScript('({ title: document.title, text: document.body ? document.body.innerText.slice(0, 2000) : "", height: Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0), overflowX: document.documentElement.scrollWidth > innerWidth + 1 })', true))
      const pageHeight = Number(page?.height) || h
      let image
      if (fullPage && pageHeight > h) {
        // Beyond the viewport, at the original viewport size: the layout (and every 100vh section) is unchanged.
        const shot = await step(preview.screenshot({ width: w, height: Math.min(MAX_HEIGHT, pageHeight) }))
        image = shot
      } else image = await step(win.webContents.capturePage())
      const imageUrl = await step(prepareImage(image))
      const captured = fullPage ? Math.min(MAX_HEIGHT, Math.max(h, pageHeight)) : h
      return { status: 'captured', url: win.webContents.getURL() || url, width: w, height: captured, pageHeight, title: String(page?.title || '').slice(0, 200),
        text: String(page?.text || '').slice(0, 2000), horizontalOverflow: !!page?.overflowX, consoleErrors: errors, imageUrl, ...(fullPage && pageHeight > MAX_HEIGHT ? { truncated: true, note2: `The page is ${pageHeight}px tall; the picture shows the first ${MAX_HEIGHT}px.` } : {}),
        ...(steps.length ? { steps: results, stepsPassed: results.every(item => item.ok) } : {}),
        note: 'Look at the picture: check layout, spacing, contrast, text and images, and fix what is off before calling it done. Check a phone width (390) too.' }
    } finally {
      clearTimeout(timer); if (abort) signal?.removeEventListener('abort', abort)
      if (preview) {
        try { modes.delete(preview.window.webContents.id) } catch {}
        try { preview.window.destroy() } catch {}
        await Promise.resolve(preview.release?.()).catch(() => {})
      }
    }
  }
  return { capture, allowRequest, fetchHttps, fetchLocal, publicLookup }
}

module.exports = { createWebPreview, privateAddress }
