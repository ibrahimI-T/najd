import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Blocks, Bot, Brain, Check, ChevronRight, CircleOff, Database, Layers, LayoutGrid, Plug, RefreshCw, Search, ShieldCheck, Sparkles, Unplug, Wrench, Zap } from 'lucide-react'
import { useCatalogs } from './Catalogs'
import { buildAtlas, effectLabel, reasonText, summarizeAtlas, type AtlasKind, type AtlasPage, type AtlasStatus } from './atlas'
import './atlas.css'

type Language = 'ar' | 'en'
const PAGE_SIZE = 40
const KINDS: AtlasKind[] = ['tool', 'skill', 'plugin', 'mcp', 'connection', 'memory', 'agent']
const STATUSES: AtlasStatus[] = ['ready', 'guide', 'needs-setup', 'disconnected', 'error', 'off', 'unavailable']
const KIND_LABEL: Record<AtlasKind, { ar: string; en: string }> = {
  tool: { ar: 'الأدوات', en: 'Tools' }, skill: { ar: 'المهارات', en: 'Skills' }, plugin: { ar: 'الإضافات', en: 'Plugins' }, mcp: { ar: 'MCP', en: 'MCP' },
  connection: { ar: 'الاتصالات', en: 'Connections' }, memory: { ar: 'الذاكرة', en: 'Memory' }, agent: { ar: 'الوكلاء', en: 'Agents' }, automation: { ar: 'الأتمتة', en: 'Automations' }
}
const STATUS_LABEL: Record<AtlasStatus, { ar: string; en: string }> = {
  ready: { ar: 'جاهزة', en: 'Ready' }, guide: { ar: 'إرشاد مفعّل', en: 'Enabled guide' }, 'needs-setup': { ar: 'تحتاج إعدادًا', en: 'Needs setup' }, disconnected: { ar: 'غير متصلة', en: 'Disconnected' },
  error: { ar: 'بها خطأ', en: 'Has an error' }, off: { ar: 'متوقفة', en: 'Turned off' }, unavailable: { ar: 'غير متوفرة', en: 'Not available' }
}
const KIND_ICON: Record<AtlasKind, typeof Wrench> = { tool: Wrench, skill: Sparkles, plugin: Blocks, mcp: Plug, connection: Unplug, memory: Brain, agent: Bot, automation: Zap }

function StatusBadge({ status, language }: { status: AtlasStatus; language: Language }) {
  const Icon = status === 'ready' || status === 'guide' ? Check : status === 'error' ? AlertTriangle : status === 'disconnected' ? Unplug : status === 'off' || status === 'unavailable' ? CircleOff : ShieldCheck
  return <span className={'atlas-status ' + status}><Icon size={12} aria-hidden="true" />{STATUS_LABEL[status][language]}</span>
}

// Status mix as a ring; color only encodes status, and the legend names every segment.
function Ring({ counts, total, language }: { counts: Record<AtlasStatus, number>; total: number; language: Language }) {
  const shown = STATUSES.filter(status => status !== 'unavailable' && counts[status] > 0)
  const radius = 34, circumference = 2 * Math.PI * radius
  let offset = 0
  return <svg className="atlas-ring" viewBox="0 0 90 90" role="img" aria-label={shown.map(status => `${STATUS_LABEL[status][language]}: ${counts[status]}`).join(', ')}>
    <circle cx="45" cy="45" r={radius} className="atlas-ring-track" />
    {total > 0 && shown.map(status => {
      const length = counts[status] / total * circumference
      const segment = <circle key={status} cx="45" cy="45" r={radius} className={'atlas-ring-seg ' + status} strokeDasharray={`${Math.max(0, length - 1.5)} ${circumference}`} strokeDashoffset={-offset} />
      offset += length
      return segment
    })}
    <text x="45" y="50" textAnchor="middle" className="atlas-ring-total">{total}</text>
  </svg>
}

