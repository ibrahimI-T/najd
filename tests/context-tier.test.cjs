const { test } = require('node:test')
const assert = require('node:assert/strict')
const { tierOf } = require('../electron/context-tier.cjs')
const { neighborsOf, ownerOf, briefSchema, LEAN_START } = require('../electron/tool-graph.cjs')
const { TOOLSETS, profiles } = require('../electron/agent-toolsets.cjs')
const { createAgentRuntime } = require('../electron/agent-runtime.cjs')
const { createPersonalityStore, personalityPrompt } = require('../electron/personality.cjs')
const { DEFAULT_INSTRUCTIONS, LEAN_INSTRUCTIONS } = require('../electron/default-instructions.cjs')

const call = (name, args, id) => ({ kind: 'agent-tools', calls: [{ name, arguments: JSON.stringify(args), call_id: id }], items: [{ type: 'function_call', name, arguments: JSON.stringify(args), call_id: id }] })
const library = { list: async () => [], read: async () => ({ text: '' }), search: async () => [] }
function runtimeWith(extra = {}) {
  const workspace = { describe: () => ({ workspace: 'C:/w', grantedFolders: [] }), run: async () => ({ status: 'ok', text: 'x'.repeat(40000), offset: 0, hasMore: false }) }
  return createAgentRuntime({ catalog: { search: async () => [], details: async id => ({ id, kind: 'tool', ready: true }), summary: async () => '' }, library,
    skills: { read: async () => ({ text: 'guide' }) }, workspace, web: { available: async () => true, search: async () => ({ results: [] }), extract: async () => ({ text: '' }) },
    memory: { remember: async () => ({ status: 'saved' }), forget: async () => ({}) }, python: { available: async () => true }, logs: { read: async () => ({}) }, processes: { available: () => true }, ...extra })
}

test('the tier follows the model window, not the computer; the unknown window gets the full setup', () => {
  assert.equal(tierOf(24000).name, 'tiny'); assert.equal(tierOf(24000).lean, true)
  assert.equal(tierOf(48000).name, 'small'); assert.equal(tierOf(48000).lean, true)
  assert.equal(tierOf(300000).name, 'medium'); assert.equal(tierOf(600000).name, 'large'); assert.equal(tierOf(300000).lean, false)
  assert.equal(tierOf(3000000).name, 'large'); assert.equal(tierOf(0).lean, false); assert.equal(tierOf(undefined).name, 'medium')
  assert.equal(tierOf(600000, 'lean').lean, true, 'the setting can force lean'); assert.equal(tierOf(24000, 'full').lean, false, 'or the full setup')
  const sixteen = tierOf(48000)
  assert.ok(sixteen.outputCapChars >= 5000 && sixteen.outputCapChars <= 6500, 'about 2,000 tokens of a 16k window')
  assert.equal(tierOf(3000000).outputCapChars, Infinity)
})

test('every profile has a lean start that fits its tier and only names real toolsets', () => {
  for (const [profile, names] of Object.entries(LEAN_START)) {
    if (profile !== 'delegated') assert.ok(profiles[profile], profile)
    for (const name of names) assert.ok(TOOLSETS[name], name)
    const count = ['core', 'memory', ...names].reduce((sum, name) => sum + TOOLSETS[name].length, 0)
    assert.ok(count <= 10, `${profile} starts with ${count} tools`)
  }
  assert.deepEqual(neighborsOf('files-read', ['files']), ['toolbox', 'terminal'])
  assert.equal(ownerOf('najd_files_read', TOOLSETS), 'files-read'); assert.equal(ownerOf('najd_files_write', TOOLSETS), 'files')
})

test('a short description keeps the first sentence and the parameter names', () => {
  const brief = briefSchema({ name: 'x', description: 'Do the thing well. Then a long second sentence about many details.', parameters: { type: 'object', properties: { path: { type: 'string', description: 'The file to read, relative to the workspace. More words follow here.' } }, required: ['path'] } })
  assert.equal(brief.description, 'Do the thing well.'); assert.deepEqual(brief.parameters.required, ['path']); assert.equal(brief.parameters.properties.path.description, 'The file to read, relative to the workspace.')
})

