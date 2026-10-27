// Background commands (M2c) with a fake host: approval rules, provenance, ownership, stop, restart outcomes and the
// fixes from the M2 review. tests/process-host-smoke.cjs covers the real NAJD desktop host.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { createProcessTools } = require('../electron/process-tools.cjs')
const { createProcessLifecycle } = require('../electron/process-lifecycle.cjs')
const { createExecLogs } = require('../electron/exec-logs.cjs')
const { createActionJournal } = require('../electron/action-journal.cjs')
const { classifyCommand } = require('../electron/workspace-tools.cjs')

const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'najd-process-'))
const toolError = code => Object.assign(new Error(code), { code, toolError: true, dispatched: true })
function fakeHost({ lose = false } = {}) {
  const jobs = new Map(), calls = []
  return { calls, jobs, isRunning: () => true, async invokeHost(name, args, _timeout, options = {}) {
    calls.push([name, args])
    if (options.signal?.aborted) throw Object.assign(new Error('CANCELLED'), { code: 'CANCELLED', dispatched: false })
    if (name === 'najd.process.start') {
      if (lose) throw Object.assign(new Error('WINDOWS_NODE_FAILED'), { code: 'WINDOWS_NODE_FAILED', dispatched: true })
      if ([...jobs.values()].filter(item => item.running).length >= 4) throw toolError('PROCESS_LIMIT')
      const id = 'h' + calls.length
      fs.appendFileSync(args.log, 'hello from ' + args.command + '\n')
      jobs.set(id, { running: true, exitCode: null, env: args.env })
      return { id, pid: 1000 + calls.length, created: '133000000000000000', contained: true }
    }
    if (name === 'najd.process.list') return [...jobs].map(([id, item]) => ({ id, running: item.running, exitCode: item.exitCode }))
    if (name === 'najd.process.stop') { if (!jobs.has(args.id)) throw toolError('NOT_FOUND'); jobs.delete(args.id); return { id: args.id, stopped: true, familyClosed: true } }
  } }
}
function setup({ sessionId, host = fakeHost(), env = { PATH: 'C:/bin', NAJD_TEST: '1' } } = {}) {
  const root = temp(), work = path.join(root, 'work')
  fs.mkdirSync(work)
  const lifecycle = createProcessLifecycle({ filePath: path.join(root, 'lifecycle.json'), ...(sessionId ? { sessionId } : {}) })
  const journal = createActionJournal({ filePath: path.join(root, 'actions.json') })
  const tools = createProcessTools({ host, lifecycle, logs: createExecLogs({ directory: path.join(root, 'logs') }), journal, classifyCommand, workspace: work,
    checkFolder: async raw => { const absolute = raw ? path.join(root, raw) : work; return { absolute, exists: fs.existsSync(absolute) } },
    createFolder: async target => { fs.mkdirSync(target, { recursive: true }); return target }, executionEnv: () => env })
  return { root, work, host, lifecycle, journal, tools }
}

test('changing commands need approval and are journaled; read-only commands start directly with direct provenance', async () => {
  const { tools, lifecycle, host } = setup()
  const cards = []
  const denied = await tools.start({ command: 'npm run dev', cwd: '' }, { requestApproval: async (_tool, card) => { cards.push(card); return 'DENY' }, conversationId: 'conv-a' })
  assert.equal(denied.status, 'denied_by_user'); assert.equal(host.calls.length, 0); assert.equal(cards[0].command, 'npm run dev')
  const approved = await tools.start({ command: 'npm run dev', cwd: '' }, { requestApproval: async () => 'ALLOW_ONCE', conversationId: 'conv-a' })
  assert.equal(approved.status, 'started')
  assert.deepEqual(host.calls.at(-1)[1].env, { PATH: 'C:/bin', NAJD_TEST: '1' }) // the user's environment, secrets removed upstream (M2-R16)
  const direct = await tools.start({ command: 'Get-Date', cwd: '' }, { requestApproval: async () => assert.fail('read-only start must not ask'), conversationId: 'conv-a' })
  const records = await lifecycle.list({ sessionOnly: true })
  assert.equal(records.find(item => item.startId === approved.id).provenance.kind, 'approved')
  assert.deepEqual(records.find(item => item.startId === direct.id).provenance, { kind: 'direct', classification: 'read' })
  const output = await tools.output({ id: approved.id, tail: 0 }, { conversationId: 'conv-a' })
  assert.match(output.output, /hello from npm run dev/)
})

