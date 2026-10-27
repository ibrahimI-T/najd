// najd_python_run and logs (M2b, with the M2 inspection fixes). A fake desktop host runs the script with Node in these
// isolated tests (the "code" is JavaScript) and writes its output to the owned log, as the real host does; the flow,
// approval, journal, limits, environment and logs are the real ones. tests/agent-e2e-smoke.cjs runs real Python through
// the real host; a separate test here runs the managed engine directly only when it is present and says so when skipped.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { createPythonTools } = require('../electron/python-tools.cjs')
const { createExecLogs } = require('../electron/exec-logs.cjs')
const { createActionJournal } = require('../electron/action-journal.cjs')

const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'najd-python-'))
// Starts the script from the host command with Node, only the given environment (plus what Windows needs to start
// a process), output appended to the log; list reports whether it is still running; stop ends it.
function fakeHost() {
  const jobs = new Map(), calls = []
  return { calls, jobs, async invokeHost(name, args, _timeout, options = {}) {
    calls.push([name, args])
    if (options.signal?.aborted) throw Object.assign(new Error('CANCELLED'), { code: 'CANCELLED', dispatched: false })
    if (name === 'najd.process.start') {
      // The script is the last argument (after NAJD's bootstrap and the pack path when the pack is used).
      const script = /'((?:[^']|'')+)'$/.exec(args.command)[1].replace(/''/g, "'")
      const out = fs.openSync(args.log, 'a')
      const child = spawn(process.execPath, [script], { cwd: args.cwd, env: { ...args.env, SystemRoot: process.env.SystemRoot }, stdio: ['ignore', out, out], windowsHide: true })
      const id = 'p' + calls.length, job = { child, running: true, exitCode: null, timedOut: false }
      child.on('exit', code => { job.running = false; job.exitCode = code; fs.closeSync(out) })
      // Like the real host, the job is ended at its own deadline (M2-R16-002).
      if (args.timeoutMs) setTimeout(() => { if (job.running) { job.timedOut = true; child.kill() } }, args.timeoutMs).unref()
      jobs.set(id, job)
      return { id, pid: child.pid, created: '1', contained: true }
    }
    if (name === 'najd.process.list') { if (options.listDelay) await new Promise(resolve => setTimeout(resolve, options.listDelay)); return [...jobs].map(([id, job]) => ({ id, running: job.running, exitCode: job.exitCode, timedOut: job.timedOut })) }
    if (name === 'najd.process.stop') { const job = jobs.get(args.id); if (job?.running) job.child.kill(); jobs.delete(args.id); return { id: args.id, stopped: true, familyClosed: true } }
  } }
}
function setup({ timeoutMs, journal = true, host = fakeHost() } = {}) {
  const root = temp(), work = path.join(root, 'work')
  fs.mkdirSync(work)
  const logs = createExecLogs({ directory: path.join(root, 'logs') })
  const actions = journal ? createActionJournal({ filePath: path.join(root, 'actions.json') }) : null
  const tools = createPythonTools({ getPython: async () => 'fake-python', host, stateRoot: path.join(root, 'state'), logs, journal: actions,
    checkFolder: async raw => { const absolute = raw ? path.join(root, raw) : work; return { absolute, exists: fs.existsSync(absolute) } },
    createFolder: async target => { fs.mkdirSync(target, { recursive: true }); return target }, ...(timeoutMs ? { timeoutMs } : {}) })
  return { root, work, logs, actions, tools, host }
}

