// Measures what NAJD sends to a model before any real work starts: runtime instructions, tool definitions and the
// default system prompt, for each agent profile. Uses a fully connected fake runtime (no network, no real data).
// Usage: node scripts/measure-context.cjs [--json]
const { createAgentRuntime } = require('../electron/agent-runtime.cjs')
const { DEFAULT_INSTRUCTIONS, LEAN_INSTRUCTIONS } = require('../electron/default-instructions.cjs')
const { tierOf } = require('../electron/context-tier.cjs')
const { balancedInstructions } = require('../electron/default-instructions.cjs')
const soulFor = (windowTokens, profile) => { const tier = tierOf(windowTokens ? windowTokens * 3 : 0); return tier.lean ? LEAN_INSTRUCTIONS : tier.balanced ? balancedInstructions({ profile }) : DEFAULT_INSTRUCTIONS }

// A rough size in tokens. English and JSON are about 4 characters per token; Arabic is closer to 2.5. The estimate
// uses 3.5 so the numbers are neither flattering nor alarming.
const tokens = bytesOrText => Math.ceil((typeof bytesOrText === 'number' ? bytesOrText : Buffer.byteLength(bytesOrText)) / 3.5)

const library = { list: async () => [], read: async () => ({ text: '' }), search: async () => [] }
function fullRuntime() {
  const workspace = { describe: () => ({ workspace: 'C:/w', grantedFolders: [] }), run: async () => ({ status: 'ok' }) }
  return createAgentRuntime({ catalog: { search: async () => [], details: async id => ({ id, kind: 'tool', ready: true }), summary: async () => '' }, library,
    skills: { read: async () => ({ text: 'guide' }) }, connectors: { readApps: async () => ({ apps: [] }) }, workspace,
    web: { available: async () => true, search: async () => ({ results: [] }), extract: async () => ({ text: '' }) },
    memory: { remember: async () => ({ status: 'saved' }), forget: async () => ({}) },
    media: { services: async () => ['openai-images', 'openai-video'], describe: { image: 'images', video: 'video' } },
    mcp: { tools: async () => [{ server: 's1', serverName: 'Files', name: 'read', inputSchema: {}, hints: {} }], call: async () => ({ text: 'ok' }) },
    browser: { available: () => true, describe: () => 'linked.', run: async () => ({ status: 'ok' }) },
    python: { available: async () => true }, logs: { read: async () => ({}) }, processes: { available: () => true }, desktop: { available: () => true } })
}

const SAMPLES = [
  ['general', 'Hello, how are you today?'],
  ['coding', 'Fix this bug in my repo'],
  ['office', 'Make an Excel budget sheet'],
  ['design', 'Design a logo for a cafe'],
  ['research', 'Search for the latest iPhone prices']
]

async function measureOne(text, windowTokens) {
  const runtime = fullRuntime()
  let first = null
  await runtime.run({ request: { text, ...(windowTokens ? { inputBudget: windowTokens * 3 } : {}) }, requestApproval: async () => 'DENY',
    respond: async request => { first = first || { instructions: request.instructions, tools: request.tools }; return { kind: 'message', text: 'ok' } } })
  return first
}

async function table(windowTokens) {
  const rows = []
  for (const [label, text] of SAMPLES) {
    const sent = await measureOne(text, windowTokens)
    if (!sent) continue
    const toolsJson = JSON.stringify(sent.tools)
    const row = { profile: label, toolCount: sent.tools.length, instructionsTokens: tokens(sent.instructions), toolTokens: tokens(toolsJson), systemPromptTokens: tokens(soulFor(windowTokens, label)) }
    row.total = row.instructionsTokens + row.toolTokens + row.systemPromptTokens
    rows.push(row)
  }
  return rows
}

async function main() {
  const windows = process.argv.includes('--windows') ? process.argv[process.argv.indexOf('--windows') + 1].split(',').map(Number) : [0, 16000, 32000, 200000, 1000000]
  const all = {}
  for (const windowTokens of windows) all[windowTokens || 'unknown'] = await table(windowTokens)
  if (process.argv.includes('--json')) { console.log(JSON.stringify(all, null, 2)); return }
  for (const [windowTokens, rows] of Object.entries(all)) {
    console.log(`
Idle context before any work, model window: ${windowTokens === 'unknown' ? 'unknown (full setup)' : windowTokens + ' tokens'} (estimated tokens)`)
    console.log('profile    tools  runtime  tools-json  default-prompt  total')
    for (const row of rows) console.log(`${row.profile.padEnd(10)} ${String(row.toolCount).padStart(5)}  ${String(row.instructionsTokens).padStart(7)}  ${String(row.toolTokens).padStart(10)}  ${String(row.systemPromptTokens).padStart(14)}  ${String(row.total).padStart(5)}`)
  }
}
main().catch(error => { console.error(error); process.exit(1) })
