// Turns a Chrome DevTools accessibility tree into NAJD's page observation: numbered controls bound to the DOM node they came from.
// Pure functions, so the rules are tested without a browser (tests/browser-extension-v2.test.cjs).

const ROLE = {
  link: 'link', button: 'button', menuitem: 'button', menuitemcheckbox: 'checkbox', menuitemradio: 'radio', tab: 'button', switch: 'checkbox',
  textbox: 'field', searchbox: 'field', combobox: 'select', listbox: 'select', checkbox: 'checkbox', radio: 'radio', spinbutton: 'field', slider: 'field'
}
// node.role, node.name and node.value are AXValue objects ({ type, value }); node.properties holds { name, value: AXValue }.
const value = axValue => axValue?.value
const prop = (node, name) => value((node.properties || []).find(item => item.name === name)?.value)
// Field names that ask for something the model must never type (the owner types it).
const SECRET = /pass(word|code)?|otp|one.?time|verification code|security code|cvv|cvc|card ?number|card-number|cc-|iban|pin\b|كلمة (المرور|السر)|رمز التحقق/i

// nodes: Accessibility.getFullAXTree().nodes; attributes(backendId) -> { type, href, autocomplete, name, id } read from DOM.describeNode.
export function axToElements(nodes, attributes = () => ({}), limit = 150) {
  const out = []
  for (const node of nodes || []) {
    if (out.length >= limit) break
    if (node.ignored) continue
    const role = ROLE[value(node.role)]
    if (!role || !Number.isInteger(node.backendDOMNodeId)) continue
    if (prop(node, 'disabled') === true || prop(node, 'hidden') === true) continue
    const attrs = attributes(node.backendDOMNodeId) || {}
    const label = String(value(node.name) || attrs.placeholder || attrs.title || '').replace(/\s+/g, ' ').trim().slice(0, 200)
    if (!label && role !== 'field' && role !== 'select') continue
    const type = String(attrs.type || '').toLowerCase()
    const sensitive = role === 'field' && (type === 'password' || SECRET.test([attrs.autocomplete, attrs.name, attrs.id, label].filter(Boolean).join(' ')))
    const item = { id: 'e' + (out.length + 1), ref: node.backendDOMNodeId, role, label }
    if (role === 'link' && typeof attrs.href === 'string' && /^https?:/i.test(attrs.href)) item.href = attrs.href.slice(0, 500)
    if (type && role === 'field') item.type = type
    // What the sign-in rules in NAJD read: the field's autocomplete purpose and its name and id (a verification-code field in disguise says so there).
    if (role === 'field' && attrs.autocomplete) item.autocomplete = String(attrs.autocomplete).slice(0, 100)
    if (role === 'field' && (attrs.name || attrs.id)) item.names = [attrs.name, attrs.id].filter(Boolean).join(' ').slice(0, 200)
    if (sensitive) item.sensitive = true
    if (prop(node, 'required') === true) item.required = true
    if (prop(node, 'checked') === 'true' || prop(node, 'checked') === true) item.checked = true
    if (role === 'field' && value(node.value)) item.filled = true
    out.push(item)
  }
  return out
}

// An action names the observation it was planned on. A newer observation, another document or a different control under the same
// number refuses it, so a stale number never acts on the wrong thing.
export function checkTarget(observation, expect, id) {
  if (!observation) return { ok: false, error: 'PAGE_CHANGED' }
  if (expect && (expect.doc !== observation.doc || String(expect.snap) !== String(observation.snap))) return { ok: false, error: 'PAGE_CHANGED' }
  const element = observation.elements.find(item => item.id === id)
  if (!element) return { ok: false, error: 'ELEMENT_NOT_FOUND' }
  if (expect?.role && expect.role !== element.role) return { ok: false, error: 'ELEMENT_CHANGED' }
  if (expect?.label && !String(expect.label).startsWith(element.label.slice(0, 40)) && !element.label.startsWith(String(expect.label).slice(0, 40))) return { ok: false, error: 'ELEMENT_CHANGED' }
  if (element.sensitive) return { ok: false, error: 'SENSITIVE_FIELD' }
  return { ok: true, element }
}

// What NAJD may do with a tab: tabs it opened (owned) can be navigated and closed; tabs the owner attached are only read and acted on.
export function canNavigate(ownership) { return ownership === 'owned' }

// Keys the model types are text only; Enter is sent separately when submit is asked.
export function keyEvents(key) {
  const map = { Enter: { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' }, Tab: { key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 }, Escape: { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 } }
  const base = map[key]
  if (!base) return []
  return [{ type: 'keyDown', ...base }, { type: 'keyUp', ...base, text: undefined }]
}
