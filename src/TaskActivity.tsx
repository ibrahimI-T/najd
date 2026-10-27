import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { AlertTriangle, Bot, Brain, Check, CheckCircle2, ChevronDown, Clock, Code, Copy, Database, FilePen, FileText, GitBranch, Globe, Image, Loader2, Monitor, Plug, Puzzle,
  Lightbulb, RotateCcw, Search, ShieldCheck, Sparkles, Square, Terminal, Users, Wrench, XCircle } from 'lucide-react'
import { activityKind, buildActivity, formatCompact, formatShort, groupTitle, type ActivityGroup, type ActivityKind, type ActivityStatus, type AgentActivityEvent } from './activity'
import './activity.css'

export interface WorkRun {
  activity?: NajdTaskActivity
  key: string
  sessionId: string | null
  afterIndex: number
  startedAt: number
  finishedAt?: number
  steps: Pick<NajdTask, 'state' | 'proposedTool' | 'reasoningEffort'>[]
}
type Language = 'ar' | 'en'
const VISIBLE_ROWS = 60

const ICONS: Record<ActivityKind, ReactNode> = {
  reasoning: <Brain size={14} />, thinking: <Lightbulb size={14} />, advice: <Users size={14} />, plan: <Sparkles size={14} />, command: <Terminal size={14} />, git: <GitBranch size={14} />, python: <Code size={14} />,
  'file-read': <FileText size={14} />, 'file-write': <FilePen size={14} />, search: <Search size={14} />, web: <Globe size={14} />, browser: <Globe size={14} />,
  skill: <Sparkles size={14} />, plugin: <Puzzle size={14} />, mcp: <Plug size={14} />, desktop: <Monitor size={14} />, delegate: <Bot size={14} />,
  memory: <Database size={14} />, media: <Image size={14} />, tool: <Wrench size={14} />, approval: <ShieldCheck size={14} />, wait: <Clock size={14} />,
  warning: <AlertTriangle size={14} />, error: <XCircle size={14} />, success: <CheckCircle2 size={14} />
}
const KIND_AR: Record<ActivityKind, string> = {
  reasoning: 'خطة نجد', thinking: 'تفكير', advice: 'نصيحة', plan: 'إعداد الخطة', command: 'تنفيذ أمر', git: 'تشغيل Git', python: 'تشغيل Python', 'file-read': 'قراءة ملف', 'file-write': 'تعديل ملف',
  search: 'بحث', web: 'تصفح الويب', browser: 'تصفح الويب', skill: 'تشغيل مهارة', plugin: 'تشغيل إضافة', mcp: 'استدعاء MCP', desktop: 'التحكم بسطح المكتب',
  delegate: 'مهمة فرعية', memory: 'الذاكرة', media: 'وسائط', tool: 'أداة', approval: 'طلب موافقة', wait: 'انتظار', warning: 'تحذير', error: 'خطأ', success: 'نجاح'
}
const KIND_EN: Record<ActivityKind, string> = {
  reasoning: 'NAJD plan', thinking: 'Thinking', advice: 'Advice', plan: 'Planning', command: 'Run command', git: 'Run Git', python: 'Run Python', 'file-read': 'Read file', 'file-write': 'Change file',
  search: 'Search', web: 'Browse web', browser: 'Browse web', skill: 'Run skill', plugin: 'Run plugin', mcp: 'MCP call', desktop: 'Desktop control',
  delegate: 'Sub-task', memory: 'Memory', media: 'Media', tool: 'Tool', approval: 'Approval requested', wait: 'Waiting', warning: 'Warning', error: 'Error', success: 'Success'
}
const STATUS_AR: Record<ActivityStatus, string> = { running: 'جارٍ', succeeded: 'نجح', failed: 'فشل', cancelled: 'أُلغي', 'awaiting-approval': 'ينتظر موافقة', unconfirmed: 'غير مؤكد' }
const STATUS_EN: Record<ActivityStatus, string> = { running: 'Running', succeeded: 'Succeeded', failed: 'Failed', cancelled: 'Cancelled', 'awaiting-approval': 'Awaiting approval', unconfirmed: 'Unconfirmed' }
// Kinds whose summary is a command, path or code: always left-to-right, even in the Arabic interface.
const TECHNICAL = new Set<ActivityKind>(['command', 'git', 'python', 'file-read', 'file-write', 'search', 'web', 'browser', 'mcp', 'desktop', 'tool'])