test('the card shows the code; a denial runs nothing; an approval runs it and reports created files', async () => {
  const { work, tools, host } = setup()
  const code = "require('fs').writeFileSync('result.txt', String(2 + 3)); console.log('sum=' + (2 + 3))"
  const shown = []
  const denied = await tools.run({ code, cwd: '' }, { requestApproval: async (_tool, card) => { shown.push(card); return 'DENY' } })
  assert.equal(denied.status, 'denied_by_user'); assert.equal(fs.existsSync(path.join(work, 'result.txt')), false); assert.equal(host.calls.length, 0)
  assert.equal(shown[0].preview, code)
  const done = await tools.run({ code, cwd: '' }, { requestApproval: async () => 'ALLOW_ONCE', conversationId: 'conv-p' })
  assert.equal(done.status, 'finished'); assert.equal(done.exitCode, 0); assert.match(done.output, /sum=5/)
  assert.deepEqual(done.files, [path.join(work, 'result.txt')])
  assert.match(host.calls[0][1].command, /^& 'fake-python' -I -B -X utf8 '.+main\.py'$/)
})

test('M2-R01: code longer than the card can show is refused before asking; the full code is always shown', async () => {
  const { tools, host } = setup()
  const refused = await tools.run({ code: 'x'.repeat(4001), cwd: '' }, { requestApproval: async () => assert.fail('must not ask') })
  assert.equal(refused.status, 'refused'); assert.equal(refused.error, 'CODE_TOO_LONG'); assert.equal(host.calls.length, 0)
  const code = '//' + 'y'.repeat(3980) + '\nconsole.log(1)', shown = []
  await tools.run({ code, cwd: '' }, { requestApproval: async (_tool, card) => { shown.push(card); return 'DENY' } })
  assert.equal(shown[0].preview, code)
})

test('M2-R02: a missing folder is created only after approval', async () => {
  const { root, tools } = setup()
  await tools.run({ code: 'console.log(1)', cwd: 'later' }, { requestApproval: async () => 'DENY' })
  assert.equal(fs.existsSync(path.join(root, 'later')), false)
  const done = await tools.run({ code: "require('fs').writeFileSync('a.txt','a')", cwd: 'later' }, { requestApproval: async () => 'ALLOW_ONCE' })
  assert.equal(done.status, 'finished'); assert.ok(fs.existsSync(path.join(root, 'later', 'a.txt')))
})

test('only a scrubbed private environment is handed to the host; secrets never reach the code', async () => {
  const { tools, host } = setup()
  process.env.NAJD_TEST_SECRET_TOKEN = 'sk-should-not-leak'
  try {
    const done = await tools.run({ code: "console.log(process.env.NAJD_TEST_SECRET_TOKEN || 'absent')", cwd: '' }, { requestApproval: async () => 'ALLOW_ONCE' })
    assert.match(done.output, /absent/)
    const env = host.calls[0][1].env
    assert.equal(env.NAJD_TEST_SECRET_TOKEN, undefined); assert.equal(env.PYTHONNOUSERSITE, '1')
    assert.ok(!Object.values(env).includes('sk-should-not-leak'))
  } finally { delete process.env.NAJD_TEST_SECRET_TOKEN }
})

test('timeout ends the run and records an unknown effect; cancellation during approval or while running (M2-R05)', async () => {
  const { tools, actions } = setup({ timeoutMs: 800 })
  await assert.rejects(tools.run({ code: 'setInterval(() => {}, 1000)', cwd: '' }, { requestApproval: async () => 'ALLOW_ONCE' }), error => error.code === 'TIMEOUT' && error.familyClosed === true && error.effectUnknown === true && typeof error.logId === 'string')
  assert.ok((await actions.list()).some(item => /UNKNOWN/i.test(item.state)))
  const controller = new AbortController()
  const quiet = setup()
  await assert.rejects(quiet.tools.run({ code: "require('fs').writeFileSync('x.txt','x')", cwd: '' }, { signal: controller.signal,
    requestApproval: async () => { controller.abort(); return 'ALLOW_ONCE' } }), { code: 'CANCELLED' })
  assert.equal(quiet.host.calls.length, 0); assert.equal(fs.existsSync(path.join(quiet.work, 'x.txt')), false)
  const running = new AbortController(), busy = setup()
  setTimeout(() => running.abort(), 400)
  await assert.rejects(busy.tools.run({ code: 'setInterval(() => {}, 1000)', cwd: '' }, { signal: running.signal, requestApproval: async () => 'ALLOW_ONCE' }), { code: 'CANCELLED' })
  assert.ok(busy.host.calls.some(([name]) => name === 'najd.process.stop'))
})

