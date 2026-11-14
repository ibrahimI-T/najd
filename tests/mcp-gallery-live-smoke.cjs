// The popular MCP servers gallery (R-083) in the real app with an isolated profile, against real hosted servers that need no account:
// the gallery lists every preset, its search narrows the list, one click adds DeepWiki (through the native confirmation, answered by the
// harness) and it connects and lists its tools; then Microsoft Learn the same way. Needs the internet; not part of npm test.
const assert = require('node:assert/strict')
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os')
const { launch, stop, evaluate, waitFor } = require('./electron-ui-smoke.cjs')

async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'najd-desktop-test-'))
  await fs.writeFile(path.join(root, 'mcp-confirm.txt'), 'yes')
  let instance
  try {
    instance = await launch(root)
    const client = instance.client
    const value = async expression => { const result = await client.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); assert.ok(!result.exceptionDetails, JSON.stringify(result.exceptionDetails)); return result.result.value }
    const press = async selector => { assert.equal(await evaluate(client, `(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e || e.disabled) return false; e.click(); return true })()`), true, 'cannot press ' + selector) }
    await waitFor(async () => await evaluate(client, 'document.querySelector("[data-shell=workstation]")?.dataset.renderer === "vue"'))
    await press('[data-nav="account"]')
    await waitFor(async () => await evaluate(client, '!!document.querySelector(".n-account + .w-menu")'))
    await press('.n-account + .w-menu button:last-child')
    await waitFor(async () => await evaluate(client, '!!document.querySelector(\'[data-settings-route="mcp"]\')'))
    await press('[data-settings-route="mcp"]')
    await waitFor(async () => await evaluate(client, '!!document.querySelector("[data-mcp-presets]")'))
    const count = await evaluate(client, 'document.querySelectorAll("[data-mcp-presets] .s-preset").length')
    assert.ok(count >= 30, 'the gallery lists the presets: ' + count)

    const search = async text => evaluate(client, `(() => { const i = document.querySelector('.s-preset-search'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, ${JSON.stringify(text)}); i.dispatchEvent(new Event('input', { bubbles: true })) })()`)
    for (const [query, name] of [['deepwiki', 'DeepWiki'], ['microsoft', 'Microsoft Learn'], ['mcp-server-time', 'Time'], ['server-sequential-thinking', 'Sequential thinking']]) {
      await search(query)
      await waitFor(async () => await evaluate(client, `(() => { const cards = [...document.querySelectorAll('[data-mcp-presets] .s-preset')]; return cards.length >= 1 && cards.length < ${count} && cards.some(card => card.innerText.includes(${JSON.stringify(name)})) })()`))
      await evaluate(client, `[...document.querySelectorAll('[data-mcp-presets] .s-preset')].find(card => card.innerText.includes(${JSON.stringify(name)})).querySelector('button').click()`)
      await waitFor(async () => (await value('window.najdMcpServers.list()')).some(server => server.name === name && server.state === 'connected' && server.tools.length > 0), 90000)
      const server = (await value('window.najdMcpServers.list()')).find(item => item.name === name)
      console.log(`${name}: connected, ${server.tools.length} tools (${server.tools.map(tool => tool.name).slice(0, 4).join(', ')})`)
      await waitFor(async () => await evaluate(client, `[...document.querySelectorAll('[data-mcp-presets] .s-preset')].find(card => card.innerText.includes(${JSON.stringify(name)}))?.querySelector('button').disabled === true`))
    }
    console.log('PASS: MCP gallery: presets listed and searchable; DeepWiki and Microsoft Learn (hosted) Time (local, uvx) and Sequential thinking (local, npx) added in one click, connected and listed their tools.')
  } catch (error) {
    console.error('FAIL:', error)
    process.exitCode = 1
  } finally {
    if (instance) await stop(instance)
    await fs.rm(root, { recursive: true, force: true }).catch(() => {})
    await fs.rm(root + '-documents', { recursive: true, force: true }).catch(() => {})
  }
}
main()
