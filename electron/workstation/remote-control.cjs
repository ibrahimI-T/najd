// Remote Control (spec 3.7): pair a device with a one-time code and a scoped, revocable token. Off until the owner turns it on, bound to
// this computer (127.0.0.1) unless the owner also allows the local network. Only token hashes are stored. Nothing here reaches the model.
const fs = require('node:fs/promises')
const http = require('node:http')
const path = require('node:path')
const { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } = require('node:crypto')
const { replaceFile } = require('../atomic-file.cjs')

const error = code => Object.assign(new Error(code), { code })
const CODE_LIFETIME = 5 * 60 * 1000, MAX_DEVICES = 20, MAX_AUDIT = 300, MAX_BODY = 16 * 1024, MAX_PAIR_FAILURES = 5
const SCOPES = ['status', 'instruct', 'resume']
const hash = value => createHash('sha256').update(value).digest('hex')
const same = (a, b) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b))

const PAGE = `<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>NAJD</title>
<style>body{font:15px system-ui,sans-serif;margin:0;padding:16px;background:#181817;color:#eee}input,textarea,button{width:100%;box-sizing:border-box;margin:6px 0;padding:10px;border-radius:10px;border:1px solid #444;background:#222;color:#eee;font:inherit}button{background:#1a88ff;border:0}pre{white-space:pre-wrap}</style>
<h1>NAJD</h1><div id=a><input id=c placeholder="رمز الربط" inputmode=numeric><input id=n placeholder="اسم الجهاز"><button id=p>ربط</button></div>
<div id=b hidden><pre id=s></pre><textarea id=t rows=3 placeholder="تعليمات"></textarea><button id=i>إرسال</button><button id=r>استئناف العمل غير المكتمل</button></div>
<script>let k=sessionStorage.k;const $=x=>document.getElementById(x),api=(u,o={})=>fetch(u,{...o,headers:{'content-type':'application/json',authorization:'Bearer '+k}}).then(r=>r.ok?r.json():Promise.reject(r.status));
const show=()=>{$('a').hidden=true;$('b').hidden=false;api('/api/status').then(v=>$('s').textContent=JSON.stringify(v,null,1)).catch(e=>$('s').textContent='ERROR '+e)};
$('p').onclick=()=>fetch('/api/pair',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({code:$('c').value,name:$('n').value})}).then(r=>r.ok?r.json():Promise.reject(r.status)).then(v=>{k=sessionStorage.k=v.token;show()}).catch(e=>alert(e));
$('i').onclick=()=>api('/api/instruct',{method:'POST',body:JSON.stringify({text:$('t').value})}).then(()=>{$('t').value='';show()}).catch(e=>alert(e));$('r').onclick=()=>api('/api/resume',{method:'POST',body:'{}'}).then(show).catch(e=>alert(e));if(k)show()</script></html>`

