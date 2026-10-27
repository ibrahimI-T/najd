import { expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { Marketplace } from './Marketplace'

const items = [
  { id: 'a', name: 'Frontend Design', description: 'Craft production-grade frontends', installed: true, verified: true, status: 'On' },
  { id: 'b', name: 'Context7', description: 'Live docs lookup', installed: false, status: 'Off' },
  { id: 'c', name: 'Browser', description: 'Browses with approval', installed: true, status: 'Not connected', statusOn: false }
]

it('shows every item with its installed count, and only installed ones when opened that way', () => {
  for (const language of ['ar', 'en'] as const) {
    const all = renderToStaticMarkup(<Marketplace id="t" language={language} title="T" items={items} />)
    expect(all.match(/class="market-card"/g)?.length).toBe(3)
    expect(all).toContain(language === 'ar' ? 'مثبّت 2' : 'Installed 2')
    const installed = renderToStaticMarkup(<Marketplace id="t" language={language} title="T" items={items} initialInstalled />)
    expect(installed.match(/class="market-card"/g)?.length).toBe(2); expect(installed).not.toContain('Context7')
  }
})

it('marks verified items and colors a status by its own state, not by installation', () => {
  const html = renderToStaticMarkup(<Marketplace id="t" language="en" title="T" items={items} />)
  expect(html).toContain('aria-label="Verified"')
  expect(html).toContain('<span class="market-status on">On</span>')
  expect(html).toContain('<span class="market-status">Not connected</span>')
})
