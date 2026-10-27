import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Check, ChevronDown, Code, Copy, Download, Eye, FolderOpen, Maximize2, Play, Sparkles, X } from 'lucide-react'
import { ArtifactFrame, HighlightedCode } from './RichContent'

type Lang = 'ar' | 'en'
const say = (language: Lang, ar: string, en: string) => (language === 'ar' ? ar : en)

// File types for saving a block, by its fence language.
const EXTENSIONS: Record<string, string> = {
  javascript: 'js', js: 'js', jsx: 'jsx', typescript: 'ts', ts: 'ts', tsx: 'tsx', python: 'py', py: 'py', json: 'json', bash: 'sh', sh: 'sh', shell: 'sh',
  powershell: 'ps1', ps1: 'ps1', pwsh: 'ps1', css: 'css', html: 'html', xml: 'xml', svg: 'svg', sql: 'sql', csharp: 'cs', cs: 'cs', java: 'java', go: 'go',
  rust: 'rs', yaml: 'yaml', yml: 'yml', markdown: 'md', md: 'md', diff: 'diff', cpp: 'cpp', c: 'c', mermaid: 'mmd', artifact: 'html', prompt: 'txt', text: 'txt'
}
export const extensionOf = (language: string) => EXTENSIONS[language.toLowerCase()] || 'txt'
// Blocks that can be shown as a picture or a page as well as source.
export const previewKind = (language: string, text: string): 'html' | 'svg' | 'mermaid' | null => {
  const name = language.toLowerCase()
  if (name === 'html' || name === 'artifact') return 'html'
  if (name === 'svg' || ((name === 'xml' || name === 'text') && /^\s*<svg[\s>]/i.test(text))) return 'svg'
  if (name === 'mermaid') return 'mermaid'
  return null
}

function CopyButton({ text, language, label }: { text: string; language: Lang; label?: string }) {
  const [state, setState] = useState<'idle' | 'done' | 'failed'>('idle')
  useEffect(() => { if (state === 'idle') return; const timer = setTimeout(() => setState('idle'), 1800); return () => clearTimeout(timer) }, [state])
  return <button type="button" className="block-button" data-block="copy" title={label || say(language, 'نسخ', 'Copy')} onClick={async () => {
    try { await navigator.clipboard.writeText(text); setState('done') } catch { setState('failed') }
  }}>{state === 'done' ? <Check size={14} /> : <Copy size={14} />}<span>{state === 'done' ? say(language, 'تم النسخ', 'Copied') : state === 'failed' ? say(language, 'تعذّر النسخ', 'Copy failed') : label || say(language, 'نسخ', 'Copy')}</span></button>
}

function DownloadButton({ text, extension, name, language }: { text: string; extension: string; name?: string; language: Lang }) {
  const [state, setState] = useState<'idle' | 'done' | 'failed'>('idle')
  useEffect(() => { if (state === 'idle') return; const timer = setTimeout(() => setState('idle'), 2200); return () => clearTimeout(timer) }, [state])
  if (typeof window === 'undefined' || !window.najdSessions?.saveBlock) return null
  return <button type="button" className="block-button" data-block="download" title={say(language, 'حفظ كملف', 'Save as file')} onClick={async () => {
    try { const result = await window.najdSessions!.saveBlock({ text, extension, name }); if (result.saved) setState('done') } catch { setState('failed') }
  }}>{state === 'done' ? <Check size={14} /> : <Download size={14} />}<span>{state === 'done' ? say(language, 'تم الحفظ', 'Saved') : state === 'failed' ? say(language, 'تعذّر الحفظ', 'Save failed') : say(language, 'تحميل', 'Download')}</span></button>
}

