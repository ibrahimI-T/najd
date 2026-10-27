const { app, BrowserWindow, ipcMain, shell, safeStorage, dialog, nativeImage, protocol, Tray, Menu, Notification } = require('electron')
const { replaceFile } = require('./atomic-file.cjs')
const { registerVideoScheme, createVideoFrames } = require('./video-frames.cjs')
registerVideoScheme(protocol)
// Installer-time component preparation runs without the normal app, profile lock or window.
if (process.argv.includes('--najd-prepare-runtime')) { require('./prepare-runtime.cjs').prepareRuntimeMain(); return }
// One authoritative writer for this profile's sessions, permissions and capability registry.
if (!app.requestSingleInstanceLock()) { app.exit(0); return }
app.on('second-instance', () => {
  const window = BrowserWindow.getAllWindows()[0]
  if (!window) return
  if (window.isMinimized()) window.restore()
  window.show(); window.focus()
})
const path = require('node:path')
const fs = require('node:fs/promises')
// Library files that open with their default program: documents, sheets, slides, PDF, pictures and plain text (never anything that runs;
// the macro-capable .doc/.xls/.ppt and .docm/.xlsm/.pptm are left out, C28-01).
const LIBRARY_OPENABLE = new Set(['.pdf', '.docx', '.xlsx', '.csv', '.pptx', '.txt', '.md', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'])
const { createNajdCore } = require('./najd-core.cjs')
const { createBackgroundMode } = require('./background-mode.cjs')
const { createChatLinkOpener, openWorkspaceFile } = require('./chat-links.cjs')
const { createWindowState } = require('./window-state.cjs')
const { createDiagnostics, createErrorLog } = require('./diagnostics.cjs')
const { createStartupGuard } = require('./startup-guard.cjs')
const { createQuitWatchdog } = require('./quit-watchdog.cjs')
const { createBrowserBridge } = require('./browser-bridge.cjs')
const { createSessionStore } = require('./session-store.cjs')
const { createMemoryStore, readMemoryBackup } = require('./memory-store.cjs')
const { createPersonalityStore, personalityPrompt } = require('./personality.cjs')
const { tierOf } = require('./context-tier.cjs')
const { selectProfile } = require('./agent-toolsets.cjs')
const { memoryView, toolsView, soulSections } = require('./graph-view.cjs')
const { createMemoryService } = require('./memory-service.cjs')
const { createContextUsageLog } = require('./context-usage-log.cjs')
const { createLearning } = require('./learning.cjs')
const { createUpdateService, fetchManifest, fetchLatestVersion } = require('./updates.cjs')
const updateConfig = require('./update-config.json')
const { createOllamaClient } = require('./ollama.cjs')
const { createCredentialStore } = require('./credential-store.cjs')
const { createActivityLog } = require('./activity-log.cjs')
const { createFileTool } = require('./file-tools.cjs')
const { createDocumentFinder } = require('./document-finder.cjs')
const { createLegalNotices } = require('./legal-notices.cjs')
const { createChatGPTStore } = require('./chatgpt-store.cjs')
const { createChatGPTAuth } = require('./chatgpt-auth.cjs')
const { createChatGPTInference } = require('./chatgpt-inference.cjs')
const { createProviderService } = require('./provider-service.cjs')
const { createOpenClawGateway } = require('./openclaw-gateway.cjs')
const { createWindowsNode } = require('./windows-node.cjs')
const { createHermesAdapter } = require('./hermes.cjs')
const { createEngineRouter } = require('./engine-router.cjs')
const { createCapabilityRegistry } = require('./capability-registry.cjs')
const { createMcpConnectors } = require('./mcp-connectors.cjs')
const { createMcpServers, resolveCommand } = require('./mcp-servers.cjs')
const { createBrowserTools } = require('./browser-tools.cjs')
const { createCredentialVault } = require('./credential-vault.cjs')
const { createWindowsCredentialStore } = require('./windows-credential-store.cjs')
const { skillMetadata } = require('./skill-discovery.cjs')
const { createAssetLibrary } = require('./asset-library.cjs')
const { createAgentCatalog } = require('./agent-catalog.cjs')
const { createAgentRuntime } = require('./agent-runtime.cjs')
const { createWorkspaceTools, classifyCommand } = require('./workspace-tools.cjs')
const { createToolbox } = require('./toolbox.cjs')
const { createConnectorPreference } = require('./connector-preference.cjs')
const { createOfficePack } = require('./office-pack.cjs')
const { createOfficeReview } = require('./office/office-review.cjs')
const { createExternalSkills } = require('./external-skills.cjs')
const { createPlugins } = require('./plugins.cjs')
const { createChannelGateway } = require('./channel-gateway.cjs')
const { createMediaGeneration } = require('./media-generation.cjs')
const { createRuntimeService } = require('./runtime-service.cjs')
const { createHermesTools } = require('./hermes-tools.cjs')
const runtimeConfig = require('./runtime-config.json')
// Everything NAJD runs ships inside the installer under resources/najd-runtime. An unpackaged
// checkout may test that layout explicitly with NAJD_DEV_BUNDLE.
const bundleCandidate = app.isPackaged ? path.join(process.resourcesPath, 'najd-runtime')
  : process.env.NAJD_DEV_BUNDLE && path.isAbsolute(process.env.NAJD_DEV_BUNDLE) ? process.env.NAJD_DEV_BUNDLE : null
const { createBundleRuntime } = require('./bundle-runtime.cjs')
// The installer ships compact archives; they are unpacked once per component version into
// LocalAppData (outside roaming profile data) and reused across updates.
const bundleRuntime = bundleCandidate && require('node:fs').existsSync(path.join(bundleCandidate, 'bundle.json'))
  ? createBundleRuntime({ source: bundleCandidate, target: app.isPackaged ? path.join(require('./runtime-root.cjs').najdLocalRoot(), 'runtime')
    : path.join(app.getPath('userData'), 'najd-runtime') }) : null
const bundleDir = id => bundleRuntime.directory(id)
const { createActionJournal } = require('./action-journal.cjs')
const { createRunReceipts } = require('./run-receipts.cjs')
const { createUsage, addUsage, usageView } = require('./usage.cjs')
const agentProfiles = require('./agent-profiles.json')
const { createConversationOutputs } = require('./conversation-outputs.cjs')
const { createExecLogs } = require('./exec-logs.cjs')
const { createPythonTools } = require('./python-tools.cjs')
const { createProcessTools } = require('./process-tools.cjs')
const { createDesktopTools } = require('./desktop-tools.cjs')
const { createStartApps } = require('./start-apps.cjs')
const { createExtensions } = require('./extensions.cjs')
const { createKnowledgeBases } = require('./knowledge-bases.cjs')
const { ensureToolchain } = require('./toolchain.cjs')
const { createWebPreview } = require('./web-preview.cjs')
const { previewSessionFactory } = require('./web-preview-session.cjs')
let toolchainDirectory = null, setupToolchain = null
// NAJD's own Node, shared by MCP servers, extensions and the toolchain (I16-002): the bundled runtime, or in an
// unpackaged checkout the provisioned development Node.
function najdNode() {
  const packed = bundleRuntime && bundleDir('node') ? path.join(bundleDir('node'), 'najd-gateway.exe') : null
  if (packed && require('node:fs').existsSync(packed)) return packed
  const dev = path.join(__dirname, '..', '.runtimes', 'node-v24.21.0-win-x64', 'node.exe')
  return !app.isPackaged && require('node:fs').existsSync(dev) ? dev : null
}
const { createProcessLifecycle } = require('./process-lifecycle.cjs')
const { fitAgentHistory } = require('./agent-context.cjs')
const { createInstructionSkills } = require('./instruction-skills.cjs')
const upstreamSkillBundle = require('./upstream-skills.json')
// NAJD's own instruction guides (electron/najd-skills/*.md, M3-9), checked by digest like the bundled upstream skills.
const najdSkillRows = require('node:fs').readdirSync(path.join(__dirname, 'najd-skills')).filter(name => name.endsWith('.md')).map(name => {
  const body = require('node:fs').readFileSync(path.join(__dirname, 'najd-skills', name), 'utf8').replace(/\r\n/g, '\n')
  const field = key => (new RegExp('^' + key + ': (.+)$', 'm').exec(body) || [])[1] || ''
  return { id: field('name'), name: field('name'), description: field('description').slice(0, 400), source: 'najd', sourceRevision: null, relativePath: 'najd-skills/' + name,
    platforms: ['windows'], license: 'NAJD', author: 'NAJD', digest: require('node:crypto').createHash('sha256').update(body).digest('hex'), body }
})
const helpUrl = 'https://github.com/ibrahimI-T/najd#readme'
const ollama = createOllamaClient()
let credentials
let activityLog
let chatGPT
let providers
let gateway
let windowsNode
let capabilities
let mcpConnectors
let mcpServers
let knowledgeBases
let personality
let learning
let memoryService
let updates
let library
let agentRuntime
let runtimeService
let videoFrames
let hermesTools
let installingUpdate = false
const pendingIpc = new Set()
let gatewayHealthTimer
// Set after app ready; windows call it when they show, hide, minimize or restore.
let rescheduleGatewayHealth = () => {}
// Set once the agent runtime exists: stops background video reconciliation (awaited before quitting).
let stopBackgroundJobs = async () => {}
// Shown state per window, tracked from show/hide/restore events (see createWindow).
const windowShown = new WeakMap()
let quitting = false
const hermes = createHermesAdapter({ root: path.resolve(__dirname, '..'),
  stateRoot: path.join(app.getPath('userData'), 'najd-data/engines/hermes'), chat: chatWithPersonality,
  getCore: async () => (await runtimeService?.directories())?.['agent-core'] ||
    (!app.isPackaged && process.env.NAJD_DEV_AGENT_CORE && path.isAbsolute(process.env.NAJD_DEV_AGENT_CORE) ? process.env.NAJD_DEV_AGENT_CORE : null) })
// Replies from routes without tools are counted too (APR-024): one model call, with the provider's usage when it
// reported any and unknown (null, partial) otherwise. Tool support decides tool exposure, not accounting.
async function plainChat(request) {
  const receipt = (outcome, reported) => ({ outcome, profile: null, toolsets: [], toolCalls: 0, request: null,
    usage: usageView(addUsage(createUsage(), reported || null)) })
  try {
    const result = await providers.chat(request)
    return result && typeof result === 'object' ? { ...result, receipt: receipt('completed', result.usage) } : result
  } catch (error) {
    if (error && typeof error === 'object' && !error.receipt) error.receipt = receipt(error.code === 'CANCELLED' ? 'cancelled' : 'failed', null)
    throw error
  }
}
async function chatWithPersonality(request) {
  if (request.readPath !== undefined) return plainChat(request)
  await providers.ensureWindow(request.provider, request.modelName).catch(() => {}) // a local server's real window, before the tier is chosen
  const tier = tierOf(providers.inputBudget(request.provider, request.modelName), request.contextMode)
  // Which kind of work this is, so a balanced run sends only the craft lines of the default instructions that apply (selection is repeated by the runtime).
  const guessed = tier.balanced ? selectProfile({ text: request.text, pinned: request.profile, last: request.conversationId ? await runReceipts.lastProfile(request.conversationId).catch(() => null) : null }).profile : 'general'
  const style = personalityPrompt(await personality.get(), { lean: tier.lean, balanced: tier.balanced ? { profile: guessed, askingAbilities: /what can you|what do you|your abilities|capabilities|what tools|\u0645\u0627\u0630\u0627 \u062a\u0633\u062a\u0637\u064a\u0639|\u0648\u0634 \u062a\u0642\u062f\u0631|\u0627\u064a\u0634 \u062a\u0642\u062f\u0631|\u0642\u062f\u0631\u0627\u062a\u0643/i.test(String(request.text || '')) } : null })
  const memoryChars = tierOf(providers.inputBudget(request.provider, request.modelName), request.contextMode).memoryChars
  // Memory for this request: found in the graph (preferences, the owner's notes, earlier conversations) within a token budget; the previous engine
  // answers when the graph is switched off or unavailable.
  const recalled = await memoryService?.context({ query: request.text, conversationId: request.conversationId || null, budgetTokens: Math.max(200, Math.floor(memoryChars / 3.2)) }).catch(() => null)
  const preferences = recalled ? recalled.text : await learning.context(request.text, { chars: memoryChars })
  const systemPrompt = [request.systemPrompt, style, preferences].filter(Boolean).join('\n\n')
  // The agent tool loop runs for ChatGPT, OpenAI, Kimi, and local Ollama models that declare tool support.
  const supported = !request.systemPrompt && await providers.supportsTools(request.provider, request.modelName)
  if (request.assetIds?.length && !supported) throw mainError('TOOLS_NOT_SUPPORTED')
  const runKey = require('node:crypto').randomUUID()
  let stepped = false
  const routeToken = supported && request.provider !== 'ollama' ? await providers.captureRoute(request.provider, request.modelName) : undefined
  const inputBudget = supported ? providers.inputBudget(request.provider, request.modelName) : null
  const result = supported ? await agentRuntime.run({ signal: request.signal, assetIds: request.assetIds,
    request: { text: request.text, contextMode: request.contextMode || null, browserContext: request.browserContext || null, profile: request.profile || null, conversationId: request.conversationId || null, runId: request.runId || null, inputBudget,
      // Vision: ChatGPT and OpenAI models see images; a local Ollama model only when it declares vision.
      vision: await providers.visionCapable(request.provider, request.modelName) || request.provider === 'ollama' && (await ollama.capabilities(request.modelName).catch(() => [])).includes('vision'),
      lastProfile: request.conversationId ? await runReceipts.lastProfile(request.conversationId).catch(() => null) : null },
    onOutput: request.conversationId ? entry => conversationOutputs.addOutput({ ...entry, conversationId: request.conversationId, runId: request.runId || null }) : null,
    onEvent: request.onToolEvent, requestApproval: request.requestApproval, takeNotes: request.takeNotes, notesAnswered: request.notesAnswered, respond: ({ instructions, tools, input, signal, isolated, onAdvice }) => {
      const prompt = [systemPrompt, instructions].filter(Boolean).join('\n\n')
      // Each run has its own key; only its first step consults the union references, and a delegated sub-agent never does.
      const agentTurn = { tools, input, ...(isolated ? { noAdvice: true } : { runKey, continuation: stepped }) }
      if (!isolated) stepped = true
      // A delegated sub-agent sees only its task, never the user's conversation history.
      // A long conversation keeps its newest part word for word; the older part becomes the few earlier messages that bear on this request.
      const compacted = !isolated && recalled && request.contextMode !== 'full' && memoryService ? memoryService.compactHistory({ history: request.history, query: request.text, recentChars: Math.min(Math.floor(inputBudget * 0.35), 60000) }).history : request.history
      const history = isolated ? [{ role: 'user', text: 'Complete the delegated task provided in the input.' }] : fitAgentHistory(compacted, prompt, agentTurn, inputBudget, { note: tierOf(inputBudget, request.contextMode).lean })
      // Report the size of the fitted history so the run receipt shows what the request carried.
      const historyBytes = Buffer.byteLength(history.map(item => item.text || '').join('\n'))
      return providers.chat({ ...request, signal, routeToken, systemPrompt: prompt, agentTurn, history, onAdvice })
        .then(result => result && typeof result === 'object' ? { ...result, historyBytes, instructionsBytes: Buffer.byteLength(prompt) } : result)
    } })
    : await plainChat({ ...request, ...(systemPrompt ? { systemPrompt } : {}) })
  if (!request.systemPrompt && result.kind === 'message') void learning.review(request)
  return result
}
// Folders NAJD may read, kept across restarts (najd-data/file-access.json). With wholeComputer (the default since the
// owner's request of 2026-10-19) every fixed drive is readable without choosing folders; protected NAJD data and
// sensitive files stay refused by the tools themselves.
const fileRoots = new Set()
let wholeComputer = true
let drivesCache = { at: 0, roots: [] }
function driveRoots() {
  if (Date.now() - drivesCache.at < 30000) return drivesCache.roots
  const roots = []
  for (const letter of 'CDEFGHIJKLMNOPQRSTUVWXYZ') { try { if (require('node:fs').existsSync(letter + ':\\')) roots.push(letter + ':\\') } catch {} }
  drivesCache = { at: Date.now(), roots }
  return roots
}
// Until the saved choice is read, nothing is readable, whoever starts a task (window, Telegram, automation) (C61-01).
let fileAccessReady = false
const readableRoots = () => fileAccessReady ? [...new Set([...(wholeComputer ? driveRoots() : []), ...fileRoots])] : []
const fileAccessPath = () => path.join(app.getPath('userData'), 'najd-data', 'file-access.json')
async function loadFileAccess() {
  // Only a missing file (first run) takes the defaults. A file that cannot be read or parsed fails closed: whole-computer
  // access off and no folders until the owner chooses again (C62-01); the file itself is left as it is.
  try {
    let text
    try { text = await fs.readFile(fileAccessPath(), 'utf8') }
    catch (error) { if (error?.code === 'ENOENT') return; throw error }
    const stored = JSON.parse(text)
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) throw new Error('INVALID')
    // A file from before the whole-computer choice has no such field and keeps the default; any other value is invalid.
    if ('wholeComputer' in stored) { if (typeof stored.wholeComputer !== 'boolean') throw new Error('INVALID'); wholeComputer = stored.wholeComputer }
    for (const root of Array.isArray(stored.roots) ? stored.roots.slice(0, 50) : []) if (typeof root === 'string' && path.isAbsolute(root)) fileRoots.add(path.resolve(root))
  } catch { wholeComputer = false; fileRoots.clear() }
  finally { fileAccessReady = true }
}
async function saveFileAccess() {
  await fs.mkdir(path.dirname(fileAccessPath()), { recursive: true }).catch(() => {})
  const temporary = fileAccessPath() + '.' + process.pid + '.tmp'
  await fs.writeFile(temporary, JSON.stringify({ wholeComputer, roots: [...fileRoots] }))
  await replaceFile(temporary, fileAccessPath()).catch(async () => { await fs.rm(temporary, { force: true }).catch(() => {}) })
}
const fileTool = createFileTool({ getRoots: readableRoots,
  getProtectedRoots: () => [path.join(app.getPath('userData'), 'najd-data', 'engines')],
  audit: { record: entry => activityLog?.record(entry) } })
function mainError(code) { return Object.assign(new Error(code), { code }) }
const documentFinder = createDocumentFinder({ getRoots: readableRoots,
  getProtectedRoots: () => [path.join(app.getPath('userData'), 'najd-data', 'engines')],
  audit: { record: entry => activityLog?.record(entry) } })
const actionJournal = createActionJournal({ filePath: path.join(app.getPath('userData'), 'najd-data/actions.json') })
const contextLog = createContextUsageLog({ filePath: path.join(app.getPath('userData'), 'najd-data/context-usage.jsonl') })
const runReceipts = createRunReceipts({ filePath: path.join(app.getPath('userData'), 'najd-data/run-receipts.json') })
const conversationOutputs = createConversationOutputs({ filePath: path.join(app.getPath('userData'), 'najd-data/conversation-outputs.json') })
const workspaceTools = createWorkspaceTools({ getRoots: readableRoots, extraPath: () => toolchainDirectory,
  workspace: path.join(app.getPath('documents'), 'NAJD'), journal: actionJournal,
  getProtectedRoots: () => [app.getPath('userData'), path.join(app.getPath('home'), '.hermes'), path.join(app.getPath('home'), '.codex'),
    path.join(app.getPath('home'), '.ssh'), path.join(app.getPath('home'), 'AppData/Local/hermes')],
  trash: target => shell.trashItem(target),
  onArtifact: entry => library.addArtifact({ name: entry.name, text: entry.text, source: entry.path }),
  audit: { record: entry => activityLog?.record(entry) } })
// Task change notifications go to the window that owns the app (ids only, never content).
// The window that started (or first read) a task owns it; only that window is notified. A task nobody has touched yet
// (it starts running before the start call returns) is announced to no one: the owner fetches its snapshot first.
const taskOwners = new Map()
const claimTask = (event, taskId) => { const current = taskOwners.get(taskId); if (taskId && (!current || current.isDestroyed())) { taskOwners.set(taskId, event.sender); if (taskOwners.size > 500) taskOwners.delete(taskOwners.keys().next().value) } }
// Questions asked from the browser extension: the app (not the renderer) follows the task, so approvals, denials, completion and
// cancellation always reach the panel, whichever path ends the task.
const askOfTask = new Map() // task id -> ask id
const unsavedAsks = new Map() // task id -> ask id: completed, answer not yet saved by the renderer
const ASK_STATES = { QUEUED: 'running', RUNNING: 'running', WAITING_APPROVAL: 'waiting_approval', COMPLETED: 'done', UNKNOWN_EFFECT: 'failed', CANCELLED: 'cancelled', FAILED: 'failed' }
function syncAsk(taskId) {
  const askId = askOfTask.get(taskId)
  if (!askId || !browserBridge) return
  let task
  try { task = core.getTask(taskId) } catch { return }
  const state = ASK_STATES[task?.state]
  if (!state) return
  const finished = ['done', 'failed', 'cancelled'].includes(state)
  browserBridge.updateAsk(askId, { state, needsApproval: state === 'waiting_approval',
    ...((state === 'done' || task.state === 'UNKNOWN_EFFECT') && typeof task.output === 'string' ? { output: task.output } : {}),
    ...(state === 'failed' ? { progress: typeof task.errorCode === 'string' ? task.errorCode : task.state } : {}) })
  if (finished) {
    askOfTask.delete(taskId)
    // A completed answer stays recoverable until the renderer confirms it saved it to the conversation (a reload in between must not lose it).
    if ((state === 'done' || task.state === 'UNKNOWN_EFFECT') && typeof task.output === 'string' && task.output) unsavedAsks.set(taskId, askId)
  }
}
// Questions from the browser waiting for the app to confirm it has them (see onAsk).
const pendingAsks = new Map()
function dropPendingAsk(id) { const entry = pendingAsks.get(id); if (entry) { clearInterval(entry.timer); pendingAsks.delete(id) } }
// A picture given as bytes (pasted in the composer or sent to the Telegram bot) enters the library through the normal import checks.
async function importPictureBytes(name, bytes) {
  if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > 25 * 1024 * 1024 || typeof name !== 'string' || !/^[\w .()-]{1,80}\.(png|jpg|jpeg|webp|gif|bmp)$/i.test(name)) throw mainError('INVALID_INPUT')
  // Outside NAJD's protected profile folder so the normal import checks apply unchanged.
  const inbox = path.join(app.getPath('temp'), 'najd-inbox')
  await require('node:fs/promises').mkdir(inbox, { recursive: true })
  const temporary = path.join(inbox, require('node:crypto').randomUUID() + '-' + name)
  await require('node:fs/promises').writeFile(temporary, bytes, { flag: 'wx' })
  try { return await library.importFile(temporary) } finally { await require('node:fs/promises').rm(temporary, { force: true }) }
}
const notifyTaskChanged = ({ taskId, conversationId, sequence }) => {
  const owner = taskOwners.get(taskId)
  if (owner && !owner.isDestroyed()) owner.send('najd:task:changed', { taskId, sequence })
  try { syncAsk(taskId) } catch {}
  // A paired phone hears when work on the computer finishes or waits for permission (channel-gateway.cjs).
  try { channels?.taskChanged({ taskId, conversationId }) } catch {}
}
const core = createNajdCore({ journal: actionJournal, onChange: notifyTaskChanged, onReceipt: entry => runReceipts.record({ ...entry, contextWindow: providers?.contextWindow?.(entry.provider, entry.modelName) ?? null }), verifyTool: ({ name, input, output }) => {
  if (name !== 'windows-demo' || typeof output !== 'string') return false
  try {
    const proof = JSON.parse(output)
    return proof.app === input.appId && typeof proof.focused === 'boolean' && ['opened', 'owned', 'inputVerified', 'closed', 'cleaned', 'verified'].every(key => proof[key] === true)
  } catch { return false }
}, authorizeTool: taskId => {
  if (!capabilities) throw mainError('PERMISSION_DENIED')
  return capabilities.authorize(taskId)
}, tool: async request => {
  if (request.name === 'find-documents') return documentFinder(request)
  if (!['windows-apps', 'windows-demo'].includes(request.name)) return fileTool(request)
  if (request.signal.aborted || quitting) throw Object.assign(mainError('CANCELLED'), { effectStarted: false })
  if (request.name === 'windows-demo') {
    const proof = await windowsNode.runDemo(request.input.appId, request.signal)
    const output = JSON.stringify(proof)
    if (!proof.verified) throw Object.assign(mainError('WINDOWS_DEMO_FAILED'), {
      output, effectStarted: proof.stage !== 'discovery', effectResolved: proof.closed })
    return output
  }
  const apps = await windowsNode.discoverApps()
  if (request.signal.aborted) throw mainError('CANCELLED')
  return JSON.stringify({ apps })
}, model: createEngineRouter({ hermes, chat: chatWithPersonality }) })
// Created after app 'ready' (needs userData and safeStorage).
let browserBridge = null
let credentialVault = null

