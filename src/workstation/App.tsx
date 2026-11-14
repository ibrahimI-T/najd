import { useEffect, useMemo, useState } from 'react'
import { AppWindow, CirclePlus, FolderOpen, MessageCircle, Monitor, CalendarClock, Download, ChevronDown, FolderPlus, LayoutDashboard, Menu as MenuIcon, PanelLeftClose, PanelLeftOpen, PanelRight, Plus, Puzzle, Search as SearchIcon, Settings2, Smartphone, Trash2, UserRound } from 'lucide-react'
import { useProviders } from '../useProviders'
import { Composer } from './Composer'
import { Thread } from './Conversation'
import { Dashboard } from './Dashboard'
import { Hub } from './Hub'
import { Profile } from './Profile'
import { Notices } from './Notices'
import { loadPrefs, RAIL, savePrefs, WORKBENCH, type Prefs } from './prefs'
import { RemoteControl } from './RemoteControl'
import { Settings } from './Settings'
import { TaskCenter } from './TaskCenter'
import type { BrowserTab, Route, SettingsRoute } from './types'
import { Banner, Button, Dialog, Empty, Field, IconButton, LangContext, Menu, MenuItem, Page, Row, Search, Section, SplitHandle } from './ui'
import { useConversation } from './useConversation'
import { closeTab, emptyWorkbench, openTab, retitle, type WorkbenchTab } from './workbenchState'
import { Workbench } from './Workbench'
import './shell.css'

function ProjectPage({ project, chat, onOpen, onClose }: { project: NajdProject; chat: ReturnType<typeof useConversation>; onOpen: (id: string) => void; onClose: () => void }) {
  const ar = document.documentElement.lang === 'ar', s = (a: string, e: string) => ar ? a : e, api = window.najdProjects
  const [instructions, setInstructions] = useState(project.instructions), [failure, setFailure] = useState(false)
  useEffect(() => { setInstructions(project.instructions) }, [project.id])
  const run = async (work: () => Promise<unknown>) => { setFailure(false); try { await work(); await chat.refreshProjects() } catch { setFailure(true) } }
  const conversations = chat.sessions.filter(item => project.chats.includes(item.id))
  return <Page title={project.name} actions={<><Button variant="primary" icon={Plus} onClick={() => { chat.newTask(project.id); onClose() }}>{s('مهمة في المشروع', 'Task in this project')}</Button><Button variant="danger" icon={Trash2} onClick={() => { if (window.confirm(s('حذف المشروع؟ تبقى المحادثات.', 'Delete the project? Its conversations stay.'))) void run(() => api!.remove(project.id)).then(onClose) }}>{s('حذف', 'Delete')}</Button></>}>
    {failure && <Banner tone="error">{s('تعذر الحفظ.', 'Could not save.')}</Banner>}
    <Section title={s('تعليمات المشروع', 'Project instructions')}><Field label={s('التعليمات', 'Instructions')}><textarea rows={5} dir="auto" value={instructions} onChange={event => setInstructions(event.target.value)} /></Field><Button disabled={instructions === project.instructions} onClick={() => { void run(() => api!.save({ id: project.id, name: project.name, instructions })) }}>{s('حفظ', 'Save')}</Button></Section>
    <Section title={s('المجلد', 'Folder')}><Row title={project.folder || s('بدون مجلد', 'No folder')}><Button onClick={() => { void run(() => api!.chooseFolder(project.id)) }}>{s('اختيار', 'Choose')}</Button>{project.folder && <Button onClick={() => { void run(() => api!.clearFolder(project.id)) }}>{s('إزالة', 'Remove')}</Button>}</Row></Section>
    <Section title={s('المحادثات', 'Conversations')}>{conversations.length === 0 ? <small>{s('لا توجد محادثات بعد.', 'No conversations yet.')}</small> : conversations.map(item => <Row key={item.id} title={item.title || s('مهمة', 'Task')}><Button onClick={() => onOpen(item.id)}>{s('فتح', 'Open')}</Button></Row>)}</Section>
  </Page>
}

