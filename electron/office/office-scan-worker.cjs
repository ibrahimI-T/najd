// Fail-closed external-content scan, run in a worker thread (docs/AGENT-PLATFORM-M3-PLAN.md, M3-010/M3-014; inspection
// M3-I002/I005). The package is decompressed part by part with byte budgets, and each XML part is read with a real,
// namespace-aware XML parser (sax, strict): entities and character references are decoded, CDATA is read, prefixes do not
// matter, Word fields split across runs are rebuilt, and anything the parser cannot read is a reason to refuse.
const { parentPort, workerData } = require('node:worker_threads')
const fs = require('node:fs')
const sax = require('sax')
const { Unzip, UnzipInflate } = require('fflate')
const functions = require('./excel-functions.json')

const ALLOWED = new Set(functions.allowed), NEVER = new Set(functions.never)
const FIELDS = /\b(INCLUDETEXT|INCLUDEPICTURE|LINK|DDEAUTO|DDE)\b/i
// Characters of an Excel name (functions, defined names, add-in and LAMBDA names): letters and digits of any script,
// underscore, dot, backslash and question mark; surrogates so names outside the basic plane are read whole.
const NAME_CHAR = /[\p{L}\p{N}\p{M}_.\\?\uD800-\uDFFF]/u
// What may stand before a parenthesis that only groups: the start, an operator, a separator or another parenthesis.
const GROUPING = new Set(['+', '-', '*', '/', '^', '&', '=', '<', '>', ',', ';', '(', '{', '%', ':', '@', ' '])
const { maxInput, maxParts, maxPart, maxTotal } = workerData.limits
// Quoted text and quoted sheet names are not calls.
const unquoted = formula => formula.replace(/"(?:[^"]|"")*"/g, '""').replace(/'(?:[^']|'')*'/g, "''")
const local = name => String(name).split(':').pop()

// Every opening parenthesis is examined (M3-I018): one that follows a name is a call, and the whole name must be on the
// allowlist (prefixes _xlfn. and _xlws. aside), so add-in (_xll.), user-defined (_xludf.), LAMBDA and other names are
// refused; one that follows anything other than an operator or separator is syntax NAJD does not check, and refuses.
function scanFormula(formula, reasons) {
  const text = unquoted(formula)
  if (/\[[^\]]+\]/.test(text)) reasons.add('external workbook reference')
  if (/[\p{L}\p{N}_]+\|/u.test(text)) reasons.add('DDE formula')
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '(') continue
    let end = i - 1
    while (end >= 0 && /\s/.test(text[end])) end--
    let start = end
    while (start >= 0 && NAME_CHAR.test(text[start])) start--
    const raw = text.slice(start + 1, end + 1)
    if (!raw) { if (end >= 0 && !GROUPING.has(text[end])) reasons.add('formula syntax not checked'); continue }
    let bare = raw.toUpperCase()
    while (/^_XL(FN|WS)\./.test(bare)) bare = bare.slice(6)
    if (NEVER.has(bare) || bare.startsWith('CUBE') || !ALLOWED.has(bare)) reasons.add('formula not allowed: ' + bare)
  }
}

// Content and relationship types that bring in outside data, macros or controls, wherever the part lives (M3-I011).
const RISKY_TYPE = /externalLink|connections|queryTable|vbaProject|activeX|macrosheet|intlMacrosheet|dialogsheet|ms-excel\.sheet\.binary|\.binary|control|richData|rdRichValue|dataMashup/i