test('M2-R02: no folder is created before approval; a direct start never creates one', async () => {
  const { tools, root } = setup()
  await tools.start({ command: 'npm run dev', cwd: 'new-folder' }, { requestApproval: async () => 'DENY', conversationId: 'conv-f' })
  assert.equal(fs.existsSync(path.join(root, 'new-folder')), false)
  await assert.rejects(tools.start({ command: 'Get-Date', cwd: 'other-folder' }, { conversationId: 'conv-f' }), { code: 'NOT_FOUND' })
  assert.equal(fs.existsSync(path.join(root, 'other-folder')), false)
  await tools.start({ command: 'npm run dev', cwd: 'new-folder' }, { requestApproval: async () => 'ALLOW_ONCE', conversationId: 'conv-f' })
  assert.equal(fs.existsSync(path.join(root, 'new-folder')), true)
})

test('ids work only for the same conversation; stop ends the process; the list includes earlier sessions (M2-R14)', async () => {
  const { tools, lifecycle, root } = setup()
  const started = await tools.start({ command: 'npm run dev', cwd: '' }, { requestApproval: async () => 'ALLOW_ONCE', conversationId: 'conv-b' })
  await assert.rejects(tools.output({ id: started.id, tail: 0 }, { conversationId: 'conv-other' }), { code: 'NOT_FOUND' })
  await assert.rejects(tools.stop({ id: started.id }, { conversationId: 'conv-other' }), { code: 'NOT_FOUND' })
  assert.equal((await tools.stop({ id: started.id }, { conversationId: 'conv-b' })).status, 'stopped')
  assert.equal((await lifecycle.get(started.id)).state, 'stopped')
  // A later session sees how it ended but cannot read or stop it.
  const later = createProcessTools({ host: fakeHost(), lifecycle: createProcessLifecycle({ filePath: path.join(root, 'lifecycle.json'), sessionId: 'session-later' }),
    logs: createExecLogs({ directory: path.join(root, 'logs2') }), classifyCommand, workspace: root, checkFolder: async () => ({ absolute: root, exists: true }), createFolder: async () => root })
  const listed = await later.list({}, { conversationId: 'conv-b' })
  assert.equal(listed.processes[0].previousSession, true); assert.equal(listed.processes[0].state, 'stopped')
  await assert.rejects(later.output({ id: started.id, tail: 0 }, { conversationId: 'conv-b' }), { code: 'NOT_FOUND' })
})

test('the host limit is a known refusal; a lost answer after sending is an unknown effect (M2-R11); cancellation while queued sends nothing (M2-R04)', async () => {
  const { tools, lifecycle } = setup()
  for (let i = 0; i < 4; i++) await tools.start({ command: 'Get-Date', cwd: '' }, { conversationId: 'conv-c' })
  await assert.rejects(tools.start({ command: 'Get-Date', cwd: '' }, { conversationId: 'conv-c' }), { code: 'PROCESS_LIMIT' })
  assert.equal((await lifecycle.list({ sessionOnly: true })).filter(item => item.state === 'failed').length, 1)
  const lost = setup({ host: fakeHost({ lose: true }) })
  await assert.rejects(lost.tools.start({ command: 'npm run dev', cwd: '' }, { requestApproval: async () => 'ALLOW_ONCE', conversationId: 'conv-d' }),
    error => error.code === 'PROCESS_FAILED' && error.effectUnknown === true && typeof error.startId === 'string' && typeof error.logId === 'string')
  assert.equal((await lost.lifecycle.list({ sessionOnly: true }))[0].state, 'unknown')
  assert.ok((await lost.journal.list()).some(item => /UNKNOWN/i.test(item.state)))
  const controller = new AbortController()
  const queued = setup()
  await assert.rejects(queued.tools.start({ command: 'npm run dev', cwd: '' }, { signal: controller.signal, requestApproval: async () => { controller.abort(); return 'ALLOW_ONCE' }, conversationId: 'conv-e' }), { code: 'CANCELLED' })
  assert.equal(queued.host.calls.length, 0)
})

