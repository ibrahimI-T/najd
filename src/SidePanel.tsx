import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { BadgeCheck, ChevronDown, Cpu, FolderOpen, Globe2, Monitor, PanelRightClose } from 'lucide-react'
import type { Copy } from './copy'
import { visibleInterval } from './useVisibleInterval'
import { useCatalogs, skillItems, pluginItems, connectionItems } from './Catalogs'
import { buildActivity, deriveContext, deriveProgress, type ProgressStage } from './activity'
import type { MarketItem } from './Marketplace'

type Language = 'ar' | 'en'
// Request parts in the order the provider receives them; the bar shows each as one stratum.
const PARTS = ['instructionsBytes', 'toolsBytes', 'historyBytes', 'turnBytes'] as const
const tokens = (bytes: number | null | undefined) => typeof bytes === 'number' ? Math.ceil(bytes / 4) : 0
// 943,200 -> "943.2k", 1,000,000 -> "1M": the compact figures of the context card.
const compact = (value: number) => value >= 1_000_000 ? (Math.round(value / 100_000) / 10).toString().replace(/\.0$/, '') + 'M'
  : value >= 1000 ? (Math.round(value / 100) / 10).toString().replace(/\.0$/, '') + 'k' : String(value)

// One collapsible card; the open state is kept per card for the next visit. A closed card still shows its summary
// (a percentage, a count) at the end of its heading, so the panel reads at a glance with every card folded.
function Card({ id, title, summary, children }: { id: string; title: string; summary?: ReactNode; children: ReactNode }) {
  const key = 'najd.sidePanel.card.' + id
  const [open, setOpen] = useState<boolean>(() => { try { return localStorage.getItem(key) !== 'closed' } catch { return true } })
  return <section className="side-card" data-open={open} aria-labelledby={'sp-' + id}>
    <button type="button" className="side-card-head" aria-expanded={open} onClick={() => setOpen(value => { const next = !value; try { localStorage.setItem(key, next ? 'open' : 'closed') } catch {} return next })}>
      <h3 id={'sp-' + id}>{title}</h3><ChevronDown size={14} aria-hidden="true" className="side-card-chevron" />
      {!open && summary !== undefined && summary !== null && <span className="side-card-summary">{summary}</span>}
    </button>
    {open && <div className="side-card-body">{children}</div>}
  </section>
}

// A catalog card's body: the first installed items with their descriptions, and the Installed count that opens the
// full page showing only what is installed.
function CatalogList({ items, ar, onOpen }: { items: MarketItem[]; ar: boolean; onOpen: () => void }) {
  const installed = items.filter(item => item.installed)
  return <>
    {installed.length ? <ul className="side-catalog">{installed.slice(0, 5).map(item => <li key={item.id}><strong dir="auto">{item.name}</strong><span dir="auto">{item.status ? item.status + ' · ' : ''}{item.description}</span></li>)}</ul>
      : <p className="side-panel-note">{ar ? 'لا توجد عناصر مثبّتة بعد.' : 'Nothing installed yet.'}</p>}
    <button type="button" className="side-more" onClick={onOpen}><BadgeCheck size={13} />{ar ? `مثبّت ${installed.length} · عرض الكل` : `Installed ${installed.length} · Show all`}</button>
  </>
}

const STAGE_LABEL: Record<ProgressStage['id'], { ar: string; en: string }> = {
  understand: { ar: 'فهم الطلب', en: 'Understand the request' }, plan: { ar: 'إعداد الخطة', en: 'Plan' }, work: { ar: 'تنفيذ الخطوات', en: 'Run the steps' },
  approval: { ar: 'موافقاتك', en: 'Your approvals' }, answer: { ar: 'كتابة الرد', en: 'Write the answer' }
}
const STAGE_STATE: Record<ProgressStage['state'], { ar: string; en: string }> = {
  done: { ar: 'تم', en: 'Done' }, active: { ar: 'جارٍ', en: 'In progress' }, pending: { ar: 'لاحقًا', en: 'Later' }, waiting: { ar: 'ينتظر موافقتك', en: 'Waiting for you' }, paused: { ar: 'متوقف مؤقتًا', en: 'Paused' }, unconfirmed: { ar: 'غير مؤكد', en: 'Unconfirmed' }, failed: { ar: 'لم يكتمل', en: 'Not completed' }
}
// A list that shows its first few items and the rest on request.
function Folded({ items, ar, empty }: { items: string[]; ar: boolean; empty: string }) {
  const [all, setAll] = useState(false)
  if (!items.length) return <p className="side-panel-note">{empty}</p>
  const shown = all ? items : items.slice(0, 4)
  return <><ul className="side-list used-list">{shown.map(item => <li key={item} title={item}><bdi dir="ltr">{item}</bdi></li>)}</ul>
    {items.length > 4 && <button type="button" className="side-more" aria-expanded={all} onClick={() => setAll(value => !value)}>{all ? (ar ? 'إظهار أقل' : 'Show less') : (ar ? `إظهار المزيد (${items.length - 4})` : `Show more (${items.length - 4})`)}</button>}</>
}

