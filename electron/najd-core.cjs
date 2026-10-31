const { randomUUID, createHash } = require('node:crypto')
const providerIds = require('./provider-catalog.json').map(p => p.id)
const { validReasoningPreference } = require('./reasoning-policy.cjs')
const { redactText, redactBlock } = require('./redact.cjs')
const { MAX_EVENTS, THINKING_CHARS } = require('./task-activity.cjs')
const { asksForChannelNotice } = require('./channel-notice.cjs')

function coreError(code) {
  return Object.assign(new Error(code), { code })
}

function validId(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 128
}

function validHistory(history, text) {
  return Array.isArray(history) && history.length > 0 && history.length <= 500 &&
    history.every(message => message && (message.role === 'user' || message.role === 'assistant') &&
      typeof message.text === 'string' && !!message.text.trim() &&
      message.text.length <= (message.role === 'user' ? 4000000 : 4000000)) &&
    history.at(-1).role === 'user' && history.at(-1).text.trim() === text &&
    history.reduce((size, message) => size + message.text.length, 0) <= 20000000
}

const modelErrors = new Set(['ATTACHMENT_READ_FAILED', 'TOOLS_NOT_SUPPORTED', 'CONTEXT_LIMIT', 'PROVIDER_BUSY', 'BUDGET_EXCEEDED', 'PROVIDER_POLICY_UNAVAILABLE', 'MODEL_NOT_CONFIGURED', 'OLLAMA_UNAVAILABLE', 'MODEL_NOT_FOUND', 'PROVIDER_TIMEOUT', 'INVALID_MODEL_OUTPUT', 'AUTH_REQUIRED', 'CREDENTIAL_UNAVAILABLE', 'PROVIDER_REJECTED', 'PROVIDER_RATE_LIMIT', 'PLAN_NOT_ENABLED', 'AUTH_INVALID_RESPONSE', 'CANCELLED', 'UNSUPPORTED_REASONING', 'CREDENTIAL_CHANGED'])

const toolErrors = new Set(['INVALID_INPUT', 'PERMISSION_DENIED', 'NO_ROOTS', 'PATH_NOT_ALLOWED', 'SENSITIVE_FILE', 'NOT_A_FILE', 'READ_FAILED', 'FILE_TOO_LARGE', 'BINARY_FILE', 'WINDOWS_NODE_NOT_INSTALLED', 'WINDOWS_NODE_FAILED', 'WINDOWS_DEMO_FAILED'])
const engineErrors = new Set(['NOT_INSTALLED', 'INCOMPATIBLE_RUNTIME', 'INVALID_PROTOCOL', 'RUNTIME_TIMEOUT', 'RUNTIME_FAILED', 'RUNTIME_STOP_FAILED', 'INVALID_INPUT'])
const journalErrors = new Set(['JOURNAL_CORRUPT', 'JOURNAL_LIMIT', 'ACTION_REPLAY_BLOCKED'])
const hash = value => createHash('sha256').update(value).digest('hex')

const readCommand = /^\/(read|اقرأ)(?:\s+(.*))?$/s
const appsCommand = /^\/(apps|تطبيقات)(?:\s+(.*))?$/s
const windowsCommand = /^\/(windows|ويندوز)(?:\s+(.*))?$/s
const findCommand = /^\/(find|ابحث)(?:\s+(.*))?$/s
const modelReadCommand = /^\/(ask-read|اقرأ-بالنموذج)(?:\s+(.*))?$/s

function validReadPath(value) {
  return typeof value === 'string' && !!value.trim() && value.length <= 1024
}

// Tools that can change the world once dispatched; a run stopped while one is open may have changed it already.
const EFFECTFUL = new Set(['najd-files-write', 'najd-files-edit', 'najd-files-move', 'najd-files-delete', 'najd-terminal-run', 'najd-python-run', 'najd-process-start',
  'najd-process-stop', 'najd-desktop-open', 'najd-desktop-act', 'najd-mcp-call', 'najd-mcp-install', 'najd-extension-install', 'najd-image-generate', 'najd-video-generate', 'najd-video-transcribe', 'najd-video-cancel'])
