import { expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { getCopy } from './copy'
import { EffortSlider } from './EffortSlider'

const render = (supported: NajdReasoningPreference[], value: NajdReasoningPreference) =>
  renderToStaticMarkup(<EffortSlider t={getCopy('en')} value={value} supported={supported} preview={null} disabled={false} onChange={() => {}} defaultOpen />)

it('shows one stop per level the model supports, in order, with the chosen level named', () => {
  const html = render(['high', 'low', 'medium'], 'medium')
  expect([...html.matchAll(/data-level="([a-z]+)"/g)].map(match => match[1])).toEqual(['low', 'medium', 'high'])
  expect(html).toContain('aria-valuenow="1"'); expect(html).toContain('>Medium</p>')
  expect(html).toContain('effort-knob')
})

it('follows each model: no Low stop where the model has none, Extra high and Maximum where it has them', () => {
  expect(render(['medium', 'high', 'xhigh', 'max'], 'max').match(/data-level=/g)?.length).toBe(4)
  expect(render(['medium', 'high', 'xhigh', 'max'], 'max')).not.toContain('data-level="low"')
  expect(render([], 'auto')).toContain('effort-none')
})

it('Auto leaves the level to NAJD and shows no chosen stop', () => {
  const html = render(['low', 'medium', 'high'], 'auto')
  expect(html).toContain('aria-pressed="true"'); expect(html).not.toContain('effort-knob'); expect(html).toContain('data-auto="true"')
})
