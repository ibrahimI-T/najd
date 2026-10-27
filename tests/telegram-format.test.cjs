const { test } = require('node:test')
const assert = require('node:assert/strict')
const { toTelegramHtml, takeImages } = require('../electron/telegram-format.cjs')

test('Markdown becomes Telegram HTML: bold, headings, bullets, code and links; everything else is escaped', () => {
  const html = toTelegramHtml('# Plan\n- **Files** in `C:\\work`\n- see [docs](https://example.com/a?b=1&c=2)\n<script>x</script> & more')
  assert.equal(html, '<b>Plan</b>\n• <b>Files</b> in <code>C:\\work</code>\n• see <a href="https://example.com/a?b=1&amp;c=2">docs</a>\n&lt;script&gt;x&lt;/script&gt; &amp; more')
})

test('fenced blocks become pre (a prompt can be copied with a tap); a fence left open by a cut is closed', () => {
  assert.equal(toTelegramHtml('Copy this:\n```prompt\nاكتب **خطة** <مهمة>\n```'), 'Copy this:\n<pre><code class="language-prompt">اكتب **خطة** &lt;مهمة&gt;</code></pre>')
  assert.equal(toTelegramHtml('```\nopen'), '<pre>open</pre>')
})

test('library pictures are taken out of the text to be sent as photos; other images stay text', () => {
  const id = 'a'.repeat(64)
  const { text, ids } = takeImages(`Here it is.\n\n![](najd-library://${id})\n\n![x](najd-library://${id})\n![remote](https://example.com/p.png)`)
  assert.deepEqual(ids, [id])
  assert.equal(text, 'Here it is.\n\n![remote](https://example.com/p.png)')
})
