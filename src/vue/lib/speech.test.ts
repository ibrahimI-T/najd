import { describe, expect, it } from 'vitest'
import { languageOf, pickVoice, speakableText } from './speech'

describe('read aloud', () => {
  it('reads the words, not code, links or Markdown marks', () => {
    const text = '## الخطة\n- **أولًا** راجع [التقرير](https://x.com/a)\n```js\nconsole.log(1)\n```\nثم `npm test`.'
    const spoken = speakableText(text)
    expect(spoken).toContain('الخطة')
    expect(spoken).toContain('أولًا راجع التقرير')
    expect(spoken).toContain('npm test')
    expect(spoken).not.toMatch(/console\.log|https?:|\*\*|##|```/)
  })
  it('picks the language and a matching local voice', () => {
    expect(languageOf('مرحبا بك في نجد NAJD')).toBe('ar')
    expect(languageOf('Hello there, this is NAJD')).toBe('en')
    const voices = [{ lang: 'en-US', localService: true, name: 'Zira' }, { lang: 'ar-SA', localService: false, name: 'Online Hoda' }, { lang: 'ar-EG', localService: true, name: 'Hoda' }]
    expect(pickVoice(voices, 'ar')?.name).toBe('Hoda')
    expect(pickVoice(voices, 'en')?.name).toBe('Zira')
    expect(pickVoice([{ lang: 'en-US', localService: true, name: 'Zira' }], 'ar')).toBeNull()
  })
})