function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [active])
  return now
}

function CopyButton({ text, language }: { text: string; language: Language }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const label = language === 'ar' ? 'نسخ' : 'Copy'
  return <button type="button" className="act-mini" aria-label={label} onClick={async event => {
    event.stopPropagation()
    try { await navigator.clipboard.writeText(text); setState('copied') } catch { setState('failed') }
    window.setTimeout(() => setState('idle'), 1600)
  }}>{state === 'copied' ? <Check size={12} /> : <Copy size={12} />}<span>{state === 'failed' ? (language === 'ar' ? 'تعذّر النسخ' : 'Copy failed') : state === 'copied' ? (language === 'ar' ? 'تم النسخ' : 'Copied') : label}</span></button>
}

function StatusMark({ status, language }: { status: ActivityStatus; language: Language }) {
  const label = (language === 'ar' ? STATUS_AR : STATUS_EN)[status]
  const icon = status === 'running' ? <Loader2 size={13} className="act-spin" /> : status === 'succeeded' ? <Check size={13} /> : status === 'failed' ? <XCircle size={13} />
    : status === 'cancelled' ? <Square size={11} /> : <ShieldCheck size={13} />
  return <span className={'act-status ' + status} role="img" aria-label={label} title={label}>{icon}</span>
}

// Core summaries are English strings ("5 model calls · 940 tokens"); show them in the interface language.
function localizeSummary(event: AgentActivityEvent, ar: boolean): string {
  if (ar && event.kind === 'approval') return event.summary.replace('Approved automatically (full access)', 'تمت الموافقة تلقائيًا (وصول كامل)').replace('Approved automatically (approve for me)', 'تمت الموافقة تلقائيًا (وافق عني)')
  if (!ar || event.kind !== 'success') return event.summary
  const match = /^(\d+) model calls?(?: · (\d+) tokens)?$/.exec(event.summary)
  return match ? `${match[1]} ${Number(match[1]) === 1 ? 'استدعاء للنموذج' : 'استدعاءات للنموذج'}${match[2] ? ` · ${match[2]} رمز` : ''}` : event.summary
}

