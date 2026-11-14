// File paths a reply mentions, for the chat's file cards (owner request 2026-11-10): file:/// links, Windows paths in backticks
// (which may hold spaces) and bare Windows paths without spaces. Only absolute paths with an extension; at most `limit`, in order, no duplicates.
const BACKTICK = /`([A-Za-z]:\\[^`\r\n]+\.[A-Za-z0-9]{1,8})`/g
const BARE = /(?<![\w`])([A-Za-z]:\\(?:[^\\/:*?"<>|\s`]+\\)*[^\\/:*?"<>|\s`]+\.[A-Za-z0-9]{1,8})(?![\w\\])/g
const LINK = /\]\((file:\/\/\/[^)\s]+)\)/g

export function mentionedPaths(text: string, limit = 8): string[] {
  const found: string[] = []
  const add = (value: string) => {
    const clean = value.replace(/[.,;:،)]+$/, '')
    if (clean && !found.some(item => item.toLowerCase() === clean.toLowerCase())) found.push(clean)
  }
  for (const match of text.matchAll(LINK)) { try { add(decodeURIComponent(match[1].replace(/^file:\/\/\//i, '')).replace(/\//g, '\\')) } catch { /* a broken link is skipped */ } }
  for (const match of text.matchAll(BACKTICK)) add(match[1])
  for (const match of text.matchAll(BARE)) add(match[1])
  return found.slice(0, limit)
}

export const fileName = (filePath: string) => filePath.split(/[\\/]/).pop() || filePath
export const extensionOf = (filePath: string) => { const name = fileName(filePath); const dot = name.lastIndexOf('.'); return dot > 0 ? name.slice(dot + 1).toLowerCase() : '' }
