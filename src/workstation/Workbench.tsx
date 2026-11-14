import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { AppWindow, LayoutDashboard, Paperclip, ArrowLeft, ArrowRight, Globe, Maximize2, Minimize2, Plus, RotateCw, X } from 'lucide-react'
import { CanvasPanel } from '../ChatBlocks'
import { ArtifactFrame } from '../RichContent'
import { APPS } from './apps'
import { Dashboard } from './Dashboard'
import { SessionPanel } from './SessionPanel'
import type { BrowserTab } from './types'
import { Banner, Button, IconButton, Menu, MenuItem, useLang } from './ui'
import type { WorkbenchState, WorkbenchTab } from './workbenchState'

function BrowserPane({ tab, info, covered }: { tab: Extract<WorkbenchTab, { kind: 'browser' }>; info: BrowserTab | undefined; covered: boolean }) {
  const { s } = useLang(), api = window.najdWorkstation!
  const area = useRef<HTMLDivElement>(null)
  const [address, setAddress] = useState(info?.url || '')
  const [tools, setTools] = useState<{ name: string; description: string }[] | null>(null)
  useEffect(() => { setAddress(info?.url || ''); setTools(null) }, [info?.url])
  useLayoutEffect(() => {
    const element = area.current
    if (!element) return
    const place = () => { const box = element.getBoundingClientRect(), zoom = 1; void api.tabShow(covered ? null : tab.browserId, { x: box.x * zoom, y: box.y * zoom, width: box.width * zoom, height: box.height * zoom }) }
    place()
    const observer = new ResizeObserver(place); observer.observe(element); window.addEventListener('resize', place)
    return () => { observer.disconnect(); window.removeEventListener('resize', place); void api.tabShow(null, null) }
  }, [tab.browserId, covered, api])
  return <div className="b-pane">
    <form className="b-bar" onSubmit={event => { event.preventDefault(); void api.tabNavigate(tab.browserId, address) }}>
      <IconButton label={s('رجوع', 'Back')} icon={ArrowLeft} disabled={!info?.canGoBack} onClick={() => { void api.tabBack(tab.browserId) }} />
      <IconButton label={s('تقدم', 'Forward')} icon={ArrowRight} disabled={!info?.canGoForward} onClick={() => { void api.tabForward(tab.browserId) }} />
      <IconButton label={s('تحديث', 'Reload')} icon={RotateCw} onClick={() => { void api.tabReload(tab.browserId) }} />
      <input dir="ltr" aria-label={s('العنوان', 'Address')} value={address} onChange={event => setAddress(event.target.value)} data-browser="address" />
      <Button variant="ghost" onClick={() => { void api.tabWebMcp(tab.browserId).then(setTools).catch(() => setTools([])) }}>WebMCP</Button>
    </form>
    {info?.error && <Banner tone="error">{info.error}</Banner>}
    {tools && <Banner action={<IconButton label={s('إغلاق', 'Close')} icon={X} onClick={() => setTools(null)} />}>{tools.length ? tools.map(tool => tool.name).join(', ') : s('هذه الصفحة لا تعلن أدوات.', 'This page declares no tools.')}</Banner>}
    <div className="b-view" ref={area} data-browser="view" />
  </div>
}

