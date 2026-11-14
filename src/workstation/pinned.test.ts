import { describe, expect, it } from 'vitest'
import { PINNED_KEY, loadPinned, savePinned, togglePinned, withPinnedFirst } from './pinned'

describe('pinned conversations', () => {
  it('toggles, keeps pinning order and ignores bad ids', () => {
    let list = togglePinned([], 'a1')
    list = togglePinned(list, 'b2')
    expect(list).toEqual(['a1', 'b2'])
    expect(togglePinned(list, 'a1')).toEqual(['b2'])
    expect(togglePinned(list, 'bad id!')).toEqual(list)
  })
  it('puts pinned conversations first and skips deleted ones', () => {
    const items = [{ id: 'x' }, { id: 'b2' }, { id: 'y' }, { id: 'a1' }]
    expect(withPinnedFirst(items, ['a1', 'gone', 'b2']).map(item => item.id)).toEqual(['a1', 'b2', 'x', 'y'])
  })
  it('stores and reloads, rejecting damaged storage', () => {
    const map = new Map<string, string>()
    const storage = { getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => { map.set(key, value) } }
    savePinned(storage, ['a1', 'b2'])
    expect(loadPinned(storage)).toEqual(['a1', 'b2'])
    map.set(PINNED_KEY, '{oops')
    expect(loadPinned(storage)).toEqual([])
  })
})
