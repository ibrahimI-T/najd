import { useMemo, useState } from 'react'
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
import java from 'highlight.js/lib/languages/java'
import go from 'highlight.js/lib/languages/go'
import rust from 'highlight.js/lib/languages/rust'
import yaml from 'highlight.js/lib/languages/yaml'
import markdown from 'highlight.js/lib/languages/markdown'
import diff from 'highlight.js/lib/languages/diff'
import cpp from 'highlight.js/lib/languages/cpp'

for (const [name, language] of Object.entries({ javascript, typescript, python, json, bash, powershell, css, xml, sql, csharp, java, go, rust, yaml, markdown, diff, cpp }))
  hljs.registerLanguage(name, language)
const aliases: Record<string, string> = { js: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript', py: 'python', sh: 'bash', shell: 'bash',
  ps1: 'powershell', pwsh: 'powershell', html: 'xml', svg: 'xml', cs: 'csharp', yml: 'yaml', md: 'markdown', 'c++': 'cpp', c: 'cpp' }

// Syntax highlighting: highlight.js escapes the source, so its markup is safe to insert.
export function HighlightedCode({ code, language }: { code: string; language: string }) {
  const html = useMemo(() => {
    const name = aliases[language] || language
    if (code.length > 200000) return null
    try { return hljs.getLanguage(name) ? hljs.highlight(code, { language: name, ignoreIllegals: true }).value : hljs.highlightAuto(code).value }
    catch { return null }
  }, [code, language])
  return html === null ? <code>{code}</code> : <code className="hljs" dangerouslySetInnerHTML={{ __html: html }} />
}

type ChartSpec = { type?: 'bar' | 'line'; title?: string; labels: string[]; series: { name: string; values: number[] }[]; unit?: string }

function parseChart(source: string): ChartSpec | null {
  try {
    const value = JSON.parse(source) as ChartSpec
    if (!Array.isArray(value.labels) || !Array.isArray(value.series) || !value.labels.length || value.labels.length > 60 || !value.series.length || value.series.length > 5) return null
    if (value.series.some(series => !Array.isArray(series.values) || series.values.length !== value.labels.length || series.values.some(v => typeof v !== 'number' || !Number.isFinite(v)))) return null
    return value
  } catch { return null }
}

// Charts from a ```chart JSON block, drawn as plain SVG (no script, no network).
export function ChartBlock({ source, ar }: { source: string; ar: boolean }) {
  const spec = useMemo(() => parseChart(source), [source])
  if (!spec) return <pre className="rich-fallback"><code>{source}</code></pre>
  const width = 640, height = 260, pad = { left: 44, right: 12, top: 18, bottom: 46 }
  const all = spec.series.flatMap(series => series.values), max = Math.max(0, ...all), min = Math.min(0, ...all), span = max - min || 1
  const x = (index: number) => pad.left + (index + 0.5) * (width - pad.left - pad.right) / spec.labels.length
  const y = (value: number) => pad.top + (max - value) / span * (height - pad.top - pad.bottom)
  const band = (width - pad.left - pad.right) / spec.labels.length, barWidth = Math.max(2, band * 0.8 / spec.series.length)
  const ticks = [0, 0.25, 0.5, 0.75, 1].map(step => min + span * step)
  const format = (value: number) => Math.abs(value) >= 1000 ? (value / 1000).toFixed(value >= 10000 ? 0 : 1) + 'k' : String(Math.round(value * 100) / 100)
  return <figure className="chart-block" dir="ltr">
    {spec.title && <figcaption dir="auto">{spec.title}</figcaption>}
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={spec.title || (ar ? 'رسم بياني' : 'Chart')}>
      {ticks.map(tick => <g key={tick}><line className="chart-grid" x1={pad.left} x2={width - pad.right} y1={y(tick)} y2={y(tick)} />
        <text className="chart-axis" x={pad.left - 6} y={y(tick) + 4} textAnchor="end">{format(tick)}</text></g>)}
      {spec.type === 'line' ? spec.series.map((series, s) => <g key={series.name} className={`chart-series s${s}`}>
        <polyline fill="none" points={series.values.map((value, i) => `${x(i)},${y(value)}`).join(' ')} />
        {series.values.map((value, i) => <circle key={i} cx={x(i)} cy={y(value)} r={3}><title>{`${spec.labels[i]}: ${value}${spec.unit || ''}`}</title></circle>)}</g>)
        : spec.series.map((series, s) => <g key={series.name} className={`chart-series s${s}`}>{series.values.map((value, i) =>
          <rect key={i} x={x(i) - band * 0.4 + s * barWidth} y={Math.min(y(value), y(0))} width={barWidth - 1} height={Math.abs(y(value) - y(0))} rx={2}>
            <title>{`${series.name} · ${spec.labels[i]}: ${value}${spec.unit || ''}`}</title></rect>)}</g>)}
      {spec.labels.map((label, i) => spec.labels.length <= 16 || i % Math.ceil(spec.labels.length / 12) === 0
        ? <text key={i} className="chart-axis" x={x(i)} y={height - pad.bottom + 16} textAnchor="middle">{label.slice(0, 14)}</text> : null)}
    </svg>
    {spec.series.length > 1 && <div className="chart-legend">{spec.series.map((series, s) => <span key={series.name} className={`s${s}`}><i />{series.name}</span>)}</div>}
  </figure>
}

// Interactive artifacts run in an opaque-origin sandbox: scripts allowed, but no same-origin
// access to NAJD, no preload, no network (CSP), no forms posting out, no top navigation.
export function ArtifactFrame({ source, ar, bare = false }: { source: string; ar: boolean; bare?: boolean }) {
  const [view, setView] = useState<'preview' | 'code'>('preview')
  const document = useMemo(() => `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:">
<style>html,body{margin:0;padding:12px;font-family:system-ui,'Segoe UI',sans-serif;color:#f5f0e8;background:#14120f}</style></head><body>${source}</body></html>`, [source])
  // Bare: only the isolated page (the caller has its own toolbar).
  if (bare) return <iframe className="artifact-bare" title={ar ? 'معاينة معزولة' : 'Isolated preview'} sandbox="allow-scripts" referrerPolicy="no-referrer" srcDoc={document} />
  return <section className="artifact-frame">
    <header><span>{ar ? 'عنصر تفاعلي (معزول)' : 'Interactive artifact (isolated)'}</span>
      <div><button type="button" aria-pressed={view === 'preview'} onClick={() => setView('preview')}>{ar ? 'معاينة' : 'Preview'}</button>
        <button type="button" aria-pressed={view === 'code'} onClick={() => setView('code')}>{ar ? 'الكود' : 'Code'}</button></div></header>
    {view === 'preview' ? <iframe title={ar ? 'عنصر تفاعلي' : 'Interactive artifact'} sandbox="allow-scripts" referrerPolicy="no-referrer" srcDoc={document} />
      : <pre><HighlightedCode code={source} language="xml" /></pre>}
  </section>
}
