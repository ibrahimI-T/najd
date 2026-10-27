// Real bridge: original Hermes web_search/web_extract inside the staged sealed core,
// isolated profile, through NAJD's bridge. Requires network and a staged payload.
//   node tests/hermes-tools-smoke.cjs .runtimes/runtime-packs/agent-core-004
const assert = require('node:assert/strict')
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os')
const { createHermesTools } = require('../electron/hermes-tools.cjs')
async function main() {
  const core = path.resolve(process.argv[2])
  const state = await fs.mkdtemp(path.join(os.tmpdir(), 'najd-hermes-tools-'))
  const tools = createHermesTools({ getCoreDirectory: async () => core, stateRoot: state })
  try {
    const page = await tools.extract('https://example.com')
    assert.match(page.result, /Example Domain/)
    const found = await tools.search('Python programming language official site')
    assert.match(found.result, /python\.org/i)
    const controller = new AbortController(); controller.abort()
    await assert.rejects(tools.extract('https://example.com', controller.signal), { code: 'CANCELLED' })
    console.log('PASS: original Hermes web_extract and web_search ran from the sealed core through the NAJD bridge with an isolated profile.')
  } finally { tools.stop(); await new Promise(r => setTimeout(r, 1500)); await fs.rm(state, { recursive: true, force: true }) }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