// A browser extension asks to connect: only the user can allow it, in a native dialog the browser and web pages cannot reach.
// The same six-digit code is shown in the extension; the user allows only when they match.
async function confirmBrowserPairing(request) {
  const window = BrowserWindow.getAllWindows().find(item => !item.isDestroyed()) || null
  if (window) { if (window.isMinimized()) window.restore(); window.show() }
  const detail = `Browser extension: ${request.name || 'NAJD extension'}\nExtension ID: ${request.origin.slice('chrome-extension://'.length)}\nCode: ${request.code}\n\n` +
    'Allow only if this same code is shown in the NAJD extension you just opened. NAJD can then browse in its own browser tab; typing, buttons and sign-ins keep their approvals.\n\n' +
    `إضافة متصفح تطلب الربط مع نجد. اسمح فقط إذا ظهر نفس الرمز (${request.code}) في إضافة نجد التي فتحتها الآن.`
  const options = { type: 'question', buttons: ['Allow / السماح', 'Deny / رفض'], defaultId: 1, cancelId: 1, noLink: true, title: 'NAJD AGENT', message: 'A browser wants to connect to NAJD / متصفح يطلب الربط مع نجد', detail }
  let choice = 1
  try { choice = (window ? await dialog.showMessageBox(window, options) : await dialog.showMessageBox(options)).response } catch {}
  await browserBridge?.resolvePair(request.id, choice === 0)
}
const browserApprovalOpen = false

// Phase 14: only NAJD's own app windows (created with the preload in createWindow) may call main; any other window (web preview,
// video frames, the runtime dialog) is refused even if it ever gained a bridge.
const appWindows = new WeakSet()
function withWindowSender(event, operation, track = true) {
  const window = BrowserWindow.fromWebContents(event.sender)
  if (!window || !appWindows.has(window) || event.senderFrame !== window.webContents.mainFrame) throw new Error('UNTRUSTED_SENDER')
  if (installingUpdate) throw mainError('UPDATE_BUSY')
  const result = operation()
  if (track && result && typeof result.then === 'function') {
    pendingIpc.add(result)
    return result.finally(() => pendingIpc.delete(result))
  }
  return result
}

// Closing the window hides NAJD to the tray (see background-mode.cjs); automated runs (remote debugging) and a real quit close it as usual.
let backgroundMode = null
let startupGuard = null
let channels = null
let confirmHealthy = () => {}
let generationError = null
const RELEASES_PAGE = 'https://github.com/ibrahimI-T/najd/releases'
// The sidebar's community and credit buttons open only these fixed addresses. A Discord profile link needs the numeric user
// id, so until it is known the author's button leads to the community server, where the author (@fm.1) is a member.
const COMMUNITY_LINKS = { community: 'https://discord.gg/QAbYVEdcE', website: 'https://najdagent.si', author: 'https://discord.gg/QAbYVEdcE' }
const openChatLink = url => createChatLinkOpener({ shell, workspaceRoot: path.join(app.getPath('documents'), 'NAJD') })(url).catch(() => false)
function showMainWindow() {
  let window = BrowserWindow.getAllWindows()[0]
  if (!window) { createWindow(); return }
  if (window.isMinimized()) window.restore()
  window.show(); window.focus()
}
function createWindow() {
  // The window opens as the owner left it (electron/window-state.cjs).
  const windowState = createWindowState({ filePath: path.join(app.getPath('userData'), 'najd-data', 'window-state.json') })
  const opened = windowState.restore(require('electron').screen.getAllDisplays().map(display => display.workArea))
  const window = new BrowserWindow({
    width: opened.width,
    height: opened.height,
    ...(Number.isSafeInteger(opened.x) ? { x: opened.x, y: opened.y } : {}),
    minWidth: 760,
    minHeight: 560,
    title: 'NAJD AGENT',
    icon: path.join(__dirname, '../build/icon.png'),
    backgroundColor: '#171717',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      // https://www.electronjs.org/docs/latest/tutorial/security/
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      additionalArguments: app.commandLine.hasSwitch('remote-debugging-port') ? ['--najd-automation'] : [],
      preload: path.join(__dirname, 'preload.cjs')
    }
  })
  appWindows.add(window)

  window.on('close', event => {
    if (!backgroundMode?.shouldHide()) return
    event.preventDefault()
    window.hide()
    backgroundMode.hidden()
  })
  // A link the user clicks in a chat: web addresses open in the default browser; a file link opens only for a web page or picture inside the NAJD workspace.
  window.webContents.setWindowOpenHandler(({ url }) => {
    void openChatLink(url)
    return { action: 'deny' }
  })

  window.webContents.on('will-navigate', event => event.preventDefault())
  window.webContents.on('console-message', details => {
    if (details.level === 'error') console.error('NAJD renderer:', details.message.slice(0, 300))
  })
  window.webContents.on('did-fail-load', (_event, code, description) => {
    console.error('NAJD load failed:', code, description)
  })

  window.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  const showFallback = setTimeout(() => { if (!window.isDestroyed() && !window.isVisible()) window.show() }, 8000)
  window.once('ready-to-show', () => { clearTimeout(showFallback); if (opened.maximized) window.maximize(); window.show() })
  windowState.track(window)
  // The renderer pauses its polling while the window is minimized or hidden; tell it on every change. On Windows
  // isVisible() can stay false after the window is shown and focused, so the shown state is tracked from the
  // window events themselves; isMinimized() is reliable. The gateway scheduler uses the same state.
  windowShown.set(window, window.isVisible())
  const hiddenNow = () => !windowShown.get(window) || window.isMinimized()
  const sendHidden = () => { if (!window.isDestroyed()) window.webContents.send('najd:window:hidden', hiddenNow()) }
  window.on('show', () => { windowShown.set(window, true); sendHidden(); rescheduleGatewayHealth() })
  window.on('hide', () => { windowShown.set(window, false); sendHidden(); rescheduleGatewayHealth() })
  window.on('minimize', () => { sendHidden(); rescheduleGatewayHealth() })
  window.on('restore', () => { windowShown.set(window, true); sendHidden(); rescheduleGatewayHealth() })
  window.webContents.on('did-finish-load', sendHidden)
  // Windows D3D: the compositor can keep a stale (black) frame after external
  // maximize/restore (taskbar, taskkill relaunch, SetWindowPos) until new input
  // arrives; webContents.invalidate() schedules a fresh frame on those events.
  const repaint = () => { if (!window.isDestroyed()) window.webContents.invalidate() }
  for (const eventName of ['restore', 'maximize', 'unmaximize', 'show']) {
    window.on(eventName, () => setTimeout(repaint, 60))
  }
}

