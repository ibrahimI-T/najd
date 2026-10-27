// View model for the live activity block. It is built only from the real task events (main process, redacted);
// nothing here invents steps, counts or percentages.
export type ActivityKind = 'reasoning' | 'thinking' | 'advice' | 'plan' | 'command' | 'git' | 'python' | 'file-read' | 'file-write' | 'search' | 'web' | 'browser' | 'skill' | 'plugin' | 'mcp' |
  'desktop' | 'delegate' | 'memory' | 'media' | 'tool' | 'approval' | 'wait' | 'warning' | 'error' | 'success'
export type ActivityStatus = 'running' | 'succeeded' | 'failed' | 'cancelled' | 'awaiting-approval' | 'unconfirmed'

export interface AgentActivityEvent {
  id: string
  kind: ActivityKind
  tool?: string
  skill?: string
  title: string
  summary: string
  status: ActivityStatus
  startedAt: number
  endedAt?: number
  durationMs?: number
  exitCode?: number
  error?: string
  needsApproval: boolean
  // The start of this step was cut from the saved window, so its target is unknown.
  orphan?: boolean
  // The advisor (provider/model) whose note this is.
  model?: string
  parentId?: string
  children?: AgentActivityEvent[]
}
export interface ActivityGroup { id: string; kind: ActivityKind; tool?: string; items: AgentActivityEvent[]; status: ActivityStatus; startedAt: number; durationMs?: number }
export type ActivityRow = { type: 'event'; event: AgentActivityEvent } | { type: 'group'; group: ActivityGroup }
export interface ActivityCounts { tools: number; commands: number; filesRead: number; filesChanged: number; searches: number; pages: number; skills: number; mcp: number; errors: number; approvals: number }
export interface ActivityView { rows: ActivityRow[]; events: AgentActivityEvent[]; counts: ActivityCounts; running: boolean; waiting: boolean; failed: boolean; unknownEffect: boolean }

const KIND_OF: Record<string, ActivityKind> = {
  'najd-files-read': 'file-read', 'najd-files-list': 'file-read', 'najd-library-read': 'file-read', 'najd-library-export': 'file-write', 'najd-library-search': 'search', 'najd-log-read': 'file-read',
  'najd-log-list': 'file-read', 'najd-chats-read': 'file-read', 'najd-office-review': 'file-read',
  'najd-files-write': 'file-write', 'najd-files-edit': 'file-write', 'najd-files-move': 'file-write', 'najd-files-delete': 'file-write',
  'najd-files-search': 'search', 'najd-toolbox': 'file-read', 'najd-web-search': 'search', 'najd-extensions-search': 'search', 'najd-knowledge-search': 'search',
  'najd-chats-search': 'search', 'najd-capabilities-search': 'search',
  'najd-web-extract': 'web', 'najd-web-preview': 'web', 'najd-browser': 'browser',
  'najd-terminal-run': 'command', 'najd-process-start': 'command', 'najd-process-list': 'command', 'najd-process-output': 'command', 'najd-process-stop': 'command',
  'najd-python-run': 'python',
  'najd-skills-read': 'skill', 'najd-skill-save': 'skill', 'najd-mcp-call': 'mcp', 'najd-mcp-install': 'mcp', 'najd-extension-install': 'plugin',
  'najd-desktop-windows': 'desktop', 'najd-desktop-open': 'desktop', 'najd-desktop-read': 'desktop', 'najd-desktop-act': 'desktop',
  'najd-screen-capture': 'desktop', 'najd-connections-apps': 'desktop',
  'najd-delegate': 'delegate', 'najd-delegate-status': 'delegate', 'najd-delegate-cancel': 'delegate', 'najd-memory': 'memory',
  'najd-image-generate': 'media', 'najd-video-generate': 'media', 'najd-video-status': 'media', 'najd-video-cancel': 'media', 'najd-video-transcribe': 'media',
  'read-file': 'file-read', 'find-documents': 'search', 'windows-apps': 'desktop', 'windows-demo': 'desktop',
  'najd-capabilities-details': 'tool', 'najd-tools-load': 'tool', 'najd-plan': 'reasoning'
}
// Notes about the work (NAJD's plan line, the model's thinking, advisors' notes), not steps of it.
export const NOTE_KINDS = new Set<ActivityKind>(['reasoning', 'thinking', 'advice'])
const GROUPABLE = new Set<ActivityKind>(['file-read', 'search', 'web', 'browser'])
// Only these tools read the contents of a known file; listings, log lists and document reviews are not "files read".
const COMMAND_TOOLS = new Set(['najd-terminal-run', 'najd-python-run', 'najd-process-start'])
const FILE_CONTENT_TOOLS = new Set(['najd-files-read', 'najd-library-read', 'najd-log-read'])
// A page visit has a known target: a URL for web tools, "open · URL" or "search · query" for the browser. Reads, scrolls, clicks
// and other browser actions carry only an action label and are not page visits.
function pageTarget(event: AgentActivityEvent): string | null {
  if (event.orphan) return null
  if (event.kind === 'browser') { const match = /^(?:open|search) · (.+)$/.exec(event.summary); return match ? match[1] : null }
  return event.summary || null
}
const EXIT = /\(exit (-?\d+)\)/

