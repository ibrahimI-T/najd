import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const harness = vi.hoisted(() => ({ effects: [] as (() => unknown)[] }))
vi.mock('react', () => ({
  useRef: (value: unknown) => ({ current: value }),
  useEffect: (effect: () => unknown) => { harness.effects.push(effect) }
}))
import { useVisibleInterval } from './useVisibleInterval'

let visibility: 'visible' | 'hidden' = 'visible'
const listeners = new Set<() => void>()
beforeEach(() => {
  vi.useFakeTimers()
  harness.effects = []; listeners.clear(); visibility = 'visible'
  vi.stubGlobal('window', { setInterval, clearInterval })
  vi.stubGlobal('document', {
    get visibilityState() { return visibility },
    addEventListener: (type: string, fn: () => void) => { if (type === 'visibilitychange') listeners.add(fn) },
    removeEventListener: (type: string, fn: () => void) => { if (type === 'visibilitychange') listeners.delete(fn) }
  })
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })
const setVisibility = (value: 'visible' | 'hidden') => { visibility = value; for (const fn of [...listeners]) fn() }
function mount(callback: () => void, ms: number, enabled = true) {
  useVisibleInterval(callback, ms, enabled)
  return harness.effects.map(effect => effect()).find(value => typeof value === 'function') as (() => void) | undefined
}

it('polls only while visible, refreshes once when shown again, and stops on unmount', () => {
  const calls: number[] = []
  const unmount = mount(() => calls.push(Date.now()), 1000)!
  vi.advanceTimersByTime(3000)
  expect(calls.length).toBe(3)
  setVisibility('hidden')
  vi.advanceTimersByTime(10000)
  expect(calls.length).toBe(3) // no polling while hidden or minimized
  setVisibility('visible')
  expect(calls.length).toBe(4) // immediate refresh on return
  vi.advanceTimersByTime(2000)
  expect(calls.length).toBe(6)
  unmount()
  vi.advanceTimersByTime(5000)
  expect(calls.length).toBe(6)
  expect(listeners.size).toBe(0)
})

it('does not start when created hidden, and does nothing while disabled', () => {
  visibility = 'hidden'
  let count = 0
  mount(() => count++, 500)
  vi.advanceTimersByTime(5000)
  expect(count).toBe(0)
  harness.effects = []; visibility = 'visible'
  let disabled = 0
  expect(mount(() => disabled++, 500, false)).toBeUndefined()
  vi.advanceTimersByTime(5000)
  expect(disabled).toBe(0)
})

it('also pauses when the main process reports the window minimized while the page still says visible', () => {
  let hidden = false
  const windowListeners = new Set<() => void>()
  vi.stubGlobal('window', { setInterval, clearInterval, najdWindow: {
    isHidden: () => hidden,
    onHiddenChange: (fn: () => void) => { windowListeners.add(fn); return () => windowListeners.delete(fn) }
  } })
  const setHidden = (value: boolean) => { hidden = value; for (const fn of [...windowListeners]) fn() }
  let count = 0
  const unmount = mount(() => count++, 1000)!
  vi.advanceTimersByTime(2000)
  expect(count).toBe(2)
  setHidden(true) // minimized; document.visibilityState stays "visible"
  vi.advanceTimersByTime(10000)
  expect(count).toBe(2)
  setHidden(false)
  expect(count).toBe(3) // one immediate refresh
  setVisibility('visible') // a redundant signal must not refresh twice or start a second timer
  expect(count).toBe(3)
  vi.advanceTimersByTime(1000)
  expect(count).toBe(4)
  unmount()
  expect(windowListeners.size).toBe(0)
})
