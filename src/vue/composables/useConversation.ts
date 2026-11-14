import { computed, onScopeDispose, ref, watch } from 'vue'
import { failoverFor, loadFallback, type ModelRef } from '../../workstation/failover'
import { toast } from './useToast'
import { buildModelHistory, selectChatAssetIds } from '../../chat-context'
import { activeMentions, referenceBlock, rememberMentions, type Mention } from '../../mentions'
import { nextTaskState } from '../../taskWatch'
import type { ProviderState } from './useProviders'

// The conversation engine in Vue: the same rules as src/workstation/useConversation.ts (one running task, a message saved before its
// task starts, an approval answered once, a browser question taken once and never answered twice, notes added to a running task never
// lost). Vue refs always hold the current value, so the React version's "latest" mirrors are not needed here.
export type AccessMode = 'ask' | 'approve' | 'full'
export type WorkStep = { state: string; proposedTool: string | null; reasoningEffort: NajdReasoningPreference | null }
export type WorkRun = { key: string; sessionId: string | null; afterIndex: number; startedAt: number; finishedAt?: number; steps: WorkStep[]; activity?: NajdTaskActivity }
export type Approval = { approvalId: string; taskId?: string; path: string; tool: string; sessionId: string | null; localOnly: boolean; agent?: { summary: string; body: string } }

const ACCESS_KEY = 'najd.access-mode.v1', PINS_KEY = 'najd.profilePins.v1'
function progressLine(task: NajdTask): string {
  const last = [...(task.activity?.events ?? [])].reverse().find(event => event.type.startsWith('tool.') || event.type === 'approval.requested')
  return last ? `${last.tool || last.type}${last.detail ? ': ' + last.detail : ''}`.slice(0, 190) : ''
}

