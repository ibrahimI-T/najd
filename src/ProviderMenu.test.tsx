import { expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ProviderMenu } from './ProviderMenu'

it('renders a compact disclosure with verified proof distinct from saved credentials', () => {
  const html = renderToStaticMarkup(<ProviderMenu label="Subscription" selected="a" disabled={false} onSelect={() => {}}
    options={[{ id: 'a', label: 'ChatGPT', badge: 'Connected', verified: true }, { id: 'b', label: 'Kimi', badge: 'Saved', verified: false }]} />)
  expect(html).toContain('<details')
  expect(html).toContain('aria-pressed="true"')
  expect(html).toContain('provider-badge verified')
  expect(html).toContain('Saved')
  expect(html).not.toContain('role="menu"') // Native disclosure and ordinary buttons keep normal keyboard behavior.
})

it('disables the trigger and choices while a request is captured', () => {
  const html = renderToStaticMarkup(<ProviderMenu label="Model" selected="a" disabled onSelect={() => {}}
    options={[{ id: 'a', label: 'Model A' }]} />)
  expect(html).toContain('aria-disabled="true"')
  expect(html).toContain('disabled=""')
})
