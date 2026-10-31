import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft, ArrowRight, ArrowUp, Brain, Command,
  Blocks, Globe2, KeyRound, LayoutGrid, Library, MessageSquareText, Monitor,
  Moon, Plus, Settings2, ShieldCheck, SlidersHorizontal, Sparkles,
  Square, Sun, Trash2, WandSparkles, Search, Download, PanelRight, Layers, Send, FolderKanban, FolderPlus
} from 'lucide-react'
import { SidePanel } from './SidePanel'
import { ProjectView } from './ProjectView'
import { CanvasPanel, CanvasProvider, type CanvasItem } from './ChatBlocks'
import { getCopy } from './copy'
import { ProviderSettings } from './ProviderSettings'
import { GatewaySettings } from './GatewaySettings'
import { LegalNotices } from './LegalNotices'
import { DiagnosticsSettings, StabilityNotice, UpdateSettings, useUpdates } from './UpdateSettings'
import { CommunityLinks } from './CommunityLinks'
import { RuntimeBanner, RuntimeSettings } from './RuntimeSettings'
import { ComposerModels } from './ComposerModels'
import { ChatMessage } from './ChatMessage'
import { TaskActivity, type WorkRun } from './TaskActivity'
import { nextTaskState } from './taskWatch'
import { useChatScroll } from './useChatScroll'
import { AccessModeMenu, normalizeAccessMode, type AccessMode } from './AccessMode'
import { useProviders } from './useProviders'
import { accessibleAccent, accentInk } from './color'
import { buildModelHistory, selectChatAssetIds } from './chat-context'
import { parsePreferences, updatePreferences, type Preferences } from './preferences'
import { SettingRow, Segmented, StatusPill, InfoNote, CardHeading } from './ui'
import { CapabilitySettings } from './CapabilitySettings'
import { McpSettings } from './McpSettings'
import { FeatureMap } from './FeatureMap'
import { Starfield } from './Starfield'
import { SkillsCatalog, PluginsCatalog, ConnectionsCatalog } from './Catalogs'
import { ToolsCatalog } from './ToolsCatalog'
import { CapabilityAtlas } from './CapabilityAtlas'
import { AccountsSettings } from './AccountsSettings'
import { WholeComputerAccess } from './WholeComputerAccess'
import { PackSettings } from './PackSettings'
import { BrowserSettings } from './BrowserSettings'
import { MemorySettings } from './MemorySettings'
import { AttachmentPicker } from './AttachmentPicker'
import { AttachmentChips, importFromTransfer } from './AttachmentChips'
import { ActionRecovery } from './ActionRecovery'
import { AppRail } from './AppRail'
import { KnowledgeBases } from './KnowledgeBases'
import najdLogo from './assets/najd-logo.jpg'
import najdBackground from './assets/najd-background.webp'
import { InstructionSkillsSettings } from './InstructionSkillsSettings'
import { visibleInterval } from './useVisibleInterval'
import { SlashMenu } from './SlashMenu'
import { activeMentions, filterMentionable, insertMention, mentionQuery, referenceBlock, rememberMentions, type Mention } from './mentions'
import { PluginInstaller } from './PluginInstaller'
import { ChannelsSettings } from './ChannelsSettings'
import { Welcome, welcomeSeen, markWelcomeSeen } from './Welcome'
import { buildSlashItems, filterSlash, slashQuery, type SlashItem } from './slashCommands'

type Section = 'channels' | 'general' | 'models' | 'connections' | 'browser' | 'tools' | 'skills' | 'plugins' | 'atlas' | 'accounts' |
  'permissions' | 'memory' | 'knowledge' | 'advanced'

const sections = [
  ['general', SlidersHorizontal], ['models', Sparkles], ['connections', LayoutGrid],
  ['browser', Globe2], ['tools', Command], ['skills', WandSparkles],
  ['permissions', ShieldCheck], ['memory', Brain], ['knowledge', Library],
  ['plugins', Blocks], ['atlas', Layers], ['accounts', KeyRound], ['channels', Send], ['advanced', Settings2]
] as const

const prefKey = 'najd.preferences.v1'
const sidebarKey = 'najd.sidebar-collapsed.v1'
const accessKey = 'najd.access-mode.v1'

type Notice = 'model' | 'runtime' | 'error' | 'history' | 'offline' | 'missingModel' | 'timeout' | 'auth' | 'quota' | 'rejected' | 'cancelled' | 'plan' |
  'fileNoRoots' | 'fileNotAllowed' | 'fileSensitive' | 'fileTooLarge' | 'fileBinary' | 'fileNotAFile' | 'fileRead' | 'fileGeneric' | 'windowsUnavailable' | 'unknownEffect' | 'providerLimit' | 'providerPolicy' | 'modelTools' | 'attachmentProvider' | 'attachmentImport' | 'recovery' | 'attachment' | 'processesRunning' | 'chatBusy'

function noticeForError(code: string | null): Notice {
  switch (code) {
    case 'ATTACHMENT_READ_FAILED': return 'attachment'
    case 'JOURNAL_CORRUPT':
    case 'JOURNAL_LIMIT':
    case 'ACTION_REPLAY_BLOCKED': return 'recovery'
    case 'TOOLS_NOT_SUPPORTED': return 'modelTools'
    case 'CONTEXT_LIMIT':
    case 'PROVIDER_BUSY':
    case 'BUDGET_EXCEEDED': return 'providerLimit'
    case 'PROVIDER_POLICY_UNAVAILABLE': return 'providerPolicy'
    case 'UNKNOWN_EFFECT': return 'unknownEffect'
    case 'WINDOWS_NODE_NOT_INSTALLED':
    case 'WINDOWS_NODE_FAILED': return 'windowsUnavailable'
    case 'MODEL_NOT_CONFIGURED': return 'model'
    case 'OLLAMA_UNAVAILABLE': return 'offline'
    case 'MODEL_NOT_FOUND': return 'missingModel'
    case 'PROVIDER_TIMEOUT': return 'timeout'
    case 'AUTH_REQUIRED':
    case 'AUTH_INVALID_RESPONSE':
    case 'CREDENTIAL_UNAVAILABLE': return 'auth'
    case 'PROVIDER_RATE_LIMIT': return 'quota'
    case 'PROVIDER_REJECTED': return 'rejected'
    case 'NO_ROOTS': return 'fileNoRoots'
    case 'PATH_NOT_ALLOWED': return 'fileNotAllowed'
    case 'SENSITIVE_FILE': return 'fileSensitive'
    case 'FILE_TOO_LARGE': return 'fileTooLarge'
    case 'BINARY_FILE': return 'fileBinary'
    case 'NOT_A_FILE': return 'fileNotAFile'
    case 'READ_FAILED': return 'fileRead'
    case 'CANCELLED': return 'cancelled'
    case 'PLAN_NOT_ENABLED': return 'plan'
    default: return 'error'
  }
}
const colorPresets = [
  { name: 'royalBlue', value: '#2f8cff' },
  { name: 'sky', value: '#278ec9' },
  { name: 'violet', value: '#865ecb' },
  { name: 'teal', value: '#188e97' }
] as const

// A short line for the browser extension: the kind and target of the latest recorded step (already redacted and bounded).
function progressLine(task: NajdTask): string {
  const events = task.activity?.events ?? []
  const last = [...events].reverse().find(event => event.type.startsWith('tool.') || event.type === 'approval.requested')
  return last ? `${last.tool || last.type}${last.detail ? ': ' + last.detail : ''}`.slice(0, 190) : ''
}

