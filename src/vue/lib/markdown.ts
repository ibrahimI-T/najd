import MarkdownIt from 'markdown-it'
import hljs from 'highlight.js/lib/core'
import javascript from 'highlight.js/lib/languages/javascript'
import typescript from 'highlight.js/lib/languages/typescript'
import python from 'highlight.js/lib/languages/python'
import json from 'highlight.js/lib/languages/json'
import bash from 'highlight.js/lib/languages/bash'
import powershell from 'highlight.js/lib/languages/powershell'
import css from 'highlight.js/lib/languages/css'
import xml from 'highlight.js/lib/languages/xml'
import sql from 'highlight.js/lib/languages/sql'
import csharp from 'highlight.js/lib/languages/csharp'
import yaml from 'highlight.js/lib/languages/yaml'
import markdown from 'highlight.js/lib/languages/markdown'
import diff from 'highlight.js/lib/languages/diff'
import cpp from 'highlight.js/lib/languages/cpp'

// Message rendering for the Vue renderer. Raw HTML in a reply is never rendered (html: false); markdown-it escapes everything else,
// and highlight.js escapes code. Fenced blocks get a header with Copy and Open (handled by delegated clicks in the message component),
// chart blocks are drawn as SVG built from numbers only, and NAJD library images become placeholders the component fills in.
for (const [name, language] of Object.entries({ javascript, typescript, python, json, bash, powershell, css, xml, sql, csharp, yaml, markdown, diff, cpp })) if (!hljs.getLanguage(name)) hljs.registerLanguage(name, language)
const ALIASES: Record<string, string> = { js: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript', py: 'python', sh: 'bash', shell: 'bash', ps1: 'powershell', pwsh: 'powershell', html: 'xml', svg: 'xml', cs: 'csharp', yml: 'yaml', md: 'markdown', 'c++': 'cpp', c: 'cpp' }
const escape = (text: string) => text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!))

type Chart = { type?: 'bar' | 'line'; title?: string; labels: string[]; series: { name: string; values: number[] }[]; unit?: string }
export function parseChart(source: string): Chart | null {
  try {
    const value = JSON.parse(source) as Chart
    if (!Array.isArray(value.labels) || !Array.isArray(value.series) || !value.labels.length || value.labels.length > 60 || !value.series.length || value.series.length > 5) return null
    if (value.series.some(series => !Array.isArray(series.values) || series.values.length !== value.labels.length || series.values.some(v => typeof v !== 'number' || !Number.isFinite(v)))) return null
    return value
  } catch { return null }
}
export function chartSvg(spec: Chart): string {
  const width = 640, height = 260, pad = { left: 44, right: 12, top: 18, bottom: 46 }
  const all = spec.series.flatMap(series => series.values), max = Math.max(0, ...all), min = Math.min(0, ...all), span = max - min || 1
  const band = (width - pad.left - pad.right) / spec.labels.length, barWidth = Math.max(2, band * 0.8 / spec.series.length)
  const x = (index: number) => pad.left + (index + 0.5) * band, y = (value: number) => pad.top + (max - value) / span * (height - pad.top - pad.bottom)
  const format = (value: number) => Math.abs(value) >= 1000 ? (value / 1000).toFixed(value >= 10000 ? 0 : 1) + 'k' : String(Math.round(value * 100) / 100)
  const grid = [0, 0.25, 0.5, 0.75, 1].map(step => min + span * step).map(tick => `<line class="chart-grid" x1="${pad.left}" x2="${width - pad.right}" y1="${y(tick)}" y2="${y(tick)}"/><text class="chart-axis" x="${pad.left - 6}" y="${y(tick) + 4}" text-anchor="end">${format(tick)}</text>`).join('')
  const series = spec.series.map((item, s) => spec.type === 'line'
    ? `<g class="chart-series s${s}"><polyline fill="none" points="${item.values.map((value, i) => `${x(i)},${y(value)}`).join(' ')}"/></g>`
    : `<g class="chart-series s${s}">${item.values.map((value, i) => `<rect x="${x(i) - band * 0.4 + s * barWidth}" y="${Math.min(y(value), y(0))}" width="${barWidth - 1}" height="${Math.abs(y(value) - y(0))}" rx="2"><title>${escape(item.name)} · ${escape(spec.labels[i])}: ${value}${escape(spec.unit || '')}</title></rect>`).join('')}</g>`).join('')
  const labels = spec.labels.map((label, i) => spec.labels.length <= 16 || i % Math.ceil(spec.labels.length / 12) === 0 ? `<text class="chart-axis" x="${x(i)}" y="${height - pad.bottom + 16}" text-anchor="middle">${escape(label.slice(0, 14))}</text>` : '').join('')
  return `<figure class="chart-block" dir="ltr">${spec.title ? `<figcaption dir="auto">${escape(spec.title)}</figcaption>` : ''}<svg viewBox="0 0 ${width} ${height}" role="img">${grid}${series}${labels}</svg></figure>`
}

