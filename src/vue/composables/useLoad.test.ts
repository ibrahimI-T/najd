import { afterEach, describe, expect, it, vi } from 'vitest'
// The real preferences need the browser (localStorage, matchMedia); the action only reads the language.
vi.mock('./usePrefs', () => ({ usePrefs: () => ({ prefs: { language: 'en' } }) }))
import { useLoad } from './useLoad'
import { useToasts } from './useToast'

// useLoad runs outside a component here (onMounted only warns), with no value to read.
describe('useLoad actions (UI crawl 2026-11-09: a slow action looked dead)', () => {
  afterEach(() => { vi.useRealTimers() })

  it('a slow action says at once that it is working, then shows its result and removes the notice', async () => {
    vi.useFakeTimers()
    const toasts = useToasts()
    const action = useLoad(undefined)
    let finish: () => void = () => {}
    const running = action.run(() => new Promise<void>(resolve => { finish = resolve }), 'Engine stopped.')
    expect(action.busy.value).toBe(true)
    await vi.advanceTimersByTimeAsync(800)
    expect(toasts.items.some(item => item.tone === 'info')).toBe(true)
    finish(); await running
    expect(action.busy.value).toBe(false)
    expect(toasts.items.some(item => item.tone === 'info')).toBe(false)
    expect(toasts.items.at(-1)?.text).toBe('Engine stopped.')
  })

  it('a quick action shows only its result', async () => {
    vi.useFakeTimers()
    const toasts = useToasts()
    const before = toasts.items.filter(item => item.tone === 'info').length
    await useLoad(undefined).run(async () => {}, 'Saved.')
    await vi.advanceTimersByTimeAsync(800)
    expect(toasts.items.filter(item => item.tone === 'info').length).toBe(before)
  })
})
