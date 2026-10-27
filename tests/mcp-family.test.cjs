// R14-003: stopping an MCP server ends the helper processes it started too, even when the server itself exits as
// soon as its stdin closes.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const { createMcpClient } = require('../electron/mcp-client.cjs')

test('a helper started by the server does not survive stop()', { skip: process.platform !== 'win32' }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'najd-mcp-family-'))
  const pidFile = path.join(dir, 'helper.pid')
  const helper = path.join(dir, 'helper.cjs'), server = path.join(dir, 'server.cjs')
  fs.writeFileSync(helper, 'setInterval(() => {}, 1000)\n')
  // A server that starts a long-lived helper, then exits the moment its stdin closes.
  fs.writeFileSync(server, `const { spawn } = require('node:child_process')
const child = spawn(process.execPath, [${JSON.stringify(helper)}], { stdio: 'ignore' })
require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(child.pid))
process.stdin.on('end', () => process.exit(0)); process.stdin.resume()
`)
  const client = createMcpClient({ command: process.execPath, args: [server], startTimeoutMs: 1000 })
  client.start().catch(() => {})
  for (let i = 0; i < 50 && !fs.existsSync(pidFile); i++) await new Promise(resolve => setTimeout(resolve, 100))
  const pid = Number(fs.readFileSync(pidFile, 'utf8'))
  client.stop()
  let alive = true
  for (let i = 0; i < 40 && alive; i++) { await new Promise(resolve => setTimeout(resolve, 150)); try { process.kill(pid, 0) } catch { alive = false } }
  if (alive) try { process.kill(pid) } catch {}
  assert.equal(alive, false, 'the helper was ended with its server')
})

test('I16-001: cancelling an install ends the installer and the helpers it started', { skip: process.platform !== 'win32' }, async () => {
  const { defaultRun } = require('../electron/extensions.cjs')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'najd-installer-family-'))
  const pidFile = path.join(dir, 'helper.pid')
  const helper = path.join(dir, 'helper.cjs'), installer = path.join(dir, 'installer.cjs')
  fs.writeFileSync(helper, 'setInterval(() => {}, 1000)\n')
  fs.writeFileSync(installer, `const { spawn } = require('node:child_process')
const child = spawn(process.execPath, [${JSON.stringify(helper)}], { stdio: 'ignore' })
require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(child.pid))
setInterval(() => {}, 1000)
`)
  const controller = new AbortController()
  const running = defaultRun(process.execPath, [installer], { signal: controller.signal })
  for (let i = 0; i < 50 && !fs.existsSync(pidFile); i++) await new Promise(resolve => setTimeout(resolve, 100))
  const pid = Number(fs.readFileSync(pidFile, 'utf8'))
  controller.abort()
  await assert.rejects(running, { code: 'CANCELLED' })
  let alive = true
  for (let i = 0; i < 40 && alive; i++) { try { process.kill(pid, 0); await new Promise(resolve => setTimeout(resolve, 150)) } catch { alive = false } }
  if (alive) try { process.kill(pid) } catch {}
  assert.equal(alive, false, 'the helper ended with the cancelled installer')
})
