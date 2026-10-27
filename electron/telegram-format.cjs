// Turns a reply written in Markdown into Telegram's HTML subset (bold, italic, code, pre, links), so a phone shows
// formatting instead of ** and # marks. Everything else is escaped; library pictures are taken out to be sent as photos.
const escape = text => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const LIBRARY_IMAGE = /!\[[^\]]*\]\(najd-library:\/\/([a-f0-9]{64})\)/g

// The library pictures a reply shows, and its text without them.
function takeImages(text) {
  const ids = []
  const rest = String(text).replace(LIBRARY_IMAGE, (_, id) => { if (!ids.includes(id)) ids.push(id); return '' }).replace(/\n{3,}/g, '\n\n').trim()
  return { text: rest, ids }
}

function inline(line) {
  // Code spans first, so nothing inside them is formatted.
  const parts = String(line).split(/(`[^`\n]+`)/)
  return parts.map(part => {
    if (/^`[^`\n]+`$/.test(part)) return '<code>' + escape(part.slice(1, -1)) + '</code>'
    let out = escape(part)
    out = out.replace(/\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g, (_, label, url) => `<a href="${url.replace(/"/g, '&quot;')}">${label}</a>`)
    out = out.replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>').replace(/__([^_\n]+)__/g, '<b>$1</b>')
    out = out.replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,!?؟،:]|$)/g, '$1<i>$2</i>')
    return out
  }).join('')
}

// One chunk of Markdown (chunks are cut before formatting, so a fence left open at the end is closed here).
function toTelegramHtml(markdown) {
  const lines = String(markdown).split('\n'), out = []
  let fence = null
  for (const line of lines) {
    const opener = /^\s*```\s*([\w+-]*)\s*$/.exec(line)
    if (fence !== null) {
      if (/^\s*```\s*$/.test(line)) { out.push(fence.lang ? `<pre><code class="language-${fence.lang}">${escape(fence.body.join('\n'))}</code></pre>` : `<pre>${escape(fence.body.join('\n'))}</pre>`); fence = null }
      else fence.body.push(line)
      continue
    }
    if (opener) { fence = { lang: /^[\w+-]{1,20}$/.test(opener[1]) ? opener[1] : '', body: [] }; continue }
    const heading = /^\s{0,3}#{1,6}\s+(.*)$/.exec(line)
    if (heading) { out.push('<b>' + inline(heading[1]) + '</b>'); continue }
    const bullet = /^(\s*)[-*+]\s+(.*)$/.exec(line)
    if (bullet) { out.push(bullet[1] + '• ' + inline(bullet[2])); continue }
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { out.push('──────'); continue }
    out.push(inline(line))
  }
  if (fence !== null) out.push(`<pre>${escape(fence.body.join('\n'))}</pre>`)
  return out.join('\n')
}

module.exports = { toTelegramHtml, takeImages, escape }