export function App() {
  const updates = useUpdates()
  const [preferences, setPreferences] = useState<Preferences>(() => parsePreferences(localStorage.getItem(prefKey)))
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem(sidebarKey) === '1')
  const [accessMode, setAccessMode] = useState<AccessMode>(() => normalizeAccessMode(localStorage.getItem(accessKey)))
  const [narrowRail, setNarrowRail] = useState(() => matchMedia('(max-width: 680px)').matches)
  const [section, setSection] = useState<Section>('general')
  // Opening skills or connections from the right panel's Installed count shows only what is installed.
  const [catalogInstalled, setCatalogInstalled] = useState(false)
  const [focusUpdates, setFocusUpdates] = useState(false)
  const openUpdates = () => { setSection('general'); setSettingsOpen(true); setFocusUpdates(true) }
  useEffect(() => {
    if (!focusUpdates || !settingsOpen || section !== 'general') return
    document.querySelector('.update-card')?.scrollIntoView({ block: 'start' })
    setFocusUpdates(false)
  }, [focusUpdates, settingsOpen, section])
  const [draft, setDraft] = useState('')
  const [attachments, setAttachments] = useState<NajdAsset[]>([])
  // Projects: the list, the one shown, and the project a new chat will join when its first message is sent.
  const [projects, setProjects] = useState<NajdProject[]>([])
  const [shownProject, setShownProject] = useState<string | null>(null)
  const [chatProject, setChatProject] = useState<string | null>(null)
  const [newProjectName, setNewProjectName] = useState<string | null>(null)
  async function refreshProjects() { try { if (window.najdProjects) setProjects(await window.najdProjects.list()) } catch {} }
  useEffect(() => { void refreshProjects() }, [])
  const projectOfChat = (id: string | null) => id ? projects.find(project => project.chats.includes(id)) || null : null
  // Earlier chats the owner mentioned with @ in the message being written.
  const [mentions, setMentions] = useState<Mention[]>([])
  const [importing, setImporting] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [messages, setMessages] = useState<NajdMessage[]>([])
  const [localPreview, setLocalPreview] = useState<{ sessionId: string | null; text: string } | null>(null)
  const [sessions, setSessions] = useState<NajdSessionSummary[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<NajdSessionSearchResult[] | null>(null)
  const [searchFailed, setSearchFailed] = useState(false)
  const [exportFeedback, setExportFeedback] = useState<string | null>(null)
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  // Profile pinned by the user per conversation (agent platform M1); none means automatic selection.
  const [profilePins, setProfilePins] = useState<Record<string, string>>(() => { try { return JSON.parse(localStorage.getItem('najd.profilePins.v1') || '{}') || {} } catch { return {} } })
  const pinnedProfile = (sessionId: string | null) => sessionId ? profilePins[sessionId] || null : null
  const pinProfile = (profile: string | null) => { if (!activeSessionId) return; setProfilePins(pins => { const next = { ...pins }; if (profile) next[activeSessionId] = profile; else delete next[activeSessionId]; return next }) }
  useEffect(() => { try { localStorage.setItem('najd.profilePins.v1', JSON.stringify(profilePins)) } catch {} }, [profilePins])
  // Session details panel on the right; its open state is remembered.
  // A code block, page or diagram opened beside the conversation (it takes the place of the side panel while open).
  const [canvas, setCanvas] = useState<CanvasItem | null>(null)
  useEffect(() => { setCanvas(null) }, [activeSessionId])
  const [panelOpen, setPanelOpen] = useState<boolean>(() => { try { return localStorage.getItem('najd.sidePanel.v1') === 'open' } catch { return false } })
  useEffect(() => { try { localStorage.setItem('najd.sidePanel.v1', panelOpen ? 'open' : 'closed') } catch {} }, [panelOpen])
  const panelToggle = useRef<HTMLButtonElement>(null)
  const closePanel = () => { setPanelOpen(false); panelToggle.current?.focus() }
  useEffect(() => { setAttachments([]) }, [activeSessionId])
  const [historyReady, setHistoryReady] = useState(!window.najdSessions)
  const [notice, setNotice] = useState<Notice | null>(null)
  // The code behind a generic failure, shown with it so a report names the cause.
  const [noticeCode, setNoticeCode] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null)
  const [workRuns, setWorkRuns] = useState<WorkRun[]>([])
  function beginWork(sessionId: string | null, afterIndex: number) {
    const key = `${sessionId}:${afterIndex}`
    setWorkRuns(runs => runs.some(run => run.key === key) ? runs.map(run => run.key === key ? {...run, finishedAt:undefined} : run) : [...runs.slice(-39), {key, sessionId, afterIndex, startedAt:Date.now(), steps:[]}])
    return key
  }
  function recordWork(key: string, task: NajdTask) {
    const step = {state:task.state, proposedTool:task.proposedTool, reasoningEffort:task.reasoningEffort}
    setWorkRuns(runs => {
      const current = runs.find(run => run.key === key)
      if (!current || JSON.stringify(current.steps.at(-1)) === JSON.stringify(step) && JSON.stringify(current.activity) === JSON.stringify(task.activity)) return runs
      return runs.map(run => run.key === key ? {...run,activity:task.activity,steps:JSON.stringify(run.steps.at(-1))===JSON.stringify(step)?run.steps:[...run.steps.slice(-19),step]} : run)
    })
  }
  function finishWork(key: string) { setWorkRuns(runs => runs.map(run => run.key === key ? {...run,finishedAt:run.steps.at(-1)?.state==='WAITING_APPROVAL'?undefined:Date.now()} : run)) }
  const providers = useProviders(draft)
  const selectedProvider = providers.provider
  const [browserStatus, setBrowserStatus] = useState<NajdBrowserStatus>({ active: false, connected: false, paired: false })
  const [approval, setApproval] = useState<{ approvalId: string, taskId?: string, path: string, tool: string, sessionId: string | null, localOnly: boolean, fromSkill?: boolean, agent?: { summary: string, body: string } } | null>(null)
  const scroll = useChatScroll(activeSessionId, [messages, busy, approval, workRuns, localPreview, settingsOpen])
  const [fileRoots, setFileRoots] = useState<string[]>([])
  // Whole-computer access, shown at the bottom of the sidebar (green when on).
  const [wholeComputer, setWholeComputer] = useState(false)
  useEffect(() => { void window.najdFiles?.wholeComputer?.().then(value => setWholeComputer(value.wholeComputer)).catch(() => {}) }, [])
  const [activityEntries, setActivityEntries] = useState<NajdActivityEntry[]>([])
  const [permissionsError, setPermissionsError] = useState(false)
  const t = getCopy(preferences.language)
  // The agent's own work (activity, tool steps, thinking, approval details and the session panel) is shown in English in
  // both languages; Arabic is for the app shell and settings (owner request 2026-10-31). Replies follow the user's language.
  const tEn = getCopy('en')
  const isArabic = preferences.language === 'ar'
  const BackIcon = isArabic ? ArrowRight : ArrowLeft
  const noticeText: Record<Notice, string> = {
    attachment: isArabic ? 'تعذّر قراءة المرفق. أعد إرفاقه من المكتبة قبل إرسال السؤال؛ لم يُرسل محتواه إلى النموذج.' : 'The attachment could not be read. Attach it again from the library before sending your question; its content was not sent to the model.',
    chatBusy: isArabic ? 'لم تُحذف المحادثة لأن فيها مهمة قيد التنفيذ. أوقفها أو انتظر حتى تنتهي، ثم احذفها.' : 'The chat was not deleted: it has a task running. Stop it or let it finish, then delete it.',
    processesRunning: isArabic ? 'لم تُحذف المحادثة لأن فيها أوامر تعمل في الخلفية ولم يتأكد نجد من إيقافها. حاول مرة أخرى بعد لحظات.' : 'The chat was not deleted: it has background commands that could not be confirmed stopped. Try again in a moment.',
    recovery: isArabic ? 'تعذّر متابعة الإجراء من سجله. راجع الإجراءات السابقة قبل طلبه مرة أخرى.' : 'The recorded action could not continue. Review previous actions before requesting it again.',
    modelTools: t.modelToolsUnavailable,
    attachmentProvider: isArabic ? 'النموذج المختار رفض المرفق. غالبًا لا يستطيع رؤية الصور: جرّب نموذجًا يدعم الصور، أو أرسل الملف بدون صورة.' : 'The selected model refused the attachment. It probably cannot see pictures: try a model that accepts images, or send the file without a picture.',
    attachmentImport: isArabic ? 'تعذّر إضافة الملف. الصيغ المدعومة: نصوص وPDF وWord وصور (PNG/JPEG/WebP/GIF/BMP) وفيديو (MP4/WebM/MOV)، بحد 25 ميجا للمستندات والصور.' : 'The file could not be added. Supported: text, PDF, Word, images (PNG/JPEG/WebP/GIF/BMP) and video (MP4/WebM/MOV); documents and images up to 25 MB.',
    providerLimit: t.providerLimitNotice, providerPolicy: t.providerPolicyNotice,
    model: t.modelMissing, offline: t.localModelOfflineHelp, missingModel: t.localModelMissing,
    timeout: t.localModelTimeout, auth: selectedProvider === 'chatgpt' ? t.chatgptAuthRequired : t.providerAuth,
    quota: selectedProvider === 'chatgpt' ? t.chatgptQuota : t.providerQuota, rejected: t.providerConnectError,
    runtime: t.runtimeMissing, history: t.historyFailed, error: t.taskFailed,
    fileNoRoots: t.fileErrorNoRoots, fileNotAllowed: t.fileErrorNotAllowed, fileSensitive: t.fileErrorSensitive,
    fileTooLarge: t.fileErrorTooLarge, fileBinary: t.fileErrorBinary, fileNotAFile: t.fileErrorNotAFile,
    fileRead: t.fileErrorRead, fileGeneric: t.fileErrorGeneric, cancelled: t.taskCancelled, plan: t.planUnavailable, windowsUnavailable: t.windowsUnavailable, unknownEffect: t.unknownEffect
  }
  const activityLabel = (action?: string) => action === 'grant-root' ? t.activityGrant :
    action === 'revoke-root' ? t.activityRevoke : action === 'read-file' ? t.activityRead : action === 'find-documents' ? t.activityFind :
    action === 'approval' ? t.activityApproval : action || ''
  const activityTime = (time?: string) => {
    const parsed = Date.parse(time || '')
    return Number.isFinite(parsed) ? new Date(parsed).toLocaleString(isArabic ? 'ar-SA' : 'en-US', { dateStyle: 'short', timeStyle: 'short' }) : time
  }

  useEffect(() => {
    localStorage.setItem(prefKey, JSON.stringify(preferences))
    document.documentElement.lang = preferences.language
    document.documentElement.dir = isArabic ? 'rtl' : 'ltr'
    if (window.najdAppearance) window.najdAppearance.setScale(preferences.fontScale)
    else document.documentElement.style.zoom = String(preferences.fontScale)
    const systemTheme = matchMedia('(prefers-color-scheme: dark)')
    const applyTheme = () => {
      const theme = preferences.theme === 'system'
        ? (systemTheme.matches ? 'dark' : 'light') : preferences.theme
      document.documentElement.dataset.theme = theme
      const accent = accessibleAccent(preferences.accent, theme)
      document.documentElement.style.setProperty('--accent', accent)
      document.documentElement.style.setProperty('--accent-ink', accentInk(accent))
    }
    applyTheme()
    systemTheme.addEventListener('change', applyTheme)
    return () => systemTheme.removeEventListener('change', applyTheme)
  }, [preferences, isArabic])

  useEffect(() => {
    if (settingsOpen && section === 'permissions') void refreshPermissions()
  }, [settingsOpen, section])

  // Narrow windows show the settings nav as a horizontal pill strip; map the
  // vertical wheel to horizontal scrolling so mouse users can reach every tab.
  const settingsNavRef = useRef<HTMLElement>(null)
  const composerRef = useRef<HTMLTextAreaElement>(null)
  // The "/" menu: typing "/" at the start of the message lists local commands (chat, pages, access, task type, effort, skills).
  const [slashIndex, setSlashIndex] = useState(0)
  const [mentionClosed, setMentionClosed] = useState<string | null>(null)
  const [slashClosed, setSlashClosed] = useState<string | null>(null)   // the draft text the menu was closed for (Escape); it reopens when the text changes
  const [slashSkills, setSlashSkills] = useState<{ id: string; name: string; description: string }[]>([])
  const [slashPlugins, setSlashPlugins] = useState<NajdPluginCommand[]>([])
  useEffect(() => {
    if (settingsOpen || !window.najdSkills) return
    void window.najdPlugins?.commands().then(setSlashPlugins).catch(() => {})
    void window.najdSkills.list().then(list => setSlashSkills(list.filter(skill => skill.enabled).map(({ id, name, description }) => ({ id, name, description })))).catch(() => {})
  }, [settingsOpen])
  useEffect(() => {
    if (!draft && composerRef.current) composerRef.current.style.height = ''
  }, [draft])
  useEffect(() => {
    const nav = settingsNavRef.current
    if (!nav) return
    const onWheel = (event: WheelEvent) => {
      if (nav.scrollWidth <= nav.clientWidth || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return
      event.preventDefault()
      nav.scrollLeft += event.deltaY * (getComputedStyle(nav).direction === 'rtl' ? -1 : 1)
    }
    nav.addEventListener('wheel', onWheel, { passive: false })
    return () => nav.removeEventListener('wheel', onWheel)
  }, [settingsOpen])

  useEffect(() => {
    const query = matchMedia('(max-width: 680px)')
    const onChange = () => setNarrowRail(query.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])

  const [narrowOpen, setNarrowOpen] = useState(false)
  const rail = sidebarCollapsed || (narrowRail && !narrowOpen)
  useEffect(() => { localStorage.setItem(accessKey, accessMode) }, [accessMode])
  function toggleSidebar() {
    setSidebarCollapsed(current => {
      localStorage.setItem(sidebarKey, current ? '0' : '1')
      return !current
    })
  }

  async function refreshPermissions() {
    if (!window.najdFiles) return
    try {
      const [roots, entries] = await Promise.all([window.najdFiles.listRoots(), window.najdFiles.activity()])
      setFileRoots(roots)
      setActivityEntries([...entries].reverse())
      setPermissionsError(false)
    } catch { setPermissionsError(true) }
  }

  async function grantRoot() {
    if (!window.najdFiles) return
    try {
      setFileRoots(await window.najdFiles.grantRoot())
      setActivityEntries([...(await window.najdFiles.activity())].reverse())
      setPermissionsError(false)
    } catch { setPermissionsError(true) }
  }

  async function revokeRoot(root: string) {
    if (!window.najdFiles) return
    try {
      setFileRoots(await window.najdFiles.revokeRoot(root))
      setPermissionsError(false)
    } catch { setPermissionsError(true) }
  }

  useEffect(() => {
    if (!window.najdBrowser) return
    let mounted = true
    const refresh = async () => {
      try {
        const status = await window.najdBrowser!.status()
        if (mounted) setBrowserStatus(status)
      } catch { /* status stays as last known */ }
    }
    void refresh()
    const stopPolling = visibleInterval(() => { void refresh() }, 1500)
    return () => { mounted = false; stopPolling() }
  }, [])

  useEffect(() => {
    if (!window.najdSessions) return
    let mounted = true
    void (async () => {
      try {
        const list = await window.najdSessions!.list()
        if (!mounted) return
        setSessions(list)
        if (list[0]) {
          const latest = await window.najdSessions!.get(list[0].id)
          if (mounted) { setActiveSessionId(latest.id); setMessages(latest.messages) }
        }
      } catch { if (mounted) setNotice('history') }
      finally { if (mounted) setHistoryReady(true) }
    })()
    return () => { mounted = false }
  }, [])

  useEffect(() => {
    const query = searchQuery.trim()
    if (!query || !window.najdSessions) { setSearchResults(null); setSearchFailed(false); return }
    let current = true
    const timer = window.setTimeout(() => {
      void window.najdSessions!.search(query).then(results => {
        if (current) { setSearchResults(results); setSearchFailed(false) }
      }).catch(() => { if (current) { setSearchResults([]); setSearchFailed(true) } })
    }, 200)
    return () => { current = false; window.clearTimeout(timer) }
  }, [searchQuery, sessions])

  // Conversations that arrive from a messaging channel appear in the list as they happen.
  // A message that arrives from the phone (Telegram) updates the list, and the open conversation too when it is the one that changed
  // and the app is not working in it at that moment (a local run saves its own messages).
  const liveSession = useRef({ id: null as string | null, idle: true })
  liveSession.current = { id: activeSessionId, idle: !busy && !importing && !approval }
  useEffect(() => window.najdChannels?.onSessionsChanged(entry => {
    void refreshSessions()
    const { id, idle } = liveSession.current
    if (entry?.sessionId && entry.sessionId === id && idle && window.najdSessions)
      void window.najdSessions.get(id).then(session => { if (liveSession.current.id === id) setMessages(session.messages) }).catch(() => {})
  }), [])
  async function refreshSessions() {
    if (window.najdSessions) setSessions(await window.najdSessions.list())
  }

  async function openSession(id: string) {
    if (!window.najdSessions || busy || importing || approval) return
    try {
      const session = await window.najdSessions.get(id)
      setShownProject(null)
      setActiveSessionId(id)
      setMessages(session.messages)
      setSettingsOpen(false)
      setNotice(null)
      setExportFeedback(null)
    } catch { setNotice('history') }
  }

  // A new chat starts clean (owner request 2026-10-31): no attachments, files or activity of another chat; only the
  // personality settings carry over. Earlier chats are brought in on purpose with @.
  function newChat() {
    if (busy || importing || approval || !historyReady) return
    setSettingsOpen(false)
    setActiveSessionId(null)
    setDraft('')
    setMessages([])
    setAttachments([])
    setMentions([])
    setWorkRuns(runs => runs.filter(run => run.sessionId !== null))
    setChatProject(null)
    setShownProject(null)
    setNotice(null)
    setExportFeedback(null)
  }

  async function exportChat() {
    if (!activeSessionId || !window.najdSessions || busy || approval) return
    setExportFeedback(null)
    try {
      const result = await window.najdSessions.export(activeSessionId)
      if (result.saved) setExportFeedback(t.exportSaved)
    } catch (error) {
      setExportFeedback(String(error).includes('EXPORT_EXISTS') ? t.exportExists : t.exportFailed)
    }
  }

  async function deleteChat(id: string, title: string) {
    if (!window.najdSessions || busy || approval || !window.confirm(`${t.deleteChatConfirm} “${title || t.newChat}”?`)) return
    try {
      await window.najdSessions.delete(id)
      await refreshSessions()
      if (id === activeSessionId) newChat()
    } catch (error) { setNotice(String(error).includes('PROCESSES_RUNNING') ? 'processesRunning' : String(error).includes('CONVERSATION_BUSY') ? 'chatBusy' : 'history') }
  }

  function changePreferences(change: Partial<Preferences>) {
    setPreferences(current => updatePreferences(current, change))
  }

  async function appendAssistantMessage(sessionId: string | null, text: string, taskId?: string) {
    if (sessionId && window.najdSessions) {
      const updated = await window.najdSessions.append(sessionId, 'assistant', text, taskId)
      setMessages(updated.messages)
      await refreshSessions()
    } else {
      setMessages(current => [...current, { role: 'assistant', text, createdAt: new Date().toISOString() }])
    }
  }

  function approvalOf(task: NajdTask, sessionId: string | null, extra: { fromSkill?: boolean, localOnly?: boolean } = {}) {
    const input = task.proposedInput
    const agent = task.viaAgent ? { summary: input?.summary || '', body: input?.command ?? input?.preview ?? '' } : undefined
    return { approvalId: task.approvalId || '', taskId: task.id, path: [input?.path, input?.query].filter(Boolean).join(' | '), tool: task.proposedTool || '', sessionId,
      localOnly: !!task.localOnlyOutput && !agent, ...(extra.fromSkill ? { fromSkill: true } : {}), ...(agent ? { agent } : {}) }
  }

  async function addTransfer(transfer: DataTransfer, kind: 'drop' | 'paste') {
    if (busy || importing || !!approval) return
    setImporting(true); setNotice(null)
    try {
      const imported = await importFromTransfer(transfer, kind)
      if (imported.length) setAttachments(current => [...new Map([...current, ...imported].map(item => [item.id, item])).values()].slice(0, 20))
    } catch { setNotice('attachmentImport') } finally { setImporting(false) }
  }

  async function respondToApproval(decision: 'ALLOW_ONCE' | 'ALLOW_TASK' | 'DENY') {
    if (!approval || !window.najdCore?.respondApproval || busy) return
    const current = approval
    const workKey = beginWork(current.sessionId, messages.length)
    setApproval(null)
    setBusy(true)
    setNotice(null)
    try {
      let task = await window.najdCore.respondApproval(current.approvalId, decision)
      const appendResult = (text: string) => appendAssistantMessage(current.sessionId, text, task.id)
      recordWork(workKey, task)
      setActiveTaskId(task.id)
      while (task.state === 'QUEUED' || task.state === 'RUNNING') {
        task = await nextTaskState(task)
        recordWork(workKey, task)
      }
      if (task.state === 'WAITING_APPROVAL' && task.approvalId) { setApproval(approvalOf(task, current.sessionId)); return }
      if (task.viaAgent && (task.state === 'COMPLETED' || task.state === 'UNKNOWN_EFFECT') && task.output) { await appendResult(task.output); void window.najdBrowser?.askSaved(task.id); if (task.state === 'UNKNOWN_EFFECT') setNotice('unknownEffect'); return }
      if (task.viaAgent) { setNotice(noticeForError(task.errorCode)); return }
      if (decision === 'DENY' && task.errorCode === 'PERMISSION_DENIED') {
        await appendResult(current.tool === 'find-documents' ? t.findDenied : current.tool === 'windows-demo' ? t.windowsDemoDenied : current.tool === 'windows-apps' ? t.approvalAppsDenied : t.approvalDeniedNote)
        return
      }
      if (current.tool === 'windows-demo' && typeof task.output === 'string') {
        const proof = JSON.parse(task.output) as Record<string, boolean>
        const heading = task.state === 'COMPLETED' && proof.verified ? t.windowsDemoPassed : t.windowsDemoPartial
        await appendResult(`${heading}\n${current.path}\n` + [
          [t.windowsDemoOpen, proof.opened], [t.windowsDemoFocus, proof.owned],
          [t.windowsDemoInput, proof.inputVerified], [t.windowsDemoClose, proof.closed],
          [t.windowsDemoCleanup, proof.cleaned]
        ].map(([label, verified]) => `${label}: ${verified ? t.windowsDemoVerified : t.windowsDemoUnverified}`).join('\n') +
          (proof.owned && proof.focused === false ? '\n' + t.windowsDemoBehind : ''))
      } else if (task.state === 'COMPLETED' && typeof task.output === 'string') {
        if (current.tool === 'find-documents') {
          const result = JSON.parse(task.output) as { paths: string[]; limited: boolean }
          await appendResult(`${t.findResults}\n${result.paths.length ? result.paths.join('\n') : t.findEmpty}${result.limited ? `\n${t.findLimited}` : ''}`)
          return
        }
        if (current.tool === 'windows-apps') {
          const result = JSON.parse(task.output) as { apps: { id: string, found: boolean }[] }
          const names: Record<string, string> = { notepad: 'Notepad', calc: 'Calculator', mspaint: 'Paint', chrome: 'Google Chrome', edge: 'Microsoft Edge' }
          await appendResult(t.appsResult + '\n' + result.apps.map(item =>
            `${names[item.id] || item.id}: ${item.found ? t.appsFound : t.appsMissing}`).join('\n'))
          return
        }
        const prefix = `${t.fileContentPrefix}\n`
        const suffix = task.outputTruncated || prefix.length + task.output.length > 20000 ? `\n${t.fileReadTruncated}` : ''
        const preview = prefix + task.output.slice(0, 20000 - prefix.length - suffix.length) + suffix
        if (current.localOnly) {
          await appendResult(t.modelLocalPreviewReady)
          setLocalPreview({ sessionId: current.sessionId, text: preview })
        } else await appendResult(preview)
      } else {
        const key = noticeForError(task.errorCode)
        setNoticeCode(key === 'error' && typeof task.errorCode === 'string' && /^[A-Z_]{2,40}$/.test(task.errorCode) ? task.errorCode : null)
        setNotice(key === 'error' && task.proposedTool === 'read-file' ? 'fileGeneric' : key)
      }
    } catch {
      setNotice('error')
    } finally {
      finishWork(workKey)
      setActiveTaskId(null)
      setBusy(false)
    }
  }

  async function submitDraft(event: React.FormEvent) {
    event.preventDefault()
    if (busy && activeTaskId) { await addToRunningTask(draft.trim()); return }
    await submitText(draft.trim(), {})
  }
  // A message sent while a task works joins it (the agent reads it at its next step) and shows in the conversation at once. What the task
  // never read becomes the next request when it ends (followUp below), so nothing is lost.
  async function addToRunningTask(text: string) {
    if (!text || !activeTaskId || !window.najdCore?.addNote) return
    const sessionId = activeSessionId
    try {
      await window.najdCore.addNote(activeTaskId, text)
      setDraft('')
      // Saved in order; a follow-up request waits for these saves first (C12-01).
      if (sessionId && window.najdSessions) {
        const save = noteSaves.current.then(() => window.najdSessions!.append(sessionId, 'user', text)).then(updated => { setMessages(updated.messages); scroll.toLatest() })
        noteSaves.current = save.catch(() => {})
        await save
      }
    } catch { setNotice('error') }
  }
  const noteSaves = useRef<Promise<unknown>>(Promise.resolve())
  // The follow-up stays pending until it has really started (C13-01): if another task took the app meanwhile, the text joins that
  // task; otherwise it is tried again when the app is idle. The latest submitText is used (never a stale one from an earlier render).
  const [followUp, setFollowUp] = useState<{ text: string; sessionId: string | null } | null>(null)
  const followUpRunning = useRef(false)
  // Bumped when a follow-up attempt ends, so a newer follow-up set meanwhile is tried at once (C14-01).
  const [followUpTick, setFollowUpTick] = useState(0)
  const followUpLatest = useRef<typeof followUp>(null)
  followUpLatest.current = followUp
  const latest = useRef({ submitText: (_text: string, _ask: { alreadySaved?: boolean }) => Promise.resolve(false), taskId: null as string | null, sessionId: null as string | null })
  useEffect(() => {
    if (!followUp || busy || approval || importing || followUpRunning.current) return
    const next = followUp
    if (next.sessionId !== activeSessionId) { setFollowUp(null); return }
    followUpRunning.current = true
    const settle = () => setFollowUp(current => current === next ? null : current)
    void noteSaves.current.then(async () => {
      // Checked again after the wait: still this conversation and still this follow-up (C15-01); otherwise it waits for its turn.
      if (latest.current.sessionId !== next.sessionId || followUpLatest.current !== next) return
      if (await latest.current.submitText(next.text, { alreadySaved: true })) { settle(); return }
      const running = latest.current.taskId
      if (running && window.najdCore?.addNote) { try { await window.najdCore.addNote(running, next.text); settle() } catch { /* tried again when idle */ } }
    }).catch(() => {}).finally(() => {
      followUpRunning.current = false
      // Retried at once only when a newer follow-up arrived during this attempt (never in a loop for one that cannot start yet).
      if (followUpLatest.current && followUpLatest.current !== next) setFollowUpTick(value => value + 1)
    })
  }, [followUp, busy, approval, importing, activeSessionId, followUpTick])
  // The "/" menu: what the message box offers while it holds only a first word that starts with a slash.
  const slashItems = buildSlashItems({ language: preferences.language, hasConversation: !!activeSessionId, busy: busy || !!approval, skills: slashSkills, pluginCommands: slashPlugins, efforts: providers.supported,
    actions: { newChat, openPage: section => openSettingsAt(section as Section), setAccess: setAccessMode, pinProfile, setEffort: value => providers.setEffort(value as NajdReasoningPreference) } })
  const slashText = slashQuery(draft)
  const slashMatches = slashText !== null && slashClosed !== draft && !busy && !approval ? filterSlash(slashItems, slashText) : []
  const slashOpen = slashMatches.length > 0
  const slashActive = Math.min(slashIndex, Math.max(0, slashMatches.length - 1))
  // The "@" menu: earlier chats by title, while the last word of the message starts with @.
  const mentionText = slashOpen ? null : mentionQuery(draft)
  const mentionMatches = mentionText !== null && mentionClosed !== draft && !busy && !approval ? filterMentionable(sessions, mentionText, activeSessionId) : []
  const mentionOpen = mentionMatches.length > 0
  const mentionActive = Math.min(slashIndex, Math.max(0, mentionMatches.length - 1))
  function chooseMention(item: { id: string; title: string }) {
    setSlashIndex(0)
    setMentions(list => [...list.filter(entry => entry.id !== item.id), { id: item.id, title: item.title }])
    setDraft(text => insertMention(text, item.title))
    requestAnimationFrame(() => composerRef.current?.focus())
  }
  function chooseSlash(item: SlashItem) {
    if (item.disabled) return
    setSlashIndex(0)
    if (item.action.kind === 'insert') { setDraft(item.action.text); requestAnimationFrame(() => composerRef.current?.focus()) }
    else { setDraft(''); item.action.run() }
  }
  // One prompt, from the composer or from a question typed in the browser extension (a new conversation, progress reported back).
  // After the window reloaded, browser questions that were already running (or waiting for approval) are picked up again from their task:
  // a pending approval comes back as a card, and the answer is saved to its conversation once (never twice).
  const recoveredAsks = useRef<Set<string>>(new Set())
  // Until the running browser questions have been found and attached (one at a time), nothing else starts: recovery is the only owner of the busy state.
  const [recoveryReady, setRecoveryReady] = useState(() => !window.najdBrowser?.activeAsks)
  async function recoverAsk(taskId: string) {
    if (recoveredAsks.current.has(taskId) || !window.najdCore?.getTask) return
    recoveredAsks.current.add(taskId)
    setBusy(true)
    let workKey: string | null = null
    try {
      let task = await window.najdCore.getTask(taskId)
      const sessionId = (task as { conversationId?: string | null }).conversationId || null
      // The running task is the app's current task again: the Stop button works and the live activity shows while it is followed.
      if (task.state === 'QUEUED' || task.state === 'RUNNING') {
        workKey = beginWork(sessionId, messages.length)
        recordWork(workKey, task)
        setActiveTaskId(task.id)
      }
      while (task.state === 'QUEUED' || task.state === 'RUNNING') { task = await nextTaskState(task); if (workKey) recordWork(workKey, task) }
      if (task.state === 'WAITING_APPROVAL' && task.approvalId) { if (sessionId) setActiveSessionId(sessionId); setApproval(approvalOf(task, sessionId)); return }
      if ((task.state === 'COMPLETED' || task.state === 'UNKNOWN_EFFECT') && task.output && sessionId && window.najdSessions) {
        const session = await window.najdSessions.get(sessionId)
        // Stored messages are trimmed: both sides are normalized the same way, so a saved answer is recognised and never added twice.
        const same = (value: string) => value.replace(/\r\n/g, '\n').trim()
        if (!session.messages.some(message => message.role === 'assistant' && same(message.text) === same(task.output as string))) { setActiveSessionId(sessionId); await appendAssistantMessage(sessionId, task.output, task.id) }
        void window.najdBrowser?.askSaved(task.id) // saved (now or before): the app can forget it
      }
    } catch { /* the question keeps reporting through the bridge; nothing more can be recovered here */ } finally { if (workKey) finishWork(workKey); setActiveTaskId(null); setBusy(false) }
  }
  useEffect(() => {
    if (!historyReady || !window.najdBrowser?.activeAsks) return
    void window.najdBrowser.activeAsks().then(async list => { for (const item of list) await recoverAsk(item.taskId) }).catch(() => {}).finally(() => setRecoveryReady(true))
  }, [historyReady])
  // Questions stopped from the browser stay stopped, whatever the app is in the middle of (saving the conversation, starting the task).
  const cancelledAsks = useRef<Set<string>>(new Set())
  // alreadySaved: the text is already the last message of the conversation (added during the previous task, which never read it).
  async function submitText(text: string, ask: { askId?: string; fresh?: boolean; alreadySaved?: boolean; browserContext?: { title: string; url: string; selection: string } }): Promise<boolean> {
    const report = (patch: Parameters<NonNullable<typeof window.najdBrowser>['askUpdate']>[1]) => { if (ask.askId) void window.najdBrowser?.askUpdate(ask.askId, patch).catch(() => {}) }
    if (!text || busy || importing || providers.connectionBusy || approval || !historyReady || !recoveryReady) return false
    const assetIds = ask.fresh ? [] : selectChatAssetIds(messages, attachments)
    const activeProvider = providers.provider
    const activeModel = providers.model
    const activeEffort = providers.effort
    setBusy(true)
    setNotice(null)
    let stored = false
    let sessionId = ask.fresh ? null : activeSessionId
    let workKey: string | null = null
    const attached = ask.fresh ? [] : attachments.map(({ id, name }) => ({ id, name }))
    let transcript: NajdMessage[] = [...(ask.fresh ? [] : messages), { role: 'user', text, createdAt: new Date().toISOString(), ...(attached.length ? { attachments: attached } : {}) }]
    let started = false
    try {
      if (window.najdSessions) {
        if (!sessionId) {
          sessionId = (await window.najdSessions.create()).id
          setActiveSessionId(sessionId)
          // A chat started from a project joins it before its first request, so that request already has the project.
          if (chatProject && !ask.fresh && window.najdProjects) { await window.najdProjects.assign(sessionId, chatProject).catch(() => {}); setChatProject(null); void refreshProjects() }
        }
        // Already saved: used as it is, unless the text is not the conversation's last message yet (then it is saved now, so the request
        // and the conversation always agree).
        const current = ask.alreadySaved ? await window.najdSessions.get(sessionId) : null
        const updated = current && current.messages.at(-1)?.role === 'user' && current.messages.at(-1)?.text === text ? current
          : await window.najdSessions.append(sessionId, 'user', text, undefined, attached.length ? attached.map(item => item.id) : undefined)
        transcript = updated.messages
        setMessages(updated.messages)
        await refreshSessions()
      } else {
        setMessages(transcript)
      }
      stored = true
      scroll.toLatest()
      // Earlier chats mentioned with @ in this message: their newest messages are quoted for the model right before it.
      // They stay referenced for the rest of this conversation (kept on this computer by conversation id).
      const referenced = ask.fresh || ask.askId ? [] : rememberMentions(sessionId, activeMentions(text, mentions))
      if (!ask.askId) { setDraft(''); setAttachments([]); setMentions([]) }
      const quoted = referenced.length && window.najdSessions ? referenceBlock((await Promise.all(referenced.map(item => window.najdSessions!.get(item.id).catch(() => null))))
        .filter((chat): chat is NonNullable<typeof chat> => !!chat).map(chat => ({ title: chat.title || '', messages: chat.messages }))) : null
      const modelHistory = buildModelHistory(transcript)
      if (quoted) modelHistory.splice(modelHistory.length - 1, 0, { role: 'user', text: quoted })
      if (!window.najdCore) { setNotice('runtime'); report({ state: 'failed', progress: 'RUNTIME_UNAVAILABLE' }); return false }
      if (ask.askId && cancelledAsks.current.has(ask.askId)) return false
      workKey = beginWork(sessionId, transcript.length)
      let task = await window.najdCore.startTask(text, crypto.randomUUID(), activeProvider, activeModel || undefined, modelHistory, activeEffort, assetIds,
        sessionId || undefined, pinnedProfile(sessionId) || undefined, accessMode, ask.browserContext, ask.askId)
      started = true
      recordWork(workKey, task)
      setActiveTaskId(task.id)
      report({ state: 'running', taskId: task.id, progress: progressLine(task) })
      let lastProgress = ''
      while (task.state === 'QUEUED' || task.state === 'RUNNING') {
        task = await nextTaskState(task)
        recordWork(workKey, task)
        const line = progressLine(task)
        if (line !== lastProgress) { lastProgress = line; report({ state: 'running', progress: line }) }
      }
      // Added while it worked but never read (it ended first): the next request, once this one is settled.
      if (task.state !== 'WAITING_APPROVAL' && task.unreadNotes?.length) setFollowUp({ text: task.unreadNotes.join('\n\n'), sessionId })
      if (task.state === 'WAITING_APPROVAL' && task.approvalId && window.najdCore.respondApproval && !(ask.askId && cancelledAsks.current.has(ask.askId))) {
        setApproval(approvalOf(task, sessionId))
        report({ state: 'waiting_approval', needsApproval: true, progress: progressLine(task) })
      } else if ((task.state === 'COMPLETED' || task.state === 'UNKNOWN_EFFECT') && task.output) {
        await appendAssistantMessage(sessionId, task.output, task.id)
        if (ask.askId) void window.najdBrowser?.askSaved(task.id)
        if (task.state === 'UNKNOWN_EFFECT') setNotice('unknownEffect')
        report({ state: task.state === 'COMPLETED' ? 'done' : 'failed', output: task.output, progress: task.state === 'COMPLETED' ? '' : 'UNKNOWN_EFFECT', needsApproval: false })
      } else {
        report({ state: task.state === 'CANCELLED' ? 'cancelled' : 'failed', progress: typeof task.errorCode === 'string' ? task.errorCode : task.state, needsApproval: false })
        // Every model gets the attachments; one that refuses them (a model that cannot see pictures) is named as the reason.
        const key = assetIds.length && ['TOOLS_NOT_SUPPORTED', 'PROVIDER_REJECTED'].includes(String(task.errorCode)) ? 'attachmentProvider' : noticeForError(task.errorCode)
        setNoticeCode(key === 'error' && typeof task.errorCode === 'string' && /^[A-Z_]{2,40}$/.test(task.errorCode) ? task.errorCode : null)
        setNotice(key === 'error' && task.proposedTool === 'read-file' ? 'fileGeneric' : key)
      }
    } catch {
      // A question stopped in the browser is not an error in the app.
      if (!(ask.askId && cancelledAsks.current.has(ask.askId))) setNotice(stored ? 'error' : 'history')
      report({ state: 'failed', progress: 'ERROR' })
    } finally {
      if (workKey) finishWork(workKey)
      setActiveTaskId(null)
      setBusy(false)
    }
    return started
  }
  latest.current = { submitText, taskId: activeTaskId, sessionId: activeSessionId }

  // Questions typed in the browser extension wait their turn and then run as a new conversation.
  const askQueue = useRef<{ id: string; text: string; page: { url: string; title: string; selection: string } | null }[]>([])
  const [askTick, setAskTick] = useState(0)
  // A question can be delivered more than once (until the app confirms it): each id is taken once.
  const seenAsks = useRef<Set<string>>(new Set())
  useEffect(() => window.najdBrowser?.onAsk(ask => { if (seenAsks.current.has(ask.id)) return; seenAsks.current.add(ask.id); askQueue.current.push(ask); setAskTick(value => value + 1) }), [])
  // Stop pressed in the browser: a question that has not started is dropped, and an approval card waiting for it is cleared.
  useEffect(() => window.najdBrowser?.onAskCancelled(({ id, taskId }) => {
    cancelledAsks.current.add(id)
    askQueue.current = askQueue.current.filter(item => item.id !== id)
    if (taskId) setApproval(current => current?.taskId === taskId ? null : current)
  }), [])
  useEffect(() => {
    // A question from the browser opens its own conversation: it waits while the owner has an unsent draft or attachments, so that is never moved or lost.
    if (busy || approval || importing || !historyReady || !recoveryReady || providers.connectionBusy || draft.trim() || attachments.length) return
    const next = askQueue.current.shift()
    if (!next || cancelledAsks.current.has(next.id)) return
    // The page details go beside the question (never inside it), so they cannot steer the request or fill its length limit.
    const browserContext = next.page && (next.page.url || next.page.selection) ? { title: next.page.title.slice(0, 200), url: next.page.url.slice(0, 500), selection: next.page.selection.slice(0, 2000) } : undefined
    void submitText(next.text, { askId: next.id, fresh: true, browserContext }).then(started => { if (!started) void window.najdBrowser?.askUpdate(next.id, { state: 'failed', progress: 'NOT_STARTED' }).catch(() => {}) })
  }, [askTick, busy, approval, importing, historyReady, recoveryReady, providers.connectionBusy, draft, attachments.length])

  // Latest time each tool ran in this conversation, from the recorded activity (saved replies and the live run).
  const lastUsedTools = useMemo(() => {
    const used: Record<string, number> = {}
    const note = (activity?: NajdTaskActivity) => { for (const event of activity?.events ?? []) if (event.type === 'task.started' && event.skill) used[event.skill] = Math.max(used[event.skill] || 0, Date.parse(event.time) || 0); else if (event.tool && event.type === 'tool.started') used[event.tool] = Math.max(used[event.tool] || 0, Date.parse(event.time) || 0) }
    for (const message of messages) note(message.activity)
    for (const run of workRuns) if (run.sessionId === activeSessionId) note(run.activity)
    return used
  }, [messages, workRuns, activeSessionId])
  // The activity the side panel describes: the live or latest run of this conversation, else the last saved reply's.
  const currentActivity = useMemo(() => {
    // A chat not saved yet has no activity of its own; a run without a conversation never shows in another chat.
    if (!activeSessionId) return undefined
    const run = [...workRuns].reverse().find(item => item.sessionId === activeSessionId && item.activity)
    return run?.activity ?? [...messages].reverse().find(message => message.activity)?.activity
  }, [workRuns, messages, activeSessionId])
  const lastUserText = [...messages].reverse().find(message => message.role === 'user')?.text
  // Stop from the activity block while the run waits for the user: the task is cancelled, not just denied.
  async function stopWaitingTask() {
    const waiting = approval
    if (!waiting?.taskId || !window.najdCore?.cancelTask) return
    const run = [...workRuns].reverse().find(item => item.sessionId === waiting.sessionId && !item.finishedAt)
    try {
      const task = await window.najdCore.cancelTask(waiting.taskId)
      setApproval(null)
      if (run) { recordWork(run.key, task); finishWork(run.key) }
      setNotice('cancelled')
    } catch { setNotice('error') }
  }
  async function stopTask() {
    if (!activeTaskId || !window.najdCore?.cancelTask) return
    try { await window.najdCore.cancelTask(activeTaskId) }
    catch { setNotice('error') }
  }

  async function runCapability(id: NajdCapabilityId, input: { path?: string; query?: string }) {
    if (busy || approval || !historyReady || !window.najdCapabilities || !window.najdCore) return
    setBusy(true); setNotice(null)
    const workKey = beginWork(activeSessionId, messages.length)
    try {
      let task = await window.najdCapabilities.run(id, input, crypto.randomUUID())
      recordWork(workKey, task)
      setActiveTaskId(task.id)
      while (task.state === 'QUEUED' || task.state === 'RUNNING') {
        task = await nextTaskState(task)
        recordWork(workKey, task)
      }
      if (task.state === 'WAITING_APPROVAL' && task.approvalId && window.najdCore.respondApproval) {
        // Skills share the core approval flow. File bodies stay in the temporary
        // local preview and never become subsequent cloud conversation history.
        setApproval({ approvalId: task.approvalId, taskId: task.id, path: [task.proposedInput?.path, task.proposedInput?.query].filter(Boolean).join(' | '),
          tool: task.proposedTool || '', sessionId: activeSessionId, localOnly: id === 'najd-read-document', fromSkill: true })
        setSettingsOpen(false)
      } else { setNotice(noticeForError(task.errorCode)); setSettingsOpen(false) }
    } finally { finishWork(workKey); setActiveTaskId(null); setBusy(false) }
  }

  const availableSections: Partial<Record<Section, boolean>> = {
    general: true, models: !!window.najdProviders, browser: !!window.najdBrowser,
    atlas: !!window.najdAgent?.tools, accounts: !!window.najdAccounts, skills: !!window.najdSkills, plugins: !!window.najdCapabilities, connections: !!window.najdMcp, tools: !!window.najdAgent?.tools,
    memory: !!window.najdMemory, knowledge: !!window.najdKnowledge, channels: !!window.najdChannels,
    permissions: !!window.najdFiles, advanced: !!window.najdGateway
  }
  const [welcomeDismissed, setWelcomeDismissed] = useState(false)
  const showWelcome = !welcomeDismissed && historyReady && !welcomeSeen() && sessions.length === 0
  const closeWelcome = () => { markWelcomeSeen(); setWelcomeDismissed(true) }
  const openSettingsAt = (id: Section, installedOnly = false) => { setCatalogInstalled(installedOnly); setSection(id); setSettingsOpen(true) }
  return <div className={'app-shell' + (rail ? ' rail' : '') + (narrowRail && narrowOpen ? ' sidebar-floating' : '')}>
    <div className="najd-backdrop" aria-hidden="true"><img src={najdBackground} alt="" decoding="async" /></div>
    {showWelcome && <Welcome language={preferences.language} providers={providers.catalog.filter(item => item.kind !== 'local' || (providers.models[item.id]?.length ?? 0) > 0) /* a local server (Ollama, LM Studio) is "configured" by its default address; it counts once it lists a model */} onClose={closeWelcome} onConnect={() => { closeWelcome(); openSettingsAt('models') }}
      onTry={sample => { closeWelcome(); setDraft(sample); requestAnimationFrame(() => composerRef.current?.focus()) }} />}
    <AppRail t={t} language={preferences.language} settingsOpen={settingsOpen} section={section} sidebarOpen={!rail} busy={busy || !!approval || !historyReady}
      onChat={() => setSettingsOpen(false)} onNewChat={newChat} onSettings={openSettingsAt}
      onToggleSidebar={() => { if (narrowRail) setNarrowOpen(open => !open); else toggleSidebar() }} />
    <aside className="sidebar" aria-label={t.chats} onClick={event => { if (narrowRail && (event.target as HTMLElement).closest('.session-open')) setNarrowOpen(false) }}>
      <div className="brand"><div className="brand-text"><strong>NAJD</strong><small>AGENT</small></div></div>
      <button className="new-chat" aria-label={t.newChat} disabled={busy || !!approval || !historyReady} onClick={newChat}>
        <Plus size={18} strokeWidth={2} /> <span>{t.newChat}</span>
      </button>
      <div className="sidebar-label sidebar-label-row"><span>{isArabic ? 'المشاريع' : 'Projects'}</span>
        <button type="button" className="sidebar-add" aria-label={isArabic ? 'مشروع جديد' : 'New project'} title={isArabic ? 'مشروع جديد' : 'New project'} disabled={busy || !!approval || !window.najdProjects}
          onClick={() => setNewProjectName(value => value === null ? '' : null)}><FolderPlus size={15} /></button></div>
      {newProjectName !== null && <form className="project-create" onSubmit={event => { event.preventDefault(); void (async () => {
        const name = newProjectName.trim()
        if (!name || !window.najdProjects) return
        try { const created = await window.najdProjects.save({ name, instructions: '' }); setNewProjectName(null); await refreshProjects(); setSettingsOpen(false); setShownProject(created.id) } catch { setNotice('error') }
      })() }}>
        <input autoFocus value={newProjectName} maxLength={80} dir="auto" placeholder={isArabic ? 'اسم المشروع' : 'Project name'} aria-label={isArabic ? 'اسم المشروع' : 'Project name'}
          onChange={event => setNewProjectName(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') setNewProjectName(null) }} />
        <button type="submit" className="browser-action" disabled={!newProjectName.trim()}>{isArabic ? 'إنشاء' : 'Create'}</button>
      </form>}
      {projects.length > 0 && <div className="project-list">{projects.map(project => <button key={project.id} type="button"
        className={'project-row' + (shownProject === project.id || (!shownProject && projectOfChat(activeSessionId)?.id === project.id) ? ' active' : '')}
        disabled={busy || !!approval} onClick={() => { setSettingsOpen(false); setShownProject(project.id) }}>
        <FolderKanban size={15} aria-hidden="true" /><span dir="auto">{project.name}</span><small>{project.chats.length || ''}</small></button>)}</div>}
      <div className="sidebar-label">{t.chats}</div>
      <label className="session-search"><Search size={15} /><span className="sr-only">{t.searchChats}</span>
        <input type="search" value={searchQuery} maxLength={100} placeholder={t.searchChats} onChange={event => setSearchQuery(event.target.value)} />
      </label>
      {searchFailed ? <div className="empty-chats" role="alert">{t.historyFailed}</div>
        : (searchResults ?? sessions).length === 0 ? <div className="empty-chats"><MessageSquareText size={17} /><span>{searchQuery ? t.noSearchResults : t.noChats}</span></div>
          : <div className="session-list" aria-label={t.chats}>{(searchResults ?? sessions).map(session => <div key={session.id} className={'session-row ' + (activeSessionId === session.id ? 'active' : '')}>
          <button className="session-open" title={session.title || t.newChat} aria-current={activeSessionId === session.id ? 'page' : undefined}
            disabled={busy || !!approval} onClick={() => { void openSession(session.id) }}><span className="session-title">{session.title || t.newChat}</span>
            {'snippet' in session && typeof session.snippet === 'string' && session.snippet.length > 0 && <span className="session-snippet">{session.snippet}</span>}</button>
          <button className="session-delete" title={t.deleteChat} aria-label={`${t.deleteChat}: ${session.title || t.newChat}`}
            disabled={busy || !!approval} onClick={() => { void deleteChat(session.id, session.title) }}><Trash2 size={15} /></button>
        </div>)}</div>}
      <div className="sidebar-spacer" />
      <div className="sidebar-bottom">
        <CommunityLinks language={preferences.language} />
        <button type="button" className="privacy-mini" data-control={wholeComputer ? 'on' : 'off'} onClick={() => { setSection('permissions'); setSettingsOpen(true) }}>
          <ShieldCheck size={16} /><span>{wholeComputer ? t.controlOn : t.controlOff}</span></button>
      </div>
    </aside>

    <div className="workspace">
    {settingsOpen && <div className="settings-overlay" onMouseDown={event => { if (event.target === event.currentTarget) setSettingsOpen(false) }}
      onKeyDown={event => { if (event.key === 'Escape' && !event.defaultPrevented) setSettingsOpen(false) }}>
    <main className="settings-area" role="dialog" aria-modal="true" aria-label={t.settingsTitle}>
      <header className="topbar">
        <button className="topbar-back" onClick={() => setSettingsOpen(false)}><BackIcon size={17} />{t.back}</button>
        {updates.status?.currentVersion && <span className="version-chip" dir="ltr">v{updates.status.currentVersion}</span>}
      </header>
      {updates.status && ['available', 'manual', 'ready'].includes(updates.status.state) && <button className="update-notice" data-update="notice" onClick={openUpdates}>{t.updates.notice} {updates.status.version}</button>}
      <div className="settings-scroll">
        <div className="settings-heading"><p className="eyebrow">NAJD / {t.settings}</p><h1>{t.settingsTitle}</h1><p>{t.settingsIntro}</p></div>
        <div className="settings-layout">
          <nav className="settings-nav" aria-label={t.settingsTitle} ref={settingsNavRef}>
            {sections.map(([id, Icon]) => <button key={id} data-section={id} className={'settings-nav-item ' + (section === id ? 'active' : '')}
              onClick={() => { setCatalogInstalled(false); setSection(id) }} aria-current={section === id ? 'page' : undefined}>
              <Icon size={18} strokeWidth={1.8} /><span>{t[id]}</span>
              {!availableSections[id] && <span className="nav-dot" aria-label={t.planned} />}
            </button>)}
          </nav>
          <section className="settings-panel" aria-labelledby="section-title">
            <div className="panel-heading"><div><h2 id="section-title">{t[section]}</h2><p>{t[`${section}Desc`]}</p></div>
              <StatusPill ready={!!availableSections[section]}>{section === 'browser' && window.najdBrowser ? t.browserReadOnlyTag : availableSections[section] ? t.available : t.planned}</StatusPill>
            </div>
            {section === 'general' ? <div className="settings-group">
              <SettingRow title={t.language} hint={t.languageHint}>
                <Segmented label={t.language}>
                  <button className={isArabic ? 'on' : ''} aria-pressed={isArabic} onClick={() => changePreferences({ language: 'ar' })}>{t.arabic}</button>
                  <button className={!isArabic ? 'on' : ''} aria-pressed={!isArabic} onClick={() => changePreferences({ language: 'en' })}>{t.english}</button>
                </Segmented>
              </SettingRow>
              <SettingRow title={t.appearance} hint={t.appearanceHint}>
                <Segmented label={t.appearance}>
                  <button data-theme="graphite" className={preferences.theme === 'graphite' ? 'on' : ''} aria-pressed={preferences.theme === 'graphite'} onClick={() => changePreferences({ theme: 'graphite' })}><Moon size={15} />{t.graphite}</button>
                  <button data-theme="najd" className={preferences.theme === 'najd' ? 'on' : ''} aria-pressed={preferences.theme === 'najd'} onClick={() => changePreferences({ theme: 'najd' })}><Sparkles size={15} />{t.najdGold}</button>
                  <button data-theme="system" className={preferences.theme === 'system' ? 'on' : ''} aria-pressed={preferences.theme === 'system'} onClick={() => changePreferences({ theme: 'system' })}><Monitor size={15} />{t.system}</button>
                  <button data-theme="light" className={preferences.theme === 'light' ? 'on' : ''} aria-pressed={preferences.theme === 'light'} onClick={() => changePreferences({ theme: 'light' })}><Sun size={15} />{t.light}</button>
                  <button data-theme="dark" className={preferences.theme === 'dark' ? 'on' : ''} aria-pressed={preferences.theme === 'dark'} onClick={() => changePreferences({ theme: 'dark' })}><Moon size={15} />{t.dark}</button>
                  <button data-theme="navy" className={preferences.theme === 'navy' ? 'on' : ''} aria-pressed={preferences.theme === 'navy'} onClick={() => changePreferences({ theme: 'navy' })}>{t.desertNights}</button>
                </Segmented>
              </SettingRow>
              <SettingRow title={t.interfaceSize} hint={t.interfaceSizeHint} className="interface-size">
                <Segmented label={t.interfaceSize}>
                  {[1, 1.15, 1.25].map(scale => <button type="button" key={scale} data-scale={scale} className={preferences.fontScale === scale ? 'on' : ''} aria-pressed={preferences.fontScale === scale} onClick={() => changePreferences({ fontScale: scale })}>{Math.round(scale * 100)}%</button>)}
                </Segmented>
              </SettingRow>
              <SettingRow title={t.color} hint={t.colorHint} className="color-row">
                <div className="color-controls">
                  <div className="color-presets" role="group" aria-label={t.color}>
                    {colorPresets.map(preset => <button key={preset.name} type="button" className={'color-preset ' + (preferences.accent === preset.value ? 'chosen' : '')}
                      style={{ '--swatch': preset.value } as React.CSSProperties} title={t[preset.name]} aria-label={t[preset.name]}
                      aria-pressed={preferences.accent === preset.value} onClick={() => changePreferences({ accent: preset.value })} />)}
                  </div>
                  <label className="custom-color"><span>{t.customColor}</span><input type="color" value={preferences.accent} onChange={event => changePreferences({ accent: event.target.value })} aria-label={t.customColor} /></label>
                </div>
              </SettingRow>
              <FeatureMap language={preferences.language} />
              <InfoNote icon={ShieldCheck} title={t.privacy}><p>{t.privacyNote}</p></InfoNote>
              <LegalNotices t={t} />
              <StabilityNotice t={t} />
              <UpdateSettings t={t} status={updates.status} onChange={updates.setStatus} busy={busy || !!approval || !!draft.trim()} />
              <RuntimeSettings language={preferences.language} />
              <DiagnosticsSettings t={t} />
            </div> : section === 'models' ? <div>
              <ProviderSettings t={t} controls={providers} busy={busy || !!approval} initial={providers.provider} />
            </div> : section === 'browser' ? <><BrowserSettings t={t} language={preferences.language} />
            </> : section === 'permissions' ? <div className="browser-panel">
              <div className="browser-card">
                <CardHeading icon={ShieldCheck} title={t.rootsTitle} hint={t.permissionsDesc} />
                {!window.najdFiles ? <p className="browser-note">{t.permissionsDesktopOnly}</p> : <>
                  <WholeComputerAccess language={preferences.language} onChange={setWholeComputer} />
                  {fileRoots.length === 0 ? <p className="browser-note">{t.noRoots}</p>
                    : <div className="roots-list">{fileRoots.map(root => <div key={root} className="root-row">
                      <span className="root-path" dir="ltr">{root}</span>
                      <button type="button" className="root-revoke" onClick={() => { void revokeRoot(root) }}>{t.revokeRoot}</button>
                    </div>)}</div>}
                  <div className="browser-actions"><button type="button" className="browser-action" onClick={() => { void grantRoot() }}>{t.addRoot}</button></div>
                  {permissionsError && <p className="browser-error" role="alert">{t.fileErrorGeneric}</p>}
                </>}
              </div>
              <div className="browser-card windows-permissions"><h3>{t.windowsPermissionsTitle}</h3>
                <p className="browser-note">{t.windowsPermissionsHint}</p>
                <div className="browser-actions">{[['/apps', t.prepareApps], ['/windows chrome', t.prepareChrome], ['/windows edge', t.prepareEdge]].map(([command, label]) =>
                  <button type="button" className="browser-action" key={command} disabled={busy || !!approval || !!draft.trim() || !window.najdCore} onClick={() => { setDraft(command); setSettingsOpen(false) }}>{label}</button>)}</div>
                <p className="browser-note">{t.findHelp}</p>
              </div>
              {window.najdFiles && <div className="browser-card"><h3>{t.activityTitle}</h3>
                {activityEntries.length === 0 ? <p className="browser-note">{t.activityEmpty}</p>
                  : <div className="activity-list">{activityEntries.map((entry, index) => <div key={index} className="activity-row">
                    <span className="activity-action">{activityLabel(entry.action)}</span>
                    <span className={'activity-decision ' + (entry.decision === 'allowed' ? 'on' : '')}>{entry.decision === 'allowed' ? t.activityAllowed : t.activityDenied}</span>
                    {entry.path && <span className="activity-path" dir="ltr">{entry.path}</span>}
                    {entry.time && <time>{activityTime(entry.time)}</time>}
                  </div>)}</div>}
              </div>}
            </div> : section === 'skills' ? <><SkillsCatalog key={'skills-' + catalogInstalled} language={preferences.language} busy={busy || !!approval || !historyReady} installedOnly={catalogInstalled} />
              <details className="catalog-manage"><summary>{isArabic ? 'تثبيت وإدارة المهارات' : 'Install and manage skills'}</summary>
              <InstructionSkillsSettings language={preferences.language} busy={busy || !!approval || !historyReady} /></details></>
              : section === 'plugins' ? <><PluginsCatalog key={'plugins-' + catalogInstalled} language={preferences.language} t={t} installedOnly={catalogInstalled} />
                <PluginInstaller language={preferences.language} onOpenPage={page => { setCatalogInstalled(false); setSection(page) }} />
              <details className="catalog-manage" open><summary>{isArabic ? 'تثبيت وإدارة الإضافات' : 'Install and manage plugins'}</summary>
              <PackSettings t={t} busy={busy || !!approval || !historyReady} /><CapabilitySettings t={t} busy={busy || !!approval || !historyReady} onRun={runCapability} /></details></>
              : section === 'accounts' ? <AccountsSettings language={preferences.language} busy={busy || !!approval} />
              : section === 'channels' ? <ChannelsSettings language={preferences.language} c={providers} busy={busy || !!approval} />
              : section === 'atlas' ? <CapabilityAtlas language={preferences.language} browserConnected={browserStatus.connected} lastUsed={lastUsedTools}
                onOpenPage={page => { setCatalogInstalled(false); setSection(page) }} />
              : section === 'tools' ? <ToolsCatalog language={preferences.language} />
              : section === 'connections' ? <><ConnectionsCatalog key={'connections-' + catalogInstalled} language={preferences.language} browserConnected={browserStatus.connected} installedOnly={catalogInstalled} />
                <details className="catalog-manage"><summary>{isArabic ? 'إضافة وإدارة الاتصالات وخوادم MCP' : 'Add and manage connections and MCP servers'}</summary><McpSettings t={t} busy={busy || !!approval} /></details></>
              : section === 'knowledge' ? <KnowledgeBases language={preferences.language} busy={busy || !!approval} />
              : section === 'memory' ? <MemorySettings t={t} language={preferences.language} busy={busy || !!approval} onUse={text => { setDraft(current => current ? current + '\n\n' + text : text); setSettingsOpen(false) }} />
              : section === 'advanced' ? <GatewaySettings t={t} /> : <div className="coming"><div className="coming-icon"><Sparkles size={26} /></div>
              <h3>{t.comingTitle}</h3><p>{t.comingBody}</p><div className="coming-divider" /><span>{t[`${section}Desc`]}</span>
            </div>}
          </section>
        </div>
      </div>
    </main></div>}
    <main className="chat-area" data-calm={messages.length > 0} data-project={shownProject ? 'open' : undefined} inert={settingsOpen || undefined}>
      {preferences.theme === 'graphite' && <Starfield calm={messages.length > 0} />}
      <header className="topbar"><div className="topbar-title"><strong>{t.app}</strong></div><div className="chat-header-actions">
        {activeSessionId && !shownProject && <button type="button" className="topbar-export" disabled={busy || !!approval} onClick={() => { void exportChat() }} title={t.exportChat} aria-label={t.exportChat}><Download size={16} /><span>{t.exportChat}</span></button>}
        </div>
        {/* The panel opens on the physical right in both languages, so its button sits at the right edge too. */}
        <button type="button" ref={panelToggle} className="topbar-panel" aria-pressed={panelOpen} aria-controls="side-panel" onClick={() => setPanelOpen(open => !open)}
          title={panelOpen ? t.panel.hide : t.panel.show} aria-label={panelOpen ? t.panel.hide : t.panel.show}><PanelRight size={17} /></button></header>
      {exportFeedback && <div className="export-feedback" role="status">{exportFeedback}</div>}
      {shownProject && projects.some(project => project.id === shownProject) && <ProjectView project={projects.find(project => project.id === shownProject)!} language={preferences.language}
        sessions={sessions} busy={busy || !!approval}
        onChanged={updated => setProjects(list => list.map(project => project.id === updated.id ? updated : project))}
        onRemoved={() => { setShownProject(null); void refreshProjects() }}
        onOpenChat={id => { void openSession(id) }}
        onNewChat={() => { const id = shownProject; newChat(); setChatProject(id); requestAnimationFrame(() => composerRef.current?.focus()) }}
        onClose={() => setShownProject(null)} />}
      {updates.status && ['available', 'manual', 'ready'].includes(updates.status.state) && <button className="update-notice" data-update="notice" onClick={openUpdates}>{t.updates.notice} {updates.status.version}</button>}
      <div className="chat-content">
        <div className="chat-scroll" ref={scroll.ref} onScroll={scroll.onScroll}>
          <ActionRecovery language={preferences.language} />
          {messages.length === 0 ? <div className="welcome"><img className="welcome-logo" src={najdLogo} alt="" width={240} height={240} decoding="async" />
            <p className="welcome-wordmark">NAJD AGENT</p>
            <h1>{t.welcome}</h1><div className="welcome-ornament" aria-hidden="true"><span /><i /><span /></div></div>
            : <CanvasProvider onOpen={setCanvas}><div className="message-list" aria-live="polite">{messages.map((message, index) => {
              const run: WorkRun | undefined = message.activity ? {key:`saved:${index}`,sessionId:activeSessionId,afterIndex:index,
                startedAt:Date.parse(message.activity.startedAt),finishedAt:message.activity.finishedAt ? Date.parse(message.activity.finishedAt) : undefined,
                steps:[],activity:message.activity} : message.role === 'assistant' ? workRuns.find(run => run.sessionId === activeSessionId && run.afterIndex === index) : undefined
              return <ChatMessage key={index} message={message} language={preferences.language} activity={run && <TaskActivity run={run} language="en" />} />
            })}</div></CanvasProvider>}
          {/* The run stays below the conversation until its answer arrives, also when messages the owner added to it came after its start (owner live test 2026-10-25). */}
          {workRuns.filter(run => run.sessionId === activeSessionId && !messages.slice(run.afterIndex).some(item => item.role === 'assistant')).slice(-1).map(run => <div className="pending-activity" key={run.key}><TaskActivity run={run} language="en" onStop={busy && activeTaskId ? () => { void stopTask() } : approval?.taskId ? () => { void stopWaitingTask() } : undefined} onRetry={!busy && lastUserText ? () => setDraft(lastUserText) : undefined} /></div>)}
          {/* Phase 12: a request that never got its answer in this session's view (NAJD closed or stopped while it worked) can be resumed;
              the action recovery above lists any step whose outcome is unknown, and the model is asked to check before repeating. */}
          {!busy && !approval && !importing && messages.length > 0 && messages.at(-1)?.role === 'user' && !workRuns.some(run => run.sessionId === activeSessionId) &&
            <div className="interrupted-card" role="status" data-interrupted>
              <span>{preferences.language === 'ar' ? 'لم يصل رد على هذا الطلب: توقف نجد أو انقطع العمل قبل أن يكتمل.' : 'This request never got its answer: NAJD stopped or the work was interrupted before it finished.'}</span>
              <button type="button" className="browser-action" onClick={() => { void submitText(messages.at(-1)!.text, { alreadySaved: true }) }}>{preferences.language === 'ar' ? 'أكمل الطلب' : 'Resume the request'}</button>
            </div>}
          {approval && <div className="approval-card" role="alert" dir="ltr" lang="en">
            <div className="approval-heading"><ShieldCheck size={18} /><strong>{tEn.approvalTitle}</strong></div>
            <p className="approval-summary" dir="auto">{approval.agent ? approval.agent.summary : approval.localOnly ? approval.fromSkill ? tEn.capabilities.readApproval : tEn.modelReadApproval : approval.tool === 'find-documents' ? tEn.approvalFind : approval.tool === 'windows-demo' ? tEn.approvalWindowsDemo : approval.tool === 'windows-apps' ? tEn.approvalApps : tEn.approvalReadFile}</p>
            <code dir="ltr">{approval.path}</code>
            {approval.agent?.body && <pre className="approval-body" dir="ltr">{approval.agent.body}</pre>}
            <div className="approval-actions">
              <button type="button" className="approval-allow" disabled={busy} onClick={() => { void respondToApproval('ALLOW_ONCE') }}>{tEn.approvalAllowOnce}</button>
              {approval.agent && <button type="button" className="approval-allow-task" disabled={busy} onClick={() => { void respondToApproval('ALLOW_TASK') }}>{tEn.approvalAllowTask}</button>}
              <button type="button" className="approval-deny" disabled={busy} onClick={() => { void respondToApproval('DENY') }}>{tEn.approvalDeny}</button>
            </div>
          </div>}
          {localPreview && localPreview.sessionId === activeSessionId && <section className="local-file-preview" aria-label={t.modelLocalPreviewTitle}>
            <h3>{t.modelLocalPreviewTitle}</h3><p>{t.modelLocalPreviewHint}</p><pre tabIndex={0}>{localPreview.text}</pre>
            <button type="button" className="model-refresh" onClick={() => setLocalPreview(null)}>{t.modelClearPreview}</button>
          </section>}
          {busy && activeTaskId && <div className="thinking" role="status" aria-label={t.thinking}><span /><span /><span /></div>}
        </div>
        <div className="composer-wrap">
          <RuntimeBanner language={preferences.language} />
          {scroll.showLatest && <button type="button" className="jump-latest" onClick={scroll.toLatest}>{isArabic ? '↓ آخر المحادثة' : '↓ Latest messages'}</button>}
          {notice && <div className="notice" role="status"><KeyRound size={17} /><span>{noticeText[notice]}{notice === 'error' && noticeCode ? <bdi dir="ltr"> ({noticeCode})</bdi> : null}</span>{['model', 'offline', 'missingModel', 'auth', 'rejected', 'fileNoRoots', 'providerLimit', 'providerPolicy'].includes(notice) && <button aria-label={t.settings} onClick={() => { setSettingsOpen(true); setSection(notice === 'fileNoRoots' ? 'permissions' : 'models') }}><Settings2 size={16} /></button>}</div>}
          <form className={'composer' + (dragging ? ' dragging' : '')} onSubmit={submitDraft}
            onDragOver={event => { if (Array.from(event.dataTransfer.types).includes('Files')) { event.preventDefault(); setDragging(true) } }}
            onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false) }}
            onDrop={event => { event.preventDefault(); setDragging(false); void addTransfer(event.dataTransfer, 'drop') }}>
            {dragging && <div className="composer-drop" aria-hidden="true">{isArabic ? 'أفلت الملفات لإرفاقها' : 'Drop files to attach'}</div>}
            {slashOpen && <SlashMenu id="slash-menu" items={slashMatches} index={slashActive} language={preferences.language} onChoose={chooseSlash} onHover={setSlashIndex} />}
            {mentionOpen && <ul className="slash-menu mention-menu" id="mention-menu" role="listbox" aria-label={isArabic ? 'المحادثات السابقة' : 'Earlier chats'}>
              <li role="presentation"><div className="slash-group" aria-hidden="true">{isArabic ? 'المحادثات السابقة' : 'Earlier chats'}</div></li>
              {mentionMatches.map((item, position) => <li key={item.id} role="presentation">
                <div role="option" id={`mention-menu-${item.id}`} aria-selected={position === mentionActive} className={'slash-item' + (position === mentionActive ? ' active' : '')}
                  onMouseEnter={() => setSlashIndex(position)} onMouseDown={event => { event.preventDefault(); chooseMention(item) }}>
                  <MessageSquareText size={15} aria-hidden="true" /><span className="slash-label" dir="auto">{item.title}</span>
                  <small className="slash-hint" dir="auto">{new Date(item.updatedAt).toLocaleDateString(isArabic ? 'ar' : 'en')}</small>
                </div></li>)}
            </ul>}
            {(() => { const project = chatProject ? projects.find(item => item.id === chatProject) : projectOfChat(activeSessionId); return project
              ? <div className="composer-project"><FolderKanban size={13} aria-hidden="true" /><span>{isArabic ? 'في مشروع: ' : 'In project: '}<bdi dir="auto">{project.name}</bdi></span>
                {chatProject && !activeSessionId && <button type="button" className="icon-button" aria-label={isArabic ? 'بدون مشروع' : 'No project'} onClick={() => setChatProject(null)}>×</button>}</div> : null })()}
            <AttachmentChips items={attachments} ar={isArabic} disabled={busy || importing} onChange={setAttachments} />
            <label className="sr-only" htmlFor="prompt">{t.prompt}</label>
            <textarea id="prompt" rows={2} placeholder={t.prompt} value={draft} ref={composerRef}
              role={slashOpen || mentionOpen ? 'combobox' : undefined} aria-expanded={slashOpen || mentionOpen ? true : undefined} aria-controls={slashOpen ? 'slash-menu' : mentionOpen ? 'mention-menu' : undefined} aria-autocomplete={slashOpen || mentionOpen ? 'list' : undefined}
              aria-activedescendant={slashOpen ? `slash-menu-${slashMatches[slashActive].id}` : mentionOpen ? `mention-menu-${mentionMatches[mentionActive].id}` : undefined}
              onChange={event => { setDraft(event.target.value); setSlashIndex(0); const field = event.currentTarget; field.style.height = 'auto'; field.style.height = field.scrollHeight + 'px' }}
              onPaste={event => { if (Array.from(event.clipboardData.items).some(item => item.kind === 'file' && item.type.startsWith('image/'))) { event.preventDefault(); void addTransfer(event.clipboardData, 'paste') } }}
              onKeyDown={event => {
                if (slashOpen) {
                  if (event.key === 'ArrowDown') { event.preventDefault(); setSlashIndex((slashActive + 1) % slashMatches.length); return }
                  if (event.key === 'ArrowUp') { event.preventDefault(); setSlashIndex((slashActive - 1 + slashMatches.length) % slashMatches.length); return }
                  if (event.key === 'Enter' || event.key === 'Tab') { event.preventDefault(); chooseSlash(slashMatches[slashActive]); return }
                  if (event.key === 'Escape') { event.preventDefault(); setSlashClosed(draft); return }
                }
                if (mentionOpen) {
                  if (event.key === 'ArrowDown') { event.preventDefault(); setSlashIndex((mentionActive + 1) % mentionMatches.length); return }
                  if (event.key === 'ArrowUp') { event.preventDefault(); setSlashIndex((mentionActive - 1 + mentionMatches.length) % mentionMatches.length); return }
                  if (event.key === 'Enter' || event.key === 'Tab') { event.preventDefault(); chooseMention(mentionMatches[mentionActive]); return }
                  if (event.key === 'Escape') { event.preventDefault(); setMentionClosed(draft); return }
                }
                if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit() }
              }} />
            <div className="composer-footer"><div className="composer-actions"><AttachmentPicker key={activeSessionId} language={preferences.language} selected={attachments} onChange={setAttachments} onBusyChange={setImporting} onManageTools={() => openSettingsAt('skills')} disabled={busy || !!approval || providers.connectionBusy} /><AccessModeMenu mode={accessMode} t={t} disabled={busy || importing || !!approval || providers.connectionBusy} onSelect={setAccessMode} /></div>
              <div className="composer-spacer" />
              <ComposerModels c={providers} t={t} disabled={busy || !!approval || providers.connectionBusy}
                onConnect={() => { setSettingsOpen(true); setSection('models') }} />
              {/* While a task works, Stop stays; typing shows Send too, and what is sent joins the task. */}
              {busy && activeTaskId && <button className="send-button stop" type="button" onClick={() => { void stopTask() }} aria-label={t.stopTask}><Square size={13} fill="currentColor" /></button>}
              {(!(busy && activeTaskId) || draft.trim()) && <button className="send-button" type="submit" data-adds-to-task={busy && activeTaskId ? 'true' : undefined} title={busy && activeTaskId ? t.addToTask : undefined}
                disabled={!draft.trim() || importing || providers.connectionBusy || !!approval || !historyReady || (busy && !activeTaskId)} aria-label={busy && activeTaskId ? t.addToTask : t.send}><ArrowUp size={17} /></button>}
            </div>
          </form>
        </div>
      </div>
    </main>
    {canvas && !settingsOpen && <CanvasPanel item={canvas} language={preferences.language} onClose={() => setCanvas(null)} />}
    {panelOpen && !settingsOpen && !canvas && <SidePanel t={tEn} language="en" conversationId={activeSessionId} provider={providers.provider} model={providers.model}
      modelWindow={providers.models[providers.provider]?.find(item => item.id === providers.model)?.contextWindow ?? null} busy={busy}
      browserConnected={browserStatus.connected} activity={currentActivity} pinned={pinnedProfile(activeSessionId)} onClose={closePanel} onOpen={openSettingsAt}
      onPin={pinProfile} />}
    </div>
  </div>
}
