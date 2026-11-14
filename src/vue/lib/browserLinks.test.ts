import { describe, expect, it } from 'vitest'
import { extensionsConflict } from './browserLinks'

describe('extension conflict warning', () => {
  it('stays quiet for Chrome and Edge each running 2.x, or for one browser', () => {
    expect(extensionsConflict([{ name: 'Google Chrome', version: '2.1.0', connected: true }, { name: 'Microsoft Edge', version: '2.1.0', connected: true }])).toBe(false)
    expect(extensionsConflict([{ name: 'Google Chrome', version: '2.1.0', connected: true }])).toBe(false)
    expect(extensionsConflict([])).toBe(false)
  })
  it('ignores links that are not connected', () => {
    expect(extensionsConflict([{ name: 'Google Chrome', connected: false }, { name: 'Google Chrome', version: '2.1.0', connected: true }])).toBe(false)
  })
  it('warns for a connected 1.x, a connected link without a version, or two connected links in the same browser', () => {
    expect(extensionsConflict([{ name: 'Google Chrome', version: '1.0.0', connected: true }])).toBe(true)
    expect(extensionsConflict([{ name: 'Microsoft Edge', connected: true }])).toBe(true)
    expect(extensionsConflict([{ name: 'Google Chrome', version: '2.1.0', connected: true }, { name: 'Google Chrome', version: '2.1.0', connected: true }])).toBe(true)
  })
})