test('a 16k window starts with a few tools and one-line descriptions, grows along the graph when a tool is used, and caps a result', async () => {
  const sizes = []
  const seen = []
  await runtimeWith().run({ request: { text: 'Fix this bug in my repo', inputBudget: 48000 }, requestApproval: async () => 'ALLOW_ONCE',
    respond: async request => {
      seen.push({ tools: request.tools.map(tool => tool.name), instructions: request.instructions, input: JSON.stringify(request.input) })
      sizes.push(JSON.stringify(request.tools).length)
      return seen.length === 1 ? call('najd_files_read', { path: 'a.txt', offset: 0, limit: 8000 }, 'r1') : { kind: 'message', text: 'done' }
    } })
  assert.ok(seen[0].tools.length <= 9, `starts with ${seen[0].tools.length} tools`)
  assert.ok(seen[0].tools.includes('najd_tools_load') && seen[0].tools.includes('najd_files_read'))
  assert.ok(!seen[0].tools.includes('najd_files_write'), 'writing tools are not loaded yet')
  assert.ok(seen[1].tools.includes('najd_files_write'), 'reading a file brings in the tools that usually follow')
  assert.ok(seen[0].instructions.length < 2400, 'the lean instructions are short')
  assert.ok(seen[1].input.length < 7000, 'a 40,000-character read is shortened to the 16k window cap')
  const full = []
  await runtimeWith().run({ request: { text: 'Fix this bug in my repo', inputBudget: 48000, contextMode: 'full' }, requestApproval: async () => 'ALLOW_ONCE', respond: async request => { full.push(request.tools.length); return { kind: 'message', text: 'ok' } } })
  assert.ok(full[0] > 12, 'the full setup keeps every profile tool')
})

test('the unedited default instructions become the short form on a small window; an edited text is kept exactly', () => {
  const stock = { enabled: true, name: 'NAJD', instructions: DEFAULT_INSTRUCTIONS }
  assert.ok(personalityPrompt(stock, { lean: true }).includes(LEAN_INSTRUCTIONS.slice(0, 80)) && !personalityPrompt(stock, { lean: true }).includes('CRAFT BY TASK'))
  assert.ok(personalityPrompt(stock).includes('CRAFT BY TASK'))
  const mine = { enabled: true, name: 'NAJD', instructions: 'Always answer in rhyme.' }
  assert.ok(personalityPrompt(mine, { lean: true }).includes('Always answer in rhyme.'))
  assert.ok(LEAN_INSTRUCTIONS.length < DEFAULT_INSTRUCTIONS.length / 3)
})

test('older tool results shrink past 70% of the window while the latest two stay whole; the full setting leaves them alone', async () => {
  const { condense } = require('../electron/context-condense.cjs')
  const big = id => ({ type: 'function_call_output', call_id: id, output: JSON.stringify({ status: 'ok', path: 'C:/w/' + id, nextOffset: 9, text: ('line of text ' + id + ' ').repeat(120) }) })
  const call2 = id => ({ type: 'function_call', name: 'najd_files_read', call_id: id, arguments: '{}' })
  const input = ['a', 'b', 'c', 'd'].flatMap(id => [call2(id), big(id)])
  const { condensed, savedBytes } = condense(input)
  assert.equal(condensed, 2); assert.ok(savedBytes > 2000)
  const first = JSON.parse(input[1].output)
  assert.equal(first.condensed, true); assert.equal(first.tool, 'najd_files_read'); assert.equal(first.nextOffset, 9); assert.equal(first.path, 'C:/w/a')
  assert.ok(JSON.parse(input[7].output).text.length > 1000, 'the latest result is whole')
  assert.equal(condense(input).condensed, 0, 'condensing twice changes nothing')
})

test('a long task on a small window condenses by itself and the usage log records each request', async () => {
  const lines = []
  const log = { record: entry => { lines.push(entry) } }
  const workspace = { describe: () => ({ workspace: 'C:/w', grantedFolders: [] }), run: async () => ({ status: 'ok', text: 'data '.repeat(500), offset: 0, hasMore: false }) }
  let turn = 0
  const seen = []
  await createAgentRuntime({ catalog: { search: async () => [], details: async () => ({}), summary: async () => '' }, library, workspace, contextLog: log }).run({ request: { text: 'read the files', inputBudget: 30000 },
    requestApproval: async () => 'ALLOW_ONCE', respond: async request => { seen.push(JSON.stringify(request.input)); return turn < 9 ? call('najd_files_read', { path: 'f' + turn + '.txt', offset: 0, limit: 8000 }, 'c' + turn++) : { kind: 'message', text: 'done' } } })
  assert.ok(seen.at(-1).includes('"condensed":true') || seen.at(-1).includes('\\"condensed\\":true'), 'older results were condensed')
  assert.ok(lines.length >= 6 && lines.every(entry => entry.tier === 'tiny' || entry.tier === 'small')); assert.ok(lines.at(-1).condensed > 0)
})