function EventRow({ event, language, now, onRetry, depth = 0, startOpen = false }: { event: AgentActivityEvent; language: Language; now: number; onRetry?: () => void; depth?: number; startOpen?: boolean }) {
  const ar = language === 'ar'
  const [open, setOpen] = useState(startOpen) // rows stay folded like the reference; the header and the approval card already show what needs attention
  const kindLabel = (ar ? KIND_AR : KIND_EN)[event.kind]
  const duration = event.durationMs !== undefined && event.durationMs > 0 ? formatShort(event.status === 'running' ? Math.max(0, now - event.startedAt) : event.durationMs) : ''
  const technical = TECHNICAL.has(event.kind)
  const summaryText = localizeSummary(event, ar)
  const hasDetail = !!(summaryText || event.error || event.children?.length || event.tool || event.skill)
  const approvalFor = event.kind === 'approval' && event.tool ? (ar ? KIND_AR : KIND_EN)[activityKind(event.tool, undefined)] : ''
  const thought = event.kind === 'thinking' || event.kind === 'advice'
  // "Thinking" with its text open below, like Claude and LM Studio (its time sits beside it); an advisor's note names the advisor.
  const title = event.kind === 'thinking' ? kindLabel
    : event.kind === 'advice' && event.model ? `${kindLabel}: ${event.model}` : event.kind === 'skill' && event.skill ? `${kindLabel}: ${event.skill}` : approvalFor ? `${kindLabel} · ${approvalFor}` : kindLabel
  const started = new Date(event.startedAt).toLocaleTimeString(ar ? 'ar-SA' : 'en-GB')
  return <li className={`act-row kind-${event.kind} st-${event.status}`} data-depth={depth}>
    <span className="act-icon" aria-hidden="true">{ICONS[event.kind]}</span>
    <div className="act-main">
      <button type="button" className="act-line" title={duration || undefined} aria-expanded={hasDetail ? open : undefined} disabled={!hasDetail} onClick={() => setOpen(value => !value)}>
        <span className="act-title">{title}</span>
        {summaryText && !open && event.kind !== 'reasoning' && event.kind !== 'thinking' && <><span className="act-sep" aria-hidden="true">|</span><bdi className="act-preview" dir={technical ? 'ltr' : 'auto'}>{summaryText}</bdi></>}
        <span className="act-meta">{event.kind === 'thinking' && duration && <bdi className="act-time" dir="ltr">{duration}</bdi>}{event.status !== 'succeeded' && <StatusMark status={event.status} language={language} />}{hasDetail && <ChevronDown size={12} className="act-chevron" aria-hidden="true" />}</span>
      </button>
      {open && <div className="act-detail">
        {thought ? <div className="act-thinking-wrap"><div className="act-thinking" dir="auto" tabIndex={0}>{summaryText}</div><CopyButton text={summaryText} language={language} /></div>
          : event.kind === 'reasoning'
          ? <p dir="auto">{summaryText}</p>
          : <>{summaryText && <div className="act-code-wrap"><pre className="act-code" dir={technical ? 'ltr' : 'auto'} tabIndex={0}>{summaryText}</pre><CopyButton text={summaryText} language={language} /></div>}
            <dl className="act-facts">
              {event.tool && <><dt>{ar ? 'الأداة' : 'Tool'}</dt><dd><bdi dir="ltr">{event.tool}</bdi></dd></>}
              <dt>{ar ? 'الحالة' : 'Status'}</dt><dd>{(ar ? STATUS_AR : STATUS_EN)[event.status]}</dd>
              <dt>{ar ? 'البداية' : 'Started'}</dt><dd><bdi dir="ltr">{started}</bdi></dd>
              {event.durationMs !== undefined && <><dt>{ar ? 'المدة' : 'Duration'}</dt><dd><bdi dir="ltr">{formatShort(event.status === 'running' ? Math.max(0, now - event.startedAt) : event.durationMs)}</bdi></dd></>}
              {event.exitCode !== undefined && <><dt>{ar ? 'رمز الخروج' : 'Exit code'}</dt><dd><bdi dir="ltr">{event.exitCode}</bdi></dd></>}
            </dl>
            {event.error && <div className="act-error" role="alert"><bdi dir="ltr">{event.error}</bdi><CopyButton text={event.error} language={language} />{onRetry && event.status === 'failed' && <button type="button" className="act-mini" onClick={onRetry}><RotateCcw size={12} /><span>{ar ? 'استرجاع الطلب' : 'Restore prompt'}</span></button>}</div>}
            {!!event.children?.length && <ol className="act-children">{event.children.map(child => <EventRow key={child.id} event={child} language={language} now={now} depth={depth + 1} />)}</ol>}</>}
      </div>}
    </div>
  </li>
}

function GroupRow({ group, language, now }: { group: ActivityGroup; language: Language; now: number }) {
  const [open, setOpen] = useState(false)
  const ar = language === 'ar'
  return <li className={`act-row kind-${group.kind} st-${group.status} is-group`}>
    <span className="act-icon" aria-hidden="true">{ICONS[group.kind]}</span>
    <div className="act-main">
      <button type="button" className="act-line" aria-expanded={open} onClick={() => setOpen(value => !value)}>
        <span className="act-title">{groupTitle(group.kind, group.items.length, language)}</span>
        <span className="act-meta"><ChevronDown size={12} className="act-chevron" aria-hidden="true" /></span>
      </button>
      {open && <ol className="act-children" aria-label={ar ? 'عناصر المجموعة' : 'Group items'}>{group.items.map(item => <EventRow key={item.id} event={item} language={language} now={now} depth={1} />)}</ol>}
    </div>
  </li>
}