export function activityKind(tool: string | undefined, detail: string | undefined): ActivityKind {
  if (!tool) return 'tool'
  const kind = KIND_OF[tool] || (tool.startsWith('najd-mcp') ? 'mcp' : 'tool')
  if (kind === 'command' && /^\s*git(\s|$)/i.test(detail || '')) return 'git'
  return kind
}

// How a finished tool step ended, from its event type and the runtime's normalized detail text.
function classify(type: string, text: string): { status: ActivityStatus; error?: string; exitCode?: number; countsAsError: boolean } {
  if (/^effect unknown/i.test(text)) return { status: 'unconfirmed', error: text, countsAsError: false }
  if (/^declined:/i.test(text)) return { status: 'cancelled', error: text.replace(/^declined:\s*/i, ''), countsAsError: false }
  if (/^unsuccessful:/i.test(text)) return { status: 'failed', error: text.replace(/^unsuccessful:\s*/i, ''), countsAsError: true }
  const exit = EXIT.exec(text)
  const exitCode = exit ? Number(exit[1]) : undefined
  const failed = type === 'tool.failed' || (exitCode !== undefined && exitCode !== 0)
  return { status: failed ? 'failed' : 'succeeded', ...(exitCode !== undefined ? { exitCode } : {}), ...(failed ? { error: text.replace(/^error:\s*/, '') || undefined } : {}), countsAsError: failed }
}
const time = (value: string) => { const parsed = Date.parse(value); return Number.isFinite(parsed) ? parsed : 0 }

