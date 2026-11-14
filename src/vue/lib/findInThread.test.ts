import { describe, expect, it } from 'vitest'
import { matchOffsets } from './findInThread'

describe('find in conversation', () => {
  it('finds every match, ignoring case and Arabic diacritics, with offsets in the original text', () => {
    const text = 'مُحَمَّد قال: Hello NAJD, hello again. محمد'
    const arabic = matchOffsets(text, 'محمد')
    expect(arabic).toHaveLength(2)
    expect(text.slice(...arabic[0])).toBe('مُحَمَّد')
    expect(text.slice(...arabic[1])).toBe('محمد')
    const latin = matchOffsets(text, 'HELLO')
    expect(latin.map(range => text.slice(...range))).toEqual(['Hello', 'hello'])
  })
  it('returns nothing for an empty query or no match', () => {
    expect(matchOffsets('abc', '  ')).toEqual([])
    expect(matchOffsets('abc', 'z')).toEqual([])
  })
})
