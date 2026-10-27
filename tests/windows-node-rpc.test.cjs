// The RPC boundary to the NAJD desktop host, with a fixture host speaking the real line protocol (Node stands in for
// dotnet.exe; the "host dll" is a script). An elevated host's ADMIN_NOT_ALLOWED reaches the process and Python
// adapters as a known refusal and the host keeps running (M2-R9-001).
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { createWindowsNode } = require('../electron/windows-node.cjs')
const { createProcessTools } = require('../electron/process-tools.cjs')
const { createProcessLifecycle } = require('../electron/process-lifecycle.cjs')
const { createExecLogs } = require('../electron/exec-logs.cjs')
const { createActionJournal } = require('../electron/action-journal.cjs')
const { classifyCommand } = require('../electron/workspace-tools.cjs')

const HOST = `
const tools = ['najd.desktop.act', 'najd.desktop.open', 'najd.desktop.read', 'najd.desktop.windows', 'najd.process.list', 'najd.process.start', 'najd.process.stop', 'najd.screen.capture', 'najd.windows.demo', 'system.which']
let buffer = '', configured = false, waiting = null
process.stdin.setEncoding('utf8')
process.stdin.on('data', chunk => {
  buffer += chunk
  let index
  while ((index = buffer.indexOf('\\n')) !== -1) {
    const line = buffer.slice(0, index); buffer = buffer.slice(index + 1)
    if (!configured) { configured = true; process.stdout.write(JSON.stringify({ state: 'ready', transport: 'stdio' }) + '\\n'); continue }
    if (line === 'cancel') { if (waiting) { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: waiting, result: { isError: true, content: [{ type: 'text', text: 'CANCELLED' }] } }) + '\\n'); waiting = null } continue }
    const message = JSON.parse(line)
    if (!('id' in message)) continue
    const reply = result => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }) + '\\n')
    if (message.method === 'initialize') reply({ protocolVersion: '2024-11-05', capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'fixture', version: '1' } })
    else if (message.method === 'tools/list') reply({ tools: tools.map(name => ({ name })) })
    else if (message.params.name === 'najd.process.list') reply({ content: [{ type: 'text', text: '[]' }] })
    else if (message.params.name === 'najd.desktop.act') waiting = message.id
    else if (message.params.arguments && message.params.arguments.command === 'malformed') reply({ content: [{ type: 'text', text: 'not json' }] })
    else reply({ isError: true, content: [{ type: 'text', text: 'ADMIN_NOT_ALLOWED' }] })
  }
})
`

test('M2-R9-001: an elevated host refusal crosses the real RPC boundary as a known refusal', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'najd-rpc-'))
  const runtimeRoot = path.join(root, 'runtime')
  fs.mkdirSync(path.join(runtimeRoot, 'dotnet-sdk-10.0.400'), { recursive: true }); fs.mkdirSync(path.join(runtimeRoot, 'windows-node-host'))
  fs.copyFileSync(process.execPath, path.join(runtimeRoot, 'dotnet-sdk-10.0.400', 'dotnet.exe'))
  fs.writeFileSync(path.join(runtimeRoot, 'windows-node-host', 'Najd.WindowsNode.dll'), HOST)
  const node = createWindowsNode({ runtimeRoot, stateRoot: path.join(root, 'state') })
  try {
    await assert.rejects(node.invokeHost('najd.process.start', { command: 'x', cwd: root, log: path.join(root, 'a.log') }),
      error => error.code === 'ADMIN_NOT_ALLOWED' && error.toolError === true && error.dispatched === true)
    assert.equal(node.isRunning(), true, 'the host keeps running')
    const lifecycle = createProcessLifecycle({ filePath: path.join(root, 'lifecycle.json') })
    const journal = createActionJournal({ filePath: path.join(root, 'actions.json') })
    const tools = createProcessTools({ host: node, lifecycle, logs: createExecLogs({ directory: path.join(root, 'logs') }), journal, classifyCommand, workspace: root,
      checkFolder: async () => ({ absolute: root, exists: true }), createFolder: async () => root })
    await assert.rejects(tools.start({ command: 'npm run dev', cwd: '' }, { requestApproval: async () => 'ALLOW_ONCE', conversationId: 'c' }), { code: 'ADMIN_NOT_ALLOWED' })
    assert.equal((await lifecycle.list({ sessionOnly: true }))[0].state, 'failed')
    assert.ok((await journal.list()).every(item => !/UNKNOWN/i.test(item.state)))
  } finally { await node.stop() }
})

test('M2-R11-002: cancelling a task while the host works on a desktop action makes the host stop it, and the host keeps serving', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'najd-rpc-cancel-'))
  const runtimeRoot = path.join(root, 'runtime')
  fs.mkdirSync(path.join(runtimeRoot, 'dotnet-sdk-10.0.400'), { recursive: true }); fs.mkdirSync(path.join(runtimeRoot, 'windows-node-host'))
  fs.copyFileSync(process.execPath, path.join(runtimeRoot, 'dotnet-sdk-10.0.400', 'dotnet.exe'))
  fs.writeFileSync(path.join(runtimeRoot, 'windows-node-host', 'Najd.WindowsNode.dll'), HOST)
  const node = createWindowsNode({ runtimeRoot, stateRoot: path.join(root, 'state') })
  try {
    await node.invokeHost('najd.process.list', {}) // the host is running before the action is sent
    const controller = new AbortController()
    const acting = node.invokeHost('najd.desktop.act', { window: '1' }, 20000, { signal: controller.signal })
    setTimeout(() => controller.abort(), 200)
    await assert.rejects(acting, error => error.code === 'CANCELLED' && error.toolError === true && error.dispatched === true)
    assert.equal(node.isRunning(), true, 'the host keeps running')
    assert.deepEqual(await node.invokeHost('najd.process.list', {}), [], 'and keeps serving')
  } finally { await node.stop() }
})