export function buildActivity(activity: NajdTaskActivity | undefined, now = Date.now()): ActivityView {
  const counts: ActivityCounts = { tools: 0, commands: 0, filesRead: 0, filesChanged: 0, searches: 0, pages: 0, skills: 0, mcp: 0, errors: 0, approvals: 0 }
  const events: AgentActivityEvent[] = []
  if (!activity) return { rows: [], events, counts, running: false, waiting: false, failed: false, unknownEffect: false }
  const finished = activity.finishedAt ? time(activity.finishedAt) : undefined
  const open: AgentActivityEvent[] = []
  let n = 0
  // Stable ids come from the event sequence (the saved window can drop older events without shifting these ids).
  let current: number | undefined
  const make = (event: Omit<AgentActivityEvent, 'id' | 'needsApproval'> & { needsApproval?: boolean }): AgentActivityEvent => ({ id: current !== undefined ? 'e' + current : 'a' + n++, needsApproval: false, ...event })
  let delegate: AgentActivityEvent | undefined
  let lastAt = time(activity.startedAt)
  const skillEvents: AgentActivityEvent[] = []
  for (const raw of activity.events) {
    const at = time(raw.time)
    const detail = raw.detail || ''
    current = raw.seq
    const previousAt = lastAt; lastAt = at
    if (raw.type === 'task.started') {
      // A selected skill is running until the task ends; its outcome follows the task's.
      if (raw.skill) { skillEvents.push(make({ kind: 'skill', skill: raw.skill, title: raw.skill, summary: '', status: 'running', startedAt: at })); events.push(skillEvents.at(-1)!) }
    } else if (raw.type === 'reasoning.text') {
      // The model's own thinking before a step (timed from the previous event), or a union advisor's note (first line: the advisor).
      if (raw.tool === 'najd-union') { const [first, ...rest] = detail.split('\n'); events.push(make({ kind: 'advice', tool: raw.tool, model: first, title: 'advice', summary: rest.join('\n').trim(), status: 'succeeded', startedAt: at, endedAt: at, durationMs: 0 })) }
      else events.push(make({ kind: 'thinking', tool: raw.tool, title: 'thinking', summary: detail, status: 'succeeded', startedAt: Math.min(previousAt, at), endedAt: at, durationMs: Math.max(0, at - previousAt) }))
    } else if (raw.type === 'reasoning.summary') {
      events.push(make({ kind: 'reasoning', tool: raw.tool, title: 'reasoning', summary: detail, status: 'succeeded', startedAt: at, endedAt: at, durationMs: 0 }))
    } else if (raw.type === 'tool.started') {
      const nested = detail.startsWith('↳')
      const text = nested ? detail.replace(/^↳\s*/, '') : detail
      const event = make({ kind: activityKind(raw.tool, text), tool: raw.tool, title: raw.tool || 'tool', summary: text, status: 'running', startedAt: at, parentId: nested ? delegate?.id : undefined })
      if (!nested) { if (raw.tool === 'najd-delegate') delegate = event; events.push(event) }
      else if (delegate) (delegate.children ||= []).push(event)
      else events.push(event)
      open.push(event)
      counts.tools++
    } else if (raw.type === 'tool.completed' || raw.type === 'tool.failed') {
      const nested = detail.startsWith('↳')
      const text = nested ? detail.replace(/^↳\s*/, '') : detail
      let index = -1
      for (let i = open.length - 1; i >= 0; i--) if (open[i].tool === raw.tool) { index = i; break }
      const event = index >= 0 ? open.splice(index, 1)[0] : undefined
      if (!event) {
        // The start was cut from the saved window: the finished step still counts.
        counts.tools++
        const orphan = classify(raw.type, text)
        if (orphan.countsAsError) counts.errors++
        events.push(make({ kind: activityKind(raw.tool, text), tool: raw.tool, title: raw.tool || 'tool', summary: text, orphan: true, status: orphan.status, startedAt: at, endedAt: at, durationMs: 0,
          ...(orphan.exitCode !== undefined ? { exitCode: orphan.exitCode } : {}), ...(orphan.error ? { error: orphan.error } : {}) })); continue
      }
      event.endedAt = at; event.durationMs = Math.max(0, at - event.startedAt)
      const outcome = classify(raw.type, text)
      event.status = outcome.status
      if (outcome.exitCode !== undefined) event.exitCode = outcome.exitCode
      if (outcome.error) event.error = outcome.error
      if (outcome.countsAsError) counts.errors++
      else if (outcome.status === 'succeeded' && text && !event.summary) event.summary = text
      if (event.tool === 'najd-delegate' ) delegate = undefined
    } else if (raw.type === 'approval.requested') {
      counts.approvals++
      events.push(make({ kind: 'approval', tool: raw.tool, title: raw.tool || 'approval', summary: detail, status: 'awaiting-approval', startedAt: at, needsApproval: true }))
    } else if (raw.type === 'approval.resolved') {
      const pending = [...events].reverse().find(event => event.kind === 'approval' && event.status === 'awaiting-approval')
      const denied = raw.decision === 'DENY'
      if (pending) { pending.status = denied ? 'cancelled' : 'succeeded'; pending.endedAt = at; pending.durationMs = at - pending.startedAt; pending.summary = pending.summary || detail; pending.error = denied ? 'denied' : undefined }
      else events.push(make({ kind: 'approval', tool: raw.tool, title: raw.tool || 'approval', summary: detail, status: denied ? 'cancelled' : 'succeeded', startedAt: at, endedAt: at, durationMs: 0, needsApproval: true, error: denied ? 'denied' : undefined }))
    } else if (raw.type === 'task.unknown_effect') {
      // Not a failure: the action may have happened. It is shown as a warning and never counted as an error.
      // An approval still pending when the task ends was never answered.
      for (const event of events) if (event.kind === 'approval' && event.status === 'awaiting-approval') { event.status = 'cancelled'; event.endedAt = at; event.durationMs = at - event.startedAt }
      events.push(make({ kind: 'warning', title: 'task.unknown_effect', summary: detail, status: 'unconfirmed', startedAt: at, endedAt: at, durationMs: 0 }))
    } else if (raw.type === 'task.failed') {
      counts.errors++
      events.push(make({ kind: 'error', title: raw.type, summary: detail, status: 'failed', startedAt: at, endedAt: at, durationMs: 0, error: detail || raw.type }))
    } else if (raw.type === 'task.cancelled') {
      // An approval still pending when the task is cancelled was never answered.
      for (const event of events) if (event.kind === 'approval' && event.status === 'awaiting-approval') { event.status = 'cancelled'; event.endedAt = at; event.durationMs = at - event.startedAt }
      events.push(make({ kind: 'wait', title: raw.type, summary: detail, status: 'cancelled', startedAt: at, endedAt: at, durationMs: 0 }))
    } else if (raw.type === 'task.completed') {
      events.push(make({ kind: 'success', title: raw.type, summary: detail, status: 'succeeded', startedAt: at, endedAt: at, durationMs: 0 }))
    }
  }
  // The skill's outcome is the task's: cancelled, failed (failed or unconfirmed) or succeeded.
  const outcome: ActivityStatus = activity.events.some(raw => raw.type === 'task.cancelled') ? 'cancelled' : activity.events.some(raw => raw.type === 'task.unknown_effect') ? 'unconfirmed' : activity.events.some(raw => raw.type === 'task.failed') ? 'failed' : 'succeeded'
  if (finished !== undefined) for (const event of skillEvents) { event.status = outcome; event.endedAt = finished; event.durationMs = Math.max(0, finished - event.startedAt) }
  // Work still marked running when the task ended did not finish (cancelled or interrupted).
  if (finished !== undefined) for (const event of open) { event.status = 'cancelled'; event.endedAt = finished; event.durationMs = Math.max(0, finished - event.startedAt) }
  else for (const event of open) event.durationMs = Math.max(0, now - event.startedAt)
  const flat = events.flatMap(event => [event, ...(event.children || [])])
  // Tools count attempts; everything else counts only finished effects (a failed or cut-off step is not a fact).
  for (const event of flat) {
    if (event.parentId) continue
    const done = event.status === 'succeeded' && !event.orphan
    // A command counts only if it was dispatched: not declined (cancelled) or still waiting, and not a process listing or output read.
    if (event.kind === 'command' || event.kind === 'git' || event.kind === 'python') { if (event.tool && COMMAND_TOOLS.has(event.tool) && ['succeeded', 'failed', 'unconfirmed'].includes(event.status)) counts.commands++ }
    else if (event.kind === 'file-read') { if (done && event.tool && FILE_CONTENT_TOOLS.has(event.tool)) counts.filesRead++ }
    else if (event.kind === 'file-write') { if (done) counts.filesChanged++ }
    else if (event.kind === 'search') { if (done) counts.searches++ }
    else if (event.kind === 'web' || event.kind === 'browser') { if (done && pageTarget(event)) counts.pages++ }
    else if (event.kind === 'mcp') { if (done) counts.mcp++ }
    else if (event.kind === 'skill') { if (done) counts.skills++ }
  }
  // Consecutive similar, finished operations collapse into one expandable group.
  const rows: ActivityRow[] = []
  for (const event of events) {
    const last = rows.at(-1)
    const groupable = GROUPABLE.has(event.kind) && event.status === 'succeeded' && !event.children?.length
    if (groupable && last?.type === 'group' && last.group.kind === event.kind) {
      last.group.items.push(event); last.group.durationMs = (last.group.durationMs || 0) + (event.durationMs || 0); continue
    }
    if (groupable && last?.type === 'event' && last.event.kind === event.kind && last.event.status === 'succeeded' && !last.event.children?.length) {
      rows[rows.length - 1] = { type: 'group', group: { id: 'g' + last.event.id, kind: event.kind, items: [last.event, event], status: 'succeeded',
        startedAt: last.event.startedAt, durationMs: (last.event.durationMs || 0) + (event.durationMs || 0) } }
      continue
    }
    rows.push({ type: 'event', event })
  }
  const last = events.filter(event => !NOTE_KINDS.has(event.kind)).at(-1)
  return { rows, events, counts, running: finished === undefined, waiting: finished === undefined && last?.status === 'awaiting-approval',
    failed: events.some(event => event.kind === 'error'), unknownEffect: events.some(event => event.title === 'task.unknown_effect' || event.status === 'unconfirmed') }
}

