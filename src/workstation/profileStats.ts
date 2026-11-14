// Days together, conversation count and streak from saved conversations, shared by both renderers.
const DAY = 86400000
const dayKey = (time: number) => new Date(time).toISOString().slice(0, 10)

export function activityStats(sessions: { updatedAt: string; createdAt?: string }[], now = Date.now()) {
  const days = new Map<string, number>()
  let first = now
  for (const session of sessions) {
    const time = Date.parse(session.updatedAt)
    if (!Number.isFinite(time)) continue
    first = Math.min(first, Date.parse(session.createdAt || session.updatedAt) || time)
    days.set(dayKey(time), (days.get(dayKey(time)) || 0) + 1)
  }
  let streak = 0
  for (let time = now; days.has(dayKey(time)); time -= DAY) streak++
  return { days, together: sessions.length ? Math.max(1, Math.ceil((now - first) / DAY)) : 0, conversations: sessions.length, streak }
}