export function Workbench({ state, covered, tabs, conversationId, activity, projects, onSelect, onClose, onToggleFull, onOpen, onOpenBrowser, onOpenDashboard, onPrompt, onFiles }: {
  state: WorkbenchState; covered: boolean; tabs: BrowserTab[]; conversationId: string | null; activity?: NajdTaskActivity; projects: NajdProject[]
  onSelect: (id: string) => void; onClose: (id: string) => void; onToggleFull: () => void; onOpen: (tab: WorkbenchTab) => void; onOpenBrowser: (url: string) => void; onOpenDashboard: () => void; onPrompt: (text: string) => void; onFiles: () => void
}) {
  const { s, ar, lang } = useLang()
  const active = state.tabs.find(tab => tab.id === state.active)
  useEffect(() => { if (active?.kind !== 'browser') void window.najdWorkstation?.tabShow(null, null) }, [active?.kind])
  return <aside className="wb" aria-label={s('مساحة العمل', 'Workbench')} data-workbench dir={ar ? 'rtl' : 'ltr'}>
    <div className="wb-tabs" role="tablist" aria-label={s('تبويبات مساحة العمل', 'Workbench tabs')}>
      {state.tabs.map(tab => <div key={tab.id} className={'wb-tab' + (tab.id === state.active ? ' on' : '')}><button type="button" role="tab" aria-selected={tab.id === state.active} onClick={() => onSelect(tab.id)} dir="auto">{tab.title}</button><IconButton label={s('إغلاق ', 'Close ') + tab.title} icon={X} size={12} onClick={() => onClose(tab.id)} /></div>)}
      <Menu label={s('تبويب جديد', 'New tab')} align="end" trigger={props => <IconButton {...props} label={s('تبويب جديد', 'New tab')} icon={Plus} data-workbench-new />}>{close => <>
        <MenuItem icon={AppWindow} onClick={() => { close(); onOpen({ id: 'apps', kind: 'apps', title: s('التطبيقات', 'Apps') }) }}>{s('التطبيقات', 'Apps')}</MenuItem>
        <MenuItem icon={Globe} onClick={() => { close(); onOpenBrowser('https://duckduckgo.com') }}>{s('المتصفح', 'Browser')}</MenuItem>
        <MenuItem onClick={() => { close(); onOpen({ id: 'details', kind: 'details', title: s('تفاصيل الجلسة', 'Session details') }) }}>{s('تفاصيل الجلسة', 'Session details')}</MenuItem></>}</Menu>
      <span className="w-grow" />
      <IconButton label={state.full ? s('عرض جانبي', 'Side view') : s('عرض كامل', 'Full width')} icon={state.full ? Minimize2 : Maximize2} onClick={onToggleFull} />
    </div>
    <div className="wb-body" role="tabpanel">
      {!active && <div className="wb-start" data-start-here><small>{s('ابدأ من هنا', 'Start here')}</small>
        <button type="button" onClick={() => onOpenBrowser('https://duckduckgo.com')}><Globe size={16} aria-hidden />{s('المتصفح', 'Browser')}</button>
        <button type="button" onClick={onFiles}><Paperclip size={16} aria-hidden />{s('ملف', 'File')}</button>
        <button type="button" onClick={onOpenDashboard}><LayoutDashboard size={16} aria-hidden />{s('لوحة التحكم', 'Dashboard')}</button>
        <button type="button" onClick={() => onOpen({ id: 'apps', kind: 'apps', title: s('التطبيقات', 'Apps') })}><AppWindow size={16} aria-hidden />Apps <em className="n-beta">Beta</em></button>
        <small>{s('تطبيقات مقترحة', 'Recommended apps')}</small>
        {APPS.slice(0, 8).map(app => <button type="button" key={app.id} className="wb-rec" onClick={() => { if (app.origin) onOpenBrowser(app.origin); else if (app.html) onOpen({ id: 'app:' + app.id, kind: 'app', title: app.name, html: app.html }); else if (app.prompt) onPrompt(app.prompt[ar ? 0 : 1]); else onOpenDashboard() }}><strong dir="ltr">{app.name}</strong><span>{ar ? app.ar : app.en}</span></button>)}
      </div>}
      {active?.kind === 'apps' && <div className="wb-apps" data-apps>{APPS.map(app => <button type="button" key={app.id} className="wb-app" data-app={app.id} onClick={() => { if (app.origin) onOpenBrowser(app.origin); else if (app.html) onOpen({ id: 'app:' + app.id, kind: 'app', title: app.name, html: app.html }); else if (app.prompt) onPrompt(app.prompt[ar ? 0 : 1]); else onOpenDashboard() }}>
        <strong dir="ltr">{app.name}</strong><small>{ar ? app.ar : app.en}</small><small className="wb-origin" dir="ltr">{app.origin ? new URL(app.origin).host : app.html ? s('معزول', 'Isolated') : app.prompt ? s('مهمة', 'Task') : s('محلي', 'Local')}</small></button>)}</div>}
      {active?.kind === 'app' && <ArtifactFrame source={active.html} ar={ar} bare />}
      {active?.kind === 'browser' && <BrowserPane tab={active} info={tabs.find(item => item.id === active.browserId)} covered={covered} />}
      {active?.kind === 'canvas' && <CanvasPanel item={active.item} language={lang} onClose={() => onClose(active.id)} />}
      {active?.kind === 'details' && <SessionPanel conversationId={conversationId} activity={activity} project={projects.find(item => !!conversationId && item.chats.includes(conversationId)) || null} />}
      {active?.kind === 'dashboard' && <Dashboard documentId={active.documentId} projects={projects} />}
    </div>
  </aside>
}
