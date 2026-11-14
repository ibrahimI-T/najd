// What submitting a control's form would do, read in the page for one element (runs as Runtime.callFunctionOn on that element).
// The same rules as the 1.x page scripts: the labels and destinations of the form's submit controls, a key of the whole form, and
// whether this control itself submits it. NAJD's policy uses these to classify "press Enter" and "press this button" as the
// same action, so typing with submit can never bypass a payment or account button the owner was asked about.
export const FORM_INFO = `function () {
  const element = this, form = element.form
  const cut = (value, limit) => String(value || '').slice(0, limit)
  const submitControls = target => [...target.elements, ...document.querySelectorAll('input[type=image]')]
    .filter(control => control.form === target && ((control.localName === 'button' && (control.type || 'submit') === 'submit') || (control.localName === 'input' && ['submit', 'image'].includes(control.type))))
  const controlText = control => [control.innerText, control.value, control.alt, control.getAttribute('aria-label'), control.getAttribute('title'),
    ...String(control.getAttribute('aria-labelledby') || '').split(/\\s+/).filter(Boolean).map(id => document.getElementById(id)?.innerText)]
    .filter(Boolean).map(text => String(text).trim().replace(/\\s+/g, ' ')).filter(Boolean).join(' | ')
  const tag = element.localName, type = String(element.type || '').toLowerCase()
  const submits = type === 'submit' || (tag === 'button' && !!form && (element.type || 'submit') === 'submit') || (tag === 'input' && type === 'image' && !!form)
  if (!form) return { submits: false }
  const buttons = submitControls(form)
  const keyText = form.action + '|' + form.method + '|' + buttons.slice(0, 20).map(button => controlText(button) + '@' + (button.hasAttribute('formaction') ? button.formAction : '') + '@' + (button.hasAttribute('formmethod') ? button.formMethod : '')).join('|') + '|' + (element.hasAttribute('formaction') ? element.formAction : '')
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57
  for (let index = 0; index < keyText.length; index++) { const code = keyText.charCodeAt(index); h1 = Math.imul(h1 ^ code, 2654435761); h2 = Math.imul(h2 ^ code, 1597334677) }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909); h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  const destination = submits && element.hasAttribute('formaction') ? element.formAction : form.action
  const info = { submits, form: cut(buttons.slice(0, 20).map(button => (controlText(button) + ' ' + (button.hasAttribute('formaction') ? button.formAction : '')).trim()).join(' | '), 4000), formKey: (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36) }
  try { info.formAction = cut(new URL(destination, location.href).toString(), 2000) } catch { info.formIncomplete = true }
  if (buttons.length > 20) info.formIncomplete = true
  return info
}`