export function formatDuration(ms: number, language: 'ar' | 'en'): string {
  const total = Math.max(0, Math.round(ms / 1000))
  const minutes = Math.floor(total / 60), seconds = total % 60
  if (language === 'ar') return minutes ? `${minutes} دقيقة${seconds ? ` و${seconds} ثانية` : ''}` : `${seconds} ثانية`
  return minutes ? `${minutes} min${seconds ? ` ${seconds} s` : ''}` : `${seconds} s`
}
export function formatShort(ms: number): string {
  if (ms < 1000) return ms + ' ms'
  const seconds = ms / 1000
  return seconds < 60 ? (Math.round(seconds * 10) / 10) + ' s' : `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`
}

const plural = (n: number, ar: [string, string, string], en: [string, string]) => ({ ar: n === 1 ? ar[0] : n === 2 ? ar[1] : `${n} ${ar[2]}`, en: `${n} ${n === 1 ? en[0] : en[1]}` })
// "4 tools · 2 commands · 3 files read" from the real counts; zero entries are omitted.
export function summarize(counts: ActivityCounts, language: 'ar' | 'en'): string {
  const parts: string[] = []
  const add = (n: number, ar: [string, string, string], en: [string, string]) => { if (n > 0) parts.push(plural(n, ar, en)[language]) }
  add(counts.tools, ['استُخدمت أداة', 'استُخدمت أداتان', 'أدوات'], ['tool used', 'tools used'])
  add(counts.commands, ['تنفيذ أمر', 'تنفيذ أمرين', 'أوامر'], ['command run', 'commands run'])
  add(counts.filesRead, ['قراءة ملف', 'قراءة ملفين', 'ملفات مقروءة'], ['file read', 'files read'])
  add(counts.filesChanged, ['تعديل ملف', 'تعديل ملفين', 'ملفات معدّلة'], ['file changed', 'files changed'])
  add(counts.searches, ['بحث واحد', 'بحثان', 'عمليات بحث'], ['search', 'searches'])
  add(counts.pages, ['صفحة ويب', 'صفحتا ويب', 'صفحات ويب'], ['web page', 'web pages'])
  add(counts.mcp, ['استدعاء MCP', 'استدعاءا MCP', 'استدعاءات MCP'], ['MCP call', 'MCP calls'])
  return parts.join(' · ')
}
export function groupTitle(kind: ActivityKind, n: number, language: 'ar' | 'en'): string {
  const ar: Partial<Record<ActivityKind, string>> = { 'file-read': `قراءة ${n} ملفات`, search: `${n} عمليات بحث`, web: `قراءة ${n} صفحات`, browser: `${n} خطوات تصفح` }
  const en: Partial<Record<ActivityKind, string>> = { 'file-read': `Read ${n} files`, search: `${n} searches`, web: `Read ${n} pages`, browser: `${n} browser steps` }
  return (language === 'ar' ? ar : en)[kind] || `${n}`
}

