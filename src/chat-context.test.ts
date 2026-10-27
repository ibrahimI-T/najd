import { describe, expect, it } from 'vitest'
import { buildModelHistory, selectChatAssetIds } from './chat-context'

describe('model context', () => {
  it('keeps explicitly reselected old files ahead of recent historical attachments', () => {
    const messages: NajdMessage[] = Array.from({ length: 12 }, (_, index) => ({ role: 'user', text: 'Question', createdAt: '', attachments: [{ id: `asset-${index}`, name: 'note.md' }] }))
    const ids = selectChatAssetIds(messages, [{ id: 'asset-0' }, { id: 'asset-new' }])
    expect(ids).toHaveLength(8)
    expect(ids.slice(0, 3)).toEqual(['asset-0', 'asset-new', 'asset-11'])
    expect(selectChatAssetIds(messages, []).slice(0, 2)).toEqual(['asset-11', 'asset-10'])
    expect(new Set(ids).size).toBe(ids.length)
  })
  it('keeps recent messages in order without storage metadata', () => {
    expect(buildModelHistory([
      { role: 'user', text: 'first', createdAt: '2026-01-01' },
      { role: 'assistant', text: 'reply', createdAt: '2026-01-02' },
      { role: 'user', text: 'second', createdAt: '2026-01-03' }
    ])).toEqual([
      { role: 'user', text: 'first' }, { role: 'assistant', text: 'reply' }, { role: 'user', text: 'second' }
    ])
  })

  it('keeps the whole conversation (the model window decides what fits, not a fixed cap)', () => {
    const history = buildModelHistory([
      { role: 'user', text: 'old'.repeat(1000), createdAt: '' },
      { role: 'assistant', text: 'a'.repeat(20000), createdAt: '' },
      { role: 'user', text: 'current'.repeat(700), createdAt: '' }
    ])
    expect(history.map(item => item.role)).toEqual(['user', 'assistant', 'user'])
    const many = Array.from({ length: 300 }, (_, index) => ({ role: index % 2 ? 'assistant' as const : 'user' as const, text: 'm' + index, createdAt: '' }))
    expect(buildModelHistory(many)).toHaveLength(300)
  })
})