test('after a restart, contained live records end with their session; uncertain ones are unknown; invalid files are kept aside (M2-R12/R13)', async () => {
  const root = temp(), filePath = path.join(root, 'lifecycle.json')
  const before = createProcessLifecycle({ filePath, sessionId: 'session-1' })
  const contained = await before.reserve({ provenance: { kind: 'direct', classification: 'read' }, command: 'Get-Date', logId: 'log-a' })
  await before.confirm(contained.startId, { hostId: 'h1', pid: 1, created: '1', contained: true })
  const starting = await before.reserve({ provenance: { kind: 'approved', actionId: 'act-1' }, command: 'x', logId: 'log-b' })
  await assert.rejects(before.reserve({ provenance: { kind: 'direct', classification: 'change' }, command: 'x' }), { code: 'INVALID_INPUT' })
  const after = createProcessLifecycle({ filePath, sessionId: 'session-2' })
  assert.equal(await after.reconcileStartup(), 2)
  assert.equal((await after.get(contained.startId)).state, 'ended-with-session')
  assert.equal((await after.get(starting.startId)).state, 'unknown')
  fs.writeFileSync(filePath, JSON.stringify({ format: 'najd-process-lifecycle-v1', records: [null] }))
  const recovered = createProcessLifecycle({ filePath, sessionId: 'session-3' })
  assert.equal(await recovered.reconcileStartup(), 0)
  assert.deepEqual(await recovered.list(), [])
  assert.ok(fs.readdirSync(root).some(name => name.startsWith('lifecycle.json.corrupt-')))
})

test('M2-R4-001: a start that ran but could not be recorded is an unknown effect and can still be stopped', async () => {
  const host = fakeHost()
  const realStop = host.invokeHost
  let stopCalls = 0
  host.invokeHost = async (name, args, ...rest) => { if (name === 'najd.process.stop' && stopCalls++ === 0) return { id: args.id, stopped: true, familyClosed: false }; return realStop(name, args, ...rest) }
  const { tools, lifecycle } = setup({ host })
  lifecycle.confirm = async () => { throw Object.assign(new Error('WRITE_FAILED'), { code: 'WRITE_FAILED' }) }
  let failure
  await tools.start({ command: 'npm run dev', cwd: '' }, { requestApproval: async () => 'ALLOW_ONCE', conversationId: 'conv-u' }).catch(error => { failure = error })
  assert.equal(failure.code, 'PROCESS_FAILED'); assert.equal(failure.effectUnknown, true); assert.equal(failure.familyClosed, false)
  assert.equal((await lifecycle.get(failure.startId)).state, 'unknown')
  const stopped = await tools.stop({ id: failure.startId }, { conversationId: 'conv-u' })
  assert.equal(stopped.familyClosed, true); assert.equal(stopped.effectUnknown, true)
  // M2-R8-003: the record leaves the unfinished state and no longer counts as live.
  assert.equal((await lifecycle.get(failure.startId)).state, 'stopped')
  assert.ok(!(await tools.list({}, { conversationId: 'conv-u' })).processes.some(item => item.id === failure.startId && item.state !== 'stopped'))
})

