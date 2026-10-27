const { test } = require('node:test')
const assert = require('node:assert/strict')
const { selectProfile, createToolsetManager, TOOLSETS, MAX_TOOLS } = require('../electron/agent-toolsets.cjs')
const { createAgentRuntime } = require('../electron/agent-runtime.cjs')

const call = (name, args, id) => ({ kind: 'agent-tools', calls: [{ name, arguments: JSON.stringify(args), call_id: id }],
  items: [{ type: 'function_call', name, arguments: JSON.stringify(args), call_id: id }] })
const library = { list: async () => [], read: async () => ({ text: '' }), search: async () => [] }
// Every service ready, as on a fully connected install.
function fullRuntime(extra = {}) {
  const workspace = { describe: () => ({ workspace: 'C:/w', grantedFolders: [] }), run: async () => ({ status: 'written', path: 'C:/w/a.txt' }) }
  return createAgentRuntime({ catalog: { search: async () => [], details: async id => ({ id, kind: 'tool', ready: true }), summary: async () => '' }, library,
    skills: { read: async () => ({ text: 'guide' }) }, connectors: { readApps: async () => ({ apps: [] }) }, workspace,
    web: { available: async () => true, search: async () => ({ results: [] }), extract: async () => ({ text: '' }) },
    memory: { remember: async () => ({ status: 'saved' }), forget: async () => ({}) },
    media: { services: async () => ['openai-images', 'openai-video'], describe: { image: 'images', video: 'video' } },
    mcp: { tools: async () => [{ server: 's1', serverName: 'Files', name: 'read', inputSchema: {}, hints: {} }], call: async () => ({ text: 'ok' }) },
    browser: { available: () => true, describe: () => 'linked.', run: async () => ({ status: 'ok' }) },
    python: { available: async () => true }, logs: { read: async () => ({}) }, processes: { available: () => true }, desktop: { available: () => true }, ...extra })
}
const names = request => request.tools.map(tool => tool.name)

test('profile selection: pin, then the current request intent and attachments, then the previous profile, then general', () => {
  assert.equal(selectProfile({ text: 'اكتب لي سكربت بايثون يرتب الملفات' }).profile, 'coding')
  assert.equal(selectProfile({ text: 'Fix this bug in my repo' }).profile, 'coding')
  assert.equal(selectProfile({ text: 'سو لي عرض تقديمي عن الطاقة' }).profile, 'office')
  assert.equal(selectProfile({ text: 'Make an Excel budget sheet' }).profile, 'office')
  assert.equal(selectProfile({ text: 'صمم لي شعار لمقهى' }).profile, 'design')
  assert.equal(selectProfile({ text: 'ابحث لي عن أسعار الآيفون' }).profile, 'research')
  assert.equal(selectProfile({ text: 'كيف حالك' }).profile, 'general')
  // Pin wins; the current intent beats the previous profile (AP-003); ambiguous follow-ups keep the previous one.
  assert.equal(selectProfile({ text: 'صمم شعار', pinned: 'coding' }).profile, 'coding')
  assert.equal(selectProfile({ text: 'now write the python code for it', last: 'design' }).profile, 'coding')
  assert.equal(selectProfile({ text: 'كمل', last: 'design' }).reason, 'previous')
  assert.equal(selectProfile({ text: 'hello', last: 'nonexistent' }).profile, 'general')
  assert.deepEqual(selectProfile({ text: 'احفظ الملخص في ملف' }).extra, ['files'])
})

test('the toolset manager enforces readiness, run scope and the 24-tool limit', () => {
  const definitions = Object.values(TOOLSETS).flat().filter((name, index, all) => all.indexOf(name) === index).map(name => ({ name, schema: { name } }))
  const main = createToolsetManager({ definitions, ready: name => name !== 'browser' })
  assert.equal(main.addToolset('browser'), 'NOT_READY')
  assert.equal(main.addToolset('nope'), 'UNKNOWN_TOOLSET')
  assert.equal(main.addToolset('files'), 'LOADED')
  const many = Array.from({ length: 40 }, (_, index) => ({ name: 'extra_' + index, schema: {} }))
  const capped = createToolsetManager({ definitions: [...definitions, ...many], ready: () => true })
  for (const item of many) capped.addTool(item.name)
  assert.equal(capped.tools().length, MAX_TOOLS)
  assert.equal(capped.addToolset('files'), 'TOOL_LIMIT')
  const delegated = createToolsetManager({ definitions, ready: () => true, scope: 'delegated' })
  for (const name of ['memory', 'files', 'terminal', 'browser', 'media', 'mcp', 'delegate']) delegated.addToolset(name)
  assert.deepEqual(delegated.tools().map(item => item.name).sort(), ['najd_files_list', 'najd_files_read', 'najd_files_search'])
  assert.equal(delegated.addToolset('memory'), 'NOT_ALLOWED')
})

