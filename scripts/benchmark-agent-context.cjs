// Deterministic serialization benchmark; no inference, credentials or device effects.
const { createAgentRuntime } = require('../electron/agent-runtime.cjs')
const profiles = require('../electron/agent-profiles.json')
async function sample(profile, contextMode) {
  const runtime = createAgentRuntime({ catalog: { list: async () => [], summary: async () => '' },
    library: { list: async () => [] }, skills: { read: async () => ({ text: '' }) },
    memory: { context: async () => '' },
    workspace: { describe: () => ({ workspace: 'C:/benchmark', grantedFolders: [] }), run: async () => { throw Error('Unexpected execution') } },
    desktop: { available: () => true }, web: { available: async () => true },
    processes: { available: () => true }, logs: {}, python: { available: async () => true } })
  let captured
  await runtime.run({ request: { profile, text: 'Prepare the requested work.', inputBudget: 48000, contextMode, vision: false }, respond: async request => {
    captured ??= { bytes: Buffer.byteLength(JSON.stringify({ instructions: request.instructions, tools: request.tools, input: request.input })), tools: request.tools.length }
    return { kind: 'message', text: 'Benchmark fixture only.' }
  } })
  return captured
}
async function main() {
  const rows = []
  for (const profile of Object.keys(profiles)) {
    const full = await sample(profile, 'full'), adaptive = await sample(profile, 'auto')
    rows.push({ profile, fullBytes: full.bytes, adaptiveBytes: adaptive.bytes, fullTools: full.tools, adaptiveTools: adaptive.tools,
      reductionPercent: Math.round((1 - adaptive.bytes / full.bytes) * 1000) / 10 })
  }
  console.log(JSON.stringify({ metric: 'serialized initial request bytes, not billed tokens or model quality', modelWindowTokens: 16000, rows }, null, 2))
}
main().catch(error => { console.error(error.code || error.message); process.exitCode = 1 })