test('M2-R2-004: files in subfolders are reported, and so are files left by a run that timed out', async () => {
  const { work, tools } = setup({ timeoutMs: 1500 })
  const done = await tools.run({ code: "const fs = require('fs'); fs.mkdirSync('outputs/charts', { recursive: true }); fs.writeFileSync('outputs/report.csv', 'a'); fs.writeFileSync('outputs/charts/c.txt', 'b')", cwd: '' },
    { requestApproval: async () => 'ALLOW_ONCE' })
  assert.deepEqual(done.files.sort(), [path.join(work, 'outputs', 'charts', 'c.txt'), path.join(work, 'outputs', 'report.csv')])
  assert.equal(done.filesComplete, true)
  await assert.rejects(tools.run({ code: "require('fs').writeFileSync('partial.txt', 'x'); setInterval(() => {}, 1000)", cwd: '' }, { requestApproval: async () => 'ALLOW_ONCE' }),
    error => error.code === 'TIMEOUT' && error.files.includes(path.join(work, 'partial.txt')))
})

test('the runtime lists files of a cancelled Python run with the conversation', async () => {
  const { createAgentRuntime } = require('../electron/agent-runtime.cjs')
  const library = { list: async () => [], read: async () => ({ text: '' }), search: async () => [] }
  const python = { available: async () => true, run: async () => { throw Object.assign(new Error('CANCELLED'), { code: 'CANCELLED', files: ['C:/work/partial.txt'] }) } }
  const outputs = []
  const runtime = createAgentRuntime({ catalog: { search: async () => [], details: async () => ({}) }, library, python, logs: { read: async () => ({}) } })
  await assert.rejects(runtime.run({ request: { text: 'run python', conversationId: 'conv-cancel' }, requestApproval: async () => 'ALLOW_ONCE', onOutput: async item => { outputs.push(item.path) },
    respond: async () => ({ kind: 'agent-tools', calls: [{ name: 'najd_python_run', arguments: JSON.stringify({ code: 'x', cwd: '' }), call_id: 'c1' }], items: [] }) }), { code: 'CANCELLED' })
  assert.deepEqual(outputs, ['C:/work/partial.txt'])
})

test('a host refusal is a known failure; the private run folder is removed', async () => {
  const host = { invokeHost: async () => { throw Object.assign(new Error('PROCESS_LIMIT'), { code: 'PROCESS_LIMIT', toolError: true, dispatched: true }) } }
  const { tools, actions, root } = setup({ host })
  await assert.rejects(tools.run({ code: 'console.log(1)', cwd: '' }, { requestApproval: async () => 'ALLOW_ONCE' }), { code: 'PROCESS_LIMIT' })
  assert.ok((await actions.list()).every(item => !/UNKNOWN/i.test(item.state)))
  assert.deepEqual(fs.readdirSync(path.join(root, 'state', 'python-runs')), [])
  // A host failure that is not proof of "never started" (M2-R2-003) is an unknown effect.
  const after = { invokeHost: async () => { throw Object.assign(new Error('STARTED_THEN_FAILED'), { code: 'STARTED_THEN_FAILED', toolError: true, dispatched: true }) } }
  const unknown = setup({ host: after })
  await assert.rejects(unknown.tools.run({ code: 'console.log(1)', cwd: '' }, { requestApproval: async () => 'ALLOW_ONCE' }), error => error.code === 'PROCESS_FAILED' && error.effectUnknown === true)
  assert.ok((await unknown.actions.list()).some(item => /UNKNOWN/i.test(item.state)))
})