export function App() {
  const [prefs, setPrefs] = useState<Prefs>(() => loadPrefs(localStorage))
  const change = (patch: Partial<Prefs>) => setPrefs(current => ({ ...current, ...patch }))
  const lang = prefs.language, ar = lang === 'ar', s = (a: string, e: string) => ar ? a : e
  const [route, setRoute] = useState<Route>('home')
  const [settingsRoute, setSettingsRoute] = useState<SettingsRoute>('appearance')
  const [shownProject, setShownProject] = useState<string | null>(null)
  const [workbench, setWorkbench] = useState(emptyWorkbench)
  const [browserTabs, setBrowserTabs] = useState<BrowserTab[]>([])
  const [newProject, setNewProject] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<NajdSessionSummary[] | null>(null)
  const [focus, setFocus] = useState(0)
  const [taskSeed, setTaskSeed] = useState<string | null>(null)
  const [narrow, setNarrow] = useState(() => matchMedia('(max-width: 760px)').matches)
  const [railOpen, setRailOpen] = useState(false)
  const [openSections, setOpenSections] = useState({ projects: true, tasks: true })
  const [searching, setSearching] = useState(false)
  const providers = useProviders('')
  const chat = useConversation(providers, lang, { onActive: () => setRoute('home') })
  const home = route === 'home' && !chat.activeSessionId && chat.messages.length === 0
  const work = prefs.mode === 'work'
  const collapsed = narrow ? !railOpen : prefs.railCollapsed

  useEffect(() => savePrefs(localStorage, prefs), [prefs])
  useEffect(() => {
    const root = document.documentElement
    root.lang = lang; root.dir = ar ? 'rtl' : 'ltr'; root.dataset.density = prefs.density
    root.style.setProperty('--text-body', prefs.fontSize + 'px')
    window.najdAppearance?.setScale(prefs.zoom)
    const system = matchMedia('(prefers-color-scheme: dark)')
    const apply = () => { root.dataset.theme = prefs.theme === 'system' ? (system.matches ? 'dark' : 'light') : prefs.theme }
    apply(); system.addEventListener('change', apply)
    return () => system.removeEventListener('change', apply)
  }, [prefs.theme, prefs.language, prefs.fontSize, prefs.zoom, prefs.density])
  useEffect(() => { const media = matchMedia('(max-width: 760px)'), update = () => setNarrow(media.matches); media.addEventListener('change', update); return () => media.removeEventListener('change', update) }, [])
  useEffect(() => { const text = query.trim(); if (!text || !window.najdSessions) { setResults(null); return } let live = true; const timer = setTimeout(() => { void window.najdSessions!.search(text).then(list => { if (live) setResults(list) }).catch(() => { if (live) setResults([]) }) }, 200); return () => { live = false; clearTimeout(timer) } }, [query, chat.sessions])
  useEffect(() => window.najdWorkstation?.onTabs(list => { setBrowserTabs(list); setWorkbench(state => list.reduce((next, tab) => next.tabs.some(item => item.id === 'browser:' + tab.id) ? retitle(next, 'browser:' + tab.id, tab.title || tab.url) : openTab(next, { id: 'browser:' + tab.id, kind: 'browser', title: tab.title || tab.url, browserId: tab.id }), state)) }), []) // a tab NAJD opens itself shows in the workbench too
  useEffect(() => {
    const keys = (event: KeyboardEvent) => {
      if (!event.ctrlKey) return
      if (event.key === 'n' || event.key === 'k') { event.preventDefault(); startTask() }
      if (event.key === 'b') { event.preventDefault(); change({ railCollapsed: !prefs.railCollapsed }) }
      if (event.key === ',') { event.preventDefault(); setRoute('settings') }
    }
    window.addEventListener('keydown', keys); return () => window.removeEventListener('keydown', keys)
  })
  const go = (next: Route) => { setRoute(next); if (narrow) setRailOpen(false) }
  const startTask = () => { chat.newTask(); go('home'); setFocus(value => value + 1) }
  const openChat = (id: string) => { if (!id) { go('task-center'); return } void chat.openSession(id).then(opened => { if (opened) go('home') }) }
  const addTab = (tab: WorkbenchTab) => setWorkbench(state => openTab(state, tab))
  const openBrowser = (url: string) => { void window.najdWorkstation?.tabOpen(url).then(tab => addTab({ id: 'browser:' + tab.id, kind: 'browser', title: tab.title || url, browserId: tab.id })).catch(() => chat.setErrorCode('ERROR')) }
  const closeWorkbenchTab = (id: string) => { const tab = workbench.tabs.find(item => item.id === id); if (tab?.kind === 'browser') void window.najdWorkstation?.tabClose(tab.browserId); setWorkbench(state => closeTab(state, id)) }
  const toggleWorkbench = () => setWorkbench(state => ({ ...state, open: !state.open }))
  const openApps = () => addTab({ id: 'apps', kind: 'apps', title: s('التطبيقات', 'Apps') })
  const openPage = (section: string) => { const map: Record<string, SettingsRoute> = { models: 'models', accounts: 'account-security', memory: 'conversation-memory', knowledge: 'knowledge', permissions: 'permissions-control', connections: 'mcp', browser: 'permissions-control', tools: 'diagnostics', general: 'general' }; if (section === 'skills' || section === 'plugins') { go('skills-plugins'); return } setSettingsRoute(map[section] || 'general'); go('settings') }
  const list = results ?? chat.sessions
  const projectChats = useMemo(() => new Set(chat.projects.flatMap(project => project.chats)), [chat.projects])
  const project = chat.projects.find(item => item.id === shownProject)
  const nav = (id: Route, label: string, Icon: typeof LayoutDashboard, onClick?: () => void) => <button type="button" key={id + label} className={'n-item' + (route === id && !onClick ? ' on' : '')} aria-current={route === id && !onClick ? 'page' : undefined} title={label} data-nav={id} onClick={onClick || (() => go(id))}><Icon size={17} strokeWidth={1.7} aria-hidden /><span>{label}</span></button>
  const planLabel = (() => { const current = providers.catalog.find(item => item.id === providers.provider); return current ? (current.kind === 'local' ? 'Local' : current.kind === 'subscription' ? 'Plus' : 'API') : '' })()
  const showBrowser = workbench.open && (workbench.full || !narrow)
  return <LangContext.Provider value={lang}>
    <div className="ws" data-shell="workstation" data-mode={prefs.mode}>
      {narrow && railOpen && <button type="button" className="ws-dim" aria-label={s('إغلاق القائمة', 'Close the menu')} onClick={() => setRailOpen(false)} />}
      <nav className="n-rail" data-collapsed={collapsed} aria-label={s('التنقل الرئيسي', 'Main navigation')} dir={ar ? 'rtl' : 'ltr'} style={collapsed ? undefined : { width: prefs.railWidth }}>
        <div className="n-top"><IconButton label={collapsed ? s('فتح الشريط', 'Open the rail') : s('طي الشريط', 'Collapse the rail')} icon={collapsed ? PanelLeftOpen : PanelLeftClose} onClick={() => narrow ? setRailOpen(value => !value) : change({ railCollapsed: !prefs.railCollapsed })} /></div>
        {!collapsed && <div className="n-mode" role="radiogroup" aria-label={s('الوضع', 'Mode')}>{([['work', Monitor, 'Work'], ['chat', MessageCircle, 'Chat']] as const).map(([value, Icon, label]) => <button type="button" key={value} role="radio" aria-checked={prefs.mode === value} className={prefs.mode === value ? 'on' : ''} onClick={() => change({ mode: value })} data-mode-switch={value}><Icon size={15} aria-hidden />{label}</button>)}</div>}
        <button type="button" className="n-new" disabled={chat.locked || !chat.historyReady} onClick={startTask} title={work ? s('مهمة جديدة', 'New task') : s('محادثة جديدة', 'New chat')} data-nav="new"><CirclePlus size={17} aria-hidden /><span>{work ? s('مهمة جديدة', 'New task') : s('محادثة جديدة', 'New chat')}</span><kbd dir="ltr">Ctrl</kbd><kbd dir="ltr">K</kbd></button>
        {work && nav('dashboard', s('لوحة التحكم', 'Dashboard'), LayoutDashboard)}
        {nav('skills-plugins', s('الإضافات', 'Plugins'), Puzzle)}
        {work && nav('task-center', s('مركز المهام', 'Task center'), CalendarClock)}
        {work && nav('remote-control', 'Remote control', Smartphone)}
        {work && <button type="button" className="n-item" title="Apps" data-nav="apps" onClick={openApps}><AppWindow size={17} strokeWidth={1.7} aria-hidden /><span>Apps</span><em className="n-beta">Beta</em></button>}
        {!collapsed && <div className="n-scroll">
          {work && <><button type="button" className="n-label" aria-expanded={openSections.projects} onClick={() => setOpenSections(value => ({ ...value, projects: !value.projects }))}><span>{s('مشروع', 'Projects')}</span><ChevronDown size={13} aria-hidden data-open={openSections.projects} /><span className="w-grow" /><span role="button" tabIndex={0} className="n-label-act" aria-label={s('مشروع جديد', 'New project')} title={s('مشروع جديد', 'New project')} onClick={event => { event.stopPropagation(); setNewProject('') }} onKeyDown={event => { if (event.key === 'Enter') { event.stopPropagation(); setNewProject('') } }} data-nav="new-project"><FolderPlus size={14} aria-hidden /></span></button>
          {openSections.projects && chat.projects.map(item => <div key={item.id} className="n-group"><button type="button" className={'n-row' + (route === 'project' && shownProject === item.id ? ' on' : '')} onClick={() => { setShownProject(item.id); go('project') }}><FolderOpen size={15} aria-hidden /><bdi>{item.name}</bdi></button>
            {chat.sessions.filter(session => item.chats.includes(session.id)).slice(0, 5).map(session => <button type="button" key={session.id} className={'n-row sub' + (chat.activeSessionId === session.id ? ' on' : '')} disabled={chat.locked} onClick={() => openChat(session.id)}><bdi>{session.title || s('مهمة', 'Task')}</bdi></button>)}</div>)}</>}
          <button type="button" className="n-label" aria-expanded={openSections.tasks} onClick={() => setOpenSections(value => ({ ...value, tasks: !value.tasks }))}><span>{work ? s('المهام', 'Tasks') : s('المحادثات', 'Chats')}</span><ChevronDown size={13} aria-hidden data-open={openSections.tasks} /><span className="w-grow" /><span role="button" tabIndex={0} className="n-label-act" aria-label={s('بحث', 'Search')} title={s('بحث', 'Search')} onClick={event => { event.stopPropagation(); setSearching(value => !value) }} onKeyDown={event => { if (event.key === 'Enter') { event.stopPropagation(); setSearching(value => !value) } }}><SearchIcon size={14} aria-hidden /></span></button>
          {searching && <Search value={query} onChange={setQuery} placeholder={s('ابحث في المحادثات', 'Search conversations')} />}
          {openSections.tasks && list.filter(item => results !== null || !work || !projectChats.has(item.id)).map(item => <div key={item.id} className={'n-session' + (chat.activeSessionId === item.id ? ' on' : '')}><button type="button" className="n-row" disabled={chat.locked} aria-current={chat.activeSessionId === item.id ? 'page' : undefined} onClick={() => openChat(item.id)}><bdi>{item.title || s('مهمة', 'Task')}</bdi></button><IconButton label={s('حذف ', 'Delete ') + (item.title || '')} icon={Trash2} size={13} disabled={chat.locked} onClick={() => { if (window.confirm(s('حذف هذه المحادثة؟', 'Delete this conversation?'))) void chat.deleteSession(item.id) }} /></div>)}
          {openSections.tasks && !list.length && <small className="n-none">{query ? s('لا نتائج', 'No results') : s('لا توجد محادثات بعد', 'No conversations yet')}</small>}
        </div>}
        <span className="w-grow" />
        <Menu label={s('الحساب', 'Account')} up trigger={props => <button type="button" {...props} className="n-account" data-nav="account"><span className="n-avatar" aria-hidden>{(prefs.displayName || 'N').trim().charAt(0).toUpperCase()}</span>{!collapsed && <><bdi>{prefs.displayName || 'NAJD'}</bdi><em className="n-plan">{planLabel}</em></>}</button>}>{close => <>
          <MenuItem icon={UserRound} onClick={() => { close(); go('profile') }}>{s('الملف الشخصي', 'Profile')}</MenuItem>
          <MenuItem onClick={() => { close(); setSettingsRoute('account-security'); go('settings') }}>{s('الحساب والأمان', 'Account & Security')}</MenuItem>
          <MenuItem onClick={() => { close(); setSettingsRoute('models'); go('settings') }}>{s('النماذج', 'Models')}</MenuItem>
          <MenuItem icon={Settings2} onClick={() => { close(); setSettingsRoute('appearance'); go('settings') }}>{s('الإعدادات', 'Settings')}</MenuItem></>}</Menu>
      </nav>
      {!collapsed && !narrow && <SplitHandle label={s('عرض الشريط', 'Rail width')} value={prefs.railWidth} min={RAIL.min} max={RAIL.max} side="left" onChange={railWidth => change({ railWidth })} />}
      <main className="ws-main" dir={ar ? 'rtl' : 'ltr'} data-route={route} hidden={workbench.open && workbench.full}>
        <header className="ws-bar">{narrow && <IconButton label={s('القائمة', 'Menu')} icon={MenuIcon} onClick={() => setRailOpen(true)} />}<span className="w-grow" />
          {route === 'home' && chat.activeSessionId && <IconButton label={s('تصدير المحادثة', 'Export the conversation')} icon={Download} disabled={chat.locked} onClick={() => { void window.najdSessions?.export(chat.activeSessionId!).catch(() => chat.setErrorCode('ERROR')) }} />}
          <IconButton label={s('مساحة العمل', 'Workbench')} icon={PanelRight} aria-pressed={workbench.open} onClick={toggleWorkbench} data-workbench-toggle /></header>
        <Notices noModel={providers.catalog.length > 0 && !providers.catalog.some(item => item.configured && item.kind !== 'local') && !(providers.models[providers.provider]?.length)} onModels={() => openPage('models')} onUpdates={() => openPage('general')} />
        {route === 'home' && <div className={'ws-chat' + (home ? ' home' : '')}>
          {home ? <div className="ws-hero">{work ? <h1 className="ws-wordmark" dir="ltr">NAJD<sup>WORK</sup></h1> : <h1 className="ws-wordmark" dir="ltr">NAJD</h1>}</div>
            : <Thread chat={chat} onCanvas={item => addTab({ id: 'canvas:' + item.title, kind: 'canvas', title: item.title, item })} onEdit={text => { chat.setDraft(text); setFocus(value => value + 1) }} />}
          <Composer chat={chat} providers={providers} home={home} work={work} onSettings={section => { if (section) openPage(section) }} onOpenHub={() => go('skills-plugins')} onOpenPage={openPage} focusSignal={focus} onSchedule={text => { setTaskSeed(text); go('task-center') }} />
        </div>}
        {route === 'dashboard' && <Dashboard projects={chat.projects} onOpenTab={document => addTab({ id: 'dashboard:' + document.id, kind: 'dashboard', title: document.title, documentId: document.id })} />}
        {route === 'skills-plugins' && <Hub onPrompt={text => { chat.setDraft(text); go('home'); setFocus(value => value + 1) }} onUse={entry => { chat.setDraft(ar ? `استخدم مهارة «${entry.i18n?.ar?.displayName || entry.displayName}» في: ` : `Use the skill "${entry.displayName}" for: `); go('home'); setFocus(value => value + 1) }} />}
        {route === 'task-center' && <TaskCenter providers={providers} onOpenChat={openChat} seed={taskSeed} />}
        {route === 'remote-control' && <RemoteControl />}
        {route === 'project' && (project ? <ProjectPage project={project} chat={chat} onOpen={openChat} onClose={() => go('home')} /> : <Empty title={s('المشروع غير موجود', 'The project is not there')} />)}
        {route === 'profile' && <Profile name={prefs.displayName} onName={displayName => change({ displayName })} sessions={chat.sessions} />}
        {route === 'settings' && <Settings route={settingsRoute} onRoute={setSettingsRoute} prefs={prefs} change={change} providers={providers} onOpenChat={openChat} />}
      </main>
      {workbench.open && <>
        {!workbench.full && !narrow && <SplitHandle label={s('عرض مساحة العمل', 'Workbench width')} value={prefs.workbenchWidth} min={WORKBENCH.min} max={WORKBENCH.max} side="right" onChange={workbenchWidth => change({ workbenchWidth })} />}
        <div className="ws-side" data-full={workbench.full || narrow} style={workbench.full || narrow ? undefined : { width: prefs.workbenchWidth }}>
          <Workbench state={workbench} covered={!showBrowser && !narrow || newProject !== null} tabs={browserTabs} conversationId={chat.activeSessionId} activity={chat.currentActivity} projects={chat.projects}
            onSelect={id => setWorkbench(state => ({ ...state, active: id }))} onClose={closeWorkbenchTab} onToggleFull={() => setWorkbench(state => ({ ...state, full: !state.full }))} onOpen={addTab} onOpenBrowser={openBrowser} onOpenDashboard={() => go('dashboard')} onPrompt={text => { chat.setDraft(text); go('home'); setFocus(value => value + 1) }} onFiles={() => { void window.najdLibrary?.import().then(added => { chat.setAttachments([...new Map([...chat.attachments, ...added].map(item => [item.id, item])).values()].slice(0, 20)); go('home'); setFocus(value => value + 1) }).catch(() => chat.setErrorCode('ATTACHMENT_READ_FAILED')) }} />
        </div></>}
      {newProject !== null && <Dialog title={s('مشروع جديد', 'New project')} onClose={() => setNewProject(null)} footer={<Button variant="primary" disabled={!newProject.trim()} onClick={() => { void window.najdProjects?.save({ name: newProject.trim(), instructions: '' }).then(async created => { setNewProject(null); await chat.refreshProjects(); setShownProject(created.id); go('project') }).catch(() => chat.setErrorCode('ERROR')) }}>{s('إنشاء', 'Create')}</Button>}>
        <Field label={s('الاسم', 'Name')}><input value={newProject} maxLength={80} dir="auto" onChange={event => setNewProject(event.target.value)} /></Field></Dialog>}
    </div>
  </LangContext.Provider>
}
