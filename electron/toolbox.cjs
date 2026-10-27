// najd_toolbox: deterministic, read-only helpers that answer in a few hundred tokens what would otherwise take many
// reads or a model-written script (token saving, owner request R-064). Every helper is bounded in input size, time
// and output size, never writes, never runs a shell, and only touches paths the workspace resolver allows (the
// same roots and sensitive-file rules as najd_files_read). Results are plain data; file content stays untrusted.
//
// Why Node and not model-written Python: nothing here needs approval, no interpreter has to be ready, the code is
// reviewed and tested once instead of being regenerated (and re-billed) on every call, and results are identical
// every time. Spreadsheets and documents already have their own extractors; this does not duplicate them.
const fsp = require('node:fs/promises')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { Worker } = require('node:worker_threads')

const fail = code => Object.assign(new Error(code), { code })
const MAX_FILE = 8 * 1024 * 1024        // largest file read whole (tables, JSON, diffs)
const MAX_HASH = 512 * 1024 * 1024      // hashing streams, so it can take larger files
const HASH_TIME_MS = 30000              // one hash call
const DUPLICATES_TIME_MS = 25000        // all hashing of one duplicates call
const DUPLICATES_BYTES = 2 * 1024 * 1024 * 1024 // total bytes hashed by one duplicates call
const MAX_OUT = 7000                    // characters of JSON returned for any helper
const SKIP = new Set(['node_modules', '.git', '.hg', '.svn', '__pycache__', '.venv', 'venv', 'dist', 'build', '.next', '.cache'])
const isSensitive = name => /(^|[\\/])(\.env(\..*)?|id_rsa.*|.*\.(pem|key|pfx|p12|kdbx)|credentials?(\..*)?|secrets?(\..*)?|\.npmrc|\.netrc)$/i.test(name)

// ---- shared helpers ------------------------------------------------------------------------------------------------
const clipText = (value, length) => { const text = String(value); return text.length > length ? text.slice(0, length - 1) + '…' : text }
function bounded(result) {
  const size = value => JSON.stringify(value).length
  if (size(result) <= MAX_OUT) return result
  const copy = JSON.parse(JSON.stringify(result))
  // 1) halve the longest array until it fits; 2) cut long strings; 3) last resort: a preview of the serialized text.
  for (let pass = 0; pass < 30 && size(copy) > MAX_OUT; pass++) {
    let best = null
    const visit = node => { if (Array.isArray(node)) { if (node.length > 1 && (!best || size(node) > size(best))) best = node; node.forEach(visit) } else if (node && typeof node === 'object') Object.values(node).forEach(visit) }
    visit(copy)
    if (!best) break
    best.length = Math.ceil(best.length / 2)
  }
  for (const limit of [400, 120, 40]) {
    if (size(copy) <= MAX_OUT) break
    const cut = node => { for (const key of Object.keys(node)) { const value = node[key]; if (typeof value === 'string' && value.length > limit) node[key] = value.slice(0, limit) + '…'; else if (value && typeof value === 'object') cut(value) } }
    cut(copy)
  }
  copy.truncated = true
  copy.note = 'Output was cut to fit; narrow the request (a smaller path, limit or options.pick), or read the file in parts with najd_files_read.'
  if (size(copy) <= MAX_OUT) return copy
  // The preview is measured inside its envelope (escaping included) and shrunk until the whole answer fits.
  let preview = JSON.stringify(result).slice(0, MAX_OUT)
  let envelope = { truncated: true, note: copy.note, preview }
  while (size(envelope) > MAX_OUT && preview.length > 0) { preview = preview.slice(0, Math.floor(preview.length * 0.8)); envelope = { truncated: true, note: copy.note, preview } }
  return envelope
}
async function readWhole(file, limit = MAX_FILE) {
  const handle = await fsp.open(file, 'r')
  try {
    const stat = await handle.stat()
    if (!stat.isFile()) throw fail('NOT_A_FILE')
    if (stat.size > limit) throw fail('FILE_TOO_LARGE')
    const buffer = Buffer.alloc(stat.size)
    const { bytesRead } = await handle.read(buffer, 0, stat.size, 0)
    return buffer.subarray(0, bytesRead)
  } finally { await handle.close() }
}
function decode(bytes) {
  if (bytes.includes(0) && !(bytes[0] === 0xff && bytes[1] === 0xfe)) throw fail('BINARY_FILE')
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2))
  const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes)
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}
async function walk(root, { maxEntries = 20000, maxDepth = 8, signal, allow = () => true } = {}) {
  const files = []
  let complete = true, seen = 0
  const queue = [[root, 0]]
  while (queue.length) {
    if (signal?.aborted) throw fail('CANCELLED')
    const [folder, depth] = queue.shift()
    const entries = await fsp.readdir(folder, { withFileTypes: true }).catch(() => { complete = false; return [] })
    for (const entry of entries) {
      if (++seen > maxEntries) return { files, complete: false }
      if (entry.isSymbolicLink()) continue
      const full = path.join(folder, entry.name)
      // Every traversed entry passes the same resolver as a direct read: protected roots and sensitive names are skipped before listing or reading.
      if (!allow(full)) continue
      if (entry.isDirectory()) { if (SKIP.has(entry.name.toLowerCase())) continue; if (depth + 1 <= maxDepth) queue.push([full, depth + 1]); else complete = false; continue }
      if (!entry.isFile() || isSensitive(entry.name)) continue
      const stat = await fsp.stat(full).catch(() => null)
      if (stat) files.push({ path: full, size: stat.size, mtime: stat.mtimeMs })
    }
  }
  return { files, complete }
}
const rel = (root, file) => path.relative(root, file).split(path.sep).join('/') || path.basename(file)
const humanSize = bytes => bytes < 1024 ? bytes + ' B' : bytes < 1048576 ? (bytes / 1024).toFixed(1) + ' KB' : bytes < 1073741824 ? (bytes / 1048576).toFixed(1) + ' MB' : (bytes / 1073741824).toFixed(2) + ' GB'