// The file extension a code block is saved with (the name after its opening fence); anything unknown is saved as text.
const EXTENSIONS: Record<string, string> = { javascript: 'js', js: 'js', jsx: 'jsx', typescript: 'ts', ts: 'ts', tsx: 'tsx', python: 'py', py: 'py', html: 'html', css: 'css', json: 'json', markdown: 'md', md: 'md', bash: 'sh', sh: 'sh', shell: 'sh',
  powershell: 'ps1', ps1: 'ps1', pwsh: 'ps1', sql: 'sql', xml: 'xml', svg: 'svg', yaml: 'yml', yml: 'yml', csv: 'csv', java: 'java', c: 'c', cpp: 'cpp', csharp: 'cs', cs: 'cs', go: 'go', rust: 'rs', rs: 'rs', php: 'php', ruby: 'rb', kotlin: 'kt', swift: 'swift', bat: 'bat', ini: 'ini', toml: 'toml', txt: 'txt', text: 'txt' }
export const blockExtension = (fence: string) => EXTENSIONS[fence.toLowerCase()] || 'txt'

const md = new MarkdownIt({ html: false, linkify: true, breaks: false })
let counter = 0
md.renderer.rules.fence = (tokens, index) => {
  const token = tokens[index], fence = (token.info || 'text').trim().split(/\s+/)[0].toLowerCase(), source = token.content.replace(/\n$/, '')
  if (fence === 'chart') { const spec = parseChart(source); if (spec) return chartSvg(spec) }
  const name = ALIASES[fence] || fence
  let body: string
  try { body = hljs.getLanguage(name) && source.length < 200000 ? hljs.highlight(source, { language: name, ignoreIllegals: true }).value : escape(source) } catch { body = escape(source) }
  const id = 'b' + ++counter
  return `<div class="code-block" data-block="${id}" data-fence="${escape(fence)}"><header><span>${escape(fence)}</span><span class="w-grow"></span><button type="button" class="block-button" data-copy="${id}">Copy</button><button type="button" class="block-button" data-open="${id}">Open</button><button type="button" class="block-button" data-save="${id}">Save</button></header><pre><code class="hljs">${body}</code></pre><script type="text/plain" data-source="${id}">${escape(source)}</script></div>`
}
md.renderer.rules.image = (tokens, index) => {
  const token = tokens[index], src = String(token.attrGet('src') || ''), alt = escape(String(token.content || ''))
  return /^najd-library:\/\/[a-f0-9]{64}$/.test(src) ? `<button type="button" class="c-picture" data-library="${src.slice(15)}" aria-label="${alt}"><span class="c-file">${alt || 'image'}</span></button>` : `<span>${alt}</span>`
}
const defaultLink = md.renderer.rules.link_open || ((tokens, index, options, _env, self) => self.renderToken(tokens, index, options))
md.renderer.rules.link_open = (tokens, index, options, env, self) => { tokens[index].attrSet('rel', 'noreferrer noopener'); tokens[index].attrSet('target', '_blank'); return defaultLink(tokens, index, options, env, self) }
md.validateLink = url => /^(https?:|mailto:|file:\/\/\/|najd-library:\/\/|#)/i.test(url.trim())
md.renderer.rules.table_open = () => '<div class="c-table"><table>'
md.renderer.rules.table_close = () => '</table></div>'

// Answers saved before 0.10.128 may end with a link into another product's sandbox ("[download](sandbox:/mnt/data/x.xlsx)"); it leads
// nowhere, so it is shown as its label (the runtime removes such links from new answers the same way: dropSandboxLinks).
const SANDBOX_LINK = /(!?)\[([^\]\n]{0,300})\]\(\s*(?:<(?:sandbox:|\/mnt\/data\/)[^>\n]*>|sandbox:[^)\s]*|\/mnt\/data\/[^)\s]*)\s*\)/gi
export const renderMarkdown = (text: string) => md.render(String(text).replace(SANDBOX_LINK, (_all, bang: string, label: string) => bang ? '' : label))
