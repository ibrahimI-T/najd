// Conversation export formats (owner request 2026-11-10: keep developing NAJD). Text as before, Markdown, and a print-ready HTML page
// that main turns into a PDF. Each message's text is written as-is (escaped for HTML); nothing is fetched and no script runs in the page.
const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char])
const who = role => role === 'user' ? 'You' : 'NAJD'

function asText(session) {
  const lines = ['NAJD AGENT', session.title || 'Chat', `Created: ${session.createdAt}`, '']
  for (const message of session.messages) lines.push(`${who(message.role)} — ${message.createdAt}`, message.text, '')
  return lines.join('\n')
}

function asMarkdown(session) {
  const parts = [`# ${session.title || 'Chat'}`, '', `*NAJD AGENT — ${session.createdAt}*`, '']
  for (const message of session.messages) parts.push(`## ${who(message.role)}`, `<sub>${message.createdAt}</sub>`, '', message.text, '')
  return parts.join('\n')
}

// One page per conversation, right to left when the conversation is mostly Arabic; code keeps its line breaks.
function asPrintableHtml(session) {
  const all = session.messages.map(message => message.text).join(' ')
  const arabic = (all.match(/[؀-ۿ]/g)?.length || 0) > (all.match(/[A-Za-z]/g)?.length || 0) / 2
  const blocks = session.messages.map(message => `<section class="${message.role}"><h2>${who(message.role)} <small>${escapeHtml(message.createdAt)}</small></h2><div dir="auto">${escapeHtml(message.text)}</div></section>`).join('\n')
  return `<!doctype html><html lang="${arabic ? 'ar' : 'en'}" dir="${arabic ? 'rtl' : 'ltr'}"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>${escapeHtml(session.title || 'Chat')}</title><style>
body { font-family: 'Segoe UI', Tahoma, 'Noto Sans Arabic', sans-serif; color: #1d1d1f; margin: 32px; line-height: 1.7; font-size: 12pt; }
h1 { font-size: 18pt; margin: 0 0 4px; } .meta { color: #6e6e73; margin: 0 0 24px; font-size: 10pt; }
section { margin: 0 0 18px; padding: 12px 16px; border-radius: 10px; break-inside: avoid-page; }
section.user { background: #eef3ff; } section.assistant { background: #f5f5f7; }
h2 { font-size: 11pt; margin: 0 0 6px; } h2 small { color: #6e6e73; font-weight: normal; font-size: 9pt; }
div { white-space: pre-wrap; overflow-wrap: anywhere; unicode-bidi: plaintext; }
</style></head><body><h1 dir="auto">${escapeHtml(session.title || 'Chat')}</h1><p class="meta">NAJD AGENT — ${escapeHtml(session.createdAt)}</p>
${blocks}</body></html>`
}

const FORMATS = { '.txt': 'text', '.md': 'markdown', '.pdf': 'pdf' }
module.exports = { asText, asMarkdown, asPrintableHtml, FORMATS, escapeHtml }