test('long output: a bounded excerpt with a log the same conversation can page, one huge line included (M2-005/M2-009)', async () => {
  const { tools, logs } = setup()
  const done = await tools.run({ code: "process.stdout.write('A'.repeat(50000) + '\\n'); for (let i = 0; i < 3000; i++) console.log('line ' + i)", cwd: '' },
    { requestApproval: async () => 'ALLOW_ONCE', conversationId: 'conv-l', maxBytes: 4096 })
  assert.ok(Buffer.byteLength(done.output) <= 4096)
  assert.ok(done.truncated); assert.ok(done.totalBytes > 70000)
  assert.ok(done.output.split('\n').every(line => line.length <= 2100))
  let offset = done.nextOffset, pages = 0, last = ''
  while (offset !== null && pages < 100) { const page = await logs.read({ logId: done.logId, offset, conversationId: 'conv-l' }); last = page.text; offset = page.nextOffset; pages++ }
  assert.match(last, /line 2999/)
  await assert.rejects(logs.read({ logId: done.logId, offset: 0, conversationId: 'conv-other' }), { code: 'NOT_FOUND' })
})

test('no managed engine or no desktop host: not available and RUNTIME_NOT_READY, never a system Python', async () => {
  const root = temp()
  const base = { host: fakeHost(), checkFolder: async () => ({ absolute: root, exists: true }), createFolder: async () => root, stateRoot: root, logs: createExecLogs({ directory: path.join(root, 'logs') }) }
  const tools = createPythonTools({ ...base, getPython: async () => null })
  assert.equal(await tools.available(), false)
  await assert.rejects(tools.run({ code: 'print(1)', cwd: '' }, { requestApproval: async () => 'ALLOW_ONCE' }), { code: 'RUNTIME_NOT_READY' })
  assert.equal(await createPythonTools({ ...base, getPython: async () => 'python', hostReady: async () => false }).available(), false)
})

test('M2-R5-002: a family not seen closed after a timeout is handed to the background processes and its folder kept', async () => {
  const host = fakeHost(), real = host.invokeHost
  host.invokeHost = async (name, args, ...rest) => { if (name === 'najd.process.stop') { await real(name, args, ...rest); return { id: args.id, stopped: true, familyClosed: false } } return real(name, args, ...rest) }
  const adopted = []
  const { root } = setup({ host, timeoutMs: 600 })
  const withAdopt = createPythonTools({ getPython: async () => 'fake-python', host, stateRoot: path.join(root, 'state2'), logs: createExecLogs({ directory: path.join(root, 'logs2') }),
    journal: createActionJournal({ filePath: path.join(root, 'actions2.json') }), timeoutMs: 600, adopt: async details => { adopted.push(details); return 'proc-9' },
    checkFolder: async () => ({ absolute: path.join(root, 'work'), exists: true }), createFolder: async target => target })
  await assert.rejects(withAdopt.run({ code: 'setInterval(() => {}, 1000)', cwd: '' }, { requestApproval: async () => 'ALLOW_ONCE' }),
    error => error.code === 'TIMEOUT' && error.familyClosed === false && error.startId === 'proc-9' && typeof error.logId === 'string')
  assert.equal(adopted.length, 1); assert.equal(typeof adopted[0].hostId, 'string'); assert.equal(typeof adopted[0].actionId, 'string')
  assert.equal(fs.readdirSync(path.join(root, 'state2', 'python-runs')).length, 1, 'the private folder is kept while the family may run')
})

test('M2-R5-003/006: a journal that cannot be saved does not hide the result; an uncertain start keeps its log', async () => {
  const { tools, actions } = setup()
  actions.finish = async () => { throw Object.assign(new Error('WRITE_FAILED'), { code: 'WRITE_FAILED' }) }
  const done = await tools.run({ code: 'console.log(7)', cwd: '' }, { requestApproval: async () => 'ALLOW_ONCE' })
  assert.equal(done.status, 'finished'); assert.match(done.output, /7/); assert.equal(done.journalWarning, true)
  const after = { invokeHost: async () => { throw Object.assign(new Error('STARTED_THEN_FAILED'), { code: 'STARTED_THEN_FAILED', toolError: true, dispatched: true }) } }
  const uncertain = setup({ host: after })
  await assert.rejects(uncertain.tools.run({ code: 'console.log(1)', cwd: '' }, { requestApproval: async () => 'ALLOW_ONCE', conversationId: 'conv-q' }),
    error => error.effectUnknown === true && typeof error.logId === 'string')
})

