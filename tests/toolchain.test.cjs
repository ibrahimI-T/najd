// NAJD's own node/npm/npx for the agent's commands work on a PATH that has no Node of its own.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), { execFileSync } = require('node:child_process')
const { ensureToolchain } = require('../electron/toolchain.cjs')

const runtimes = path.join(__dirname, '..', '.runtimes')
const inputs = {
  node: path.join(runtimes, 'node-v24.21.0-win-x64', 'node.exe'),
  npmCli: path.join(runtimes, 'openclaw-runtime-2026.10.3', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  npxCli: path.join(runtimes, 'openclaw-runtime-2026.10.3', 'node_modules', 'npm', 'bin', 'npx-cli.js')
}

test('missing inputs give no toolchain', async () => {
  assert.equal(await ensureToolchain({ directory: path.join(os.tmpdir(), 'x'), node: 'relative', npmCli: inputs.npmCli, npxCli: inputs.npxCli }), null)
  assert.equal(await ensureToolchain({ directory: path.join(os.tmpdir(), 'x'), node: path.join(os.tmpdir(), 'no-node.exe'), npmCli: inputs.npmCli, npxCli: inputs.npxCli }), null)
})

test('node, npm and npx run from the toolchain folder on a PATH without Node, and setup is idempotent', { skip: !Object.values(inputs).every(file => fs.existsSync(file)) || process.platform !== 'win32' }, async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'najd-toolchain-'))
  const directory = path.join(home, 'bin')
  assert.equal(await ensureToolchain({ directory, ...inputs }), directory)
  const before = fs.statSync(path.join(directory, 'node.exe')).mtimeMs
  assert.equal(await ensureToolchain({ directory, ...inputs }), directory)
  assert.equal(fs.statSync(path.join(directory, 'node.exe')).mtimeMs, before)
  const system = path.join(process.env.SystemRoot, 'System32')
  const env = { SystemRoot: process.env.SystemRoot, PATHEXT: process.env.PATHEXT, ComSpec: process.env.ComSpec, Path: [system, path.join(system, 'WindowsPowerShell', 'v1.0'), directory].join(';'),
    TEMP: home, TMP: home, APPDATA: home, LOCALAPPDATA: home, USERPROFILE: home }
  const out = execFileSync(path.join(system, 'WindowsPowerShell', 'v1.0', 'powershell.exe'), ['-NoProfile', '-NonInteractive', '-Command',
    'node -v; npm -v; npx -v; (Get-Command node).Source'], { env, encoding: 'utf8', timeout: 60000 }).trim().split(/\r?\n/)
  assert.equal(out[0], 'v24.21.0')
  assert.match(out[1], /^\d+\.\d+\.\d+$/); assert.match(out[2], /^\d+\.\d+\.\d+$/)
  assert.equal(path.resolve(out[3]), path.join(directory, 'node.exe'))
})
