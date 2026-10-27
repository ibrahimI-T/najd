import { beforeEach, expect, it, vi } from 'vitest'

const harness = vi.hoisted(() => ({ states: [] as unknown[], cursor: 0, effects: [] as (() => unknown)[], storage: new Map<string, string>() }))
vi.mock('react', () => ({
  useState: (initial: unknown) => {
    const index = harness.cursor++
    if (!(index in harness.states)) harness.states[index] = typeof initial === 'function' ? initial() : initial
    return [harness.states[index], (value: unknown) => { harness.states[index] = typeof value === 'function' ? value(harness.states[index]) : value }]
  },
  useRef: (value: unknown) => ({ current: value }),
  useCallback: (callback: unknown) => callback,
  useEffect: (effect: () => unknown) => { harness.effects.push(effect) }
}))
import { useProviders } from './useProviders'

function render() {
  harness.cursor = 0
  harness.effects = []
  const result = useProviders('')
  const cleanup = harness.effects.map(effect => effect()).filter(value => typeof value === 'function') as (() => void)[]
  cleanup.forEach(stop => stop())
  return result
}
beforeEach(() => {
  harness.states = []
  harness.storage.clear()
  harness.storage.set('najd.provider.v1', 'chatgpt')
  harness.storage.set('najd.models.v2', JSON.stringify({ chatgpt: 'test-model' }))
  harness.storage.set('najd.effort.v1', 'high')
  vi.stubGlobal('localStorage', { getItem: (key: string) => harness.storage.get(key) ?? null, setItem: (key: string, value: string) => harness.storage.set(key, value) })
  vi.stubGlobal('window', { setInterval, clearInterval, setTimeout, clearTimeout })
  // Polling now follows page visibility (useVisibleInterval); a visible page is the normal case here.
  vi.stubGlobal('document', { visibilityState: 'visible', addEventListener: () => {}, removeEventListener: () => {} })
})

it('retains saved effort until the model catalog has loaded successfully', () => {
  render()
  expect(render().effort).toBe('high')
  expect(harness.storage.get('najd.effort.v1')).toBe('high')
  harness.states[2] = { chatgpt: [{ id: 'test-model', efforts: ['high'] }] }
  expect(render().effort).toBe('high')
  expect(render().effort).toBe('high')
})

it('resets unsupported effort only after a successful model load', () => {
  harness.states = []
  render()
  harness.states[2] = { chatgpt: [{ id: 'test-model', efforts: ['low'] }] }
  render()
  expect(render().effort).toBe('auto')
})

it('preserves saved effort during a failed catalog load', () => {
  render()
  harness.states[2] = { chatgpt: [] }
  harness.states[7] = { chatgpt: true }
  render()
  expect(render().effort).toBe('high')
})
