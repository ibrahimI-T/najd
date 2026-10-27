// What counts as a sensitive browser action (money, account, passwords) and the flags that carry that decision across masking.
// The bridge computes the flags from the complete page BEFORE saved passwords are masked (masking could otherwise remove the very words
// that make an action sensitive); browser-tools reads the flags and applies the same rules to anything else.
const SENSITIVE_ACTION = /(change|reset|update|forgot)[ _-]*(my )?(password|passcode)|delete[ _-]*(my )?(account|profile)|close[ _-]*(my )?account|deactivate|(wire|bank|money)[ _-]*transfer|transfer[ _-]*(funds|money)|send[ _-]*money|\bpay(ment)?\b|checkout|place[ _-]*order|confirm[ _-]*purchase|withdraw|تغيير كلمة|إعادة تعيين كلمة|حذف (ال)?حساب|إغلاق (ال)?حساب|تحويل|دفع|سحب|شراء|اتمام الطلب|إتمام الطلب|\bbuy\b|\bpurchase\b|\bsubscribe\b|\bupgrade[ _-]*(now|to|plan)\b|\bdonate\b|\bbook[ _-]*now\b|\border[ _-]*now\b|complete[ _-]*(my |the )?(order|purchase)|submit[ _-]*(my |the )?order|confirm[ _-]*(my |the )?(order|payment|booking|reservation)|proceed[ _-]*to[ _-]*(payment|pay)|send[ _-]*payment|اشتر|اطلب الآن|تأكيد الطلب|تأكيد الدفع|احجز الآن|تبرع|اشتراك|ترقية الآن/i

const decoded = value => { let text = String(value || ''); for (let round = 0; round < 3; round++) { try { const next = decodeURIComponent(text.replace(/\+/g, ' ')); if (next === text) break; text = next } catch { break } } return text }
// Where a form goes and what its submit buttons say count for anything that submits it (a button press, or Enter in one of its fields).
const formSensitive = item => item.strictForm === true || item.formIncomplete === true || item.incomplete === true || SENSITIVE_ACTION.test(`${item.form || ''} ${item.formAction || ''} ${decoded(item.formAction)}`)
// The element's own words and destination, and the page it is on.
const sensitiveReason = (item, page) => item.strict === true || page?.strictPage === true ||
  SENSITIVE_ACTION.test(`${item.label || ''} ${item.names || ''} ${item.href || ''} ${item.target || ''} ${decoded(item.target)} ${page?.title || ''} ${page?.url || ''}`)

// A copy of a page report with the decisions written into it: page.strictPage, element.strict (its own words, destination, page, or an incomplete
// description), element.strictForm (the form it submits) and, for selects, whether each option is sensitive (optionPairs[i][2]).
function flagPage(page) {
  if (!page || typeof page !== 'object') return page
  // The page's own words and its complete address (fragment included). An address that could not be delivered completely is treated as sensitive.
  const strictPage = SENSITIVE_ACTION.test(`${page.title || ''} ${page.url || ''} ${decoded(page.url)} ${page.fullUrl || ''} ${decoded(page.fullUrl)}`) || page.urlIncomplete === true
  const { fullUrl, urlIncomplete, ...rest } = page // the complete address is used here only; it is not passed on
  const elements = Array.isArray(page.elements) ? page.elements.map(item => {
    if (!item || typeof item !== 'object') return item
    const strict = SENSITIVE_ACTION.test(`${item.label || ''} ${item.names || ''} ${item.href || ''} ${item.target || ''} ${decoded(item.target)}`) || item.longTarget === true || item.incomplete === true
    const strictForm = formSensitive(item)
    // Per option: sensitive, or not completely described (the extension's third entry).
    const optionPairs = Array.isArray(item.optionPairs) ? item.optionPairs.map(pair => Array.isArray(pair) ? [pair[0], pair[1], pair[2] === true || SENSITIVE_ACTION.test(`${pair[0]} ${pair[1]} ${decoded(pair[1])}`)] : pair) : item.optionPairs
    return { ...item, ...(strict ? { strict: true } : {}), ...(strictForm ? { strictForm: true } : {}), ...(optionPairs ? { optionPairs } : {}) }
  }) : page.elements
  return { ...rest, ...(strictPage ? { strictPage: true } : {}), elements }
}
module.exports = { SENSITIVE_ACTION, decoded, formSensitive, sensitiveReason, flagPage }
