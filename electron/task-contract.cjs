// Request understanding (M7, R-050): a small task contract built locally from the owner's words, with no extra model call.
// It names what must come out (deliverables), what goes in (files, links, attachments), limits the owner stated, and the
// checks a finished answer must pass. The model gets it as one compact line; nothing in it grants or widens permission.
const DELIVERABLES = [
  ['pptx', /\b(pptx|powerpoint|presentation|slides?|deck)\b|باوربوينت|بوربوينت|عرض تقديمي|شرائح|شريحة|سلايد|بريزنتيشن/i],
  ['docx', /\b(docx|word document|word file)\b|وورد|مستند/i],
  ['xlsx', /\b(xlsx|excel|spreadsheet|workbook)\b|إكسل|اكسل|جدول بيانات/i],
  ['pdf', /\bpdf\b/i],
  ['csv', /\bcsv\b/i],
  ['html', /\b(html|web ?page|website|landing page)\b|صفحة ويب|موقع|صفحة html/i],
  ['image', /\b(image|picture|photo|logo|poster|png|jpe?g)\b|صورة|شعار|لوقو|بوستر/i],
  ['video', /\b(video|mp4|clip)\b|فيديو|مقطع/i],
  ['code', /\b(script|code|function|program)\b|سكربت|سكريبت|كود|برنامج بايثون|دالة/i],
  ['skill', /\b(save (it|this) as a skill)\b|احفظ(ها|ه)? كمهارة/i]
]
const FILE = /[^\s\\/:*?"<>|;,'`()[\]{}«»“”‘’،؛]+\.[A-Za-z0-9]{1,5}(?![A-Za-z0-9])/g
const URL_PATTERN = /\bhttps?:\/\/[^\s<>"')]+/gi
const NUMBERED = /(\d{1,4})\s*(slides?|pages?|rows?|items?|words?|شرائح|شريحة|سلايد|صفحات|صفحة|بنود|بند|عناصر|كلمة|كلمات|سطر|أسطر)/gi
const LANGUAGE = [['Arabic', /بالعربي|باللغة العربية|\bin arabic\b/i], ['English', /بالإنجليزي|بالانجليزي|باللغة الإنجليزية|\bin english\b/i]]
const NOT = /(?:^|\s)(?:بدون|بلا|لا تستخدم|لا تحط|ما ابي|ما أبي)\s+[^\n،,.]{2,40}|\b(?:without|no|don'?t use|avoid)\s+[^\n,.]{2,40}/gi
// Words that make an action hard to undo: the model confirms what it will touch before doing it.
const CONSEQUENTIAL = /(?:^|\s)(احذف|امسح|ادفع|اشتر|أرسل لـ?|ارسل لـ?|انشر|ثبّت|ثبت|غيّر كلمة)|\b(delete|remove|pay|buy|purchase|publish|send (it )?to|install|wipe|format)\b/i

function buildContract(text, { attached = [] } = {}) {
  const request = String(text || '').slice(0, 4000)
  const deliverables = DELIVERABLES.filter(([, pattern]) => pattern.test(request)).map(([name]) => name).slice(0, 4)
  // Links are taken out first, so a domain name is never read as a file name.
  const files = [...new Set([...request.replace(URL_PATTERN, ' ').matchAll(FILE)].map(match => match[0].replace(/^[.]+/, '')).filter(name => !/^https?:/i.test(name)))].slice(0, 6)
  const links = [...new Set(request.match(URL_PATTERN) || [])].slice(0, 4)
  const counts = [...request.matchAll(NUMBERED)].map(match => match[1] + ' ' + match[2]).slice(0, 4)
  const language = LANGUAGE.find(([, pattern]) => pattern.test(request))?.[0] || null
  const exclusions = [...request.matchAll(NOT)].map(match => match[0].trim()).slice(0, 3)
  const checks = []
  if (deliverables.some(name => ['pptx', 'docx', 'xlsx', 'pdf', 'csv', 'html', 'image', 'video', 'code'].includes(name))) checks.push('the file exists where you saved it and its full path is in the answer')
  if (counts.length) checks.push('the counts asked for are met exactly')
  if (language) checks.push('the content is in ' + language)
  if (exclusions.length) checks.push('nothing the user excluded is used')
  return { deliverables, inputs: { files, links, attachments: attached.map(item => item.name).filter(Boolean).slice(0, 6) }, constraints: { counts, language, exclusions },
    checks, consequential: CONSEQUENTIAL.test(request) }
}

// One compact line for the model, or '' when the request carries nothing to pin down (no tokens spent on plain chat).
function contractLine(contract) {
  const parts = []
  if (contract.deliverables.length) parts.push('deliver: ' + contract.deliverables.join(', '))
  const inputs = [...contract.inputs.files, ...contract.inputs.links, ...contract.inputs.attachments.map(name => 'attached ' + name)]
  if (inputs.length) parts.push('inputs: ' + inputs.join(', '))
  const limits = [...contract.constraints.counts, ...(contract.constraints.language ? ['in ' + contract.constraints.language] : []), ...contract.constraints.exclusions]
  if (limits.length) parts.push('limits: ' + limits.join('; '))
  if (contract.checks.length) parts.push('done when: ' + contract.checks.join('; '))
  if (contract.consequential) parts.push('this asks for something hard to undo: confirm exactly what you will change before doing it, unless the request already names it')
  return parts.length ? 'NAJD_TASK_CONTRACT (built from the request; it grants no permission): ' + parts.join(' | ') + '.' : ''
}

module.exports = { buildContract, contractLine }
