// Functions injected into the page by chrome.scripting.executeScript. Each one must be completely self-contained (it is serialized).
// They never return typed values: a snapshot says whether a field is filled, never what it holds.

export function najdSnapshot(maxElements, maxText) {
  const allNamesOf = element => [element.getAttribute('aria-label'), ...[...(element.labels || [])].map(label => label.innerText), element.getAttribute('placeholder'), element.isContentEditable ? '' : element.innerText,
    element.localName === 'button' || (element.localName === 'input' && ['button', 'submit', 'reset', 'image'].includes(element.type)) ? element.value : '', element.getAttribute('title'), element.getAttribute('alt'), element.getAttribute('name'),
    ...String(element.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean).map(id => document.getElementById(id)?.innerText)]
    .filter(Boolean).map(text => String(text).trim().replace(/\s+/g, ' ')).filter(Boolean).join(' | ')
    // Strings leave this function a little longer than their limit (OVERLAP): NAJD masks saved passwords first and only then cuts to the real limit,
  // so a password that straddles a limit cannot have its beginning slip through.
  const OVERLAP = 9100 // 1000 saved-password characters, up to 9 characters each when encoded
  // Everything cut here counts against one budget; past it, a value is left out (never sent unmasked-but-cut), and an element whose label is left out is refused later.
  let budget = 300000
  let omitted = 0 // how many values were left out for lack of budget: an element that lost any is marked incomplete, and NAJD then always asks
  const cut = (value, limit) => { const text = String(value).slice(0, limit + OVERLAP); if (text.length > budget) { omitted++; return '' } budget -= text.length; return text }
  const visibleName = element => [element.getAttribute('aria-label'), ...[...(element.labels || [])].map(label => label.innerText), element.getAttribute('placeholder'), element.getAttribute('title'),
  ...String(element.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean).map(id => document.getElementById(id)?.innerText)].filter(Boolean).join(' ')
  const submitControls = form => [...form.elements, ...document.querySelectorAll('input[type=image]')]
    .filter(control => control.form === form && ((control.localName === 'button' && (control.type || 'submit') === 'submit') || (control.localName === 'input' && ['submit', 'image'].includes(control.type))))
  const controlText = control => [control.innerText, control.value, control.alt, control.getAttribute('aria-label'), control.getAttribute('title'),
    ...String(control.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean).map(id => document.getElementById(id)?.innerText)]
    .filter(Boolean).map(text => String(text).trim().replace(/\s+/g, ' ')).filter(Boolean).join(' | ')
  // Where a submit control sends the form: its own formaction only when it sets one (otherwise the property resolves to the page address), else the form's.
  const destinationOf = (control, form) => control.hasAttribute('formaction') ? control.formAction : form.action
  const formKeyOf = element => {
    const form = element.form
    if (!form) return ''
    const buttons = submitControls(form).slice(0, 20).map(button => `${controlText(button)}@${button.hasAttribute('formaction') ? button.formAction : ''}@${button.hasAttribute('formmethod') ? button.formMethod : ''}`).join('|')
    const text = `${form.action}|${form.method}|${buttons}|${element.hasAttribute && element.hasAttribute('formaction') ? element.formAction : ''}`
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57
    for (let index = 0; index < text.length; index++) { const code = text.charCodeAt(index); h1 = Math.imul(h1 ^ code, 2654435761); h2 = Math.imul(h2 ^ code, 1597334677) }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909); h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)
  }
  // The complete labels and destinations of a form's submit controls (up to 20), flagged when more exist than can be described.
  const formInfo = (element, destination) => {
    const buttons = submitControls(element.form)
    const info = { form: cut(buttons.slice(0, 20).map(button => `${controlText(button)} ${button.hasAttribute('formaction') ? button.formAction : ''}`.trim()).join(' | '), 4000), formKey: formKeyOf(element) }
    try { info.formAction = cut(new URL(destination, location.href).toString(), 2000) } catch { info.formIncomplete = true }
    if (buttons.length > 20) info.formIncomplete = true
    return info
  }
  const sensitive = element => {
    const identity = `${element.type || ''} ${element.name || ''} ${element.id || ''} ${element.autocomplete || ''} ${visibleName(element)}`.toLowerCase()
    return element.type === 'password' || /password|passwd|كلمة المرور|كلمة السر|cc-[a-z-]+|card.?number|cardnumber|card.?holder|credit.?card|debit.?card|cvv|cvc|security.?code|iban|ssn|one-time-code|otp|totp|2fa|mfa|verification.?code|routing.?number|account.?number|\bpin\b|expir|exp[ _.-]?(date|month|year)|valid[ _-]?(thru|until)|mm ?\/ ?yy|رمز التحقق|رمز التأكيد|رقم البطاقة|بطاقة الائتمان|بطاقة ائتمان|بطاقة الدفع|بطاقة مدى|رمز الأمان|الرمز السري|الرقم السري|تاريخ الانتهاء|تاريخ انتهاء|ايبان|آيبان|رقم الحساب/.test(identity)
  }
  const visible = element => { const box = element.getBoundingClientRect(), style = getComputedStyle(element); return box.width > 0 && box.height > 0 && style.visibility !== 'hidden' && style.display !== 'none' }
  const nodes = document.querySelectorAll('a[href], button, input:not([type=hidden]), textarea, select, [role=button], [role=link], [role=checkbox], [role=tab], [role=menuitem], [contenteditable=true], summary')
  const elements = []
  // Element ids and the document identity are kept in the extension's own isolated world: the page cannot read, copy or forge them, and they
  // start over with every new document. An approved action only runs in the document, at the address and on the element it was approved for.
  const registry = (globalThis.__najd ||= { doc: Math.random().toString(36).slice(2) + Date.now().toString(36), next: 1, ids: new WeakMap(), byId: new Map(), targets: new Map(), options: new Map(), labels: new Map(), names: new Map(), snap: 0, nav: '', title: '' })
  const doc = registry.doc
  // What was observed: this snapshot, at this exact address (hash routes and long addresses included, never truncated) and with these exact link destinations.
  registry.snap++; registry.nav = location.href; registry.title = document.title; registry.targets = new Map(); registry.options = new Map(); registry.labels = new Map(); registry.names = new Map()
  const snap = registry.snap
  for (const element of nodes) {
    if (elements.length >= maxElements) break
    if (!visible(element) || element.closest('[aria-hidden=true]')) continue
    const omittedBefore = omitted
    let id = registry.ids.get(element)
    if (!id) { id = 'e' + registry.next++; registry.ids.set(element, id); registry.byId.set(id, new WeakRef(element)) }
    const tag = element.localName, type = (element.getAttribute('type') || '').toLowerCase()
    const role = tag === 'a' || element.getAttribute('role') === 'link' ? 'link' : tag === 'select' ? 'select'
      : (tag === 'input' && ['checkbox', 'radio'].includes(type)) || element.getAttribute('role') === 'checkbox' ? 'checkbox'
      : (tag === 'input' && !['button', 'submit', 'reset', 'image'].includes(type)) || tag === 'textarea' || element.isContentEditable ? 'field' : 'button'
    const label = (element.getAttribute('aria-label') || element.labels?.[0]?.innerText || element.getAttribute('placeholder') || (element.isContentEditable ? '' : element.innerText) ||
      (role === 'button' && element.value) || element.getAttribute('title') || element.getAttribute('alt') || element.getAttribute('name') || '').trim().replace(/\s+/g, ' ')
    // The complete label is the element's identity (kept here, up to 4000 characters; a longer one marks the element incomplete); the shown label is cut.
    registry.labels.set(id, label.slice(0, 4000))
    // ALL of its accessible names (a button can be called "Continue" by aria-label and "Delete account" by its text): classified, and part of its identity.
    const allNames = allNamesOf(element)
    registry.names.set(id, allNames.slice(0, 4000))
    const item = { id, role, label: cut(label, 100), names: cut(allNames, 300) }
    if (allNames.length > 4000) item.incomplete = true
    if (label.length > 4000) item.incomplete = true
    // Only an element that really exposes an address (an anchor with an href) has a destination; an ARIA link has none and is clicked like a control.
    if (role === 'link' && typeof element.href === 'string' && element.href) { try { const url = new URL(element.href, location.href); item.href = cut(url.origin + url.pathname, 200); const full = url.toString(); registry.targets.set(id, full); item.target = cut(full, 2000); if (full.length > 2000) item.longTarget = true } catch { item.incomplete = true } }
    if (role === 'field') {
      item.type = tag === 'textarea' ? 'textarea' : element.isContentEditable ? 'text' : type || 'text'
      if (element.autocomplete) item.autocomplete = String(element.autocomplete).slice(0, 40)
      if (sensitive(element)) item.sensitive = true
      if (element.value) item.filled = true
      if (element.required) item.required = true
      // Pressing Enter in a field submits its form: what that form's submit buttons say and where it goes is part of the action.
      if (element.form) Object.assign(item, formInfo(element, element.form.action))
    }
    // A button or input that submits a form: where it sends the form (its own formaction counts) is part of what pressing it does.
    if (role === 'button' && element.form && (tag === 'button' ? (element.type || 'submit') === 'submit' : ['submit', 'image'].includes(type))) Object.assign(item, formInfo(element, destinationOf(element, element.form)))
    if (role === 'select') {
      if (sensitive(element)) item.sensitive = true
      item.options = [...element.options].slice(0, 20).map(option => cut(option.text.trim(), 60))
      // Every option with its complete label and value, kept here (the page cannot reach it) and described to NAJD, so a choice is classified and bound exactly.
      const all = [...element.options]
      registry.options.set(id, all.slice(0, 200).map(option => [option.text.trim(), option.value]))
      // The third entry says the option could not be described completely (too long to carry, or left out): NAJD then always asks.
      item.optionPairs = all.slice(0, 200).map(option => {
        const label = option.text.trim(), value = option.value
        const shownLabel = cut(label, 120), shownValue = cut(value, 120)
        return [shownLabel, shownValue, label.length > 120 + OVERLAP || value.length > 120 + OVERLAP || (shownLabel === '' && label !== '') || (shownValue === '' && value !== '')]
      })
      if (all.length > 200) item.optionsIncomplete = true
    }
    if (role === 'checkbox') item.checked = !!(element.checked || element.getAttribute('aria-checked') === 'true')
    // Every control that submits a form is marked, image buttons included (their destination is then checked like any other).
    if (type === 'submit' || (tag === 'button' && element.form && element.type === 'submit') || (tag === 'input' && type === 'image' && element.form)) item.submits = true
    if (omitted !== omittedBefore) item.incomplete = true
    elements.push(item)
  }
  const url = new URL(location.href); url.hash = ''
  // The complete address with its fragment (a hash-routed page says where it is only there) is delivered for classification and then dropped by NAJD.
  const fullUrl = cut(location.href, 2000)
  return { doc, snap, fullUrl, ...(fullUrl === '' || location.href.length > 2000 + OVERLAP ? { urlIncomplete: true } : {}), url: cut(url.toString(), 500), title: cut(document.title, 200), text: cut((document.body?.innerText || '').replace(/\n{3,}/g, '\n\n'), maxText), elements,
    scroll: { y: Math.round(scrollY), height: document.documentElement.scrollHeight, viewport: innerHeight } }
}