const effectful = (tool, detail) => EFFECTFUL.has(tool) || tool === 'najd-browser' && /^(click|type|select|login)\b/.test(String(detail || '')) ||
  tool === 'najd-web-preview' && /^interact\b/.test(String(detail || '')) // clicks on a localhost server page

function createNajdCore({ model, tool, authorizeTool, journal, verifyTool, onReceipt, onChange } = {}) {
  const tasks = new Map()
  const intents = new Map()
  const approvals = new Map()
  const pending = new Set()
  // Runs and their journal/receipt writes are pending work that flush() and shutdown() drain (APR-017).
  // Work a conversation still has in flight, counted until it settles, even after its task already shows CANCELLED
  // or UNKNOWN_EFFECT (cleanup such as stopping or adopting a family can still be running) (M2-R15-002).
  const unsettled = new Map()
  function track(operation, conversationId = null) {
    pending.add(operation)
    if (conversationId) unsettled.set(conversationId, (unsettled.get(conversationId) || 0) + 1)
    const done = () => {
      pending.delete(operation)
      if (!conversationId) return
      const left = (unsettled.get(conversationId) || 1) - 1
      if (left > 0) unsettled.set(conversationId, left); else unsettled.delete(conversationId)
    }
    void operation.then(done, done)
    return operation
  }
  function unknown(task) { task.state = 'UNKNOWN_EFFECT'; task.errorCode = 'UNKNOWN_EFFECT'; emit(task, 'task.unknown_effect') }

  function emit(task, type, details = {}) {
    task.events.push({ sequence: task.events.length + 1, taskId: task.id, type, time: new Date().toISOString(),
      ...(type === 'task.started' && task.skillId ? {skill:task.skillId} : {}),
      ...((type.startsWith('tool.') || type.startsWith('approval.')) && task.proposedTool ? {tool:task.proposedTool} : {}),
      ...(type === 'tool.started' && ['chrome','edge','notepad','calc','mspaint'].includes(task.proposedInput?.appId) ? {target:task.proposedInput.appId} : {}), ...details })
    // Push notification (no payload beyond ids): the window fetches the snapshot once, instead of polling quickly.
    // A listener failure never affects the task.
    if (typeof onChange === 'function') { try { onChange({ taskId: task.id, conversationId: task.conversationId || null, sequence: task.events.length }) } catch {} }
  }

  // Run receipts are recorded once per task, whatever the outcome (AP-004); storage errors never fail the task.
  function keepReceipt(task, receipt) {
    if (task.receipt || !receipt || typeof receipt !== 'object') return
    task.receipt = { outcome: receipt.outcome, profile: receipt.profile, toolsets: receipt.toolsets, usage: receipt.usage, toolCalls: receipt.toolCalls, request: receipt.request }
    if (typeof onReceipt === 'function' && task.conversationId) {
      // Tracked like task work so flush()/shutdown() wait for it before the app quits (APR-007).
      const write = Promise.resolve().then(() => onReceipt({ runId: task.id, conversationId: task.conversationId, state: task.state, receipt: task.receipt,
        provider: task.provider, modelName: task.modelName || null, at: Date.now() }))
        .catch(error => { task.receiptError = error?.code || 'RECEIPT_WRITE_FAILED' })
      pending.add(write); void write.finally(() => pending.delete(write))
    }
  }

  function snapshot(task) {
    return {
      id: task.id, state: task.state, output: task.output, images: Array.isArray(task.images) ? [...task.images] : [],
      // What the caller should send as the next request: notes the agent never took, plus, when the task failed, the ones whose request the model never answered (C10-01, C11-02).
      // A task the owner stopped sends nothing on: Stop means stop (the notes stay in the conversation).
      unreadNotes: task.state === 'CANCELLED' ? [] : [...(task.state === 'FAILED' && Array.isArray(task.inFlightNotes) ? task.inFlightNotes : []), ...(Array.isArray(task.notes) ? task.notes : [])],
      outputTruncated: task.outputTruncated,
      reasoningEffort: task.reasoningEffort,
      errorCode: task.errorCode, approvalId: task.approvalId,
      proposedTool: task.proposedTool, proposedInput: task.proposedInput ? { ...task.proposedInput } : null,
      localOnlyOutput: !!task.requestedReadPath, viaAgent: !!task.viaAgent, channelNotice: !!task.channelNotice,
      conversationId: task.conversationId, receipt: task.receipt ? structuredClone(task.receipt) : null,
      lastSequence: task.events.length,
      activity: {version:1,startedAt:task.events[0].time,
        finishedAt:['COMPLETED','FAILED','CANCELLED','UNKNOWN_EFFECT'].includes(task.state) ? task.events.at(-1).time : null,
        events:task.events.slice(-MAX_EVENTS).map(({sequence,taskId,...event})=>({seq:sequence,...event}))}
    }
  }

  // A model-requested change pauses the running task until the user decides in chat.
  // The decision is delivered to the waiting agent loop, never replayed after restart.
  // Access modes (owner request 2026-10-19): 'approve' answers lower-risk actions itself, 'full' answers every action;
  // each automatic answer is recorded as an approval event. Fields the host marks sensitive (passwords, payment) are
  // still refused by the host, whatever the mode.
  const AUTO_SAFE = new Set(['najd-desktop-open', 'najd-desktop-read', 'najd-desktop-windows', 'najd-screen-capture', 'najd-browser', 'najd-files-write',
    'najd-files-edit', 'najd-image-generate', 'najd-video-generate', 'najd-video-transcribe'])
  // Installing an MCP server downloads and runs a program, so the user always decides it, in every mode.
  // A learned skill becomes lasting guidance, so the owner always sees it before it is saved (owner request 2026-10-25).
const ALWAYS_ASK = new Set(['najd-mcp-install', 'najd-browser-sensitive', 'najd-browser-login', 'najd-skill-save'])
  // Paid requests are approved one by one: "allow for this task" never covers them (C5-01).
  const PAID = new Set(['najd-image-generate', 'najd-video-generate', 'najd-video-transcribe'])
  function agentApproval(task, tool, input) {
    if (task.state !== 'RUNNING' || task.controller.signal.aborted) return Promise.reject(coreError('CANCELLED'))
    const allowedForTask = task.allowTask === true && !PAID.has(tool)
    if (!ALWAYS_ASK.has(tool) && (allowedForTask || task.accessMode === 'full' || (task.accessMode === 'approve' && AUTO_SAFE.has(tool)))) {
      task.viaAgent = true
      task.proposedTool = tool
      task.proposedInput = input
      // Saved with the reply, so only fields the activity record accepts (task-activity.cjs) are used.
      emit(task, 'approval.resolved', { decision: 'ALLOW_ONCE', detail: allowedForTask && task.accessMode !== 'full' ? 'Approved for the rest of this task' : task.accessMode === 'full' ? 'Approved automatically (full access)' : 'Approved automatically (approve for me)' })
      return Promise.resolve('ALLOW_ONCE')
    }
    return new Promise((resolve, reject) => {
      task.viaAgent = true
      task.proposedTool = tool
      task.proposedInput = input
      task.state = 'WAITING_APPROVAL'
      task.approvalId = randomUUID()
      approvals.set(task.approvalId, task.id)
      task.agentApproval = { resolve, reject }
      emit(task, 'approval.requested')
    })
  }

  function find(taskId) {
    if (!validId(taskId) || !tasks.has(taskId)) throw coreError('NOT_FOUND')
    return tasks.get(taskId)
  }

  function fail(task, code) {
    if (task.state === 'CANCELLED' || task.state === 'UNKNOWN_EFFECT') return
    // A tool reported an effect that may have happened: the task must not look like a clean failure (no safe retry).
    if (task.effectUnknown || task.openEffects > 0) { task.errorCode = 'UNKNOWN_EFFECT'; unknown(task); return }
    task.state = 'FAILED'
    task.errorCode = code
    emit(task, 'task.failed', typeof code === 'string' && /^[A-Z0-9_]{2,60}$/.test(code) ? { detail: code } : {})
  }

  async function propose(task, name, input) {
    task.proposedTool = name
    task.proposedInput = input
    if (journal && name === 'windows-demo') {
      task.action = await journal.prepare({ intentId: hash(task.intentId), operation: 'desktop.act', target: input.appId,
        changeHash: hash(JSON.stringify({ request: task.payloadHash, name, input })) })
      if (task.state === 'CANCELLED') { await journal.cancel(task.action.id); return }
      if (task.action.state === 'UNKNOWN_EFFECT') { unknown(task); return }
      if (task.action.state !== 'AWAITING_APPROVAL') throw coreError('ACTION_REPLAY_BLOCKED')
    }
    if (task.state === 'CANCELLED') return
    task.state = 'WAITING_APPROVAL'
    task.approvalId = randomUUID()
    approvals.set(task.approvalId, task.id)
    emit(task, 'approval.requested')
  }

  async function run(task) {
    if (task.state === 'CANCELLED') return
    task.state = 'RUNNING'
    try {
      const modelRead = task.text.match(modelReadCommand)
      if (modelRead) {
        const target = (modelRead[2] || '').trim()
        if (!validReadPath(target) || /[\x00-\x1f]/.test(target)) return fail(task, 'INVALID_INPUT')
        task.requestedReadPath = target
      }
      const finding = task.text.match(findCommand)
      if (finding) {
        const parts = (finding[2] || '').split('|').map(part => part.trim())
        if (parts.length !== 2 || !validReadPath(parts[0]) || !parts[1] || parts[1].length > 80 || /[\x00-\x1f]/.test(parts[1])) return fail(task, 'INVALID_INPUT')
        await propose(task, 'find-documents', { path: parts[0], query: parts[1] })
        return
      }
      const windows = task.text.match(windowsCommand)
      if (windows) {
        const appId = (windows[2] || '').trim().toLowerCase()
        if (!['chrome', 'edge'].includes(appId)) return fail(task, 'INVALID_INPUT')
        await propose(task, 'windows-demo', { appId, path: appId === 'chrome' ? 'Google Chrome' : 'Microsoft Edge' })
        return
      }
      const apps = task.text.match(appsCommand)
      if (apps) {
        if (apps[2]?.trim()) return fail(task, 'INVALID_INPUT')
        await propose(task, 'windows-apps', { path: 'Notepad, Calculator, Paint, Google Chrome, Microsoft Edge' })
        return
      }
      const command = task.text.match(readCommand)
      if (command) {
        const filePath = (command[2] || '').trim()
        if (!filePath) return fail(task, 'INVALID_INPUT')
        await propose(task, 'read-file', { path: filePath })
        return
      }
      if (typeof model !== 'function') return fail(task, 'MODEL_NOT_CONFIGURED')
      const result = await model({ text: task.text, provider: task.provider, modelName: task.modelName, history: task.history, signal: task.controller.signal, reasoningEffort: task.reasoningPreference,
        conversationId: task.conversationId, profile: task.profile, runId: task.id, browserContext: task.browserContext,
        assetIds: task.assetIds, requestApproval: (tool, input) => agentApproval(task, tool, input),
        // The agent takes the owner's added messages at its next step; once taken they are no longer unread.
        takeNotes: () => { if (!(task.state === 'RUNNING' || task.state === 'WAITING_APPROVAL') || !task.notes?.length) return []; const taken = task.notes.splice(0); (task.inFlightNotes ||= []).push(...taken); return taken },
        // The model answered the request that carried them: from then on they are acted on, never sent again (C11-02).
        notesAnswered: () => { task.inFlightNotes = [] },
        onToolEvent: (type, tool, detail) => {
          if (task.state !== 'RUNNING' || !['tool.started', 'tool.completed', 'tool.failed', 'reasoning.summary', 'reasoning.text'].includes(type) || !/^najd-[a-z-]{1,60}$/.test(tool)) return
          // The model's own thinking and the union advisors' notes keep their lines (redacted like every detail).
          if (type === 'reasoning.text') { const text = redactBlock(detail, THINKING_CHARS); if (text) emit(task, type, { tool, detail: text }); return }
          if (type === 'tool.failed' && typeof detail === 'string' && detail.startsWith('effect unknown')) task.effectUnknown = true
          // Dispatched effectful work still open (started, not yet settled) when the task is stopped means the effect is unknown.
          if (type === 'tool.started' && effectful(tool, detail)) task.openEffects = (task.openEffects || 0) + 1
          else if ((type === 'tool.completed' || type === 'tool.failed') && task.openEffects && !/^↳/.test(String(detail || ''))) task.openEffects--
          emit(task, type, { tool, ...(typeof detail === 'string' && detail.trim() ? { detail: redactText(detail, type === 'reasoning.summary' ? 240 : 160) } : {}) })
        },
        ...(task.requestedReadPath ? { readPath: task.requestedReadPath } : {}) })
      if (result?.receipt) keepReceipt(task, result.receipt)
      // A stop (clean or unknown-effect) is final: a late model reply never overwrites it.
      if (task.state === 'CANCELLED' || task.state === 'UNKNOWN_EFFECT') return
      if (task.requestedReadPath && (result?.kind !== 'tool' || result.name !== 'read-file' || result.input?.path !== task.requestedReadPath)) return fail(task, 'INVALID_MODEL_OUTPUT')
      if (result?.kind === 'message' && typeof result.text === 'string' && result.text.length <= 4000000) {
        task.output = result.text
        // The pictures this task saved itself (screenshots, generated images): the only ones a channel may send with the answer.
        task.images = Array.isArray(result.images) ? result.images.filter(id => typeof id === 'string' && /^[a-f0-9]{64}$/.test(id)).slice(0, 8) : []
        task.reasoningEffort = result.reasoningEffort && result.reasoningEffort !== 'auto' && validReasoningPreference(result.reasoningEffort) ? result.reasoningEffort : null
        // An effect that may have happened is never reported as a clean completion; the reply text is kept.
        if (task.effectUnknown) { unknown(task); return }
        task.state = 'COMPLETED'
        // Provider-reported usage for this request (all model calls, including delegated ones).
        const usage = result.usage
        emit(task, 'task.completed', usage && (usage.total > 0 || usage.modelCalls > 1) ? { detail: `${usage.modelCalls} model call${usage.modelCalls === 1 ? '' : 's'}` + (usage.total ? ` · ${usage.total} tokens` : '') } : {})
        return
      }
      if (result?.kind === 'tool' && result.name === 'safe-test' && result.input &&
          typeof result.input === 'object' && !Array.isArray(result.input)) {
        await propose(task, result.name, null)
        return
      }
      if (result?.kind === 'tool' && result.name === 'read-file') {
        if (!result.input || typeof result.input !== 'object' || !validReadPath(result.input.path)) return fail(task, 'INVALID_MODEL_OUTPUT')
        await propose(task, result.name, { path: result.input.path.trim() })
        return
      }
      fail(task, 'INVALID_MODEL_OUTPUT')
    } catch (error) {
      if (error?.receipt) keepReceipt(task, error.receipt)
      fail(task, modelErrors.has(error?.code) || engineErrors.has(error?.code) || journalErrors.has(error?.code) ? error.code : 'PROVIDER_ERROR')
    }
  }

  function startTask({ text, intentId, provider = 'ollama', modelName, history, reasoningEffort = 'auto', assetIds = [], conversationId = null, profile = null, accessMode = 'ask', browserContext = null } = {}, {skillId} = {}) {
    if (!['ask', 'approve', 'full'].includes(accessMode)) throw coreError('INVALID_INPUT')
    // Page details from the browser extension: bounded data that travels beside the owner's question, never inside it.
    if (browserContext !== null && !(browserContext && typeof browserContext === 'object' && !Array.isArray(browserContext) && Object.keys(browserContext).every(key => ['title', 'url', 'selection'].includes(key)) &&
      typeof browserContext.title === 'string' && browserContext.title.length <= 200 && typeof browserContext.url === 'string' && browserContext.url.length <= 500 && typeof browserContext.selection === 'string' && browserContext.selection.length <= 2000)) throw coreError('INVALID_INPUT')
    if (conversationId !== null && (typeof conversationId !== 'string' || !/^[A-Za-z0-9-]{1,80}$/.test(conversationId))) throw coreError('INVALID_INPUT')
    if (profile !== null && (typeof profile !== 'string' || !/^[a-z]{2,20}$/.test(profile))) throw coreError('INVALID_INPUT')
    if (!Array.isArray(assetIds) || assetIds.length > 20 || !assetIds.every(id => typeof id === 'string' && /^[a-f0-9]{64}$/.test(id))) throw coreError('INVALID_INPUT')
    if (assetIds.length && (typeof text !== 'string' || text.trim().startsWith('/'))) throw coreError('INVALID_INPUT')
    if (skillId !== undefined && (typeof skillId !== 'string' || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(skillId))) throw coreError('INVALID_INPUT')
    if (typeof text !== 'string' || !text.trim() || text.length > 4000000 || !validId(intentId)) throw coreError('INVALID_INPUT')
    const normalized = text.trim()
    const transcript = history === undefined ? [{ role: 'user', text: normalized }] : history
    if (!validHistory(transcript, normalized) || !providerIds.includes(provider) || !validReasoningPreference(reasoningEffort) ||
        (modelName !== undefined && (typeof modelName !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/.test(modelName)))) {
      throw coreError('INVALID_INPUT')
    }
    const payload = JSON.stringify({ text: normalized, provider, modelName: modelName || null, history: transcript, reasoningEffort, skillId, assetIds, conversationId, profile, accessMode, browserContext })
    const existing = intents.get(intentId)
    if (existing) {
      if (existing.payload !== payload) throw coreError('CONFLICT')
      return snapshot(find(existing.taskId))
    }
    const task = {
      id: randomUUID(), text: normalized, intentId, payloadHash: hash(payload), state: 'QUEUED', output: null,
      outputTruncated: false,
      errorCode: null, approvalId: null, proposedTool: null, proposedInput: null,
      provider, modelName, skillId, assetIds: [...assetIds], history: transcript.map(({ role, text }) => ({ role, text })),
      reasoningPreference: reasoningEffort, reasoningEffort: null, conversationId, profile, accessMode, browserContext, receipt: null,
      controller: new AbortController(), events: [], toolStarted: false, channelNotice: asksForChannelNotice(normalized)
    }
    tasks.set(task.id, task)
    intents.set(intentId, { payload, taskId: task.id })
    emit(task, 'task.started')
    // Counted for its conversation from now on, before the run itself starts (M2-R15-002).
    let begin
    const started = new Promise(resolve => { begin = resolve })
    track(started.then(() => run(task)), task.conversationId)
    queueMicrotask(begin)
    return snapshot(task)
  }

  // ALLOW_TASK (owner request 2026-10-24): allow this step and the rest of this task's steps, for this task only; what always asks
  // (installs, sensitive browser steps) and paid requests still ask, and the host still refuses sensitive fields. Agent steps only.
  function respondApproval(approvalId, decision) {
    if (!validId(approvalId) || !['ALLOW_ONCE', 'ALLOW_TASK', 'DENY'].includes(decision)) throw coreError('INVALID_INPUT')
    const taskId = approvals.get(approvalId)
    if (!taskId) throw coreError('CONFLICT')
    const pending = tasks.get(taskId)
    if (decision === 'ALLOW_TASK' && !pending?.agentApproval) throw coreError('INVALID_INPUT')
    approvals.delete(approvalId)
    const task = find(taskId)
    if (task.state !== 'WAITING_APPROVAL') throw coreError('CONFLICT')
    task.approvalId = null
    emit(task, 'approval.resolved', decision === 'ALLOW_TASK' ? { decision: 'ALLOW_ONCE', detail: 'Approved for the rest of this task' } : {decision})
    if (task.agentApproval) {
      const waiting = task.agentApproval
      task.agentApproval = null
      task.state = 'RUNNING'
      if (decision === 'ALLOW_TASK') task.allowTask = true
      waiting.resolve(decision === 'ALLOW_TASK' ? 'ALLOW_ONCE' : decision)
      return snapshot(task)
    }
    if (decision === 'DENY') {
      if (task.action) {
        task.state = 'RUNNING'
        track(journal.decide(task.action.id, task.action.nonce, decision).then(() => fail(task, 'PERMISSION_DENIED'))
          .catch(() => fail(task, 'JOURNAL_CORRUPT')))
        return snapshot(task)
      }
      fail(task, 'PERMISSION_DENIED')
      return snapshot(task)
    }
    if (typeof tool !== 'function') {
      fail(task, 'TOOL_NOT_CONFIGURED')
      return snapshot(task)
    }
    task.state = 'RUNNING'
    const operation = Promise.resolve().then(async () => {
      if (task.action) await journal.decide(task.action.id, task.action.nonce, decision)
      if (task.controller.signal.aborted) { if (task.action) await journal.cancel(task.action.id); return }
      if (authorizeTool) await authorizeTool(task.id)
      if (task.controller.signal.aborted) { if (task.action) await journal.cancel(task.action.id); return }
      if (task.action) {
        await journal.claim(task.action.id)
        task.actionClaimed = true
        if (task.controller.signal.aborted) { await journal.abandon(task.action.id); return }
      }
      task.toolStarted = true
      emit(task, 'tool.started')
      return tool({ name: task.proposedTool, input: { ...task.proposedInput }, signal: task.controller.signal })
    })
      .then(async result => {
        if (task.state === 'UNKNOWN_EFFECT' || task.state === 'CANCELLED') return
        if (task.action) {
          const verified = typeof verifyTool === 'function' && await verifyTool({ name: task.proposedTool, input: { ...task.proposedInput }, output: result }) === true
          if (task.state === 'UNKNOWN_EFFECT' || task.state === 'CANCELLED') return
          await journal.finish(task.action.id, verified)
          if (!verified) { unknown(task); return }
        }
        task.output = typeof result === 'string' ? result.slice(0, 20000) : ''
        task.outputTruncated = typeof result === 'string' && result.length > 20000
        task.state = 'COMPLETED'
        emit(task, 'tool.completed')
        emit(task, 'task.completed')
      })
      .catch(async error => {
        if (task.action && !['CANCELLED', 'UNKNOWN_EFFECT'].includes(task.state)) {
          try {
            if (!task.actionClaimed) await journal.cancel(task.action.id)
            else if (!task.toolStarted || error?.effectStarted === false) await journal.abandon(task.action.id)
            else await journal.finish(task.action.id, error?.effectResolved === true ? 'failed' : false)
          } catch { if (task.toolStarted) { unknown(task); return }; fail(task, 'JOURNAL_CORRUPT'); return }
        }
        if (['CANCELLED', 'UNKNOWN_EFFECT'].includes(task.state)) return
        if (task.proposedTool === 'windows-demo') {
          if (typeof error?.output === 'string' && error.output.length <= 2000) task.output = error.output
          if (error?.effectStarted !== false && error?.effectResolved !== true) {
            task.state = 'UNKNOWN_EFFECT'; task.errorCode = 'UNKNOWN_EFFECT'; emit(task, 'task.unknown_effect'); return
          }
        }
        fail(task, toolErrors.has(error?.code) || journalErrors.has(error?.code) ? error.code : 'TOOL_ERROR')
      })
    track(operation, task.conversationId)
    return snapshot(task)
  }

  function cancelTask(taskId) {
    const task = find(taskId)
    if (['COMPLETED', 'FAILED', 'CANCELLED', 'UNKNOWN_EFFECT'].includes(task.state)) return snapshot(task)
    const awaiting = task.state === 'WAITING_APPROVAL'
    if (task.approvalId) approvals.delete(task.approvalId)
    task.approvalId = null
    if (task.agentApproval) { const waiting = task.agentApproval; task.agentApproval = null; waiting.reject(coreError('CANCELLED')) }
    task.controller.abort()
    task.state = (task.toolStarted && !['read-file', 'find-documents', 'windows-apps'].includes(task.proposedTool)) || task.effectUnknown || (!awaiting && task.openEffects > 0) ? 'UNKNOWN_EFFECT' : 'CANCELLED'
    if (task.action && (task.toolStarted || awaiting)) track(journal.cancel(task.action.id).catch(() => {}))
    task.errorCode = task.state
    emit(task, task.state === 'UNKNOWN_EFFECT' ? 'task.unknown_effect' : 'task.cancelled')
    return snapshot(task)
  }

  function getTask(taskId) { return snapshot(find(taskId)) }

  // Messages the owner adds while a task works (owner request 2026-10-24: "like interrupting Claude"): kept in order and handed to the
  // agent at its next step as part of the same request. What the task never read (it ended first, or it was not an agent run) is
  // reported as unreadNotes so the caller can start a new request with it; nothing is lost.
  const MAX_NOTES = 20, MAX_NOTE_CHARS = 8000
  function addNote(taskId, text) {
    const task = find(taskId)
    if (typeof text !== 'string' || !text.trim() || text.length > MAX_NOTE_CHARS) throw coreError('INVALID_INPUT')
    if (['COMPLETED', 'FAILED', 'CANCELLED', 'UNKNOWN_EFFECT'].includes(task.state)) throw coreError('CONFLICT')
    task.notes = task.notes || []
    // Counted over the whole task, not only the ones still waiting (C10-03).
    if ((task.noteCount || 0) >= MAX_NOTES) throw coreError('LIMIT_REACHED')
    task.noteCount = (task.noteCount || 0) + 1
    task.notes.push(text.trim())
    if (asksForChannelNotice(text)) task.channelNotice = true
    return snapshot(task)
  }

  function peekApproval(approvalId) {
    if (!validId(approvalId)) return null
    const taskId = approvals.get(approvalId)
    if (!taskId) return null
    const task = tasks.get(taskId)
    if (!task || task.state !== 'WAITING_APPROVAL') return null
    return { taskId, proposedTool: task.proposedTool, proposedInput: task.proposedInput ? { ...task.proposedInput } : null }
  }

  function getEvents(taskId, afterSequence = 0) {
    if (!Number.isInteger(afterSequence) || afterSequence < 0) throw coreError('INVALID_INPUT')
    return find(taskId).events.filter(event => event.sequence > afterSequence).map(event => ({ ...event }))
  }

  const hasActiveTasks = () => pending.size > 0 || [...tasks.values()].some(task => !['COMPLETED', 'FAILED', 'CANCELLED', 'UNKNOWN_EFFECT'].includes(task.state))
  // A conversation still has a task that is not finished (M2-R14-001).
  const hasActiveTaskFor = conversationId => unsettled.has(conversationId) ||
    [...tasks.values()].some(task => task.conversationId === conversationId && !['COMPLETED', 'FAILED', 'CANCELLED', 'UNKNOWN_EFFECT'].includes(task.state))
  // Drains until nothing is pending: a run finishing during shutdown can still queue its receipt (APR-017).
  async function flush() { while (pending.size) await Promise.allSettled([...pending]); await journal?.flush() }
  function shutdown() { for (const task of tasks.values()) cancelTask(task.id); return flush() }
  return { startTask, respondApproval, cancelTask, getTask, getEvents, peekApproval, hasActiveTasks, hasActiveTaskFor, flush, shutdown, addNote }
}

module.exports = { createNajdCore }