test('M2-R14-003: a request whose folder check fails at dispatch is not sent', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'najd-rpc-check-'))
  const runtimeRoot = path.join(root, 'runtime')
  fs.mkdirSync(path.join(runtimeRoot, 'dotnet-sdk-10.0.400'), { recursive: true }); fs.mkdirSync(path.join(runtimeRoot, 'windows-node-host'))
  fs.copyFileSync(process.execPath, path.join(runtimeRoot, 'dotnet-sdk-10.0.400', 'dotnet.exe'))
  fs.writeFileSync(path.join(runtimeRoot, 'windows-node-host', 'Najd.WindowsNode.dll'), HOST)
  const node = createWindowsNode({ runtimeRoot, stateRoot: path.join(root, 'state') })
  try {
    await assert.rejects(node.invokeHost('najd.process.start', { command: 'x', cwd: root, log: path.join(root, 'a.log') }, 20000, { check: async () => 'PATH_NOT_ALLOWED' }),
      error => error.code === 'PATH_NOT_ALLOWED' && error.dispatched === false)
    // With a passing check the request is sent (this fixture host answers it with a refusal).
    await assert.rejects(node.invokeHost('najd.process.start', { command: 'x', cwd: root, log: path.join(root, 'a.log') }, 20000, { check: async () => null }),
      error => error.code === 'ADMIN_NOT_ALLOWED' && error.dispatched === true)
  } finally { await node.stop() }
})

test('M2-R16-001: a task cancelled while the dispatch check runs sends nothing, even if the check then passes', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'najd-rpc-held-'))
  const runtimeRoot = path.join(root, 'runtime')
  fs.mkdirSync(path.join(runtimeRoot, 'dotnet-sdk-10.0.400'), { recursive: true }); fs.mkdirSync(path.join(runtimeRoot, 'windows-node-host'))
  fs.copyFileSync(process.execPath, path.join(runtimeRoot, 'dotnet-sdk-10.0.400', 'dotnet.exe'))
  fs.writeFileSync(path.join(runtimeRoot, 'windows-node-host', 'Najd.WindowsNode.dll'), HOST)
  const node = createWindowsNode({ runtimeRoot, stateRoot: path.join(root, 'state') })
  try {
    await node.invokeHost('najd.process.list', {})
    const controller = new AbortController()
    let release
    const held = new Promise(resolve => { release = resolve })
    const request = node.invokeHost('najd.process.start', { command: 'x', cwd: root, log: path.join(root, 'a.log') }, 20000,
      { signal: controller.signal, check: async () => { await held; return null } })
    await new Promise(resolve => setTimeout(resolve, 50))
    controller.abort(); release()
    await assert.rejects(request, error => error.code === 'CANCELLED' && error.dispatched === false)
    assert.deepEqual(await node.invokeHost('najd.process.list', {}), [], 'the host still serves')
  } finally { await node.stop() }
})

test('M2-R24-002: an answer that cannot be understood after a start ends the host, so nothing it started keeps running untracked', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'najd-rpc-malformed-'))
  const runtimeRoot = path.join(root, 'runtime')
  fs.mkdirSync(path.join(runtimeRoot, 'dotnet-sdk-10.0.400'), { recursive: true }); fs.mkdirSync(path.join(runtimeRoot, 'windows-node-host'))
  fs.copyFileSync(process.execPath, path.join(runtimeRoot, 'dotnet-sdk-10.0.400', 'dotnet.exe'))
  fs.writeFileSync(path.join(runtimeRoot, 'windows-node-host', 'Najd.WindowsNode.dll'), HOST)
  const node = createWindowsNode({ runtimeRoot, stateRoot: path.join(root, 'state') })
  try {
    await assert.rejects(node.invokeHost('najd.process.start', { command: 'malformed', cwd: root, log: path.join(root, 'a.log') }),
      error => error.code === 'WINDOWS_NODE_FAILED' && error.dispatched === true && error.hostTerminated === true)
    assert.equal(node.isRunning(), false, 'the host was ended')
  } finally { await node.stop() }
})

test('M2-R25-002: each host process has its own number, and an ended one stays ended after a replacement starts', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'najd-rpc-instance-'))
  const runtimeRoot = path.join(root, 'runtime')
  fs.mkdirSync(path.join(runtimeRoot, 'dotnet-sdk-10.0.400'), { recursive: true }); fs.mkdirSync(path.join(runtimeRoot, 'windows-node-host'))
  fs.copyFileSync(process.execPath, path.join(runtimeRoot, 'dotnet-sdk-10.0.400', 'dotnet.exe'))
  fs.writeFileSync(path.join(runtimeRoot, 'windows-node-host', 'Najd.WindowsNode.dll'), HOST)
  const node = createWindowsNode({ runtimeRoot, stateRoot: path.join(root, 'state') })
  try {
    await node.invokeHost('najd.process.list', {})
    const first = node.currentInstance()
    assert.equal(node.instanceEnded(first), false)
    await node.stop()
    assert.equal(node.instanceEnded(first), true)
    await node.invokeHost('najd.process.list', {})
    const second = node.currentInstance()
    assert.notEqual(second, first); assert.equal(node.instanceEnded(first), true); assert.equal(node.instanceEnded(second), false)
  } finally { await node.stop() }
})
