import { describe, expect, it } from 'vitest'
import { filePathOf } from './ChatBlocks'

describe('a block that is only a file path', () => {
  it('is recognised as a path to open, not code to save', () => {
    expect(filePathOf('C:\\Users\\me\\Documents\\NAJD\\site\\index.html\n')).toBe('C:\\Users\\me\\Documents\\NAJD\\site\\index.html')
    expect(filePathOf('D:\\work\\report final.pdf')).toBe('D:\\work\\report final.pdf')
  })
  it('code, several lines, relative or network paths are not', () => {
    for (const text of ['const a = 1', 'C:\\a.txt\nC:\\b.txt', 'site\\index.html', '\\\\server\\share\\a.html', 'C:\\a<b>.html', 'https://example.com']) expect(filePathOf(text)).toBeNull()
  })
})