export function TaskActivity({ run, language, onStop, onRetry }: { run: WorkRun; language: Language; onStop?: () => void; onRetry?: () => void }) {
  const ar = language === 'ar'
  const live = !run.finishedAt
  const now = useNow(live)
  const view = useMemo(() => buildActivity(run.activity, now), [run.activity, now])
  // A reply that used no tool, skill or approval keeps the quiet one-line duration after it finishes.
  const interactive = view.events.some(event => event.kind === 'thinking' || event.kind === 'advice') || view.counts.tools > 0 || view.counts.approvals > 0 || view.counts.skills > 0 || view.counts.errors > 0 || view.unknownEffect || view.events.some(event => event.kind === 'skill' || event.kind === 'wait')
  const [open, setOpen] = useState<boolean | null>(null)
  const [showAll, setShowAll] = useState(false)
  const elapsed = Math.max(1000, (run.finishedAt || now) - run.startedAt)
  const unknown = view.unknownEffect || run.steps.at(-1)?.state === 'UNKNOWN_EFFECT'
  // Never offered when the outcome is unconfirmed: resending could repeat an action that already happened.
  const retry = unknown ? undefined : onRetry
  const failed = !unknown && (view.failed || run.steps.at(-1)?.state === 'FAILED')
  const waiting = view.waiting || run.steps.at(-1)?.state === 'WAITING_APPROVAL'
  const cancelled = run.steps.at(-1)?.state === 'CANCELLED'
  const span = formatCompact(elapsed, language)
  const caption = live
    ? waiting ? (ar ? 'بانتظار موافقتك' : 'Waiting for your approval') : (ar ? `يعمل لمدة ${span}` : `Working for ${span}`)
    : unknown ? (ar ? 'نتيجة الإجراء غير مؤكدة — تحقّق من الحالة قبل أي إعادة' : 'Outcome unconfirmed — check the result before trying again')
    : cancelled ? (ar ? `أُوقفت بعد ${span}` : `Stopped after ${span}`)
      : failed ? (ar ? `تعذّر الإكمال بعد ${span}` : `Failed after ${span}`)
        : (ar ? `اشتغل ${span}` : `Worked for ${span}`)
  // NAJD's own plan line (profile and tool groups) is technical: it stays in the record but is not shown; the model's thinking is.
  const shown = view.rows.filter(row => !(row.type === 'event' && row.event.kind === 'reasoning'))
  const rows = !showAll && shown.length > VISIBLE_ROWS ? shown.slice(-VISIBLE_ROWS) : shown
  const hidden = shown.length - rows.length
  // While the model works and no tool is running, a live "Thinking…" line stands where its thinking will appear.
  const thinkingNow = live && !waiting && !view.events.some(event => event.status === 'running' && event.kind !== 'skill')
  // A live task opens by default when there is something to show, the live Thinking line included (C21-01).
  const expanded = open ?? (live && (interactive || thinkingNow))
  if (!interactive && !live) return <div className="task-duration act-plain" dir={ar ? 'rtl' : 'ltr'}><bdi>{caption}</bdi></div>
  return <section className={'task-activity act-block' + (live ? ' is-live' : '') + (failed ? ' is-failed' : '') + (unknown ? ' is-unconfirmed' : '') + (waiting ? ' is-waiting' : '')} dir={ar ? 'rtl' : 'ltr'} aria-label={ar ? 'نشاط المهمة' : 'Task activity'}>
    <header className="act-head">
      <button type="button" className="act-toggle" aria-expanded={expanded} onClick={() => setOpen(!expanded)}>
        <span className="act-caption" role={live ? 'timer' : 'status'} aria-live="off"><bdi>{caption}</bdi>{live && <span className="act-pulse" aria-hidden="true" />}</span>
        <ChevronDown size={14} className="act-chevron" aria-hidden="true" />
      </button>
      {live && onStop && <button type="button" className="act-stop" onClick={onStop} aria-label={ar ? 'إيقاف المهمة' : 'Stop task'}><Square size={11} fill="currentColor" /><span>{ar ? 'إيقاف' : 'Stop'}</span></button>}
      {!live && failed && retry && <button type="button" className="act-stop retry" onClick={retry}><RotateCcw size={12} /><span>{ar ? 'استرجاع الطلب' : 'Restore prompt'}</span></button>}
    </header>
    {expanded && <ol className="act-timeline" aria-label={ar ? 'الخط الزمني للأحداث' : 'Event timeline'}>
      {hidden > 0 && <li className="act-more"><button type="button" onClick={() => setShowAll(true)}>{ar ? `إظهار ${hidden} أحداث أقدم` : `Show ${hidden} earlier events`}</button></li>}
      {rows.map(row => row.type === 'event'
        ? <EventRow key={row.event.id} event={row.event} language={language} now={now} onRetry={retry} startOpen={row.event.kind === 'thinking' || row.event.kind === 'advice'} />
        : <GroupRow key={row.group.id} group={row.group} language={language} now={now} />)}
      {thinkingNow ? <li className="act-row kind-thinking act-thinking-now" role="status"><span className="act-icon" aria-hidden="true"><Lightbulb size={14} /></span><div className="act-main"><span className="act-title act-shimmer">{ar ? 'يفكر…' : 'Thinking…'}</span></div></li>
        : live && <li className="act-live" aria-hidden="true"><span /></li>}
    </ol>}
  </section>
}
