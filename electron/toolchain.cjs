// NAJD's own Node toolchain for the agent's commands (owner request 2026-10-20: build websites on any computer).
// A folder with node.exe (a hard link to the bundled Node, or a copy when linking is not possible), npm.cmd and
// npx.cmd that run the npm shipped with the gateway. workspace-tools appends it to PATH, so a Node the user installed
// still comes first. Nothing outside this folder is changed.
const fs = require('node:fs'), fsp = require('node:fs/promises'), path = require('node:path')

async function sameFile(a, b) {
  const [x, y] = await Promise.all([fsp.stat(a).catch(() => null), fsp.stat(b).catch(() => null)])
  return !!x && !!y && x.size === y.size && (x.ino === y.ino && x.ino !== 0 || Math.abs(x.mtimeMs - y.mtimeMs) < 2000)
}

async function ensureToolchain({ directory, node, npmCli, npxCli }) {
  if (![directory, node, npmCli, npxCli].every(value => typeof value === 'string' && path.isAbsolute(value))) return null
  if (![node, npmCli, npxCli].every(file => fs.existsSync(file))) return null
  await fsp.mkdir(directory, { recursive: true })
  const target = path.join(directory, 'node.exe')
  if (!await sameFile(node, target)) {
    await fsp.rm(target, { force: true })
    try { await fsp.link(node, target) } catch { await fsp.copyFile(node, target); const { atime, mtime } = await fsp.stat(node); await fsp.utimes(target, atime, mtime) }
  }
  const shim = script => `@echo off\r\n"%~dp0node.exe" "${script}" %*\r\n`
  for (const [name, text] of [['npm.cmd', shim(npmCli)], ['npx.cmd', shim(npxCli)]]) {
    const file = path.join(directory, name)
    if ((await fsp.readFile(file, 'utf8').catch(() => '')) !== text) await fsp.writeFile(file, text)
  }
  return directory
}

module.exports = { ensureToolchain }
