// Execution routing (owner live tests 2026-10-31): servers never go through the 60-second terminal, an observation that
// already failed is not repeated until something changes, a named file loads the write tools first, and every loadable
// toolset is listed with its purpose.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createAgentRuntime } = require('../electron/agent-runtime.cjs')
const { extraToolsets, describeToolsets, LOADABLE, TOOLSET_PURPOSE } = require('../electron/agent-toolsets.cjs')

const base = { catalog: { search: async () => [], details: async () => ({}), summary: async () => '' }, library: { list: async () => [] } }
async function drive(runtime, calls, text = 'Build a counter page in counter.html') {
  const outputs = [], requests = [], queue = calls.map(([name, args], index) => ({ kind: 'agent-tools', calls: [{ name, arguments: JSON.stringify(args), call_id: 'c' + index }], items: [] }))
  await runtime.run({ request: { text, conversationId: 'routing' }, requestApproval: async () => 'ALLOW_ONCE',
    respond: async request => {
      requests.push(request)
      const last = request.input.at(-1)
      if (last?.type === 'function_call_output') outputs.push(JSON.parse(last.output))
      return queue.shift() || { kind: 'message', text: 'done' }
    } })
  return { outputs, requests }
}

test('a server command is refused before running and the process tools are loaded instead', async () => {
  const ran = []
  const workspace = { describe: () => ({ workspace: 'C:/w', grantedFolders: [] }), run: async (operation, args) => { ran.push([operation, args.command]); return { exitCode: 0, output: 'ok' } } }
  const processes = { available: async () => true, list: async () => ({ processes: [] }) }
  const runtime = createAgentRuntime({ ...base, workspace, processes, logs: { list: async () => [], read: async () => ({}) } })
  const servers = ['python -m http.server 5500', 'npx serve .', 'npm run dev', 'npx vite --port 5173', '$l = New-Object System.Net.HttpListener; $l.Start()']
  const { outputs, requests } = await drive(runtime, [['najd_tools_load', { toolset: 'terminal', unload: '' }], ...servers.map(command => ['najd_terminal_run', { command, cwd: '' }]),
    ['najd_terminal_run', { command: 'npx vite build', cwd: '' }], ['najd_terminal_run', { command: 'Get-ChildItem', cwd: '' }]])
  for (const output of outputs.slice(1, 1 + servers.length)) { assert.equal(output.error, 'USE_PROCESS_TOOL'); assert.match(output.note, /najd_web_preview/) }
  assert.deepEqual(ran, [['terminal.run', 'npx vite build'], ['terminal.run', 'Get-ChildItem']], 'only the finite commands ran')
  assert.ok(requests.at(-1).tools.some(tool => tool.name === 'najd_process_start'), 'process tools are offered after the refusal')
})

test('an observation that failed is answered from that failure until a change happens', async () => {
  let reads = 0
  const workspace = { describe: () => ({ workspace: 'C:/w', grantedFolders: [] }), run: async (operation, args) => {
    if (operation === 'files.read') { reads++; if (!written) throw Object.assign(new Error('NOT_FOUND'), { code: 'NOT_FOUND' }); return { path: args.path, text: '1. one' } }
    if (operation === 'files.write') { written = true; return { status: 'written', path: 'C:/w/' + args.path } }
    return {}
  } }
  let written = false
  const runtime = createAgentRuntime({ ...base, workspace })
  const read = ['najd_files_read', { path: 'najd-test/test.txt', offset: 0, limit: 0 }]
  const { outputs } = await drive(runtime, [read, read, ['najd_files_write', { path: 'najd-test/test.txt', content: '1. one' }], read], 'Create najd-test/test.txt with numbered lines')
  assert.equal(outputs[0].error, 'NOT_FOUND')
  assert.equal(outputs[1].error, 'REPEATED_FAILURE'); assert.equal(outputs[1].previous, 'NOT_FOUND')
  assert.equal(outputs[2].status, 'written')
  assert.equal(outputs[3].text, '1. one', 'after a change the same read runs again')
  assert.equal(reads, 2)
})

test('a request naming a file to create loads the write tools, not move and delete', () => {
  for (const text of ['أنشئ najd-test/test.txt فيه خمسة أسطر مرقمة', 'Create najd-test/test.txt with five numbered lines', 'اكتب ملاحظاتي في notes.md', 'استخدم المهارة لإنشاء najd-test/again.txt']) {
    const sets = extraToolsets(text)
    assert.ok(sets.includes('files'), text); assert.ok(!sets.includes('files-manage'), text)
  }
  assert.deepEqual(extraToolsets('rename the report file'), ['files-manage'])
})

test('every loadable toolset has a purpose, and the instructions list it', async () => {
  for (const name of LOADABLE) assert.equal(typeof TOOLSET_PURPOSE[name], 'string', name)
  assert.match(describeToolsets(['files-manage', 'files']), /files-manage \(move, rename, delete files only\), files \(create, write, edit, read files\)/)
  const runtime = createAgentRuntime({ ...base, workspace: { describe: () => ({ workspace: 'C:/w', grantedFolders: [] }), run: async () => ({}) } })
  const { requests } = await drive(runtime, [], 'hello')
  assert.match(requests[0].instructions, /files-manage \(move, rename, delete files only\)/)
})

test('the same call five times in a row is stopped before it runs; a different call resets the count', async () => {
  let runs = 0
  const workspace = { describe: () => ({ workspace: 'C:/w', grantedFolders: [] }), run: async () => { runs++; return { status: 'written', path: 'C:/w/a.txt' } } }
  const runtime = createAgentRuntime({ ...base, workspace })
  const write = ['najd_files_write', { path: 'a.txt', content: 'x' }]
  const { outputs } = await drive(runtime, [write, write, write, write, write, ['najd_files_write', { path: 'b.txt', content: 'x' }], write], 'Create a.txt')
  assert.deepEqual(outputs.map(output => output.error || output.status), ['written', 'written', 'written', 'written', 'LOOP_DETECTED', 'written', 'written'])
  assert.equal(runs, 6, 'the stopped call never ran')
})

test('a tool call NAJD cannot use is answered with directions and the task goes on (owner live test 2026-10-31)', async () => {
  const runtime = createAgentRuntime({ ...base, workspace: { describe: () => ({ workspace: 'C:/w', grantedFolders: [] }), run: async () => ({ status: 'written', path: 'C:/w/a.txt' }) } })
  const raw = (name, argumentsText, id) => ({ kind: 'agent-tools', calls: [{ name, arguments: argumentsText, call_id: id }], items: [] })
  const outputs = []
  const queue = [raw('najd_files_read', JSON.stringify({ path: 'x'.repeat(9000), offset: 0, limit: 0 }), 'a'), raw('najd_files_read', '{not json', 'b'), raw('najd_no_such_tool', '{}', 'c'), raw('najd_files_write', JSON.stringify({ path: 'a.txt', content: 'ok' }), 'd')]
  const done = await runtime.run({ request: { text: 'Create a.txt', conversationId: 'args' }, requestApproval: async () => 'ALLOW_ONCE', respond: async ({ input }) => {
    const last = input.at(-1); if (last?.type === 'function_call_output') outputs.push(JSON.parse(last.output))
    return queue.shift() || { kind: 'message', text: 'done' }
  } })
  assert.deepEqual(outputs.map(output => output.error || output.status), ['ARGUMENTS_TOO_LONG', 'INVALID_ARGUMENTS', 'UNKNOWN_TOOL', 'written'])
  assert.equal(done.text, 'done')
})
