// Backup model (after OpenClaw's model failover, docs/concepts/model-failover.md; owner request 2026-11-10 "make NAJD outstanding").
// When the chosen model fails before any tool ran (an outage, a timeout, a rate limit, a refusal, a local server that is down), the same
// request goes once to the backup model the owner picked, and the owner is told. A task that already ran a tool is never replayed:
// its effects may have happened, so the owner decides. Nothing secret is stored here: a provider id and a model name.
export type ModelRef = { provider: string; model: string }
export const FALLBACK_KEY = 'najd.fallback-model.v1'
export const FAILOVER_ERRORS = new Set(['PROVIDER_ERROR', 'PROVIDER_TIMEOUT', 'PROVIDER_RATE_LIMIT', 'PROVIDER_REJECTED', 'PROVIDER_BUSY', 'OLLAMA_UNAVAILABLE', 'MODEL_NOT_FOUND', 'INVALID_MODEL_OUTPUT', 'AUTH_REQUIRED', 'CREDENTIAL_UNAVAILABLE', 'PLAN_NOT_ENABLED', 'TOOLS_NOT_SUPPORTED'])

const valid = (value: unknown): value is ModelRef => !!value && typeof value === 'object' && typeof (value as ModelRef).provider === 'string' && /^[a-z0-9-]{1,40}$/.test((value as ModelRef).provider) &&
  typeof (value as ModelRef).model === 'string' && (value as ModelRef).model.length > 0 && (value as ModelRef).model.length <= 200

export function loadFallback(storage: Pick<Storage, 'getItem'>): ModelRef | null {
  try { const value = JSON.parse(storage.getItem(FALLBACK_KEY) || 'null'); return valid(value) ? { provider: value.provider, model: value.model } : null } catch { return null }
}
export function saveFallback(storage: Pick<Storage, 'setItem' | 'removeItem'>, value: ModelRef | null) {
  try { if (value && valid(value)) storage.setItem(FALLBACK_KEY, JSON.stringify({ provider: value.provider, model: value.model })); else storage.removeItem(FALLBACK_KEY) } catch { /* storage unavailable: no backup */ }
}

// The backup to use for a failed task, or null. Only a plain failure (not a cancel), with a recoverable error, before any tool finished
// or failed, on a model other than the backup itself, and only once per request.
export function failoverFor(task: { state: string; errorCode?: string | null; activity?: { events?: { type: string }[] } | null }, used: ModelRef, fallback: ModelRef | null, alreadyFailedOver: boolean): ModelRef | null {
  if (!fallback || alreadyFailedOver || task.state !== 'FAILED' || !FAILOVER_ERRORS.has(String(task.errorCode))) return null
  if (fallback.provider === used.provider && fallback.model === used.model) return null
  const events = task.activity?.events || []
  if (events.some(event => event.type === 'tool.completed' || event.type === 'tool.failed' || event.type === 'approval.requested' || event.type === 'task.unknown_effect')) return null
  return fallback
}
