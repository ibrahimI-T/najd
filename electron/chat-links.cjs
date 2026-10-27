// Links the user clicks in a chat. Web addresses open in the default browser; a file link opens only for a web page, picture or document that really lies
// inside the NAJD workspace folder (symbolic links resolved), so a link can never launch a program or reach another folder.
const fs = require('node:fs/promises')
const path = require('node:path')
const OPENABLE = /\.(html?|pdf|png|jpe?g|gif|webp|svg|mp4|webm|txt|md|csv)$/i

// The real path of a file inside the workspace, or null.
async function insideWorkspace(target, workspaceRoot) {
  const real = await fs.realpath(path.resolve(target)).catch(() => null)
  const root = await fs.realpath(workspaceRoot).catch(() => null)
  if (!real || !root || !real.toLowerCase().startsWith(root.toLowerCase() + path.sep)) return null
  return real
}

function createChatLinkOpener({ shell, workspaceRoot }) {
  return async function openChatLink(url) {
    let parsed
    try { parsed = new URL(url) } catch { return false }
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') { await shell.openExternal(parsed.href); return true }
    if (parsed.protocol !== 'file:' || parsed.host) return false
    let target
    try { target = decodeURIComponent(parsed.pathname).replace(/^\/([A-Za-z]:)/, '$1') } catch { return false }
    return openWorkspaceFile({ shell, workspaceRoot }, target, 'open')
  }
}

// A file path written in a reply: "open" under the same rules as a file link; "reveal" shows any workspace file in Explorer without opening it.
async function openWorkspaceFile({ shell, workspaceRoot }, target, mode) {
  if (typeof target !== 'string' || !path.isAbsolute(target)) return false
  const real = await insideWorkspace(target, workspaceRoot)
  if (!real) return false
  if (mode === 'reveal') { shell.showItemInFolder(real); return true }
  if (!OPENABLE.test(real)) return false
  await shell.openPath(real)
  return true
}
module.exports = { createChatLinkOpener, openWorkspaceFile }
