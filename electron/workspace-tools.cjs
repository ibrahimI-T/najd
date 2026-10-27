// Model-callable local tools. Reads are scoped to granted folders and the NAJD
// workspace; every change or command is journaled and waits for an in-chat approval
// bound to the exact captured target and content. Results are bounded data.
const fs = require('node:fs')
const { replaceFile } = require('./atomic-file.cjs')
const fsp = require('node:fs/promises')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { createHash, randomUUID } = require('node:crypto')
const { contains, isSensitiveName } = require('./file-tools.cjs')

const error = code => Object.assign(new Error(code), { code })
const sha = value => createHash('sha256').update(value).digest('hex')
const MAX_READ = 8000, MAX_WRITE = 200000, MAX_OUTPUT = 8000
const skipDirectories = new Set(['node_modules', '.git', '.venv', '__pycache__', '$recycle.bin'])
const deviceName = /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i
const secretEnv = /(key|token|secret|password|credential|cookie)/i

// Commands are classified by effect. Only a small allowlist of system-information cmdlets,
// optionally piped through formatting/selection cmdlets, counts as read-only and runs without
// approval. Anything else (file content access, scripts, redirection, chaining, unknown
// commands) is a potential change and needs approval. File reading goes through the scoped file
// tools, so read-only commands never take file paths.
const READ_ONLY_HEADS = new Set(['get-date', 'get-location', 'pwd', 'get-process', 'gps', 'get-service', 'gsv', 'get-volume', 'get-psdrive',
  'get-culture', 'get-uiculture', 'get-timezone', 'get-host', 'hostname', 'whoami', 'get-computerinfo', 'get-netipaddress', 'get-netadapter',
  'get-hotfix', 'get-uptime', '$psversiontable', 'get-command', 'get-help', 'get-installedmodule', 'get-module', 'systeminfo', 'ipconfig'])
const READ_ONLY_FILTERS = new Set(['select-object', 'select', 'sort-object', 'sort', 'format-table', 'ft', 'format-list', 'fl', 'measure-object', 'measure',
  'out-string', 'where-object', 'where', 'group-object', 'convertto-json', 'select-object'])
