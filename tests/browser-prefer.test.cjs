// Several browsers linked at once (Chrome and Edge): a command that chooses a browser (open, attach) goes to the one the user named,
// matched against the linked browser's name; without a name the most recently seen browser is used as before; a named browser that
// is not connected fails with BROWSER_NOT_CONNECTED instead of silently using another one. Real bridge + simulated extensions.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const { createBrowserBridge } = require('../electron/browser-bridge.cjs')

const page = { url: 'https://example.com/', title: 'Example', text: 'Hello', elements: [] }

async function link(bridge, port, id, name) {
  const origin = `chrome-extension://${id.repeat(32)}`
  const asked = await (await fetch(`http://127.0.0.1:${port}/v2/pair/request`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ name }) })).json()
  await new Promise(resolve => setTimeout(resolve, 30))
  const { secret } = await (await fetch(`http://127.0.0.1:${port}/v2/pair/status?id=${asked.id}`, { headers: { origin } })).json()
  const headers = { origin, authorization: `Bearer ${secret}`, 'content-type': 'application/json' }
  const received = []
  let running = true
  const loop = (async () => {
    while (running) {
      const response = await fetch(`http://127.0.0.1:${port}/v2/command/next`, { headers }).catch(() => null)
      if (response?.status !== 200) continue
      const { id: commandId, kind, args } = await response.json()
      received.push({ kind, args })
      await fetch(`http://127.0.0.1:${port}/v2/command/result`, { method: 'POST', headers, body: JSON.stringify({ id: commandId, ok: true, result: page, page }) })
    }
  })()
  return { received, stop: async () => { running = false; await loop } }
}

async function setup(t) {
  const bridge = createBrowserBridge({ filePath: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'najd-prefer-')), 'link.json'), encryption: { isEncryptionAvailable: () => false }, ports: [38305, 38306], pollMs: 1000 })
  const { port } = await bridge.start()
  bridge.setHandlers({ onPairRequest: request => { void bridge.resolvePair(request.id, true) } })
  const chrome = await link(bridge, port, 'a', 'Google Chrome')
  const edge = await link(bridge, port, 'b', 'Microsoft Edge')
  t.after(async () => { await Promise.all([chrome.stop(), edge.stop()]).catch(() => {}); await bridge.stop() })
  await new Promise(resolve => setTimeout(resolve, 1200)) // both have polled
  return { bridge, chrome, edge }
}

test('a named browser gets the command, whichever was seen last', async t => {
  const { bridge, chrome, edge } = await setup(t)
  await bridge.command('open', { url: 'https://example.com/' }, { prefer: 'edge' })
  assert.deepEqual([chrome.received.length, edge.received.length], [0, 1], 'Edge was named')
  assert.equal(bridge.lastBrowser(), 'Microsoft Edge', 'the result can say which browser holds the page')
  bridge.forgetPage()
  await bridge.command('open', { url: 'https://example.com/' }, { prefer: 'Chrome' })
  assert.deepEqual([chrome.received.length, edge.received.length], [1, 1], 'then Chrome, matched without regard to case')
  assert.equal(bridge.lastBrowser(), 'Google Chrome')
})

test('switching to the other named browser drops the page held from the first', async t => {
  const { bridge } = await setup(t)
  await bridge.command('open', { url: 'https://example.com/' }, { prefer: 'edge' })
  const token = bridge.pageToken()
  await bridge.command('open', { url: 'https://example.com/' }, { prefer: 'chrome' })
  assert.notEqual(bridge.pageToken(), token, 'the page of the first browser is no longer current')
})

test('a browser that is not connected is refused, not replaced by another', async t => {
  const { bridge, chrome, edge } = await setup(t)
  await assert.rejects(bridge.command('open', { url: 'https://example.com/' }, { prefer: 'firefox' }), { code: 'BROWSER_NOT_CONNECTED' })
  assert.deepEqual([chrome.received.length, edge.received.length], [0, 0])
})

test('without a name the previous behavior is kept: a command is sent to a connected browser', async t => {
  const { bridge, chrome, edge } = await setup(t)
  await bridge.command('open', { url: 'https://example.com/' })
  assert.equal(chrome.received.length + edge.received.length, 1)
})

test('the browser argument is optional for validation: a call without it still runs, and the schema still lists it', () => {
  const { createAgentRuntime } = require('../electron/agent-runtime.cjs')
  const source = fs.readFileSync(path.join(__dirname, '..', 'electron', 'agent-runtime.cjs'), 'utf8')
  assert.ok(createAgentRuntime, 'runtime loads')
  assert.match(source, /browser: \{ type: 'string' \} \}, \['browser'\]\]/, 'browser is declared optional')
  assert.match(source, /!definition\.optional\?\.includes\(key\)/, 'validation skips optional keys')
})
