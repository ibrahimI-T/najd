import { expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { AccessModeMenu, enforcedAccessModes, normalizeAccessMode } from './AccessMode'
import { getCopy } from './copy'

it('renders every access option with a description in both languages', () => {
  for (const t of [getCopy('ar'), getCopy('en')]) {
    const html = renderToStaticMarkup(<AccessModeMenu mode="ask" disabled={false} t={t} onSelect={() => { }} />)
    expect(html).toContain('access-menu')
    expect(html).toContain(t.accessPrompt)
    for (const id of ['ask', 'approve', 'full']) expect(html).toContain(`data-access="${id}"`)
    for (const text of [t.accessAsk, t.accessApprove, t.accessFull, t.accessAskDesc, t.accessApproveDesc, t.accessFullDesc])
      expect(html).toContain(text)
  }
})

it('offers all three core-enforced modes', () => {
  const t = getCopy('en')
  const html = renderToStaticMarkup(<AccessModeMenu mode="ask" disabled={false} t={t} onSelect={() => { }} />)
  expect(enforcedAccessModes).toEqual(['ask', 'approve', 'full'])
  for (const mode of ['ask', 'approve', 'full']) expect(html).not.toMatch(new RegExp('data-access="' + mode + '"[^>]*disabled'))
  expect((html.match(new RegExp(t.planned, 'g')) || []).length).toBe(0)
  expect(html).toContain('aria-pressed="true"')
})

it('restores the three modes and falls back to ask for anything else', () => {
  expect(normalizeAccessMode('ask')).toBe('ask')
  expect(normalizeAccessMode('approve')).toBe('approve')
  expect(normalizeAccessMode('full')).toBe('full')
  expect(normalizeAccessMode(null)).toBe('ask')
  expect(normalizeAccessMode('unexpected')).toBe('ask')
})
