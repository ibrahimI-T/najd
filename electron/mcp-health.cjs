// Readiness and failure classification for external MCP tools.
// A connected MCP server does not mean every tool works: a tool may need another operating system, a provider that is
// not installed, an open document or a credential. This module keeps the real error code of each failed call, tells
// permanent failures from temporary ones, and remembers per tool what has been seen so the model is not offered (or
// allowed to repeat) a call that already proved impossible. It performs no I/O.

// Owner-facing classes. Only "app_error" is a defect candidate in NAJD itself; the others describe the tool,
// the system or the setup.
const CLASSES = {
  unsupported: { ar: 'غير مدعوم في هذا النظام أو لدى هذا المزوّد', permanent: true },
  missing_setup: { ar: 'ينقصه إعداد أو صلاحية أو اتصال', permanent: true },
  target_unavailable: { ar: 'الهدف المطلوب غير متاح الآن', permanent: false },
  permission: { ar: 'مُنع بقاعدة حماية', permanent: true },
  timeout: { ar: 'انتهت المهلة', permanent: false },
  server_exited: { ar: 'توقف خادم الأداة', permanent: false },
  cancelled: { ar: 'أُلغي الطلب', permanent: false },
  app_error: { ar: 'خطأ في الأداة', permanent: false }
}

// Ordered rules: the first match wins. Each tests the lower-cased text of the error, which may be JSON or prose.
const RULES = [
  { re: /unsupported[_ -]?provider|provider.{0,40}(only )?support/, code: 'UNSUPPORTED_PROVIDER', cls: 'unsupported' },
  { re: /windows[_ -]?native|capability[_ -]?unavailable|not supported on windows|unsupported (platform|os|operating)|linux (x64 )?only|requires linux|requires macos/, code: 'CAPABILITY_UNAVAILABLE', cls: 'unsupported' },
  { re: /sensitive[_ -]?file|path[_ -]?not[_ -]?allowed|permission[_ -]?denied|access is denied|eacces|eperm/, code: 'PERMISSION_DENIED', cls: 'permission' },
  { re: /target[_ -]?unavailable|no app is open|no (document|file|project|session|tab) (is )?(open|selected|loaded)|nothing is open/, code: 'TARGET_UNAVAILABLE', cls: 'target_unavailable' },
  { re: /api[_ -]?key|unauthori[sz]ed|\b401\b|\b403\b|auth(entication)?[_ -]?required|not (configured|logged in|signed in)|missing (credential|token|key)|credential/, code: 'CONFIG_MISSING', cls: 'missing_setup' },
  { re: /enoent|command not found|is not recognized|no such file or directory|module not found|cannot find module|not installed/, code: 'DEPENDENCY_MISSING', cls: 'missing_setup' },
  { re: /timed? ?out|timeout/, code: 'TOOL_TIMEOUT', cls: 'timeout' }
]

const ALTERNATIVE = {
  unsupported: 'Use a tool of the same server that supports this system, another server, or a NAJD built-in tool; do not repeat this call.',
  missing_setup: 'Tell the owner what is missing (setup, sign-in or program) and continue with the rest of the task.',
  permission: 'This is a protection rule, not a failure: do not try another route around it; tell the owner what was blocked.',
  target_unavailable: 'Open or select the target first (or ask the owner to), then call again once; do not repeat the same call unchanged.',
  timeout: 'One retry with smaller input is allowed; after that report the limit.',
  server_exited: 'The server stopped; reconnect it in Settings > Tools before calling again.',
  app_error: 'Read the error text; fix the arguments once or choose another tool.'
}

function flat(value) { try { return typeof value === 'string' ? value : JSON.stringify(value) } catch { return '' } }

// Pull the server's own code out of a JSON error body ({"status":"unsupported_provider"}, {"error":{"code":..}}).
function nativeCode(text, structured) {
  const candidates = []
  const read = obj => {
    if (!obj || typeof obj !== 'object') return
    for (const key of ['error_code', 'errorCode', 'code', 'status', 'error', 'reason']) {
      const v = obj[key]
      if (typeof v === 'string' && /^[A-Za-z][A-Za-z0-9_./ :-]{0,80}$/.test(v)) candidates.push(v)
      else if (v && typeof v === 'object') read(v)
    }
  }
  try { read(JSON.parse(text)) } catch {}
  read(structured)
  const skip = new Set(['error', 'failed', 'ok', 'success', 'completed'])
  return candidates.find(v => !skip.has(v.toLowerCase())) || candidates[0] || null
}