test('M2-R4-002: a stop the host cannot confirm stays running and can be repeated', async () => {
  const host = fakeHost()
  const realStop = host.invokeHost
  let stubborn = true
  host.invokeHost = async (name, args, ...rest) => name === 'najd.process.stop' && stubborn ? { id: args.id, stopped: true, familyClosed: false } : realStop(name, args, ...rest)
  const { tools, lifecycle } = setup({ host })
  const started = await tools.start({ command: 'npm run dev', cwd: '' }, { requestApproval: async () => 'ALLOW_ONCE', conversationId: 'conv-s' })
  const first = await tools.stop({ id: started.id }, { conversationId: 'conv-s' })
  assert.equal(first.status, 'stopping'); assert.equal((await lifecycle.get(started.id)).state, 'running')
  stubborn = false
  const second = await tools.stop({ id: started.id }, { conversationId: 'conv-s' })
  assert.equal(second.status, 'stopped'); assert.equal((await lifecycle.get(started.id)).state, 'stopped')
})

test('M2-R5-002: an adopted Python family is listed, readable and stoppable in its conversation', async () => {
  const { tools, host } = setup()
  const started = await host.invokeHost('najd.process.start', { command: 'python', cwd: os.tmpdir(), log: path.join(os.tmpdir(), 'najd-adopt-' + Date.now() + '.log') })
  const id = await tools.adopt({ hostId: started.id, pid: started.pid, created: started.created, logId: null, conversationId: 'conv-py', actionId: 'act-1' })
  const listed = await tools.list({}, { conversationId: 'conv-py' })
  assert.ok(listed.processes.some(item => item.id === id && item.state === 'running'))
  assert.equal((await tools.stop({ id }, { conversationId: 'conv-py' })).status, 'stopped')
  await assert.rejects(tools.adopt({ hostId: 'x' }), { code: 'INVALID_INPUT' })
})

test('M2-R6-001: adoption still leaves an addressable family when saving its record fails', async () => {
  for (const failing of ['reserve', 'confirm']) {
    const { tools, host, lifecycle } = setup()
    lifecycle[failing] = async () => { throw Object.assign(new Error('WRITE_FAILED'), { code: 'WRITE_FAILED' }) }
    const started = await host.invokeHost('najd.process.start', { command: 'python', cwd: os.tmpdir(), log: path.join(os.tmpdir(), 'najd-adopt-' + failing + Date.now() + '.log') })
    const id = await tools.adopt({ hostId: started.id, pid: started.pid, created: started.created, logId: null, conversationId: 'conv-a' + failing, actionId: 'act-1' })
    assert.equal(typeof id, 'string', failing)
    if (failing === 'reserve') assert.ok((await tools.list({}, { conversationId: 'conv-a' + failing })).processes.some(item => item.id === id))
    await assert.rejects(tools.stop({ id }, { conversationId: 'someone-else' }), { code: 'NOT_FOUND' })
    const stopped = await tools.stop({ id }, { conversationId: 'conv-a' + failing })
    assert.equal(stopped.familyClosed, true, failing)
    assert.ok(!host.jobs.has(started.id), failing + ': the host job was stopped')
  }
})

test('M2-R7-004: a running command stays listed after many newer finished ones', async () => {
  const { tools, host } = setup()
  const server = await tools.start({ command: 'npm run dev', cwd: '' }, { requestApproval: async () => 'ALLOW_ONCE', conversationId: 'conv-many' })
  for (let i = 0; i < 35; i++) {
    await tools.start({ command: 'Get-Date', cwd: '' }, { conversationId: 'conv-many' })
    host.jobs.get([...host.jobs.keys()].at(-1)).running = false // it finished
  }
  const listed = await tools.list({}, { conversationId: 'conv-many' })
  assert.ok(listed.processes.some(item => item.id === server.id && item.state === 'running'), 'the server is listed')
  assert.ok(listed.processes.length <= 21); assert.equal(listed.olderHistoryOmitted, 15)
})

test('M2-R8-001: an elevated host refuses to start, and that is a known refusal', async () => {
  const host = { isRunning: () => true, invokeHost: async () => { throw Object.assign(new Error('ADMIN_NOT_ALLOWED'), { code: 'ADMIN_NOT_ALLOWED', toolError: true, dispatched: true }) } }
  const { tools, lifecycle, journal } = setup({ host })
  await assert.rejects(tools.start({ command: 'npm run dev', cwd: '' }, { requestApproval: async () => 'ALLOW_ONCE', conversationId: 'conv-admin' }), { code: 'ADMIN_NOT_ALLOWED' })
  assert.equal((await lifecycle.list({ sessionOnly: true }))[0].state, 'failed')
  assert.ok((await journal.list()).every(item => !/UNKNOWN/i.test(item.state)))
})