// A block that is only a Windows file path (e.g. a page NAJD just wrote) is opened, not saved as a text file.
export const filePathOf = (text: string) => { const line = text.trim(); return /^[A-Za-z]:\\[^\n\r<>"|?*]+$/.test(line) && line.length <= 1024 ? line : null }

function OpenFileButtons({ filePath, language }: { filePath: string; language: Lang }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => { if (!failed) return; const timer = setTimeout(() => setFailed(false), 2600); return () => clearTimeout(timer) }, [failed])
  if (typeof window === 'undefined' || !window.najdSessions?.openFile) return null
  const run = async (mode: 'open' | 'reveal') => { try { const result = await window.najdSessions!.openFile!({ path: filePath, mode }); if (!result.opened) setFailed(true) } catch { setFailed(true) } }
  const openable = /\.(html?|pdf|png|jpe?g|gif|webp|svg|mp4|webm|txt|md|csv)$/i.test(filePath)
  return <>
    {openable && <button type="button" className="block-button accent" data-block="open-file" onClick={() => { void run('open') }}><Play size={14} /><span>{say(language, 'فتح', 'Open')}</span></button>}
    <button type="button" className="block-button" data-block="reveal-file" title={failed ? say(language, 'يُفتح فقط ما داخل مجلد نجد في المستندات', 'Only files inside the NAJD folder in Documents open') : undefined} onClick={() => { void run('reveal') }}>
      <FolderOpen size={14} /><span>{failed ? say(language, 'تعذّر الفتح', 'Could not open') : say(language, 'عرض في المجلد', 'Show in folder')}</span></button>
  </>
}

// ---------- the canvas: a panel beside the conversation for long code, pages and diagrams ----------
export type CanvasItem = { title: string; language: string; source: string; view: 'preview' | 'code' }
export const CanvasContext = createContext<((item: CanvasItem) => void) | null>(null)

export function CanvasPanel({ item, language, onClose }: { item: CanvasItem; language: Lang; onClose: () => void }) {
  const kind = previewKind(item.language, item.source)
  const [view, setView] = useState<'preview' | 'code'>(kind ? item.view : 'code')
  useEffect(() => { setView(kind ? item.view : 'code') }, [item, kind])
  const lines = item.source.split('\n').length
  return <aside className="canvas-panel" aria-label={say(language, 'لوحة العرض', 'Canvas')} data-canvas={item.language} onKeyDown={event => { if (event.key === 'Escape') onClose() }}>
    <header className="canvas-head">
      <div className="canvas-title"><strong dir="auto">{item.title}</strong><span dir="ltr">{item.language} · {lines} {say(language, 'سطر', lines === 1 ? 'line' : 'lines')}</span></div>
      <div className="canvas-actions">
        {kind && <div className="block-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={view === 'preview'} data-canvas-tab="preview" onClick={() => setView('preview')}><Eye size={14} />{say(language, 'معاينة', 'Preview')}</button>
          <button type="button" role="tab" aria-selected={view === 'code'} data-canvas-tab="code" onClick={() => setView('code')}><Code size={14} />{say(language, 'الكود', 'Code')}</button></div>}
        <CopyButton text={item.source} language={language} />
        <DownloadButton text={item.source} extension={extensionOf(item.language)} language={language} />
        <button type="button" className="block-button icon" data-canvas="close" aria-label={say(language, 'إغلاق', 'Close')} onClick={onClose}><X size={16} /></button>
      </div>
    </header>
    <div className="canvas-body">
      {view === 'preview' && kind === 'html' ? <ArtifactFrame source={item.source} ar={language === 'ar'} bare />
        : view === 'preview' && kind === 'svg' ? <SvgPicture source={item.source} language={language} />
        : view === 'preview' && kind === 'mermaid' ? <MermaidPicture source={item.source} language={language} />
        : <pre className="canvas-code" tabIndex={0} dir="ltr"><HighlightedCode code={item.source} language={item.language} /></pre>}
    </div>
  </aside>
}

// ---------- pictures: SVG and Mermaid are shown as images, so nothing in them can run ----------
const svgUrl = (svg: string) => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)

export function SvgPicture({ source, language }: { source: string; language: Lang }) {
  const valid = /^\s*(<\?xml[^>]*>\s*)?<svg[\s>]/i.test(source) && source.length <= 500000
  if (!valid) return <p className="block-note">{say(language, 'هذا ليس رسماً SVG صالحاً.', 'This is not a valid SVG drawing.')}</p>
  const markup = /xmlns=/.test(source) ? source : source.replace(/<svg/i, '<svg xmlns="http://www.w3.org/2000/svg"')
  return <div className="block-picture"><img src={svgUrl(markup)} alt={say(language, 'رسم SVG', 'SVG drawing')} /></div>
}

let mermaidReady: Promise<typeof import('mermaid').default> | null = null
let mermaidCount = 0
function loadMermaid() {
  if (!mermaidReady) mermaidReady = import('mermaid').then(module => {
    const css = getComputedStyle(document.documentElement)
    const value = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback
    module.default.initialize({
      startOnLoad: false, securityLevel: 'strict', maxTextSize: 20000, htmlLabels: false, flowchart: { htmlLabels: false }, theme: 'base',
      fontFamily: "'IBM Plex Sans Arabic', 'DM Sans', system-ui, sans-serif",
      themeVariables: { primaryColor: value('--panel-raised', '#1d1a16'), primaryTextColor: value('--text', '#f5f0e8'), primaryBorderColor: value('--accent', '#d7ac62'),
        lineColor: value('--muted', '#a89f92'), textColor: value('--text', '#f5f0e8'), background: 'transparent', mainBkg: value('--panel-raised', '#1d1a16'), secondaryColor: value('--input', '#26221d'), tertiaryColor: value('--hover', '#2c2822') }
    })
    return module.default
  })
  return mermaidReady
}

export function MermaidPicture({ source, language }: { source: string; language: Lang }) {
  const [svg, setSvg] = useState<string | null>(null), [failed, setFailed] = useState(false)
  useEffect(() => {
    let alive = true
    setSvg(null); setFailed(false)
    if (source.length > 20000) { setFailed(true); return }
    loadMermaid().then(mermaid => mermaid.render('najd-mermaid-' + ++mermaidCount, source)).then(result => { if (alive) setSvg(result.svg) }, () => { if (alive) setFailed(true) })
    return () => { alive = false }
  }, [source])
  if (failed) return <p className="block-note">{say(language, 'تعذّر رسم المخطط؛ هذا نصّه.', 'The diagram could not be drawn; here is its text.')}</p>
  if (!svg) return <p className="block-note" role="status">{say(language, 'يُرسم المخطط…', 'Drawing the diagram…')}</p>
  return <div className="block-picture"><img src={svgUrl(svg)} alt={say(language, 'مخطط', 'Diagram')} /></div>
}

