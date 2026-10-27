import { describe, expect, it } from 'vitest'
import { accessibleAccent, contrastRatio } from './color'

describe('accent color', () => {
  it('keeps standard readable text above AA contrast in the supported themes', () => {
    for (const [background, text, muted, subtle] of [
      ['#171717', '#f3f3f3', '#b7b7b7', '#929292'],
      ['#ffffff', '#1f1f1f', '#555555', '#696969'],
      ['#0b1324', '#edf3ff', '#a6b5d0', '#8395b5']
    ]) for (const foreground of [text, muted, subtle]) expect(contrastRatio(foreground, background)).toBeGreaterThanOrEqual(4.5)
  })
  it('keeps the royal blue visible on charcoal and light surfaces', () => {
    expect(contrastRatio(accessibleAccent('#467de7', 'dark'), '#171717')).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(accessibleAccent('#467de7', 'light'), '#ffffff')).toBeGreaterThanOrEqual(4.5)
  })

  it('adjusts extreme chosen colors so controls stay readable', () => {
    expect(contrastRatio(accessibleAccent('#000000', 'dark'), '#171717')).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(accessibleAccent('#ffffff', 'light'), '#ffffff')).toBeGreaterThanOrEqual(4.5)
  })

  it('keeps a custom accent readable on optional navy appearance', () => {
    expect(contrastRatio(accessibleAccent('#467de7', 'navy'), '#0b1324')).toBeGreaterThanOrEqual(4.5)
  })
})