test('M2-R9-004: a start whose record could not be confirmed but whose family closed at cleanup ends as stopped', async () => {
  const { tools, lifecycle } = setup()
  lifecycle.confirm = async () => { throw Object.assign(new Error('WRITE_FAILED'), { code: 'WRITE_FAILED' }) }
  let failure
  await tools.start({ command: 'npm run dev', cwd: '' }, { requestApproval: async () => 'ALLOW_ONCE', conversationId: 'conv-c' }).catch(error => { failure = error })
  assert.equal(failure.effectUnknown, true); assert.equal(failure.familyClosed, true)
  assert.equal((await lifecycle.get(failure.startId)).state, 'stopped')
})

test('M2-R13-002: deleting a conversation first ends its running commands, and reports any it cannot show closed', async () => {
  const host = fakeHost(), real = host.invokeHost
  let stubborn = false
  host.invokeHost = async (name, args, ...rest) => name === 'najd.process.stop' && stubborn ? { id: args.id, stopped: true, familyClosed: false } : real(name, args, ...rest)
  const { tools, lifecycle } = setup({ host })
  const mine = await tools.start({ command: 'npm run dev', cwd: '' }, { requestApproval: async () => 'ALLOW_ONCE', conversationId: 'conv-del' })
  const other = await tools.start({ command: 'npm run dev', cwd: '' }, { requestApproval: async () => 'ALLOW_ONCE', conversationId: 'conv-keep' })
  assert.deepEqual(await tools.endConversation('conv-del'), { open: 0 })
  assert.equal((await lifecycle.get(mine.id)).state, 'stopped'); assert.equal((await lifecycle.get(other.id)).state, 'running')
  stubborn = true
  assert.deepEqual(await tools.endConversation('conv-keep'), { open: 1 })
  assert.equal((await lifecycle.get(other.id)).state, 'running', 'kept reachable when it could not be shown closed')
})

test('M2-R14-001/002: an unfinished start blocks deletion; an adopted family that ended does not', async () => {
  const { tools, lifecycle, host } = setup()
  // A start reserved but not yet answered by the host.
  await lifecycle.reserve({ provenance: { kind: 'approved', actionId: 'act-x' }, conversationId: 'conv-starting', command: 'npm run dev' })
  assert.deepEqual(await tools.endConversation('conv-starting'), { open: 1 })
  // An adopted Python family kept in memory (its record could not be saved) that has since exited.
  lifecycle.reserve = async () => { throw Object.assign(new Error('WRITE_FAILED'), { code: 'WRITE_FAILED' }) }
  const started = await host.invokeHost('najd.process.start', { command: 'python', cwd: os.tmpdir(), log: path.join(os.tmpdir(), 'najd-ended-' + Date.now() + '.log') })
  const id = await tools.adopt({ hostId: started.id, pid: started.pid, created: started.created, logId: null, conversationId: 'conv-ended', actionId: 'act-2' })
  host.jobs.get(started.id).running = false
  assert.deepEqual(await tools.endConversation('conv-ended'), { open: 0 })
  assert.equal((await tools.stop({ id }, { conversationId: 'conv-ended' })).familyClosed, true)
})

test('M2-R14-003: a folder grant removed while a command awaits approval means nothing starts', async () => {
  const root = temp(), work = path.join(root, 'granted')
  fs.mkdirSync(work)
  let granted = true
  const host = fakeHost()
  const tools = createProcessTools({ host, lifecycle: createProcessLifecycle({ filePath: path.join(root, 'lifecycle.json') }), logs: createExecLogs({ directory: path.join(root, 'logs') }),
    journal: createActionJournal({ filePath: path.join(root, 'actions.json') }), classifyCommand, workspace: root, createFolder: async target => target,
    checkFolder: async () => { if (!granted) throw Object.assign(new Error('PATH_NOT_ALLOWED'), { code: 'PATH_NOT_ALLOWED' }); return { absolute: work, exists: true } } })
  await assert.rejects(tools.start({ command: 'npm run dev', cwd: 'granted' }, { requestApproval: async () => { granted = false; return 'ALLOW_ONCE' }, conversationId: 'conv-r' }), { code: 'PATH_NOT_ALLOWED' })
  assert.equal(host.calls.length, 0)
})

