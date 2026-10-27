// The link between this extension and the NAJD AGENT desktop app. NAJD listens on loopback only; this extension finds it on the fixed
// ports, asks to connect, and the user confirms in a native NAJD window (the same six-digit code is shown on both sides).
// After that every call carries this browser's own secret. Nothing here ever talks to a server on the internet.
import { BRIDGE_PORTS } from './protocol.js'

const EXTENSION = chrome.runtime.id
const NAME = (() => { const agent = navigator.userAgent; return /Edg\//.test(agent) ? 'Microsoft Edge' : /OPR\//.test(agent) ? 'Opera' : /Brave/.test(agent) ? 'Brave' : 'Google Chrome' })()

// This installation's own id (created once, kept in this browser profile's extension storage): the same extension in another profile has another one.
let INSTANCE = ''
const ready = (async () => {
  const { najdInstance } = await chrome.storage.local.get('najdInstance')
  if (typeof najdInstance === 'string' && /^[a-f0-9]{32}$/.test(najdInstance)) { INSTANCE = najdInstance; return }
  INSTANCE = [...crypto.getRandomValues(new Uint8Array(16))].map(byte => byte.toString(16).padStart(2, '0')).join('')
  await chrome.storage.local.set({ najdInstance: INSTANCE })
})()
const headers = (extra = {}) => ({ 'X-NAJD-Extension': EXTENSION, ...(INSTANCE ? { 'X-NAJD-Instance': INSTANCE } : {}), ...extra })
export const getLink = async () => (await chrome.storage.local.get('najdLink')).najdLink || null
const setLink = link => chrome.storage.local.set({ najdLink: link })
export const clearLink = () => chrome.storage.local.remove('najdLink')
export const setStatus = (state, extra = {}) => chrome.storage.session.set({ najdStatus: { state, at: Date.now(), ...extra } })
export const getStatus = async () => (await chrome.storage.session.get('najdStatus')).najdStatus || null

// NAJD may have restarted on another port of its fixed range. Returns { port, paired } or null.
export async function discover(preferred) {
  await ready
  // Test and development builds can narrow the search (extension-private storage; no web page can write it).
  const { najdPorts } = await chrome.storage.local.get('najdPorts')
  const ports = Array.isArray(najdPorts) && najdPorts.length && najdPorts.every(item => Number.isInteger(item) && item > 0 && item < 65536) ? najdPorts : BRIDGE_PORTS
  for (const port of [...new Set([preferred, ...ports].filter(Boolean))]) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/v2/discover`, { headers: headers(), signal: AbortSignal.timeout(900) })
      if (!response.ok) continue
      const body = await response.json()
      if (body?.app === 'NAJD AGENT' && body.protocol >= 3) return { port, paired: body.paired === true }
    } catch {}
  }
  return null
}

// One authenticated call. If NAJD moved to another port the link follows it; a refused secret clears the link (NAJD unlinked this browser).
export async function call(route, init = {}) {
  await ready
  let link = await getLink()
  if (!link) throw Object.assign(new Error('NOT_LINKED'), { code: 'NOT_LINKED' })
  const send = port => fetch(`http://127.0.0.1:${port}${route}`, { ...init, headers: headers({ Authorization: `Bearer ${link.secret}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}) }) })
  let response = null
  try { response = await send(link.port) } catch {}
  if (!response) {
    const found = await discover(link.port)
    if (!found) throw Object.assign(new Error('OFFLINE'), { code: 'OFFLINE' })
    if (found.port !== link.port) { link = { ...link, port: found.port }; await setLink(link); try { response = await send(link.port) } catch {} }
    if (!response) throw Object.assign(new Error('OFFLINE'), { code: 'OFFLINE' })
  }
  if (response.status === 401 || response.status === 403) {
    await clearLink(); await setStatus('rejected')
    throw Object.assign(new Error('REJECTED'), { code: 'REJECTED' })
  }
  return response
}

let pairing = null // the pairing attempt in progress (one at a time)

// Ask NAJD to connect; the user confirms in NAJD. Resolves with the final state: connected | denied | expired | not-found | busy.
export async function startPairing() {
  if (pairing) return pairing
  pairing = (async () => {
    try {
      await setStatus('searching')
      const found = await discover()
      if (!found) { await setStatus('not-found'); return 'not-found' }
      const response = await fetch(`http://127.0.0.1:${found.port}/v2/pair/request`, { method: 'POST', headers: headers({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ name: NAME, version: chrome.runtime.getManifest().version }) })
      if (response.status === 429) { await setStatus('busy'); return 'busy' }
      const request = await response.json()
      if (!response.ok || !request?.id) { await setStatus('not-found'); return 'not-found' }
      await setStatus('pairing', { code: String(request.code) })
      const deadline = Date.now() + (Number(request.expiresInMs) || 120000) + 5000
      while (Date.now() < deadline) {
        let state = null
        try { state = await (await fetch(`http://127.0.0.1:${found.port}/v2/pair/status?id=${request.id}&wait=20000`, { headers: headers(), signal: AbortSignal.timeout(30000) })).json() } catch { await new Promise(resolve => setTimeout(resolve, 1500)); continue }
        if (state?.state === 'approved' && /^[a-f0-9]{64}$/.test(state.secret || '')) { await setLink({ port: found.port, secret: state.secret }); await setStatus('connected'); return 'connected' }
        if (state?.state === 'denied') { await setStatus('denied'); return 'denied' }
        if (state?.state === 'expired' || state?.state === 'delivered') { await setStatus('expired'); return 'expired' }
      }
      await setStatus('expired'); return 'expired'
    } catch { await setStatus('not-found'); return 'not-found' }
    finally { pairing = null }
  })()
  return pairing
}

// Alternative: the one-time code from NAJD Settings ("<port>:<code>").
export async function connectWithCode(port, code) {
  await ready
  try {
    const response = await fetch(`http://127.0.0.1:${port}/v2/pair/code`, { method: 'POST', headers: headers({ 'Content-Type': 'application/json' }), body: JSON.stringify({ code, name: NAME }) })
    if (response.status === 401) return 'bad-code'
    if (response.status === 429) return 'busy'
    const body = await response.json()
    if (!response.ok || !/^[a-f0-9]{64}$/.test(body?.secret || '')) return 'failed'
    await setLink({ port, secret: body.secret }); await setStatus('connected'); return 'connected'
  } catch { return 'not-found' }
}

export async function unlink() {
  try { await call('/v2/unlink', { method: 'POST', body: '{}' }) } catch {}
  await clearLink(); await setStatus('unlinked')
}

// Questions for NAJD from the browser.
export async function ask(text, page) {
  const response = await call('/v2/ask', { method: 'POST', body: JSON.stringify({ text, page: page || null }) })
  const body = await response.json().catch(() => null)
  return response.ok && body?.id ? { ok: true, id: body.id, state: body.state } : { ok: false, error: response.status === 429 ? 'TOO_MANY_REQUESTS' : 'FAILED' }
}
export async function askStatus(id) {
  const response = await call(`/v2/ask/${encodeURIComponent(id)}`)
  // NAJD no longer knows this question (it was restarted): the outcome is unconfirmed, and nothing is sent again by itself.
  if (response.status === 404) return { state: 'failed', progress: 'UNKNOWN_EFFECT', output: '', needsApproval: false }
  return response.ok ? await response.json() : null
}
export async function askCancel(id) { await call(`/v2/ask/${encodeURIComponent(id)}/cancel`, { method: 'POST', body: '{}' }); return true }
