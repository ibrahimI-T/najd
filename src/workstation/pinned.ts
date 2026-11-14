// Pinned conversations (owner request 2026-11-10: keep developing NAJD; pinning as in the reference apps). Ids only, in this
// computer's storage; a pinned conversation stays at the top of the list in the order it was pinned. At most 20.
export const PINNED_KEY = 'najd.pinned-chats.v1'
const MAX = 20
const validId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9-]{1,80}$/.test(value)

export function loadPinned(storage: Pick<Storage, 'getItem'>): string[] {
  try { const value = JSON.parse(storage.getItem(PINNED_KEY) || '[]'); return Array.isArray(value) ? [...new Set(value.filter(validId))].slice(0, MAX) : [] } catch { return [] }
}
export function togglePinned(list: string[], id: string): string[] {
  if (!validId(id)) return list
  return list.includes(id) ? list.filter(item => item !== id) : [...list, id].slice(-MAX)
}
export function savePinned(storage: Pick<Storage, 'setItem'>, list: string[]) { try { storage.setItem(PINNED_KEY, JSON.stringify(list.slice(0, MAX))) } catch { /* storage unavailable */ } }
// Pinned first (in pinning order), then the rest in their own order; ids of deleted conversations are ignored.
export function withPinnedFirst<T extends { id: string }>(items: T[], pinned: string[]): T[] {
  const byId = new Map(items.map(item => [item.id, item]))
  const top = pinned.map(id => byId.get(id)).filter((item): item is T => !!item)
  return [...top, ...items.filter(item => !pinned.includes(item.id))]
}
