import { expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ChatMessage } from './ChatMessage'

const reply = (text: string) => renderToStaticMarkup(<ChatMessage language="en" message={{ role: 'assistant', createdAt: '', text }} />)

it('highlights code with a language label and keeps the source escaped', () => {
  const html = reply('```js\nconst x = "<b>"\n```')
  expect(html).toContain('class="hljs"')
  expect(html).toContain('hljs-keyword')
  expect(html).toContain('&lt;b&gt;')
  expect(html).not.toContain('<b>')
})

it('draws a chart block as SVG and falls back to text for invalid chart data', () => {
  const html = reply('```chart\n{"type":"bar","title":"Sales","labels":["Q1","Q2"],"series":[{"name":"2026","values":[3,5]}]}\n```')
  expect(html).toContain('<svg'); expect(html).toContain('Sales'); expect(html).toContain('<rect')
  expect(reply('```chart\n{"labels":"nope"}\n```')).toContain('rich-fallback')
})

it('renders interactive artifacts only inside an isolated sandbox without same-origin access', () => {
  const html = reply('```artifact\n<button onclick="alert(1)">Hi</button>\n```')
  expect(html).toContain('sandbox="allow-scripts"')
  expect(html).not.toContain('allow-same-origin')
  expect(html).toContain("default-src &#x27;none&#x27;")
})

it('shows a prompt as a copy box read as text, in either direction', () => {
  const html = reply('Here it is:\n\n```prompt\nاكتب لي خطة **تسويق** لمتجر\n```')
  expect(html).toContain('prompt-block'); expect(html).toContain('dir="auto"')
  expect(html).toContain('Copy prompt')
  expect(html).toContain('**تسويق**') // literal text, not formatted
  expect(html).not.toContain('class="hljs"')
})

it('gives code a toolbar: copy for all, Run for HTML, collapsing for long code', () => {
  const html = reply('```html\n<p>hi</p>\n```')
  expect(html).toContain('data-block="copy"'); expect(html).toContain('data-block="run"')
  expect(html).not.toContain('<iframe') // ordinary HTML runs only when asked
  const long = reply('```python\n' + Array.from({ length: 40 }, (_, n) => `print(${n})`).join('\n') + '\n```')
  expect(long).toContain('block-code collapsed'); expect(long).toContain('Show all 40 lines')
  expect(reply('```python\nprint(1)\n```')).not.toContain('data-block="more"')
})

it('shows SVG as an image, so scripts inside it never run, and Mermaid waits for its renderer', () => {
  const html = reply('```svg\n<svg viewBox="0 0 10 10"><script>alert(1)</script><circle r="4"/></svg>\n```')
  expect(html).toMatch(/<img src="data:image\/svg\+xml/)
  expect(html).not.toContain('<script>'); expect(html).not.toContain('<svg viewBox')
  expect(reply('```mermaid\ngraph TD; A-->B\n```')).toContain('Drawing the diagram')
})
