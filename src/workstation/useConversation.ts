import { useEffect, useMemo, useRef, useState } from 'react'
import { buildModelHistory, selectChatAssetIds } from '../chat-context'
import { activeMentions, referenceBlock, rememberMentions, type Mention } from '../mentions'
import { nextTaskState } from '../taskWatch'
import { useChatScroll } from '../useChatScroll'
import type { ProviderControls } from '../useProviders'
import type { Lang } from './types'

// The conversation engine of the workstation: sessions, task lifecycle, approvals, notes added to a running task, browser questions and
// their recovery. It holds no UI. Every guarantee below belongs to the core contract: one running task, a message is saved before its task
// starts, an approval is answered once, and a browser question is taken once and never answered twice.
export type AccessMode = 'ask' | 'approve' | 'full'
export type WorkStep = { state: string; proposedTool: string | null; reasoningEffort: NajdReasoningPreference | null }
export type WorkRun = { key: string; sessionId: string | null; afterIndex: number; startedAt: number; finishedAt?: number; steps: WorkStep[]; activity?: NajdTaskActivity }
export type Approval = { approvalId: string; taskId?: string; path: string; tool: string; sessionId: string | null; localOnly: boolean; agent?: { summary: string; body: string } }

const ACCESS_KEY = 'najd.access-mode.v1', PINS_KEY = 'najd.profilePins.v1'
const readAccess = (): AccessMode => { const value = localStorage.getItem(ACCESS_KEY); return value === 'approve' || value === 'full' ? value : 'ask' }

function progressLine(task: NajdTask): string {
  const last = [...(task.activity?.events ?? [])].reverse().find(event => event.type.startsWith('tool.') || event.type === 'approval.requested')
  return last ? `${last.tool || last.type}${last.detail ? ': ' + last.detail : ''}`.slice(0, 190) : ''
}