test('M2-R6-003: a kept folder is removed only after its family ends, even when it is older than a day', async () => {
  const host = fakeHost(), real = host.invokeHost
  let closeOnStop = false
  host.invokeHost = async (name, args, ...rest) => {
    if (name === 'najd.process.stop' && !closeOnStop) return { id: args.id, stopped: true, familyClosed: false } // still running
    if (name === 'najd.process.start') args = { ...args, timeoutMs: undefined } // a family that outlives its deadline
    return real(name, args, ...rest)
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'najd-python-keep-')), work = path.join(root, 'work')
  fs.mkdirSync(work)
  const tools = createPythonTools({ getPython: async () => 'fake-python', host, stateRoot: path.join(root, 'state'), logs: createExecLogs({ directory: path.join(root, 'logs') }),
    timeoutMs: 600, adopt: async () => 'proc-1', checkFolder: async () => ({ absolute: work, exists: true }), createFolder: async target => target })
  await assert.rejects(tools.run({ code: 'setInterval(() => {}, 1000)', cwd: '' }, { requestApproval: async () => 'ALLOW_ONCE' }), { code: 'TIMEOUT' })
  const runs = path.join(root, 'state', 'python-runs'), [kept] = fs.readdirSync(runs)
  const dayAgo = new Date(Date.now() - 2 * 86400000)
  fs.utimesSync(path.join(runs, kept), dayAgo, dayAgo)
  await tools.run({ code: 'console.log(1)', cwd: '' }, { requestApproval: async () => 'ALLOW_ONCE' })
  assert.ok(fs.existsSync(path.join(runs, kept)), 'kept while its family still runs')
  closeOnStop = true
  for (const id of [...host.jobs.keys()]) await real('najd.process.stop', { id }) // the family ends
  await tools.run({ code: 'console.log(2)', cwd: '' }, { requestApproval: async () => 'ALLOW_ONCE' })
  assert.equal(fs.existsSync(path.join(runs, kept)), false, 'removed once its family ended')
})

test('M2-R7-003: a finished run keeps its exit code, files and log id when its output cannot be read', async () => {
  const { tools, logs, work } = setup()
  logs.read = async () => { throw Object.assign(new Error('LOG_UNAVAILABLE'), { code: 'LOG_UNAVAILABLE' }) }
  const done = await tools.run({ code: "require('fs').writeFileSync('made.txt', '1')", cwd: '' }, { requestApproval: async () => 'ALLOW_ONCE' })
  assert.equal(done.status, 'finished'); assert.equal(done.exitCode, 0); assert.equal(done.outputUnavailable, 'LOG_UNAVAILABLE')
  assert.deepEqual(done.files, [path.join(work, 'made.txt')]); assert.equal(typeof done.logId, 'string')
})

test('M2-R14-003: a folder grant removed while Python awaits approval means the code does not run', async () => {
  let granted = true
  const { host, root } = setup()
  const guarded = createPythonTools({ getPython: async () => 'fake-python', host, stateRoot: path.join(root, 'state3'), logs: createExecLogs({ directory: path.join(root, 'logs3') }),
    checkFolder: async () => { if (!granted) throw Object.assign(new Error('PATH_NOT_ALLOWED'), { code: 'PATH_NOT_ALLOWED' }); return { absolute: path.join(root, 'work'), exists: true } },
    createFolder: async target => target })
  await assert.rejects(guarded.run({ code: 'console.log(1)', cwd: '' }, { requestApproval: async () => { granted = false; return 'ALLOW_ONCE' } }), { code: 'PATH_NOT_ALLOWED' })
  assert.equal(host.calls.length, 0)
})

