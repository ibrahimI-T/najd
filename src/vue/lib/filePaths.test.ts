import { describe, expect, it } from 'vitest'
import { extensionOf, fileName, mentionedPaths } from './filePaths'

const B = '\\'
const p = (...parts: string[]) => parts.join(B)

describe('mentionedPaths', () => {
  it('finds file links, backticked paths with spaces and bare paths, once each', () => {
    const root = p('C:', 'Users', 'me', 'Documents', 'NAJD')
    const text = `Saved [the report](file:///C:/Users/me/Documents/NAJD/report%20final.docx). Also \`${p(root, 'my notes.md')}\` and ${p(root, 'data.csv')}, then ${p(root, 'data.csv')} again.`
    expect(mentionedPaths(text)).toEqual([p(root, 'report final.docx'), p(root, 'my notes.md'), p(root, 'data.csv')])
  })
  it('ignores folders, relative paths and URLs, and caps the list', () => {
    expect(mentionedPaths(`see ${p('C:', 'Users', 'me', 'Documents')} and ${p('docs', 'a.txt')} and https://x.com/a.html`)).toEqual([])
    const many = Array.from({ length: 12 }, (_, index) => p('C:', 'f', `${index}.txt`)).join(' ')
    expect(mentionedPaths(many)).toHaveLength(8)
  })
  it('names and extensions', () => {
    expect(fileName(p('C:', 'a', 'b', 'تقرير.PDF'))).toBe('تقرير.PDF')
    expect(extensionOf(p('C:', 'a', 'b', 'تقرير.PDF'))).toBe('pdf')
    expect(extensionOf(p('C:', 'a', 'README'))).toBe('')
  })
})