// ---- inventory -----------------------------------------------------------------------------------------------------
async function inventory({ absolute, signal, allow }) {
  const { files, complete } = await walk(absolute, { signal, allow })
  const byType = new Map()
  for (const file of files) {
    const ext = path.extname(file.path).toLowerCase() || '(none)'
    const row = byType.get(ext) || { files: 0, bytes: 0 }
    row.files++; row.bytes += file.size; byType.set(ext, row)
  }
  const total = files.reduce((sum, file) => sum + file.size, 0)
  return { root: absolute, files: files.length, size: humanSize(total), complete,
    types: [...byType].sort((a, b) => b[1].bytes - a[1].bytes).slice(0, 12).map(([ext, row]) => ({ ext, files: row.files, size: humanSize(row.bytes) })),
    largest: [...files].sort((a, b) => b.size - a.size).slice(0, 8).map(file => ({ path: rel(absolute, file.path), size: humanSize(file.size) })),
    newest: [...files].sort((a, b) => b.mtime - a.mtime).slice(0, 8).map(file => ({ path: rel(absolute, file.path), modified: new Date(file.mtime).toISOString().slice(0, 16) })) }
}

// ---- tables (CSV / TSV) --------------------------------------------------------------------------------------------
// maxCells: the parse stops there (complete: false), so no file can make this run for long.
// strict: anything after a closing quote other than a delimiter or the end of the record, and a quote left open at the end, make the file invalid (malformed: true) instead of
// producing values that were never in it (the delimiter guess reads only the start of a file and is not strict).
function parseDelimited(text, delimiter, maxRows, maxCells = 1000000, strict = false) {
  const rows = []
  let row = [], field = '', quoted = false, cells = 0, afterQuote = false
  for (let index = 0; index < text.length; index++) {
    const char = text[index]
    if (afterQuote) { afterQuote = false; if (strict && char !== delimiter && char !== '\n' && char !== '\r') return { rows, complete: false, malformed: true } }
    if (quoted) {
      if (char === '"') { if (text[index + 1] === '"') { field += '"'; index++ } else { quoted = false; afterQuote = true } } else field += char
    } else if (char === '"' && field === '') quoted = true
    else if (char === delimiter) { row.push(field); field = ''; if (++cells > maxCells) return { rows, complete: false } }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[index + 1] === '\n') index++
      row.push(field); field = ''; cells++
      if (row.length > 1 || row[0] !== '') rows.push(row)
      row = []
      if (rows.length > maxRows || cells > maxCells) return { rows, complete: false }
    } else field += char
  }
  if (strict && quoted) return { rows, complete: false, malformed: true }
  if (field !== '' || row.length) { row.push(field); rows.push(row) }
  return { rows, complete: true }
}
// The delimiter is the candidate that splits the first records (quotes respected) into the same number of columns, more than one.
function sniffDelimiter(text) {
  const head = text.slice(0, 20000)
  let best = ',', bestScore = -1
  for (const candidate of [',', ';', '\t', '|']) {
    const { rows } = parseDelimited(head, candidate, 25, 5000)
    if (!rows.length) continue
    const widths = new Map()
    for (const row of rows) widths.set(row.length, (widths.get(row.length) || 0) + 1)
    const [width, count] = [...widths].sort((a, b) => b[1] - a[1])[0]
    const score = width > 1 ? (count / rows.length) * 1000 + Math.min(width, 100) : 0
    if (score > bestScore) { bestScore = score; best = candidate }
  }
  return best
}
const MAX_COLUMNS = 200
const NUMBER = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/
// Exact value of a numeric cell as a rational number, or null when the cell is not a plain number.
const MAX_CELL_CHARS = 60, MAX_CELL_EXPONENT = 40, PROFILE_TIME_MS = 4000
function toDecimal(value) {
  if (String(value).length > MAX_CELL_CHARS + 4) return null // not read as a number: no huge number is ever turned into a BigInt
  const exponent = /[eE]([-+]?\d+)\s*$/.exec(String(value))
  if (exponent && Math.abs(Number(exponent[1])) > MAX_CELL_EXPONENT) return null
  const text = String(value).trim().replace(/^\((.*)\)$/, '-$1')
  const cleaned = /^[-+]?\d{1,3}(,\d{3})+(\.\d+)?$/.test(text) ? text.replace(/,/g, '') : text
  if (!NUMBER.test(cleaned)) return null
  try { const parsed = parseNumber(cleaned.replace(/^[-+]/, '')); return cleaned.startsWith('-') ? { n: -parsed.n, d: parsed.d } : parsed } catch { return null }
}
const compare = (x, y) => { const left = x.n * y.d, right = y.n * x.d; return left < right ? -1 : left > right ? 1 : 0 }
// Decimal places needed to write a rational exactly (null when it does not terminate).
function exactPlaces(value) {
  let d = value.d, twos = 0, fives = 0
  while (d % 2n === 0n) { d /= 2n; twos++ }
  while (d % 5n === 0n) { d /= 5n; fives++ }
  return d === 1n ? Math.max(twos, fives) : null
}
async function tableProfile({ absolute, options, signal }) {
  const text = decode(await readWhole(absolute))
  const delimiter = typeof options.delimiter === 'string' && [',', ';', '\t', '|'].includes(options.delimiter) ? options.delimiter : sniffDelimiter(text)
  const { rows, complete, malformed } = parseDelimited(text, delimiter, 200000, 1000000, true)
  if (malformed) return { error: 'INVALID_INPUT', note: 'The file is not valid CSV (text after a closing quote, or a quote that is never closed), so no statistics were computed. Fix the file, or read it with najd_files_read.' }
  if (!rows.length) return { error: 'NO_MATCH', note: 'The file has no rows.' }
  if (rows[0].length > MAX_COLUMNS) return { error: 'FILE_TOO_LARGE', note: 'The file has more than ' + MAX_COLUMNS + ' columns; this helper profiles tables up to that width. Set options.delimiter if the delimiter was guessed wrong.' }
  const header = rows[0].map((name, index) => (name.trim() || 'column_' + (index + 1)))
  const body = rows.slice(1)
  const deadline = Date.now() + PROFILE_TIME_MS
  // Every loop below gives the rest of the app a turn, stops when the task is stopped, and ends the column (not the table) when the time budget is gone.
  class Budget extends Error {}
  const tick = async at => {
    if (at % 2048 !== 0) return
    if (signal?.aborted) throw fail('CANCELLED')
    if (Date.now() > deadline) throw new Budget()
    await new Promise(resolve => setImmediate(resolve))
  }
  const MEDIAN_LIMIT = 20000 // the median needs a sort; beyond this many values it is not computed (and the answer says so)
  const profileColumn = async (name, index) => {
    const values = body.map(row => row[index] ?? '')
    const filled = values.filter(value => value.trim() !== '')
    const numbers = []
    for (let at = 0; at < filled.length; at++) { await tick(at); numbers.push(toDecimal(filled[at])) }
    const numeric = filled.length > 0 && numbers.every(value => value !== null)
    const counts = new Map()
    for (let at = 0; at < filled.length; at++) { await tick(at); counts.set(filled[at], (counts.get(filled[at]) || 0) + 1) }
    const base = { name, filled: filled.length, empty: values.length - filled.length, distinct: counts.size }
    if (numeric) {
      // Exact arithmetic on the cell values (no floating point): min, max, median and sum are written exactly, as strings; the mean is rounded to 10 places.
      let sum = { n: 0n, d: 1n }, low = numbers[0], high = numbers[0], integers = true
      for (let at = 0; at < numbers.length; at++) {
        await tick(at)
        const value = numbers[at]
        sum = add(sum, value)
        if (compare(value, low) < 0) low = value
        if (compare(value, high) > 0) high = value
        if (value.d !== 1n) integers = false
      }
      const write = value => decimal(value, exactPlaces(value) ?? 10)
      let median = null
      if (numbers.length <= MEDIAN_LIMIT) {
        const sorted = [...numbers].sort(compare)
        median = write(sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : div(add(sorted[sorted.length / 2 - 1], sorted[sorted.length / 2]), { n: 2n, d: 1n }))
      }
      return { ...base, type: integers ? 'integer' : 'number', min: write(low), max: write(high), mean: decimal(div(sum, { n: BigInt(numbers.length), d: 1n }), 10),
        median, ...(median === null ? { medianNote: 'not computed: more than ' + MEDIAN_LIMIT + ' values' } : {}), sum: write(sum) }
    }
    const top = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([value, count]) => ({ value: clipText(value, 40), count }))
    return { ...base, type: filled.length && filled.every(value => /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?)?/.test(value)) ? 'date' : 'text', top }
  }
  const columns = []
  for (const [index, name] of header.entries()) {
    try { columns.push(await profileColumn(name, index)) }
    catch (failure) { if (!(failure instanceof Budget)) throw failure; columns.push({ name, type: 'not profiled', note: 'The time budget for this table was reached.' }) }
  }
  const ragged = body.filter(row => row.length !== header.length).length
  const sample = Math.max(0, Math.min(Number.isInteger(options.rows) ? options.rows : 3, 10))
  return { file: path.basename(absolute), delimiter: delimiter === '\t' ? 'tab' : delimiter, rows: body.length, complete, ...(ragged ? { raggedRows: ragged } : {}), columns,
    sample: body.slice(0, sample).map(row => header.map((_, index) => clipText(row[index] ?? '', 40))) }
}

