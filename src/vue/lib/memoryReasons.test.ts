import { describe, expect, it } from 'vitest'
import { reasonOf, traceFor } from './memoryReasons'

const trace = (at: string, titles: string[]): NajdMemoryTrace => ({ id: 1, at, session_id: 's1', engine: 'graph', budget_tokens: 100, tokens: 10, ms: 1, query_len: 5,
  items: titles.map((title, index) => ({ id: 'note:' + index, kind: 'note', source: 'notes', title, reason: 'matches the request', score: 1, tokens: 3 })) })
const message = (role: 'user' | 'assistant', at: string): NajdMessage => ({ role, text: role, createdAt: at })

describe('memory used per answer', () => {
  it('matches an answer to the trace recorded between its question and itself', () => {
    const messages = [message('user', '2026-11-13T10:00:00.000Z'), message('assistant', '2026-11-13T10:00:05.000Z'), message('user', '2026-11-13T10:05:00.000Z'), message('assistant', '2026-11-13T10:05:09.000Z')]
    const traces = [trace('2026-11-13T10:05:01.000Z', ['Second']), trace('2026-11-13T10:00:01.000Z', ['First'])]
    expect(traceFor(traces, messages, 1)?.items[0].title).toBe('First')
    expect(traceFor(traces, messages, 3)?.items[0].title).toBe('Second')
  })
  it('gives nothing for a user message, for an answer without a trace, or for a message without a valid time', () => {
    const messages = [message('user', '2026-11-13T10:00:00.000Z'), message('assistant', '2026-11-13T10:00:05.000Z')]
    expect(traceFor([trace('2026-11-13T10:00:01.000Z', ['x'])], messages, 0)).toBeNull()
    expect(traceFor([trace('2026-11-13T09:00:00.000Z', ['old'])], messages, 1)).toBeNull()
    expect(traceFor([trace('2026-11-13T10:00:01.000Z', ['x'])], [message('user', 'bad'), message('assistant', 'bad')], 1)).toBeNull()
  })
  it('says why in the interface language and passes an unknown reason through', () => {
    expect(reasonOf('newest preference (always shared)', true)).toBe('أحدث تفضيل (يُشارك دائماً)')
    expect(reasonOf('newest preference (always shared)', false)).toBe('Newest preference (always shared)')
    expect(reasonOf('something new', true)).toBe('something new')
  })
})
