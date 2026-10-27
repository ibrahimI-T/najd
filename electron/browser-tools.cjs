// Model-facing browser tool over the NAJD browser extension (browser-bridge.cjs).
// Owner policy (2026-10-17): searching, opening pages, reading, scrolling, going back and following links run
// without asking; typing, choosing options and pressing buttons (including form submits) need an in-chat approval
// and are journaled; passwords and payment fields are never typed by NAJD: the tab is shown and the user does it.
const { createHash, randomUUID } = require('node:crypto')
const fail = code => Object.assign(new Error(code), { code })
const sha = value => createHash('sha256').update(value).digest('hex')
const clip = (value, size) => String(value ?? '').replace(/[\x00-\x1f]+/g, ' ').trim().slice(0, size)
const ACTIONS = ['open', 'search', 'read', 'click', 'type', 'select', 'scroll', 'back', 'focus', 'accounts', 'login']
// Actions whose target or page names a hard-to-undo change always need the user's own decision, whatever the access mode (owner rule).
const { SENSITIVE_ACTION, decoded, formSensitive, sensitiveReason } = require('./browser-policy.cjs')

// Compact, model-friendly page view: text plus one line per element.
function pageView(page) {
  if (!page) return null
  const lines = (page.elements || []).map(item => [item.id, item.role, JSON.stringify(clip(item.label, 80)),
    item.href ? '→ ' + item.href : '', item.type && item.type !== 'text' ? 'type=' + item.type : '', item.sensitive ? 'SENSITIVE(user types it)' : '',
    item.filled ? 'filled' : '', item.required ? 'required' : '', item.submits ? 'submits-form' : '', item.checked ? 'checked' : '',
    // Options are listed with a selection token (#0, #1, ...), their label cut for display and their value when it is the only way to tell them apart.
    // Any option up to the 200th can be chosen by its token, also when it is not in the shown list.
    Array.isArray(item.optionPairs) ? 'options=' + JSON.stringify(item.optionPairs.slice(0, 40).map((pair, index) => {
      const label = String(pair[0] ?? '')
      const needsValue = label.length > 60 || item.optionPairs.filter(other => other[0] === pair[0]).length > 1
      return '#' + index + ' ' + label.slice(0, 60) + (needsValue ? ' [value: ' + String(pair[1] ?? '').slice(0, 40) + ']' : '')
    })) + (item.optionPairs.length > 40 ? ' (+' + (item.optionPairs.length - 40) + ' more: choose by #index, 40 to ' + (item.optionPairs.length - 1) + ')' : '')
      : item.options ? 'options=' + JSON.stringify(item.options) : ''].filter(Boolean).join(' '))
  return { url: page.url, title: page.title, text: clip(page.text, 100000).slice(0, 8000), elements: lines, scroll: page.scroll }
}