// ---- JSON outline and extraction -----------------------------------------------------------------------------------
function outline(value, depth) {
  if (Array.isArray(value)) {
    const kinds = [...new Set(value.slice(0, 200).map(item => item === null ? 'null' : Array.isArray(item) ? 'array' : typeof item))]
    const first = value.find(item => item && typeof item === 'object')
    return { type: 'array', length: value.length, items: kinds.join('|') || 'empty', ...(first && depth > 0 ? { sample: outline(first, depth - 1) } : {}) }
  }
  if (value && typeof value === 'object') {
    const keys = Object.keys(value)
    return { type: 'object', keys: keys.length, ...(depth > 0 ? { fields: Object.fromEntries(keys.slice(0, 40).map(key => [key, outline(value[key], depth - 1)])) } : { names: keys.slice(0, 40) }) }
  }
  return typeof value === 'string' ? 'string(' + value.length + ')' : value === null ? 'null' : typeof value
}
function pick(value, pathText) {
  let current = value
  for (const part of pathText.split('.').filter(Boolean)) {
    if (current === null || typeof current !== 'object') return undefined
    const key = Array.isArray(current) && /^\d+$/.test(part) ? Number(part) : part
    if (!Object.hasOwn(current, key)) return undefined
    current = current[key]
  }
  return current
}
async function jsonOutline({ absolute, options }) {
  let data
  // Numbers that a double cannot hold exactly (more than 15 significant digits, or out of range) are returned as { $exactNumber: "source text" } instead of being rounded.
  const exact = (key, value, context) => {
    if (typeof value !== 'number' || typeof context?.source !== 'string') return value
    const digits = context.source.replace(/^-/, '').replace(/[eE].*$/, '').replace('.', '').replace(/^0+/, '').replace(/0+$/, '')
    // Also kept as text: nonzero values in the subnormal range, where a double is only an approximation.
    const subnormal = value !== 0 && Math.abs(value) < 2.2250738585072014e-308
    return !Number.isFinite(value) || digits.length > 15 || (value === 0 && digits.length > 0) || subnormal ? { $exactNumber: context.source } : value
  }
  try { data = JSON.parse(decode(await readWhole(absolute)), exact) } catch (failure) { if (failure?.code) throw failure; return { error: 'INVALID_INPUT', note: 'The file is not valid JSON.' } }
  if (typeof options.pick === 'string' && options.pick.trim()) {
    const found = pick(data, options.pick.trim())
    if (found === undefined) return { error: 'NO_MATCH', note: 'That path does not exist. Use the outline first.' }
    return { path: options.pick.trim(), value: found, ...(JSON.stringify(found).length > MAX_OUT ? { outline: outline(found, 2) } : {}) }
  }
  return { file: path.basename(absolute), outline: outline(data, Number.isInteger(options.depth) ? Math.max(0, Math.min(options.depth, 4)) : 2) }
}

