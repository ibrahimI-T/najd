// MCP servers that a package declares. Two kinds are kept (owner decision 2026-11-13: MCP servers of every kind are allowed):
//   - remote: a public HTTPS address (no credentials, no query string); a token is typed by the owner and sealed in the server store.
//   - stdio: a command, its arguments and the NAMES of the environment variables it wants (never their values).
// Declaring is not running. A declared server is added only when the owner presses its button, and adding always goes through
// NAJD's native confirmation of the exact command line, folder and secret names (mcp-servers.cjs add without approvedInChat), which
// a renderer cannot skip. Nothing a package declares starts by itself.
const { remoteUrl } = require('../mcp-http-client.cjs')

const text = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : ''

function mcpDeclarations(raw) {
  return Object.entries(raw && typeof raw === 'object' ? raw : {}).slice(0, 32).flatMap(([name, value]) => {
    if (!/^[a-zA-Z0-9_.-]{1,64}$/.test(name)) return []
    if (typeof value?.command === 'string' && text(value.command, 200)) {
      const args = (Array.isArray(value.args) ? value.args : []).filter(arg => typeof arg === 'string').slice(0, 30).map(arg => arg.slice(0, 300))
      const envNames = Object.keys(value.env && typeof value.env === 'object' ? value.env : {}).filter(key => /^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(key)).slice(0, 30)
      return [{ name, kind: 'stdio', command: text(value.command, 200), args, envNames }]
    }
    try { const url = remoteUrl(value?.url); if (new URL(url).search) return []; return [{ name, url }] } catch { return [] }
  })
}

// The line the owner is shown for a declaration, the same text NAJD's confirmation dialog shows.
const quote = arg => /\s/.test(arg) ? '"' + arg + '"' : arg
const declarationLine = declaration => declaration.kind === 'stdio' ? [declaration.command, ...declaration.args.map(quote)].join(' ') : declaration.url

// Adds (after the owner's native confirmation for a command) and connects one server a package declares, owned by that package so
// disabling, enabling and removing the package follow it. `servers` is NAJD's MCP server manager.
async function connectPackageServer({ pack, name, token, servers }) {
  const declaration = pack?.mcpServers?.find(item => item.name === name)
  if (!pack?.enabled || !declaration || !servers) throw Object.assign(new Error('PACKAGE_NOT_READY'), { code: 'PACKAGE_NOT_READY' })
  const owned = (await servers.list()).filter(item => item.ownerPackage === pack.id)
  if (declaration.kind === 'stdio') {
    // Env values are never copied from anywhere: a server that needs a secret gets it from the owner in Settings > MCP.
    const existing = owned.find(item => item.name === declaration.name)
    if (existing) return servers.connect(existing.id)
    const result = await servers.add({ name: declaration.name, command: declaration.command, args: declaration.args, env: {} }, { ownerPackage: pack.id })
    return result.server ? servers.connect(result.server.id) : result
  }
  // A token the owner pastes goes only to the protected server store (as MCP_TOKEN); a new token replaces the owned server row.
  const existing = owned.find(item => item.commandLine === declaration.url)
  const secret = typeof token === 'string' && token.trim() ? token.trim().slice(0, 4096) : ''
  if (existing && !secret) return servers.connect(existing.id)
  if (existing) await servers.remove(existing.id)
  const result = await servers.add({ name: declaration.name, url: declaration.url, env: secret ? { MCP_TOKEN: secret } : {} }, { ownerPackage: pack.id })
  return result.server ? servers.connect(result.server.id) : result
}

// After an update or a rollback a package's own servers follow its declarations: an owned server the new version no longer
// declares is removed. Manual servers (no owner package) are never touched.
async function reconcilePackageServers({ pack, servers }) {
  const declared = pack?.mcpServers || []
  const lines = new Set(declared.filter(item => item.kind !== 'stdio').map(item => item.url))
  const names = new Set(declared.filter(item => item.kind === 'stdio').map(item => item.name))
  for (const server of (await servers.list()).filter(item => item.ownerPackage === pack?.id && !lines.has(item.commandLine) && !names.has(item.name))) await servers.remove(server.id)
}

module.exports = { mcpDeclarations, declarationLine, connectPackageServer, reconcilePackageServers }