export function najdAct(kind, id, text, submit, expect) {
  const ACTION_WORDS = /(change|reset|update|forgot)[ _-]*(my )?(password|passcode)|delete[ _-]*(my )?(account|profile)|close[ _-]*(my )?account|deactivate|(wire|bank|money)[ _-]*transfer|transfer[ _-]*(funds|money)|send[ _-]*money|\bpay(ment)?\b|checkout|place[ _-]*order|confirm[ _-]*purchase|withdraw|تغيير كلمة|إعادة تعيين كلمة|حذف (ال)?حساب|إغلاق (ال)?حساب|تحويل|دفع|سحب|شراء|اتمام الطلب|إتمام الطلب|\bbuy\b|\bpurchase\b|\bsubscribe\b|\bupgrade[ _-]*(now|to|plan)\b|\bdonate\b|\bbook[ _-]*now\b|\border[ _-]*now\b|complete[ _-]*(my |the )?(order|purchase)|submit[ _-]*(my |the )?order|confirm[ _-]*(my |the )?(order|payment|booking|reservation)|proceed[ _-]*to[ _-]*(payment|pay)|send[ _-]*payment|اشتر|اطلب الآن|تأكيد الطلب|تأكيد الدفع|احجز الآن|تبرع|اشتراك|ترقية الآن/i
  // A title that changed after the snapshot only matters if it now speaks of money, an order or an account change (a page may update its title for harmless reasons).
  const titleOk = () => !globalThis.__najd || document.title === globalThis.__najd.title || !ACTION_WORDS.test(document.title)
    const allNamesOf = element => [element.getAttribute('aria-label'), ...[...(element.labels || [])].map(label => label.innerText), element.getAttribute('placeholder'), element.isContentEditable ? '' : element.innerText,
    element.localName === 'button' || (element.localName === 'input' && ['button', 'submit', 'reset', 'image'].includes(element.type)) ? element.value : '', element.getAttribute('title'), element.getAttribute('alt'), element.getAttribute('name'),
    ...String(element.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean).map(id => document.getElementById(id)?.innerText)]
    .filter(Boolean).map(text => String(text).trim().replace(/\s+/g, ' ')).filter(Boolean).join(' | ')
    const submitControls = form => [...form.elements, ...document.querySelectorAll('input[type=image]')]
    .filter(control => control.form === form && ((control.localName === 'button' && (control.type || 'submit') === 'submit') || (control.localName === 'input' && ['submit', 'image'].includes(control.type))))
  const controlText = control => [control.innerText, control.value, control.alt, control.getAttribute('aria-label'), control.getAttribute('title'),
    ...String(control.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean).map(id => document.getElementById(id)?.innerText)]
    .filter(Boolean).map(text => String(text).trim().replace(/\s+/g, ' ')).filter(Boolean).join(' | ')
  // Where a submit control sends the form: its own formaction only when it sets one (otherwise the property resolves to the page address), else the form's.
  const destinationOf = (control, form) => control.hasAttribute('formaction') ? control.formAction : form.action
  const formKeyOf = element => {
    const form = element.form
    if (!form) return ''
    const buttons = submitControls(form).slice(0, 20).map(button => `${controlText(button)}@${button.hasAttribute('formaction') ? button.formAction : ''}@${button.hasAttribute('formmethod') ? button.formMethod : ''}`).join('|')
    const text = `${form.action}|${form.method}|${buttons}|${element.hasAttribute && element.hasAttribute('formaction') ? element.formAction : ''}`
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57
    for (let index = 0; index < text.length; index++) { const code = text.charCodeAt(index); h1 = Math.imul(h1 ^ code, 2654435761); h2 = Math.imul(h2 ^ code, 1597334677) }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909); h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)
  }
  const visibleName = element => [element.getAttribute('aria-label'), ...[...(element.labels || [])].map(label => label.innerText), element.getAttribute('placeholder'), element.getAttribute('title'),
  ...String(element.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean).map(id => document.getElementById(id)?.innerText)].filter(Boolean).join(' ')
  const registry = globalThis.__najd
  const element = registry?.byId.get(id)?.deref()
  if (!element || !element.isConnected) return { ok: false, error: 'ELEMENT_NOT_FOUND' }
  // What the element is and what it says, computed the same way as in the snapshot; used for the first check and again after page code ran.
  const roleAndLabel = () => {
    const tag = element.localName, type = (element.getAttribute('type') || '').toLowerCase()
    const role = tag === 'a' || element.getAttribute('role') === 'link' ? 'link' : tag === 'select' ? 'select'
      : (tag === 'input' && ['checkbox', 'radio'].includes(type)) || element.getAttribute('role') === 'checkbox' ? 'checkbox'
      : (tag === 'input' && !['button', 'submit', 'reset', 'image'].includes(type)) || tag === 'textarea' || element.isContentEditable ? 'field' : 'button'
    const full = (element.getAttribute('aria-label') || element.labels?.[0]?.innerText || element.getAttribute('placeholder') || (element.isContentEditable ? '' : element.innerText) ||
      (role === 'button' && element.value) || element.getAttribute('title') || element.getAttribute('alt') || element.getAttribute('name') || '').trim().replace(/\s+/g, ' ')
    const label = full.slice(0, 100)
    return { role, label, full }
  }
  // The shown (cut) label and the complete one must both be unchanged: a suffix swapped in after the first 100 characters is a different element.
  const targetMatches = () => { if (!expect) return true; const now = roleAndLabel(); return now.role === expect.role && now.label === expect.label && now.full.slice(0, 4000) === (registry.labels.get(id) ?? now.full.slice(0, 4000)) &&
    allNamesOf(element).slice(0, 4000) === (registry.names.get(id) ?? allNamesOf(element).slice(0, 4000)) }
  // The approved target: the same document at the same address, and an element that still reads and behaves as the one the user approved.
  if (expect) {
    if (expect.doc !== registry.doc || expect.snap !== String(registry.snap) || location.href !== registry.nav || !titleOk()) return { ok: false, error: 'PAGE_CHANGED' }
    const tag = element.localName, type = (element.getAttribute('type') || '').toLowerCase()
    const { role } = roleAndLabel()
    if (!targetMatches()) return { ok: false, error: 'ELEMENT_CHANGED' }
    // Anything that submits a form (Enter in a field, or pressing a submit button) keeps the form it was approved with: the same submit buttons,
    // the same destinations, the same submitter overrides. Compared as a key of the full, untruncated values.
    const submitsForm = element.form && (kind === 'type' ? submit === true : tag === 'button' ? (element.type || 'submit') === 'submit' : ['submit', 'image'].includes(type))
    if (submitsForm && (kind === 'type' || kind === 'click') && formKeyOf(element) !== expect.formKey) return { ok: false, error: 'ELEMENT_CHANGED' }
    // A link keeps the destination it had when it was classified and approved; a changed destination is refused.
    if (role === 'link') { let now = ''; if (typeof element.href === 'string' && element.href) { try { now = new URL(element.href, location.href).toString() } catch {} } if (now !== (registry.targets.get(id) ?? '')) return { ok: false, error: 'ELEMENT_CHANGED' } }
  }
  const identity = `${element.type || ''} ${element.name || ''} ${element.id || ''} ${element.autocomplete || ''} ${visibleName(element)}`.toLowerCase()
  const sensitive = element.type === 'password' || /password|passwd|كلمة المرور|كلمة السر|cc-[a-z-]+|card.?number|cardnumber|card.?holder|credit.?card|debit.?card|cvv|cvc|security.?code|iban|ssn|one-time-code|otp|totp|2fa|mfa|verification.?code|routing.?number|account.?number|\bpin\b|expir|exp[ _.-]?(date|month|year)|valid[ _-]?(thru|until)|mm ?\/ ?yy|رمز التحقق|رمز التأكيد|رقم البطاقة|بطاقة الائتمان|بطاقة ائتمان|بطاقة الدفع|بطاقة مدى|رمز الأمان|الرمز السري|الرقم السري|تاريخ الانتهاء|تاريخ انتهاء|ايبان|آيبان|رقم الحساب/.test(identity)
  element.scrollIntoView({ block: 'center' })
  if (kind === 'click') {
    // Following an ordinary link goes to the validated address itself, not through whatever the page attached to the click.
    if (expect?.plain && registry.targets.get(id)) {
      let destination = null
      try { destination = new URL(registry.targets.get(id)) } catch {}
      if (!destination || !['http:', 'https:'].includes(destination.protocol) || destination.username || destination.password) return { ok: false, error: 'ELEMENT_CHANGED' }
      location.assign(destination.toString()); return { ok: true }
    }
    element.click(); return { ok: true }
  }
  if (kind === 'select') {
    if (sensitive) return { ok: false, error: 'SENSITIVE_FIELD' }
    if (element.localName !== 'select' || element.multiple) return { ok: false, error: 'INVALID_TARGET' } // a multiple select has no single choice to approve: refused before anything changes
    // With an approval, the option is the one that was classified: the snapshot's option at that position, found again by its complete label AND value
    // (a page can reorder options or change a value under an unchanged label); exactly one live option must match, and that one is selected.
    let option
    if (expect && Number.isInteger(expect.optionIndex)) {
      const approved = (registry.options.get(id) || [])[expect.optionIndex]
      if (!approved) return { ok: false, error: 'ELEMENT_CHANGED' }
      const live = [...element.options].filter(item => item.text.trim() === approved[0] && item.value === approved[1])
      if (live.length !== 1) return { ok: false, error: 'ELEMENT_CHANGED' }
      option = live[0]
    } else {
      option = [...element.options].find(item => item.text.trim() === text || item.value === text)
      if (!option) return { ok: false, error: 'OPTION_NOT_FOUND' }
    }
    // The matched option itself is selected (assigning its value would pick the first option that shares it), and it is checked before any event runs.
    option.selected = true
    if (element.selectedOptions[0] !== option) return { ok: false, error: 'PARTIAL_ACTION' } // the selection already changed: reported as a possible effect
    element.dispatchEvent(new Event('input', { bubbles: true })); element.dispatchEvent(new Event('change', { bubbles: true }))
    return { ok: true }
  }
  if (kind === 'type') {
    if (sensitive) return { ok: false, error: 'SENSITIVE_FIELD' }
    // The field and its form must still be what was approved: checked after the page's own focus handlers ran (before anything is written) and again
    // after its input handlers ran (before anything is submitted).
    const approvedNow = () => {
      const nowIdentity = `${element.type || ''} ${element.name || ''} ${element.id || ''} ${element.autocomplete || ''} ${visibleName(element)}`.toLowerCase()
      return element.isConnected && globalThis.__najd === registry && location.href === registry.nav && titleOk() && element.type !== 'password' && targetMatches() &&
        !/password|passwd|كلمة المرور|كلمة السر|cc-[a-z-]+|card.?number|cardnumber|card.?holder|credit.?card|debit.?card|cvv|cvc|security.?code|iban|ssn|one-time-code|otp|totp|2fa|mfa|verification.?code|routing.?number|account.?number|\bpin\b|expir|exp[ _.-]?(date|month|year)|valid[ _-]?(thru|until)|mm ?\/ ?yy|رمز التحقق|رمز التأكيد|رقم البطاقة|بطاقة الائتمان|بطاقة ائتمان|بطاقة الدفع|بطاقة مدى|رمز الأمان|الرمز السري|الرقم السري|تاريخ الانتهاء|تاريخ انتهاء|ايبان|آيبان|رقم الحساب/.test(nowIdentity) &&
        (!expect || !submit || formKeyOf(element) === expect.formKey)
    }
    element.focus()
    if (!approvedNow()) return { ok: false, error: 'ELEMENT_CHANGED' } // nothing was typed
    if (element.isContentEditable) element.textContent = text
    else {
      const proto = element.localName === 'textarea' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
      if (!setter || !element.matches('input, textarea')) return { ok: false, error: 'INVALID_TARGET' }
      setter.call(element, text)
    }
    element.dispatchEvent(new Event('input', { bubbles: true })); element.dispatchEvent(new Event('change', { bubbles: true }))
    if (!approvedNow()) return { ok: false, error: 'PARTIAL_ACTION' }
    if (submit) {
      if (element.form) element.form.requestSubmit ? element.form.requestSubmit() : element.form.submit()
      else for (const type of ['keydown', 'keypress', 'keyup']) element.dispatchEvent(new KeyboardEvent(type, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }))
    }
    return { ok: true }
  }
  return { ok: false, error: 'INVALID_INPUT' }
}