// ---- search --------------------------------------------------------------------------------------------------------
// A pattern that nests quantifiers can make a regex run for minutes; such patterns and back-references are refused.
const DANGEROUS = /\([^)]*[+*][^)]*\)[+*{]|\\[1-9]|\(\?[<=!]/
const REGEX_DEADLINE_MS = 1500
const REGEX_WORKER = "const { parentPort, workerData } = require('node:worker_threads'); const expression = new RegExp(workerData.pattern, workerData.flags); parentPort.on('message', lines => parentPort.postMessage(lines.map(line => line.search(expression))))"
// A regular expression cannot be interrupted once it runs, so it runs in a worker that is terminated at the deadline.
function regexRunner(pattern, caseSensitive) {
  if (DANGEROUS.test(pattern)) throw fail('INVALID_INPUT')
  const flags = caseSensitive ? '' : 'i'
  try { new RegExp(pattern, flags) } catch { throw fail('INVALID_INPUT') }
  const worker = new Worker(REGEX_WORKER, { eval: true, workerData: { pattern, flags } })
  let pending = null
  worker.on('message', value => { const done = pending; pending = null; done?.resolve(value) })
  worker.on('error', () => { const done = pending; pending = null; done?.reject(fail('INVALID_INPUT')) })
  return {
    search: lines => new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending = null; worker.terminate(); reject(fail('TIMEOUT')) }, REGEX_DEADLINE_MS)
      pending = { resolve: value => { clearTimeout(timer); resolve(value) }, reject: failure => { clearTimeout(timer); reject(failure) } }
      worker.postMessage(lines)
    }),
    close: () => worker.terminate()
  }
}
// Returns { search(lines) -> Promise<number[]> (index of the match in each line, -1 for none), close() }.
function matcher(pattern, regex, caseSensitive) {
  if (typeof pattern !== 'string' || !pattern || pattern.length > 200) throw fail('INVALID_INPUT')
  if (regex) return regexRunner(pattern, caseSensitive)
  const needle = caseSensitive ? pattern : pattern.toLowerCase()
  return { search: async lines => lines.map(line => (caseSensitive ? line : line.toLowerCase()).indexOf(needle)), close() {} }
}
async function grep({ absolute, options, signal, allow }) {
  const find = matcher(options.pattern, options.regex === true, options.caseSensitive === true)
  try {
  const context = Math.max(0, Math.min(Number.isInteger(options.context) ? options.context : 0, 3))
  const limit = Math.max(1, Math.min(Number.isInteger(options.limit) ? options.limit : 25, 60))
  const stat = await fsp.stat(absolute)
  const walked = stat.isDirectory() ? await walk(absolute, { signal, allow, maxEntries: 5000, maxDepth: 6 }) : { files: [{ path: absolute, size: stat.size }], complete: true }
  const oversized = walked.files.filter(file => file.size > 1048576).length
  const targets = walked.files.filter(file => file.size <= 1048576)
  const hits = []
  let scanned = 0, skipped = 0, longLines = 0
  const regexMode = options.regex === true
  for (const file of targets) {
    if (signal?.aborted) throw fail('CANCELLED')
    if (hits.length >= limit) break
    let text
    try { text = decode(await readWhole(file.path, 1048576)) } catch { skipped++; continue }
    scanned++
    const lines = text.split(/\r?\n/)
    // Literal search reads whole lines; only a regular expression is limited to the first 5,000 characters of a line (and says so).
    const limitLine = regexMode ? 5000 : Infinity
    if (regexMode) for (const line of lines) if (line.length > limitLine) longLines++
    const found = await find.search(lines.map(line => line.length > limitLine ? line.slice(0, limitLine) : line))
    for (let index = 0; index < lines.length && hits.length < limit; index++) {
      if (found[index] < 0) continue
      // The excerpt is built around the match (its position is returned as a column), never from the start of a long line.
      const raw = lines[index], position = Math.max(0, found[index]), from = Math.max(0, position - 80), shown = raw.slice(from, from + 200)
      const hit = { file: stat.isDirectory() ? rel(absolute, file.path) : path.basename(file.path), line: index + 1, column: position + 1,
        text: (from > 0 ? '…' : '') + shown.trim() + (from + 200 < raw.length ? '…' : ''), ...(raw.length > 200 ? { clipped: true } : {}) }
      if (context) hit.context = lines.slice(Math.max(0, index - context), index + context + 1).map(item => clipText(item.trim(), 120))
      hits.push(hit)
    }
  }
  // complete: nothing was left unsearched. A stopped search (limit reached) is not exhaustive either, and is marked limited.
  const complete = walked.complete && skipped === 0 && oversized === 0 && longLines === 0 && hits.length < limit
  return { pattern: options.pattern, scanned, skipped, matches: hits.length, limited: hits.length >= limit, complete,
    ...(complete ? {} : { notSearched: { unreadableOrBinary: skipped, largerThan1MB: oversized, longLinesCutAt5000: longLines, folderIncomplete: !walked.complete }, note: 'Not everything was searched; absence of a match is not proof.' }), hits }
  } finally { find.close() }
}