test('a general request carries only general tools and is far smaller than with every toolset loaded', async () => {
  const runtime = fullRuntime()
  const sizes = [], toolNames = []
  const loads = ['files', 'files-manage', 'terminal', 'browser', 'video', 'delegate']
  let turn = 0
  const result = await runtime.run({ request: { text: 'كيف حالك اليوم؟' }, respond: async request => {
    sizes.push(Buffer.byteLength(request.instructions) + Buffer.byteLength(JSON.stringify(request.tools)))
    toolNames.push(names(request))
    if (turn < loads.length) { const name = loads[turn]; turn++; return call('najd_tools_load', { toolset: name, unload: '' }, 'load-' + name) }
    return { kind: 'message', text: 'ok' }
  } })
  assert.equal(result.profile, 'general')
  assert.equal(toolNames[0].includes('najd_files_write'), false)
  assert.equal(toolNames[0].includes('najd_browser'), false)
  assert.ok(toolNames[0].includes('najd_mcp_call'), 'user-added MCP servers stay available')
  assert.ok(toolNames.at(-1).includes('najd_browser') && toolNames.at(-1).includes('najd_files_write') && toolNames.at(-1).includes('najd_delegate'))
  assert.ok(sizes[0] <= sizes.at(-1) * 0.6, `general request ${sizes[0]} bytes vs full ${sizes.at(-1)} bytes`)
  assert.deepEqual(result.toolsets.slice(-loads.length), loads)
})

test('najd_tools_load reports unready and unknown toolsets without loading anything', async () => {
  const runtime = fullRuntime({ browser: { available: () => false, describe: () => '', run: async () => ({}) } })
  const outputs = []
  let turn = 0
  await runtime.run({ request: { text: 'hello' }, respond: async request => {
    if (turn) outputs.push(JSON.parse(request.input.at(-1).output))
    if (turn === 0) { turn++; return call('najd_tools_load', { toolset: 'browser', unload: '' }, 't1') }
    if (turn === 1) { turn++; return call('najd_tools_load', { toolset: 'root-access', unload: '' }, 't2') }
    assert.equal(names(request).includes('najd_browser'), false)
    return { kind: 'message', text: 'ok' }
  } })
  assert.equal(outputs[0].error, 'NOT_READY'); assert.equal(outputs[1].error, 'UNKNOWN_TOOLSET')
  assert.ok(Array.isArray(outputs[0].loadable))
})

test('a delegated sub-agent can never obtain memory or effect tools by any path (AP-001)', async () => {
  let saved = 0, written = 0
  const runtime = fullRuntime({ memory: { remember: async () => { saved++; return {} }, forget: async () => ({}) },
    workspace: { describe: () => ({ workspace: 'C:/w', grantedFolders: [] }), run: async operation => { if (operation !== 'files.list') written++; return { entries: [] } } } })
  const childOutputs = []
  let parentTurn = 0, childTurn = 0
  const result = await runtime.run({ request: { text: 'research this' }, requestApproval: async () => 'ALLOW_ONCE', respond: async request => {
    if (request.isolated) {
      const offered = names(request)
      for (const name of ['najd_memory', 'najd_files_write', 'najd_terminal_run', 'najd_browser', 'najd_mcp_call', 'najd_delegate', 'najd_tools_load', 'najd_image_generate'])
        assert.equal(offered.includes(name), false, name + ' offered to a sub-agent')
      if (childTurn > 0) childOutputs.push(request.input.at(-1).output)
      // 1) details on the memory tool must not add its schema; 2) a direct call must be rejected.
      if (childTurn === 0) { childTurn++; return call('najd_capabilities_details', { id: 'najd-memory' }, 'c1') }
      if (childTurn === 1) { childTurn++; assert.equal(names(request).includes('najd_memory'), false); return call('najd_memory', { action: 'save', kind: 'user', text: 'x', id: '' }, 'c2') }
      return { kind: 'message', text: 'unreachable' }
    }
    if (parentTurn++ === 0) return call('najd_delegate', { task: 'look around', context: '', background: false }, 'p1')
    return { kind: 'message', text: 'parent done' }
  } }).catch(error => error)
  // The forbidden direct call ends the sub-agent with an invalid-output error before anything runs.
  assert.equal(saved, 0); assert.equal(written, 0)
  assert.ok(result.code === 'INVALID_MODEL_OUTPUT' || result.text === 'parent done')
  assert.equal(childOutputs.some(output => /"schema"/.test(output) && /najd_memory/.test(output)), false)
})

test('M2-007: unload makes room atomically; core and memory stay; unloaded tools are no longer callable', async () => {
  const runtime = fullRuntime()
  const outputs = []
  let turn = 0
  const result = await runtime.run({ request: { text: 'fix this bug in my repo' }, respond: async request => {
    if (turn) outputs.push(JSON.parse(request.input.at(-1).output))
    if (turn === 0) { turn++; return call('najd_tools_load', { toolset: 'browser', unload: 'core' }, 'u0') }
    if (turn === 1) { turn++; return call('najd_tools_load', { toolset: 'browser', unload: 'terminal, delegate' }, 'u1') }
    if (turn === 2) { turn++; assert.equal(names(request).includes('najd_terminal_run'), false); assert.ok(names(request).includes('najd_browser'))
      return call('najd_terminal_run', { command: 'Get-Date', cwd: '' }, 'u2') }
    return { kind: 'message', text: 'ok' }
  } }).catch(error => error)
  assert.equal(outputs[0].error, 'NOT_ALLOWED')
  assert.equal(outputs[1].status, 'loaded'); assert.equal(outputs[1].loaded.includes('terminal'), false)
  // Calling the unloaded terminal afterwards is invalid: it is not silently loaded back.
  assert.equal(result.code, 'INVALID_MODEL_OUTPUT')
})

