// Why a memory note entered a request, in the owner's language (the reasons NAJD's retrieval records, electron/memory-service.cjs).
const REASONS: Record<string, [string, string]> = {
  'matches the request': ['يطابق الطلب', 'Matches the request'],
  'names a file or person in the request': ['يذكر ملفاً أو شخصاً في الطلب', 'Names a file or person in the request'],
  'linked to a matching memory': ['مرتبط بملاحظة مطابقة', 'Linked to a matching note'],
  'newest preference (always shared)': ['أحدث تفضيل (يُشارك دائماً)', 'Newest preference (always shared)'],
  'earlier conversation matches the request': ['محادثة سابقة تطابق الطلب', 'An earlier conversation matches the request']
}
export const reasonOf = (reason: string, arabic: boolean) => { const known = REASONS[reason]; return known ? known[arabic ? 0 : 1] : reason }

// The memory trace of one answer: the latest trace of the conversation recorded between the user's message and the answer.
export function traceFor(traces: NajdMemoryTrace[], messages: NajdMessage[], index: number): NajdMemoryTrace | null {
  const message = messages[index]
  if (!message || message.role !== 'assistant') return null
  const end = Date.parse(message.createdAt)
  const before = messages.slice(0, index).reverse().find(item => item.role === 'user')
  const start = before ? Date.parse(before.createdAt) : 0
  if (!Number.isFinite(end)) return null
  return traces.find(row => { const at = Date.parse(row.at); return at >= start - 2000 && at <= end + 2000 }) || null
}