// ---- hashes and duplicates -----------------------------------------------------------------------------------------
// Reads at most the size the file had when it was opened (a growing file cannot extend the call) and stops at the deadline.
async function sha256(file, signal, deadline = Date.now() + HASH_TIME_MS) {
  const hash = createHash('sha256')
  const handle = await fsp.open(file, 'r')
  try {
    const limit = (await handle.stat()).size
    const buffer = Buffer.alloc(1048576)
    let total = 0
    while (total < limit) {
      if (signal?.aborted) throw fail('CANCELLED')
      if (Date.now() > deadline) throw fail('TIMEOUT')
      const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, limit - total), total)
      if (!bytesRead) break
      hash.update(buffer.subarray(0, bytesRead)); total += bytesRead
    }
  } finally { await handle.close() }
  return hash.digest('hex')
}
async function hashFile({ absolute, signal }) {
  const stat = await fsp.stat(absolute)
  if (!stat.isFile()) throw fail('NOT_A_FILE')
  if (stat.size > MAX_HASH) throw fail('FILE_TOO_LARGE')
  return { file: path.basename(absolute), size: stat.size, sha256: await sha256(absolute, signal) }
}
async function duplicates({ absolute, signal, allow }) {
  const { files, complete } = await walk(absolute, { signal, allow, maxEntries: 20000 })
  const bySize = new Map()
  for (const file of files) bySize.set(file.size, [...(bySize.get(file.size) || []), file])
  const groups = []
  let hashed = 0
  const notCompared = { tooLarge: 0, budgetReached: 0 }
  const deadline = Date.now() + DUPLICATES_TIME_MS
  let hashedBytes = 0
  for (const same of bySize.values()) {
    if (same.length < 2) continue
    const byHash = new Map()
    for (const file of same) {
      if (file.size > MAX_HASH) { notCompared.tooLarge++; continue }
      if (hashed >= 3000 || hashedBytes + file.size > DUPLICATES_BYTES || Date.now() > deadline) { notCompared.budgetReached++; continue }
      hashed++; hashedBytes += file.size
      let digest
      try { digest = await sha256(file.path, signal, deadline) } catch (failure) { if (failure?.code === 'TIMEOUT') { notCompared.budgetReached++; continue } throw failure }
      byHash.set(digest, [...(byHash.get(digest) || []), file])
    }
    for (const [digest, list] of byHash) if (list.length > 1) groups.push({ sha256: digest.slice(0, 16), size: humanSize(list[0].size), wasted: list[0].size * (list.length - 1), files: list.map(file => rel(absolute, file.path)) })
  }
  groups.sort((a, b) => b.wasted - a.wasted)
  const exhaustive = complete && !notCompared.tooLarge && !notCompared.budgetReached
  return { root: absolute, scanned: files.length, complete: exhaustive, ...(exhaustive ? {} : { notCompared, folderIncomplete: !complete, note: 'Some candidate files were not compared, so the groups and the wasted space are lower bounds.' }),
    groups: groups.length, wasted: humanSize(groups.reduce((sum, group) => sum + group.wasted, 0)), top: groups.slice(0, 10).map(({ wasted, ...group }) => group) }
}

