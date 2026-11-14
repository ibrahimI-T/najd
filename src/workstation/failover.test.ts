import { describe, expect, it } from 'vitest'
import { FALLBACK_KEY, failoverFor, loadFallback, saveFallback } from './failover'

const memory = () => { const map = new Map<string, string>(); return { getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => { map.set(key, value) }, removeItem: (key: string) => { map.delete(key) } } }
const used = { provider: 'openai-compatible', model: 'qwen3:32b' }
const backup = { provider: 'chatgpt', model: 'gpt-5.6-luna' }
const failed = (errorCode: string, events: { type: string }[] = [{ type: 'task.started' }, { type: 'task.failed' }]) => ({ state: 'FAILED', errorCode, activity: { events } })

describe('backup model (failover)', () => {
  it('stores only a valid provider and model, and clears', () => {
    const storage = memory()
    saveFallback(storage, backup)
    expect(loadFallback(storage)).toEqual(backup)
    storage.setItem(FALLBACK_KEY, JSON.stringify({ provider: 'Bad Id!', model: 'x' }))
    expect(loadFallback(storage)).toBeNull()
    saveFallback(storage, null)
    expect(loadFallback(storage)).toBeNull()
  })
  it('switches once for a recoverable failure before any tool ran', () => {
    expect(failoverFor(failed('PROVIDER_REJECTED'), used, backup, false)).toEqual(backup)
    expect(failoverFor(failed('PROVIDER_TIMEOUT'), used, backup, false)).toEqual(backup)
    expect(failoverFor(failed('PROVIDER_REJECTED'), used, backup, true)).toBeNull()
  })
  it('never replays a task that ran or asked to run a tool, a cancel, a policy limit, or the backup itself', () => {
    expect(failoverFor(failed('PROVIDER_ERROR', [{ type: 'tool.started' }, { type: 'tool.completed' }]), used, backup, false)).toBeNull()
    expect(failoverFor(failed('PROVIDER_ERROR', [{ type: 'tool.failed' }]), used, backup, false)).toBeNull()
    expect(failoverFor(failed('PROVIDER_ERROR', [{ type: 'approval.requested' }]), used, backup, false)).toBeNull()
    expect(failoverFor({ state: 'CANCELLED', errorCode: 'CANCELLED' }, used, backup, false)).toBeNull()
    expect(failoverFor(failed('BUDGET_EXCEEDED'), used, backup, false)).toBeNull()
    expect(failoverFor(failed('CONTEXT_LIMIT'), used, backup, false)).toBeNull()
    expect(failoverFor(failed('PROVIDER_ERROR'), backup, backup, false)).toBeNull()
    expect(failoverFor(failed('PROVIDER_ERROR'), used, null, false)).toBeNull()
  })
})