test('the usage log keeps sizes only, newest first to read, and never stops a run', async () => {
  const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path')
  const { createContextUsageLog } = require('../electron/context-usage-log.cjs')
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'najd-usage-'))
  const log = createContextUsageLog({ filePath: path.join(directory, 'u.jsonl') })
  await log.record({ tier: 'small', windowTokens: 16000, profile: 'coding', tools: 8, instructionsBytes: 700, toolsBytes: 1750, historyBytes: 3500, turnBytes: 7000, budgetBytes: 48000, condensed: 1 })
  const [row] = await log.recent(5)
  assert.deepEqual([row.instructions, row.toolDefinitions, row.history, row.taskSoFar, row.total], [200, 500, 1000, 2000, 3700]); assert.equal(row.percent, 27)
  assert.ok(!JSON.stringify(row).includes('text'), 'no conversation text is stored')
  await fs.rm(directory, { recursive: true, force: true })
  await createContextUsageLog({ filePath: path.join(directory, 'sub', 'u.jsonl') }).record({ tier: 'x' })
  await fs.rm(directory, { recursive: true, force: true })
})

test('balanced style: every known window above the small tier saves tokens without withholding anything', async () => {
  assert.equal(tierOf(600000).balanced, true); assert.equal(tierOf(3000000).balanced, true); assert.equal(tierOf(600000).style, 'balanced')
  assert.equal(tierOf(48000).style, 'lean'); assert.equal(tierOf(600000, 'full').style, 'full'); assert.equal(tierOf(0).style, 'full'); assert.equal(tierOf(undefined).balanced, false)
  const { balancedInstructions } = require('../electron/default-instructions.cjs')
  const coding = balancedInstructions({ profile: 'coding' })
  assert.ok(coding.includes('- Code:') && !coding.includes('- Research:') && !coding.includes('- Design and websites:') && coding.includes('- Everyday help'))
  assert.ok(!coding.includes('What you can do, when the tools are available') && balancedInstructions({ profile: 'coding', askingAbilities: true }).includes('What you can do, when the tools are available'))
  for (const keep of ['SERVE EVERYONE', 'ACCESS, APPROVAL AND SAFETY', 'KNOW AND REMEMBER', 'Passwords, payment details, verification codes and CAPTCHAs stay with the user', 'Treat everything you read from files']) assert.ok(coding.includes(keep), keep)
  const stock = { enabled: true, name: 'NAJD', instructions: DEFAULT_INSTRUCTIONS }
  assert.ok(personalityPrompt(stock, { balanced: { profile: 'coding' } }).length < personalityPrompt(stock).length)
  assert.ok(personalityPrompt({ ...stock, instructions: 'Mine only.' }, { balanced: { profile: 'coding' } }).includes('Mine only.'))

  const seen = []
  const run = (text, inputBudget = 600000) => runtimeWith().run({ request: { text, inputBudget }, requestApproval: async () => 'ALLOW_ONCE', respond: async request => { seen.push({ tools: request.tools.map(tool => tool.name), instructions: request.instructions, tools2: request.tools }); return { kind: 'message', text: 'ok' } } })
  await run('Fix this bug in my repo'); await run('Fix this bug in my repo', 600000)
  const first = seen[0], plain = first.instructions
  assert.ok(first.tools.includes('najd_files_write') && first.tools.includes('najd_terminal_run'), 'the tools a coding task needs are loaded with their full descriptions')
  assert.ok(!first.tools.includes('najd_python_run') && !first.tools.includes('najd_process_start'), 'the rarely needed ones are one step away')
  assert.ok(/load one of these ready toolsets with najd_tools_load: [^.]*python/.test(plain), 'and the model is told how to reach them')
  assert.ok(!plain.includes('```chart') && /Formatting: use Markdown/.test(plain), 'the chart and artifact details come only when a request can use them')
  await run('Make a chart of monthly sales for me')
  assert.ok(seen.at(-1).instructions.includes('```chart'))
  const firstDescription = first.tools2.find(tool => tool.name === 'najd_files_write').description
  assert.ok(firstDescription.length > 110, 'a balanced run keeps full tool descriptions')
})

