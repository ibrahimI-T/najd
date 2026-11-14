const test = require('node:test')
const assert = require('node:assert/strict')
const { asText, asMarkdown, asPrintableHtml, FORMATS } = require('../electron/chat-export.cjs')
const session = { title: 'تقرير <b>', createdAt: '2026-11-10T00:00:00.000Z', messages: [
  { role: 'user', text: 'اكتب لي ملخص <script>alert(1)</script>', createdAt: '2026-11-10T00:00:01.000Z' },
  { role: 'assistant', text: 'تم.\n```js\nx()\n```', createdAt: '2026-11-10T00:00:02.000Z' }] }

test('chat export writes text, Markdown and a script-free printable page', () => {
  assert.match(asText(session), /^NAJD AGENT\n/)
  const md = asMarkdown(session)
  assert.match(md, /^# تقرير <b>/); assert.match(md, /## You/); assert.match(md, /## NAJD/); assert.match(md, /```js\nx\(\)\n```/)
  const html = asPrintableHtml(session)
  assert.match(html, /dir="rtl"/)
  assert.equal(html.includes('<script>'), false)
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/)
  assert.match(html, /default-src 'none'/)
  assert.deepEqual(FORMATS, { '.txt': 'text', '.md': 'markdown', '.pdf': 'pdf' })
})