// ---- diff ----------------------------------------------------------------------------------------------------------
// Line diff by longest common subsequence on trimmed-trailing lines, bounded so it cannot run away.
// Lines are compared as numbers (each distinct line gets one), the work yields to the event loop and stops at a deadline or when the task is stopped, so a large
// diff can neither block the app nor ignore Stop.
const DIFF_TIME_MS = 4000
async function diffFiles({ absolute, second, options, signal }) {
  const a = decode(await readWhole(absolute)).split(/\r?\n/), b = decode(await readWhole(second)).split(/\r?\n/)
  if (a.length > 3000 || b.length > 3000) return { error: 'FILE_TOO_LARGE', note: 'Diff handles files up to 3000 lines; use najd_files_search to narrow down first.' }
  const ids = new Map()
  const intern = line => { let id = ids.get(line); if (id === undefined) { id = ids.size; ids.set(line, id) } return id }
  const A = a.map(intern), B = b.map(intern)
  const width = b.length + 1
  const table = new Uint32Array((a.length + 1) * width)
  const deadline = Date.now() + DIFF_TIME_MS
  for (let i = a.length - 1; i >= 0; i--) {
    if (i % 32 === 0) {
      if (signal?.aborted) throw fail('CANCELLED')
      if (Date.now() > deadline) throw fail('TIMEOUT')
      await new Promise(resolve => setImmediate(resolve))
    }
    for (let j = b.length - 1; j >= 0; j--) table[i * width + j] = A[i] === B[j] ? table[(i + 1) * width + j + 1] + 1 : Math.max(table[(i + 1) * width + j], table[i * width + j + 1])
  }
  const edits = []
  let i = 0, j = 0
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) { edits.push([' ', a[i], i + 1, j + 1]); i++; j++ }
    else if (j < b.length && (i === a.length || table[i * width + j + 1] >= table[(i + 1) * width + j])) { edits.push(['+', b[j], i + 1, j + 1]); j++ }
    else { edits.push(['-', a[i], i + 1, j + 1]); i++ }
  }
  const context = Math.max(0, Math.min(Number.isInteger(options.context) ? options.context : 1, 3))
  const changed = edits.map((edit, index) => edit[0] !== ' ' ? index : -1).filter(index => index >= 0)
  const added = edits.filter(edit => edit[0] === '+').length, removed = edits.filter(edit => edit[0] === '-').length
  if (!changed.length) return { identical: true }
  const keep = new Set()
  for (const index of changed) for (let k = Math.max(0, index - context); k <= Math.min(edits.length - 1, index + context); k++) keep.add(k)
  const lines = []
  let last = -2
  for (const index of [...keep].sort((x, y) => x - y)) {
    if (index !== last + 1) lines.push('@@ a' + edits[index][2] + ' b' + edits[index][3] + ' @@')
    lines.push(edits[index][0] + clipText(edits[index][1], 160)); last = index
  }
  return { identical: false, added, removed, diff: lines.slice(0, 120), ...(lines.length > 120 ? { truncated: true } : {}) }
}

