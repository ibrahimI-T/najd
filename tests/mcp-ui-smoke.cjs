// End to end in the real app (isolated profile, fixture model): add an external MCP server in Settings
// through the native confirmation, connect it, then let the model discover and call its tool with an
// in-chat approval (deny first, then allow).
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { launch, stop, click, evaluate, waitFor } = require('./electron-ui-smoke.cjs')
const fixture = path.join(__dirname, 'fixtures', 'mcp-fixture-server.cjs')
const started = Date.now(), step = name => console.log(`[${Math.round((Date.now() - started) / 1000)}s] ${name}`)

async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'najd-desktop-test-'))
  let instance
  try {
    instance = await launch(root)
    const client = instance.client
    const run = async expression => {
      const result = await client.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
      assert.ok(!result.exceptionDetails, JSON.stringify(result.exceptionDetails))
      return result.result.value
    }
    const el = selector => evaluate(client, `document.querySelector(${JSON.stringify(selector)}) !== null`)
    async function type(selector, value) {
      await waitFor(() => el(selector))
      await click(client, selector)
      await client.send('Input.insertText', { text: value })
    }
    await run(`(async()=>{await window.najdProviders.saveKey('openai-api','sk-najd-API-TEST-KEY');
      const l=await window.najdProviders.limits();await window.najdProviders.setLimits({...l.policy,maxOutputTokens:1024,maxCloudAttempts:100});
      localStorage.setItem('najd.provider.v1','openai-api');localStorage.setItem('najd.models.v2',JSON.stringify({'openai-api':'gpt-6.1-sol'}));return true})()`)
    step('provider set')
    await client.send('Page.reload')
    await waitFor(async () => await evaluate(client, 'document.querySelector(".composer-models select")?.value==="gpt-6.1-sol"'))

    step('reloaded')
    // Settings > Connections > Add server.
    await click(client, '.sidebar-link[aria-label]')
    await waitFor(() => el('.settings-nav'))
    await click(client, '.settings-nav-item[data-section="connections"]')
    // Server management sits in a folded section below the connections catalog.
    await waitFor(() => el('details.catalog-manage > summary'))
    await click(client, 'details.catalog-manage > summary')
    await waitFor(() => el('[data-mcp-server-action="add"]'))
    step('connections open')
    await click(client, '[data-mcp-server-action="add"]')
    await type('[data-mcp-field="name"]', 'Fixture')
    await type('[data-mcp-field="command"]', process.execPath)
    await type('[data-mcp-field="args"]', fixture)
    await type('[data-mcp-field="env"]', 'FIXTURE_TOKEN=secret-value')
    // First answer the native confirmation with Cancel: nothing may be saved.
    await click(client, '[data-mcp-server-action="save"]')
    await waitFor(async () => (await evaluate(client, 'document.querySelector("[data-mcp-message]")?.textContent || ""')).length > 0)
    assert.equal((await run('window.najdMcpServers.list()')).length, 0, 'a cancelled confirmation saves nothing')
    assert.equal(await evaluate(client, 'document.querySelector("[data-mcp-field=env]").value'), '', 'secret values leave the form after submit')
    step('cancel path ok')
    await fs.writeFile(path.join(root, 'mcp-confirm.txt'), 'yes')
    await type('[data-mcp-field="env"]', 'FIXTURE_TOKEN=secret-value')
    await click(client, '[data-mcp-server-action="save"]')
    await waitFor(() => el('[data-mcp-server="fixture"]'))
    const stored = await fs.readFile(path.join(root, 'najd-data', 'mcp-servers.json'), 'utf8')
    assert.ok(!stored.includes('secret-value'), 'secrets are stored encrypted')
    await click(client, '[data-mcp-server="fixture"] [data-mcp-server-action="connect"]')
    await waitFor(async () => await evaluate(client, 'document.querySelector("[data-mcp-server-state]")?.dataset.mcpServerState === "connected"'), 30000)
    assert.match(await evaluate(client, 'document.querySelector("[data-mcp-server=fixture]").textContent'), /5/)

    step('connected')
    // Chat: the model finds the tool through the catalog and calls it; every call needs approval.
    await run('document.querySelector(".app-rail .rail-item[aria-label=\\"Chat\\"], .app-rail .rail-item[aria-label=\\"المحادثة\\"]").click()')
    step('back to chat')
    for (const decision of ['deny', 'allow']) {
      await waitFor(() => el('#prompt'))
      step('prompt ready: ' + decision)
      await click(client, '#prompt')
      await client.send('Input.insertText', { text: 'mcp fixture' })
      await click(client, '.send-button')
      step('sent')
      await waitFor(() => el('.approval-card'), 60000).catch(async error => { console.error(await evaluate(client, 'document.body.innerText')); throw error })
      const card = await evaluate(client, 'document.querySelector(".approval-card").textContent')
      assert.ok(card.includes('MCP · Fixture · echo') && card.includes('from model'), 'approval shows server, tool and arguments: ' + card)
      await click(client, decision === 'deny' ? '.approval-deny' : '.approval-allow')
      const expected = decision === 'deny' ? 'MCP call denied_by_user' : 'MCP said: echo: from model'
      await waitFor(async () => await evaluate(client, `Array.from(document.querySelectorAll(".message.assistant")).some(m=>m.textContent.includes(${JSON.stringify(expected)}))`), 60000)
    }
    console.log('PASS: MCP server added only after native confirmation (secrets encrypted), connected with 5 tools, discovered by the model and called once after in-chat approval; denial did not call it.')
  } finally {
    if (instance) await stop(instance).catch(error => console.error('stop:', error.message))
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(root).startsWith('najd-desktop-test-')) throw Error('Unsafe cleanup')
    await fs.rm(root, { recursive: true, force: true }).catch(() => {})
    await fs.rm(root + '-documents', { recursive: true, force: true }).catch(() => {})
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
