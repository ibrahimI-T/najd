import { describe, expect, it } from 'vitest'
import { blockExtension, chartSvg, parseChart, renderMarkdown } from './markdown'

describe('Vue message rendering', () => {
  it('shows a dead sandbox link of an older answer as its label, and keeps real links', () => {
    const html = renderMarkdown('[تحميل ملف الميزانية](sandbox:/mnt/data/monthly_budget.xlsx) and [site](https://example.com/mnt/data/x)')
    expect(html).toContain('تحميل ملف الميزانية')
    expect(html).not.toContain('sandbox:')
    expect(html).toContain('href="https://example.com/mnt/data/x"')
  })
  it('never renders raw HTML from a reply and escapes code', () => {
    const html = renderMarkdown('<script>alert(1)</script>\n\n```js\nconst x = "<b>"\n```')
    expect(html).not.toContain('<script>alert'); expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('class="hljs"'); expect(html).toContain('&lt;b&gt;'); expect(html).toContain('data-copy=')
  })
  it('draws valid charts as SVG and leaves invalid ones as code', () => {
    expect(renderMarkdown('```chart\n{"labels":["A","B"],"series":[{"name":"S","values":[1,2]}]}\n```')).toContain('<svg')
    expect(parseChart('{"labels":[],"series":[]}')).toBeNull()
    expect(chartSvg({ labels: ['<x>'], series: [{ name: 'n', values: [1] }] })).toContain('&lt;x&gt;')
  })
  it('allows only safe link schemes and turns library images into placeholders', () => {
    expect(renderMarkdown('[a](javascript:alert(1))')).not.toContain('href="javascript')
    expect(renderMarkdown('![pic](najd-library://' + 'a'.repeat(64) + ')')).toContain('data-library="' + 'a'.repeat(64) + '"')
    expect(renderMarkdown('![x](https://evil.example/x.png)')).not.toContain('<img')
  })
})

describe('saving a code block as a file', () => {
  it('offers Save on every block and picks the extension from the language', () => {
    expect(renderMarkdown(['```py', 'print(1)', '```'].join('\n'))).toContain('data-save="')
    expect(blockExtension('python')).toBe('py')
    expect(blockExtension('PowerShell')).toBe('ps1')
    expect(blockExtension('html')).toBe('html')
    expect(blockExtension('something-new')).toBe('txt')
  })
})
