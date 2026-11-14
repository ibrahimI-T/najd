// A read-only preview of one file for the chat's file cards (owner request 2026-11-10). The caller decides which paths are allowed
// (a conversation's recorded outputs, or files inside the NAJD workspace); this module only reads and classifies, within fixed limits.
const fs = require('node:fs/promises')
const path = require('node:path')
const { Worker } = require('node:worker_threads')

const TEXT_LIMIT = 512 * 1024
const IMAGE_LIMIT = 8 * 1024 * 1024
// Word, Excel, PowerPoint and PDF are read as text by the same isolated worker the library uses (document-worker.cjs):
// a memory budget, a time limit, no drawing and no macros, so a preview never opens another program.
const DOCUMENT_LIMIT = 25 * 1024 * 1024
const DOCUMENTS = { '.docx': 'docx', '.xlsx': 'xlsx', '.pptx': 'pptx', '.pdf': 'pdf' }
const IMAGES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp' }
// Extension → the language name the workbench's code view and page view understand.
const LANGUAGES = { '.html': 'html', '.htm': 'html', '.svg': 'svg', '.md': 'markdown', '.markdown': 'markdown', '.txt': 'text', '.log': 'text', '.csv': 'csv', '.tsv': 'csv',
  '.json': 'json', '.jsonl': 'json', '.xml': 'xml', '.yaml': 'yaml', '.yml': 'yaml', '.toml': 'toml', '.ini': 'ini', '.js': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript',
  '.ts': 'typescript', '.tsx': 'typescript', '.jsx': 'javascript', '.py': 'python', '.ps1': 'powershell', '.sh': 'bash', '.bat': 'bat', '.cmd': 'bat', '.css': 'css',
  '.sql': 'sql', '.java': 'java', '.cs': 'csharp', '.go': 'go', '.rs': 'rust', '.rb': 'ruby', '.php': 'php', '.c': 'c', '.h': 'c', '.cpp': 'cpp', '.vue': 'vue' }

const fail = code => Object.assign(new Error(code), { code })

// {kind:'text', language, text, truncated} | {kind:'image', mime, dataUrl} | {kind:'other'} for files only their own app can show.
async function previewFile(filePath) {
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) throw fail('INVALID_INPUT')
  const stat = await fs.stat(filePath).catch(() => null)
  if (!stat || !stat.isFile()) throw fail('NOT_FOUND')
  const extension = path.extname(filePath).toLowerCase()
  const name = path.basename(filePath)
  if (IMAGES[extension]) {
    if (stat.size > IMAGE_LIMIT) return { kind: 'other', name, size: stat.size }
    const data = await fs.readFile(filePath)
    return { kind: 'image', name, size: stat.size, mime: IMAGES[extension], dataUrl: `data:${IMAGES[extension]};base64,${data.toString('base64')}` }
  }
  if (DOCUMENTS[extension]) {
    if (stat.size > DOCUMENT_LIMIT) return { kind: 'other', name, size: stat.size }
    const text = await documentText(await fs.readFile(filePath), DOCUMENTS[extension]).catch(() => null)
    if (text === null) return { kind: 'other', name, size: stat.size }
    return { kind: 'text', name, size: stat.size, language: 'text', text: text.slice(0, TEXT_LIMIT), truncated: text.length > TEXT_LIMIT, extracted: true }
  }
  if (!LANGUAGES[extension]) return { kind: 'other', name, size: stat.size }
  const handle = await fs.open(filePath, 'r')
  try {
    const buffer = Buffer.alloc(Math.min(stat.size, TEXT_LIMIT))
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
    const text = buffer.subarray(0, bytesRead).toString('utf8')
    // A file that is not really text (NUL bytes) is left to its own app.
    if (text.includes('\u0000')) return { kind: 'other', name, size: stat.size }
    return { kind: 'text', name, size: stat.size, language: LANGUAGES[extension], text, truncated: stat.size > TEXT_LIMIT }
  } finally { await handle.close() }
}

function documentText(bytes, kind, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, 'document-worker.cjs'), { workerData: { bytes, kind }, resourceLimits: { maxOldGenerationSizeMb: 512, maxYoungGenerationSizeMb: 64 }, stdout: true, stderr: true })
    worker.stdout.resume(); worker.stderr.resume()
    let settled = false
    const finish = (error, text) => { if (settled) return; settled = true; clearTimeout(timer); void worker.terminate(); if (error) reject(error); else resolve(text) }
    const timer = setTimeout(() => finish(fail('EXTRACTION_TIMEOUT')), timeoutMs)
    worker.once('message', result => typeof result?.text === 'string' ? finish(null, result.text) : finish(fail(result?.error || 'EXTRACTION_FAILED')))
    worker.once('error', () => finish(fail('EXTRACTION_FAILED')))
    worker.once('exit', () => finish(fail('EXTRACTION_FAILED')))
  })
}

module.exports = { previewFile, TEXT_LIMIT, IMAGE_LIMIT, DOCUMENT_LIMIT }