// ---- exact arithmetic ----------------------------------------------------------------------------------------------
// Expressions use exact rational numbers (BigInt), so 0.1 + 0.2 is exactly 0.3 and 1/3*3 is exactly 1.
// Supported: numbers, + - * / % (modulo, sign of the divisor), ^ with an integer exponent, and parentheses.
const gcd = (a, b) => { a = a < 0n ? -a : a; b = b < 0n ? -b : b; while (b) [a, b] = [b, a % b]; return a }
const norm = (n, d) => { if (d === 0n) throw fail('INVALID_INPUT'); if (d < 0n) { n = -n; d = -d } const g = gcd(n, d) || 1n; return { n: n / g, d: d / g } }
const BIG_LIMIT = 4000n // digits are bounded below instead; this guards exponents
function parseNumber(text) {
  const match = /^(\d*)(?:\.(\d*))?(?:[eE]([-+]?\d+))?$/.exec(text)
  if (!match || !(match[1] || match[2])) throw fail('INVALID_INPUT')
  const fraction = match[2] || ''
  let value = norm(BigInt((match[1] || '0') + fraction), 10n ** BigInt(fraction.length))
  const exponent = match[3] ? Number(match[3]) : 0
  if (Math.abs(exponent) > 300) throw fail('INVALID_INPUT')
  return exponent >= 0 ? norm(value.n * 10n ** BigInt(exponent), value.d) : norm(value.n, value.d * 10n ** BigInt(-exponent))
}
const add = (x, y) => norm(x.n * y.d + y.n * x.d, x.d * y.d), mul = (x, y) => norm(x.n * y.n, x.d * y.d)
const div = (x, y) => norm(x.n * y.d, x.d * y.n)
function evaluate(expression) {
  const tokens = []
  for (const match of expression.matchAll(/\s*(\d{1,3}(?:,\d{3})+(?:\.\d+)?(?:[eE][-+]?\d+)?|\d+\.?\d*(?:[eE][-+]?\d+)?|\.\d+|[-+*/%^()]|\S)/g)) tokens.push(match[1].replace(/,/g, ''))
  if (!tokens.length || tokens.length > 200) throw fail('INVALID_INPUT')
  let position = 0
  const peek = () => tokens[position], take = () => tokens[position++]
  function primary() {
    const token = take()
    if (token === undefined) throw fail('INVALID_INPUT')
    if (token === '(') { const inner = sum(); if (take() !== ')') throw fail('INVALID_INPUT'); return inner }
    if (token === '-') { const inner = power(); return { n: -inner.n, d: inner.d } }
    if (token === '+') return power()
    if (/^[\d.]/.test(token)) return parseNumber(token)
    throw fail('INVALID_INPUT')
  }
  function power() {
    const base = primary()
    if (peek() === '^') {
      take()
      const exponent = power()
      if (exponent.d !== 1n || exponent.n > BIG_LIMIT || exponent.n < -BIG_LIMIT) throw fail('INVALID_INPUT')
      const times = exponent.n < 0n ? -exponent.n : exponent.n
      if (BigInt((base.n < 0n ? -base.n : base.n).toString().length + base.d.toString().length) * times > 6000n) throw fail('INVALID_INPUT')
      let result = { n: 1n, d: 1n }
      for (let k = 0n; k < times; k++) result = mul(result, base)
      return exponent.n < 0n ? div({ n: 1n, d: 1n }, result) : result
    }
    return base
  }
  function product() {
    let value = power()
    while (peek() === '*' || peek() === '/' || peek() === '%') {
      const operator = take(), right = power()
      if (operator === '*') value = mul(value, right)
      else if (operator === '/') value = div(value, right)
      else { if (right.n === 0n) throw fail('INVALID_INPUT'); const quotient = div(value, right); const whole = quotient.n / quotient.d; value = add(value, mul(right, { n: -(quotient.n < 0n && quotient.n % quotient.d !== 0n ? whole - 1n : whole), d: 1n })) }
    }
    return value
  }
  function sum() {
    let value = product()
    while (peek() === '+' || peek() === '-') { const operator = take(), right = product(); value = operator === '+' ? add(value, right) : add(value, { n: -right.n, d: right.d }) }
    return value
  }
  const result = sum()
  if (position !== tokens.length) throw fail('INVALID_INPUT')
  return result
}
function decimal(value, places) {
  const negative = value.n < 0n
  const scaled = (negative ? -value.n : value.n) * 10n ** BigInt(places)
  let quotient = scaled / value.d
  if ((scaled % value.d) * 2n >= value.d) quotient += 1n // round half up on the magnitude
  const digits = quotient.toString().padStart(places + 1, '0')
  const whole = digits.slice(0, digits.length - places), fraction = digits.slice(digits.length - places).replace(/0+$/, '')
  return (negative && quotient !== 0n ? '-' : '') + whole + (fraction ? '.' + fraction : '')
}
function calc({ options }) {
  const expression = typeof options.expression === 'string' ? options.expression : ''
  if (!expression || expression.length > 400) throw fail('INVALID_INPUT')
  const places = Number.isInteger(options.places) ? Math.max(0, Math.min(options.places, 30)) : 12
  const value = evaluate(expression)
  return { expression: expression.trim(), result: decimal(value, places), ...(value.d !== 1n ? { exact: value.n + '/' + value.d } : {}) }
}