// Crash dumps and uncaught errors stay on this computer (nothing is uploaded); the diagnostics export bundles a redacted summary the owner can share.
const errorLog = createErrorLog({ filePath: path.join(app.getPath('userData'), 'najd-data', 'errors.jsonl') })
try { require('electron').crashReporter.start({ uploadToServer: false, compress: true, submitURL: '' }) } catch {}
process.on('uncaughtException', error => { errorLog.record('uncaughtException', error); console.error('NAJD main error:', error?.code || error?.message) })
process.on('unhandledRejection', reason => { errorLog.record('unhandledRejection', reason); console.error('NAJD main rejection:', reason?.code || reason?.message) })
app.whenReady().then(() => {
  // Phase 14: page permissions are refused except what NAJD's own page needs (electron/permissions.cjs).
  const permissionPolicy = require('./permissions.cjs').createPermissionPolicy({ isAppWindow: contents => appWindows.has(BrowserWindow.fromWebContents(contents)) })
  require('electron').session.defaultSession.setPermissionRequestHandler(permissionPolicy.request)
  require('electron').session.defaultSession.setPermissionCheckHandler(permissionPolicy.check)
  // Snapshot previous-process uncertainty before the new window can submit work.
  // Reading recovery never resumes a tool, uses an old approval or calls a model.
  const recovery = actionJournal.list().then(records => ({ available: true, actions: records
    .filter(record => ['AWAITING_APPROVAL', 'UNKNOWN_EFFECT'].includes(record.state))
    .map(({ id, operation, target, state, updatedAt }) => ({ id, operation, target, state, updatedAt })) }))
    .catch(() => ({ available: false, actions: [] }))
  // The snapshot says which actions were pending when this run started; each is shown only while the journal still has it pending.
  ipcMain.handle('najd:actions:recovery', event => withWindowSender(event, async () => {
    const snapshot = await recovery
    if (!snapshot.available) return snapshot
    const current = new Map((await actionJournal.list().catch(() => [])).map(record => [record.id, record.state]))
    return { available: true, actions: snapshot.actions.filter(item => ['AWAITING_APPROVAL', 'UNKNOWN_EFFECT'].includes(current.get(item.id))).map(item => ({ ...item, state: current.get(item.id) })) }
  }))
  ipcMain.handle('najd:actions:reconcile', (event, id, resolution) => withWindowSender(event, async () => {
    if (!['done', 'not-done', 'dismiss'].includes(resolution)) throw mainError('INVALID_INPUT')
    const snapshot = await recovery
    if (!snapshot.available || !snapshot.actions.some(item => item.id === id)) throw mainError('NOT_FOUND') // only actions listed at startup can be settled here
    const record = await actionJournal.reconcile(id, resolution)
    return { id: record.id, state: record.state }
  }))
  const readNotices = createLegalNotices({ appRoot: path.join(__dirname, '..'), resourcesRoot: process.resourcesPath,
    electronRoot: app.isPackaged ? path.dirname(process.execPath) : path.join(__dirname, '../node_modules/electron/dist'), packaged: app.isPackaged })
  ipcMain.handle('najd:about:notices', event => withWindowSender(event, async () => ({ version: app.getVersion(), text: await readNotices() })))
  windowsNode = createWindowsNode({
    runtimeRoot: app.isPackaged ? path.join(process.resourcesPath, 'managed-runtimes') : path.join(__dirname, '../.runtimes'),
    stateRoot: path.join(app.getPath('userData'), 'najd-data', 'engines', 'windows-node'),
    // The host links to the gateway only when it is already up; while it is still starting, the host starts without it (windows-node.cjs).
      nodeConnection: operation => ['healthy', 'degraded'].includes(gateway.status().state) ? gateway.withLocalNodeConnection(operation) : Promise.reject(Object.assign(new Error('GATEWAY_STARTING'), { code: 'GATEWAY_STARTING' })),
    layout: bundleRuntime ? { dotnetRoot: bundleDir('dotnet'), entry: path.join(bundleDir('desktop-host'), 'Najd.WindowsNode.dll') } : null
  })
  gateway = createOpenClawGateway({
    runtimeRoot: app.isPackaged ? path.join(process.resourcesPath, 'managed-runtimes') : path.join(__dirname, '../.runtimes'),
    stateRoot: path.join(app.getPath('userData'), 'najd-data', 'engines', 'openclaw'),
    layout: bundleRuntime ? { nodeRoot: bundleDir('node'), node: path.join(bundleDir('node'), 'najd-gateway.exe'), container: bundleDir('gateway') } : null
  })
  ipcMain.handle('najd:gateway:status', event => withWindowSender(event, () => gateway.status()))
  ipcMain.handle('najd:providers:limits', event => withWindowSender(event, () => providers.limits()))
  ipcMain.handle('najd:providers:setLimits', (event, policy) => withWindowSender(event, () => providers.setLimits(policy)))
  ipcMain.handle('najd:gateway:start', event => withWindowSender(event, () => {
    if (quitting) throw mainError('CANCELLED')
    return gateway.start()
  }))
  ipcMain.handle('najd:gateway:stop', event => withWindowSender(event, () => gateway.stop()))
  credentials = createCredentialStore({ filePath: path.join(app.getPath('userData'), 'najd-data', 'credentials.json'), encryption: safeStorage })
  chatGPT = createChatGPTAuth({
    store: createChatGPTStore({ filePath: path.join(app.getPath('userData'), 'najd-data', 'chatgpt.json'), encryption: safeStorage }),
    inference: createChatGPTInference(), openBrowser: url => shell.openExternal(url)
  })
  providers = createProviderService({ directory: path.join(app.getPath('userData'), 'najd-data'), encryption: safeStorage, chatGPT, ollama, kimiStore: credentials })
  capabilities = createCapabilityRegistry({ directory: path.join(app.getPath('userData'), 'najd-data/capabilities'), core })
  const connectorPrefs = path.join(app.getPath('userData'), 'najd-data', 'connectors.json')
  mcpConnectors = createMcpConnectors({ node: windowsNode, preference: createConnectorPreference({ filePath: connectorPrefs }) })
  // The local Windows companion starts connected unless the user turned it off.
  void mcpConnectors.resume()
  const bundledSkills = createInstructionSkills({ filePath: path.join(app.getPath('userData'), 'najd-data/instruction-skills.json'), bundle: { ...upstreamSkillBundle, skills: [...upstreamSkillBundle.skills, ...najdSkillRows] } })
  const externalSkills = createExternalSkills({ directory: path.join(app.getPath('userData'), 'najd-data/external-skills'), owners: () => pluginStore.ownedSkills() })
  // One skill surface for the model and UI; bundled and user-installed skills keep separate stores.
  const instructionSkills = {
    list: async () => [...await bundledSkills.list(), ...await externalSkills.list()],
    setEnabled: async (id, enabled) => (await externalSkills.has(id) ? externalSkills : bundledSkills).setEnabled(id, enabled),
    read: async (id, offset, limit) => (await externalSkills.has(id) ? externalSkills : bundledSkills).read(id, offset, limit)
  }
  // Plugins from outside (plugins.cjs). Install and removal are explicit actions of the owner in Settings; the agent installs only after an in-chat approval.
  const pluginStore = createPlugins({ directory: path.join(app.getPath('userData'), 'najd-data/plugins'), skills: externalSkills })
  const githubUrl = url => { if (typeof url !== 'string' || !/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+/.test(url) || url.length > 500) throw mainError('INVALID_INPUT'); return url }
  ipcMain.handle('najd:plugins:list', event => withWindowSender(event, () => pluginStore.list()))
  ipcMain.handle('najd:plugins:commands', event => withWindowSender(event, () => pluginStore.commands()))
  ipcMain.handle('najd:plugins:search', (event, query, market) => withWindowSender(event, () => pluginStore.search(String(query || '').slice(0, 200), { market: typeof market === 'string' ? market : undefined })))
  ipcMain.handle('najd:plugins:preview', (event, url) => withWindowSender(event, () => pluginStore.preview(githubUrl(url))))
  ipcMain.handle('najd:plugins:install', (event, url, digest) => withWindowSender(event, () => pluginStore.install(githubUrl(url), undefined, { expectedDigest: typeof digest === 'string' && /^[0-9a-f]{64}$/.test(digest) ? digest : null })))
  ipcMain.handle('najd:plugins:remove', (event, id) => withWindowSender(event, () => pluginStore.remove(String(id))))
  ipcMain.handle('najd:plugins:markets', event => withWindowSender(event, () => pluginStore.markets()))
  ipcMain.handle('najd:plugins:addMarket', (event, repo) => withWindowSender(event, () => pluginStore.addMarketplace(String(repo))))
  ipcMain.handle('najd:plugins:removeMarket', (event, id) => withWindowSender(event, () => pluginStore.removeMarketplace(String(id))))
  ipcMain.handle('najd:skills:install', (event, url) => withWindowSender(event, () => externalSkills.install(url)))
  ipcMain.handle('najd:skills:update', (event, id) => withWindowSender(event, () => externalSkills.update(id)))
  ipcMain.handle('najd:skills:remove', (event, id) => withWindowSender(event, () => externalSkills.remove(id)))
  videoFrames = createVideoFrames({ protocol, BrowserWindow })
  library = createAssetLibrary({ directory: path.join(app.getPath('userData'), 'najd-data/library'),
    protectedRoots: [app.getPath('userData'), path.join(app.getPath('home'), '.hermes'),
      path.join(app.getPath('home'), '.codex'), path.join(app.getPath('home'), '.ssh'),
      path.join(app.getPath('home'), 'AppData/Local/hermes')],
    prepareVideo: file => videoFrames.extract(file),
    // Decode with Chromium's image codecs, bound the long side and re-encode as JPEG for vision input.
    prepareImage: async bytes => {
      const image = nativeImage.createFromBuffer(bytes)
      if (image.isEmpty()) throw mainError('UNSUPPORTED_FORMAT')
      const { width, height } = image.getSize(), scale = Math.min(1, 1600 / Math.max(width, height))
      return (scale < 1 ? image.resize({ width: Math.round(width * scale), height: Math.round(height * scale), quality: 'good' }) : image).toJPEG(85)
    } })
  knowledgeBases = createKnowledgeBases({ filePath: path.join(app.getPath('userData'), 'najd-data', 'knowledge-bases.json'), library })
  // External MCP servers are added only by the user in Settings, after a native confirmation of the exact command.
  mcpServers = createMcpServers({ filePath: path.join(app.getPath('userData'), 'najd-data', 'mcp-servers.json'), encryption: safeStorage, clientVersion: app.getVersion(),
    getBundledNode: () => najdNode(),
    confirm: async ({ name, commandLine, cwd, envNames }) => {
      const parent = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]
      const detail = [commandLine, cwd ? 'Folder / المجلد: ' + cwd : '', envNames.length ? 'Secrets / أسرار: ' + envNames.join(', ') : ''].filter(Boolean).join('\n\n')
      const { response } = await dialog.showMessageBox(parent, { type: 'warning', buttons: ['Add and allow / أضف واسمح', 'Cancel / إلغاء'], defaultId: 1, cancelId: 1, noLink: true,
        title: 'NAJD AGENT', message: 'Add MCP server "' + name + '"? / إضافة خادم MCP؟',
        detail: 'NAJD will run this program on your computer when you connect it. Its tools run only after you approve each call in chat.\n' +
          'سيشغّل نجد هذا البرنامج على جهازك عند الاتصال، ولا تُنفَّذ أدواته إلا بعد موافقتك على كل استدعاء في المحادثة.\n\n' + detail })
      return response === 0
    } })
  void mcpServers.resume()
  // Local bridge for the NAJD browser extension: always listening on loopback so a linked browser reconnects by itself.
  browserBridge = createBrowserBridge({ filePath: path.join(app.getPath('userData'), 'najd-data', 'browser-link.json'), encryption: safeStorage,
    // A question from the browser waits for the saved passwords to be loaded for masking, and is refused if that fails.
    ready: () => credentialVault ? credentialVault.prime() : Promise.resolve(),
    // Pages are cleaned of any password NAJD handed to a site before they are stored, shown or sent to a model.
    sanitize: value => credentialVault ? credentialVault.scrubDeep(value) : value })
  void browserBridge.start().catch(error => console.info('NAJD browser bridge:', error.code))
  // Authorized accounts (R-063): metadata in a small file, passwords only in Windows Credential Manager, never in a log, journal or model.
  credentialVault = createCredentialVault({ directory: path.join(app.getPath('userData'), 'najd-data', 'accounts'), store: createWindowsCredentialStore(),
    audit: entry => activityLog?.record({ action: entry.action, decision: 'allowed', path: entry.host, reason: entry.account }) })
  // Saved passwords (also those of interrupted revocations) are loaded for masking first; only then are interrupted revocations finished, so a deleted
  // password stays masked for the rest of this run, also in tabs that survived a restart.
  const finishRevocations = () => credentialVault.prime().then(() => credentialVault.reconcile())
  void finishRevocations().catch(() => {})
  // Retried every two minutes while the app runs (Credential Manager may recover), and on request from Settings > Accounts.
  setInterval(() => { void finishRevocations().catch(() => {}) }, 120000).unref?.()
  browserBridge.setHandlers({
    onPairRequest: request => { void confirmBrowserPairing(request) },
    // A question typed in the browser extension becomes a normal conversation in the app (its provider, its approvals, its history).
    // The question is kept here and handed to the window again and again until the app confirms it has it (a window that is still starting, or
    // reloading, has no listener yet). If that never happens the question fails visibly instead of waiting forever.
    onAsk: async ask => {
      if (!BrowserWindow.getAllWindows().some(item => !item.isDestroyed() && !item.webContents.isDestroyed())) return false
      const entry = { payload: { id: ask.id, text: ask.text, page: ask.page }, since: Date.now() }
      const send = () => {
        if (!pendingAsks.has(ask.id)) return
        // Kept until its task is created (or it is stopped), so a renderer reload while it waits cannot lose it; 30 minutes at most.
        if (Date.now() - entry.since > 30 * 60 * 1000) { dropPendingAsk(ask.id); browserBridge.updateAsk(ask.id, { state: 'failed', progress: 'NOT_STARTED' })
          // The app drops it from its queue too (the same notification as a Stop), so clearing a draft later cannot start an expired question.
          for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send('najd:ask:cancelled', { id: ask.id, taskId: null })
          return }
        const known = browserBridge.getAsk(ask.id)
        if (!known || known.taskId || ['done', 'failed', 'cancelled'].includes(known.state)) { dropPendingAsk(ask.id); return }
        for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send('najd:ask:incoming', entry.payload)
      }
      entry.timer = setInterval(send, 2000); entry.timer.unref?.()
      pendingAsks.set(ask.id, entry)
      send()
      return true
    },
    // Stop in the browser: a running task is cancelled, and the renderer drops the question if it has not started yet.
    onAskCancel: ({ id, taskId }) => {
      dropPendingAsk(id)
      if (taskId) { try { core.cancelTask(taskId) } catch {} }
      for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send('najd:ask:cancelled', { id, taskId: taskId || null })
    }
  })
  let officePack = null
  const agentCatalog = createAgentCatalog({ registry: capabilities, connectors: mcpConnectors, getTools: () => agentRuntime.describeTools(), getSkills: () => instructionSkills.list(), getMcpTools: () => mcpServers.tools(),
    getPacks: () => officePack ? [{ id: 'office-pack', ...officePack.describe() }] : [] })
  // Original Hermes tools run only from the activated, verified core (a development
  // checkout may point at a staged payload explicitly; packaged builds never do).
  const coreDirectory = async () => (await runtimeService?.directories())?.['agent-core'] ||
    (!app.isPackaged && process.env.NAJD_DEV_AGENT_CORE && path.isAbsolute(process.env.NAJD_DEV_AGENT_CORE) ? process.env.NAJD_DEV_AGENT_CORE : null)
  hermesTools = createHermesTools({ stateRoot: path.join(app.getPath('userData'), 'najd-data', 'engines', 'hermes-tools'), getCoreDirectory: coreDirectory })
  // Python and process output logs live in the NAJD workspace, owned per conversation (M2-005/M2-009).
  // Logs live in protected application data, never in the readable workspace (M2-R08).
  const execLogs = createExecLogs({ directory: path.join(app.getPath('userData'), 'najd-data', 'logs') })
  // Retention at start (Phase 14 R2): command logs of earlier sessions (30 days, 512 MB in all) and local crash dumps
  // (newest 20, 30 days). Deferred so it never delays the window.
  setTimeout(() => {
    try { execLogs.prune() } catch {}
    try { require('./log-retention.cjs').pruneDirectory(app.getPath('crashDumps')) } catch {}
  }, 15000).unref?.()
  // The desktop host must be installed for background commands, Python and desktop tools (M2-R17).
  // Desktop work goes through the companion only while the user allows it: after a disconnect, new requests are
  // refused before anything starts and the tools report not ready (M2-R7-001).
  const hostAllowed = () => !!windowsNode && mcpConnectors?.allowed?.() === true
  const hostReady = async () => hostAllowed() && await windowsNode.installed()
  const gatedHost = windowsNode && {
    invokeHost: (...args) => hostAllowed() ? windowsNode.invokeHost(...args) : Promise.reject(Object.assign(new Error('NOT_CONNECTED'), { code: 'NOT_CONNECTED', dispatched: false })),
    // Whether the host process is alive, not whether new work is allowed: while a disconnect is still stopping it, its
    // commands may still run, so they are not taken as ended (M2-R17-001).
    isRunning: () => windowsNode.isRunning(), installed: () => windowsNode.installed(),
    currentInstance: () => windowsNode.currentInstance(), instanceEnded: instance => windowsNode.instanceEnded(instance) }
  // Background commands run contained in the desktop host (M2c); earlier sessions are reconciled at start.
  const processLifecycle = createProcessLifecycle({ filePath: path.join(app.getPath('userData'), 'najd-data', 'process-lifecycle.json'), onEnded: logId => execLogs.finished(logId) })
  const lifecycleReconciled = processLifecycle.reconcileStartup().catch(() => {})
  const processTools = createProcessTools({ host: gatedHost, lifecycle: processLifecycle, logs: execLogs, journal: actionJournal,
    classifyCommand, checkFolder: input => workspaceTools.checkFolder(input), createFolder: target => workspaceTools.createFolder(target),
    workspace: workspaceTools.workspace, executionEnv: () => workspaceTools.executionEnv(), available: hostReady })
  // Desktop windows through the desktop host's UI Automation (M2d); files must be in the workspace or a granted folder.
  const desktopTools = createDesktopTools({ host: gatedHost, journal: actionJournal, available: hostReady, startApps: createStartApps(),
    resolveReadable: input => workspaceTools.resolve(input).absolute,
    captureDirectory: path.join(app.getPath('documents'), 'NAJD', '.najd', 'captures'), saveToLibrary: file => library.importFile(file),
    // The model receives a JPEG data URL that always fits the context's image limit: quality, then size, step down
    // until it fits (M2-R4-004). The PNG itself stays in the library.
    prepareForModel: async (bytes, maxUrl) => {
      const image = nativeImage.createFromBuffer(bytes)
      if (image.isEmpty()) throw mainError('UNSUPPORTED_FORMAT')
      const { width, height } = image.getSize()
      for (const scale of [1, 0.75, 0.5, 0.35, 0.25]) {
        const sized = scale < 1 ? image.resize({ width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), quality: 'good' }) : image
        for (const quality of [85, 70, 55]) {
          const url = 'data:image/jpeg;base64,' + sized.toJPEG(quality).toString('base64')
          if (url.length <= maxUrl) return url
        }
      }
      return null
    } })
  // The managed engine's base interpreter and uv, found through the verified core receipt.
  const engineInfo = async () => {
    const core = await coreDirectory()
    if (!core) return null
    const receipt = JSON.parse(await require('node:fs/promises').readFile(path.join(core, 'najd-core.json'), 'utf8'))
    const inside = target => { const relative = path.relative(core, target); return relative && !relative.startsWith('..') && !path.isAbsolute(relative) }
    const python = path.resolve(core, String(receipt.python || ''))
    if (!inside(python) || !require('node:fs').existsSync(python)) return null
    const uvFolder = (await require('node:fs/promises').readdir(path.join(core, 'tools')).catch(() => [])).find(name => /^uv-[0-9.]+-win32-x64$/.test(name))
    const uv = uvFolder ? path.join(core, 'tools', uvFolder, 'uv.exe') : null
    return { python, uv: uv && inside(uv) && require('node:fs').existsSync(uv) ? uv : null, receiptPython: String(receipt.python).replace(/\\/g, '/') }
  }
  // The Office and design pack (M3): pinned packages the user installs from Settings, run through the desktop host.
  officePack = createOfficePack({ root: path.join(app.getPath('userData'), 'najd-data', 'packs', 'office'),
    lockText: require('node:fs').readFileSync(path.join(__dirname, 'packs', 'office-pack.lock.txt'), 'utf8'),
    getEngine: async () => { const engine = await engineInfo(); return engine?.uv ? engine : null },
    host: gatedHost || { invokeHost: () => Promise.reject(Object.assign(new Error('NOT_CONNECTED'), { code: 'NOT_CONNECTED', dispatched: false })) },
    hostReady, hostPid: () => windowsNode?.hostPid?.() ?? null, lifecycle: processLifecycle, logs: execLogs })
  // The pack installs itself (owner request 2026-10-19: no manual dependency step): at start, and again every ten
  // minutes while it is missing or damaged, whenever the engine and the desktop host are ready. Installs are verified
  // against the pinned lock as before; a failure (for example offline) simply waits for the next attempt.
  const autoInstallPack = async () => {
    try {
      const status = await officePack.status()
      if (['not-installed', 'damaged', 'incompatible'].includes(status.state) && !status.installing && await hostReady().catch(() => false) && await engineInfo().catch(() => null))
        await officePack.install()
    } catch {}
  }
  void lifecycleReconciled.then(() => officePack.start()).then(() => autoInstallPack()).catch(() => {})
  const packAutoInstall = setInterval(() => { void autoInstallPack() }, 10 * 60000)
  packAutoInstall.unref?.()
  const packSweep = setInterval(() => { void officePack.sweep().catch(() => {}) }, 60000)
  packSweep.unref?.()
  // najd_python_run uses only the managed engine's interpreter, found through the verified core receipt.
  // The NAJD Office kit is plain Python read by the engine, so packaged builds keep it outside app.asar.
  const pythonTools = createPythonTools({ pack: officePack, kitPath: path.join(__dirname, 'packs').replace(/app\.asar(?=[\\/])/, 'app.asar.unpacked'), stateRoot: path.join(app.getPath('userData'), 'najd-data', 'engines'), logs: execLogs, journal: actionJournal,
    host: gatedHost, hostReady, checkFolder: input => workspaceTools.checkFolder(input), createFolder: target => workspaceTools.createFolder(target),
    adopt: details => processTools.adopt(details),
    getPython: async () => (await engineInfo())?.python || null })
  // A slide picture as the gray grid the playback check compares (BGRA bitmap from Electron's nativeImage).
  const grayFromImage = image => { const sized = image.resize({ width: 256, height: 144, quality: 'good' }), bgra = sized.toBitmap(), gray = new Uint8Array(256 * 144); for (let p = 0; p < gray.length; p++) gray[p] = Math.round(0.114 * bgra[p * 4] + 0.587 * bgra[p * 4 + 1] + 0.299 * bgra[p * 4 + 2]); return gray }
  // najd_office_review (M3-8): Office runs only on private copies that passed the scan, never on the user's file.
  const unpacked = target => target.replace(/app\.asar(?=[\\/])/, 'app.asar.unpacked')
  const officeReview = createOfficeReview({ stateRoot: path.join(app.getPath('userData'), 'najd-data', 'office-review'),
    scriptPath: unpacked(path.join(__dirname, 'office', 'office-review.ps1')), kitPath: unpacked(path.join(__dirname, 'packs')),
    host: gatedHost || { invokeHost: () => Promise.reject(Object.assign(new Error('NOT_CONNECTED'), { code: 'NOT_CONNECTED', dispatched: false })) }, hostReady,
    resolveReadable: input => workspaceTools.resolve(input).absolute, extractFrames: (file, options) => videoFrames.extract(file, options), pack: officePack,
    getPython: async () => (await engineInfo())?.python || null,
    loadGrid: async file => { const image = nativeImage.createFromPath(file); return image.isEmpty() ? null : grayFromImage(image) },
    prepareImage: async file => {
      const image = nativeImage.createFromPath(file)
      if (image.isEmpty()) return null
      const sized = image.getSize().width > 1280 ? image.resize({ width: 1280, quality: 'good' }) : image
      return 'data:image/jpeg;base64,' + sized.toJPEG(80).toString('base64')
    } })
  // Copies and review-started Office instances left by an earlier session are finished once the host is ready.
  void lifecycleReconciled.then(() => officeReview.cleanup()).catch(() => {})
  const media = createMediaGeneration({ getOpenAIKey: () => providers.serviceKey('openai-api'), workspace: path.join(app.getPath('documents'), 'NAJD'),
    saveToLibrary: file => library.importFile(file), jobs: conversationOutputs,
    onJobOutput: (job, output) => job.conversationId ? conversationOutputs.addOutput({ conversationId: job.conversationId, runId: job.runId || null, kind: 'media', path: output.path, libraryId: output.libraryId || null }) : null })
  // Background video jobs finish even when nobody asks again (APR-003): one pass at a time, every 60 s, and a
  // network request only while unfinished jobs exist. A finished video is fetched once by videoStatus.
  // Owned by main: one pass at a time with its own cancellation, stopped and awaited before quitting (APR-012).
  let reconcilePass = null, reconcileController = null
  const reconcileJobs = () => {
    if (reconcilePass || quitting) return reconcilePass
    reconcileController = new AbortController()
    const signal = AbortSignal.any([reconcileController.signal, AbortSignal.timeout(120000)])
    reconcilePass = (async () => {
      // Unsaved job records are retried first (a status read saves them), then active stored jobs.
      const unsaved = media.unsavedJobs()
      const active = await conversationOutputs.activeJobs()
      for (const job of [...unsaved, ...active.filter(job => !unsaved.some(item => item.jobId === job.jobId))]) {
        if (quitting || signal.aborted) break
        await media.videoStatus({ jobId: job.jobId, prompt: '' }, { signal }).catch(() => {})
      }
    })().catch(() => {}).finally(() => { reconcilePass = null; reconcileController = null })
    return reconcilePass
  }
  const jobTimer = setInterval(() => { void reconcileJobs() }, 60000)
  jobTimer.unref?.()
  stopBackgroundJobs = async () => { clearInterval(jobTimer); reconcileController?.abort(); await reconcilePass }
  // Skills and MCP servers the agent finds and adds itself (owner request 2026-10-20), with NAJD's own Node, npm and uv.
  const devRuntime = (...parts) => { const file = path.join(__dirname, '..', '.runtimes', ...parts); return !app.isPackaged && require('node:fs').existsSync(file) ? file : null }
  const bundledNode = () => najdNode()
  const npmScript = name => { const packed = bundleRuntime && bundleDir('gateway') ? path.join(bundleDir('gateway'), 'node_modules', 'npm', 'bin', name) : null; return packed && require('node:fs').existsSync(packed) ? packed : devRuntime('openclaw-runtime-2026.10.3', 'node_modules', 'npm', 'bin', name) }
  const extensions = createExtensions({ skills: externalSkills, mcpServers, plugins: pluginStore, root: path.join(app.getPath('userData'), 'najd-data', 'extensions'),
    getNode: bundledNode, getNpmCli: () => npmScript('npm-cli.js'), getEngine: () => engineInfo() })
  // node, npm and npx for the agent's commands (website builds); appended to PATH after the user's own tools.
  // Set up now, and again after the bundled runtime is prepared or repaired (first launch, recovery): until then its
  // Node may not exist yet (I3-003). A failure is reported, not hidden.
  setupToolchain = () => ensureToolchain({ directory: path.join(app.getPath('userData'), 'najd-data', 'toolchain'), node: bundledNode(), npmCli: npmScript('npm-cli.js'), npxCli: npmScript('npx-cli.js') })
    .then(directory => { if (directory) toolchainDirectory = directory; return directory }, error => { console.info('NAJD toolchain:', error?.code || 'SETUP_FAILED'); return null })
  void setupToolchain()
  // Page previews for website work: one in-memory session and hidden window per capture (web-preview-session.cjs).
  const webPreview = createWebPreview({
    createSession: previewSessionFactory({ BrowserWindow, session: require('electron').session, nativeImage, preview: () => webPreview }),
    isPublicUrl: url => !!require('./agent-runtime.cjs').publicUrl(url),
    resolveFile: async input => workspaceTools.resolve(input).absolute, baseDirectory: workspaceTools.workspace,
    // JPEG that fits the model's image limit: quality, then size, step down until it fits.
    prepareImage: async image => {
      const { width, height } = image.getSize()
      for (const scale of [1, 0.75, 0.5, 0.35, 0.25]) {
        const sized = scale < 1 ? image.resize({ width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), quality: 'good' }) : image
        for (const quality of [85, 70, 55]) { const url = 'data:image/jpeg;base64,' + sized.toJPEG(quality).toString('base64'); if (url.length <= 3 * 1024 * 1024 - 4096) return url }
      }
      throw mainError('CAPTURE_FAILED')
    } })
  agentRuntime = createAgentRuntime({ contextLog, toolbox: createToolbox({ resolveReadable: input => workspaceTools.resolve(input).absolute }), webPreview, extensions, knowledge: knowledgeBases, catalog: agentCatalog, library, skills: instructionSkills, connectors: mcpConnectors, workspace: workspaceTools, web: hermesTools,
    memory: { remember: input => learning.remember(input), forget: input => learning.forget(input) }, journal: actionJournal,
    // Earlier conversations, read-only and bounded; the current conversation is excluded (it is already the history).
    chats: {
      async recent(exclude) { return (await sessions.listSessions()).filter(chat => chat.id !== exclude && chat.title && chat.messageCount).slice(0, 10).map(({ id, title, updatedAt }) => ({ id, title: title.slice(0, 80), updatedAt })) },
      async search(query, exclude) {
        if (typeof query !== 'string' || !query.trim()) return { results: [] }
        const words = query.trim().split(/\s+/).filter(word => word.length > 1).slice(0, 6)
        const seen = new Map()
        for (const word of words.length ? words : [query.trim()]) for (const hit of await sessions.searchSessions(word.slice(0, 100)).catch(() => [])) if (hit.id !== exclude) seen.set(hit.id, { ...hit, score: (seen.get(hit.id)?.score || 0) + 1 })
        return { results: [...seen.values()].sort((a, b) => b.score - a.score || String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0, 8).map(({ id, title, updatedAt, messageCount, snippet }) => ({ id, title, updatedAt, messageCount, snippet })) }
      },
      async read(id, offset, exclude) {
        if (typeof id !== 'string' || id === exclude) return { error: 'NOT_FOUND' }
        const chat = await sessions.getSession(id).catch(() => null)
        if (!chat) return { error: 'NOT_FOUND' }
        const from = Number.isInteger(offset) && offset > 0 ? offset : 0
        const page = chat.messages.slice(from, from + 20).map(message => ({ role: message.role, text: message.text.slice(0, 3000), at: message.createdAt }))
        return { id: chat.id, title: chat.title, messages: page, ...(from + 20 < chat.messages.length ? { nextOffset: from + 20 } : {}) }
      }
    },
    mcp: mcpServers,
    // Only tabs the user linked through the NAJD Tab Link extension; each action is approved in chat and journaled.
    // NAJD's own tab in the user's browser via the NAJD extension; typing and buttons are approved in chat and journaled.
    browser: createBrowserTools({ bridge: browserBridge, journal: actionJournal, vault: credentialVault,
      allowUrl: url => require('./agent-runtime.cjs').publicUrl(url) || (browserBridge.status().port && url.startsWith(`http://127.0.0.1:${browserBridge.status().port}/demo`)),
      // Where a host name really leads: every address it resolves to must be public (the practice page of NAJD is the one narrow exception).
      resolveUrl: (() => {
        const known = new Map()
        return async url => {
          if (browserBridge.status().port && url.startsWith(`http://127.0.0.1:${browserBridge.status().port}/demo`)) return true
          const host = new URL(url).hostname.replace(/^\[|\]$/g, '')
          const { privateAddress } = require('./web-preview.cjs')
          if (require('node:net').isIP(host)) return !privateAddress(host)
          const seen = known.get(host)
          if (seen && Date.now() - seen.at < 10000) return seen.ok
          const list = await require('node:dns').promises.lookup(host, { all: true })
          const ok = list.length > 0 && !list.some(row => privateAddress(row.address))
          known.set(host, { ok, at: Date.now() })
          if (known.size > 500) known.clear()
          return ok
        }
      })() }),
    media, python: pythonTools, logs: execLogs, processes: processTools, desktop: desktopTools, pack: officePack, officeReview })
  // Authorized accounts: the window can list them, add one (the password goes straight to the secret store and is never returned),
  // switch auto sign-in and revoke. No handler ever returns a password.
  ipcMain.handle('najd:accounts:list', event => withWindowSender(event, () => credentialVault.list()))
  ipcMain.handle('najd:accounts:add', (event, input) => withWindowSender(event, () => {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw mainError('INVALID_INPUT')
    return credentialVault.add({ label: input.label, siteUrl: input.siteUrl, username: input.username, password: input.password, autoLogin: input.autoLogin === true })
  }))
  ipcMain.handle('najd:accounts:setAutoLogin', (event, id, enabled) => withWindowSender(event, () => credentialVault.setAutoLogin(id, enabled)))
  ipcMain.handle('najd:accounts:pending', event => withWindowSender(event, () => credentialVault.pending()))
  ipcMain.handle('najd:accounts:acknowledge', (event, id) => withWindowSender(event, async () => { await credentialVault.acknowledge(id); return credentialVault.pending() }))
  ipcMain.handle('najd:accounts:retry', event => withWindowSender(event, async () => { await credentialVault.prime(); await credentialVault.reconcile(); return credentialVault.pending() }))
  ipcMain.handle('najd:accounts:remove', (event, id) => withWindowSender(event, () => credentialVault.remove(id)))
  // Office and design pack in Settings: the renderer only asks; main decides every path, package and URL.
  ipcMain.handle('najd:pack:status', event => withWindowSender(event, () => officePack.status()))
  ipcMain.handle('najd:pack:install', event => withWindowSender(event, () => officePack.install()))
  ipcMain.handle('najd:pack:cancel', event => withWindowSender(event, () => officePack.cancel()))
  ipcMain.handle('najd:pack:check', event => withWindowSender(event, () => officePack.check()))
  ipcMain.handle('najd:pack:remove', event => withWindowSender(event, () => officePack.remove()))
  ipcMain.handle('najd:skills:list', event => withWindowSender(event, () => instructionSkills.list()))
  ipcMain.handle('najd:skills:enable', (event, id, enabled) => withWindowSender(event, () => instructionSkills.setEnabled(id, enabled)))
  ipcMain.handle('najd:library:list', event => withWindowSender(event, () => library.list()))
  ipcMain.handle('najd:library:search', (event, query) => withWindowSender(event, () => library.search(query)))
  ipcMain.handle('najd:library:preview', (event, id) => withWindowSender(event, async () => {
    const { text, hasMore } = await library.read(id, { offset: 0, limit: 8000 })
    return { text, hasMore }
  }))
  ipcMain.handle('najd:library:remove', (event, id) => withWindowSender(event, () => library.remove(id)))
  ipcMain.handle('najd:library:reveal', (event, id) => withWindowSender(event, async () => {
    const item = (await library.list()).find(entry => entry.id === id)
    if (!item || item.origin !== 'artifact' || !item.source) throw mainError('NOT_FOUND')
    shell.showItemInFolder(item.source)
    return true
  }))
  // Opens a library file with its default program (owner request 2026-10-25). Only documents, sheets, slides, PDF, pictures and plain
  // text open, always as a verified copy in a fresh temporary folder, marked as untrusted, so the library's own copy never changes.
  ipcMain.handle('najd:library:open', (event, id) => withWindowSender(event, async () => {
    const item = (await library.list()).find(entry => entry.id === id)
    if (!item) throw mainError('NOT_FOUND')
    const extension = path.extname(item.name).toLowerCase()
    if (!LIBRARY_OPENABLE.has(extension)) throw mainError('NOT_OPENABLE')
    // Generated files too: a model may have written content shaped by a page or an attachment, so every open uses the marked copy
    // (C30-01); the original stays where it is, reachable with Show in folder.
    const { bytes } = await library.original(item.id)
    // A new folder with an unpredictable name for every open, and a file created only if it does not exist: no existing folder,
    // link or file can redirect the write (C27-01). The copy stays there for the program that opens it.
    const folder = await fs.mkdtemp(path.join(app.getPath('temp'), 'najd-open-'))
    const created = await fs.lstat(folder)
    if (!created.isDirectory() || created.isSymbolicLink()) throw mainError('OPEN_FAILED')
    // The stem is shortened, never the extension, so the copy still opens with its program (C31-01).
    const stem = path.basename(item.name, path.extname(item.name)).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/^[.\s]+|[.\s]+$/g, '').slice(0, 100)
    const safeName = (stem || 'file') + extension
    const target = path.join(folder, safeName)
    await fs.writeFile(target, bytes, { flag: 'wx' })
    // The copy carries the "came from the internet" mark, so Office opens a sheet, document or deck in Protected View: read only, with no
    // macros, external formulas or links until the owner chooses Enable Editing (C29-01). Without the mark it is not opened.
    try { await fs.writeFile(target + ':Zone.Identifier', '[ZoneTransfer]\r\nZoneId=3\r\n', { flag: 'wx' }) } catch { throw mainError('OPEN_FAILED') }
    if (await shell.openPath(target)) throw mainError('OPEN_FAILED')
    return true
  }))
  ipcMain.handle('najd:library:importPaths', (event, paths) => withWindowSender(event, async () => {
    if (!Array.isArray(paths) || !paths.length || paths.length > 8 || paths.some(item => typeof item !== 'string' || !path.isAbsolute(item) || item.length > 1024)) throw mainError('INVALID_INPUT')
    const result = []
    for (const source of paths) result.push(await library.importFile(source))
    return result
  }))
  // Pasted pictures arrive as bytes; they pass through a NAJD-owned inbox file and the normal import checks.
  ipcMain.handle('najd:library:importBytes', (event, name, data) => withWindowSender(event, async () => {
    const bytes = data instanceof ArrayBuffer ? Buffer.from(data) : ArrayBuffer.isView(data) ? Buffer.from(data.buffer, data.byteOffset, data.byteLength) : null
    return importPictureBytes(name, bytes)
  }))
  ipcMain.handle('najd:library:thumbnail', (event, id) => withWindowSender(event, async () => {
    const item = (await library.list()).find(entry => entry.id === id)
    if (item?.kind === 'image') return library.image(id)
    if (item?.kind === 'video') return (await library.video(id)).frames[0]?.url || null
    return null
  }))
  ipcMain.handle('najd:library:import', event => withWindowSender(event, async () => {
    const picked = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), {
      title: 'Add documents to NAJD', properties: ['openFile', 'multiSelections'],
      // Everything NAJD can read first; All files lets any plain-text file through (the library checks it).
      filters: [{ name: 'All supported files', extensions: ['pdf', 'docx', 'xlsx', 'pptx', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'mp4', 'm4v', 'webm', 'mov', 'ogv', 'txt', 'md', 'csv', 'tsv', 'json', 'jsonl', 'js', 'mjs', 'cjs', 'ts', 'jsx', 'tsx', 'py', 'html', 'htm', 'css', 'scss', 'xml', 'yaml', 'yml', 'toml', 'ini', 'sql', 'sh', 'ps1', 'bat', 'c', 'h', 'cpp', 'hpp', 'cs', 'java', 'kt', 'go', 'rs', 'rb', 'php', 'swift', 'dart', 'lua', 'r', 'vue', 'svelte', 'tex', 'srt', 'vtt', 'svg', 'log'] },
        { name: 'Documents', extensions: ['pdf', 'docx', 'xlsx', 'pptx', 'txt', 'md', 'csv'] }, { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] },
        { name: 'Videos', extensions: ['mp4', 'm4v', 'webm', 'mov', 'ogv'] }, { name: 'All files', extensions: ['*'] }]
    })
    if (picked.canceled) return []
    if (picked.filePaths.length > 20) throw mainError('INVALID_INPUT')
    // Every readable file is attached; one that cannot be read does not stop the others (it fails alone unless all do).
    const result = []
    let firstFailure = null
    for (const source of picked.filePaths) { try { result.push(await library.importFile(source)) } catch (failure) { firstFailure ??= failure } }
    if (!result.length && firstFailure) throw firstFailure
    return result
  }))
  // Knowledge bases (R-057): the renderer names a base and asks for files; main picks, imports and lists them.
  ipcMain.handle('najd:kb:list', event => withWindowSender(event, () => knowledgeBases.list()))
  ipcMain.handle('najd:kb:create', (event, name, description) => withWindowSender(event, () => knowledgeBases.create({ name, description })))
  ipcMain.handle('najd:kb:update', (event, id, input) => withWindowSender(event, () => knowledgeBases.update(id, { name: input?.name, description: input?.description })))
  ipcMain.handle('najd:kb:remove', (event, id) => withWindowSender(event, () => knowledgeBases.remove(id)))
  ipcMain.handle('najd:kb:removeItem', (event, id, assetId) => withWindowSender(event, () => knowledgeBases.removeItem(id, assetId)))
  ipcMain.handle('najd:kb:addFiles', (event, id) => withWindowSender(event, async () => {
    await knowledgeBases.get(id)
    const picked = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), {
      title: 'Add files to the knowledge base', properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Documents', extensions: ['pdf', 'docx', 'xlsx', 'pptx', 'txt', 'md', 'csv', 'json', 'html', 'htm', 'xml'] },
        { name: 'Images and videos', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'mp4', 'm4v', 'webm', 'mov', 'ogv'] }, { name: 'All files', extensions: ['*'] }]
    })
    if (picked.canceled || !picked.filePaths.length) return null
    if (picked.filePaths.length > 100) throw mainError('INVALID_INPUT')
    const ids = [], failed = []
    for (const source of picked.filePaths) {
      try { ids.push((await library.importFile(source)).id) }
      catch (failure) { failed.push({ name: path.basename(source).slice(0, 160), error: failure?.code || 'IMPORT_FAILED' }) }
    }
    const base = ids.length ? await knowledgeBases.addItems(id, ids) : await knowledgeBases.get(id)
    return { base, added: ids.length, failed }
  }))
  const sourceDiscovery = ['openclaw', 'hermes'].map(source => {
    const rows = upstreamSkillBundle.skills.filter(row => row.source === source)
    return { source, sourceRevision: rows[0].sourceRevision, limited: false, skills: rows.map(row => ({
      ...skillMetadata(row.body, source), source, sourceRevision: row.sourceRevision, relativePath: row.relativePath, digest: row.digest
    })) }
  })
  ipcMain.handle('najd:capabilities:list', event => withWindowSender(event, () => capabilities.list()))
  ipcMain.handle('najd:capabilities:sources', event => withWindowSender(event, () => sourceDiscovery))
  ipcMain.handle('najd:capabilities:install', (event, id) => withWindowSender(event, () => capabilities.install(id)))
  ipcMain.handle('najd:capabilities:enable', (event, id, enabled) => withWindowSender(event, () => capabilities.setEnabled(id, enabled)))
  ipcMain.handle('najd:capabilities:update', (event, id) => withWindowSender(event, () => capabilities.update(id)))
  ipcMain.handle('najd:capabilities:remove', (event, id) => withWindowSender(event, () => capabilities.remove(id)))
  ipcMain.handle('najd:capabilities:run', (event, id, input, intentId) => withWindowSender(event, () => capabilities.run(id, input, intentId)))
  ipcMain.handle('najd:mcp:list', event => withWindowSender(event, () => mcpConnectors.list()))
  ipcMain.handle('najd:mcp-servers:list', event => withWindowSender(event, () => mcpServers.list()))
  ipcMain.handle('najd:mcp-servers:add', (event, input) => withWindowSender(event, () => mcpServers.add(input)))
  ipcMain.handle('najd:mcp-servers:remove', (event, id) => withWindowSender(event, () => mcpServers.remove(id)))
  ipcMain.handle('najd:mcp-servers:connect', (event, id) => withWindowSender(event, () => mcpServers.connect(id)))
  ipcMain.handle('najd:mcp-servers:disconnect', (event, id) => withWindowSender(event, () => mcpServers.disconnect(id)))
  // Which common MCP launchers exist on this computer (for the server templates).
  ipcMain.handle('najd:mcp-servers:programs', event => withWindowSender(event, () => ({ npx: !!resolveCommand('npx'), uvx: !!resolveCommand('uvx') })))
  ipcMain.handle('najd:mcp-servers:pick-command', event => withWindowSender(event, async () => {
    const picked = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), { properties: ['openFile'], filters: [{ name: 'Programs', extensions: ['exe', 'cmd', 'bat'] }] })
    return picked.canceled ? null : picked.filePaths[0] || null
  }))
  ipcMain.handle('najd:mcp:connect', (event, id) => withWindowSender(event, () => mcpConnectors.connect(id)))
  ipcMain.handle('najd:mcp:disconnect', (event, id) => withWindowSender(event, () => mcpConnectors.disconnect(id)))
  const sessions = createSessionStore(path.join(app.getPath('userData'), 'najd-data', 'sessions.json'))
  // Messaging channels (channel-gateway.cjs): Telegram first. The bot token lives in the same encrypted store as other secrets; only chats the owner paired can give orders.
  channels = createChannelGateway({ core, sessions, filePath: path.join(app.getPath('userData'), 'najd-data', 'channels.json'),
    providers: { catalog: () => providers.catalog(), models: id => providers.models(id) }, readImage: id => library.image(id), importImage: (name, bytes) => importPictureBytes(name, bytes), removeImage: id => library.remove(id),
    tokenStore: createCredentialStore({ filePath: path.join(app.getPath('userData'), 'najd-data', 'channel-telegram.json'), encryption: safeStorage, keyField: 'token', keyPattern: /^\d{6,}:[\w-]{30,}$/ }),
    onActivity: entry => { for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send('najd:sessions:changed', entry) } })
  ipcMain.handle('najd:channels:status', event => withWindowSender(event, () => channels.status()))
  ipcMain.handle('najd:channels:saveToken', (event, token) => withWindowSender(event, () => channels.saveToken(String(token || '').trim())))
  ipcMain.handle('najd:channels:clearToken', event => withWindowSender(event, () => channels.clearToken()))
  ipcMain.handle('najd:channels:configure', (event, input) => withWindowSender(event, () => channels.configure(input && typeof input === 'object' ? input : {})))
  ipcMain.handle('najd:channels:pair', event => withWindowSender(event, () => channels.startPairing()))
  ipcMain.handle('najd:channels:unpair', (event, chatId) => withWindowSender(event, () => channels.unpair(Number(chatId))))
  void channels.start().catch(() => {})
  const memory = createMemoryStore(path.join(app.getPath('userData'), 'najd-data', 'memory.json'))
  personality = createPersonalityStore(path.join(app.getPath('userData'), 'najd-data', 'personality.json'))
  learning = createLearning({ directory: path.join(app.getPath('userData'), 'najd-data', 'learning') })
  // The durable memory graph over the learned memories, the owner's notes and earlier conversations (their own files stay the master copy).
  const dataRoot = path.join(app.getPath('userData'), 'najd-data')
  memoryService = createMemoryService({ directory: dataRoot, learning, notes: memory, sessions, files: { preference: path.join(dataRoot, 'learning', 'preference.json'), experience: path.join(dataRoot, 'learning', 'experience.json'), notes: path.join(dataRoot, 'memory.json'), sessions: path.join(dataRoot, 'sessions.json') } })
  void memoryService.start().catch(() => {})
  updates = createUpdateService({ config: updateConfig, version: app.getVersion(),
    enabled: app.isPackaged && process.platform === 'win32' && process.arch === 'x64',
    getManifest: signal => fetchManifest(`https://github.com/${updateConfig.owner}/${updateConfig.repo}/releases/latest/download/najd-update.json`, fetch, signal),
    getLatestVersion: signal => fetchLatestVersion(`https://api.github.com/repos/${updateConfig.owner}/${updateConfig.repo}/releases/latest`, fetch, signal),
    // A Windows notification once per new version; clicking it brings NAJD forward, where the update notice is shown.
    notify: ({ version }) => {
      const arabic = /^ar\b/i.test(app.getLocale())
      const note = new Notification({ title: 'NAJD AGENT', body: arabic ? `يتوفر إصدار جديد من نجد: ${version}` : `A new NAJD version is available: ${version}` })
      note.on('click', () => showMainWindow()); note.show()
    },
    createUpdater: () => {
      const { NsisUpdater } = require('electron-updater')
      return new NsisUpdater({ provider: 'github', owner: updateConfig.owner, repo: updateConfig.repo, private: false })
    },
    beforeInstall: async () => {
      if (core.hasActiveTasks() || browserApprovalOpen || runtimeService.busy()) throw mainError('UPDATE_BUSY')
      installingUpdate = true
      let timer
      try {
        const settled = await Promise.race([Promise.allSettled([...pendingIpc]), new Promise((_, reject) => { timer = setTimeout(() => reject(mainError('UPDATE_BUSY')), 5000) })])
        if (settled.some(result => result.status === 'rejected')) throw mainError('UPDATE_BUSY')
        if (core.hasActiveTasks() || browserApprovalOpen) throw mainError('UPDATE_BUSY')
        hermesTools?.stop()
        await Promise.all([learning.cancel(), hermes.stop(), gateway.stop(), windowsNode.stop(), browserBridge?.stop()])
      } catch (error) { installingUpdate = false; throw error }
      finally { clearTimeout(timer) }
    }, installationFailed: () => { installingUpdate = false }
  })
  runtimeService = createRuntimeService({ root: path.join(app.getPath('userData'), 'najd-data', 'runtimes'), updateConfig, runtimeConfig,
    appVersion: app.getVersion(), bundledEngine: bundleRuntime ? () => bundleRuntime.readyDirectory('engine') : null,
    bundleStatus: bundleRuntime ? () => bundleRuntime.status() : null, prepareBundle: bundleRuntime ? () => bundleRuntime.prepare() : null, canActivate: async () => !core.hasActiveTasks() && !installingUpdate && !quitting })
  ipcMain.handle('najd:runtime:status', event => withWindowSender(event, () => runtimeService.status()))
  ipcMain.handle('najd:runtime:prepare', event => withWindowSender(event, async () => { const result = await runtimeService.prepare(); void setupToolchain?.(); return result }))
  ipcMain.handle('najd:runtime:cancel', event => withWindowSender(event, () => runtimeService.cancel()))
  ipcMain.handle('najd:updates:status', event => withWindowSender(event, () => updates.status()))
  ipcMain.handle('najd:updates:stability', event => withWindowSender(event, () => {
    const guard = startupGuard?.status() || { unstable: false, attempts: 0, healthy: true }
    const plan = bundleRuntime?.rollbackPlan() || { available: false }
    return { unstable: guard.unstable, attempts: guard.attempts, previousVersion: plan.available ? plan.version : null, recoveryNote: generationError || (plan.available ? null : plan.reason || 'NOT_VERIFIED') }
  }))
  ipcMain.handle('najd:updates:releases', event => withWindowSender(event, () => shell.openExternal(RELEASES_PAGE)))
  ipcMain.handle('najd:links:open', (event, name) => withWindowSender(event, () => Object.hasOwn(COMMUNITY_LINKS, name) ? shell.openExternal(COMMUNITY_LINKS[name]).then(() => true) : false))
  ipcMain.handle('najd:diagnostics:export', event => withWindowSender(event, async () => {
    const os = require('node:os')
    const diagnostics = createDiagnostics({
      versions: { app: app.getVersion(), electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node, packaged: app.isPackaged },
      platform: { os: process.platform, release: os.release(), arch: process.arch, locale: app.getLocale(), memoryGb: Math.round(os.totalmem() / 1073741824), uptimeMinutes: Math.round(process.uptime() / 60) },
      homeDirectory: os.homedir(),
      components: {
        gateway: () => gateway.status(), updates: async () => { const value = updates.status(); return { state: value.state, version: value.version, errorCode: value.errorCode } },
        runtime: () => runtimeService.status(),
        mcpServers: async () => (await mcpServers.list()).map(server => ({ name: server.name, enabled: server.enabled, state: server.state, error: server.error, tools: server.tools?.length ?? 0,
          // Per tool: ready or not, the real error code and class of the last failure, and the last call time (no arguments, no text).
          toolHealth: (server.tools || []).map(tool => ({ tool: tool.name, ready: tool.readiness?.ready, reason: tool.readiness?.reason, lastTest: tool.readiness?.lastFunctionalTest })) })),
        background: async () => ({ keepRunning: backgroundMode?.isKeepRunning() }),
        startup: async () => startupGuard?.status() || null,
        generations: async () => bundleRuntime ? { ...bundleRuntime.generations(), rollback: bundleRuntime.rollbackPlan(), bookkeepingError: generationError } : null
      },
      activityTail: () => activityLog?.tail(200) || [], errorTail: () => errorLog.tail(50), crashDirectory: app.getPath('crashDumps') })
    const picked = await dialog.showSaveDialog(BrowserWindow.fromWebContents(event.sender), {
      defaultPath: path.join(app.getPath('documents'), `najd-diagnostics-${new Date().toISOString().slice(0, 10)}.json`), filters: [{ name: 'NAJD diagnostics', extensions: ['json'] }], showOverwriteConfirmation: true })
    if (picked.canceled || !picked.filePath) return { saved: false }
    await fs.writeFile(picked.filePath, JSON.stringify(await diagnostics.bundle(), null, 2), 'utf8')
    return { saved: true }
  }))
  ipcMain.handle('najd:updates:check', event => withWindowSender(event, () => updates.check()))
  ipcMain.handle('najd:updates:download', event => withWindowSender(event, () => updates.download()))
  ipcMain.handle('najd:updates:cancel', event => withWindowSender(event, () => updates.cancel()))
  ipcMain.handle('najd:updates:install', event => withWindowSender(event, () => updates.install(), false))
  ipcMain.handle('najd:personality:get', event => withWindowSender(event, () => personality.get()))
  ipcMain.handle('najd:personality:save', (event, input) => withWindowSender(event, () => personality.save(input)))
  ipcMain.handle('najd:personality:reset', event => withWindowSender(event, () => personality.reset()))
  ipcMain.handle('najd:learning:list', event => withWindowSender(event, () => learning.list()))
  // The graph window: everything remembered (learned preferences and lessons, saved notes) with NAJD's soul, and the tool map.
  ipcMain.handle('najd:graph:memory', event => withWindowSender(event, async () => {
    const soul = await personality.get().catch(() => null)
    await memoryService.start(); await memoryService.sync().catch(() => {})
    const stored = memoryService.view({ soul, instructionSections: soul ? soulSections(soul.instructions) : [] })
    if (stored) return stored
    // The graph could not be opened: the same picture, built from the notes themselves (and marked as such).
    const [learned, saved] = await Promise.all([learning.approvedNotes(), memory.list()])
    return { ...memoryView({ notes: [...learned, ...saved.map(note => ({ ...note, kind: 'note' }))], soul }), degraded: true }
  }))
  ipcMain.handle('najd:memorygraph:status', event => withWindowSender(event, () => memoryService.status()))
  ipcMain.handle('najd:memorygraph:settings', (event, input) => withWindowSender(event, () => memoryService.setSettings(input && typeof input === 'object' ? input : {})))
  ipcMain.handle('najd:memorygraph:detail', (event, uid) => withWindowSender(event, async () => { await memoryService.start(); return typeof uid === 'string' ? memoryService.detail(uid) : null }))
  ipcMain.handle('najd:memorygraph:enabled', (event, uid, enabled) => withWindowSender(event, () => (typeof uid === 'string' ? memoryService.setEnabled(uid, enabled === true) : false)))
  ipcMain.handle('najd:memorygraph:scope', (event, uid, scope) => withWindowSender(event, () => (typeof uid === 'string' ? memoryService.setScope(uid, scope) : false)))
  ipcMain.handle('najd:memorygraph:traces', event => withWindowSender(event, () => memoryService.traces()))
  ipcMain.handle('najd:memorygraph:rebuild', event => withWindowSender(event, () => memoryService.rebuild()))
  ipcMain.handle('najd:memorygraph:chats', (event, input) => withWindowSender(event, () => memoryService.chats(input && typeof input === 'object' ? { query: typeof input.query === 'string' ? input.query : '', offset: input.offset, limit: input.limit } : {})))
  ipcMain.handle('najd:memorygraph:chatallowed', (event, id, allowed) => withWindowSender(event, () => memoryService.setChatAllowed(id, allowed === true)))
  ipcMain.handle('najd:graph:tools', event => withWindowSender(event, async () => {
    const state = await agentRuntime?.toolsetReadiness().catch(() => null)
    return toolsView({ ready: name => (state ? state[name] === true : true) })
  }))
  ipcMain.handle('najd:graph:usage', event => withWindowSender(event, () => contextLog.recent(60)))
  ipcMain.handle('najd:learning:settings', (event, input) => withWindowSender(event, () => learning.setSettings(input)))
  ipcMain.handle('najd:learning:accept', (event, kind, id) => withWindowSender(event, () => learning.accept(kind, id)))
  ipcMain.handle('najd:learning:reject', (event, kind, id) => withWindowSender(event, () => learning.reject(kind, id)))
  ipcMain.handle('najd:learning:edit', (event, kind, input) => withWindowSender(event, () => learning.edit(kind, input)))
  ipcMain.handle('najd:learning:remove', (event, kind, id) => withWindowSender(event, () => learning.remove(kind, id)))
  ipcMain.handle('najd:learning:export', (event, kind) => withWindowSender(event, async () => {
    const bytes = await learning.exportKind(kind)
    const picked = await dialog.showSaveDialog(BrowserWindow.fromWebContents(event.sender), {
      defaultPath: `najd-learning-${kind}.json`, filters: [{ name: 'NAJD memory backup', extensions: ['json'] }]
    })
    if (picked.canceled || !picked.filePath) return { saved: false }
    try { await fs.writeFile(picked.filePath, bytes, { flag: 'wx' }) }
    catch (error) { throw mainError(error.code === 'EEXIST' ? 'EXPORT_EXISTS' : 'MEMORY_STORE_UNAVAILABLE') }
    return { saved: true }
  }))
  ipcMain.handle('najd:learning:import', (event, kind) => withWindowSender(event, async () => {
    if (!['preference', 'experience'].includes(kind)) throw mainError('INVALID_INPUT')
    const picked = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), {
      defaultPath: `najd-learning-${kind}.json`, properties: ['openFile'], filters: [{ name: 'NAJD memory backup', extensions: ['json'] }]
    })
    if (picked.canceled || !picked.filePaths[0]) return { imported: false }
    const result = await learning.importKind(kind, await readMemoryBackup(picked.filePaths[0]))
    return { imported: true, count: result.count }
  }))
  ipcMain.handle('najd:memory:list', event => withWindowSender(event, () => memory.list()))
  ipcMain.handle('najd:memory:save', (event, input) => withWindowSender(event, () => memory.save(input)))
  ipcMain.handle('najd:memory:remove', (event, id) => withWindowSender(event, () => memory.remove(id)))
  ipcMain.handle('najd:memory:export', event => withWindowSender(event, async () => {
    const bytes = await memory.exportSnapshot()
    const picked = await dialog.showSaveDialog(BrowserWindow.fromWebContents(event.sender), {
      defaultPath: 'najd-memory-backup.json', filters: [{ name: 'NAJD memory backup', extensions: ['json'] }]
    })
    if (picked.canceled || !picked.filePath) return { saved: false }
    try { await fs.writeFile(picked.filePath, bytes, { flag: 'wx' }) }
    catch (error) { throw mainError(error.code === 'EEXIST' ? 'EXPORT_EXISTS' : 'MEMORY_STORE_UNAVAILABLE') }
    return { saved: true }
  }))
  ipcMain.handle('najd:memory:import', event => withWindowSender(event, async () => {
    const picked = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), {
      properties: ['openFile'], filters: [{ name: 'NAJD memory backup', extensions: ['json'] }]
    })
    if (picked.canceled || !picked.filePaths[0]) return { imported: false }
    const result = await memory.importSnapshot(await readMemoryBackup(picked.filePaths[0]))
    return { imported: true, count: result.count }
  }))
  // The saved access (folders, whole-computer choice) is read before the window opens and before any file-access answer (C60-01).
  const fileAccessLoaded = loadFileAccess()
  activityLog = createActivityLog({ filePath: path.join(app.getPath('userData'), 'najd-data', 'activity-log.jsonl') })
  const sortedRoots = () => [...fileRoots].sort()
  // Conversations being deleted, or deleted, in this session (M2-R14-001).
  const closingConversations = new Set()
  ipcMain.handle('najd:task:start', (event, request) => withWindowSender(event, async () => {
    // A conversation being deleted takes no new work (M2-R14-001).
    if (closingConversations.has(request?.conversationId)) throw mainError('CONVERSATION_CLOSING')
    await learning.cancel() // Foreground work preempts background review without another paid retry.
    // Checked again after that wait, right before the task starts: a delete may have begun meanwhile (M2-R15-001).
    if (closingConversations.has(request?.conversationId)) throw mainError('CONVERSATION_CLOSING')
    // A question from the browser is checked against Stop, started and tied to its ask in one synchronous step: a question stopped earlier never
    // starts, and one stopped later finds its task.
    const askId = typeof request?.askId === 'string' && /^[a-f0-9]{24}$/.test(request.askId) ? request.askId : null
    if (askId) { const known = browserBridge?.getAsk(askId); if (!known || known.cancelled || ['done', 'failed', 'cancelled'].includes(known.state)) throw mainError('ASK_CANCELLED'); if (known.taskId) throw mainError('ASK_STARTED') }
    const started = core.startTask(request)
    if (askId && started?.id) { browserBridge.updateAsk(askId, { taskId: started.id, state: 'running' }); askOfTask.set(started.id, askId); dropPendingAsk(askId) }
    claimTask(event, started?.id)
    return started
  }))
  ipcMain.handle('najd:task:get', (event, taskId) => withWindowSender(event, () => { const task = core.getTask(taskId); claimTask(event, taskId); return task }))
  // Settings > Tools: every NAJD agent tool with its toolset, readiness and effect, plus the tools of connected MCP
  // servers and the browser tool. Read-only; the runtime alone decides what a run may use.
  ipcMain.handle('najd:agent:tools', event => withWindowSender(event, async () => {
    const { TOOLSETS } = require('./agent-toolsets.cjs')
    const groupOf = name => Object.entries(TOOLSETS).find(([, names]) => names.includes(name))?.[0] || 'core'
    const tools = (await agentRuntime.describeTools()).map(tool => ({ name: tool.title, description: tool.description, ready: tool.ready, reason: tool.reason, effect: tool.effect, group: groupOf(tool.title) }))
    tools.push({ name: 'najd_browser', description: 'Browse in a NAJD tab: search, open, read and follow links; typing and pressing buttons need your approval.', ready: !!browserBridge?.status?.().connected, reason: null, effect: 'read-or-approval', group: 'browser' })
    const mcp = (await mcpServers.tools().catch(() => [])).map(tool => ({ name: tool.name, description: tool.description || tool.title || '', ready: tool.readiness?.ready !== false, reason: tool.readiness?.reason || null, readiness: tool.readiness,
      effect: tool.hints?.readOnly ? 'read' : 'change-with-approval', group: 'mcp', server: tool.serverName }))
    return [...tools, ...mcp]
  }))
  // A file NAJD produced in this conversation opens with its default app or shows in its folder; any other path is refused.
  ipcMain.handle('najd:outputs:open', (event, conversationId, filePath, mode) => withWindowSender(event, async () => {
    if (typeof conversationId !== 'string' || !/^[A-Za-z0-9-]{1,80}$/.test(conversationId) || typeof filePath !== 'string' || !['open', 'reveal'].includes(mode)) throw mainError('INVALID_INPUT')
    const outputs = await conversationOutputs.outputs(conversationId)
    if (!outputs.some(item => item.path === filePath)) throw mainError('NOT_FOUND')
    if (!require('node:fs').existsSync(filePath)) throw mainError('NOT_FOUND')
    if (mode === 'reveal') { shell.showItemInFolder(filePath); return true }
    const failure = await shell.openPath(filePath)
    if (failure) throw mainError('OPEN_FAILED')
    return true
  }))
  // Side panel data for one conversation (agent platform M1): runs, totals, outputs, jobs and profiles.
  // Authoritative toolset readiness, from the same per-tool readiness the runtime uses: a toolset is ready only when
  // every one of its tools that exists on this computer is ready (shared members like najd_log_read never carry it).
  ipcMain.handle('najd:agent:toolsets', event => withWindowSender(event, async () => {
    const { TOOLSETS } = require('./agent-toolsets.cjs')
    const ready = new Map((await agentRuntime.describeTools()).map(tool => [tool.title, tool.ready]))
    ready.set('najd_browser', !!browserBridge?.status?.().connected)
    if ((await mcpServers.tools().catch(() => [])).length) ready.set('najd_mcp_call', true)
    const out = {}
    for (const [name, members] of Object.entries(TOOLSETS)) {
      const known = members.filter(member => ready.has(member))
      if (known.length) out[name] = known.every(member => ready.get(member))
    }
    // Context-dependent toolsets load only when there is something to use (the runtime's own rule).
    if ('library' in out) out.library = out.library && (await library?.list?.().catch(() => []) ?? []).length > 0
    if ('knowledge' in out) out.knowledge = out.knowledge && (await knowledgeBases?.summary?.().catch(() => []) ?? []).length > 0
    return out
  }))
  // Agent profiles (definitions only; readiness is derived in the window from the tools' real state).
  ipcMain.handle('najd:agent:profiles', event => withWindowSender(event, () =>
    Object.entries(agentProfiles).map(([id, value]) => ({ id, title: value.title, toolsets: [...value.toolsets] }))))
  ipcMain.handle('najd:agent:context', (event, conversationId) => withWindowSender(event, async () => {
    if (typeof conversationId !== 'string' || !/^[A-Za-z0-9-]{1,80}$/.test(conversationId)) throw mainError('INVALID_INPUT')
    const [runs, totals, outputs, jobs] = await Promise.all([runReceipts.list(conversationId), runReceipts.totals(conversationId),
      conversationOutputs.outputs(conversationId), conversationOutputs.jobs(conversationId)])
    const companion = (() => { try { return mcpConnectors.list()[0] || null } catch { return null } })()
    const servers = await mcpServers.list().catch(() => [])
    return { runs: runs.slice(-20), totals, outputs: outputs.slice(-50), jobs: jobs.slice(-20),
      connections: { companion: companion ? { state: companion.state } : null, mcp: servers.map(server => ({ name: server.name, state: server.state })).slice(0, 20) },
      profiles: Object.entries(agentProfiles).map(([id, value]) => ({ id, title: value.title, toolsets: value.toolsets })) }
  }))
  ipcMain.handle('najd:task:respond', (event, approvalId, decision) => withWindowSender(event, () => {
    const pending = core.peekApproval(approvalId)
    const result = core.respondApproval(approvalId, decision)
    if (pending) {
      activityLog?.record({
        action: 'approval', decision: decision === 'ALLOW_ONCE' ? 'allowed' : 'denied',
        path: pending.proposedInput && typeof pending.proposedInput.path === 'string' ? pending.proposedInput.path : '',
        reason: pending.proposedTool || ''
      })
    }
    return result
  }))
  ipcMain.handle('najd:task:cancel', (event, taskId) => withWindowSender(event, () => core.cancelTask(taskId)))
  // A message the owner adds while a task works (the core validates the text and the task's state).
  ipcMain.handle('najd:task:addNote', (event, taskId, text) => withWindowSender(event, () => core.addNote(taskId, text)))
  ipcMain.handle('najd:files:grantRoot', event => withWindowSender(event, async () => {
    await fileAccessLoaded
    const picked = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), { properties: ['openDirectory'] })
    if (!picked.canceled && picked.filePaths[0]) {
      const root = path.resolve(picked.filePaths[0])
      fileRoots.add(root)
      activityLog.record({ action: 'grant-root', decision: 'allowed', path: root })
      await saveFileAccess().catch(() => {})
    }
    return sortedRoots()
  }))
  ipcMain.handle('najd:files:listRoots', event => withWindowSender(event, async () => { await fileAccessLoaded; return sortedRoots() }))
  ipcMain.handle('najd:files:revokeRoot', (event, root) => withWindowSender(event, async () => {
    await fileAccessLoaded
    if (!fileRoots.has(root)) throw mainError('NOT_FOUND')
    fileRoots.delete(root)
    activityLog.record({ action: 'revoke-root', decision: 'allowed', path: root })
    void saveFileAccess().catch(() => {})
    return sortedRoots()
  }))
  ipcMain.handle('najd:files:wholeComputer', (event, enabled) => withWindowSender(event, async () => {
    await fileAccessLoaded
    if (enabled !== undefined) {
      if (typeof enabled !== 'boolean') throw mainError('INVALID_INPUT')
      wholeComputer = enabled
      activityLog.record({ action: enabled ? 'grant-root' : 'revoke-root', decision: 'allowed', path: 'whole computer' })
      await saveFileAccess()
    }
    return { wholeComputer, drives: driveRoots() }
  }))
  ipcMain.handle('najd:files:activity', event => withWindowSender(event, () => activityLog.tail(50)))
  ipcMain.handle('najd:model:list', event => withWindowSender(event, () => ollama.listModels()))
  ipcMain.handle('najd:kimi:status', event => withWindowSender(event, () => credentials.kimiStatus()))
  ipcMain.handle('najd:kimi:save', (event, key) => withWindowSender(event, () => providers.saveKey('kimi-code', key)))
  ipcMain.handle('najd:kimi:clear', event => withWindowSender(event, () => providers.clearKey('kimi-code')))
  ipcMain.handle('najd:kimi:test', (event, modelName) => withWindowSender(event, async () => {
    return providers.testModel('kimi-code', modelName)
  }))
  ipcMain.handle('najd:chatgpt:status', event => withWindowSender(event, () => chatGPT.status()))
  ipcMain.handle('najd:chatgpt:start', (event, accountId) => withWindowSender(event, () => chatGPT.start(accountId)))
  ipcMain.handle('najd:chatgpt:cancel', event => withWindowSender(event, () => chatGPT.cancelSignIn()))
  ipcMain.handle('najd:chatgpt:select', (event, accountId) => withWindowSender(event, () => chatGPT.select(accountId)))
  ipcMain.handle('najd:chatgpt:signOut', (event, accountId) => withWindowSender(event, () => chatGPT.signOut(accountId)))
  ipcMain.handle('najd:chatgpt:models', event => withWindowSender(event, () => chatGPT.listModels()))
  ipcMain.handle('najd:chatgpt:test', (event, modelName) => withWindowSender(event, async () => {
    return providers.testModel('chatgpt', modelName)
  }))
  ipcMain.handle('najd:providers:catalog', event => withWindowSender(event, () => providers.catalog()))
  ipcMain.handle('najd:providers:models', (event, id) => withWindowSender(event, () => providers.models(id)))
  ipcMain.handle('najd:unions:get', event => withWindowSender(event, () => providers.unions.get()))
  ipcMain.handle('najd:unions:save', (event, config) => withWindowSender(event, () => providers.unions.save(config)))
  ipcMain.handle('najd:providers:setEndpoint', (event, id, url) => withWindowSender(event, () => providers.setEndpoint(id, url)))
  ipcMain.handle('najd:providers:detectLocal', event => withWindowSender(event, () => providers.detectLocal()))
  ipcMain.handle('najd:providers:save', (event, id, key) => withWindowSender(event, () => providers.saveKey(id, key)))
  ipcMain.handle('najd:providers:clear', (event, id) => withWindowSender(event, () => providers.clearKey(id)))
  ipcMain.handle('najd:providers:test', (event, id, model) => withWindowSender(event, () => providers.testModel(id, model)))
  ipcMain.handle('najd:providers:reasoning', (event, id, model, text, preference) => withWindowSender(event, () => providers.resolveReasoning(id, model, text, preference)))
  ipcMain.handle('najd:providers:console', (event, id) => withWindowSender(event, () => shell.openExternal(providers.consoleUrl(id))))
  ipcMain.handle('najd:provider:page', (event, page) => withWindowSender(event, () => {
    const urls = { 'chatgpt-usage': 'https://chatgpt.com/#settings/Usage', 'kimi-console': 'https://www.kimi.com/code/console' }
    if (!Object.hasOwn(urls, page)) throw mainError('INVALID_INPUT')
    return shell.openExternal(urls[page])
  }))
  ipcMain.handle('najd:session:list', event => withWindowSender(event, () => sessions.listSessions()))
  ipcMain.handle('najd:session:search', (event, query) => withWindowSender(event, () => sessions.searchSessions(query)))
  ipcMain.handle('najd:session:get', (event, id) => withWindowSender(event, () => sessions.getSession(id)))
  ipcMain.handle('najd:session:create', event => withWindowSender(event, () => sessions.createSession()))
  ipcMain.handle('najd:session:append', (event, id, role, text, taskId, assetIds) => withWindowSender(event, async () => {
    if (taskId !== undefined && role !== 'assistant') throw Object.assign(new Error('INVALID_INPUT'), {code:'INVALID_INPUT'})
    const activity = taskId === undefined ? undefined : core.getTask(taskId).activity
    if (activity && !activity.finishedAt) throw Object.assign(new Error('INVALID_INPUT'), {code:'INVALID_INPUT'})
    let attachments
    if (assetIds !== undefined) {
      if (role !== 'user' || !Array.isArray(assetIds) || assetIds.length > 20 || !assetIds.every(id => typeof id === 'string')) throw mainError('INVALID_INPUT')
      const items = await library.list()
      attachments = assetIds.map(id => {
        const item = items.find(item => item.id === id)
        if (!item) throw mainError('INVALID_INPUT')
        return { id: item.id, name: item.name }
      })
    }
    const appended = await sessions.appendMessage(id, role, text, activity, attachments)
    memoryService?.scheduleIndex() // earlier conversations are indexed in the background a moment after they change
    return appended
  }))
  ipcMain.handle('najd:session:delete', (event, id) => withWindowSender(event, async () => {
    // Deleting is serialized against new work for that conversation: it is marked closing first (new tasks are
    // refused), a task still running blocks it, and then its background commands are stopped. If any cannot be shown
    // closed, the conversation stays (and is open again) so they remain reachable (M2-R13-002, M2-R14-001).
    const valid = typeof id === 'string' && /^[A-Za-z0-9-]{1,80}$/.test(id)
    if (valid) {
      if (core.hasActiveTaskFor(id)) throw mainError('CONVERSATION_BUSY')
      closingConversations.add(id)
      const ended = await processTools.endConversation(id).catch(() => ({ open: 1 }))
      if (ended.open > 0) { closingConversations.delete(id); throw mainError('PROCESSES_RUNNING') }
    }
    let result
    try { result = await sessions.deleteSession(id); memoryService?.forgetChat(id) } catch (failure) { if (valid) closingConversations.delete(id); throw failure }
    if (typeof id === 'string' && /^[A-Za-z0-9-]{1,80}$/.test(id)) await Promise.allSettled([runReceipts.removeConversation(id), conversationOutputs.removeConversation(id)])
    return result
  }))
  ipcMain.handle('najd:session:export', (event, id) => withWindowSender(event, async () => {
    const session = await sessions.getSession(id)
    const picked = await dialog.showSaveDialog(BrowserWindow.fromWebContents(event.sender), {
      title: 'Export NAJD chat',
      defaultPath: `NAJD-chat-${session.createdAt.slice(0, 10)}.txt`,
      filters: [{ name: 'Text', extensions: ['txt'] }]
    })
    if (picked.canceled || !picked.filePath) return { saved: false }
    if (path.extname(picked.filePath).toLowerCase() !== '.txt') throw mainError('INVALID_INPUT')
    const lines = ['NAJD AGENT', session.title || 'Chat', `Created: ${session.createdAt}`, '']
    for (const message of session.messages) {
      lines.push(`${message.role === 'user' ? 'You' : 'NAJD'} — ${message.createdAt}`, message.text, '')
    }
    try {
      await fs.writeFile(picked.filePath, lines.join('\n'), { encoding: 'utf8', flag: 'wx' })
    } catch (error) {
      if (error.code === 'EEXIST') throw mainError('EXPORT_EXISTS')
      throw mainError('EXPORT_FAILED')
    }
    return { saved: true }
  }))
  // A file path written in a reply: opened or shown in Explorer, only inside the NAJD workspace (electron/chat-links.cjs).
  ipcMain.handle('najd:session:openFile', (event, input) => withWindowSender(event, async () => {
    const mode = input?.mode === 'reveal' ? 'reveal' : 'open'
    const target = typeof input?.path === 'string' && input.path.length <= 1024 ? input.path : null
    if (!target) throw mainError('INVALID_INPUT')
    return { opened: await openWorkspaceFile({ shell, workspaceRoot: path.join(app.getPath('documents'), 'NAJD') }, target, mode).catch(() => false) }
  }))
  // Saves a code block (or a prompt or diagram) from a reply where the owner chooses; nothing is written without the save dialog.
  ipcMain.handle('najd:session:saveBlock', (event, input) => withWindowSender(event, async () => {
    const text = input && typeof input.text === 'string' ? input.text : null
    const extension = input && typeof input.extension === 'string' && /^[a-z0-9]{1,8}$/.test(input.extension) ? input.extension : 'txt'
    if (text === null || Buffer.byteLength(text, 'utf8') > 5 * 1024 * 1024) throw mainError('INVALID_INPUT')
    const base = input && typeof input.name === 'string' ? input.name.replace(/[^\p{L}\p{N} ._-]/gu, '').trim().slice(0, 60) : ''
    const picked = await dialog.showSaveDialog(BrowserWindow.fromWebContents(event.sender), {
      title: 'Save from NAJD', defaultPath: `${base || 'najd-code'}.${extension}`, filters: [{ name: extension.toUpperCase(), extensions: [extension] }, { name: 'All files', extensions: ['*'] }]
    })
    if (picked.canceled || !picked.filePath) return { saved: false }
    // The dialog already asked before replacing an existing file.
    try { await fs.writeFile(picked.filePath, text, 'utf8') } catch { throw mainError('EXPORT_FAILED') }
    return { saved: true, name: path.basename(picked.filePath) }
  }))
  ipcMain.handle('najd:browser:status', event => withWindowSender(event, () => ({
    ...browserBridge.status(),
    extensionPath: app.isPackaged ? path.join(process.resourcesPath, 'browser-extension') : path.join(__dirname, '..', 'browser-extension')
  })))
  // The link code is shown only when the user opens it in Settings > Browser.
  ipcMain.handle('najd:browser:pairingCode', event => withWindowSender(event, () => browserBridge.pairingCode()))
  ipcMain.handle('najd:browser:rotateCode', event => withWindowSender(event, () => browserBridge.rotateCode()))
  ipcMain.handle('najd:browser:unpair', (event, id, instance) => withWindowSender(event, () => browserBridge.unpair(typeof id === 'string' && /^[a-p]{32}$/.test(id) ? id : undefined, typeof instance === 'string' && /^[a-f0-9]{32}$/.test(instance) ? instance : undefined)))
  // Progress of a question that came from the browser extension; the bridge validates and bounds every field.
  // Browser questions whose task is running or waiting for approval (the renderer lost its references if it reloaded): it reattaches to them.
  ipcMain.handle('najd:ask:active', event => withWindowSender(event, () => [...askOfTask.entries(), ...unsavedAsks.entries()].map(([taskId, askId]) => ({ askId, taskId }))))
  ipcMain.handle('najd:ask:saved', (event, taskId) => withWindowSender(event, () => { if (typeof taskId === 'string') unsavedAsks.delete(taskId); return true }))
  ipcMain.handle('najd:ask:update', (event, id, patch) => withWindowSender(event, () => {
    if (typeof id !== 'string' || !/^[a-f0-9]{24}$/.test(id)) return false
    const updated = browserBridge.updateAsk(id, patch)
    const known = browserBridge.getAsk(id)
    if (known?.taskId) {
      // A question stopped before its task was reported is stopped now; otherwise the app follows the task from here on.
      if (known.cancelled) { try { core.cancelTask(known.taskId) } catch {} } else { askOfTask.set(known.taskId, id); try { syncAsk(known.taskId) } catch {} }
    }
    return updated
  }))
  ipcMain.handle('najd:browser:openDemo', (event, language) => withWindowSender(event, () => shell.openExternal(browserBridge.demoUrl(language))))
  backgroundMode = createBackgroundMode({ Tray, Menu, nativeImage, iconPath: path.join(__dirname, '../build/icon.png'), filePath: path.join(app.getPath('userData'), 'najd-data', 'background.json'),
    showWindow: showMainWindow, quit: () => app.quit(), isQuitting: () => quitting, disabled: app.commandLine.hasSwitch('remote-debugging-port'),
    notify: (title, body) => { try { new Notification({ title, body }).show() } catch {} } })
  backgroundMode.start()
  // Update safety: count this start, and mark the version healthy once its engine runs (or it has stayed up for 90 s); that also lets older component
  // generations be removed. Several starts that never became healthy are reported in Settings so the previous version can be reinstalled.
  startupGuard = createStartupGuard({ filePath: path.join(app.getPath('userData'), 'najd-data', 'startup.json'), version: app.getVersion() })
  startupGuard.begin()
  let healthConfirmed = false
  confirmHealthy = reason => {
    // The whole bundled generation must be prepared before any health result counts.
    if (healthConfirmed || quitting || (bundleRuntime && !bundleRuntime.isReady())) return
    healthConfirmed = true
    startupGuard.markHealthy()
    // Recording the generation is separate bookkeeping: its failure is kept visible (diagnostics, Settings) and never changes whether this start was healthy.
    if (bundleRuntime) void (async () => { try { bundleRuntime.markPrepared(app.getVersion()); await bundleRuntime.confirmHealthy(app.getVersion()) } catch (error) { generationError = error.code || 'GENERATIONS_FAILED'; errorLog.record('generations', generationError) } })()
  }
  // With the bundled engine, only the engine itself becoming healthy counts; uptime alone never retires an earlier generation. Without a bundle (a development checkout)
  // there is no engine to wait for, so a window that stays up for 90 s counts.
  if (!bundleRuntime) { const stableTimer = setTimeout(() => confirmHealthy('stable'), 90000); stableTimer.unref() }
  // loadFileAccess never rejects; the window (and so every task and file request) waits for it.
  void fileAccessLoaded.then(() => { if (!quitting) createWindow() })
  updates.start()
  if (app.isPackaged) void runtimeService.autoStart()
  // Bundled components become available after their one-time unpacking finishes.
  // The first start after an install or update is cold (empty file caches, antivirus scanning the new files) and can
  // fail its checks; one more attempt follows, which then starts warm. Cancellation and a missing engine are final.
  const startGateway = (retry = true) => void gateway.start().then(result => { if (result?.state === 'healthy') confirmHealthy('gateway') }, error => {
    console.info('NAJD Gateway:', error.code)
    if (retry && !quitting && !['CANCELLED', 'NOT_INSTALLED', 'INCOMPATIBLE_RUNTIME'].includes(error.code)) { const again = setTimeout(() => { if (!quitting) startGateway(false) }, 5000); again.unref() }
  })
  if (bundleRuntime) void bundleRuntime.prepare().then(() => { void setupToolchain?.(); if (!quitting) startGateway() }, error => console.info('NAJD runtime:', error.code))
  else startGateway()
  // Gateway health: every 10 s while a NAJD window is on screen, every 60 s while all are hidden or minimized.
  // Any request still starts or re-checks the gateway through gateway.start(), so the state stays truthful.
  // One timer; a visibility change replaces the pending wait so a shown window is checked within 10 s.
  let healthCheckRunning = false
  const scheduleGatewayHealth = () => {
    clearTimeout(gatewayHealthTimer)
    if (quitting || healthCheckRunning) return
    const onScreen = BrowserWindow.getAllWindows().some(window => windowShown.get(window) && !window.isMinimized())
    gatewayHealthTimer = setTimeout(() => {
      healthCheckRunning = true
      void gateway.health().then(result => { if (result?.state === 'healthy') confirmHealthy('gateway-health') }, () => {}).finally(() => { healthCheckRunning = false; scheduleGatewayHealth() })
    }, onScreen ? 10000 : 60000)
    gatewayHealthTimer.unref()
  }
  rescheduleGatewayHealth = scheduleGatewayHealth
  scheduleGatewayHealth()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', event => {
  if (quitting) return
  event.preventDefault()
  quitting = true
  // A quit that blocks must still end: after 45 s the whole NAJD process tree is stopped (its own children only).
  createQuitWatchdog({ log: line => errorLog.record('quit', line), kill: () => { require('node:child_process').execFile(path.join(process.env.SystemRoot || 'C:/Windows', 'System32', 'taskkill.exe'), ['/PID', String(process.pid), '/T', '/F'], { windowsHide: true }, () => app.exit(0)) } }).start()
  backgroundMode?.dispose()
  clearTimeout(gatewayHealthTimer)
  const stopLearning = learning?.cancel()
  memoryService?.close()
  providers?.dispose(); chatGPT?.dispose()
  // Background work first, then the run and output stores are flushed so nothing written is lost.
  // Order matters (APR-017): background jobs stop, the core drains (receipts included), then the stores flush.
  const ordered = stopBackgroundJobs().catch(() => {}).then(() => core.shutdown()).catch(() => {})
    .then(() => Promise.allSettled([conversationOutputs.flush(), runReceipts.flush()]))
  void Promise.allSettled([ordered, updates?.dispose(), runtimeService?.shutdown(), hermesTools?.stop(), channels?.dispose(), stopLearning, mcpServers?.stopAll(), hermes.stop(), gateway?.stop(), windowsNode?.stop(), browserBridge?.stop()]).then(() => app.quit())
})