test('M2-R15-004: a failed journal claim or folder creation after the reservation leaves no start pending', async () => {
  for (const failing of ['claim', 'folder']) {
    const root = temp()
    const journal = createActionJournal({ filePath: path.join(root, 'actions.json') })
    if (failing === 'claim') journal.claim = async () => { throw Object.assign(new Error('WRITE_FAILED'), { code: 'WRITE_FAILED' }) }
    const lifecycle = createProcessLifecycle({ filePath: path.join(root, 'lifecycle.json') })
    const host = fakeHost()
    const tools = createProcessTools({ host, lifecycle, logs: createExecLogs({ directory: path.join(root, 'logs') }), journal, classifyCommand, workspace: root,
      checkFolder: async () => ({ absolute: path.join(root, 'new'), exists: false }),
      createFolder: async () => { if (failing === 'folder') throw Object.assign(new Error('EACCES'), { code: 'EACCES' }) } })
    await assert.rejects(tools.start({ command: 'npm run dev', cwd: 'new' }, { requestApproval: async () => 'ALLOW_ONCE', conversationId: 'conv-prep' }), { code: 'PROCESS_FAILED' })
    assert.equal(host.calls.length, 0, failing)
    assert.equal((await lifecycle.list({ sessionOnly: true }))[0].state, 'failed', failing)
    assert.deepEqual(await tools.endConversation('conv-prep'), { open: 0 }, failing)
  }
})

test('M2-R16-003: a log that cannot be allocated cancels the approved start; nothing is reserved or sent', async () => {
  const root = temp()
  const journal = createActionJournal({ filePath: path.join(root, 'actions.json') })
  const lifecycle = createProcessLifecycle({ filePath: path.join(root, 'lifecycle.json') })
  const logs = createExecLogs({ directory: path.join(root, 'logs') })
  logs.createExternal = () => { throw Object.assign(new Error('EACCES'), { code: 'EACCES' }) }
  const host = fakeHost()
  const tools = createProcessTools({ host, lifecycle, logs, journal, classifyCommand, workspace: root, checkFolder: async () => ({ absolute: root, exists: true }), createFolder: async () => root })
  await assert.rejects(tools.start({ command: 'npm run dev', cwd: '' }, { requestApproval: async () => 'ALLOW_ONCE', conversationId: 'conv-log' }), { code: 'PROCESS_FAILED' })
  assert.equal(host.calls.length, 0); assert.deepEqual(await lifecycle.list(), [])
  assert.ok((await journal.list()).every(item => !/UNKNOWN|EXECUTING|CLAIMED|APPROVED/i.test(item.state)))
})

test('M2-R17-001: while a disconnect is still stopping the host, its commands are not taken as ended', async () => {
  const host = fakeHost(), real = host.invokeHost
  let disconnecting = false
  host.invokeHost = async (name, args, ...rest) => { if (disconnecting) throw Object.assign(new Error('NOT_CONNECTED'), { code: 'NOT_CONNECTED', dispatched: false }); return real(name, args, ...rest) }
  host.isRunning = () => true // the host process is still alive
  const { tools, lifecycle } = setup({ host })
  const started = await tools.start({ command: 'npm run dev', cwd: '' }, { requestApproval: async () => 'ALLOW_ONCE', conversationId: 'conv-disc' })
  disconnecting = true
  assert.deepEqual(await tools.endConversation('conv-disc'), { open: 1 }, 'deletion waits')
  assert.equal((await lifecycle.get(started.id)).state, 'running')
  host.isRunning = () => false // the host has now gone, and its jobs with it
  await tools.list({}, { conversationId: 'conv-disc' })
  assert.equal((await lifecycle.get(started.id)).state, 'exited')
})

