import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, FileText, Folder, Laptop, Plug, Smartphone } from 'lucide-react'
import { useLang, Toggle } from './ui'

// The session panel: where NAJD runs, how full the model's context is and what fills it, the connectors and the files this
// conversation produced. Numbers come from the main process's per-request log (sizes only, never conversation text).
type Usage = NajdContextUsage & { conversationId?: string | null }
const PARTS: { key: 'history' | 'toolDefinitions' | 'instructions' | 'taskSoFar'; ar: string; en: string; color: string }[] = [
  { key: 'history', ar: 'الرسائل', en: 'Messages', color: 'var(--blue)' },
  { key: 'toolDefinitions', ar: 'تعريفات الأدوات', en: 'Tool definitions', color: 'var(--orange)' },
  { key: 'instructions', ar: 'تعليمات النظام والمهارات', en: 'System prompt and skills', color: 'var(--purple)' },
  { key: 'taskSoFar', ar: 'خطوات المهمة الحالية', en: 'Current task steps', color: 'var(--green)' }
]
const short = (value: number) => value >= 1000 ? (value / 1000).toFixed(value >= 100000 ? 0 : 1) + 'k' : String(value)

export function SessionPanel({ conversationId, activity, project }: { conversationId: string | null; activity?: NajdTaskActivity; project: NajdProject | null }) {
  const { s } = useLang()
  const [usage, setUsage] = useState<Usage | null>(null)
  const [context, setContext] = useState<NajdAgentContext | null>(null)
  const [servers, setServers] = useState<NajdMcpServer[]>([])
  const [remote, setRemote] = useState<boolean | null>(null)
  const [more, setMore] = useState(false)
  const [details, setDetails] = useState(true)
  useEffect(() => {
    let live = true
    void window.najdGraph?.usage().then(rows => { if (!live) return; const mine = (rows as Usage[]).filter(row => row.conversationId === conversationId); setUsage(mine.at(-1) || null) }).catch(() => {})
    if (conversationId) void window.najdAgent?.context(conversationId).then(value => { if (live) setContext(value) }).catch(() => {}); else setContext(null)
    void window.najdMcpServers?.list().then(list => { if (live) setServers(list) }).catch(() => {})
    void window.najdWorkstation?.remote().then(value => { if (live) setRemote(value.enabled) }).catch(() => {})
    return () => { live = false }
  }, [conversationId, activity])
  const window_ = usage?.windowTokens || context?.runs.at(-1)?.contextWindow || null
  const used = usage?.total || 0
  const percent = window_ ? Math.min(100, Math.round(used / window_ * 100)) : null
  const free = window_ ? Math.max(0, window_ - used) : null
  const totals = context?.totals
  const shown = more ? servers : servers.slice(0, 3)
  const outputs = useMemo(() => context?.outputs || [], [context])
  return <div className="sp" data-session-panel>
    <section className="sp-block"><h3>{s('البيئة', 'Environment')}</h3>
      <div className="sp-line"><Laptop size={15} aria-hidden /><span>{s('هذا الحاسوب', 'This computer')}</span></div>
      <div className="sp-line"><Folder size={15} aria-hidden /><bdi dir="auto">{project ? project.name + (project.folder ? ' · ' + project.folder : '') : s('بدون مشروع', 'No project')}</bdi></div>
      <div className="sp-line"><Smartphone size={15} aria-hidden /><span>{s('التحكم عن بعد', 'Remote Control')}</span><span className="w-grow" />
        {remote !== null && <Toggle label={s('التحكم عن بعد', 'Remote Control')} checked={remote} onChange={enabled => { void window.najdWorkstation?.remoteConfigure({ enabled }).then(value => setRemote(value.enabled)).catch(() => {}) }} />}</div>
    </section>
    <section className="sp-block" data-context><h3>{s('السياق', 'Context')}</h3>
      {usage ? <>
        <div className="sp-line"><strong>{percent !== null ? s(`${percent}% مستخدم`, `${percent}% used`) : s('حجم النافذة غير معروف', 'Window size unknown')}</strong><span className="w-grow" /><small dir="ltr">{short(used)}{window_ ? ' / ' + short(window_) : ''}</small></div>
        <div className="sp-bar" role="img" aria-label={percent !== null ? `${percent}%` : ''}>{PARTS.map(part => <i key={part.key} style={{ width: window_ ? (usage[part.key] / window_ * 100) + '%' : 0, background: part.color }} />)}</div>
        <button type="button" className="sp-toggle" aria-expanded={details} onClick={() => setDetails(value => !value)}><ChevronDown size={13} aria-hidden data-open={details} />{s('ما الذي يملأ السياق', 'What fills the context')}</button>
        {details && <ul className="sp-parts">{PARTS.map(part => <li key={part.key}><i style={{ background: part.color }} /><span>{s(part.ar, part.en)}</span><small dir="ltr">{short(usage[part.key])}</small><small dir="ltr">{window_ ? (usage[part.key] / window_ * 100).toFixed(1) + '%' : ''}</small></li>)}
          {free !== null && <li><i style={{ background: 'var(--surface-4)' }} /><span>{s('مساحة فارغة', 'Free space')}</span><small dir="ltr">{short(free)}</small><small dir="ltr">{(free / window_! * 100).toFixed(1)}%</small></li>}
          <li className="sp-note"><span>{s(`الطلب الأخير: ${usage.tools} أداة محملة · طبقة ${usage.tier}`, `Latest request: ${usage.tools} tools loaded · ${usage.tier} tier`)}{usage.condensed ? s(` · ${usage.condensed} نتائج مختصرة`, ` · ${usage.condensed} results condensed`) : ''}</span></li></ul>}
      </> : <small>{conversationId ? s('لم يُرسل طلب للنموذج في هذه المحادثة بعد.', 'No model request in this conversation yet.') : s('ابدأ مهمة ليظهر استهلاك السياق.', 'Start a task to see context use.')}</small>}
      {totals && totals.runs > 0 && <div className="sp-totals" data-totals>
        <span>{s('مدخل', 'Input')} <b dir="ltr">{totals.input ?? '—'}</b></span><span>{s('مخرج', 'Output')} <b dir="ltr">{totals.output ?? '—'}</b></span><span>{s('مخزن', 'Cached')} <b dir="ltr">{totals.cached ?? '—'}</b></span>
        <span>{s('طلبات', 'Calls')} <b dir="ltr">{totals.modelCalls}</b></span><span>{s('أدوات', 'Tools')} <b dir="ltr">{totals.toolCalls}</b></span>
        <small>{s('مجموع المحادثة كلها؛ كل طلب يعيد إرسال السياق.', 'Whole conversation; each request resends its context.')}{totals.partial ? s(' بعض المزودين لم يبلغوا كل الأرقام.', ' Some providers did not report every number.') : ''}</small></div>}
    </section>
    <section className="sp-block" data-connectors><h3>{s('الاتصالات', 'Connectors')}</h3>
      {servers.length === 0 ? <small>{s('لا توجد خوادم MCP مضافة.', 'No MCP servers added.')}</small> : shown.map(server => {
        const auth = /AUTH|401|403|TOKEN/i.test(server.error || '')
        return <div key={server.id} className="sp-line"><Plug size={15} aria-hidden /><bdi>{server.name}</bdi><span className="w-grow" />
          {server.state === 'connected' ? <small className="sp-ok">{s('متصل', 'Connected')}</small>
            : <button type="button" className="sp-action" onClick={() => { void window.najdMcpServers?.connect(server.id).then(next => setServers(list => list.map(item => item.id === next.id ? next : item))).catch(() => {}) }}>{auth ? s('توثيق', 'Authenticate') : server.state === 'failed' ? s('إعادة المحاولة', 'Retry') : s('اتصال', 'Connect')}</button>}</div>
      })}
      {servers.length > 3 && <button type="button" className="sp-toggle" onClick={() => setMore(value => !value)}>{more ? s('عرض أقل', 'Show less') : s('عرض المزيد', 'Show more')}</button>}
    </section>
    <section className="sp-block" data-outputs><h3>{s('المخرجات', 'Outputs')}</h3>
      {outputs.length === 0 ? <small>{s('لا توجد ملفات بعد.', 'No files yet.')}</small> : outputs.map((item, index) => <button type="button" key={index} className="sp-line sp-file" disabled={!item.path || !conversationId} onClick={() => { if (item.path && conversationId) void window.najdAgent?.openOutput?.(conversationId, item.path, 'open') }}><FileText size={15} aria-hidden /><bdi dir="auto">{item.name}</bdi></button>)}
    </section>
  </div>
}
