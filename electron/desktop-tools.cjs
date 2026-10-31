// Desktop windows for the agent (docs/AGENT-PLATFORM-M2-PLAN.md, M2d): najd_desktop_windows/open/read/act.
// The NAJD desktop host does the UI Automation work. Each read is a per-run snapshot (generation) bound to the
// window handle, its process id and creation time and every element's runtime id and attributes; an approval is
// for that snapshot, and the host re-checks the live target right before acting (STALE_TARGET otherwise).
// Reading a window needs one approval per window per run; every action needs its own approval. Sensitive fields
// (passwords, card numbers, codes) are refused before any approval is asked.
const { createHash, randomUUID } = require('node:crypto')
const nodePath = require('node:path')
const fail = (code, hint) => Object.assign(new Error(code), { code }, hint ? { hint } : {})
const sha = value => createHash('sha256').update(value).digest('hex')
// Apps NAJD can open by name; settings opens Windows Settings (owner live test 2026-10-19), explorer File Explorer,
// taskmgr Task Manager and control the Control Panel.
const APPS = ['notepad', 'calc', 'mspaint', 'chrome', 'edge', 'settings', 'explorer', 'taskmgr', 'control']
const ACTIONS = ['invoke', 'setValue', 'select', 'toggle', 'focus']
// Text typed into a field is shown in full on the approval card, so it is limited to what the card shows (M2-R01).
const MAX_TEXT = 1200
// Host refusals that prove nothing happened (M2-R11).
const REFUSED = new Set(['STALE_TARGET', 'SENSITIVE_FIELD', 'ELEMENT_DISABLED', 'READ_ONLY', 'NOT_INVOKABLE', 'INVALID_INPUT', 'NOT_FOUND', 'ADMIN_NOT_ALLOWED', 'CANCELLED', 'NOT_CONNECTED', 'PATH_NOT_ALLOWED'])
// Not proven refused: the action may have happened.
const uncertain = code => Object.assign(fail(code), { effectUnknown: true })
const refusedBeforeAction = failure => failure?.dispatched === false || failure?.toolError && REFUSED.has(failure.code)