// Sign-in for an account the owner authorized in NAJD (R-063). Only this command may fill a password field, and only on the site of the
// account, in a form that is affirmatively a sign-in form with exactly one visible password field. Values are never returned.
export function najdLogin(host, userId, passId, username, password, submit, expect) {
  const ACTION_WORDS = /(change|reset|update|forgot)[ _-]*(my )?(password|passcode)|delete[ _-]*(my )?(account|profile)|close[ _-]*(my )?account|deactivate|(wire|bank|money)[ _-]*transfer|transfer[ _-]*(funds|money)|send[ _-]*money|\bpay(ment)?\b|checkout|place[ _-]*order|confirm[ _-]*purchase|withdraw|تغيير كلمة|إعادة تعيين كلمة|حذف (ال)?حساب|إغلاق (ال)?حساب|تحويل|دفع|سحب|شراء|اتمام الطلب|إتمام الطلب|\bbuy\b|\bpurchase\b|\bsubscribe\b|\bupgrade[ _-]*(now|to|plan)\b|\bdonate\b|\bbook[ _-]*now\b|\border[ _-]*now\b|complete[ _-]*(my |the )?(order|purchase)|submit[ _-]*(my |the )?order|confirm[ _-]*(my |the )?(order|payment|booking|reservation)|proceed[ _-]*to[ _-]*(payment|pay)|send[ _-]*payment|اشتر|اطلب الآن|تأكيد الطلب|تأكيد الدفع|احجز الآن|تبرع|اشتراك|ترقية الآن/i
  // A title that changed after the snapshot only matters if it now speaks of money, an order or an account change (a page may update its title for harmless reasons).
  const titleOk = () => !globalThis.__najd || document.title === globalThis.__najd.title || !ACTION_WORDS.test(document.title)
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)
  if (!(location.hostname === host || location.hostname.endsWith('.' + host))) return { ok: false, error: 'HOST_MISMATCH' }
  if (location.protocol !== 'https:' && !(location.protocol === 'http:' && local)) return { ok: false, error: 'INSECURE_PAGE' }
  const submitControls = form => [...form.elements, ...document.querySelectorAll('input[type=image]')]
    .filter(control => control.form === form && ((control.localName === 'button' && (control.type || 'submit') === 'submit') || (control.localName === 'input' && ['submit', 'image'].includes(control.type))))
  const controlText = control => [control.innerText, control.value, control.alt, control.getAttribute('aria-label'), control.getAttribute('title'),
    ...String(control.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean).map(id => document.getElementById(id)?.innerText)]
    .filter(Boolean).map(text => String(text).trim().replace(/\s+/g, ' ')).filter(Boolean).join(' | ')
  // Where a submit control sends the form: its own formaction only when it sets one (otherwise the property resolves to the page address), else the form's.
  const destinationOf = (control, form) => control.hasAttribute('formaction') ? control.formAction : form.action
  const formKeyOf = element => {
    const form = element.form
    if (!form) return ''
    const buttons = submitControls(form).slice(0, 20).map(button => `${controlText(button)}@${button.hasAttribute('formaction') ? button.formAction : ''}@${button.hasAttribute('formmethod') ? button.formMethod : ''}`).join('|')
    const text = `${form.action}|${form.method}|${buttons}|${element.hasAttribute && element.hasAttribute('formaction') ? element.formAction : ''}`
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57
    for (let index = 0; index < text.length; index++) { const code = text.charCodeAt(index); h1 = Math.imul(h1 ^ code, 2654435761); h2 = Math.imul(h2 ^ code, 1597334677) }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909); h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)
  }
  const registry = globalThis.__najd
  const byId = id => id ? registry?.byId.get(id)?.deref() ?? null : null
  // What a person reads as the name of a field, and how the field is labelled (the same as the snapshot), for checks before and after page code runs.
  const visibleName = element => [element.getAttribute('aria-label'), ...[...(element.labels || [])].map(label => label.innerText), element.getAttribute('placeholder'), element.getAttribute('title'),
    ...String(element.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean).map(id => document.getElementById(id)?.innerText)].filter(Boolean).join(' ')
  const labelOf = element => (element.getAttribute('aria-label') || element.labels?.[0]?.innerText || element.getAttribute('placeholder') || (element.isContentEditable ? '' : element.innerText) ||
    element.getAttribute('title') || element.getAttribute('alt') || element.getAttribute('name') || '').trim().replace(/\s+/g, ' ').slice(0, 100)
  const fullOf = element => (element.getAttribute('aria-label') || element.labels?.[0]?.innerText || element.getAttribute('placeholder') || (element.isContentEditable ? '' : element.innerText) ||
    element.getAttribute('title') || element.getAttribute('alt') || element.getAttribute('name') || '').trim().replace(/\s+/g, ' ')
  const sameFull = (element, fieldId) => fullOf(element).slice(0, 4000) === (registry?.labels.get(fieldId) ?? fullOf(element).slice(0, 4000))
  const NEWISH = /new|confirm|repeat|جديدة|تأكيد/i
  const OTP = /cc-[a-z-]+|card.?number|cardnumber|card.?holder|credit.?card|debit.?card|cvv|cvc|security.?code|iban|ssn|one-time-code|otp|totp|2fa|mfa|verification.?code|routing.?number|account.?number|\bpin\b|expir|exp[ _.-]?(date|month|year)|valid[ _-]?(thru|until)|mm ?\/ ?yy|رمز التحقق|رمز التأكيد|رقم البطاقة|بطاقة الائتمان|بطاقة ائتمان|بطاقة الدفع|بطاقة مدى|رمز الأمان|الرمز السري|الرقم السري|تاريخ الانتهاء|تاريخ انتهاء|ايبان|آيبان|رقم الحساب/
  const identityOf = element => `${element.type || ''} ${element.name || ''} ${element.id || ''} ${element.autocomplete || ''} ${visibleName(element)}`.toLowerCase()
  const visible = element => { const box = element.getBoundingClientRect(), style = getComputedStyle(element); return box.width > 0 && box.height > 0 && style.visibility !== 'hidden' && style.display !== 'none' }
  const passwords = [...document.querySelectorAll('input[type=password]')].filter(visible)
  const pass = byId(passId)
  if (!pass || !pass.isConnected || pass.type !== 'password' || passwords.length !== 1 || passwords[0] !== pass) return { ok: false, error: 'NOT_A_LOGIN_FORM' }
  // The approved page: the same document at the same address, with the same password and user fields as when the user approved.
  if (expect) {
    if (expect.doc !== registry?.doc || expect.snap !== String(registry?.snap) || location.href !== registry?.nav || !titleOk()) return { ok: false, error: 'PAGE_CHANGED' }
    if (labelOf(pass) !== expect.passLabel) return { ok: false, error: 'ELEMENT_CHANGED' }
    if (submit && formKeyOf(pass) !== expect.formKey) return { ok: false, error: 'ELEMENT_CHANGED' }
    const approvedUser = userId ? byId(userId) : null
    if (userId && (!approvedUser || labelOf(approvedUser) !== expect.userLabel)) return { ok: false, error: 'ELEMENT_CHANGED' }
  }
  // Only the buttons that submit this form count; a "Forgot password?" or "Register" link next to it is normal on a sign-in page.
  const submitLabels = (pass.form ? submitControls(pass.form) : [...document.querySelectorAll('button, input[type=submit]')].filter(item => (item.type || 'submit') === 'submit')).map(controlText)
  const labels = submitLabels.join(' ')
  const context = `${location.pathname} ${document.title} ${pass.getAttribute('aria-label') || ''} ${pass.name || ''} ${pass.id || ''}`
  const bad = /sign[ -]?up|register|registration|create[ -]?(an? )?account|new[ -]?password|reset|forgot|recover|change[ -]?password|set[ -]?password|update[ -]?password|إنشاء حساب|تسجيل حساب|حساب جديد|نسيت|إعادة تعيين|تغيير كلمة|كلمة المرور الجديدة|استعادة/i
  const good = /sign[ -]?in|log[ -]?in|login|signin|تسجيل (ال)?دخول|دخول/i
  if (/new-password/i.test(pass.autocomplete || '') || bad.test(context) || (!submitLabels.some(label => good.test(label)) && submitLabels.some(label => bad.test(label)))) return { ok: false, error: 'NOT_A_LOGIN_FORM' }
  if (pass.autocomplete !== 'current-password' && !good.test(`${context} ${labels}`)) return { ok: false, error: 'AMBIGUOUS_FORM' }
  // The two fields as they are before any page code runs; they must read the same, and stay the same kind of field, throughout.
  const userNow = byId(userId)
  const baseline = { pass: visibleName(pass), user: userNow ? visibleName(userNow) : '' }
  // The field that would receive the saved password must not be a verification-code or payment field in disguise (autocomplete, label, name).
  if (NEWISH.test(`${baseline.pass} ${labelOf(pass)}`) || OTP.test(identityOf(pass)) || (userNow && OTP.test(identityOf(userNow)))) return { ok: false, error: 'NOT_A_LOGIN_FORM' }
  // Page code runs while fields are filled (input, change and focus handlers): the form must still be an affirmative sign-in form, the same one that was approved,
  // with both fields still reading as they did.
  // Where the password would go: the form's own destination and that of every submit control must be on this account's site, over https (http only on this computer for tests).
  const destinationOk = () => {
    if (!pass.form) return true
    const targets = [pass.form.action, ...submitControls(pass.form).filter(control => control.hasAttribute('formaction')).map(control => control.formAction)]
    return targets.every(target => {
      let url
      try { url = new URL(target, location.href) } catch { return false }
      return (url.protocol === 'https:' || (url.protocol === 'http:' && local)) && (url.hostname === host || url.hostname.endsWith('.' + host))
    })
  }
  if (!destinationOk()) return { ok: false, error: 'NOT_A_LOGIN_FORM' }
  const stillSignIn = () => {
    if (!destinationOk()) return false
    if (!pass.isConnected || pass.type !== 'password' || /new-password/i.test(pass.autocomplete || '') || OTP.test(identityOf(pass))) return false
    if (visibleName(pass) !== baseline.pass || NEWISH.test(`${visibleName(pass)} ${labelOf(pass)}`) || (expect && labelOf(pass) !== expect.passLabel) || !sameFull(pass, passId)) return false
    if (userNow && (!userNow.isConnected || visibleName(userNow) !== baseline.user || OTP.test(identityOf(userNow)) || (expect && labelOf(userNow) !== expect.userLabel) || !sameFull(userNow, userId))) return false
    if ([...document.querySelectorAll('input[type=password]')].filter(visible).length !== 1) return false
    if (expect && (expect.doc !== registry?.doc || location.href !== registry?.nav || !titleOk() || formKeyOf(pass) !== expect.formKey)) return false
    const now = `${location.pathname} ${document.title} ${pass.getAttribute('aria-label') || ''} ${pass.name || ''} ${pass.id || ''} ${visibleName(pass)}`
    const nowLabels = (pass.form ? submitControls(pass.form) : [...document.querySelectorAll('button, input[type=submit]')].filter(item => (item.type || 'submit') === 'submit')).map(controlText)
    // Still affirmatively a sign-in form (current-password, or a sign-in wording), and not a registration, reset or change.
    return (pass.autocomplete === 'current-password' || good.test(`${now} ${nowLabels.join(' ')}`)) &&
      !(bad.test(now) || (!nowLabels.some(label => good.test(label)) && nowLabels.some(label => bad.test(label))))
  }
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  // Focus runs page code first: the sign-in form is checked again before anything is written, and false is returned (nothing written) if it changed.
  const setValue = (element, value) => {
    element.focus()
    if (!stillSignIn()) return false
    setter.call(element, value)
    element.dispatchEvent(new Event('input', { bubbles: true })); element.dispatchEvent(new Event('change', { bubbles: true }))
    return true
  }
  const clear = element => { setter.call(element, ''); element.dispatchEvent(new Event('input', { bubbles: true })); element.dispatchEvent(new Event('change', { bubbles: true })) }
  const user = byId(userId)
  if (user) {
    if (!user.isConnected || user.localName !== 'input' || !['text', 'email', 'tel', ''].includes((user.getAttribute('type') || '').toLowerCase())) return { ok: false, error: 'NOT_A_LOGIN_FORM' }
    if (!setValue(user, username)) return { ok: false, error: 'ELEMENT_CHANGED' } // nothing was written
    if (!stillSignIn()) return { ok: false, error: 'PARTIAL_ACTION' } // the user name was typed; the password was not
  }
  if (!setValue(pass, password)) return { ok: false, error: user ? 'PARTIAL_ACTION' : 'ELEMENT_CHANGED' } // the password was not written
  if (!stillSignIn()) { clear(pass); return { ok: false, error: 'PARTIAL_ACTION' } } // the password is taken out again; the form is not submitted
  if (submit) {
    const form = pass.form
    if (form) form.requestSubmit ? form.requestSubmit() : form.submit()
    else for (const type of ['keydown', 'keypress', 'keyup']) pass.dispatchEvent(new KeyboardEvent(type, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }))
  }
  return { ok: true }
}

export function najdScroll(direction) { scrollBy({ top: (direction === 'up' ? -0.8 : 0.8) * innerHeight }); return { ok: true } }