export function CapabilityAtlas({ language, browserConnected, lastUsed, onOpenPage }: { language: Language; browserConnected: boolean; lastUsed: Record<string, number>; onOpenPage: (page: Exclude<AtlasPage, null>) => void }) {
  const ar = language === 'ar'
  const { view, reload } = useCatalogs()
  const [tools, setTools] = useState<NajdAgentTool[] | null>(null)
  const [toolsetReady, setToolsetReady] = useState<Record<string, boolean> | null>(null)
  const [profiles, setProfiles] = useState<{ id: string; title: { ar: string; en: string }; toolsets: string[] }[] | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  // Memory counts as available only after its own read answered.
  const [memory, setMemory] = useState<NajdMemoryNote[] | null>(null)
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState<AtlasKind | 'all'>('all')
  const [status, setStatus] = useState<AtlasStatus | 'all'>('all')
  const [limit, setLimit] = useState(PAGE_SIZE)
  const [selected, setSelected] = useState<string | null>(null)
  const load = useCallback(async () => {
    setLoadFailed(false)
    try {
      const [toolRows, profileRows, sets] = await Promise.all([window.najdAgent?.tools?.() ?? Promise.resolve([]), window.najdAgent?.profiles?.() ?? Promise.resolve([]), window.najdAgent?.toolsets?.() ?? Promise.resolve(null)])
      setTools(toolRows); setProfiles(profileRows); setToolsetReady(sets)
    } catch { setLoadFailed(true); setTools([]); setProfiles([]) }
    try { setMemory(window.najdMemory ? await window.najdMemory.list() : null) } catch { setMemory(null) }
    await reload()
  }, [reload])
  useEffect(() => { void load() }, [load])
  const items = useMemo(() => buildAtlas({ tools, skills: view.skills, capabilities: view.capabilities, pack: view.pack, servers: view.servers, connectors: view.connectors,
    browserConnected, memories: memory ?? [], memoryAvailable: memory !== null, toolsetReady, profiles, lastUsed }, language), [tools, view, memory, toolsetReady, browserConnected, profiles, lastUsed, language])
  const summary = useMemo(() => summarizeAtlas(items), [items])
  // Enabled instruction skills are guidance without a runtime check: shown separately from live-checked capabilities.
  const guidance = summary.byStatus.guide
  const words = query.trim().toLowerCase()
  const shown = useMemo(() => items.filter(item => (kind === 'all' || item.kind === kind) && (status === 'all' || item.status === status) &&
    (!words || `${item.name} ${item.description} ${item.source} ${item.group}`.toLowerCase().includes(words))), [items, kind, status, words])
  useEffect(() => { setLimit(PAGE_SIZE) }, [kind, status, words])
  const detail = items.find(item => item.id === selected) || null
  const time = (ms?: number) => ms ? new Date(ms).toLocaleTimeString(ar ? 'ar-SA' : 'en-GB') : (ar ? 'لم يُستخدم في هذه المحادثة' : 'Not used in this chat')
  return <section className="atlas" aria-label={ar ? 'أطلس القدرات' : 'Capability atlas'}>
    <header className="atlas-top">
      <div className="atlas-ring-wrap">
        <Ring counts={summary.byStatus} total={summary.total} language={language} />
        <ul className="atlas-legend">{STATUSES.filter(item => item !== 'unavailable' && summary.byStatus[item] > 0).map(item =>
          <li key={item}><i className={'dot ' + item} aria-hidden="true" />{STATUS_LABEL[item][language]}<b>{summary.byStatus[item]}</b></li>)}</ul>
      </div>
      <div className="atlas-count">
        <strong>{summary.total}</strong><span>{ar ? 'قدرة على هذا الجهاز' : 'capabilities on this computer'}</span>
        <small>{ar ? `${summary.byStatus.ready} جاهزة بعد فحص حقيقي · ${guidance} إرشادات مفعّلة` : `${summary.byStatus.ready} ready after a real check · ${guidance} enabled guides`}{summary.byStatus.unavailable > 0 && (ar ? ` · ${summary.byStatus.unavailable} غير متوفرة (غير محسوبة)` : ` · ${summary.byStatus.unavailable} not available (not counted)`)}</small>
        <button type="button" className="atlas-refresh" onClick={() => { void load() }}><RefreshCw size={14} />{ar ? 'تحديث' : 'Refresh'}</button>
      </div>
    </header>
    {loadFailed && <p className="atlas-error" role="alert">{ar ? 'تعذّرت قراءة بعض الحالات. الأرقام أدناه قد تكون ناقصة.' : 'Some statuses could not be read. The numbers below may be incomplete.'}</p>}
    <div className="atlas-controls">
      <label className="atlas-search"><Search size={16} aria-hidden="true" /><input type="search" value={query} maxLength={200} placeholder={ar ? 'ابحث في القدرات…' : 'Search capabilities…'} onChange={event => setQuery(event.target.value)} /></label>
      <div className="atlas-chips" role="group" aria-label={ar ? 'الفئة' : 'Category'}>
        <button type="button" aria-pressed={kind === 'all'} onClick={() => setKind('all')}><LayoutGrid size={13} />{ar ? 'الكل' : 'All'}<b>{items.length}</b></button>
        {KINDS.filter(item => summary.byKind[item] > 0).map(item => { const Icon = KIND_ICON[item]; return <button key={item} type="button" aria-pressed={kind === item} onClick={() => setKind(item)}><Icon size={13} />{KIND_LABEL[item][language]}<b>{summary.byKind[item]}</b></button> })}
      </div>
      <div className="atlas-chips" role="group" aria-label={ar ? 'الحالة' : 'Status'}>
        <button type="button" aria-pressed={status === 'all'} onClick={() => setStatus('all')}>{ar ? 'كل الحالات' : 'Any status'}</button>
        {STATUSES.filter(item => summary.byStatus[item] > 0).map(item => <button key={item} type="button" aria-pressed={status === item} onClick={() => setStatus(item)}><i className={'dot ' + item} aria-hidden="true" />{STATUS_LABEL[item][language]}<b>{summary.byStatus[item]}</b></button>)}
      </div>
    </div>
    <div className="atlas-body" data-detail={detail ? 'open' : 'closed'}>
      <div className="atlas-list">
        {tools === null ? <p className="atlas-empty">{ar ? 'جاري القراءة…' : 'Loading…'}</p>
          : shown.length === 0 ? <p className="atlas-empty">{ar ? 'لا توجد قدرات مطابقة.' : 'No matching capabilities.'}</p>
            : <ul>{shown.slice(0, limit).map(item => { const Icon = KIND_ICON[item.kind]; return <li key={item.id}>
              <button type="button" className="atlas-row" aria-current={selected === item.id ? 'true' : undefined} onClick={() => setSelected(selected === item.id ? null : item.id)}>
                <span className="atlas-row-icon" aria-hidden="true"><Icon size={16} /></span>
                <span className="atlas-row-text"><strong dir="auto">{item.name}</strong><span dir="auto">{item.description}</span></span>
                <span className="atlas-row-end"><span className="atlas-kind">{KIND_LABEL[item.kind][language]}</span><StatusBadge status={item.status} language={language} /></span>
                <ChevronRight size={14} className="atlas-go" aria-hidden="true" />
              </button></li> })}</ul>}
        {shown.length > limit && <button type="button" className="atlas-more" onClick={() => setLimit(value => value + PAGE_SIZE)}>{ar ? `إظهار المزيد (${shown.length - limit})` : `Show more (${shown.length - limit})`}</button>}
      </div>
      {detail && <aside className="atlas-detail" aria-label={ar ? 'تفاصيل القدرة' : 'Capability details'}>
        <header><h3 dir="auto">{detail.name}</h3><StatusBadge status={detail.status} language={language} /></header>
        <p dir="auto">{detail.description}</p>
        {detail.reason && <p className={'atlas-reason ' + detail.status} role="status">{reasonText(detail.reason, language)}</p>}
        <dl>
          <dt>{ar ? 'الفئة' : 'Category'}</dt><dd>{KIND_LABEL[detail.kind][language]}</dd>
          <dt>{ar ? 'المصدر' : 'Source'}</dt><dd dir="auto">{detail.source}</dd>
          {detail.version && <><dt>{ar ? 'الإصدار' : 'Version'}</dt><dd dir="ltr">{detail.version}</dd></>}
          <dt>{ar ? 'الصلاحيات' : 'Permissions'}</dt><dd>{detail.permissions.length ? detail.permissions.map(key => effectLabel(key, language)).join(' · ') : '—'}</dd>
          {(detail.kind === 'tool' || detail.kind === 'plugin') && <><dt>{ar ? 'آخر استخدام' : 'Last used'}</dt><dd dir="ltr">{time(detail.lastUsed)}</dd></>}
          <dt>{ar ? 'المعرّف' : 'ID'}</dt><dd dir="ltr"><code>{detail.id}</code></dd>
        </dl>
        {detail.page && <button type="button" className="atlas-open" onClick={() => onOpenPage(detail.page as Exclude<AtlasPage, null>)}><Layers size={14} />{ar ? 'فتح صفحة الإعداد' : 'Open its settings page'}</button>}
        <button type="button" className="atlas-close" onClick={() => setSelected(null)}>{ar ? 'إغلاق' : 'Close'}</button>
      </aside>}
    </div>
    <p className="atlas-note"><Database size={13} aria-hidden="true" />{ar ? 'تُحسب الحالات من فحوصات الجاهزية الفعلية؛ لا تظهر قدرة على أنها جاهزة قبل اجتياز فحصها.' : 'Statuses come from real readiness checks; nothing is shown as ready until its check passes.'}</p>
  </section>
}