test('M2-R18-001: a read-only command with a nested command in parentheses asks for approval before starting', async () => {
  const { tools, host } = setup()
  const cards = []
  const result = await tools.start({ command: 'Get-Date (Stop-Process -Name notepad)', cwd: '' }, { requestApproval: async (tool, card) => { cards.push(card); return 'DENY' }, conversationId: 'conv-nested' })
  assert.equal(result.status, 'denied_by_user'); assert.equal(cards.length, 1); assert.equal(host.calls.length, 0)
})

test('M2-R24-002: an unreachable start of unknown outcome blocks deletion; one whose host was ended does not', async () => {
  const lost = setup({ host: fakeHost({ lose: true }) }) // the answer is lost after sending; the host stays up
  await assert.rejects(lost.tools.start({ command: 'npm run dev', cwd: '' }, { requestApproval: async () => 'ALLOW_ONCE', conversationId: 'conv-lost' }), { code: 'PROCESS_FAILED' })
  assert.deepEqual(await lost.tools.endConversation('conv-lost'), { open: 1 }, 'it may still run, so the conversation stays')
  const ended = { isRunning: () => false, invokeHost: async name => { if (name === 'najd.process.start') throw Object.assign(new Error('WINDOWS_NODE_FAILED'), { code: 'WINDOWS_NODE_FAILED', dispatched: true, hostTerminated: true }); return [] } }
  const closed = setup({ host: ended })
  let failure
  await closed.tools.start({ command: 'npm run dev', cwd: '' }, { requestApproval: async () => 'ALLOW_ONCE', conversationId: 'conv-ended-host' }).catch(error => { failure = error })
  assert.equal(failure.effectUnknown, true); assert.equal(failure.familyClosed, true)
  assert.equal((await closed.lifecycle.get(failure.startId)).state, 'stopped')
  assert.deepEqual(await closed.tools.endConversation('conv-ended-host'), { open: 0 })
})

test('M2-R25-002: an unknown start is settled once the host process that received it has ended', async () => {
  let alive = true
  const host = { isRunning: () => alive, currentInstance: () => alive ? 7 : null, instanceEnded: instance => instance === 7 && !alive,
    invokeHost: async (name, _args, _timeout, options = {}) => { options.onDispatch?.(7); if (name === 'najd.process.start') throw Object.assign(new Error('STARTED_THEN_FAILED'), { code: 'STARTED_THEN_FAILED', toolError: true, dispatched: true }); return [] } }
  const { tools, lifecycle } = setup({ host })
  let failure
  await tools.start({ command: 'npm run dev', cwd: '' }, { requestApproval: async () => 'ALLOW_ONCE', conversationId: 'conv-unk' }).catch(error => { failure = error })
  assert.equal((await lifecycle.get(failure.startId)).state, 'unknown')
  assert.deepEqual(await tools.endConversation('conv-unk'), { open: 1 }, 'its host is still running, so it may be too')
  alive = false // the companion was disconnected and its host process has ended
  assert.deepEqual(await tools.endConversation('conv-unk'), { open: 0 })
  assert.equal((await lifecycle.get(failure.startId)).state, 'stopped')
})

