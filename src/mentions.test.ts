import { describe, expect, it } from 'vitest'
import { activeMentions, filterMentionable, insertMention, mentionQuery, referenceBlock } from './mentions'

describe('chat mentions', () => {
  it('opens on an @ word at the end of the message only', () => {
    expect(mentionQuery('@')).toBe('')
    expect(mentionQuery('كمل من @مطع')).toBe('مطع')
    expect(mentionQuery('email me@x.com')).toBe(null)
    expect(mentionQuery('@done ')).toBe(null)
  })
  it('lists earlier chats by title, never the current one', () => {
    const sessions = [{ id: 'a', title: 'Restaurant site' }, { id: 'b', title: 'Budget' }, { id: 'c', title: '' }]
    expect(filterMentionable(sessions, 'rest', null).map(item => item.id)).toEqual(['a'])
    expect(filterMentionable(sessions, '', 'a').map(item => item.id)).toEqual(['b'])
  })
  it('inserts the title and keeps only mentions still in the text', () => {
    const text = insertMention('continue @Res', 'Restaurant site')
    expect(text).toBe('continue @Restaurant site ')
    expect(activeMentions(text, [{ id: 'a', title: 'Restaurant site' }, { id: 'b', title: 'Budget' }])).toEqual([{ id: 'a', title: 'Restaurant site' }])
  })
  it('quotes the newest messages within a bound, marked as data', () => {
    const messages = Array.from({ length: 40 }, (_, index) => ({ role: index % 2 ? 'assistant' : 'user', text: 'message ' + index + ' ' + 'x'.repeat(300) }))
    const block = referenceBlock([{ title: 'Restaurant site', messages }])!
    expect(block).toMatch(/^NAJD_REFERENCED_CHATS/)
    expect(block).toContain('message 39'); expect(block).not.toContain('message 0 ')
    expect(block.length).toBeLessThan(13000)
    expect(referenceBlock([{ title: 'empty', messages: [] }])).toBe(null)
  })
})