// ---- dates ---------------------------------------------------------------------------------------------------------
function parseDay(text) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(text).trim())
  if (!match) throw fail('INVALID_INPUT')
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])]
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) throw fail('INVALID_INPUT')
  return date
}
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
function dates({ options }) {
  const from = parseDay(options.from)
  const result = /** @type {any} */ ({ from: options.from.trim(), weekday: WEEKDAYS[from.getUTCDay()] })
  if (typeof options.to === 'string' && options.to.trim()) {
    const to = parseDay(options.to)
    const days = Math.round((to - from) / 86400000)
    // Complete months are counted between the ordered endpoints; the sign of the interval is applied afterwards.
    const [early, late] = from <= to ? [from, to] : [to, from]
    let months = (late.getUTCFullYear() - early.getUTCFullYear()) * 12 + late.getUTCMonth() - early.getUTCMonth()
    if (late.getUTCDate() < early.getUTCDate()) months--
    result.to = options.to.trim(); result.days = days; result.weeks = Math.trunc(days / 7); result.remainderDays = days % 7; result.fullMonths = from <= to || months === 0 ? months : -months; result.toWeekday = WEEKDAYS[to.getUTCDay()]
  }
  if (Number.isInteger(options.addDays) && Math.abs(options.addDays) <= 36500) {
    const moved = new Date(from.getTime() + options.addDays * 86400000)
    result.plus = { days: options.addDays, date: moved.toISOString().slice(0, 10), weekday: WEEKDAYS[moved.getUTCDay()] }
  }
  return result
}

// ---- the tool ------------------------------------------------------------------------------------------------------
const HELPERS = {
  inventory: { needsPath: true, run: inventory, help: 'path = folder: files by type, largest and newest' },
  table: { needsPath: true, run: tableProfile, help: 'path = .csv/.tsv: per-column type, empties, min/max/mean/median, top values, sample rows (options.rows)' },
  json: { needsPath: true, run: jsonOutline, help: 'path = .json: structure with sizes; options.pick = "a.b.0.c" returns just that value' },
  grep: { needsPath: true, run: grep, help: 'path = file or folder; options.pattern, regex, caseSensitive, context (0-3), limit' },
  hash: { needsPath: true, run: hashFile, help: 'path = file: SHA-256' },
  duplicates: { needsPath: true, run: duplicates, help: 'path = folder: identical files by content, wasted space' },
  diff: { needsPath: true, needsSecond: true, run: diffFiles, help: 'path and options.other = two text files: changed lines only' },
  calc: { needsPath: false, run: calc, help: 'options.expression: exact arithmetic (+ - * / % ^ and parentheses; write 15% as 15/100); options.places (0-30)' },
  dates: { needsPath: false, run: dates, help: 'options.from YYYY-MM-DD, optional to and addDays: day counts, weekdays' }
}
const NAMES = Object.keys(HELPERS)
const KNOWN = new Set(['INVALID_INPUT', 'NOT_A_FILE', 'FILE_TOO_LARGE', 'BINARY_FILE', 'CANCELLED', 'PATH_NOT_ALLOWED', 'SENSITIVE_FILE', 'NOT_FOUND', 'TIMEOUT'])

// resolveReadable(input) returns an absolute path inside the workspace or a granted folder or throws (workspace resolver).
function createToolbox({ resolveReadable }) {
  if (typeof resolveReadable !== 'function') throw fail('INVALID_INPUT')
  return {
    names: NAMES,
    describe: () => NAMES.map(name => name + ': ' + HELPERS[name].help).join('; '),
    async run(args, { signal } = {}) {
      const helper = HELPERS[args?.tool]
      if (!helper) return { error: 'INVALID_INPUT', note: 'Unknown helper. Available: ' + NAMES.join(', ') }
      let options = {}
      if (typeof args.options === 'string' && args.options.trim()) {
        if (args.options.length > 2000) throw fail('INVALID_INPUT')
        try { options = JSON.parse(args.options) } catch { throw fail('INVALID_INPUT') }
        if (!options || typeof options !== 'object' || Array.isArray(options)) throw fail('INVALID_INPUT')
      }
      if (signal?.aborted) throw fail('CANCELLED')
      const allow = candidate => { try { resolveReadable(candidate); return true } catch { return false } }
      const context = { options, signal, allow }
      if (helper.needsPath) {
        // A folder helper with an empty path works on the NAJD workspace, as files.list does (one wasted step otherwise).
        const target = typeof args.path === 'string' && args.path.trim() ? args.path : ['inventory', 'duplicates'].includes(args.tool) ? '.' : ''
        if (!target) throw fail('INVALID_INPUT')
        context.absolute = resolveReadable(target)
        if (isSensitive(path.basename(context.absolute))) throw fail('SENSITIVE_FILE') // the same policy as for entries found while walking
        if (helper.needsSecond) {
          if (typeof options.other !== 'string') throw fail('INVALID_INPUT')
          context.second = resolveReadable(options.other)
          if (isSensitive(path.basename(context.second))) throw fail('SENSITIVE_FILE')
        }
      }
      try { return bounded(await helper.run(context)) }
      catch (failure) {
        if (KNOWN.has(failure?.code)) throw failure
        throw fail(failure?.code === 'ENOENT' ? 'NOT_FOUND' : 'READ_FAILED')
      }
    }
  }
}
module.exports = { createToolbox, evaluate, decimal, parseDelimited }
