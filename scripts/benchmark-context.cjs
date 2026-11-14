// Deterministic request-size comparison; no provider calls or private conversation text.
const { createAgentRuntime } = require('../electron/agent-runtime.cjs')
const { personalityPrompt } = require('../electron/personality.cjs')
const { DEFAULT_INSTRUCTIONS } = require('../electron/default-instructions.cjs')
const persona = { enabled: true, name: 'NAJD', instructions: DEFAULT_INSTRUCTIONS }
async function measure(contextMode) {
  let measured
  const runtime = createAgentRuntime({ catalog: { search: async () => [], summary: async () => '', list: async () => [] }, library: { list: async () => [] }, skills: {},
    workspace: { describe: () => ({ workspace: 'C:/fixture', grantedFolders: [] }) }, web: { available: async () => true }, memory: {},
    mcp: { tools: async () => [{ server: 'fixture', serverName: 'Fixture' }] } })
  await runtime.run({ request: { text: 'وش المهارة ذي؟', inputBudget: 816000, contextMode }, respond: async request => {
    const instructions = personalityPrompt(persona, { lean: contextMode === 'lean', balanced: contextMode !== 'lean' ? { profile: 'general' } : null }) + request.instructions
    measured = { instructionsBytes: Buffer.byteLength(instructions), toolsBytes: Buffer.byteLength(JSON.stringify(request.tools)), tools: request.tools.length }
    return { kind: 'message', text: 'Fixture response' }
  } })
  return measured
}
;(async () => {
  const before = await measure(undefined), after = await measure('lean')
  const sum = row => row.instructionsBytes + row.toolsBytes
  console.log(JSON.stringify({ before, after, requestBytesReductionPercent: Math.round((1 - sum(after) / sum(before)) * 100), scope: 'fixture bytes; not measured provider tokens or task success' }, null, 2))
})().catch(error => { console.error(error); process.exitCode = 1 })