export function useConversation(providers: ProviderState, language: () => 'ar' | 'en', onActive: () => void = () => {}) {
  const say = (ar: string, en: string) => language() === 'ar' ? ar : en
  const draft = ref(''), attachments = ref<NajdAsset[]>([]), mentions = ref<Mention[]>([])
  const messages = ref<NajdMessage[]>([]), sessions = ref<NajdSessionSummary[]>([]), activeSessionId = ref<string | null>(null)
  const projects = ref<NajdProject[]>([]), chatProject = ref<string | null>(null)
  const historyReady = ref(!window.najdSessions), recoveryReady = ref(!window.najdBrowser?.activeAsks)
  const busy = ref(false), importing = ref(false), activeTaskId = ref<string | null>(null)
  const workRuns = ref<WorkRun[]>([]), approval = ref<Approval | null>(null), errorCode = ref<string | null>(null)
  const localPreview = ref<{ sessionId: string | null; text: string } | null>(null), queuedSend = ref(false)
  const stored = localStorage.getItem(ACCESS_KEY)
  const accessMode = ref<AccessMode>(stored === 'approve' || stored === 'full' ? stored : 'ask')
  const pins = ref<Record<string, string>>((() => { try { return JSON.parse(localStorage.getItem(PINS_KEY) || '{}') || {} } catch { return {} } })())
  watch(accessMode, value => localStorage.setItem(ACCESS_KEY, value))
  watch(pins, value => { try { localStorage.setItem(PINS_KEY, JSON.stringify(value)) } catch {} }, { deep: true })
  watch(activeSessionId, () => { attachments.value = [] })
  const pinned = (id: string | null) => id ? pins.value[id] || null : null
  const locked = computed(() => busy.value || importing.value || !!approval.value)
  const notReady = computed(() => !historyReady.value || !recoveryReady.value || providers.connectionBusy.value || importing.value)

  function beginWork(sessionId: string | null, afterIndex: number) {
    const key = `${sessionId}:${afterIndex}`
    workRuns.value = workRuns.value.some(run => run.key === key) ? workRuns.value.map(run => run.key === key ? { ...run, finishedAt: undefined } : run) : [...workRuns.value.slice(-39), { key, sessionId, afterIndex, startedAt: Date.now(), steps: [] }]
    return key
  }
  function recordWork(key: string, task: NajdTask) {
    const step = { state: task.state, proposedTool: task.proposedTool, reasoningEffort: task.reasoningEffort }
    const current = workRuns.value.find(run => run.key === key)
    if (!current || JSON.stringify(current.steps.at(-1)) === JSON.stringify(step) && JSON.stringify(current.activity) === JSON.stringify(task.activity)) return
    workRuns.value = workRuns.value.map(run => run.key === key ? { ...run, activity: task.activity, steps: JSON.stringify(run.steps.at(-1)) === JSON.stringify(step) ? run.steps : [...run.steps.slice(-19), step] } : run)
  }
  function finishWork(key: string) { workRuns.value = workRuns.value.map(run => run.key === key ? { ...run, finishedAt: run.steps.at(-1)?.state === 'WAITING_APPROVAL' ? undefined : Date.now() } : run) }

  async function refreshSessions() { if (window.najdSessions) sessions.value = await window.najdSessions.list() }
  async function refreshProjects() { try { if (window.najdProjects) projects.value = await window.najdProjects.list() } catch {} }
  void refreshProjects()
  if (window.najdSessions) void window.najdSessions.list().then(list => { sessions.value = list }).catch(() => { errorCode.value = 'HISTORY' }).finally(() => { historyReady.value = true })
  const offSessions = window.najdChannels?.onSessionsChanged(entry => {
    void refreshSessions()
    const id = activeSessionId.value
    if (entry?.sessionId && entry.sessionId === id && !locked.value && window.najdSessions) void window.najdSessions.get(id).then(session => { if (activeSessionId.value === id) messages.value = session.messages }).catch(() => {})
  })

  async function openSession(id: string) {
    if (!window.najdSessions || locked.value) return false
    try { const session = await window.najdSessions.get(id); activeSessionId.value = id; messages.value = session.messages; errorCode.value = null; onActive(); return true } catch { errorCode.value = 'HISTORY'; return false }
  }
  // Branch from a message (owner request 2026-11-10): a new conversation with everything before that message, the message itself in
  // the composer to edit and send; the original conversation stays as it was. Pictures still in the library come along.
  async function branchFrom(index: number) {
    const source = messages.value, picked = source[index]
    if (!window.najdSessions || locked.value || !picked || picked.role !== 'user') return false
    busy.value = true
    try {
      const id = (await window.najdSessions.create()).id
      for (const message of source.slice(0, index)) {
        const ids = message.role === 'user' && message.attachments?.length ? message.attachments.map(item => item.id) : undefined
        try { await window.najdSessions.append(id, message.role, message.text, undefined, ids) } catch { await window.najdSessions.append(id, message.role, message.text) }
      }
      busy.value = false
      await refreshSessions()
      if (!await openSession(id)) return false
      draft.value = picked.text
      return true
    } catch { errorCode.value = 'HISTORY'; return false } finally { busy.value = false }
  }
  function newTask(project: string | null = null) {
    if (locked.value || !historyReady.value) return
    activeSessionId.value = null; draft.value = ''; messages.value = []; attachments.value = []; mentions.value = []; chatProject.value = project; errorCode.value = null
    workRuns.value = workRuns.value.filter(run => run.sessionId !== null)
  }
  async function deleteSession(id: string) {
    if (!window.najdSessions || busy.value || approval.value) return
    try { await window.najdSessions.delete(id); await refreshSessions(); if (id === activeSessionId.value) newTask() }
    catch (reason) { errorCode.value = String(reason).includes('PROCESSES_RUNNING') ? 'PROCESSES_RUNNING' : String(reason).includes('CONVERSATION_BUSY') ? 'CONVERSATION_BUSY' : 'HISTORY' }
  }
  async function appendAssistant(sessionId: string | null, text: string, taskId?: string) {
    if (sessionId && window.najdSessions) { const updated = await window.najdSessions.append(sessionId, 'assistant', text, taskId); messages.value = updated.messages; await refreshSessions() }
    else messages.value = [...messages.value, { role: 'assistant', text, createdAt: new Date().toISOString() }]
  }
  function approvalOf(task: NajdTask, sessionId: string | null): Approval {
    const input = task.proposedInput
    const agent = task.viaAgent ? { summary: input?.summary || '', body: input?.command ?? input?.preview ?? '' } : undefined
    return { approvalId: task.approvalId || '', taskId: task.id, path: [input?.path, input?.query].filter(Boolean).join(' | '), tool: task.proposedTool || '', sessionId, localOnly: !!task.localOnlyOutput && !agent, ...(agent ? { agent } : {}) }
  }

  async function respondToApproval(decision: 'ALLOW_ONCE' | 'ALLOW_TASK' | 'DENY') {
    const current = approval.value
    if (!current || !window.najdCore?.respondApproval || busy.value) return
    const workKey = beginWork(current.sessionId, messages.value.length)
    approval.value = null; busy.value = true; errorCode.value = null
    try {
      let task = await window.najdCore.respondApproval(current.approvalId, decision)
      recordWork(workKey, task); activeTaskId.value = task.id
      while (task.state === 'QUEUED' || task.state === 'RUNNING') { task = await nextTaskState(task); recordWork(workKey, task) }
      if (task.state === 'WAITING_APPROVAL' && task.approvalId) { approval.value = approvalOf(task, current.sessionId); return }
      if (task.viaAgent) {
        if ((task.state === 'COMPLETED' || task.state === 'UNKNOWN_EFFECT') && task.output) { await appendAssistant(current.sessionId, task.output, task.id); void window.najdBrowser?.askSaved(task.id); if (task.state === 'UNKNOWN_EFFECT') errorCode.value = 'UNKNOWN_EFFECT' }
        else errorCode.value = task.errorCode || 'ERROR'
        return
      }
      const ar = language() === 'ar'
      if (decision === 'DENY' && task.errorCode === 'PERMISSION_DENIED') { await appendAssistant(current.sessionId, ar ? 'لم تتم الموافقة، فلم يُنفذ الطلب.' : 'Not approved, so the request was not carried out.', task.id); return }
      if (task.state === 'COMPLETED' && typeof task.output === 'string') {
        if (current.localOnly) { await appendAssistant(current.sessionId, ar ? 'جهزت معاينة محلية للملف؛ لم يُرسل محتواه إلى النموذج.' : 'A local preview is ready; the content was not sent to the model.', task.id); localPreview.value = { sessionId: current.sessionId, text: task.output.slice(0, 20000) } }
        else await appendAssistant(current.sessionId, task.output.slice(0, 20000), task.id)
      } else errorCode.value = task.errorCode || 'ERROR'
    } catch { errorCode.value = 'ERROR' } finally { finishWork(workKey); activeTaskId.value = null; busy.value = false }
  }

  // A message sent while a task works joins it; what the task never read becomes the next request, so nothing is lost.
  let noteSaves: Promise<unknown> = Promise.resolve()
  async function addToRunningTask(text: string) {
    const taskId = activeTaskId.value, sessionId = activeSessionId.value
    if (!text || !taskId || !window.najdCore?.addNote) return
    try {
      await window.najdCore.addNote(taskId, text); draft.value = ''
      if (sessionId && window.najdSessions) { const save = noteSaves.then(() => window.najdSessions!.append(sessionId, 'user', text)).then(updated => { messages.value = updated.messages }); noteSaves = save.catch(() => {}); await save }
    } catch { errorCode.value = 'ERROR' }
  }
  async function submit() {
    const text = draft.value.trim()
    if (busy.value && activeTaskId.value) { await addToRunningTask(text); return }
    if (text && !busy.value && !approval.value && notReady.value) { queuedSend.value = true; return }
    await submitText(text, {})
  }
  watch([queuedSend, notReady, busy, approval], () => { if (!queuedSend.value || notReady.value || busy.value || approval.value) return; queuedSend.value = false; if (draft.value.trim()) void submitText(draft.value.trim(), {}) })

  const followUps: { text: string; sessionId: string | null }[] = []
  async function drainFollowUps() {
    while (followUps.length && !busy.value && !approval.value && !importing.value) {
      const next = followUps.shift()!
      if (next.sessionId !== activeSessionId.value) continue
      await noteSaves
      if (await submitText(next.text, { alreadySaved: true })) continue
      if (activeTaskId.value && window.najdCore?.addNote) { try { await window.najdCore.addNote(activeTaskId.value, next.text) } catch { followUps.unshift(next); return } }
    }
  }

  const recoveredAsks = new Set<string>(), cancelledAsks = new Set<string>()
  async function recoverAsk(taskId: string) {
    if (recoveredAsks.has(taskId) || !window.najdCore?.getTask) return
    recoveredAsks.add(taskId); busy.value = true
    let workKey: string | null = null
    try {
      let task = await window.najdCore.getTask(taskId)
      const sessionId = task.conversationId || null
      if (task.state === 'QUEUED' || task.state === 'RUNNING') { workKey = beginWork(sessionId, messages.value.length); recordWork(workKey, task); activeTaskId.value = task.id }
      while (task.state === 'QUEUED' || task.state === 'RUNNING') { task = await nextTaskState(task); if (workKey) recordWork(workKey, task) }
      if (task.state === 'WAITING_APPROVAL' && task.approvalId) { if (sessionId) activeSessionId.value = sessionId; approval.value = approvalOf(task, sessionId); return }
      if ((task.state === 'COMPLETED' || task.state === 'UNKNOWN_EFFECT') && task.output && sessionId && window.najdSessions) {
        const session = await window.najdSessions.get(sessionId), same = (value: string) => value.replace(/\r\n/g, '\n').trim()
        if (!session.messages.some(message => message.role === 'assistant' && same(message.text) === same(task.output as string))) { activeSessionId.value = sessionId; await appendAssistant(sessionId, task.output, task.id) }
        void window.najdBrowser?.askSaved(task.id)
      }
    } catch { /* the question keeps reporting through the bridge */ } finally { if (workKey) finishWork(workKey); activeTaskId.value = null; busy.value = false }
  }
  watch(historyReady, ready => {
    if (!ready || !window.najdBrowser?.activeAsks) return
    void window.najdBrowser.activeAsks().then(async list => { for (const item of list) await recoverAsk(item.taskId) }).catch(() => {}).finally(() => { recoveryReady.value = true })
  }, { immediate: true })

  async function submitText(text: string, ask: { askId?: string; fresh?: boolean; alreadySaved?: boolean; browserContext?: NajdBrowserContext; sessionId?: string; model?: { provider: string; model: string }; failedOver?: boolean; resumeNote?: string; pictures?: { id: string; name: string }[] }): Promise<boolean> {
    const report = (patch: Parameters<NonNullable<typeof window.najdBrowser>['askUpdate']>[1]) => { if (ask.askId) void window.najdBrowser?.askUpdate(ask.askId, patch).catch(() => {}) }
    if (!text || busy.value || importing.value || providers.connectionBusy.value || approval.value || !historyReady.value || !recoveryReady.value) return false
    // A question from the browser panel may bring one picture of the page (already in the library); it is this question's only attachment.
    const assetIds = ask.pictures?.length ? ask.pictures.map(item => item.id) : ask.fresh ? [] : selectChatAssetIds(messages.value, attachments.value)
    const activeProvider = ask.model?.provider || providers.provider.value
    const activeModel = ask.model ? ask.model.model : providers.model.value
    const activeEffort = ask.model ? 'auto' : providers.effort.value
    busy.value = true; errorCode.value = null; onActive()
    let stored = false, started = false, workKey: string | null = null
    let backup: ModelRef | null = null
    let sessionId = ask.sessionId || (ask.fresh ? null : activeSessionId.value)
    if (ask.sessionId) activeSessionId.value = ask.sessionId
    const attached = ask.pictures?.length ? ask.pictures.map(({ id, name }) => ({ id, name })) : ask.fresh ? [] : attachments.value.map(({ id, name }) => ({ id, name }))
    let transcript: NajdMessage[] = [...(ask.fresh ? [] : messages.value), { role: 'user', text, createdAt: new Date().toISOString(), ...(attached.length ? { attachments: attached } : {}) }]
    try {
      if (window.najdSessions) {
        if (!sessionId) {
          sessionId = (await window.najdSessions.create()).id
          activeSessionId.value = sessionId
          if (chatProject.value && !ask.fresh && window.najdProjects) { await window.najdProjects.assign(sessionId, chatProject.value).catch(() => {}); chatProject.value = null; void refreshProjects() }
        }
        const current = ask.alreadySaved ? await window.najdSessions.get(sessionId) : null
        const updated = current && current.messages.at(-1)?.role === 'user' && current.messages.at(-1)?.text === text ? current : await window.najdSessions.append(sessionId, 'user', text, undefined, attached.length ? attached.map(item => item.id) : undefined)
        transcript = updated.messages; messages.value = updated.messages; await refreshSessions()
      } else messages.value = transcript
      stored = true
      const referenced = ask.fresh || ask.askId ? [] : rememberMentions(sessionId, activeMentions(text, mentions.value))
      if (!ask.askId) { draft.value = ''; attachments.value = []; mentions.value = [] }
      const quoted = referenced.length && window.najdSessions ? referenceBlock((await Promise.all(referenced.map(item => window.najdSessions!.get(item.id).catch(() => null)))).filter((chat): chat is NonNullable<typeof chat> => !!chat).map(chat => ({ title: chat.title || '', messages: chat.messages }))) : null
      const modelHistory = buildModelHistory(transcript)
      if (quoted) modelHistory.splice(modelHistory.length - 1, 0, { role: 'user', text: quoted })
      // Continuing a stopped run: what it had already done goes to the model just before the request (never shown as the owner's words).
      if (ask.resumeNote) modelHistory.splice(modelHistory.length - 1, 0, { role: 'user', text: ask.resumeNote.slice(0, 6000) })
      if (!window.najdCore) { errorCode.value = 'RUNTIME_UNAVAILABLE'; report({ state: 'failed', progress: 'RUNTIME_UNAVAILABLE' }); return false }
      if (ask.askId && cancelledAsks.has(ask.askId)) return false
      workKey = beginWork(sessionId, transcript.length)
      let task = await window.najdCore.startTask(text, crypto.randomUUID(), activeProvider, activeModel || undefined, modelHistory, activeEffort, assetIds, sessionId || undefined, pinned(sessionId) || undefined, accessMode.value, ask.browserContext, ask.askId)
      started = true; recordWork(workKey, task); activeTaskId.value = task.id
      report({ state: 'running', taskId: task.id, progress: progressLine(task) })
      let lastProgress = ''
      while (task.state === 'QUEUED' || task.state === 'RUNNING') {
        task = await nextTaskState(task); recordWork(workKey, task)
        const line = progressLine(task)
        if (line !== lastProgress) { lastProgress = line; report({ state: 'running', progress: line }) }
      }
      if (task.state !== 'WAITING_APPROVAL' && task.unreadNotes?.length) followUps.push({ text: task.unreadNotes.join('\n\n'), sessionId })
      if (task.state === 'WAITING_APPROVAL' && task.approvalId && window.najdCore.respondApproval && !(ask.askId && cancelledAsks.has(ask.askId))) {
        approval.value = approvalOf(task, sessionId); report({ state: 'waiting_approval', needsApproval: true, progress: progressLine(task) })
      } else if ((task.state === 'COMPLETED' || task.state === 'UNKNOWN_EFFECT') && task.output) {
        await appendAssistant(sessionId, task.output, task.id)
        if (ask.askId) void window.najdBrowser?.askSaved(task.id)
        if (task.state === 'UNKNOWN_EFFECT') errorCode.value = 'UNKNOWN_EFFECT'
        report({ state: task.state === 'COMPLETED' ? 'done' : 'failed', output: task.output, progress: task.state === 'COMPLETED' ? '' : 'UNKNOWN_EFFECT', needsApproval: false })
      } else if ((backup = failoverFor(task, { provider: activeProvider, model: activeModel || '' }, loadFallback(localStorage), !!ask.failedOver))) {
        // Backup model (failover.ts): the same request once more on the owner's backup, before anything ran; the owner is told why.
        toast(say(`تعذّر ${activeModel || activeProvider} (${task.errorCode})؛ أكمل نجد بالنموذج الاحتياطي ${backup.model}.`, `${activeModel || activeProvider} failed (${task.errorCode}); NAJD continued with the backup model ${backup.model}.`), 'info')
      } else {
        report({ state: task.state === 'CANCELLED' ? 'cancelled' : 'failed', progress: typeof task.errorCode === 'string' ? task.errorCode : task.state, needsApproval: false })
        errorCode.value = assetIds.length && ['TOOLS_NOT_SUPPORTED', 'PROVIDER_REJECTED'].includes(String(task.errorCode)) ? 'ATTACHMENT_PROVIDER' : task.state === 'CANCELLED' ? 'CANCELLED' : task.errorCode || 'ERROR'
      }
    } catch {
      if (!(ask.askId && cancelledAsks.has(ask.askId))) errorCode.value = stored ? 'ERROR' : 'HISTORY'
      report({ state: 'failed', progress: 'ERROR' })
    } finally { if (workKey) finishWork(workKey); activeTaskId.value = null; busy.value = false; if (!backup) void drainFollowUps() }
    if (backup && sessionId) return submitText(text, { ...ask, sessionId, alreadySaved: true, model: backup, failedOver: true })
    return started
  }

  // Questions from the browser extension and instructions from a paired device wait their turn and run as their own conversation.
  const askQueue: NajdBrowserAsk[] = [], seenAsks = new Set<string>(), remoteQueue: string[] = []
  const askTick = ref(0)
  const offAsk = window.najdBrowser?.onAsk(ask => { if (seenAsks.has(ask.id)) return; seenAsks.add(ask.id); askQueue.push(ask); askTick.value++ })
  const offCancel = window.najdBrowser?.onAskCancelled(({ id, taskId }) => {
    cancelledAsks.add(id)
    const index = askQueue.findIndex(item => item.id === id); if (index >= 0) askQueue.splice(index, 1)
    if (taskId && approval.value?.taskId === taskId) approval.value = null
  })
  const offRemote = window.najdWorkstation?.onRemote(event => { if (event.kind === 'instruct' && event.text) { remoteQueue.push(event.text); askTick.value++ } })
  watch([askTick, sessions, busy, approval, importing, historyReady, recoveryReady, () => providers.connectionBusy.value, draft, () => attachments.value.length], () => {
    if (busy.value || approval.value || importing.value || !historyReady.value || !recoveryReady.value || providers.connectionBusy.value || draft.value.trim() || attachments.value.length) return
    const remote = remoteQueue.shift()
    if (remote) { void submitText(remote, { fresh: true }); return }
    const next = askQueue.shift()
    if (!next || cancelledAsks.has(next.id)) return
    const page = next.page
    const browserContext = page && (page.url || page.selection || page.text || page.attachment || page.tabs?.length) ? { title: page.title.slice(0, 200), url: page.url.slice(0, 500), selection: page.selection.slice(0, 2000), ...(page.text ? { text: page.text.slice(0, 12000) } : {}), ...(page.lang ? { lang: page.lang.slice(0, 16) } : {}), ...(page.attachment ? { attachment: { name: page.attachment.name.slice(0, 120), text: page.attachment.text.slice(0, 20000) } } : {}), ...(page.tabs?.length ? { tabs: page.tabs.slice(0, 3).map(tab => ({ url: tab.url.slice(0, 500), title: tab.title.slice(0, 200), text: tab.text.slice(0, 6000) })) } : {}) } : undefined
    const known = next.conversationId && sessions.value.some(item => item.id === next.conversationId) ? next.conversationId : undefined
    void submitText(next.text, { askId: next.id, fresh: true, browserContext, sessionId: known, model: next.model || undefined, pictures: next.pictures?.length ? next.pictures : undefined }).then(begun => { if (!begun) void window.najdBrowser?.askUpdate(next.id, { state: 'failed', progress: 'NOT_STARTED' }).catch(() => {}) })
  })
  onScopeDispose(() => { offSessions?.(); offAsk?.(); offCancel?.(); offRemote?.() })

  async function stop() {
    if (activeTaskId.value && window.najdCore?.cancelTask) { try { await window.najdCore.cancelTask(activeTaskId.value) } catch { errorCode.value = 'ERROR' } return }
    const waiting = approval.value
    if (!waiting?.taskId || !window.najdCore?.cancelTask) return
    const run = [...workRuns.value].reverse().find(item => item.sessionId === waiting.sessionId && !item.finishedAt)
    try { const task = await window.najdCore.cancelTask(waiting.taskId); approval.value = null; if (run) { recordWork(run.key, task); finishWork(run.key) } errorCode.value = 'CANCELLED' } catch { errorCode.value = 'ERROR' }
  }
  const currentActivity = computed(() => {
    if (!activeSessionId.value) return undefined
    const run = [...workRuns.value].reverse().find(item => item.sessionId === activeSessionId.value && item.activity)
    return run?.activity ?? [...messages.value].reverse().find(message => message.activity)?.activity
  })

  return { draft, attachments, mentions, messages, sessions, activeSessionId, projects, chatProject, historyReady, busy, importing, activeTaskId, workRuns, approval, errorCode, localPreview, accessMode, queuedSend, locked,
    refreshProjects, refreshSessions, openSession, branchFrom, newTask, deleteSession, submit, submitText, respondToApproval, stop, pinned, currentActivity,
    pinProfile: (profile: string | null) => { const id = activeSessionId.value; if (!id) return; const next = { ...pins.value }; if (profile) next[id] = profile; else delete next[id]; pins.value = next } }
}
export type Conversation = ReturnType<typeof useConversation>