test('M2-R16-002: the host owns the deadline, so a status check that arrives late cannot turn an over-time run into success', async () => {
  // Every status check waits 1.5 s (as behind other work in the host queue); the run would finish at 1.2 s past a 1 s limit.
  const host = fakeHost(), real = host.invokeHost
  host.invokeHost = (name, args, timeout, options = {}) => real(name, args, timeout, name === 'najd.process.list' ? { ...options, listDelay: 1500 } : options)
  const { tools } = setup({ host, timeoutMs: 1000 })
  await assert.rejects(tools.run({ code: 'setTimeout(() => console.log("late"), 1200)', cwd: '' }, { requestApproval: async () => 'ALLOW_ONCE' }),
    error => error.code === 'TIMEOUT' && error.effectUnknown === true)
  assert.equal(host.calls.find(([name]) => name === 'najd.process.start')[1].timeoutMs, 1000)
})

test('M2-R16-003: a failure in any step before the code is sent releases the journal entry, private folder and log', async () => {
  for (const failing of ['log', 'folder']) {
    const { tools, actions, root, logs, host } = setup()
    if (failing === 'log') logs.createExternal = () => { throw Object.assign(new Error('EACCES'), { code: 'EACCES' }) }
    if (failing === 'folder') logs.createExternal = (original => options => { const log = original(options); throw Object.assign(new Error('late'), { code: 'EACCES', log }) })(logs.createExternal)
    await assert.rejects(tools.run({ code: 'console.log(1)', cwd: '' }, { requestApproval: async () => 'ALLOW_ONCE' }), { code: 'RUNTIME_NOT_READY' })
    assert.equal(host.calls.length, 0, failing)
    assert.ok((await actions.list()).every(item => !/UNKNOWN|EXECUTING|CLAIMED|APPROVED/i.test(item.state)), failing + ': ' + JSON.stringify((await actions.list()).map(item => item.state)))
    assert.deepEqual(fs.readdirSync(path.join(root, 'state', 'python-runs')), [], failing)
  }
})

test('M2-R27-002: a folder that cannot be listed makes the file inventory incomplete', async () => {
  const fsp = require('node:fs/promises')
  const { tools, work } = setup()
  const original = fsp.readdir
  fsp.readdir = async (folder, ...rest) => { if (String(folder).endsWith('locked')) throw Object.assign(new Error('EACCES'), { code: 'EACCES' }); return original.call(fsp, folder, ...rest) }
  try {
    const done = await tools.run({ code: "const fs = require('fs'); fs.mkdirSync('locked'); fs.writeFileSync('locked/out.txt', '1'); fs.writeFileSync('seen.txt', '2')", cwd: '' }, { requestApproval: async () => 'ALLOW_ONCE' })
    assert.equal(done.filesComplete, false); assert.ok(done.files.includes(path.join(work, 'seen.txt')))
  } finally { fsp.readdir = original }
})

