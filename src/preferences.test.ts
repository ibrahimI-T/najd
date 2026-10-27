import { describe, expect, it } from 'vitest'
import { parsePreferences, updatePreferences } from './preferences'

const base = { language: 'ar', theme: 'graphite', accent: '#2f8cff', fontScale: 1, design: 4 }

describe('preferences', () => {
  it('defaults to Arabic and the graphite night appearance when storage is empty', () => {
    expect(parsePreferences(null)).toEqual(base)
  })

  it('ignores unsupported stored values', () => {
    expect(parsePreferences('{"language":"fr","theme":"neon","accent":"bad"}')).toEqual(base)
  })

  it('changes one preference without losing the other', () => {
    expect(updatePreferences({ ...base, theme: 'dark', fontScale: 1.15 } as never, { language: 'en' })).toEqual({ ...base, language: 'en', theme: 'dark', fontScale: 1.15 })
  })

  it('restores a valid custom color from storage', () => {
    expect(parsePreferences('{"language":"en","theme":"light","accent":"#A14C9E"}')).toEqual({ ...base, language: 'en', theme: 'light', accent: '#a14c9e' })
  })

  it('migrates old settings without a color', () => {
    expect(parsePreferences('{"language":"en","theme":"system"}')).toEqual({ ...base, language: 'en', theme: 'system' })
  })

  it('moves earlier appearances to graphite once, then keeps any later choice', () => {
    expect(parsePreferences('{"language":"ar","theme":"dark"}').theme).toBe('graphite')
    expect(parsePreferences('{"language":"ar","theme":"dark","design":2}').theme).toBe('graphite')
    expect(parsePreferences('{"language":"ar","theme":"dark","design":4}').theme).toBe('dark')
    expect(parsePreferences('{"language":"ar","theme":"najd","design":2}').theme).toBe('graphite')
    expect(parsePreferences('{"language":"ar","theme":"dark","design":3}').theme).toBe('graphite')
    expect(parsePreferences('{"language":"ar","theme":"najd","design":4}').theme).toBe('najd')
  })

  it('restores the optional Desert Nights appearance', () => {
    expect(parsePreferences('{"language":"ar","theme":"navy","accent":"#467de7"}')).toEqual({ ...base, theme: 'navy', accent: '#467de7' })
  })

  it('restores only bounded supported interface sizes', () => {
    for (const fontScale of [1, 1.15, 1.25]) expect(parsePreferences(JSON.stringify({ fontScale })).fontScale).toBe(fontScale)
    for (const fontScale of [0, 9, -1, '1.25', null]) expect(parsePreferences(JSON.stringify({ fontScale })).fontScale).toBe(1)
  })
})