// captureDirectory and saveToLibrary serve najd_screen_capture (M2e).
// The model-facing image must fit the context's image limit (agent-context MAX_IMAGE_URL, 3 MiB) with some room.
const MAX_MODEL_IMAGE_URL = 3 * 1024 * 1024 - 4096
function createDesktopTools({ host, journal, resolveReadable, available = () => true, captureDirectory = null, saveToLibrary = null, prepareForModel = null, startApps = null, verifyMs = 8000 }) {
  if (typeof host?.invokeHost !== 'function' || typeof resolveReadable !== 'function') throw fail('INVALID_INPUT')
  // runKey -> { windows: Map(handle -> window), grants: Set(handle@pid@created), reads: Map(handle -> generation) }
  const runs = new Map()
  const state = runKey => { if (!runs.has(runKey)) runs.set(runKey, { windows: new Map(), grants: new Set(), reads: new Map() }); return runs.get(runKey) }
  // Every call names its run; there is no shared fallback between unrelated runs (M2-R2-006).
  const keyOf = ctx => { if (typeof ctx?.runId !== 'string' || !ctx.runId) throw fail('INVALID_INPUT'); return ctx.runId }

  async function approve({ ctx, operation, target, card, tool }) {
    if (typeof ctx?.requestApproval !== 'function') throw fail('PERMISSION_DENIED')
    const action = journal ? await journal.prepare({ intentId: sha(randomUUID()).slice(0, 48), operation, target: target.replace(/[\x00-\x1f]+/g, ' ').slice(0, 1000), changeHash: sha(JSON.stringify(card)) }) : null
    let decision
    try { decision = await ctx.requestApproval(tool, card) }
    catch (failure) { if (action) await journal.cancel(action.id).catch(() => {}); throw failure }
    if (decision !== 'ALLOW_ONCE') { if (action) await journal.decide(action.id, action.nonce, 'DENY'); return null }
    if (action) await journal.decide(action.id, action.nonce, 'ALLOW_ONCE')
    if (ctx.signal?.aborted) { if (action) await journal.cancel(action.id); throw fail('CANCELLED') }
    if (action) await journal.claim(action.id)
    return action || { id: null }
  }
  const finish = async (action, outcome) => { if (action?.id && journal) await journal.finish(action.id, outcome).catch(() => {}) }

  const api = {
    available,
    async windows(_args, ctx) {
      const list = await host.invokeHost('najd.desktop.windows', {})
      const run = state(keyOf(ctx))
      run.windows.clear()
      // A window whose identifying title is too long to show the user in full cannot be approved precisely, so it is
      // listed but not kept as a target: reading, acting on or capturing it is refused (M2-R27-001).
      const items = Array.isArray(list) ? list : []
      for (const item of items) if (!item.titleTooLong) run.windows.set(String(item.window), item)
      return { windows: items.map(item => ({ window: String(item.window), title: String(item.title).slice(0, 200), process: item.process,
        ...(item.titleTooLong ? { titleTooLong: true, note: 'Its title is too long to show the user in full, so NAJD cannot work in this window.' } : {}) })) }
    },
    async open({ target }, ctx) {
      if (typeof target !== 'string' || !target.trim()) throw fail('INVALID_INPUT')
      // A long web address (for example a mail compose link with a pre-filled body) is not an invalid request: say what to do instead, so the model recovers.
      if (target.length > 1000 && /^https?:\/\//i.test(target.trim())) return { status: 'refused', error: 'URL_TOO_LONG', note: 'This web address is too long to open from here. Open the site with a short address using najd_browser (it works in the own browser session of the user) and fill the page there.' }
      if (target.length > 1000) throw fail('INVALID_INPUT')
      const app = APPS.includes(target.trim().toLowerCase()) ? target.trim().toLowerCase() : null
      // A web address opens in the user's default browser with their own profile (owner request 2026-10-19).
      const url = !app && /^https?:\/\/\S{1,990}$/i.test(target.trim()) ? (() => { try { const parsed = new URL(target.trim()); return ['http:', 'https:'].includes(parsed.protocol) ? parsed.href : null } catch { return null } })() : null
      // Any other app installed on this computer, by its Start menu name (owner request 2026-10-20, e.g. Discord).
      // Only separators or a drive make a path; a dotted name (Paint.NET, Battle.net, report.docx) is first matched
      // exactly against the Start menu, then tried as a file (I3-004).
      const pathLike = /[\\/:]/.test(target.trim())
      const dotted = /\.[a-z0-9]{1,5}$/i.test(target.trim())
      let installed = null, suggestions = []
      if (!app && !url && !pathLike && startApps) ({ match: installed, suggestions } = await startApps.find(target.trim(), { exact: dotted }).catch(() => ({ match: null, suggestions: [] })))
      let file = null
      if (!app && !url && !installed) {
        try { file = await resolveReadable(target.trim()) }
        catch (failure) {
          if (pathLike || dotted || !startApps) throw failure
          return { status: 'not_found', error: 'APP_NOT_FOUND', note: 'No installed app has that name in the Start menu. Try its English name as Start shows it' + (suggestions.length ? ', for example one of suggestions.' : '.'), suggestions }
        }
      }
      const shown = app || url || (installed && installed.name) || file
      const action = await approve({ ctx, operation: 'desktop.open', tool: 'najd-desktop-open', target: installed ? 'app:' + installed.appId : shown,
        card: { path: shown, summary: app || installed ? 'Open this app on your computer.' : url ? 'Open this web page in your browser.' : 'Open this file or folder with its default app.' } })
      if (!action) return { status: 'denied_by_user', note: 'Nothing was opened.' }
      // The folder grant is checked again right before opening: a grant removed, or a path that now resolves somewhere
      // else, while the approval was pending means nothing is opened (M2-R13-003).
      if (file) {
        const now = await Promise.resolve().then(() => resolveReadable(target.trim())).catch(() => null)
        if (now !== file) { await finish(action, 'failed'); return { status: 'refused', error: 'PATH_NOT_ALLOWED', note: 'That file is no longer in an allowed folder; nothing was opened.' } }
      }
      // ... and again when the request leaves the host queue, which may have waited behind other work (M2-R15-003).
      const stillAllowed = file ? async () => await Promise.resolve().then(() => resolveReadable(target.trim())).catch(() => null) === file ? null : 'PATH_NOT_ALLOWED' : undefined
      // Phase 12 postcondition: the windows before the open, to see a new one appear after it (a web page opens in an existing browser, so it is not checked).
      const before = url ? null : await host.invokeHost('najd.desktop.windows', {}).then(list => new Set((Array.isArray(list) ? list : []).map(item => String(item.window)))).catch(() => null)
      try { await host.invokeHost('najd.desktop.open', app ? { app } : url ? { url } : installed ? { appId: installed.appId } : { file }, 20000, { signal: ctx.signal, check: stillAllowed }) }
      catch (failure) { const refused = refusedBeforeAction(failure); await finish(action, refused ? 'failed' : false); throw refused ? fail(REFUSED.has(failure.code) ? failure.code : 'DESKTOP_ACTION_FAILED') : uncertain('DESKTOP_ACTION_FAILED') }
      await finish(action, true)
      const opened = app || (installed && installed.name) || url || file
      if (!before) return { status: 'opened', target: opened }
      // Up to 8 s for a new top-level window; none seen is reported, never claimed (the app may run in the background or reuse a window).
      // The shell opens it, so there is no process id to follow: a new window counts only when its title or process names
      // the app or file by every word of its name, as whole words (C48-01, C49-01: "edge" is not found in "Knowledge");
      // another app's window opening meanwhile is not taken as proof.
      const tokens = text => String(text || '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(word => word.length >= 3)
      const words = tokens(file ? nodePath.parse(file).name : opened)
      const names = item => { const seen = new Set(tokens(item.title + ' ' + item.process)); return words.length > 0 && words.every(word => seen.has(word)) }
      let other = null
      for (const end = Date.now() + verifyMs; Date.now() < end;) {
        if (ctx.signal?.aborted) break
        await new Promise(resolve => setTimeout(resolve, 400))
        const list = await host.invokeHost('najd.desktop.windows', {}).catch(() => null)
        const fresh = (Array.isArray(list) ? list : []).filter(item => !before.has(String(item.window)))
        const match = fresh.find(names)
        if (match) {
          if (!match.titleTooLong) state(keyOf(ctx)).windows.set(String(match.window), match)
          return { status: 'opened', target: opened, verified: true, window: String(match.window), title: String(match.title || '').slice(0, 200) }
        }
        other = other || fresh[0] || null
      }
      if (other) return { status: 'opened', target: opened, verified: false, note: 'It was started; a new window appeared ("' + String(other.title || '').slice(0, 120) + '") but it does not name ' + opened + ', so it is not taken as proof. Check with najd_desktop_windows before opening it again.' }
      return { status: 'opened', target: opened, verified: false, note: 'It was started, but no new window appeared within ' + Math.round(verifyMs / 1000) + ' s: it may run in the background, or it reused a window that was already open. Check with najd_desktop_windows before opening it again.' }
    },
    // A read returns as many elements as fit maxChars; the rest of the same snapshot is read with from, without a new
    // approval or a new host read, and element ids stay valid for acting (M2-R8-005).
    async read({ window, from }, ctx) {
      const run = state(keyOf(ctx))
      let known = run.windows.get(String(window))
      // An id from najd_desktop_open or an earlier list is looked up again in a fresh, read-only list; reading still needs
      // its approval below (owner live test 2026-10-31: an opened Notepad could not be read).
      if (!known) {
        const list = await host.invokeHost('najd.desktop.windows', {}).catch(() => null)
        for (const item of Array.isArray(list) ? list : []) if (!item.titleTooLong) run.windows.set(String(item.window), item)
        known = run.windows.get(String(window))
      }
      if (!known) throw fail('NOT_FOUND', 'No open window has this id. Call najd_desktop_windows and use a listed window id.')
      const limit = Number.isFinite(ctx?.maxChars) ? Math.max(0, Math.floor(ctx.maxChars)) : 24000
      // Names and values shown to the model are bounded; whatever was cut, here or by the host, is marked, and the rest
      // cannot be read through further parts (M2-R29-001).
      const view = item => {
        const name = String(item.name), value = item.value !== null && item.value !== undefined ? String(item.value) : null
        return { id: item.ref, role: item.role, name: name.slice(0, 120), ...(name.length > 120 || item.nameTruncated ? { nameShortened: true } : {}),
          ...(value !== null ? { value: value.slice(0, 200), ...(value.length > 200 || item.valueTruncated ? { valueShortened: true } : {}) } : {}),
          enabled: item.enabled, ...(item.sensitive ? { sensitive: true } : {}) }
      }
      const page = (generation, start) => {
        const all = [...generation.elements.values()], shown = []
        let used = 200 + generation.title.length
        for (let index = start; index < all.length; index++) {
          const item = view(all[index]), size = JSON.stringify(item).length + 1
          if (used + size > limit) break
          shown.push(item); used += size
        }
        // Not even one element fits what is left of this request: say so instead of an empty part to page from.
        if (!shown.length && start < all.length) return { window: String(known.window), title: generation.title, elements: [], error: 'CONTEXT_LIMIT', note: 'No room is left in this request for this window; finish with what you have.' }
        const next = start + shown.length
        // Controls the host did not read are reported on every part; reading more parts cannot bring them (M2-R28-002).
        const shortened = shown.some(item => item.nameShortened || item.valueShortened)
        return { window: String(known.window), title: generation.title, elements: shown,
          ...(shortened ? { shortenedNote: 'Names or values marked shortened are cut; the rest is not available by reading this window.' } : {}),
          ...(generation.complete ? {} : { incomplete: true, incompleteNote: 'This window has more controls than NAJD reads at once; some are not listed and cannot be reached by reading further parts.' }),
          ...(next < all.length ? { truncated: true, total: all.length, nextFrom: next, note: 'More elements: call najd_desktop_read again with from = nextFrom.' } : {}) }
      }
      if (Number.isInteger(from) && from > 0) {
        const generation = run.reads.get(String(known.window))
        if (!generation || from > generation.elements.size) throw fail('NOT_FOUND', 'Read the window again without from.')
        return page(generation, from)
      }
      const grant = `${known.window}@${known.pid}@${known.created}`
      if (!run.grants.has(grant)) {
        // Reading a window can show private content: one approval per window per run.
        const action = await approve({ ctx, operation: 'desktop.read', tool: 'najd-desktop-read', target: 'Read window: ' + known.title,
          card: { path: known.title + ' (' + known.process + ')', summary: 'Let NAJD read the controls and text of this window for this task.' } })
        if (!action) return { status: 'denied_by_user', note: 'The window was not read.' }
        await finish(action, true)
        run.grants.add(grant)
      }
      const readWindow = () => host.invokeHost('najd.desktop.read', { window: String(known.window), pid: known.pid, created: String(known.created), title: known.title }, 20000, { signal: ctx.signal })
      let read
      try { read = await readWindow() } catch (failure) {
        if (failure?.code !== 'STALE_TARGET' || ctx.signal?.aborted) throw failure
        // A title change (a new tab, a document name) makes the host refuse the old title. Reading is observation, so it is
        // retried once for the same window handle, process id and creation time; a different process is never followed.
        const windows = await host.invokeHost('najd.desktop.windows', {})
        const refreshed = (Array.isArray(windows) ? windows : []).find(item => String(item.window) === String(known.window) && item.pid === known.pid && String(item.created) === String(known.created) && !item.titleTooLong)
        if (!refreshed || refreshed.title === known.title) throw fail('STALE_TARGET', refreshed ? 'The window is changing; read it again.' : 'The window closed or was replaced. Call najd_desktop_windows.')
        run.reads.delete(String(window))
        known = refreshed; run.windows.set(String(window), known)
        read = await readWindow()
      }
      const elements = (Array.isArray(read?.elements) ? read.elements : []).map((item, index) => ({ ...item, ref: 'e' + (index + 1) }))
      const generation = { id: randomUUID(), window: known, title: read?.title || known.title, elements: new Map(elements.map(item => [item.ref, item])), complete: read?.complete !== false }
      run.reads.set(String(known.window), generation)
      return page(generation, 0)
    },
    async act({ window, element, action, text }, ctx) {
      if (!ACTIONS.includes(action) || typeof element !== 'string' || typeof text !== 'string') throw fail('INVALID_INPUT')
      if (text.length > MAX_TEXT) return { status: 'refused', error: 'TEXT_TOO_LONG', note: 'Type at most ' + MAX_TEXT + ' characters per action so the user can see all of it.' }
      const generation = state(keyOf(ctx)).reads.get(String(window))
      const item = generation?.elements.get(element)
      if (!item) throw fail('STALE_TARGET', 'Use an element id from the latest najd_desktop_read of this window.') // the element must come from this run's latest read of that window
      if (action === 'setValue' && item.sensitive) return { status: 'refused', error: 'SENSITIVE_FIELD', note: 'This looks like a password, payment or code field. Ask the user to type it themselves.' }
      // The approval names the control exactly as read. A name longer than the host captures cannot be shown in full,
      // so acting on it is refused rather than approved from a partial label (M2-R20-002).
      if (item.nameTruncated) return { status: 'refused', error: 'TARGET_NAME_TOO_LONG', note: 'This control\'s name is too long to show the user exactly; ask the user to do it themselves.' }
      const approved = await approve({ ctx, operation: 'desktop.act', tool: 'najd-desktop-act', target: generation.title + ' :: ' + item.role + ' ' + item.name + ' :: ' + action,
        card: { path: generation.title, summary: `${action === 'setValue' ? 'Type into' : action === 'invoke' ? 'Press' : action === 'toggle' ? 'Toggle' : action === 'select' ? 'Select' : 'Focus'} the ${item.role} "${String(item.name)}"${item.automationId ? ' (' + String(item.automationId) + ')' : ''} in this window.`,
          ...(action === 'setValue' ? { preview: text } : {}) } })
      if (!approved) return { status: 'denied_by_user', note: 'Nothing was done.' }
      let result
      try {
        result = await host.invokeHost('najd.desktop.act', { window: String(generation.window.window), pid: generation.window.pid, created: String(generation.window.created),
          element: item.id, name: item.name, automationId: item.automationId, controlType: item.controlType, key: item.key, title: generation.title, action, text }, 20000, { signal: ctx.signal })
      } catch (failure) {
        // Refused before anything happened (stale target, sensitive, disabled, cancelled while queued): nothing done.
        const refused = refusedBeforeAction(failure)
        await finish(approved, refused ? 'failed' : false)
        if (failure?.code === 'STALE_TARGET') state(keyOf(ctx)).reads.delete(String(window))
        if (refused) throw fail(REFUSED.has(failure.code) ? failure.code : 'DESKTOP_ACTION_FAILED', failure?.code === 'STALE_TARGET' ? 'Nothing was done: the window changed since it was read. Read it again and use the new element ids.' : undefined)
        throw uncertain('DESKTOP_ACTION_FAILED')
      }
      // Done only when the host observed the effect (typed value read back, toggle/selection changed, or a visible
      // change after pressing); otherwise the outcome is unverified (M2-R18).
      await finish(approved, result?.verified === true ? true : false)
      // The window is observed again right away (same run, already approved for reading), so the model checks the result
      // without another turn. It is only a read: an action is never repeated here.
      const after = ctx.signal?.aborted ? null : await api.read({ window }, { ...ctx, maxChars: Math.min(Number.isFinite(ctx?.maxChars) ? ctx.maxChars : 6000, 6000) }).catch(() => null)
      const observed = after && Array.isArray(after.elements) ? { after } : {}
      return result?.verified ? { status: 'done', ...result, ...observed, note: observed.after ? 'after is the window read again after the action; use its element ids next.' : 'Read the window again to see the result.' }
        : { status: 'unverified', ...result, ...observed, effectUnknown: true, note: 'The action was sent but no change was seen; it may still have happened. Check after (or read the window again) before repeating it.' }
    },
    // One window from this run's list, or "" for the primary screen; every capture needs its own approval.
    async capture({ window }, ctx) {
      if (!captureDirectory) throw fail('SERVICE_UNAVAILABLE')
      const run = state(keyOf(ctx))
      const known = window ? run.windows.get(String(window)) : null
      if (window && !known) throw fail('NOT_FOUND')
      const label = known ? known.title + ' (' + known.process + ')' : 'Your whole primary screen'
      const approved = await approve({ ctx, operation: 'screen.capture', tool: 'najd-screen-capture', target: 'Capture: ' + label,
        card: { path: label, summary: 'Take one screenshot and show it to the model. It can contain private information.' } })
      if (!approved) return { status: 'denied_by_user', note: 'No screenshot was taken.' }
      const fsp = require('node:fs/promises'), path = require('node:path')
      await fsp.mkdir(captureDirectory, { recursive: true })
      const output = path.join(captureDirectory, 'capture-' + randomUUID() + '.png')
      let result
      try { result = await host.invokeHost('najd.screen.capture', known ? { output, window: String(known.window), pid: known.pid, created: String(known.created), title: known.title } : { output }, 30000, { signal: ctx.signal }) }
      catch (failure) { const refused = refusedBeforeAction(failure); await finish(approved, refused ? 'failed' : false); throw fail(failure?.code === 'STALE_TARGET' ? 'STALE_TARGET' : failure?.code === 'CANCELLED' ? 'CANCELLED' : 'CAPTURE_FAILED') }
      await finish(approved, true)
      const bytes = await fsp.readFile(output)
      const asset = saveToLibrary ? await saveToLibrary(output).catch(() => null) : null
      // Bounded for the model: re-encoded to fit, or the original only when it already fits (M2-R4-004).
      const original = 'data:image/png;base64,' + bytes.toString('base64')
      const imageUrl = prepareForModel ? await prepareForModel(bytes, MAX_MODEL_IMAGE_URL).catch(() => null) : original.length <= MAX_MODEL_IMAGE_URL ? original : null
      return { status: 'captured', path: output, libraryId: asset?.id || null, width: result?.width, height: result?.height,
        ...(imageUrl ? { imageUrl } : { note: 'The screenshot was saved but is too large to show to the model.' }) }
    },
    endRun: runKey => runs.delete(runKey)
  }
  return api
}
module.exports = { createDesktopTools }