test('M2-R2-005: each profile\'s own toolsets stay at or under 22 tools, leaving room for MCP and attachments', () => {
  const { profiles, PROFILE_BASE_LIMIT } = require('../electron/agent-toolsets.cjs')
  assert.equal(PROFILE_BASE_LIMIT, 22)
  for (const [name, profile] of Object.entries(profiles)) {
    const base = new Set(profile.toolsets.flatMap(toolset => TOOLSETS[toolset] || []))
    assert.ok(base.size <= PROFILE_BASE_LIMIT, name + ' has ' + base.size + ' base tools')
    const withExtras = new Set([...base, ...TOOLSETS.mcp, ...TOOLSETS.library, ...TOOLSETS.transcribe])
    assert.ok(withExtras.size <= MAX_TOOLS, name + ' reaches ' + withExtras.size + ' with MCP and attachments')
  }
})

test('M2-R3-004: attachments and MCP always load before wording-based extras, and every toolset left out is reported', async () => {
  const { profiles } = require('../electron/agent-toolsets.cjs')
  const assetId = 'f'.repeat(64)
  const lib = { list: async () => [{ id: assetId, name: 'clip.mp4', characters: 0, kind: 'video', audioSeconds: 20 }], read: async () => ({ text: 'x' }), search: async () => [],
    video: async () => ({ duration: 5, frames: [{ time: 1, url: 'data:image/jpeg;base64,AA' }] }), audio: async () => ({}) }
  // Wording that asks for every extra toolset at once.
  const text = 'delete the old files, run the command in powershell, open the website in the browser, draw an image and make a video, save the file'
  for (const profile of Object.keys(profiles)) {
    const runtime = fullRuntime({ library: lib, media: { services: async () => ['openai-images', 'openai-video', 'openai-transcription'], describe: { image: 'i', video: 'v' } } })
    await runtime.run({ assetIds: [assetId], request: { text, profile }, respond: async request => {
      const offered = names(request)
      assert.ok(offered.length <= 24, profile + ' has ' + offered.length)
      for (const required of ['najd_mcp_call', 'najd_library_read', 'najd_video_transcribe']) assert.ok(offered.includes(required), profile + ' lacks ' + required)
      const reported = /Not loaded \(tool limit\): ([^;]+);/.exec(request.instructions)?.[1].split(', ') || []
      for (const name of ['files-manage', 'terminal', 'browser', 'media', 'video', 'files']) {
        const { TOOLSETS } = require('../electron/agent-toolsets.cjs')
        const loaded = TOOLSETS[name].every(tool => offered.includes(tool))
        assert.ok(loaded || reported.includes(name), profile + ': ' + name + ' neither loaded nor reported')
      }
      return { kind: 'message', text: 'ok' }
    } })
  }
})

test('M2-004: every profile with every dependency ready, MCP and attachments stays within the provider cap', async () => {
  const { profiles } = require('../electron/agent-toolsets.cjs')
  const assetId = 'f'.repeat(64)
  const lib = { list: async () => [{ id: assetId, name: 'clip.mp4', characters: 0, kind: 'video', audioSeconds: 20 }], read: async () => ({ text: 'x' }), search: async () => [],
    video: async () => ({ duration: 5, frames: [{ time: 1, url: 'data:image/jpeg;base64,AA' }] }), audio: async () => ({}) }
  for (const profile of Object.keys(profiles)) {
    const runtime = fullRuntime({ library: lib, media: { services: async () => ['openai-images', 'openai-video', 'openai-transcription'], describe: { image: 'i', video: 'v' } } })
    await runtime.run({ assetIds: [assetId], request: { text: 'x', profile }, respond: async request => {
      assert.ok(request.tools.length <= 24, profile + ' has ' + request.tools.length + ' tools')
      assert.doesNotMatch(request.instructions, /Not loaded \(tool limit\)/, profile + ' could not load a toolset')
      return { kind: 'message', text: 'ok' }
    } })
  }
})

test('M3-001: an attached workbook or deck starts the office profile', () => {
  for (const kind of ['xlsx', 'pptx']) assert.equal(selectProfile({ text: 'what does this say?', attachmentKinds: [kind] }).profile, 'office')
  assert.notEqual(selectProfile({ text: 'what does this say?', attachmentKinds: ['text'] }).profile, 'office')
})

test('every profile carries short working-style guidance (token budget)', () => {
  const profiles = require('../electron/agent-profiles.json')
  for (const [name, profile] of Object.entries(profiles)) {
    assert.equal(typeof profile.guidance, 'string', name)
    assert.ok(profile.guidance.length > 150 && profile.guidance.length < 1200, name + ' guidance stays short')
  }
})