// One XML part: relationships, content types, Word fields and workbook formulas, by element and attribute local names.
// Every XML part is checked for formulas and fields whatever its folder or name: Office finds parts through
// relationships and content types, not through paths.
function scanXml(name, text, reasons) {
  const parser = sax.parser(true, { xmlns: false, trim: false })
  const formulaTags = new Set(['f', 'definedName', 'formula', 'formula1', 'formula2'])
  // fields: open complex fields; each collects its instruction text until its separate (or end) mark.
  const stack = [], fields = []
  const checkField = instruction => { if (FIELDS.test(instruction)) reasons.add('field that loads content: ' + FIELDS.exec(instruction)[1].toUpperCase()) }
  let collecting = null
  parser.ondoctype = () => reasons.add('document type declaration')
  parser.onerror = error => { reasons.add('unreadable XML: ' + name); parser.error = null; throw error }
  parser.onopentag = node => {
    const tag = local(node.name)
    stack.push(tag)
    const attributes = Object.fromEntries(Object.entries(node.attributes).map(([key, value]) => [local(key), value]))
    if (tag === 'Relationship' && attributes.TargetMode === 'External' && !/\/hyperlink$/.test(String(attributes.Type || '')))
      reasons.add('external resource: ' + (String(attributes.Type || '').split('/').pop() || 'link'))
    if (tag === 'Relationship' && RISKY_TYPE.test(String(attributes.Type || '').split('/').pop() || ''))
      reasons.add('part that loads data, macros or controls: ' + String(attributes.Type).split('/').pop())
    if ((tag === 'Override' || tag === 'Default') && RISKY_TYPE.test(String(attributes.ContentType || '')))
      reasons.add('part that loads data, macros or controls: ' + String(attributes.ContentType).split('.').pop())
    if (tag === 'fldSimple' && FIELDS.test(String(attributes.instr || ''))) reasons.add('field that loads content: ' + FIELDS.exec(attributes.instr)[1].toUpperCase())
    if (tag === 'fldChar') {
      const type = attributes.fldCharType, top = fields[fields.length - 1]
      if (type === 'begin') fields.push({ instruction: '', open: true })
      else if (type === 'separate' && top?.open) { checkField(top.instruction); top.open = false }
      else if (type === 'end' && top) { if (top.open) checkField(top.instruction); fields.pop() }
    }
    if (tag === 'instrText' || formulaTags.has(tag)) collecting = { tag, text: '' }
  }
  const take = text => { if (collecting) collecting.text += text }
  parser.ontext = take
  parser.oncdata = take
  parser.onclosetag = () => {
    const tag = stack.pop()
    if (collecting && collecting.tag === tag) {
      if (tag === 'instrText') {
        // An instruction outside a begin/end pair is still checked on its own.
        const top = fields[fields.length - 1]
        if (top?.open) top.instruction += collecting.text
        else checkField(collecting.text)
      } else scanFormula(collecting.text, reasons)
      collecting = null
    }
  }
  try { parser.write(text).close() } catch { reasons.add('unreadable XML: ' + name) }
  for (const field of fields) if (field.open) checkField(field.instruction)
}

function scan(file) {
  const size = fs.statSync(file).size
  if (size > maxInput) return ['package too large to check']
  const bytes = fs.readFileSync(file)
  if (bytes.length < 4 || bytes.readUInt32LE(0) !== 0x04034b50) return ['not an Office Open XML package (encrypted or damaged)']
  const reasons = new Set()
  const parts = new Map()
  let count = 0, total = 0, tooLarge = false
  const unzip = new Unzip(stream => {
    if (++count > maxParts) { tooLarge = true; return }
    const name = stream.name, low = name.toLowerCase()
    if (low.startsWith('xl/externallinks/')) reasons.add('external workbook link')
    else if (low === 'xl/connections.xml' || low.startsWith('xl/querytables/')) reasons.add('data connection or query')
    else if (low.startsWith('xl/richdata/')) reasons.add('linked data types')
    if (low.includes('/activex/') || /vbaproject\.bin$/.test(low)) reasons.add('ActiveX or macro part')
    // Every part is decompressed within the budgets; one whose first bytes look like XML (or text in another encoding)
    // is kept and parsed whatever its name. Binary parts (pictures, fonts) are counted and dropped.
    const chunks = []
    let partSize = 0, kind = null
    stream.ondata = (error, data, final) => {
      if (error) { reasons.add('not an Office Open XML package (encrypted or damaged)'); return }
      partSize += data.length; total += data.length
      if (partSize > maxPart || total > maxTotal) { tooLarge = true; stream.terminate(); return }
      if (kind === null) {
        chunks.push(data)
        const head = Buffer.concat(chunks)
        const start = head.subarray(head[0] === 0xef && head[1] === 0xbb && head[2] === 0xbf ? 3 : 0).toString('latin1').replace(/^[\s]+/, '')
        if ((head[0] === 0xff && head[1] === 0xfe) || (head[0] === 0xfe && head[1] === 0xff) || (head.length >= 2 && head[0] === 0x3c && head[1] === 0)) kind = 'other-encoding'
        else if (start.length) kind = start[0] === '<' ? 'xml' : 'binary'
        else if (final || head.length > 4096) kind = 'binary'
        if (kind === 'binary') chunks.length = 0
      } else if (kind !== 'binary') chunks.push(data)
      if (final && kind === 'other-encoding') reasons.add('XML part in an encoding NAJD does not check: ' + name)
      if (final && kind === 'xml') parts.set(name, Buffer.concat(chunks))
    }
    stream.start()
  })
  unzip.register(UnzipInflate)
  try { unzip.push(bytes, true) } catch { return ['not an Office Open XML package (encrypted or damaged)'] }
  if (tooLarge) return ['package too large to check']
  for (const [name, data] of parts) {
    const text = data.toString('utf8')
    if (/DataMashup/i.test(text.slice(0, 4096))) reasons.add('data connection or query')
    scanXml(name, text, reasons)
  }
  return [...reasons].sort()
}

try { parentPort.postMessage({ reasons: scan(workerData.file) }) }
catch (error) { parentPort.postMessage({ reasons: ['package could not be checked'], detail: String(error?.message || error).slice(0, 200) }) }