export type StageState = 'done' | 'active' | 'pending' | 'waiting' | 'paused' | 'unconfirmed' | 'failed'
export interface ProgressStage { id: 'understand' | 'plan' | 'work' | 'approval' | 'answer'; state: StageState; done?: number; total?: number; failed?: number }
// Stages come only from recorded events. There is no percentage: NAJD cannot know how many steps a task will need.
export function deriveProgress(view: ActivityView, activity: NajdTaskActivity | undefined): ProgressStage[] {
  if (!activity) return []
  const ended = !!activity.finishedAt
  const tools = view.events.filter(event => event.tool && !NOTE_KINDS.has(event.kind) && event.kind !== 'approval')
  const doneTools = tools.filter(event => event.status === 'succeeded').length
  const failed = view.failed
  const unconfirmed = view.unknownEffect
  const cancelled = view.events.some(event => event.kind === 'wait' && event.status === 'cancelled')
  const stages: ProgressStage[] = [{ id: 'understand', state: 'done' }]
  // Only recorded events create stages: no plan event, no Plan stage (older records have none).
  if (view.events.some(event => event.kind === 'reasoning')) stages.push({ id: 'plan', state: 'done' })
  if (tools.length || !ended) stages.push({ id: 'work', total: tools.length, done: doneTools, failed: tools.filter(event => event.status === 'failed').length,
    state: view.waiting ? 'paused' : tools.some(event => event.status === 'running') ? 'active' : ended ? (unconfirmed ? 'unconfirmed' : failed || cancelled ? 'failed' : 'done') : tools.length ? 'active' : 'pending' })
  if (view.counts.approvals > 0) stages.push({ id: 'approval', state: view.waiting ? 'waiting' : view.events.some(event => event.kind === 'approval' && event.status === 'cancelled') ? 'failed' : 'done', total: view.counts.approvals,
    done: view.events.filter(event => event.kind === 'approval' && event.status === 'succeeded').length })
  // A live task always has a current step: when nothing is waiting or running, the first pending stage is the one in progress.
  if (!ended) { const next = stages.find(stage => stage.state === 'pending'); if (!stages.some(stage => stage.state === 'active' || stage.state === 'waiting') && next) next.state = 'active' }
  stages.push({ id: 'answer', state: ended ? (unconfirmed ? 'unconfirmed' : failed || cancelled ? 'failed' : 'done') : 'pending' })
  return stages
}