// Native programs take their own options, some of which change the system ("ipconfig -release", "ipconfig
// -flushdns"), so each one runs without approval only with the informational options listed here; any other
// argument needs approval (M2-R31-001).
const FORMAT_VALUE = /^(table|list|csv)$/i
const NATIVE_ARGS = new Map([
  ['ipconfig', token => /^-(all|displaydns)$/i.test(token)],
  ['hostname', () => false],
  ['whoami', token => /^-(user|groups|priv|all|upn|fqdn|logonid|claims|nh|fo)$/i.test(token) || FORMAT_VALUE.test(token)],
  ['systeminfo', token => /^-(fo|nh)$/i.test(token) || FORMAT_VALUE.test(token)]
])
function classifyCommand(command) {
  const text = command.trim()
  if (!text || /[;&><`{}\r\n"']|\$\(|@\(|::/.test(text)) return 'change'
  // Only plain words, numbers, dashes, commas, wildcards and pipes: parentheses, brackets, variables and other
  // expression syntax can run nested commands (for example "Get-Date (Stop-Process ...)"), so anything else needs
  // approval. The one variable allowed is $PSVersionTable on its own at the start (M2-R18-001).
  if (!/^[A-Za-z0-9_\s|,*?=\-]*$/.test(text.replace(/^\$psversiontable\b/i, ''))) return 'change'
  const segments = text.split('|').map(part => part.trim())
  if (segments.some(part => !part)) return 'change'
  for (const [index, segment] of segments.entries()) {
    const tokens = segment.split(/\s+/), head = tokens[0].toLowerCase()
    if (!(index === 0 ? READ_ONLY_HEADS : READ_ONLY_FILTERS).has(head)) return 'change'
    if (NATIVE_ARGS.has(head) && !tokens.slice(1).every(NATIVE_ARGS.get(head))) return 'change'
    // No path-like arguments or script parameters, even for allowlisted cmdlets.
    if (tokens.slice(1).some(token => /[\\/:.$]|^-(command|encodedcommand|file|filepath|path|literalpath|computername|credential)$/i.test(token))) return 'change'
    // Get-Help can open a help window or the browser (-ShowWindow, -Online, and any abbreviation PowerShell accepts):
    // only its plain text forms count as read-only (M2-R19-001).
    if (['get-help', 'help', 'man'].includes(head) && tokens.slice(1).some(token => token.startsWith('-') && !/^-(full|detailed|examples|name|parameter|category|component|functionality|role)$/i.test(token))) return 'change'
  }
  return 'read'
}

function createWorkspaceTools({ getRoots, workspace, getProtectedRoots = () => [], journal, shell = 'powershell.exe', audit, onArtifact, trash, extraPath = () => null }) {
  // Commands see the user's environment without secrets. NAJD's own toolchain (Node, npm, npx) is appended to PATH so a
  // computer without Node can still build a website, while a Node the user installed keeps priority.
  const commandEnv = () => {
    const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !secretEnv.test(name)))
    const extra = extraPath()
    if (typeof extra === 'string' && extra) {
      const key = Object.keys(env).find(name => name.toUpperCase() === 'PATH') || 'Path'
      env[key] = (env[key] ? env[key] + path.delimiter : '') + extra
    }
    return env
  }
  if (typeof getRoots !== 'function' || !path.isAbsolute(workspace || '')) throw error('INVALID_INPUT')
  const record = entry => { try { audit?.record(entry) } catch { /* audit must not break tools */ } }
  const allRoots = () => [workspace, ...getRoots()].filter(root => typeof root === 'string' && path.isAbsolute(root))
  const real = target => { try { return fs.realpathSync(target) } catch { return null } }

  function nearestReal(target) {
    let current = target
    for (;;) {
      const resolved = real(current)
      if (resolved) return path.join(resolved, path.relative(current, target))
      const parent = path.dirname(current)
      if (parent === current) return target
      current = parent
    }
  }

  function resolve(raw, { write = false } = {}) {
    if (typeof raw !== 'string' || !raw.trim() || raw.length > 1024 || /[\x00-\x1f]/.test(raw)) throw error('INVALID_INPUT')
    const requested = raw.trim()
    const absolute = path.isAbsolute(requested) ? path.resolve(requested) : path.resolve(workspace, requested)
    // Alternate data streams and device names bypass name and scope checks.
    const rest = absolute.slice(path.parse(absolute).root.length)
    if (rest.includes(':') || rest.split(path.sep).some(part => deviceName.test(part))) throw error('PATH_NOT_ALLOWED')
    const resolved = nearestReal(absolute)
    for (const protectedRoot of getProtectedRoots()) {
      if (typeof protectedRoot !== 'string' || !path.isAbsolute(protectedRoot)) throw error('SENSITIVE_FILE')
      if (contains(nearestReal(protectedRoot), resolved)) throw error('SENSITIVE_FILE')
    }
    if (isSensitiveName(path.basename(resolved))) throw error('SENSITIVE_FILE')
    if (!write && !allRoots().some(root => contains(nearestReal(root), resolved))) throw error('PATH_NOT_ALLOWED')
    return { requested, absolute: resolved }
  }

  async function readText(target, offset, limit) {
    const handle = await fsp.open(target, 'r')
    try {
      const stat = await handle.stat()
      if (!stat.isFile()) throw error('NOT_A_FILE')
      if (stat.size > 4 * 1024 * 1024) throw error('FILE_TOO_LARGE')
      const buffer = Buffer.alloc(stat.size)
      const { bytesRead } = await handle.read(buffer, 0, stat.size, 0)
      const bytes = buffer.subarray(0, bytesRead)
      if (bytes.includes(0)) throw error('BINARY_FILE')
      const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes)
      const start = Math.max(0, Math.min(Number.isInteger(offset) ? offset : 0, text.length))
      const size = Math.max(1, Math.min(Number.isInteger(limit) ? limit : MAX_READ, MAX_READ))
      return { text: text.slice(start, start + size), offset: start, characters: text.length, hasMore: start + size < text.length }
    } finally { await handle.close() }
  }

  async function list(args) {
    // An empty path lists the NAJD workspace, as "." does (a model's first call often leaves it empty: one wasted step otherwise).
    const { absolute } = resolve(typeof args.path === 'string' && !args.path.trim() ? '.' : args.path)
    const entries = await fsp.readdir(absolute, { withFileTypes: true }).catch(() => { throw error('READ_FAILED') })
    record({ action: 'list-folder', decision: 'allowed', path: absolute })
    return { path: absolute, truncated: entries.length > 200,
      entries: entries.slice(0, 200).map(entry => ({ name: entry.name, type: entry.isDirectory() ? 'folder' : 'file' })) }
  }

  async function read(args) {
    const { absolute } = resolve(args.path)
    const result = await readText(absolute, args.offset, args.limit).catch(failure => {
      throw failure?.code && /^[A-Z_]+$/.test(failure.code) ? failure : error('READ_FAILED')
    })
    record({ action: 'read-file', decision: 'allowed', path: absolute })
    return { path: absolute, ...result }
  }

  async function search(args, signal) {
    if (typeof args.query !== 'string' || !args.query.trim() || args.query.length > 120) throw error('INVALID_INPUT')
    const { absolute } = resolve(args.path)
    const needle = args.query.trim().toLowerCase()
    const matches = [], pending = [[absolute, 0]]
    let visited = 0
    while (pending.length && matches.length < 30 && visited < 3000) {
      if (signal?.aborted) throw error('CANCELLED')
      const [directory, depth] = pending.shift()
      const entries = await fsp.readdir(directory, { withFileTypes: true }).catch(() => [])
      for (const entry of entries) {
        if (++visited > 3000 || matches.length >= 30) break
        if (entry.isSymbolicLink()) continue
        const full = path.join(directory, entry.name)
        if (entry.isDirectory()) { if (depth < 6 && !skipDirectories.has(entry.name.toLowerCase())) pending.push([full, depth + 1]); continue }
        if (isSensitiveName(entry.name)) continue
        if (entry.name.toLowerCase().includes(needle)) matches.push({ path: full, match: 'filename' })
        const stat = await fsp.stat(full).catch(() => null)
        if (!stat || stat.size > 262144 || matches.length >= 30) continue
        const text = await fsp.readFile(full).then(bytes => bytes.includes(0) ? null : bytes.toString('utf8')).catch(() => null)
        if (!text) continue
        const lines = text.split(/\r?\n/)
        for (let index = 0; index < lines.length && matches.length < 30; index++) {
          const at = lines[index].toLowerCase().indexOf(needle)
          if (at >= 0) matches.push({ path: full, line: index + 1, text: lines[index].slice(Math.max(0, at - 40), at + 120) })
        }
      }
    }
    record({ action: 'search-files', decision: 'allowed', path: absolute })
    return { path: absolute, matches, limited: matches.length >= 30 || visited >= 3000 }
  }

  // ---- approval-gated changes ----
  async function gated({ operation, tool, target, display, fingerprint, requestApproval, signal, execute, verify }) {
    if (typeof requestApproval !== 'function') throw error('PERMISSION_DENIED')
    if (signal?.aborted) throw error('CANCELLED')
    const action = journal ? await journal.prepare({ intentId: sha(randomUUID()).slice(0, 48), operation,
      target: target.replace(/[\x00-\x1f]+/g, ' ').slice(0, 1000), changeHash: sha(fingerprint) }) : null
    let decision
    try { decision = await requestApproval(tool, display) }
    catch (failure) { if (action) await journal.cancel(action.id).catch(() => {}); throw failure }
    record({ action: 'approval', decision: decision === 'ALLOW_ONCE' ? 'allowed' : 'denied', path: display.path || display.cwd || '', reason: tool })
    if (decision !== 'ALLOW_ONCE') {
      if (action) await journal.decide(action.id, action.nonce, 'DENY')
      return { status: 'denied_by_user', note: 'The user declined. Nothing was changed. Do not retry without new instructions.' }
    }
    if (action) await journal.decide(action.id, action.nonce, 'ALLOW_ONCE')
    if (signal?.aborted) { if (action) await journal.cancel(action.id); throw error('CANCELLED') }
    if (action) await journal.claim(action.id)
    let result
    try { result = await execute() }
    catch (failure) {
      // Best effort: a record failure must not replace the executor's own failure and its uncertainty.
      if (action) await journal.finish(action.id, failure?.effectResolved === true ? 'failed' : false).catch(() => {})
      throw Object.assign(error(failure?.code && /^[A-Z_]+$/.test(failure.code) ? failure.code : 'TOOL_FAILED'), { effectStarted: true, ...(failure?.effectResolved === true ? {} : { effectUnknown: true }) })
    }
    let verified = true
    try { verified = verify ? await verify(result) : true } catch { verified = false }
    let journalWarning = false
    if (action) await journal.finish(action.id, result.failed ? 'failed' : verified).catch(() => { journalWarning = true }) // the effect is done: a record failure is a warning, never a retryable failure
    if (journalWarning) return { ...result.output, ...(verified ? {} : { status: 'unverified' }), journalWarning: true }
    if (!verified) return { ...result.output, status: 'unverified', note: 'The effect could not be confirmed; inspect before relying on it.' }
    return result.output
  }

  // Registering a generated file in the library is best effort and never fails the write.
  async function register(output, absolute, text) {
    try {
      const asset = await onArtifact?.({ path: absolute, name: path.basename(absolute), text })
      return asset?.id ? { ...output, libraryId: asset.id } : output
    } catch { return output }
  }

  async function atomicWrite(target, content) {
    await fsp.mkdir(path.dirname(target), { recursive: true })
    const temporary = `${target}.${randomUUID()}.tmp`
    try {
      const handle = await fsp.open(temporary, 'wx', 0o600)
      try { await handle.writeFile(content, 'utf8'); await handle.sync() } finally { await handle.close() }
      await replaceFile(temporary, target)
    } finally { await fsp.unlink(temporary).catch(() => {}) }
  }

  async function write(args, ctx) {
    if (typeof args.content !== 'string' || args.content.length > MAX_WRITE) throw error('INVALID_INPUT')
    const { absolute } = resolve(args.path, { write: true })
    const existing = await fsp.stat(absolute).catch(() => null)
    if (existing && !existing.isFile()) throw error('NOT_A_FILE')
    const content = args.content
    return gated({ ...ctx, operation: 'files.write', tool: 'najd-files-write', target: absolute,
      fingerprint: JSON.stringify([absolute, sha(content)]),
      display: { path: absolute, summary: `${existing ? 'Overwrite' : 'Create'} (${content.length} characters)`, preview: content.slice(0, 1200), truncated: content.length > 1200 },
      execute: async () => { await atomicWrite(absolute, content); return { output: await register({ status: 'written', path: absolute, characters: content.length }, absolute, content) } },
      verify: async () => (await fsp.readFile(absolute, 'utf8')) === content })
  }

  async function edit(args, ctx) {
    if (typeof args.find !== 'string' || !args.find || args.find.length > 20000 || typeof args.replace !== 'string' || args.replace.length > 20000) throw error('INVALID_INPUT')
    const { absolute } = resolve(args.path, { write: true })
    const before = await readText(absolute, 0, MAX_WRITE).catch(() => { throw error('READ_FAILED') })
    if (before.hasMore) throw error('FILE_TOO_LARGE')
    const count = before.text.split(args.find).length - 1
    if (count !== 1) throw error(count === 0 ? 'NO_MATCH' : 'AMBIGUOUS_MATCH')
    const updated = before.text.replace(args.find, () => args.replace)
    return gated({ ...ctx, operation: 'files.patch', tool: 'najd-files-edit', target: absolute,
      fingerprint: JSON.stringify([absolute, sha(before.text), sha(updated)]),
      display: { path: absolute, summary: 'Replace one exact text occurrence', preview: `- ${args.find.slice(0, 500)}\n+ ${args.replace.slice(0, 500)}`, truncated: args.find.length > 500 || args.replace.length > 500 },
      execute: async () => {
        const current = await readText(absolute, 0, MAX_WRITE)
        if (current.text !== before.text) throw error('CONFLICT')
        await atomicWrite(absolute, updated)
        return { output: await register({ status: 'edited', path: absolute }, absolute, updated) }
      },
      verify: async () => (await fsp.readFile(absolute, 'utf8')) === updated })
  }

  function runCommand(command, cwd, signal) {
    return new Promise((resolveRun, rejectRun) => {
      const env = commandEnv()
      const child = spawn(shell, ['-NoProfile', '-NonInteractive', '-Command', command], { cwd, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
      let output = '', settled = false, timedOut = false
      const collect = chunk => { if (output.length < MAX_OUTPUT * 4) output += chunk.toString('utf8') }
      child.stdout.on('data', collect); child.stderr.on('data', collect)
      const kill = () => { try { spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }) } catch { child.kill() } }
      const timer = setTimeout(() => { timedOut = true; kill() }, 60000)
      const abort = () => kill()
      signal?.addEventListener('abort', abort, { once: true })
      const done = (fn, value) => { if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort); fn(value) }
      child.on('error', () => done(rejectRun, Object.assign(error('TERMINAL_UNAVAILABLE'), { effectResolved: true })))
      child.on('close', code => done(resolveRun, { code, timedOut, aborted: !!signal?.aborted,
        output: output.length > MAX_OUTPUT ? output.slice(0, MAX_OUTPUT) + '\n[output truncated]' : output }))
    })
  }

  async function terminal(args, ctx) {
    if (typeof args.command !== 'string' || !args.command.trim() || args.command.length > 4000 || args.command.includes('\0')) throw error('INVALID_INPUT')
    const { absolute: cwd } = resolve(typeof args.cwd === 'string' && args.cwd.trim() ? args.cwd : workspace, { write: true })
    await fsp.mkdir(cwd, { recursive: true }).catch(() => {})
    const stat = await fsp.stat(cwd).catch(() => null)
    if (!stat?.isDirectory()) throw error('NOT_A_FILE')
    const effect = classifyCommand(args.command)
    const execute = async () => {
        const run = await runCommand(args.command, cwd, ctx.signal)
        const output = { status: run.timedOut ? 'timed_out' : run.aborted ? 'cancelled' : 'finished', exitCode: run.code, output: run.output, effect }
        if (run.timedOut || run.aborted) throw Object.assign(error(run.aborted ? 'CANCELLED' : 'TIMEOUT'), { effectResolved: false })
        return { output, failed: run.code !== 0 }
      }
    if (effect === 'read') {
      // Read-only system inspection: no approval, no journal, still bounded and audited.
      record({ action: 'terminal-read', decision: 'allowed', path: cwd, reason: args.command.slice(0, 200) })
      try { return (await execute()).output } catch (failure) { throw failure.code ? failure : error('TOOL_FAILED') }
    }
    return gated({ ...ctx, operation: 'terminal.run', tool: 'najd-terminal-run', target: `${cwd} :: ${args.command}`,
      fingerprint: JSON.stringify([cwd, args.command]),
      display: { path: cwd, cwd, command: args.command, summary: 'Run a PowerShell command that may change your computer (60 s limit)' },
      execute: async () => {
        const run = await runCommand(args.command, cwd, ctx.signal)
        const output = { status: run.timedOut ? 'timed_out' : run.aborted ? 'cancelled' : 'finished', exitCode: run.code, output: run.output }
        if (run.timedOut || run.aborted) throw Object.assign(error(run.aborted ? 'CANCELLED' : 'TIMEOUT'), { effectResolved: false })
        return { output, failed: run.code !== 0 }
      } })
  }

  async function move(args, ctx) {
    const { absolute: from } = resolve(args.from, { write: true }), { absolute: to } = resolve(args.to, { write: true })
    const source = await fsp.stat(from).catch(() => null)
    if (!source) throw error('NOT_FOUND')
    if (await fsp.stat(to).catch(() => null)) throw error('CONFLICT')
    return gated({ ...ctx, operation: 'files.move', tool: 'najd-files-move', target: from + ' -> ' + to,
      fingerprint: JSON.stringify([from, to, source.size, source.mtimeMs]),
      display: { path: from, summary: `Move or rename to ${to}`, preview: `${from}
→ ${to}` },
      execute: async () => {
        if (await fsp.stat(to).catch(() => null)) throw Object.assign(error('CONFLICT'), { effectResolved: true })
        await fsp.mkdir(path.dirname(to), { recursive: true })
        await fsp.rename(from, to)
        return { output: { status: 'moved', path: to } }
      },
      verify: async () => !!await fsp.stat(to).catch(() => null) && !await fsp.stat(from).catch(() => null) })
  }

  async function remove(args, ctx) {
    const { absolute: target } = resolve(args.path, { write: true })
    const stat = await fsp.stat(target).catch(() => null)
    if (!stat) throw error('NOT_FOUND')
    if (typeof trash !== 'function') throw error('UNSUPPORTED_TOOL')
    return gated({ ...ctx, operation: 'files.delete', tool: 'najd-files-delete', target,
      fingerprint: JSON.stringify([target, stat.size, stat.mtimeMs]),
      display: { path: target, summary: stat.isDirectory() ? 'Move this folder to the Recycle Bin' : 'Move this file to the Recycle Bin' },
      execute: async () => { await trash(target); return { output: { status: 'moved_to_recycle_bin', path: target } } },
      verify: async () => !await fsp.stat(target).catch(() => null) })
  }

  // A copy of bytes NAJD already holds (a PDF Office made from a scanned private copy, or an attachment's verified original),
  // saved into a write-allowed folder after the owner approves it like any write; an existing file is never replaced
  // (owner requests 2026-10-25: safe Office to PDF; attachments usable by Python and convert()).
  async function saveCopy({ path: target, bytes, summary }, ctx) {
    if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > 100 * 1024 * 1024 || typeof summary !== 'string' || !summary) throw error('INVALID_INPUT')
    const { absolute } = resolve(target, { write: true })
    if (await fsp.stat(absolute).catch(() => null)) throw error('CONFLICT')
    return gated({ ...ctx, operation: 'files.write', tool: 'najd-files-write', target: absolute,
      fingerprint: JSON.stringify([absolute, sha(bytes)]),
      display: { path: absolute, summary: `${summary} (${Math.ceil(bytes.length / 1024)} KB)` },
      execute: async () => {
        await fsp.mkdir(path.dirname(absolute), { recursive: true })
        const temporary = `${absolute}.${randomUUID()}.tmp`
        try {
          await fsp.writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 })
          await fsp.copyFile(temporary, absolute, require('node:fs').constants.COPYFILE_EXCL)
        } catch (failure) { throw failure?.code === 'EEXIST' ? error('CONFLICT') : failure } finally { await fsp.rm(temporary, { force: true }).catch(() => {}) }
        return { output: { status: 'written', path: absolute, bytes: bytes.length } }
      },
      verify: async () => sha(await fsp.readFile(absolute)) === sha(bytes) })
  }
  async function savePdf({ path: target, bytes, source }, ctx) {
    if (!Buffer.isBuffer(bytes) || bytes.length < 5 || bytes.subarray(0, 5).toString('latin1') !== '%PDF-' || path.extname(String(target || '')).toLowerCase() !== '.pdf') throw error('INVALID_INPUT')
    return saveCopy({ path: target, bytes, summary: `Save the PDF Office made from ${path.basename(String(source || ''))}` }, ctx)
  }
  const handlers = {
    'files.list': (args) => list(args),
    'files.read': (args) => read(args),
    'files.search': (args, ctx) => search(args, ctx.signal),
    'files.write': write, 'files.edit': edit, 'files.move': move, 'files.delete': remove, 'terminal.run': terminal
  }
  const describe = () => ({ workspace, grantedFolders: getRoots().filter(root => typeof root === 'string').slice(0, 12) })
  // Working folder for execution tools (M2-R02): inside the NAJD workspace or a granted folder, never protected,
  // and checked without side effects. A missing folder is created only after the user approved the run.
  async function checkFolder(raw) {
    const { absolute } = resolve(typeof raw === 'string' && raw.trim() ? raw : workspace)
    const stat = await fsp.stat(absolute).catch(() => null)
    if (stat && !stat.isDirectory()) throw error('NOT_A_FILE')
    return { absolute, exists: !!stat }
  }
  async function createFolder(absolute) {
    resolve(absolute) // re-check the scope at creation time
    await fsp.mkdir(absolute, { recursive: true })
    return absolute
  }
  // The environment for commands NAJD runs: the user's own minus anything that looks like a secret.
  const executionEnv = commandEnv
  return { run: (operation, args, ctx = {}) => handlers[operation](args, ctx), resolve, checkFolder, createFolder, executionEnv, workspace, describe, savePdf, saveCopy }
}

module.exports = { createWorkspaceTools, classifyCommand }