export function SidePanel({ t, language, conversationId, provider, model, modelWindow, busy, browserConnected, pinned, onPin, onClose, onOpen, activity }: {
  t: Copy; language: Language; conversationId: string | null; provider: NajdProviderId; model: string; modelWindow: number | null; busy: boolean; browserConnected: boolean
  activity?: NajdTaskActivity; pinned: string | null; onPin: (profile: string | null) => void; onClose: () => void; onOpen?: (section: 'skills' | 'plugins' | 'connections' | 'memory', installedOnly: boolean) => void
}) {
  const p = t.panel
  const ar = language === 'ar'
  const { view: catalogs, reload: reloadCatalogs } = useCatalogs(busy)
  useEffect(() => visibleInterval(() => { void reloadCatalogs() }, 15000), [reloadCatalogs])
  const [runtime, setRuntime] = useState<NajdRuntimeStatus | null>(null)
  useEffect(() => { void window.najdRuntime?.status().then(setRuntime).catch(() => setRuntime(null)) }, [busy])
  const skills = skillItems(catalogs, language, true, () => {}), plugins = pluginItems(catalogs, t, language)
  const connectionList = connectionItems(catalogs, language, browserConnected)
  const companion = catalogs.connectors[0] || null
  const toggleCompanion = async () => {
    if (!companion || !window.najdMcp) return
    try { await (companion.state === 'connected' ? window.najdMcp.disconnect(companion.id) : window.najdMcp.connect(companion.id)) } catch {} finally { await reloadCatalogs() }
  }
  // Data is bound to the conversation it was read for (APR-021): another conversation's numbers are never shown,
  // a late answer for a previous conversation is dropped, and refreshes never overlap.
  const [loaded, setLoaded] = useState<{ conversationId: string; value: NajdAgentContext } | null>(null)
  const data = loaded && loaded.conversationId === conversationId ? loaded.value : null
  const current = useRef(conversationId), inFlight = useRef<string | null>(null)
  current.current = conversationId
  const api = window.najdAgent
  const refresh = useCallback(async () => {
    // Only a refresh for the same conversation is skipped while one is running; a switch reads at once.
    if (!api || !conversationId || inFlight.current === conversationId) return
    inFlight.current = conversationId
    try {
      const value = await api.context(conversationId)
      if (current.current === conversationId) setLoaded({ conversationId, value })
    } catch { if (current.current === conversationId) setLoaded(null) }
    finally { if (inFlight.current === conversationId) inFlight.current = null }
  }, [api, conversationId])
  // Refresh on conversation change and when a reply finishes; while open and shown, at most every 5 s.
  useEffect(() => { void refresh() }, [refresh, busy])
  useEffect(() => visibleInterval(() => { void refresh() }, 5000), [refresh])

  const last = data?.runs.at(-1) || null
  const request = last?.request || null
  const estimated = request ? PARTS.reduce((sum, key) => sum + tokens(request[key]), 0) : 0
  // The window recorded with the run that produced this request (APR-005); before any run, or when that run did not
  // record one, the selected model's own window as its provider reports it.
  const sameModel = !last || (last.provider === provider && last.modelName === model)
  const contextWindow = last?.contextWindow || (sameModel ? modelWindow : null)
  const totals = data?.totals
  const number = (value: number | null | undefined) => typeof value === 'number' ? value.toLocaleString('en-US') : '—'
  const profileTitle = (id: string) => data?.profiles.find(item => item.id === id)?.title[language] || id
  const activeProfile = pinned || last?.profile || null
  const links = [browserConnected, ...catalogs.connectors.map(item => item.state === 'connected'), ...catalogs.servers.map(server => server.state === 'connected')]
  const connected = links.filter(Boolean).length, connectionCount = links.length

  return <aside id="side-panel" className="side-panel" dir={language === 'ar' ? 'rtl' : 'ltr'} lang={language} aria-label={p.title} onKeyDown={event => { if (event.key === 'Escape') onClose() }}>
    <header className="side-panel-head">
      <strong>{p.title}</strong>
      <button type="button" className="icon-button" onClick={onClose} aria-label={p.hide} title={p.hide}><PanelRightClose size={17} /></button>
    </header>
    {/* The context card describes the selected model, so it shows in a new chat before the first send too
        (M2-R30-003); the other cards belong to a conversation. */}
    <div className="side-panel-body">
      {activity && (() => {
        const view = buildActivity(activity)
        const stages = deriveProgress(view, activity), used = deriveContext(view)
        // Exactly one current step: the one waiting for the user, else the one in progress.
        const active = stages.find(stage => stage.state === 'waiting') ?? stages.find(stage => stage.state === 'active')
        const none = ar ? 'لم يُستخدم شيء بعد.' : 'Nothing used yet.'
        return <>
          <Card id="progress" title={ar ? 'التقدم' : 'Progress'} summary={active ? STAGE_LABEL[active.id][language] : stages.every(stage => stage.state === 'done') ? STAGE_STATE.done[language] : null}>
            <ol className="progress-stages">{stages.map(stage => <li key={stage.id} data-state={stage.state} aria-current={stage === active ? 'step' : undefined}>
              <span className="progress-dot" aria-hidden="true" /><span>{STAGE_LABEL[stage.id][language]}{stage.total ? <bdi dir="ltr"> ({stage.done}/{stage.total}{stage.failed ? (ar ? ` · ${stage.failed} فشل` : ` · ${stage.failed} failed`) : ''})</bdi> : null}</span>
              <em>{STAGE_STATE[stage.state][language]}</em></li>)}</ol>
          </Card>
          <Card id="used" title={ar ? 'السياق المستخدم' : 'Used in this task'} summary={used.filesRead.length + used.filesChanged.length + used.pages.length + used.skills.length + used.tools.length}>
            <h4 className="used-h">{ar ? 'ملفات مقروءة' : 'Files read'}</h4><Folded items={used.filesRead} ar={ar} empty={none} />
            <h4 className="used-h">{ar ? 'ملفات معدّلة' : 'Files changed'}</h4><Folded items={used.filesChanged} ar={ar} empty={none} />
            <h4 className="used-h">{ar ? 'صفحات ويب' : 'Web pages'}</h4><Folded items={used.pages} ar={ar} empty={none} />
            <h4 className="used-h">{ar ? 'مهارات' : 'Skills'}</h4><Folded items={used.skills} ar={ar} empty={none} />
            <h4 className="used-h">{ar ? 'أدوات' : 'Tools'}</h4><Folded items={used.tools} ar={ar} empty={none} />
          </Card>
        </>
      })()}

      <Card id="environment" title={ar ? 'البيئة' : 'Environment'} summary={ar ? 'هذا الجهاز' : 'This computer'}>
        <ul className="side-env">
          <li><Monitor size={15} />{ar ? 'هذا الجهاز' : 'This computer'}<span className="side-env-end">Windows</span></li>
          <li><Cpu size={15} />{ar ? 'محرك نجد' : 'NAJD engine'}<span className={'side-env-end ' + (runtime?.active ? 'state-on' : 'state-off')}>{runtime?.active ? (ar ? 'جاهز' : 'Ready') : runtime ? (ar ? 'يتجهز' : 'Preparing') : '—'}</span></li>
          <li><Globe2 size={15} />{p.browser}<span className={'side-env-end ' + (browserConnected ? 'state-on' : 'state-off')}>{browserConnected ? p.on : p.off}</span></li>
          {companion && <li><Monitor size={15} />{p.companion}
            <button type="button" role="switch" className="market-switch side-env-end" aria-checked={companion.state === 'connected'} aria-label={p.companion}
              disabled={['connecting', 'disconnecting'].includes(companion.state)} onClick={() => { void toggleCompanion() }} /></li>}
          <li><BadgeCheck size={15} />{p.provider}<bdi className="side-env-end" dir="ltr">{provider}{model ? ' · ' + model : ''}</bdi></li>
        </ul>
      </Card>

      <Card id="context" title={p.context} summary={contextWindow ? <>{Math.min(100, Math.round(estimated / contextWindow * 100))}%
        <span className="side-card-meter" aria-hidden="true"><i style={{ width: Math.min(100, estimated / contextWindow * 100) + '%' }} /></span></> : request ? compact(estimated) : null}>
        {request || contextWindow ? <>
          <p className="context-figure">
            <strong>{request && contextWindow ? `${Math.min(100, Math.round(estimated / contextWindow * 100))}% ${p.used}` : request ? number(estimated) : '0% ' + p.used}</strong>
            <span>{contextWindow ? `${compact(estimated)} / ${compact(contextWindow)}` : p.tokensEstimated}</span>
          </p>
          <div className="context-strata" role="img" aria-label={`${p.lastRequest}: ${number(estimated)} ${p.tokensEstimated}`}>
            {request && PARTS.map(key => <span key={key} data-part={key} style={{ flexGrow: Math.max(1, tokens(request[key])) }} />)}
            {contextWindow ? <span data-part="free" style={{ flexGrow: Math.max(0, contextWindow - estimated) }} /> : null}
          </div>
          {request && <dl className="context-legend">
            {PARTS.map(key => <div key={key} data-part={key}><dt>{p.parts[key]}</dt><dd>{compact(tokens(request[key]))}</dd>
              <dd className="context-share">{contextWindow ? (tokens(request[key]) / contextWindow * 100).toFixed(1) + '%' : ''}</dd></div>)}
            {contextWindow ? <div data-part="free"><dt>{p.free}</dt><dd>{compact(Math.max(0, contextWindow - estimated))}</dd>
              <dd className="context-share">{(Math.max(0, contextWindow - estimated) / contextWindow * 100).toFixed(1)}%</dd></div> : null}
            {request.images ? <div><dt>{p.images}</dt><dd>{number(request.images)}</dd><dd className="context-share">{p.notEstimated}</dd></div> : null}
          </dl>}
          <p className="side-panel-note">{contextWindow ? `${p.windowOf} ${last && !sameModel ? (last.modelName || '') : model}: ${number(contextWindow)}` : p.windowUnknown}</p>
        </> : <p className="side-panel-note">{p.windowUnknown}</p>}
      </Card>

      <Card id="skills" title={ar ? 'المهارات' : 'Skills'} summary={`${skills.filter(item => item.installed).length} ${ar ? 'مثبّت' : 'installed'}`}>
        <CatalogList items={skills} ar={ar} onOpen={() => onOpen?.('skills', true)} />
      </Card>
      <Card id="plugins" title={ar ? 'الإضافات' : 'Plugins'} summary={`${plugins.filter(item => item.installed).length} ${ar ? 'مثبّت' : 'installed'}`}>
        <CatalogList items={plugins} ar={ar} onOpen={() => onOpen?.('plugins', true)} />
      </Card>
      <Card id="connections" title={p.connections} summary={`${connected} / ${connectionCount} ${p.on}`}>
        <CatalogList items={connectionList} ar={ar} onOpen={() => onOpen?.('connections', true)} />
      </Card>
      <Card id="memory" title={ar ? 'الذاكرة' : 'Memory'} summary={catalogs.memories.length}>
        {catalogs.memories.length ? <ul className="side-catalog">{catalogs.memories.slice(0, 5).map(note => <li key={note.id}><strong dir="auto">{note.title}</strong><span dir="auto">{note.text}</span></li>)}</ul>
          : <p className="side-panel-note">{ar ? 'لا توجد ذكريات بعد؛ يتعلم نجد تفضيلاتك مع الاستخدام.' : 'No memories yet; NAJD learns your preferences as you work together.'}</p>}
        <button type="button" className="side-more" onClick={() => onOpen?.('memory', false)}>{ar ? `${catalogs.memories.length} محفوظة · فتح الذاكرة` : `${catalogs.memories.length} saved · Open memory`}</button>
      </Card>

      {!conversationId ? <p className="side-panel-empty">{p.empty}</p> : <>
      <Card id="profile" title={p.profile} summary={activeProfile ? profileTitle(activeProfile) : p.autoShort}>
        <p className="side-panel-note">{activeProfile ? (pinned ? p.pinned : p.chosen) + ' ' + profileTitle(activeProfile) : p.auto}</p>
        {activeProfile === 'computer' && <p className="side-panel-note profile-workflow"><Monitor size={15} aria-hidden="true" />{ar ? 'ملاحظة النافذة ← تنفيذ الإجراء ← التحقق من النتيجة. الصور حسب دعم النموذج.' : 'Observe the window → act → verify the result. Images depend on model support.'}</p>}
        <div className="profile-picker" role="radiogroup" aria-label={p.profile}>
          <button type="button" role="radio" aria-checked={!pinned} className={!pinned ? 'active' : ''} onClick={() => onPin(null)}>{p.autoShort}</button>
          {(data?.profiles || []).map(item => <button key={item.id} type="button" role="radio" aria-checked={pinned === item.id}
            className={pinned === item.id ? 'active' : ''} onClick={() => onPin(item.id)}>{item.title[language]}</button>)}
        </div>
        {last?.toolsets.length ? <p className="side-panel-note">{p.toolsets}: <bdi dir="ltr">{last.toolsets.join(', ')}</bdi></p> : null}
      </Card>

      <Card id="usage" title={p.usage} summary={totals && totals.runs && totals.total !== null ? compact(totals.total) : null}>
        {totals && totals.runs ? <dl className="usage-grid">
          <div><dt>{p.total}</dt><dd>{number(totals.total)}{totals.partial ? ' ' + p.partial : ''}</dd></div>
          <div><dt>{p.input}</dt><dd>{number(totals.input)}</dd></div>
          <div><dt>{p.output}</dt><dd>{number(totals.output)}</dd></div>
          <div><dt>{p.cached}</dt><dd>{totals.cached === null ? p.notReported : number(totals.cached)}</dd></div>
          <div><dt>{p.modelCalls}</dt><dd>{number(totals.modelCalls)}</dd></div>
          <div><dt>{p.toolCalls}</dt><dd>{number(totals.toolCalls)}</dd></div>
        </dl> : <p className="side-panel-note">{p.noRuns}</p>}
      </Card>

      <Card id="outputs" title={p.outputs} summary={data?.outputs.length ?? 0}>
        {data?.outputs.length ? <ul className="side-list">{data.outputs.slice().reverse().map(item =>
          <li key={item.at + (item.path || '')} title={item.path || ''} className="side-output">
            {item.path && conversationId && window.najdAgent?.openOutput
              ? <button type="button" className="side-output-open" onClick={() => { void window.najdAgent!.openOutput!(conversationId, item.path!, 'open').catch(() => {}) }}><bdi dir="ltr">{item.name}</bdi></button>
              : <bdi dir="ltr">{item.name}</bdi>}
            {item.path && conversationId && window.najdAgent?.openOutput
              ? <button type="button" className="side-output-folder" title={ar ? 'إظهار في المجلد' : 'Show in folder'} aria-label={ar ? 'إظهار في المجلد' : 'Show in folder'}
                onClick={() => { void window.najdAgent!.openOutput!(conversationId, item.path!, 'reveal').catch(() => {}) }}><FolderOpen size={14} /></button>
              : <span>{item.kind === 'media' ? p.media : p.file}</span>}
          </li>)}</ul>
          : <p className="side-panel-note">{p.noOutputs}</p>}
      </Card>

      <Card id="jobs" title={p.jobs} summary={data?.jobs.length ?? 0}>
        {data?.jobs.length ? <ul className="side-list">{data.jobs.slice().reverse().map(job =>
          <li key={job.jobId} title={job.output?.path || ''}><span>{job.prompt || job.jobId}</span><span className={job.state === 'completed' ? 'state-on' : ''}>{p.jobStates[job.state as keyof typeof p.jobStates] || job.state}</span></li>)}</ul>
          : <p className="side-panel-note">{p.noJobs}</p>}
      </Card>
      </>}
    </div>
  </aside>
}
