// Working in a tab NAJD opened with another tool: the tab is chosen by its exact address, only after the owner approves, never when
// ambiguous, and never on a private address. Real bridge + a simulated extension, as in browser-tools.test.cjs.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const { createBrowserBridge } = require('../electron/browser-bridge.cjs')
const { createBrowserTools } = require('../electron/browser-tools.cjs')
const { createActionJournal } = require('../electron/action-journal.cjs')
const { publicUrl } = require('../electron/agent-runtime.cjs')

const origin = `chrome-extension://${'c'.repeat(32)}`
const results = { url: 'https://search.example/results?q=gold', title: 'gold - results', text: 'Results', elements: [{ id: 'e1', role: 'link', label: 'Gold price today', href: 'https://gold.example/today' }] }

function fakeExtension(port, code, tabs) {
  const headers = { origin, authorization: `Bearer ${code}`, 'content-type': 'application/json' }
  const received = []
  let running = true
  const loop = (async () => {
    while (running) {
      const response = await fetch(`http://127.0.0.1:${port}/v2/command/next`, { headers }).catch(() => null)
      if (response?.status !== 200) continue
      const { id, kind, args } = await response.json()
      received.push({ kind, args })
      const matches = tabs.filter(tab => tab.url === args.url)
      const body = kind !== 'attach' ? { id, ok: true, result: results, page: results }
        : matches.length === 1 ? { id, ok: true, result: matches[0], page: matches[0] } : { id, ok: false, error: matches.length ? 'AMBIGUOUS_TAB' : 'NO_MATCHING_TAB' }
      await fetch(`http://127.0.0.1:${port}/v2/command/result`, { method: 'POST', headers, body: JSON.stringify(body) })
    }
  })()
  return { received, stop: async () => { running = false; await loop } }
}

async function setup(t, tabs) {
  const bridge = createBrowserBridge({ filePath: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'najd-attach-')), 'link.json'), encryption: { isEncryptionAvailable: () => false }, ports: [38295, 38296], pollMs: 1000 })
  const { port } = await bridge.start()
  bridge.setHandlers({ onPairRequest: request => { void bridge.resolvePair(request.id, true) } })
  const asked = await (await fetch(`http://127.0.0.1:${port}/v2/pair/request`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: '{}' })).json()
  await new Promise(resolve => setTimeout(resolve, 30))
  const { secret } = await (await fetch(`http://127.0.0.1:${port}/v2/pair/status?id=${asked.id}`, { headers: { origin } })).json()
  const extension = fakeExtension(port, secret, tabs)
  t.after(async () => { await bridge.stop(); await extension.stop() })
  for (let i = 0; i < 40 && !bridge.status().connected; i++) await new Promise(resolve => setTimeout(resolve, 50))
  const journal = createActionJournal({ filePath: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'najd-attach-')), 'actions.json') })
  return { browser: createBrowserTools({ bridge, journal, allowUrl: publicUrl }), extension }
}
const args = target => ({ action: 'attach', target, text: '', submit: false })

test('attach asks the owner first, then reads the exact tab; a denial sends nothing to the browser', async t => {
  const { browser, extension } = await setup(t, [results])
  const asked = []
  const denied = await browser.run(args(results.url), { requestApproval: async (tool, input) => { asked.push([tool, input.path]); return 'DENY' } })
  assert.equal(denied.status, 'denied_by_user')
  assert.deepEqual(extension.received, [])
  const attached = await browser.run(args(results.url), { requestApproval: async () => 'ALLOW_ONCE' })
  assert.equal(attached.status, 'attached')
  assert.match(attached.page.elements[0], /e1 link "Gold price today"/)
  assert.deepEqual(asked, [['najd-browser-attach', results.url]])
  assert.deepEqual(extension.received.map(item => item.kind), ['attach'])
})

test('no matching tab and several matching tabs are reported, never guessed', async t => {
  const { browser } = await setup(t, [results, { ...results }])
  assert.equal((await browser.run(args(results.url), { requestApproval: async () => 'ALLOW_ONCE' })).status, 'ambiguous_tab')
  assert.equal((await browser.run(args('https://other.example/'), { requestApproval: async () => 'ALLOW_ONCE' })).status, 'no_matching_tab')
})

test('a private address is refused before any approval or browser command', async t => {
  const { browser, extension } = await setup(t, [])
  let asked = false
  await assert.rejects(browser.run(args('http://192.168.1.1/admin'), { requestApproval: async () => { asked = true; return 'ALLOW_ONCE' } }), { code: 'PATH_NOT_ALLOWED' })
  assert.equal(asked, false); assert.deepEqual(extension.received, [])
})

test('the extension matcher prefers the exact address, then the same site and path, and skips private windows', async () => {
  const { matchTabs } = await import('../browser-extension-v2/src/protocol.js')
  const tabs = [{ id: 1, url: 'https://a.example/x?q=1' }, { id: 2, url: 'https://a.example/x?q=2' }, { id: 3, url: 'https://a.example/x?q=3', incognito: true }, { id: 4, url: 'chrome://settings' }]
  assert.deepEqual(matchTabs(tabs, 'https://a.example/x?q=2').map(tab => tab.id), [2])
  assert.deepEqual(matchTabs(tabs, 'https://a.example/x').map(tab => tab.id), [1, 2])
  assert.deepEqual(matchTabs(tabs, 'not a url'), [])
})

test('navigate is understood as open and follows the same address rules', async t => {
  const { browser, extension } = await setup(t, [])
  const opened = await browser.run({ action: 'navigate', target: 'https://search.example/results?q=gold', text: '', submit: false }, { requestApproval: async () => 'DENY' })
  assert.equal(opened.status, 'opened'); assert.deepEqual(extension.received.map(item => item.kind), ['open'])
  await assert.rejects(browser.run({ action: 'navigate', target: 'http://10.0.0.1/', text: '', submit: false }, {}), { code: 'PATH_NOT_ALLOWED' })
})