// handlers: status() -> bounded summary; instruct(text, device); resume(device).
function createRemoteControl({ directory, handlers, now = Date.now, networkAddress = () => null, onChange = () => {} }) {
  if (!path.isAbsolute(directory || '') || !handlers) throw error('INVALID_INPUT')
  const filename = path.join(directory, 'remote-control.json')
  let queue = Promise.resolve(), server = null, port = null, pairing = null, failures = 0
  const serial = work => { const result = queue.then(work); queue = result.catch(() => {}); return result }
  async function load() {
    let raw
    try { raw = await fs.readFile(filename, 'utf8') } catch (reason) { if (reason.code === 'ENOENT') return { version: 1, enabled: false, lan: false, keepAwake: false, devices: [], audit: [] }; throw reason }
    try { const value = JSON.parse(raw); if (value?.version === 1 && Array.isArray(value.devices)) return value } catch {}
    await fs.rename(filename, filename + '.corrupt-' + Date.now()).catch(() => {})
    return { version: 1, enabled: false, lan: false, keepAwake: false, devices: [], audit: [] }
  }
  async function save(state) {
    await fs.mkdir(directory, { recursive: true })
    const temporary = filename + '.' + randomUUID() + '.tmp'
    await fs.writeFile(temporary, JSON.stringify(state) + '\n', { flag: 'wx' })
    await replaceFile(temporary, filename)
  }
  const note = (state, action, device) => { state.audit = [{ at: new Date(now()).toISOString(), action, device: device || null }, ...(state.audit || [])].slice(0, MAX_AUDIT) }
  const publicDevice = ({ tokenHash, ...device }) => device
  const view = state => ({ enabled: state.enabled, lan: state.lan, keepAwake: state.keepAwake, port, address: port ? (state.lan && networkAddress() ? networkAddress() : '127.0.0.1') : null, devices: state.devices.map(publicDevice), audit: state.audit.slice(0, 50), pairing: pairing && pairing.expiresAt > now() ? { code: pairing.code, expiresAt: new Date(pairing.expiresAt).toISOString() } : null })

  function reply(response, status, body) {
    const text = typeof body === 'string' ? body : JSON.stringify(body)
    response.writeHead(status, { 'content-type': typeof body === 'string' ? 'text/html; charset=utf-8' : 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'" })
    response.end(text)
  }
  function readBody(request) {
    return new Promise((resolve, reject) => {
      let size = 0; const chunks = []
      request.on('data', chunk => { size += chunk.length; if (size > MAX_BODY) { reject(error('BODY_TOO_LARGE')); request.destroy() } else chunks.push(chunk) })
      request.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}) } catch { reject(error('INVALID_INPUT')) } })
      request.on('error', reject)
    })
  }
  const authorize = (state, request, scope) => {
    const token = /^Bearer ([a-f0-9]{64})$/.exec(request.headers.authorization || '')?.[1]
    const device = token && state.devices.find(item => same(item.tokenHash, hash(token)))
    if (!device) throw error('UNAUTHORIZED')
    if (!device.scopes.includes(scope)) throw error('FORBIDDEN')
    return device
  }
  async function route(request, response) {
    const url = new URL(request.url, 'http://local')
    if (request.method === 'GET' && url.pathname === '/') return reply(response, 200, PAGE)
    // A page on another site must not be able to drive this server from the owner's browser.
    if (request.method !== 'GET' && !String(request.headers['content-type'] || '').startsWith('application/json')) return reply(response, 415, { error: 'JSON_REQUIRED' })
    if (request.method === 'POST' && url.pathname === '/api/pair') {
      const body = await readBody(request)
      return serial(async () => {
        const state = await load()
        if (!pairing || pairing.expiresAt <= now() || failures >= MAX_PAIR_FAILURES) { pairing = null; return reply(response, 403, { error: 'PAIRING_CLOSED' }) }
        if (typeof body.code !== 'string' || !same(hash(body.code), pairing.codeHash)) { failures++; return reply(response, 403, { error: 'PAIRING_REFUSED' }) }
        if (state.devices.length >= MAX_DEVICES) return reply(response, 409, { error: 'DEVICE_LIMIT' })
        const token = randomBytes(32).toString('hex')
        const device = { id: randomUUID(), name: String(body.name || 'Device').slice(0, 60), scopes: pairing.scopes, tokenHash: hash(token), pairedAt: new Date(now()).toISOString(), lastSeenAt: new Date(now()).toISOString() }
        pairing = null; state.devices.push(device); note(state, 'paired', device.name); await save(state); onChange()
        return reply(response, 200, { token, scopes: device.scopes })
      })
    }
    const scope = { 'GET /api/status': 'status', 'POST /api/instruct': 'instruct', 'POST /api/resume': 'resume' }[request.method + ' ' + url.pathname]
    if (!scope) return reply(response, 404, { error: 'NOT_FOUND' })
    const body = request.method === 'POST' ? await readBody(request) : {}
    const device = await serial(async () => {
      const state = await load(), found = authorize(state, request, scope)
      found.lastSeenAt = new Date(now()).toISOString()
      if (scope !== 'status') note(state, scope, found.name)
      await save(state); return found
    })
    onChange()
    if (scope === 'status') return reply(response, 200, await handlers.status())
    if (scope === 'instruct') {
      if (typeof body.text !== 'string' || !body.text.trim() || body.text.length > 4000) return reply(response, 400, { error: 'INVALID_INPUT' })
      return reply(response, 200, await handlers.instruct(body.text.trim(), publicDevice(device)))
    }
    return reply(response, 200, await handlers.resume(publicDevice(device)))
  }
  async function listen(lan) {
    if (server) await new Promise(resolve => { server.close(resolve); server.closeAllConnections?.() })
    server = http.createServer((request, response) => { route(request, response).catch(reason => { if (!response.headersSent) reply(response, reason.code === 'UNAUTHORIZED' ? 401 : reason.code === 'FORBIDDEN' ? 403 : 400, { error: reason.code || 'FAILED' }) }) })
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, lan ? '0.0.0.0' : '127.0.0.1', resolve) })
    port = server.address().port
  }
  async function close() { if (server) { const current = server; server = null; port = null; await new Promise(resolve => { current.close(resolve); current.closeAllConnections?.() }) } }

  return {
    start: () => serial(async () => { const state = await load(); if (state.enabled) await listen(state.lan) }),
    stop: () => serial(close),
    status: () => serial(async () => view(await load())),
    configure: patch => serial(async () => {
      const state = await load()
      for (const key of ['enabled', 'lan', 'keepAwake']) if (typeof patch?.[key] === 'boolean') state[key] = patch[key]
      note(state, 'configured'); await save(state)
      if (state.enabled) await listen(state.lan); else { pairing = null; await close() }
      onChange(); return view(state)
    }),
    startPairing: scopes => serial(async () => {
      const state = await load()
      if (!state.enabled) throw error('REMOTE_DISABLED')
      const wanted = Array.isArray(scopes) ? scopes.filter(scope => SCOPES.includes(scope)) : ['status']
      if (!wanted.length) throw error('INVALID_INPUT')
      const code = String(randomInt(100000000, 1000000000))
      pairing = { code, codeHash: hash(code), scopes: wanted, expiresAt: now() + CODE_LIFETIME }; failures = 0
      onChange(); return view(state)
    }),
    revoke: id => serial(async () => {
      const state = await load(), device = state.devices.find(item => item.id === id)
      if (!device) return view(state)
      state.devices = state.devices.filter(item => item.id !== id); note(state, 'revoked', device.name); await save(state); onChange(); return view(state)
    })
  }
}

module.exports = { createRemoteControl, SCOPES }