// resolveUrl: async check of where a host name really leads (DNS), applied wherever allowUrl is, so a public-looking name that resolves to this computer or a private network is refused too.
function createBrowserTools({ bridge, journal = null, allowUrl = () => true, resolveUrl = async () => true, vault = null }) {
  const permitted = async url => allowUrl(url) && (await resolveUrl(url).catch(() => false))
  const element = id => (bridge.lastPage()?.elements || []).find(item => item.id === id)
  const pageHost = page => { try { return new URL(page.url).hostname.toLowerCase() } catch { return '' } }
  const hasPasswordField = page => (page?.elements || []).some(item => item.role === 'field' && item.type === 'password')
  // The model sees pages without any secret this process handed to a page, and learns when the page asks for a sign-in and which
  // authorized accounts exist for it (labels and usernames only; never a password).
  async function view(page) {
    const out = pageView(page)
    if (!out) return out
    if (vault) {
      out.text = vault.scrub(out.text); out.elements = out.elements.map(line => vault.scrub(line)); out.title = vault.scrub(out.title)
      if (hasPasswordField(page)) {
        const accounts = (await vault.forHost(pageHost(page)).catch(() => [])).map(({ id, label, username, autoLogin }) => ({ id, label, username, autoLogin }))
        out.login = { required: true, accounts, note: accounts.length ? 'This page asks for a sign-in. Use action login with target = the account id (NAJD fills the saved password itself; you never see it).'
          : 'This page asks for a sign-in and no authorized account exists for this site. Tell the user to add one in NAJD Settings > Accounts. Never ask for the password in chat.' }
      }
    }
    return out
  }
  // A sign-in form is recognized affirmatively: a "current password" field or a sign-in button, and nothing that points to registration,
  // a reset or a password change. Anything unclear is left to the user (the extension checks the live form again).
  const LOGIN_BAD = /sign[ -]?up|register|registration|create[ -]?(an? )?account|new[ -]?password|reset|forgot|recover|change[ -]?password|set[ -]?password|update[ -]?password|إنشاء حساب|تسجيل حساب|حساب جديد|نسيت|إعادة تعيين|تغيير كلمة|كلمة المرور الجديدة|استعادة/i
  const LOGIN_GOOD = /sign[ -]?in|log[ -]?in|login|signin|تسجيل (ال)?دخول|دخول/i
  function loginVerdict(page, passField) {
    // A password-typed field that is really a verification-code or payment field is never a sign-in target (its autocomplete, label or names say so).
    if (/one-time-code|\botp\b|totp|2fa|mfa|verification.?code|security.?code|cc-[a-z-]+|card.?number|cvv|cvc|\bpin\b|رمز التحقق|رمز التأكيد|رمز الأمان|رقم البطاقة/i.test(`${passField.autocomplete || ''} ${passField.label || ''} ${passField.names || ''}`)) return 'not_a_login_form'
    const buttons = (page.elements || []).filter(item => item.role === 'button')
    const labels = buttons.map(item => item.label || '').join(' ')
    // Page-level signs (address, title, the password field itself) decide whether this is a registration, reset or change page. Secondary controls
    // such as "Forgot password?" or a "Register" link are normal on a sign-in page: only what a submit button does can make the form a different one.
    const submitLabels = buttons.filter(item => item.submits).map(item => item.label || '')
    if (LOGIN_BAD.test(`${page.url || ''} ${page.title || ''} ${passField.label || ''}`) || /new-password/i.test(passField.autocomplete || '')) return 'not_a_login_form'
    if (!submitLabels.some(label => LOGIN_GOOD.test(label)) && submitLabels.some(label => LOGIN_BAD.test(label))) return 'not_a_login_form'
    return passField.autocomplete === 'current-password' || LOGIN_GOOD.test(`${labels} ${page.title || ''} ${page.url || ''}`) ? 'login_form' : 'ambiguous_form'
  }
  const loginFailures = new Map() // account id -> { count, at }: two failed attempts pause that account to avoid locking it
  async function approved({ summary, preview, target, change, tool = 'najd-browser-act', partial = false }, { requestApproval }) {
    if (typeof requestApproval !== 'function') throw fail('PERMISSION_DENIED')
    const action = journal ? await journal.prepare({ intentId: sha(randomUUID()).slice(0, 48), operation: 'browser.act', target: clip(target, 1000), changeHash: sha(change) }) : null
    let decision
    try { decision = await requestApproval(tool, { path: clip(bridge.lastPage()?.url, 500), summary, preview, truncated: partial || String(bridge.lastPage()?.url || '').length >= 500 }) }
    catch (failure) { if (action) await journal.cancel(action.id).catch(() => {}); throw failure }
    if (decision !== 'ALLOW_ONCE') { if (action) await journal.decide(action.id, action.nonce, 'DENY'); return { action, denied: true } }
    if (action) { await journal.decide(action.id, action.nonce, 'ALLOW_ONCE'); await journal.claim(action.id) }
    return { action }
  }
  // token: the page (and browser) the user approved this action for; the bridge refuses it if another page or browser is current.
  async function dispatch(kind, args, signal, action, token = null) {
    try {
      const raw = await bridge.command(kind, args, { signal, timeoutMs: kind === 'open' ? 45000 : 30000, ...(token ? { bind: token } : {}) })
      // Where the tab ended up (a redirect, a script) is judged like a requested address: a page on this computer or a private network is never shown to the model.
      if (kind !== 'park' && raw && typeof raw === 'object' && typeof raw.url === 'string' && raw.url && !(await permitted(raw.url))) {
        await bridge.command('park', {}, { signal }).catch(() => {})
        bridge.forgetPage?.()
        throw fail('PAGE_ADDRESS_NOT_ALLOWED')
      }
      const page = vault ? vault.scrubDeep(raw) : raw
      if (action) await journal.finish(action.id, true).catch(() => {}) // the action happened; a record failure must not look like one
      return page
    } catch (failure) {
      // Refused before acting (element gone, sensitive field, page not accessible) is a known non-effect; a timeout is unknown.
      // Click/type/select are dispatched before the page is observed again, so any failure that is not a known refusal before
      // dispatch (element gone, sensitive field, not connected, bad input) may have happened already.
      const known = ['ELEMENT_NOT_FOUND', 'SENSITIVE_FIELD', 'BROWSER_NOT_CONNECTED', 'INVALID_INPUT', 'CANCELLED', 'HOST_MISMATCH', 'INSECURE_PAGE', 'NOT_A_LOGIN_FORM', 'AMBIGUOUS_FORM', 'PAGE_CHANGED', 'ELEMENT_CHANGED'].includes(failure?.code) // PARTIAL_ACTION is not listed: something may already have been typed
      const uncertain = failure?.code === 'BROWSER_ACTION_UNKNOWN' || ((!!action || kind === 'login') && ['click', 'type', 'select', 'login'].includes(kind) && !known)
      if (action) await journal.finish(action.id, uncertain ? false : 'failed').catch(() => {})
      // The click or keystroke may already have happened: tell the runtime so the task cannot look like a clean failure.
      if (uncertain && failure && typeof failure === 'object') failure.effectUnknown = true
      throw failure
    }
  }

  // Signs in with an account the user authorized. The password is read from the secret store here in the main process, handed to the
  // extension over the authenticated local link, and never appears in a result, a log, the journal or an approval.
  // A sign-in always submits its form (the tool schema fills unused booleans with false, so that flag cannot mean "do not submit").
  async function loginAccount(reference, _submit, { requestApproval, signal }) {
    if (!vault) return { status: 'not_available', note: 'Authorized accounts are not available.' }
    const page = bridge.lastPage()
    const token = bridge.pageToken?.() ?? null
    if (!page) return { status: 'no_page', note: 'Open the sign-in page of the site first.' }
    const account = await vault.find(reference)
    if (!account) return { status: 'no_account', accounts: (await vault.list()).map(({ id, label, host, username }) => ({ id, label, host, username })),
      note: 'No authorized account with that id or label. Tell the user to add the account in NAJD Settings > Accounts; never ask for a password in chat.' }
    if (!vault.hostMatches(account.host, pageHost(page))) return { status: 'host_mismatch', note: `The open page is not ${account.host}. NAJD signs in only on the site of the account.` }
    const fields = (page.elements || []).filter(item => item.role === 'field')
    const passwords = fields.filter(item => item.type === 'password')
    const passField = passwords[0]
    if (passwords.length !== 1 || /new|confirm|repeat|جديدة|تأكيد/i.test(passField.label || '')) return { status: 'not_a_login_form',
      note: 'This is not a plain sign-in form (it asks for several passwords or a new one). NAJD never changes or sets passwords; the user does that.' }
    const verdict = loginVerdict(page, passField)
    if (verdict === 'not_a_login_form') return { status: 'not_a_login_form', note: 'This looks like a registration, reset or password-change form. NAJD never fills those; the user does.' }
    if (verdict === 'ambiguous_form') return { status: 'ambiguous_form', note: 'NAJD cannot tell for sure that this is a sign-in form, so it does not fill a password. Ask the user to sign in on this page.' }
    // The password is only ever sent to this account's own site over https: the form's destination is checked here, and again in the browser before filling and submitting.
    if (passField.formAction) {
      let destination = null
      try { destination = new URL(passField.formAction) } catch {}
      const pageProtocol = (() => { try { return new URL(page.url).protocol } catch { return '' } })()
      const secure = destination && (destination.protocol === 'https:' || (destination.protocol === 'http:' && pageProtocol === 'http:'))
      if (!destination || !secure || !vault.hostMatches(account.host, destination.hostname.toLowerCase()) || !(await permitted(passField.formAction))) return { status: 'destination_not_allowed', note: 'The sign-in form would send the password somewhere other than the own site of this account over https, so NAJD does not fill it. Tell the user.' }
    }
    const before = fields.slice(0, fields.indexOf(passField)).filter(item => !item.sensitive && ['text', 'email', 'tel'].includes(item.type || 'text'))
    const userField = before.at(-1) || null
    const failures = loginFailures.get(account.id)
    if (failures && failures.count >= 2 && Date.now() - failures.at < 10 * 60 * 1000) return { status: 'paused_after_failures',
      note: 'Two sign-in attempts failed. NAJD stops to avoid locking the account. Ask the user to check the password in Settings > Accounts or to sign in personally.' }
    // The form's own submit buttons and destination, and the page, are classified like any other action: signing in on a form that also pays,
    // orders or deletes an account needs the owner's strict approval, whatever the account's auto sign-in setting.
    const strictLogin = formSensitive(passField) || page.strictPage === true || SENSITIVE_ACTION.test(`${page.url || ''} ${decoded(page.url)} ${page.title || ''}`)
    let gate = { action: null }
    if (!account.autoLogin || strictLogin) {
      gate = await approved({ tool: strictLogin ? 'najd-browser-sensitive' : 'najd-browser-login', summary: (strictLogin ? 'SENSITIVE ACTION (this sign-in form also pays, orders or changes an account): ' : '') + `Sign in to ${account.host} as ${account.username} with the saved password of "${clip(account.label, 60)}". The password is filled by NAJD and is not shown to the model.`, preview: '', partial: String(account.label || '').length > 60,
        target: `${account.host} · ${clip(account.label, 80)}`, change: JSON.stringify([page.url, 'login', account.id]) }, { requestApproval })
      if (gate.denied) return { status: 'denied_by_user', note: 'The user did not allow this sign-in.' }
    }
    if (signal?.aborted) throw fail('CANCELLED')
    let secret
    try { secret = await vault.reveal(account.id, page.url) }
    catch (failure) {
      if (gate.action) await journal.finish(gate.action.id, 'failed').catch(() => {})
      return { status: failure?.code === 'SECRET_MISSING' ? 'secret_missing' : 'refused', error: failure?.code,
        note: failure?.code === 'SECRET_MISSING' ? 'The saved password is missing. Tell the user to add the account again in Settings > Accounts.' : 'This page cannot be used with that account.' }
    }
    if (signal?.aborted) { if (gate.action) await journal.cancel(gate.action.id).catch(() => {}); throw fail('CANCELLED') }
    let result
    try { result = await dispatch('login', { host: account.host, userId: userField?.id || '', passId: passField.id, username: secret.username, password: secret.password, submit: true,
      expect: { doc: String(page.doc || ''), snap: String(page.snap ?? ''), passLabel: String(passField.label || ''), formKey: String(passField.formKey || ''), userLabel: String(userField?.label || '') } }, signal, gate.action, token) }
    catch (failure) {
      const known = { HOST_MISMATCH: 'host_mismatch', INSECURE_PAGE: 'insecure_page', NOT_A_LOGIN_FORM: 'not_a_login_form', AMBIGUOUS_FORM: 'ambiguous_form', PAGE_CHANGED: 'page_changed' }[failure?.code]
      if (known) return { status: known, note: 'The browser refused to fill this page.' }
      // The credentials may have been submitted: count it toward the pause so repeated unobservable attempts cannot bypass it.
      if (failure?.code !== 'CANCELLED') loginFailures.set(account.id, { count: (loginFailures.get(account.id)?.count || 0) + 1, at: Date.now() })
      throw failure
    }
    const after = await view(result)
    const stillLogin = hasPasswordField(result)
    const needsCode = (result?.elements || []).some(item => item.role === 'field' && /one-time|otp|verification code|رمز التحقق|رمز التأكيد|2fa|authenticator/i.test(item.label || '')) || /captcha|i'm not a robot|لست روبوت/i.test(result?.text || '')
    if (needsCode) return { status: 'needs_user_verification', page: after, note: 'The site asks for a verification code or a CAPTCHA. Tell the user; NAJD does not get past these.' }
    if (stillLogin) {
      loginFailures.set(account.id, { count: (loginFailures.get(account.id)?.count || 0) + 1, at: Date.now() })
      return { status: 'login_not_completed', page: after, note: 'The sign-in form is still showing: the password may be wrong or the site wants more. Do not retry in a loop; tell the user.' }
    }
    loginFailures.delete(account.id)
    return { status: 'signed_in', account: { label: account.label, username: account.username, host: account.host }, page: after }
  }

  return {
    available: () => bridge.status().connected,
    describe: () => { const page = bridge.status().page; return page ? `NAJD's browser tab currently shows "${clip(page.title, 80)}" (${clip(page.url, 120)}).` : 'NAJD has no browser tab open yet.' },
    // The extension reports SITE_ACCESS_NEEDED until the owner allows it to work on websites in its panel: say so, do not fail.
    async run(args, context) {
      // Saved passwords are loaded into the masking set before any page can be read (a tab that survived a restart may still echo one).
      if (vault?.prime) { try { await vault.prime() } catch { return { status: 'vault_unavailable', note: 'NAJD cannot protect the saved account passwords right now, so it does not read pages. Ask the user to check Settings > Accounts.' } } }
      try { return await runAction(args, context) }
      catch (failure) {
        if (failure?.code === 'PAGE_ADDRESS_NOT_ALLOWED') return { status: 'url_not_allowed', note: 'The tab ended up on an address NAJD does not read (this computer or a private network), possibly after a redirect. Nothing from it was kept, and the tab was emptied.' }
        if (failure?.code === 'PAGE_CHANGED' || failure?.code === 'ELEMENT_CHANGED') return { status: 'page_changed', note: 'The page or browser changed after you read it, so nothing was done. Read the page again and repeat the step if it is still needed.' }
        if (failure?.code === 'SITE_ACCESS_NEEDED') return { status: 'site_access_needed', note: 'The browser extension is not yet allowed to work on websites. Ask the user to open the NAJD extension panel in the browser and press "Allow on all sites".' }
        throw failure
      }
    },
  }
  async function runAction({ action, target, text, submit }, { requestApproval, signal }) {
      if (!ACTIONS.includes(action) || typeof target !== 'string' || target.length > 2000 || typeof text !== 'string' || text.length > 2000 || typeof submit !== 'boolean') throw fail('INVALID_INPUT')
      if (action === 'open') {
        if (!(await permitted(target))) throw fail('PATH_NOT_ALLOWED')
        return { status: 'opened', page: await view(await dispatch('open', { url: target }, signal)) }
      }
      if (action === 'search') {
        if (!target.trim() || target.length > 300) throw fail('INVALID_INPUT')
        return { status: 'searched', page: await view(await dispatch('open', { url: 'https://www.google.com/search?q=' + encodeURIComponent(target.trim()) }, signal)) }
      }
      if (['read', 'back'].includes(action)) return { status: action === 'read' ? 'read' : 'went_back', page: await view(await dispatch(action, {}, signal)) }
      if (action === 'scroll') return { status: 'scrolled', page: await view(await dispatch('scroll', { direction: target === 'up' ? 'up' : 'down' }, signal)) }
      if (action === 'focus') { await dispatch('focus', {}, signal); return { status: 'shown_to_user', note: 'The NAJD tab is now in front of the user.' } }
      if (action === 'accounts') {
        if (!vault) return { status: 'not_available', note: 'Authorized accounts are not available.' }
        return { status: 'accounts', accounts: (await vault.list()).map(({ id, label, host, username, autoLogin }) => ({ id, label, host, username, autoLogin })),
          note: 'Passwords are never shown. Use action login on the sign-in page of the account.' }
      }
      if (action === 'login') return loginAccount(target, submit, { requestApproval, signal })
      const item = element(target)
      const token = bridge.pageToken?.() ?? null // the page this element id belongs to; kept through the approval
      const expect = item ? { doc: String(bridge.lastPage()?.doc || ''), snap: String(bridge.lastPage()?.snap ?? ''), role: item.role, label: String(item.label || ''), formKey: String(item.formKey || '') } : null // what the user approved: this document, this element
      if (!item) return { status: 'element_not_found', note: 'Use an element id from the latest page result (read the page again if it changed).' }
      const host = (() => { try { return new URL(bridge.lastPage().url).host } catch { return 'this site' } })()
      // The same address policy as for opening a page: a link or a form that leads to this computer or the local network is refused, whatever the click would need.
      if (action === 'click' && item.role === 'link' && item.target && !(await permitted(item.target))) return { status: 'url_not_allowed', note: 'That link leads to an address NAJD does not open (this computer or a private network).' }
      if ((action === 'click' && item.formAction && item.submits || action === 'type' && submit && item.formAction) && !(await permitted(item.formAction))) return { status: 'url_not_allowed', note: 'That form submits to an address NAJD does not use (this computer or a private network).' }
      if (action === 'click') {
        // Following an ordinary link is like opening a page; anything else (buttons, form submits, checkboxes) is approved.
        const plainLink = item.role === 'link' && /^https?:\/\//.test(item.href || '') && !item.longTarget && !item.incomplete && !sensitiveReason(item, bridge.lastPage())
        let journaled = null
        if (!plainLink) {
          // A link destination too long to be classified completely asks strictly (what follows the cut could be anything).
          const strictClick = sensitiveReason(item, bridge.lastPage()) || formSensitive(item) || item.longTarget === true || item.incomplete === true
          const gate = await approved({ tool: strictClick ? 'najd-browser-sensitive' : 'najd-browser-act', summary: (strictClick ? 'SENSITIVE ACTION (password, money or account): ' : '') + `Press "${clip(item.label, 80)}" on ${host}${item.submits ? ' (this submits the form)' : ''}. The website decides what this does.`, preview: '', partial: String(item.label || '').length > 80,
            target: `${host} · ${clip(item.label, 120)}`, change: JSON.stringify([bridge.lastPage()?.url, 'click', item.id, item.label]) }, { requestApproval })
          if (gate.denied) return { status: 'denied_by_user', note: 'Nothing was pressed.' }
          journaled = gate.action
        }
        return { status: 'clicked', page: await view(await dispatch('click', { id: item.id, expect: { ...expect, plain: plainLink } }, signal, journaled, token)) }
      }
      if (action === 'type' || action === 'select') {
        if (item.sensitive) {
          await bridge.command('focus', {}, { signal }).catch(() => {})
          return { status: 'needs_user', note: 'Passwords and payment details are typed by the user only. The tab is shown to the user: ask them to fill this field themselves and tell you when done.' }
        }
        if (action === 'type' && item.role !== 'field') return { status: 'not_a_field', note: 'Type only into elements with role field.' }
        if (action === 'select' && item.role !== 'select') return { status: 'not_a_select', note: 'Choose options only on elements with role select.' }
        if (!text.length || text.length > 1000) throw fail('INVALID_INPUT')
        // Submitting presses the form's own submit button: its label and destination count like a click on it.
        // Choosing an option is classified by that option's complete label and value (and by the select's own words and page).
        let optionStrict = false, optionIndex = null, resolvedChoice = null
        if (action === 'select') {
          if (Array.isArray(item.optionPairs)) {
            // Exactly one option must match: it is classified, and the same one (by position and complete label and value) is carried to the browser.
            const token = /^#(\d{1,3})$/.exec(text)
            const matches = token ? (item.optionPairs[Number(token[1])] ? [[item.optionPairs[Number(token[1])], Number(token[1])]] : [])
              : item.optionPairs.map((candidate, position) => [candidate, position]).filter(([candidate]) => candidate[0] === text || candidate[1] === text)
            if (!matches.length) return { status: 'option_not_found', note: 'That option is not in the list. Read the page again and use an option label or value from it.' }
            if (matches.length > 1) return { status: 'ambiguous_option', note: 'More than one option matches that text; NAJD does not guess. Use an option value that is unique.' }
            const [pair, position] = matches[0]
            optionIndex = position
            resolvedChoice = `${pair[0]} [value: ${pair[1]}] (#${position})`
            optionStrict = item.optionsIncomplete === true || pair[2] === true || SENSITIVE_ACTION.test(`${pair[0]} ${pair[1]} ${decoded(pair[1])}`)
          } else optionStrict = SENSITIVE_ACTION.test(`${text} ${decoded(text)}`)
        }
        const strict = sensitiveReason(item, bridge.lastPage()) || optionStrict || (action === 'type' && submit && formSensitive(item))
        const gate = await approved({ tool: strict ? 'najd-browser-sensitive' : 'najd-browser-act', summary: (strict ? 'SENSITIVE ACTION (password, money or account): ' : '') + (action === 'type' ? `Type into "${clip(item.label, 80)}" on ${host}${submit ? ' and press Enter / submit' : ''}.` : `Choose "${clip(resolvedChoice || text, 120)}" in "${clip(item.label, 80)}" on ${host}.`),
          preview: resolvedChoice || text, partial: String(item.label || '').length > 80 || (action !== 'type' && String(resolvedChoice || text).length > 120), target: `${host} · ${clip(item.label, 120)}`, change: JSON.stringify([bridge.lastPage()?.url, action, item.id, resolvedChoice || text, optionIndex, submit]) }, { requestApproval })
        if (gate.denied) return { status: 'denied_by_user', note: 'Nothing was typed.' }
        return { status: action === 'type' ? 'typed' : 'selected', page: await view(await dispatch(action, { id: item.id, text, submit: action === 'type' && submit, expect: { ...expect, ...(optionIndex !== null ? { optionIndex } : {}) } }, signal, gate.action, token)) }
      }
      throw fail('INVALID_INPUT')
    }
}
module.exports = { createBrowserTools, pageView }