export function useConversation(providers: ProviderControls, language: Lang, handlers: { onActive?: () => void } = {}) {
  const ar = language === 'ar'
  const [draft, setDraft] = useState('')
  const [attachments, setAttachments] = useState<NajdAsset[]>([])
  const [mentions, setMentions] = useState<Mention[]>([])
  const [messages, setMessages] = useState<NajdMessage[]>([])
  const [sessions, setSessions] = useState<NajdSessionSummary[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [projects, setProjects] = useState<NajdProject[]>([])
  const [chatProject, setChatProject] = useState<string | null>(null)
  const [historyReady, setHistoryReady] = useState(!window.najdSessions)
  const [recoveryReady, setRecoveryReady] = useState(() => !window.najdBrowser?.activeAsks)
  const [busy, setBusy] = useState(false)
  const [importing, setImporting] = useState(false)
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null)
  const [workRuns, setWorkRuns] = useState<WorkRun[]>([])
  const [approval, setApproval] = useState<Approval | null>(null)
  const [errorCode, setErrorCode] = useState<string | null>(null)
  const [localPreview, setLocalPreview] = useState<{ sessionId: string | null; text: string } | null>(null)
  const [accessMode, setAccessMode] = useState<AccessMode>(readAccess)
  const [queuedSend, setQueuedSend] = useState(false)
  const [followUp, setFollowUp] = useState<{ text: string; sessionId: string | null } | null>(null)
  const [followUpTick, setFollowUpTick] = useState(0)
  const [askTick, setAskTick] = useState(0)
  const [profilePins, setProfilePins] = useState<Record<string, string>>(() => { try { return JSON.parse(localStorage.getItem(PINS_KEY) || '{}') || {} } catch { return {} } })
  const scroll = useChatScroll(activeSessionId, [messages, busy, approval, workRuns, localPreview])
  useEffect(() => { localStorage.setItem(ACCESS_KEY, accessMode) }, [accessMode])
  useEffect(() => { try { localStorage.setItem(PINS_KEY, JSON.stringify(profilePins)) } catch {} }, [profilePins])
  useEffect(() => { setAttachments([]) }, [activeSessionId])
  const pinned = (id: string | null) => id ? profilePins[id] || null : null
  const pinProfile = (profile: string | null) => { if (!activeSessionId) return; setProfilePins(pins => { const next = { ...pins }; if (profile) next[activeSessionId] = profile; else delete next[activeSessionId]; return next }) }

  function beginWork(sessionId: string | null, afterIndex: number) {
    const key = `${sessionId}:${afterIndex}`
    setWorkRuns(runs => runs.some(run => run.key === key) ? runs.map(run => run.key === key ? { ...run, finishedAt: undefined } : run) : [...runs.slice(-39), { key, sessionId, afterIndex, startedAt: Date.now(), steps: [] }])
    return key
  }
  function recordWork(key: string, task: NajdTask) {
    const step = { state: task.state, proposedTool: task.proposedTool, reasoningEffort: task.reasoningEffort }
    setWorkRuns(runs => {
      const current = runs.find(run => run.key === key)
      if (!current || JSON.stringify(current.steps.at(-1)) === JSON.stringify(step) && JSON.stringify(current.activity) === JSON.stringify(task.activity)) return runs
      return runs.map(run => run.key === key ? { ...run, activity: task.activity, steps: JSON.stringify(run.steps.at(-1)) === JSON.stringify(step) ? run.steps : [...run.steps.slice(-19), step] } : run)
    })
  }
  function finishWork(key: string) { setWorkRuns(runs => runs.map(run => run.key === key ? { ...run, finishedAt: run.steps.at(-1)?.state === 'WAITING_APPROVAL' ? undefined : Date.now() } : run)) }

  async function refreshSessions() { if (window.najdSessions) setSessions(await window.najdSessions.list()) }
  async function refreshProjects() { try { if (window.najdProjects) setProjects(await window.najdProjects.list()) } catch {} }
  useEffect(() => { void refreshProjects() }, [])
  useEffect(() => {
    if (!window.najdSessions) return
    let mounted = true
    void (async () => {
      try {
        const list = await window.najdSessions!.list()
        if (mounted) setSessions(list)
      } catch { if (mounted) setErrorCode('HISTORY') } finally { if (mounted) setHistoryReady(true) }
    })()
    return () => { mounted = false }
  }, [])
  const live = useRef({ id: null as string | null, idle: true })
  live.current = { id: activeSessionId, idle: !busy && !importing && !approval }
  useEffect(() => window.najdChannels?.onSessionsChanged(entry => {
    void refreshSessions()
    const { id, idle } = live.current
    if (entry?.sessionId && entry.sessionId === id && idle && window.najdSessions) void window.najdSessions.get(id).then(session => { if (live.current.id === id) setMessages(session.messages) }).catch(() => {})
  }), [])

  const locked = busy || importing || !!approval
  async function openSession(id: string) {
    if (!window.najdSessions || locked) return false
    try { const session = await window.najdSessions.get(id); setActiveSessionId(id); setMessages(session.messages); setErrorCode(null); handlers.onActive?.(); return true } catch { setErrorCode('HISTORY'); return false }
  }
  // A new task starts clean: no attachments, files or activity of another conversation. Earlier chats are brought in on purpose with @.
  function newTask(project: string | null = null) {
    if (locked || !historyReady) return
    setActiveSessionId(null); setDraft(''); setMessages([]); setAttachments([]); setMentions([]); setChatProject(project); setErrorCode(null)
    setWorkRuns(runs => runs.filter(run => run.sessionId !== null))
  }
  async function deleteSession(id: string) {
    if (!window.najdSessions || busy || approval) return
    try { await window.najdSessions.delete(id); await refreshSessions(); if (id === activeSessionId) newTask() } catch (reason) { setErrorCode(String(reason).includes('PROCESSES_RUNNING') ? 'PROCESSES_RUNNING' : String(reason).includes('CONVERSATION_BUSY') ? 'CONVERSATION_BUSY' : 'HISTORY') }
  }
  async function appendAssistant(sessionId: string | null, text: string, taskId?: string) {
    if (sessionId && window.najdSessions) { const updated = await window.najdSessions.append(sessionId, 'assistant', text, taskId); setMessages(updated.messages); await refreshSessions() }
    else setMessages(current => [...current, { role: 'assistant', text, createdAt: new Date().toISOString() }])
  }
  function approvalOf(task: NajdTask, sessionId: string | null): Approval {
    const input = task.proposedInput
    const agent = task.viaAgent ? { summary: input?.summary || '', body: input?.command ?? input?.preview ?? '' } : undefined
    return { approvalId: task.approvalId || '', taskId: task.id, path: [input?.path, input?.query].filter(Boolean).join(' | '), tool: task.proposedTool || '', sessionId, localOnly: !!task.localOnlyOutput && !agent, ...(agent ? { agent } : {}) }
  }

  async function respondToApproval(decision: 'ALLOW_ONCE' | 'ALLOW_TASK' | 'DENY') {
    if (!approval || !window.najdCore?.respondApproval || busy) return
    const current = approval, workKey = beginWork(current.sessionId, messages.length)
    setApproval(null); setBusy(true); setErrorCode(null)
    try {
      let task = await window.najdCore.respondApproval(current.approvalId, decision)
      recordWork(workKey, task); setActiveTaskId(task.id)
      while (task.state === 'QUEUED' || task.state === 'RUNNING') { task = await nextTaskState(task); recordWork(workKey, task) }
      if (task.state === 'WAITING_APPROVAL' && task.approvalId) { setApproval(approvalOf(task, current.sessionId)); return }
      if (task.viaAgent) {
        if ((task.state === 'COMPLETED' || task.state === 'UNKNOWN_EFFECT') && task.output) { await appendAssistant(current.sessionId, task.output, task.id); void window.najdBrowser?.askSaved(task.id); if (task.state === 'UNKNOWN_EFFECT') setErrorCode('UNKNOWN_EFFECT') } else setErrorCode(task.errorCode || 'ERROR')
        return
      }
      if (decision === 'DENY' && task.errorCode === 'PERMISSION_DENIED') { await appendAssistant(current.sessionId, ar ? 'لم تتم الموافقة، فلم يُنفذ الطلب.' : 'Not approved, so the request was not carried out.', task.id); return }
      if (task.state === 'COMPLETED' && typeof task.output === 'string') {
        if (current.localOnly) { await appendAssistant(current.sessionId, ar ? 'جهزت معاينة محلية للملف؛ لم يُرسل محتواه إلى النموذج.' : 'A local preview is ready; the content was not sent to the model.', task.id); setLocalPreview({ sessionId: current.sessionId, text: task.output.slice(0, 20000) }) }
        else await appendAssistant(current.sessionId, task.output.slice(0, 20000), task.id)
      } else setErrorCode(task.errorCode || 'ERROR')
    } catch { setErrorCode('ERROR') } finally { finishWork(workKey); setActiveTaskId(null); setBusy(false) }
  }

  // Added to the running task; what it never read becomes the next request, so nothing is lost.
  const noteSaves = useRef<Promise<unknown>>(Promise.resolve())
  async function addToRunningTask(text: string) {
    if (!text || !activeTaskId || !window.najdCore?.addNote) return
    const sessionId = activeSessionId
    try {
      await window.najdCore.addNote(activeTaskId, text); setDraft('')
      if (sessionId && window.najdSessions) {
        const save = noteSaves.current.then(() => window.najdSessions!.append(sessionId, 'user', text)).then(updated => { setMessages(updated.messages); scroll.toLatest() })
        noteSaves.current = save.catch(() => {}); await save
      }
    } catch { setErrorCode('ERROR') }
  }
  const notReady = !historyReady || !recoveryReady || providers.connectionBusy || importing
  async function submit() {
    const text = draft.trim()
    if (busy && activeTaskId) { await addToRunningTask(text); return }
    if (text && !busy && !approval && notReady) { setQueuedSend(true); return } // Enter while NAJD is still opening: the message waits, it is not lost
    await submitText(text, {})
  }
  useEffect(() => {
    if (!queuedSend || notReady || busy || approval) return
    setQueuedSend(false)
    if (draft.trim()) void submitText(draft.trim(), {})
  }, [queuedSend, notReady, busy, approval])

  const followUpRunning = useRef(false), followUpLatest = useRef<typeof followUp>(null)
  followUpLatest.current = followUp
  const latest = useRef({ submitText: (_t: string, _a: { alreadySaved?: boolean }) => Promise.resolve(false), taskId: null as string | null, sessionId: null as string | null })
  useEffect(() => {
    if (!followUp || busy || approval || importing || followUpRunning.current) return
    const next = followUp
    if (next.sessionId !== activeSessionId) { setFollowUp(null); return }
    followUpRunning.current = true
    const settle = () => setFollowUp(current => current === next ? null : current)
    void noteSaves.current.then(async () => {
      if (latest.current.sessionId !== next.sessionId || followUpLatest.current !== next) return
      if (await latest.current.submitText(next.text, { alreadySaved: true })) { settle(); return }
      const running = latest.current.taskId
      if (running && window.najdCore?.addNote) { try { await window.najdCore.addNote(running, next.text); settle() } catch { /* tried again when idle */ } }
    }).catch(() => {}).finally(() => { followUpRunning.current = false; if (followUpLatest.current && followUpLatest.current !== next) setFollowUpTick(value => value + 1) })
  }, [followUp, busy, approval, importing, activeSessionId, followUpTick])

  const recoveredAsks = useRef<Set<string>>(new Set()), cancelledAsks = useRef<Set<string>>(new Set())
  async function recoverAsk(taskId: string) {
    if (recoveredAsks.current.has(taskId) || !window.najdCore?.getTask) return
    recoveredAsks.current.add(taskId); setBusy(true)
    let workKey: string | null = null
    try {
      let task = await window.najdCore.getTask(taskId)
      const sessionId = task.conversationId || null
      if (task.state === 'QUEUED' || task.state === 'RUNNING') {
        workKey = beginWork(sessionId, messages.length); recordWork(workKey, task)
        setActiveTaskId(task.id)
      }
      while (task.state === 'QUEUED' || task.state === 'RUNNING') { task = await nextTaskState(task); if (workKey) recordWork(workKey, task) }
      if (task.state === 'WAITING_APPROVAL' && task.approvalId) { if (sessionId) setActiveSessionId(sessionId); setApproval(approvalOf(task, sessionId)); return }
      if ((task.state === 'COMPLETED' || task.state === 'UNKNOWN_EFFECT') && task.output && sessionId && window.najdSessions) {
        const session = await window.najdSessions.get(sessionId)
        const same = (value: string) => value.replace(/\r\n/g, '\n').trim()
        if (!session.messages.some(message => message.role === 'assistant' && same(message.text) === same(task.output as string))) { setActiveSessionId(sessionId); await appendAssistant(sessionId, task.output, task.id) }
        void window.najdBrowser?.askSaved(task.id)
      }
    } catch { /* the question keeps reporting through the bridge */ } finally { if (workKey) finishWork(workKey); setActiveTaskId(null); setBusy(false) }
  }
  useEffect(() => {
    if (!historyReady || !window.najdBrowser?.activeAsks) return
    void window.najdBrowser.activeAsks().then(async list => { for (const item of list) await recoverAsk(item.taskId) }).catch(() => {}).finally(() => setRecoveryReady(true))
  }, [historyReady])

  async function submitText(text: string, ask: { askId?: string; fresh?: boolean; alreadySaved?: boolean; browserContext?: NajdBrowserContext; sessionId?: string; model?: { provider: string; model: string } }): Promise<boolean> {
    const report = (patch: Parameters<NonNullable<typeof window.najdBrowser>['askUpdate']>[1]) => { if (ask.askId) void window.najdBrowser?.askUpdate(ask.askId, patch).catch(() => {}) }
    if (!text || busy || importing || providers.connectionBusy || approval || !historyReady || !recoveryReady) return false
    const assetIds = ask.fresh ? [] : selectChatAssetIds(messages, attachments)
    const activeProvider = ask.model?.provider || providers.provider
    const activeModel = ask.model ? ask.model.model : providers.model
    const activeEffort = ask.model ? 'auto' : providers.effort
    setBusy(true); setErrorCode(null); handlers.onActive?.()
    let stored = false, started = false, workKey: string | null = null
    let sessionId = ask.sessionId || (ask.fresh ? null : activeSessionId)
    if (ask.sessionId) setActiveSessionId(ask.sessionId)
    const attached = ask.fresh ? [] : attachments.map(({ id, name }) => ({ id, name }))
    let transcript: NajdMessage[] = [...(ask.fresh ? [] : messages), { role: 'user', text, createdAt: new Date().toISOString(), ...(attached.length ? { attachments: attached } : {}) }]
    try {
      if (window.najdSessions) {
        if (!sessionId) {
          sessionId = (await window.najdSessions.create()).id
          setActiveSessionId(sessionId)
          if (chatProject && !ask.fresh && window.najdProjects) { await window.najdProjects.assign(sessionId, chatProject).catch(() => {}); setChatProject(null); void refreshProjects() }
        }
        const current = ask.alreadySaved ? await window.najdSessions.get(sessionId) : null
        const updated = current && current.messages.at(-1)?.role === 'user' && current.messages.at(-1)?.text === text ? current : await window.najdSessions.append(sessionId, 'user', text, undefined, attached.length ? attached.map(item => item.id) : undefined)
        transcript = updated.messages; setMessages(updated.messages); await refreshSessions()
      } else setMessages(transcript)
      stored = true; scroll.toLatest()
      const referenced = ask.fresh || ask.askId ? [] : rememberMentions(sessionId, activeMentions(text, mentions))
      if (!ask.askId) { setDraft(''); setAttachments([]); setMentions([]) }
      const quoted = referenced.length && window.najdSessions ? referenceBlock((await Promise.all(referenced.map(item => window.najdSessions!.get(item.id).catch(() => null)))).filter((chat): chat is NonNullable<typeof chat> => !!chat).map(chat => ({ title: chat.title || '', messages: chat.messages }))) : null
      const modelHistory = buildModelHistory(transcript)
      if (quoted) modelHistory.splice(modelHistory.length - 1, 0, { role: 'user', text: quoted })
      if (!window.najdCore) { setErrorCode('RUNTIME_UNAVAILABLE'); report({ state: 'failed', progress: 'RUNTIME_UNAVAILABLE' }); return false }
      if (ask.askId && cancelledAsks.current.has(ask.askId)) return false
      workKey = beginWork(sessionId, transcript.length)
      let task = await window.najdCore.startTask(text, crypto.randomUUID(), activeProvider, activeModel || undefined, modelHistory, activeEffort, assetIds, sessionId || undefined, pinned(sessionId) || undefined, accessMode, ask.browserContext, ask.askId)
      started = true; recordWork(workKey, task); setActiveTaskId(task.id)
      report({ state: 'running', taskId: task.id, progress: progressLine(task) })
      let lastProgress = ''
      while (task.state === 'QUEUED' || task.state === 'RUNNING') {
        task = await nextTaskState(task); recordWork(workKey, task)
        const line = progressLine(task)
        if (line !== lastProgress) { lastProgress = line; report({ state: 'running', progress: line }) }
      }
      if (task.state !== 'WAITING_APPROVAL' && task.unreadNotes?.length) setFollowUp({ text: task.unreadNotes.join('\n\n'), sessionId })
      if (task.state === 'WAITING_APPROVAL' && task.approvalId && window.najdCore.respondApproval && !(ask.askId && cancelledAsks.current.has(ask.askId))) {
        setApproval(approvalOf(task, sessionId)); report({ state: 'waiting_approval', needsApproval: true, progress: progressLine(task) })
      } else if ((task.state === 'COMPLETED' || task.state === 'UNKNOWN_EFFECT') && task.output) {
        await appendAssistant(sessionId, task.output, task.id)
        if (ask.askId) void window.najdBrowser?.askSaved(task.id)
        if (task.state === 'UNKNOWN_EFFECT') setErrorCode('UNKNOWN_EFFECT')
        report({ state: task.state === 'COMPLETED' ? 'done' : 'failed', output: task.output, progress: task.state === 'COMPLETED' ? '' : 'UNKNOWN_EFFECT', needsApproval: false })
      } else {
        report({ state: task.state === 'CANCELLED' ? 'cancelled' : 'failed', progress: typeof task.errorCode === 'string' ? task.errorCode : task.state, needsApproval: false })
        setErrorCode(assetIds.length && ['TOOLS_NOT_SUPPORTED', 'PROVIDER_REJECTED'].includes(String(task.errorCode)) ? 'ATTACHMENT_PROVIDER' : task.state === 'CANCELLED' ? 'CANCELLED' : task.errorCode || 'ERROR')
      }
    } catch {
      if (!(ask.askId && cancelledAsks.current.has(ask.askId))) setErrorCode(stored ? 'ERROR' : 'HISTORY')
      report({ state: 'failed', progress: 'ERROR' })
    } finally { if (workKey) finishWork(workKey); setActiveTaskId(null); setBusy(false) }
    return started
  }
  latest.current = { submitText, taskId: activeTaskId, sessionId: activeSessionId }

  // Questions from the browser extension and instructions from a paired device wait their turn and run as their own conversation.
  const askQueue = useRef<NajdBrowserAsk[]>([]), seenAsks = useRef<Set<string>>(new Set()), remoteQueue = useRef<string[]>([])
  useEffect(() => window.najdBrowser?.onAsk(ask => { if (seenAsks.current.has(ask.id)) return; seenAsks.current.add(ask.id); askQueue.current.push(ask); setAskTick(value => value + 1) }), [])
  useEffect(() => window.najdBrowser?.onAskCancelled(({ id, taskId }) => {
    cancelledAsks.current.add(id); askQueue.current = askQueue.current.filter(item => item.id !== id)
    if (taskId) setApproval(current => current?.taskId === taskId ? null : current)
  }), [])
  useEffect(() => window.najdWorkstation?.onRemote(event => {
    if (event.kind === 'instruct' && event.text) { remoteQueue.current.push(event.text); setAskTick(value => value + 1) }
  }), [])
  useEffect(() => {
    if (busy || approval || importing || !historyReady || !recoveryReady || providers.connectionBusy || draft.trim() || attachments.length) return
    const remote = remoteQueue.current.shift()
    if (remote) { void submitText(remote, { fresh: true }); return }
    const next = askQueue.current.shift()
    if (!next || cancelledAsks.current.has(next.id)) return
    const page = next.page
    const browserContext = page && (page.url || page.selection || page.text || page.attachment || page.tabs?.length) ? { title: page.title.slice(0, 200), url: page.url.slice(0, 500), selection: page.selection.slice(0, 2000), ...(page.text ? { text: page.text.slice(0, 12000) } : {}), ...(page.lang ? { lang: page.lang.slice(0, 16) } : {}), ...(page.attachment ? { attachment: { name: page.attachment.name.slice(0, 120), text: page.attachment.text.slice(0, 20000) } } : {}), ...(page.tabs?.length ? { tabs: page.tabs.slice(0, 3).map(tab => ({ url: tab.url.slice(0, 500), title: tab.title.slice(0, 200), text: tab.text.slice(0, 6000) })) } : {}) } : undefined
    const known = next.conversationId && sessions.some(item => item.id === next.conversationId) ? next.conversationId : undefined
    void submitText(next.text, { askId: next.id, fresh: true, browserContext, sessionId: known, model: next.model || undefined }).then(begun => { if (!begun) void window.najdBrowser?.askUpdate(next.id, { state: 'failed', progress: 'NOT_STARTED' }).catch(() => {}) })
  }, [askTick, sessions, busy, approval, importing, historyReady, recoveryReady, providers.connectionBusy, draft, attachments.length])

  async function stop() {
    if (activeTaskId && window.najdCore?.cancelTask) { try { await window.najdCore.cancelTask(activeTaskId) } catch { setErrorCode('ERROR') } return }
    const waiting = approval
    if (!waiting?.taskId || !window.najdCore?.cancelTask) return
    const run = [...workRuns].reverse().find(item => item.sessionId === waiting.sessionId && !item.finishedAt)
    try { const task = await window.najdCore.cancelTask(waiting.taskId); setApproval(null); if (run) { recordWork(run.key, task); finishWork(run.key) } setErrorCode('CANCELLED') } catch { setErrorCode('ERROR') }
  }
  const currentActivity = useMemo(() => {
    if (!activeSessionId) return undefined
    const run = [...workRuns].reverse().find(item => item.sessionId === activeSessionId && item.activity)
    return run?.activity ?? [...messages].reverse().find(message => message.activity)?.activity
  }, [workRuns, messages, activeSessionId])

  return { draft, setDraft, attachments, setAttachments, mentions, setMentions, messages, sessions, activeSessionId, projects, setProjects, refreshProjects, chatProject, setChatProject, historyReady, busy, importing, setImporting, activeTaskId, workRuns, approval, errorCode, setErrorCode,
    localPreview, setLocalPreview, accessMode, setAccessMode, queuedSend, scroll, locked, openSession, newTask, deleteSession, submit, submitText, respondToApproval, stop, pinned, pinProfile, currentActivity, refreshSessions }
}
export type Conversation = ReturnType<typeof useConversation>