// ---------- blocks in a reply ----------
const COLLAPSE_LINES = 24

function titleOf(language: string, text: string) {
  const first = text.split('\n').find(line => line.trim())?.trim() || ''
  const named = first.match(/^(?:\/\/|#|--|<!--)\s*([\w./ -]{2,60}\.\w{1,6})/)
  return named ? named[1].trim() : language
}

export function CodeBlock({ text, fence, lang }: { text: string; fence: string; lang: Lang }) {
  const openCanvas = useContext(CanvasContext)
  const kind = previewKind(fence, text)
  const lines = text.split('\n').length
  // Pictures and an ```artifact demo show their result first; an ordinary HTML block shows its code until Run.
  const [expanded, setExpanded] = useState(false), [inline, setInline] = useState<'code' | 'preview'>(kind === 'svg' || kind === 'mermaid' || fence === 'artifact' ? 'preview' : 'code')
  const long = lines > COLLAPSE_LINES
  const title = titleOf(fence, text)
  const filePath = kind ? null : filePathOf(text)
  const open =(view: 'preview' | 'code') => openCanvas?.({ title, language: fence, source: text, view })
  return <section className="code-block" dir="ltr" data-lang={fence}>
    <header>
      <span className="block-label"><Code size={13} />{fence}{title !== fence && <em>{title}</em>}</span>
      <div className="block-actions">
        {(kind === 'svg' || kind === 'mermaid') && <div className="block-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={inline === 'preview'} onClick={() => setInline('preview')}><Eye size={13} />{say(lang, 'الرسم', 'Diagram')}</button>
          <button type="button" role="tab" aria-selected={inline === 'code'} onClick={() => setInline('code')}><Code size={13} />{say(lang, 'الكود', 'Code')}</button></div>}
        {kind === 'html' && (inline === 'preview'
          ? <button type="button" className="block-button" data-block="show-code" onClick={() => setInline('code')}><Code size={14} /><span>{say(lang, 'الكود', 'Code')}</span></button>
          : <button type="button" className="block-button accent" data-block="run" onClick={() => (openCanvas ? open('preview') : setInline('preview'))}><Play size={14} /><span>{say(lang, 'تشغيل', 'Run')}</span></button>)}
        {filePath && <OpenFileButtons filePath={filePath} language={lang} />}
        <CopyButton text={text} language={lang} label={filePath ? say(lang, 'نسخ المسار', 'Copy path') : say(lang, 'نسخ الكود', 'Copy code')} />
        {!filePath && <DownloadButton text={text} extension={extensionOf(fence)} name={title !== fence ? title.replace(/\.\w+$/, '') : undefined} language={lang} />}
        {openCanvas && <button type="button" className="block-button icon" data-block="expand" title={say(lang, 'فتح في اللوحة الجانبية', 'Open in side panel')} aria-label={say(lang, 'فتح في اللوحة الجانبية', 'Open in side panel')} onClick={() => open(kind ? 'preview' : 'code')}><Maximize2 size={14} /></button>}
      </div>
    </header>
    {inline === 'preview' && kind === 'svg' ? <SvgPicture source={text} language={lang} />
      : inline === 'preview' && kind === 'mermaid' ? <MermaidPicture source={text} language={lang} />
      : inline === 'preview' && kind === 'html' ? <ArtifactFrame source={text} ar={lang === 'ar'} bare />
      : <div className={'block-code' + (long && !expanded ? ' collapsed' : '')}>
        <pre tabIndex={0}><HighlightedCode code={text} language={fence} /></pre>
        {long && <button type="button" className="block-more" data-block="more" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
          <ChevronDown size={14} />{expanded ? say(lang, 'إخفاء', 'Show less') : say(lang, `عرض كل الأسطر (${lines})`, `Show all ${lines} lines`)}</button>}
      </div>}
  </section>
}

// A prompt (or any text meant to be pasted into another tool) in its own box, read as text and copied in one click.
export function PromptBlock({ text, lang }: { text: string; lang: Lang }) {
  return <section className="prompt-block" data-block="prompt">
    <header><span className="block-label"><Sparkles size={14} />{say(lang, 'برومبت جاهز للنسخ', 'Prompt, ready to copy')}</span>
      <div className="block-actions"><CopyButton text={text} language={lang} label={say(lang, 'نسخ البرومبت', 'Copy prompt')} /></div></header>
    <div className="prompt-text" dir="auto" tabIndex={0}>{text}</div>
  </section>
}

export function CanvasProvider({ onOpen, children }: { onOpen: (item: CanvasItem) => void; children: ReactNode }) {
  const handler = useRef(onOpen); handler.current = onOpen
  const stable = useMemo(() => (item: CanvasItem) => handler.current(item), [])
  return <CanvasContext.Provider value={stable}>{children}</CanvasContext.Provider>
}