test('M3-003/M3-004: with a ready pack the unchanged script runs through the fixed bootstrap under a lease', async () => {
  const root = temp(), work = path.join(root, 'work'), site = path.join(root, 'pack', 'site-packages')
  fs.mkdirSync(work); fs.mkdirSync(site, { recursive: true })
  const events = []
  const pack = { describe: () => ({ state: 'ready' }), async acquire() {
    events.push('acquire')
    return { sitePackages: site, bind: id => events.push('bind:' + id), release: () => events.push('release') }
  } }
  const host = fakeHost()
  const tools = createPythonTools({ getPython: async () => 'fake-python', host, stateRoot: path.join(root, 'state'), logs: createExecLogs({ directory: path.join(root, 'logs') }), pack, kitPath: 'C:\\kit',
    checkFolder: async () => ({ absolute: work, exists: true }), createFolder: async target => target })
  const cards = []
  // The fake host runs the script itself (JavaScript here); what matters is what NAJD asked the host to run.
  const done = await tools.run({ code: "console.log('ran')", cwd: '' }, { requestApproval: async (_tool, card) => { cards.push(card); return 'ALLOW_ONCE' } })
  assert.equal(done.status, 'finished')
  assert.equal(cards[0].preview, "console.log('ran')", 'the approval shows only the model code')
  assert.match(cards[0].summary, /Office and design pack: available/)
  const start = host.calls.find(([name]) => name === 'najd.process.start')[1]
  const quoted = [...start.command.matchAll(/'((?:[^']|'')+)'/g)].map(match => match[1])
  assert.equal(path.basename(quoted[1]), 'najd_bootstrap.py'); assert.equal(quoted[2], site); assert.equal(quoted[3], 'C:\\kit'); assert.equal(path.basename(quoted[4]), 'main.py')
  assert.equal(start.env.MPLBACKEND, 'Agg'); assert.ok(start.env.MPLCONFIGDIR.startsWith(path.join(root, 'state')))
  assert.deepEqual(events, ['acquire', 'bind:p' + (host.calls.findIndex(([name]) => name === 'najd.process.start') + 1), 'release'])
  // Without a pack the script runs directly, as before.
  const plainHost = fakeHost()
  const plain = createPythonTools({ getPython: async () => 'fake-python', host: plainHost, stateRoot: path.join(root, 'state2'), logs: createExecLogs({ directory: path.join(root, 'logs2') }),
    pack: { describe: () => ({ state: 'not-installed' }), acquire: async () => null }, checkFolder: async () => ({ absolute: work, exists: true }), createFolder: async target => target })
  const direct = await plain.run({ code: "console.log('plain')", cwd: '' }, { requestApproval: async (_tool, card) => { assert.doesNotMatch(card.summary, /pack/); return 'ALLOW_ONCE' } })
  assert.match(direct.output, /plain/)
  assert.match(plainHost.calls.find(([name]) => name === 'najd.process.start')[1].command, /^& 'fake-python' -I -B -X utf8 '[^']+main.py'$/)
})

test('M3-003: a run whose family is not seen closed keeps its lease; a refused start gives it back', async () => {
  const root = temp(), work = path.join(root, 'work'); fs.mkdirSync(work)
  const events = []
  const pack = { describe: () => ({ state: 'ready' }), acquire: async () => ({ sitePackages: root, bind: id => events.push('bind:' + id), release: () => events.push('release') }) }
  const host = fakeHost(), real = host.invokeHost
  host.invokeHost = async (name, args, ...rest) => { if (name === 'najd.process.stop') { await real(name, args, ...rest); return { id: args.id, stopped: true, familyClosed: false } } return real(name, args, ...rest) }
  const tools = createPythonTools({ getPython: async () => 'fake-python', host, stateRoot: path.join(root, 'state'), logs: createExecLogs({ directory: path.join(root, 'logs') }), pack, timeoutMs: 1500,
    checkFolder: async () => ({ absolute: work, exists: true }), createFolder: async target => target, adopt: async () => 'start-1' })
  await assert.rejects(tools.run({ code: 'setInterval(() => {}, 1000)', cwd: '' }, { requestApproval: async () => 'ALLOW_ONCE' }), { code: 'TIMEOUT' })
  assert.equal(events.filter(event => event === 'release').length, 0, 'the adopted family keeps the lease')
  assert.equal(events.filter(event => event.startsWith('bind:')).length, 1)
  const refusing = createPythonTools({ getPython: async () => 'fake-python', stateRoot: path.join(root, 'state2'), logs: createExecLogs({ directory: path.join(root, 'logs2') }), pack,
    host: { invokeHost: async () => { throw Object.assign(new Error('PROCESS_LIMIT'), { code: 'PROCESS_LIMIT', toolError: true, dispatched: true }) } },
    checkFolder: async () => ({ absolute: work, exists: true }), createFolder: async target => target })
  events.length = 0
  await assert.rejects(refusing.run({ code: 'x', cwd: '' }, { requestApproval: async () => 'ALLOW_ONCE' }), { code: 'PROCESS_LIMIT' })
  assert.deepEqual(events, ['release'])
})