// failure: { text, structured, code (client/runtime code such as TIMEOUT or SERVER_EXITED), detail }
function classifyFailure({ text = '', structured = null, code = null, detail = '' } = {}) {
  const body = (String(text) + ' ' + flat(structured) + ' ' + String(detail)).toLowerCase().slice(0, 6000)
  const native = nativeCode(String(text), structured)
  let cls = 'app_error', outCode = code && code !== 'SERVER_ERROR' ? code : (native || 'TOOL_ERROR')
  if (code === 'CANCELLED') cls = 'cancelled'
  else if (code === 'SERVER_EXITED' || code === 'NOT_CONNECTED') { cls = 'server_exited'; outCode = code }
  else if (code === 'TIMEOUT') { cls = 'timeout'; outCode = 'TOOL_TIMEOUT' }
  else if (code === 'COMMAND_NOT_FOUND' || code === 'START_FAILED') { cls = 'missing_setup'; outCode = code }
  else {
    const rule = RULES.find(r => r.re.test(body))
    if (rule) { cls = rule.cls; outCode = native && /^[A-Za-z0-9_]+$/.test(native) ? native.toUpperCase() : rule.code }
  }
  return { code: String(outCode).slice(0, 80), class: cls, permanent: CLASSES[cls].permanent, descriptionAr: CLASSES[cls].ar, alternative: ALTERNATIVE[cls] || null,
    // Only an error the tool itself raised can be a defect in the tool; the classes above describe the environment.
    defectInNajd: false }
}

function createHealthBook(now = () => Date.now()) {
  const rows = new Map() // `${server}\u0000${tool}` -> row
  const key = (server, tool) => server + '\u0000' + tool
  return {
    recordSuccess(server, tool, durationMs) {
      rows.set(key(server, tool), { ok: true, at: new Date(now()).toISOString(), durationMs, failures: 0, permanent: false, class: null, code: null })
    },
    recordFailure(server, tool, info, durationMs) {
      const before = rows.get(key(server, tool))
      rows.set(key(server, tool), { ok: false, at: new Date(now()).toISOString(), durationMs, failures: (before?.failures || 0) + 1, permanent: info.permanent, class: info.class, code: info.code, descriptionAr: info.descriptionAr, alternative: info.alternative })
    },
    // A permanent failure stays until the server reconnects (the owner may have fixed the setup) or `clear` is called.
    blocked(server, tool) { const r = rows.get(key(server, tool)); return r && !r.ok && r.permanent ? r : null },
    get(server, tool) { return rows.get(key(server, tool)) || null },
    clearServer(server) { for (const k of [...rows.keys()]) if (k.startsWith(server + '\u0000')) rows.delete(k) },
    forServer(server) { return [...rows.entries()].filter(([k]) => k.startsWith(server + '\u0000')).map(([k, r]) => ({ tool: k.slice(server.length + 1), ...r })) }
  }
}

// The six readiness facts the owner asked to see apart. `tested` is the last real call result of the tool, if any.
function readiness({ installed, connected, platformCompatible = null, configured = true, row = null }) {
  const blocked = !!row && !row.ok && row.permanent
  const compatible = blocked && row.class === 'unsupported' ? false : platformCompatible
  const set = configured && !(blocked && row.class === 'missing_setup')
  const ready = !!installed && !!connected && compatible !== false && set && !blocked
  return { installed: !!installed, connected: !!connected, platformCompatible: compatible, configured: set, ready,
    lastFunctionalTest: row ? { at: row.at, ok: row.ok, code: row.code, class: row.class, durationMs: row.durationMs } : null,
    reason: ready ? null : blocked ? row.code : !installed ? 'NOT_INSTALLED' : !connected ? 'NOT_CONNECTED' : compatible === false ? 'UNSUPPORTED_PLATFORM' : !set ? 'CONFIG_MISSING' : null }
}

module.exports = { classifyFailure, createHealthBook, readiness, CLASSES }
