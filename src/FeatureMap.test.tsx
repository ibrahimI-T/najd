import { expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { FeatureMap, AVAILABLE } from './FeatureMap'

it('lists only available features, with no unfinished or under-development entries, in both languages', () => {
  for (const language of ['ar', 'en'] as const) {
    const html = renderToStaticMarkup(<FeatureMap language={language} />)
    expect((html.match(/data-feature-ready="true"/g) || []).length).toBe(AVAILABLE.length)
    expect(html).not.toContain('data-feature-ready="false"')
    expect(html).not.toMatch(/تحت التطوير|Under development|Speak to NAJD|تحدث إلى نجد|Unity|Unreal/)
    expect(html).toContain(language === 'ar' ? 'خريطة النجوم' : 'Star Map')
  }
})