export interface UsedContext { filesRead: string[]; filesChanged: string[]; pages: string[]; skills: string[]; tools: string[] }
// What the task actually touched, taken from event summaries (targets are already short and redacted).
export function deriveContext(view: ActivityView): UsedContext {
  const out: UsedContext = { filesRead: [], filesChanged: [], pages: [], skills: [], tools: [] }
  const push = (list: string[], value: string | undefined) => { const text = (value || '').trim(); if (text && !list.includes(text)) list.push(text) }
  for (const event of view.events.flatMap(item => [item, ...(item.children || [])])) {
    // Only finished, successful steps with a known target count as used; failed attempts and orphans stay out.
    const used = event.status === 'succeeded' && !event.orphan
    if (event.kind === 'file-read' && used && event.tool && FILE_CONTENT_TOOLS.has(event.tool)) push(out.filesRead, event.summary)
    else if (event.kind === 'file-write' && used) push(out.filesChanged, event.summary)
    else if ((event.kind === 'web' || event.kind === 'browser') && used) push(out.pages, pageTarget(event) || undefined)
    else if (event.kind === 'skill' && used) push(out.skills, event.skill || event.summary)
    if (event.tool && !NOTE_KINDS.has(event.kind) && event.kind !== 'approval') push(out.tools, event.tool)
  }
  return out
}

// The short form used in the activity header: "1s", "2m 23s" / "1 ث", "2 د 23 ث".
export function formatCompact(ms: number, language: 'ar' | 'en'): string {
  const total = Math.max(0, Math.round(ms / 1000))
  const minutes = Math.floor(total / 60), seconds = total % 60
  if (language === 'ar') return minutes ? `${minutes} د${seconds ? ` ${seconds} ث` : ''}` : `${seconds} ث`
  return minutes ? `${minutes}m${seconds ? ` ${seconds}s` : ''}` : `${seconds}s`
}
