// Two NAJD extensions only conflict when they live in the same browser (the old 1.x next to 2.x) or when a connected extension is a 1.x.
// Chrome and Edge each running 2.x is the normal setup and must not raise the warning.
type Link = { name?: string | null; version?: string | null; connected?: boolean }
export function extensionsConflict(links: Link[]): boolean {
  const live = links.filter(link => link.connected)
  if (live.some(link => !link.version || /^1\./.test(link.version))) return true
  const names = live.map(link => String(link.name || '').toLowerCase())
  return new Set(names).size < names.length
}
