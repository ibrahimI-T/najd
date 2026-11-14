// Real third-party MCP servers through NAJD's own MCP client (R-080): the official reference servers from npm
// (@modelcontextprotocol/server-everything and @modelcontextprotocol/server-filesystem), started with npx, connected, their tools listed
// and called, a file read inside the allowed folder, a path outside it refused by the server, and the servers removed. Needs network for
// the first npx download. No account or credential is involved.
// Run: node tests/mcp-real-servers-smoke.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const { createMcpServers } = require('../electron/mcp-servers.cjs')

const encryption = { isEncryptionAvailable: () => true, encryptString: text => Buffer.from('enc:' + text), decryptString: buffer => buffer.toString().slice(4) }

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'najd-mcp-real-'))
  const allowed = path.join(dir, 'allowed'); fs.mkdirSync(allowed)
  fs.writeFileSync(path.join(allowed, 'note.txt'), 'NAJD real MCP check ✓ عربي')
  const servers = createMcpServers({ filePath: path.join(dir, 'mcp-servers.json'), encryption, clientVersion: 'smoke', confirm: async () => true, getBundledNode: () => process.execPath })
  const waitConnected = async id => { for (let i = 0; i < 240; i++) { const item = (await servers.list()).find(server => server.id === id); if (item?.state === 'connected') return item; if (item?.state === 'failed') throw new Error('connect failed: ' + item.error); await new Promise(resolve => setTimeout(resolve, 500)) } throw new Error('connect timeout') }
  try {
    // server-everything: the MCP reference server with echo and add tools.
    const everything = await servers.add({ name: 'everything', command: 'npx', args: ['-y', '@modelcontextprotocol/server-everything'] })
    assert.equal(everything.status, 'added', JSON.stringify(everything))
    await servers.connect(everything.server.id)
    const one = await waitConnected(everything.server.id)
    const names = one.tools.map(tool => tool.name)
    assert.ok(names.includes('echo'), 'echo listed: ' + names.join(','))
    const echoed = await servers.call(everything.server.id, 'echo', { message: 'مرحبا NAJD' })
    assert.match(echoed.text, /مرحبا NAJD/)
    if (names.includes('add')) assert.match((await servers.call(everything.server.id, 'add', { a: 2, b: 40 })).text, /42/)

    // server-filesystem: reads only inside the folder it was given.
    const files = await servers.add({ name: 'filesystem', command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', allowed] })
    assert.equal(files.status, 'added', JSON.stringify(files))
    await servers.connect(files.server.id)
    const two = await waitConnected(files.server.id)
    const fileTools = two.tools.map(tool => tool.name)
    const reader = ['read_text_file', 'read_file'].find(name => fileTools.includes(name))
    assert.ok(reader, 'a read tool is listed: ' + fileTools.join(','))
    assert.match((await servers.call(files.server.id, reader, { path: path.join(allowed, 'note.txt') })).text, /NAJD real MCP check ✓ عربي/)
    const outside = await servers.call(files.server.id, reader, { path: path.join(os.homedir(), 'NTUSER.DAT') })
    assert.equal(outside.isError, true, 'a path outside the allowed folder is refused')

    for (const item of await servers.list()) await servers.remove(item.id)
    assert.deepEqual(await servers.list(), [])
    console.log(`PASS: real MCP servers from npm through NAJD's client: server-everything (${names.length} tools, echo in Arabic${names.includes('add') ? ', add' : ''}); server-filesystem (${fileTools.length} tools, file read inside the allowed folder, outside refused); both removed.`)
  } finally { servers.stopAll(); for (const item of await servers.list().catch(() => [])) await servers.remove(item.id).catch(() => {}) }
}
main().then(() => process.exit(0), error => { console.error(error); process.exit(1) })
