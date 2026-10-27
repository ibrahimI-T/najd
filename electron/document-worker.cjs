// Parsing untrusted documents is isolated from Electron's main event loop.
const { parentPort, workerData } = require('node:worker_threads')
const MAX_TEXT = 4000000 // about 2,000 pages of text: large references such as building codes (R-057)
const fail = code => { throw Object.assign(new Error(code), { code }) }

function decodeXml(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, entity) => {
    const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
    if (named[entity]) return named[entity]
    const code = entity[1]?.toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1))
    return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '\uFFFD'
  })
}

// Office Open XML parts read with fflate. Every part is bounded and checked for DTDs before any text is used.
function readParts(data, accept, maxPart, maxParts) {
  const { unzipSync } = require('fflate')
  let count = 0
  const entries = unzipSync(data, { filter: entry => {
    if (!accept(entry.name)) return false
    if (++count > maxParts) fail('EXTRACTION_LIMIT')
    if (entry.originalSize > maxPart) fail('EXTRACTION_LIMIT')
    return true
  } })
  const parts = {}
  for (const [name, bytes] of Object.entries(entries)) {
    const xml = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    if (/<!DOCTYPE|<!ENTITY/i.test(xml)) fail('EXTRACTION_FAILED')
    parts[name] = xml
  }
  return parts
}
const attributes = text => Object.fromEntries([...String(text || '').matchAll(/([\w:]+)="([^"]*)"/g)].map(match => [match[1], decodeXml(match[2])]))
const runs = (xml, tag) => [...xml.matchAll(new RegExp('<' + tag + '\\b[^>]*>([\\s\\S]*?)</' + tag + '>', 'g'))].map(match => decodeXml(match[1]))
// Targets in a relationships part, resolved against the folder of the part that owns them.
function relationships(xml, base) {
  const targets = {}
  for (const match of String(xml || '').matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const { Id, Target } = attributes(match[1])
    if (!Id || !Target) continue
    const parts = (Target.startsWith('/') ? Target.slice(1) : base + Target).split('/'), out = []
    for (const part of parts) { if (part === '..') out.pop(); else if (part && part !== '.') out.push(part) }
    targets[Id] = out.join('/')
  }
  return targets
}

// Workbooks (M3-001/M3-006): sheet names and cell values in order; a formula keeps its text, with its cached value
// marked as cached or "[result not calculated]" when there is none or Excel is told to recalculate on load.
// Cells keep their columns (M3-I016): a gap of up to MAX_GAP columns is written as empty fields, a wider one as a
// "[col X]" mark on the next value; a row that does not follow the previous written row is marked "[row N]".
const MAX_GAP = 26
function columnOf(ref) {
  const letters = /^([A-Z]{1,3})\d*$/.exec(String(ref || '').toUpperCase())?.[1]
  if (!letters) return null
  let n = 0
  for (const letter of letters) n = n * 26 + letter.charCodeAt(0) - 64
  return n <= 16384 ? n : null
}
function columnName(n) {
  let name = ''
  for (; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + (n - 1) % 26) + name
  return name
}
function extractWorkbook(data) {
  const parts = readParts(data, name => ['xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/sharedStrings.xml'].includes(name) || /^xl\/worksheets\/[^/]+\.xml$/.test(name), 4 * 1024 * 1024, 53)
  const workbook = parts['xl/workbook.xml']
  if (!workbook) fail('EXTRACTION_FAILED')
  const calc = attributes((/<calcPr\b([^>]*)\/?>/.exec(workbook) || [])[1])
  const recalculate = calc.fullCalcOnLoad === '1' || calc.fullCalcOnLoad === 'true'
  const strings = [...(parts['xl/sharedStrings.xml'] || '').matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map(match => runs(match[1], 't').join(''))
  const targets = relationships(parts['xl/_rels/workbook.xml.rels'], 'xl/')
  const sheets = [...workbook.matchAll(/<sheet\b([^>]*)\/?>/g)].map(match => attributes(match[1]))
  if (sheets.length > 50) fail('EXTRACTION_LIMIT')
  const out = []
  let length = 0
  for (const sheet of sheets) {
    const xml = parts[targets[sheet['r:id']]]
    if (!xml) continue
    const lines = ['Sheet: ' + (sheet.name || '')], shared = {}
    let previousRow = 0
    for (const row of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
      const cells = []
      const declared = Number(attributes(row[1]).r), rowNumber = Number.isInteger(declared) && declared > previousRow ? declared : previousRow + 1
      let column = 0
      for (const cell of (row[2] || '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = attributes(cell[1]), body = cell[2] || ''
        const raw = (/<v\b[^>]*>([\s\S]*?)<\/v>/.exec(body) || [])[1]
        let value = raw === undefined ? '' : decodeXml(raw)
        if (attrs.t === 's') value = strings[Number(value)] ?? ''
        else if (attrs.t === 'inlineStr') value = runs((/<is\b[^>]*>([\s\S]*?)<\/is>/.exec(body) || ['', ''])[1], 't').join('')
        else if (attrs.t === 'b') value = value === '1' ? 'TRUE' : value === '0' ? 'FALSE' : value
        const formula = /<f\b([^>]*?)(?:\/>|>([\s\S]*?)<\/f>)/.exec(body)
        if (formula) {
          const fattrs = attributes(formula[1])
          let text = formula[2] === undefined ? '' : decodeXml(formula[2]), note = ''
          if (fattrs.t === 'shared' && fattrs.si !== undefined) {
            if (text) shared[fattrs.si] = text
            else text = shared[fattrs.si] || ''
            note = ' (shared)'
          }
          value = '=' + text + note + ' → ' + (raw === undefined || raw === '' || recalculate ? '[result not calculated]' : value + ' (cached)')
        }
        const at = columnOf(attrs.r) ?? column + 1
        if (at <= column) continue
        if (value !== '') {
          const gap = at - (cells.length ? cells[cells.length - 1].column : 0) - 1
          cells.push({ column: at, text: gap > MAX_GAP ? '[col ' + columnName(at) + '] ' + value : value, gap: gap > MAX_GAP ? 0 : gap })
        }
        column = at
      }
      if (cells.length) {
        const fields = []
        for (const cell of cells) { for (let i = 0; i < cell.gap; i++) fields.push(''); fields.push(cell.text) }
        lines.push((rowNumber !== previousRow + 1 ? '[row ' + rowNumber + '] ' : '') + fields.join('\t'))
        previousRow = rowNumber
      }
    }
    const block = lines.join('\n')
    length += block.length
    if (length > MAX_TEXT) fail('EXTRACTION_LIMIT')
    out.push(block)
  }
  return out.join('\n\n').trim()
}

// Presentations: slides in presentation order, each slide's paragraphs.
function extractPresentation(data) {
  const parts = readParts(data, name => ['ppt/presentation.xml', 'ppt/_rels/presentation.xml.rels'].includes(name) || /^ppt\/slides\/[^/]+\.xml$/.test(name), 2 * 1024 * 1024, 202)
  const presentation = parts['ppt/presentation.xml']
  if (!presentation) fail('EXTRACTION_FAILED')
  const targets = relationships(parts['ppt/_rels/presentation.xml.rels'], 'ppt/')
  const slides = [...presentation.matchAll(/<p:sldId\b([^>]*)\/?>/g)].map(match => attributes(match[1])['r:id'])
  if (slides.length > 200) fail('EXTRACTION_LIMIT')
  const out = []
  let length = 0
  slides.forEach((id, index) => {
    const xml = parts[targets[id]]
    if (!xml) return
    const paragraphs = [...xml.matchAll(/<a:p\b[^>]*>([\s\S]*?)<\/a:p>/g)].map(match => runs(match[1], 'a:t').join('')).filter(Boolean)
    const block = ['Slide ' + (index + 1), ...paragraphs].join('\n')
    length += block.length
    if (length > MAX_TEXT) fail('EXTRACTION_LIMIT')
    out.push(block)
  })
  return out.join('\n\n').trim()
}

async function extract() {
  const data = new Uint8Array(workerData.bytes)
  let text
  if (workerData.kind === 'text') {
    text = new TextDecoder('utf-8', { fatal: true }).decode(data)
    if (text.includes('\0')) fail('EXTRACTION_FAILED')
  } else if (workerData.kind === 'docx') {
    const { unzipSync } = require('fflate')
    const entries = unzipSync(data, { filter: entry => {
      if (entry.name !== 'word/document.xml') return false
      // Word XML is many times larger than its text; the text limit (MAX_TEXT) and the worker's memory cap and deadline
      // bound the real work (R11-002: a 1.2 million character Arabic reference exceeds 2 MB of XML).
      if (entry.originalSize > 96 * 1024 * 1024) fail('EXTRACTION_LIMIT')
      return true
    } })
    if (!entries['word/document.xml']) fail('EXTRACTION_FAILED')
    const xml = new TextDecoder('utf-8', { fatal: true }).decode(entries['word/document.xml'])
    if (/<!DOCTYPE|<!ENTITY/i.test(xml)) fail('EXTRACTION_FAILED')
    text = decodeXml(xml.replace(/<w:tab\b[^>]*\/>/g, '\t').replace(/<w:br\b[^>]*\/>/g, '\n')
      .replace(/<\/w:p>/g, '\n').replace(/<[^>]+>/g, '')).trim()
  } else if (workerData.kind === 'xlsx') {
    text = extractWorkbook(data)
  } else if (workerData.kind === 'pptx') {
    text = extractPresentation(data)
  } else if (workerData.kind === 'pdf') {
    // Text extraction needs matrix primitives, but never creates a drawing canvas.
    // The optional native canvas renderer is excluded from the shipped package.
    globalThis.DOMMatrix = require('@thednp/dommatrix')
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const task = getDocument({ data, isEvalSupported: false, disableFontFace: true,
      useSystemFonts: false, stopAtErrors: true, useWasm: false, verbosity: 0 })
    try {
      const document = await task.promise
      if (document.numPages > 3000) fail('EXTRACTION_LIMIT')
      const pages = []
      let length = 0
      for (let number = 1; number <= document.numPages; number++) {
        const page = await document.getPage(number)
        const content = await page.getTextContent()
        const lines = content.items.map(item => item.str === undefined ? '' : item.str + (item.hasEOL ? '\n' : ' ')).join('')
        length += lines.length
        if (length > MAX_TEXT) fail('EXTRACTION_LIMIT')
        pages.push(lines)
        page.cleanup()
      }
      text = pages.join('\n').trim()
    } finally { await task.destroy() }
  } else fail('UNSUPPORTED_FORMAT')
  if (text.length > MAX_TEXT) fail('EXTRACTION_LIMIT')
  if (!text.trim()) fail('NO_EXTRACTABLE_TEXT')
  return text
}

extract().then(text => parentPort.postMessage({ text }), error => parentPort.postMessage({
  error: ['EXTRACTION_LIMIT', 'NO_EXTRACTABLE_TEXT', 'UNSUPPORTED_FORMAT'].includes(error.code) ? error.code : 'EXTRACTION_FAILED'
}))