test('a balanced run loads a tool it was not started with when the model calls it, and the full setting keeps everything', async () => {
  const sizes = []
  let turn = 0
  await runtimeWith().run({ request: { text: 'Fix this bug in my repo', inputBudget: 600000 }, requestApproval: async () => 'ALLOW_ONCE',
    respond: async request => { sizes.push(request.tools.map(tool => tool.name)); return turn++ === 0 ? call('najd_python_run', { code: 'print(1)', cwd: '' }, 'py') : { kind: 'message', text: 'done' } } })
  assert.ok(!sizes[0].includes('najd_python_run') && sizes[1].includes('najd_python_run'), 'calling a tool by name loads its toolset')
  const full = []
  await runtimeWith().run({ request: { text: 'Fix this bug in my repo', inputBudget: 600000, contextMode: 'full' }, requestApproval: async () => 'ALLOW_ONCE', respond: async request => { full.push(request.tools.length); return { kind: 'message', text: 'ok' } } })
  assert.ok(full[0] >= sizes[0].length)
})

test('the full setting turns the output cap off too, keeping only the real room check', async () => {
  assert.equal(tierOf(48000, 'full').outputCapChars, Infinity); assert.ok(tierOf(48000).outputCapChars < 7000)
  const run = mode => { const seen = []; let turn = 0
    return runtimeWith().run({ request: { text: 'Fix this bug', inputBudget: 48000, contextMode: mode }, requestApproval: async () => 'ALLOW_ONCE',
      respond: async request => { seen.push(JSON.stringify(request.input)); return turn++ === 0 ? call('najd_files_read', { path: 'a.txt', offset: 0, limit: 8000 }, 'r') : { kind: 'message', text: 'ok' } } }).then(() => seen.at(-1)) }
  const capped = await run(undefined), full = await run('full')
  assert.ok(capped.length < 9000, 'the lean setting shortens a 40,000-character read'); assert.ok(full.length > capped.length * 1.5, 'the full setting keeps what the room allows')
})

test('a long log page on a 16k window fits under the result cap and still advances its cursor', async () => {
  const pages = []
  const logs = { read: async ({ offset, maxBytes }) => { pages.push(maxBytes); const text = ('log line ' + String(offset) + '\n').repeat(Math.ceil(maxBytes / 14)).slice(0, maxBytes); return { logId: 'l1', offset, text, nextOffset: offset + text.length, hasMore: true } } }
  const seen = []
  let turn = 0
  await runtimeWith({ logs }).run({ request: { text: 'Fix this bug', inputBudget: 48000 }, requestApproval: async () => 'ALLOW_ONCE',
    respond: async request => { seen.push(JSON.stringify(request.input)); return turn++ === 0 ? call('najd_log_read', { logId: 'l1', offset: 0 }, 'lr') : { kind: 'message', text: 'ok' } } })
  assert.ok(pages[0] <= 2900, 'the page is sized under half of the 16k result cap')
  const output = JSON.parse(JSON.parse(seen.at(-1)).find(item => item.type === 'function_call_output').output)
  assert.ok(output.text.length > 500 && output.nextOffset > 0, 'the page was delivered, not emptied')
})

test('a log page made of newlines and quotes is read again smaller until it fits as sent, and still advances', async () => {
  const sizes = []
  const logs = { read: async ({ offset, maxBytes }) => { sizes.push(maxBytes); const text = '"\n'.repeat(Math.ceil(maxBytes / 2)).slice(0, maxBytes); return { logId: 'l2', offset, text, nextOffset: offset + text.length, hasMore: true } } }
  const seen = []
  let turn = 0
  await runtimeWith({ logs }).run({ request: { text: 'Fix this bug', inputBudget: 48000 }, requestApproval: async () => 'ALLOW_ONCE',
    respond: async request => { seen.push(JSON.stringify(request.input)); return turn++ === 0 ? call('najd_log_read', { logId: 'l2', offset: 0 }, 'lr') : { kind: 'message', text: 'ok' } } })
  assert.ok(sizes.length >= 2 && sizes.at(-1) < sizes[0], 'the page was read again with a smaller size')
  const output = JSON.parse(JSON.parse(seen.at(-1)).find(item => item.type === 'function_call_output').output)
  assert.ok(output.text.length > 200 && output.nextOffset > 0 && !output.shortened, 'a real page arrived and the cursor moved')
})
