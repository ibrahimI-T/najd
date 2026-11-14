import { describe, expect, it } from 'vitest'
import { focusFromTrace } from './useMemoryFocus'

describe('opening a used memory note from the session panel', () => {
  it('names the learned preference or lesson to highlight, from the trace id', () => {
    expect(focusFromTrace('preference:6f1c2a')).toEqual({ kind: 'preference', id: '6f1c2a' })
    expect(focusFromTrace('experience:abc:def')).toEqual({ kind: 'experience', id: 'abc:def' })
  })
  it('opens the page without a highlight for saved notes and earlier chats', () => {
    expect(focusFromTrace('note:42')).toBeNull()
    expect(focusFromTrace('chat:session-1:3')).toBeNull()
    expect(focusFromTrace('')).toBeNull()
  })
})
