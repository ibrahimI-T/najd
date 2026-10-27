import { expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ShieldCheck } from 'lucide-react'
import { SettingRow, Segmented, StatusPill, InfoNote, CardHeading } from './ui'

it('SettingRow keeps the smoke-test contract: row class, label block, then control', () => {
  const html = renderToStaticMarkup(<SettingRow title="Language" hint="Choose" className="interface-size">
    <Segmented label="Language"><button className="on">Arabic</button><button>English</button></Segmented>
  </SettingRow>)
  expect(html).toContain('setting-row interface-size')
  expect(html).toContain('<h3>Language</h3>')
  expect(html).toContain('role="group"')
  expect(html.indexOf('<h3>')).toBeLessThan(html.indexOf('segmented'))
})

it('StatusPill and InfoNote render state and optional icon', () => {
  expect(renderToStaticMarkup(<StatusPill ready>Available</StatusPill>)).toContain('status-pill ready')
  expect(renderToStaticMarkup(<StatusPill>Planned</StatusPill>)).not.toContain('ready')
  expect(renderToStaticMarkup(<InfoNote title="Privacy"><p>Note</p></InfoNote>)).not.toContain('<svg')
  expect(renderToStaticMarkup(<InfoNote icon={ShieldCheck} title="Privacy"><p>Note</p></InfoNote>)).toContain('<svg')
})

it('CardHeading renders heading, optional hint, and the chosen wrapper class', () => {
  const html = renderToStaticMarkup(<CardHeading icon={ShieldCheck} title="Roots" hint="Granted folders" className="model-card-heading" size={20} />)
  expect(html).toContain('model-card-heading')
  expect(html).toContain('<h3>Roots</h3>')
  expect(html).toContain('Granted folders')
})