test('M2-R26-001/002: starts NAJD cannot reach are tied to the host process that received them, and settle when it ends', async () => {
  // The host process closes while the outcome is being recorded; and an untracked family whose stop cannot be confirmed.
  for (const scenario of ['unknown', 'untracked']) {
    let alive = true
    const host = { isRunning: () => alive, currentInstance: () => alive ? 3 : null, instanceEnded: instance => instance === 3 && !alive,
      invokeHost: async (name, args, _timeout, options = {}) => {
        if (!alive) throw Object.assign(new Error('NOT_CONNECTED'), { code: 'NOT_CONNECTED', dispatched: false })
        if (name === 'najd.process.start') {
          options.onDispatch?.(3)
          if (scenario === 'unknown') { alive = false; throw Object.assign(new Error('STARTED_THEN_FAILED'), { code: 'STARTED_THEN_FAILED', toolError: true, dispatched: true }) }
          return { id: 'job-1', pid: 1, created: '1', contained: true }
        }
        if (name === 'najd.process.stop') return { id: args.id, stopped: true, familyClosed: false }
        return []
      } }
    const { tools, lifecycle } = setup({ host })
    if (scenario === 'untracked') lifecycle.confirm = async () => { throw Object.assign(new Error('WRITE_FAILED'), { code: 'WRITE_FAILED' }) }
    let failure
    await tools.start({ command: 'npm run dev', cwd: '' }, { requestApproval: async () => 'ALLOW_ONCE', conversationId: 'conv-' + scenario }).catch(error => { failure = error })
    assert.equal(failure.effectUnknown, true, scenario)
    alive = false // the companion was disconnected and that host process has ended
    assert.deepEqual(await tools.endConversation('conv-' + scenario), { open: 0 }, scenario)
    assert.equal((await lifecycle.get(failure.startId)).state, 'stopped', scenario)
  }
})

test('M2-R31-002: an unreadable lifecycle file is not replaced; once readable, the startup reconcile runs first', async () => {
  const root = temp(), filePath = path.join(root, 'lifecycle.json')
  const before = createProcessLifecycle({ filePath, sessionId: 'session-1' })
  const live = await before.reserve({ provenance: { kind: 'direct', classification: 'read' }, command: 'Get-Date', logId: 'log-a' })
  await before.confirm(live.startId, { hostId: 'h1', pid: 1, created: '1', contained: true })
  const saved = fs.readFileSync(filePath, 'utf8')
  // A read failure other than "missing" (a folder in its place stands in for a busy or refused file).
  fs.rmSync(filePath); fs.mkdirSync(filePath)
  const after = createProcessLifecycle({ filePath, sessionId: 'session-2' })
  await assert.rejects(after.reconcileStartup(), { code: 'LIFECYCLE_UNAVAILABLE' })
  await assert.rejects(after.reserve({ provenance: { kind: 'direct', classification: 'read' }, command: 'Get-Date', logId: 'log-b' }), { code: 'LIFECYCLE_UNAVAILABLE' })
  await assert.rejects(after.list(), { code: 'LIFECYCLE_UNAVAILABLE' })
  assert.equal(fs.statSync(filePath).isDirectory(), true, 'nothing replaced the unreadable file')
  fs.rmdirSync(filePath); fs.writeFileSync(filePath, saved)
  await after.reserve({ provenance: { kind: 'direct', classification: 'read' }, command: 'Get-Date', logId: 'log-c' })
  assert.equal((await after.get(live.startId)).state, 'ended-with-session', 'the earlier record is kept and reconciled')
  assert.equal((await after.list()).length, 2)
})

test('C53-02: the lifecycle reports a log as ended only when its record reaches a final state', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'najd-lifecycle-'))
  const ended = []
  const lifecycle = createProcessLifecycle({ filePath: path.join(root, 'lifecycle.json'), onEnded: logId => ended.push(logId) })
  const one = await lifecycle.reserve({ provenance: { kind: 'direct', classification: 'read' }, command: 'a', logId: 'log-aaaaaaaaaaaaaaaaaa' })
  const two = await lifecycle.reserve({ provenance: { kind: 'direct', classification: 'read' }, command: 'b', logId: 'log-bbbbbbbbbbbbbbbbbb' })
  await lifecycle.confirm(one.startId, { hostId: 'h1', pid: 1, created: 'x', contained: true })
  await lifecycle.unknown(two.startId)
  assert.deepEqual(ended, [], 'running and unknown may still write their logs')
  await lifecycle.exited(one.startId, 0); await lifecycle.stopped(two.startId)
  assert.deepEqual(ended, ['log-aaaaaaaaaaaaaaaaaa', 'log-bbbbbbbbbbbbbbbbbb'])
})
