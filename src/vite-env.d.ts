/// <reference types="vite/client" />

interface NajdTaskActivity {
  version: 1
  startedAt: string
  finishedAt: string | null
  events: {seq?: number; type: string; time: string; tool?: string; skill?: string; target?: string; detail?: string; decision?: 'ALLOW_ONCE' | 'DENY'}[]
}
interface NajdRuntimeStatus {
  state: string; component: string | null; downloaded: number; total: number; error: string | null
  canCancel: boolean; notPublished: boolean; bundled?: boolean; catalogVersion: string; components: string[]
  active: { generation: string; catalogVersion: string; components: string[] } | null
}
interface NajdActionRecovery {
  available: boolean
  actions: { id: string; operation: string; target: string; state: 'AWAITING_APPROVAL' | 'UNKNOWN_EFFECT'; updatedAt: string }[]
}

interface NajdTask {
  activity?: NajdTaskActivity
  unreadNotes?: string[]
  localOnlyOutput?: boolean
  lastSequence?: number
  reasoningEffort: NajdReasoningPreference | null
  id: string
  state: string
  output: string | null
  outputTruncated: boolean
  errorCode: string | null
  approvalId: string | null
  proposedTool: string | null
  proposedInput: { path?: string; query?: string; summary?: string; preview?: string; command?: string; cwd?: string } | null
  viaAgent?: boolean
  conversationId?: string | null
  receipt?: NajdRunReceipt | null
}
// Side panel data for one conversation (najd:agent:context).
interface NajdAgentContext {
  runs: (NajdRunReceipt & { runId: string; conversationId: string; state: string; at: number; provider: string | null; modelName: string | null; contextWindow: number | null })[]
  totals: { runs: number; input: number | null; output: number | null; total: number | null; cached: number | null; modelCalls: number; toolCalls: number; partial: boolean }
  outputs: { conversationId: string; runId: string | null; kind: string; path: string | null; libraryId: string | null; name: string; at: number }[]
  jobs: { jobId: string; conversationId: string | null; state: string; prompt: string | null; updatedAt: number; output: { path: string; libraryId: string | null } | null }[]
  profiles: { id: string; title: { ar: string; en: string }; toolsets: string[] }[]
  connections: { companion: { state: string } | null; mcp: { name: string; state: string }[] }
}
// Main-owned run receipt (agent platform M1): null token fields were not reported by the provider.
interface NajdRunUsage { input: number | null; output: number | null; total: number | null; cached: number | null; modelCalls: number; partial: boolean }
interface NajdRunReceipt {
  outcome: string; profile: string; toolsets: string[]; usage: NajdRunUsage; toolCalls: number
  request: { instructionsBytes: number | null; toolsBytes: number | null; turnBytes: number | null; historyBytes?: number | null; images: number } | null
}

interface NajdActivityEntry {
  time?: string
  action?: string
  decision?: string
  path?: string
  reason?: string
}

interface NajdMessage {
  attachments?: Pick<NajdAsset, 'id' | 'name'>[]
  activity?: NajdTaskActivity
  role: 'user' | 'assistant'
  text: string
  createdAt: string
}
interface NajdAsset {
  id: string
  name: string
  kind: 'text' | 'pdf' | 'docx' | 'xlsx' | 'pptx' | 'image' | 'video'
  origin?: 'attachment' | 'artifact'
  source?: string
  status: 'ready'
  size: number
  characters: number
  createdAt: string
}

interface NajdProject {
  id: string
  name: string
  instructions: string
  files: { id: string; name: string }[]
  folder: string | null
  createdAt: string
  updatedAt: string
  chats: string[]
}

interface NajdSessionSummary {
  id: string
  title: string
  updatedAt: string
  messageCount: number
}

interface NajdSessionSearchResult extends NajdSessionSummary {
  snippet: string
}

interface NajdSession extends Omit<NajdSessionSummary, 'messageCount'> {
  createdAt: string
  messages: NajdMessage[]
}

interface NajdBrowserStatus {
  active: boolean
  connected: boolean
  paired: boolean
  links?: { id: string; instance?: string; name: string; connected: boolean; lastSeenAt: string | null; createdAt: string | null }[]
  port?: number | null
  lastSeenAt?: string | null
  page?: { title: string; url: string } | null
  extensionPath?: string
}

interface NajdProviderPolicy {
  maxOutputTokens: number
  maxConcurrent: number
  timeoutMs: number
  maxInputChars: number
  maxCloudAttempts: number
}
interface NajdProviderLimits { policy: NajdProviderPolicy; cloudAttempts: number; activeRequests: number }

interface Window {
  najdSkills?: {
    list(): Promise<NajdInstructionSkill[]>
    setEnabled(id: string, enabled: boolean): Promise<void>
    install(url: string): Promise<NajdInstructionSkill[]>
    update(id: string): Promise<NajdInstructionSkill[]>
    remove(id: string): Promise<boolean>
  }
  najdRuntime?: {
    status(): Promise<NajdRuntimeStatus>
    prepare(): Promise<NajdRuntimeStatus>
    cancel(): Promise<boolean>
  }
  najdLibrary?: {
    list(): Promise<NajdAsset[]>
    import(): Promise<NajdAsset[]>
    search(query: string): Promise<{ id: string; name: string; offset: number; excerpt: string }[]>
    preview(id: string): Promise<{ text: string; hasMore: boolean }>
    remove(id: string): Promise<boolean>
    reveal(id: string): Promise<boolean>
    open?(id: string): Promise<boolean>
    importDropped(files: File[]): Promise<NajdAsset[]>
    importBytes(name: string, data: ArrayBuffer): Promise<NajdAsset>
    thumbnail(id: string): Promise<string | null>
  }
  najdPlugins?: {
    list(): Promise<NajdPluginInfo[]>
    commands(): Promise<NajdPluginCommand[]>
    search(query: string, market?: string): Promise<NajdPluginListing[]>
    preview(url: string): Promise<NajdPluginPlan>
    install(url: string, digest?: string): Promise<NajdPluginPlan & { installed: boolean }>
    remove(id: string): Promise<boolean>
    markets(): Promise<{ id: string; name: string; repo: string }[]>
    addMarket(repo: string): Promise<string>
    removeMarket(id: string): Promise<boolean>
  }
  najdChannels?: {
    status(): Promise<NajdChannelStatus>
    saveToken(token: string): Promise<NajdChannelStatus>
    clearToken(): Promise<NajdChannelStatus>
    configure(input: { enabled?: boolean; provider?: string | null; model?: string | null; accessMode?: 'ask' | 'approve' | 'full'; language?: 'ar' | 'en'; notify?: boolean }): Promise<NajdChannelStatus>
    pair(): Promise<{ code: string; expiresAt: string; botName?: string | null }>
    unpair(chatId: number): Promise<NajdChannelStatus>
    onSessionsChanged(listener: (entry: { sessionId: string }) => void): () => void
  }
  najdUnions?: { get(): Promise<NajdUnionConfig>; save(config: NajdUnionConfig): Promise<NajdUnionConfig> }
  najdAutomation?: boolean
  najdDiagnostics?: { export(): Promise<{ saved: boolean }> }
  najdLinks?: { open(name: 'community' | 'website' | 'author'): Promise<boolean> }
  najdUpdates?: {
    status(): Promise<NajdUpdateStatus>
    check(): Promise<NajdUpdateStatus>
    download(): Promise<NajdUpdateStatus>
    cancel(): Promise<NajdUpdateStatus>
    install(): Promise<NajdUpdateStatus>
    stability(): Promise<{ unstable: boolean; attempts: number; previousVersion: string | null; recoveryNote: string | null }>
    openReleases(): Promise<void>
  }
  najdMemoryGraph?: {
    status(): Promise<NajdMemoryGraphStatus>
    settings(input: Partial<NajdMemoryGraphStatus['settings']>): Promise<NajdMemoryGraphStatus>
    detail(uid: string): Promise<NajdMemoryDetail | null>
    setEnabled(uid: string, enabled: boolean): Promise<boolean>
    setScope(uid: string, scope: string): Promise<boolean>
    traces(): Promise<NajdMemoryTrace[]>
    rebuild(): Promise<{ rebuilt: number }>
    chats(input?: { query?: string; offset?: number; limit?: number }): Promise<{ total: number; matching: number; offset: number; rows: NajdMemoryChat[] }>
    setChatAllowed(id: string, allowed: boolean): Promise<{ id: string; allowed: boolean }>
  }
  najdGraph?: {
    memory(): Promise<NajdGraphData>
    tools(): Promise<NajdGraphData>
    usage(): Promise<NajdContextUsage[]>
  }
  najdLearning?: {
    list(): Promise<NajdLearningState>
    setSettings(settings: NajdLearningSettings): Promise<NajdLearningSettings>
    accept(kind: NajdLearningKind, id: string): Promise<unknown>
    reject(kind: NajdLearningKind, id: string): Promise<unknown>
    edit(kind: NajdLearningKind, input: { id: string; title: string; text: string }): Promise<NajdMemoryNote>
    remove(kind: NajdLearningKind, id: string): Promise<unknown>
    export(kind: NajdLearningKind): Promise<{ saved: boolean }>
    import(kind: NajdLearningKind): Promise<{ imported: boolean; count?: number }>
  }
  najdPersonality?: { get(): Promise<NajdPersonality>; save(input: NajdPersonality): Promise<NajdPersonality>; reset(): Promise<NajdPersonality> }
  najdMemory?: {
    list(): Promise<NajdMemoryNote[]>
    save(input: { id?: string; title: string; text: string }): Promise<NajdMemoryNote>
    remove(id: string): Promise<{ removed: boolean }>
    export(): Promise<{ saved: boolean }>
    import(): Promise<{ imported: boolean; count?: number }>
  }
  najdCapabilities?: {
    list(): Promise<NajdCapability[]>
    discoverSources(): Promise<NajdSkillSource[]>
    install(id: NajdCapabilityId): Promise<unknown>
    setEnabled(id: NajdCapabilityId, enabled: boolean): Promise<unknown>
    update(id: NajdCapabilityId): Promise<unknown>
    remove(id: NajdCapabilityId): Promise<unknown>
    run(id: NajdCapabilityId, input: { path?: string; query?: string }, intentId: string): Promise<NajdTask>
  }
  najdPack?: {
    status(): Promise<NajdPackStatus>
    install(): Promise<NajdPackStatus>
    cancel(): Promise<NajdPackStatus>
    check(): Promise<NajdPackStatus>
    remove(): Promise<NajdPackStatus>
  }
  najdMcp?: {
    list(): Promise<NajdConnector[]>
    connect(id: 'najd-windows-native'): Promise<NajdConnector>
    disconnect(id: 'najd-windows-native'): Promise<NajdConnector>
  }
  najdMcpServers?: {
    list(): Promise<NajdMcpServer[]>
    add(input: { name: string; command: string; args: string[]; cwd: string; env: Record<string, string> }): Promise<{ status: 'added' | 'cancelled'; server?: NajdMcpServer }>
    remove(id: string): Promise<unknown>
    connect(id: string): Promise<NajdMcpServer>
    disconnect(id: string): Promise<NajdMcpServer>
    pickCommand(): Promise<string | null>
    programs(): Promise<{ npx: boolean; uvx: boolean }>
  }
  najdAppearance?: { setScale(scale: number): void }
  // Main-process window state (minimized or hidden), pushed on change.
  najdWindow?: { isHidden(): boolean; onHiddenChange(listener: () => void): () => void }
  najdKnowledge?: {
    list(): Promise<NajdKnowledgeBase[]>; create(name: string, description: string): Promise<NajdKnowledgeBase>
    update(id: string, input: { name?: string; description?: string }): Promise<NajdKnowledgeBase>; remove(id: string): Promise<{ status: string }>
    addFiles(id: string): Promise<{ base: NajdKnowledgeBase; added: number; failed: { name: string; error: string }[] } | null>
    removeItem(id: string, assetId: string): Promise<NajdKnowledgeBase>
  }
  najdAgent?: { onTaskChanged?(listener: (taskId: string, sequence: number) => void): () => void; context(conversationId: string): Promise<NajdAgentContext>; tools?(): Promise<NajdAgentTool[]>; toolsets?(): Promise<Record<string, boolean>>; profiles?(): Promise<{ id: string; title: { ar: string; en: string }; toolsets: string[] }[]>; openOutput?(conversationId: string, filePath: string, mode: 'open' | 'reveal'): Promise<boolean> }
  najdAccounts?: { list(): Promise<NajdAccount[]>; add(input: { label: string; siteUrl: string; username: string; password: string; autoLogin: boolean }): Promise<NajdAccount>; setAutoLogin(id: string, enabled: boolean): Promise<NajdAccount>; remove(id: string): Promise<boolean>; pending(): Promise<NajdAccount[]>; retry(): Promise<NajdAccount[]>; acknowledge(id: string): Promise<NajdAccount[]> }
  najdAbout?: { notices(): Promise<{ version: string; text: string }> }
  najdGateway?: {
    status(): Promise<NajdGatewayStatus>
    start(): Promise<NajdGatewayStatus>
    stop(): Promise<NajdGatewayStatus>
  }
  najdProviders?: {
    limits(): Promise<NajdProviderLimits>
    setLimits(policy: NajdProviderPolicy): Promise<NajdProviderLimits>
    catalog(): Promise<NajdProvider[]>
    models(id: NajdProviderId): Promise<NajdProviderModel[]>
    saveKey(id: NajdProviderId, key: string): Promise<unknown>
    setEndpoint(id: NajdProviderId, url: string): Promise<{ endpoint: string }>
    detectLocal(): Promise<{ id: string; name: string; endpoint: string }[]>
    clearKey(id: NajdProviderId): Promise<unknown>
    testModel(id: NajdProviderId, model: string): Promise<{ verified: boolean }>
    previewReasoning(id: NajdProviderId, model: string, text: string, preference: NajdReasoningPreference): Promise<NajdReasoningPreference | null>
    openConsole(id: NajdProviderId): Promise<void>
  }
  najdProjects?: {
    list(): Promise<NajdProject[]>
    save(input: { id?: string; name: string; instructions: string }): Promise<NajdProject>
    remove(id: string): Promise<boolean>
    assign(chatId: string, projectId: string | null): Promise<string | null>
    setFiles(id: string, assetIds: string[]): Promise<NajdProject>
    chooseFolder(id: string): Promise<NajdProject>
    clearFolder(id: string): Promise<NajdProject>
  }
  najdSessions?: {
    list(): Promise<NajdSessionSummary[]>
    search(query: string): Promise<NajdSessionSearchResult[]>
    get(id: string): Promise<NajdSession>
    create(): Promise<NajdSession>
    append(id: string, role: NajdMessage['role'], text: string, taskId?: string, assetIds?: string[]): Promise<NajdSession>
    delete(id: string): Promise<boolean>
    export(id: string): Promise<{ saved: boolean }>
    saveBlock(input: { text: string; extension: string; name?: string }): Promise<{ saved: boolean; name?: string }>
    openFile?(input: { path: string; mode: 'open' | 'reveal' }): Promise<{ opened: boolean }>
  }
  najdCore?: {
    recovery?(): Promise<NajdActionRecovery>
    reconcileAction?(id: string, resolution: 'done' | 'not-done' | 'dismiss'): Promise<{ id: string; state: string }>
    startTask(text: string, intentId: string, provider?: NajdProviderId, modelName?: string, history?: Pick<NajdMessage, 'role' | 'text'>[], reasoningEffort?: NajdReasoningPreference, assetIds?: string[], conversationId?: string, profile?: string, accessMode?: 'ask' | 'approve' | 'full', browserContext?: { title: string; url: string; selection: string }, askId?: string): Promise<NajdTask>
    getTask(taskId: string): Promise<NajdTask>
    respondApproval?(approvalId: string, decision: 'ALLOW_ONCE' | 'ALLOW_TASK' | 'DENY'): Promise<NajdTask>
    cancelTask?(taskId: string): Promise<NajdTask>
    addNote?(taskId: string, text: string): Promise<NajdTask>
  }
  najdModels?: {
    list(): Promise<string[]>
  }
  najdKimi?: {
    status(): Promise<{ saved: boolean }>
    saveKey(key: string): Promise<{ saved: boolean }>
    clearKey(): Promise<{ saved: boolean }>
    testModel(modelName: string): Promise<{ verified: boolean }>
  }
  najdChatGPT?: {
    status(): Promise<NajdChatGPTStatus>
    start(accountId?: string | null): Promise<NajdChatGPTStatus>
    cancel(): Promise<NajdChatGPTStatus>
    select(accountId: string): Promise<NajdChatGPTStatus>
    signOut(accountId: string): Promise<NajdChatGPTStatus>
    models(): Promise<{ id: string; label: string }[]>
    testModel(modelName: string): Promise<{ verified: boolean }>
  }
  najdProviderPages?: { open(page: 'chatgpt-usage' | 'kimi-console'): Promise<void> }
  najdBrowser?: {
    status(): Promise<NajdBrowserStatus>
    pairingCode(): Promise<string | null>
    unpair(id?: string, instance?: string): Promise<NajdBrowserStatus>
    rotateCode(): Promise<string | null>
    openDemo(language: 'ar' | 'en'): Promise<void>
    onAsk(listener: (ask: { id: string; text: string; page: { url: string; title: string; selection: string } | null }) => void): () => void
    activeAsks(): Promise<{ askId: string; taskId: string }[]>
    askSaved(taskId: string): Promise<boolean>
    onAskCancelled(listener: (value: { id: string; taskId: string | null }) => void): () => void
    askUpdate(id: string, patch: { state?: 'queued' | 'running' | 'waiting_approval' | 'done' | 'failed' | 'cancelled'; taskId?: string; progress?: string; output?: string; needsApproval?: boolean }): Promise<boolean>
  }
  najdFiles?: {
    grantRoot(): Promise<string[]>
    listRoots(): Promise<string[]>
    revokeRoot(root: string): Promise<string[]>
    activity(): Promise<NajdActivityEntry[]>
    wholeComputer?(enabled?: boolean): Promise<{ wholeComputer: boolean; drives: string[] }>
  }
}

interface NajdGatewayStatus {
  engine: 'openclaw'
  state: 'not_installed' | 'preparing' | 'starting' | 'healthy' | 'degraded' | 'stopping' | 'stopped' | 'failed'
  version: string
  instanceId: string | null
  verifiedAt: string | null
  errorCode: string | null
}

interface NajdChatGPTStatus {
  verified?: boolean
  verifiedModel?: string | null
  signingIn: boolean
  activeId: string | null
  signedIn: boolean
  accounts: { id: string; label: string; signedIn: boolean }[]
  errorCode: string | null
  revocationConfirmed: boolean | null
}

interface NajdPluginServer { name: string; kind: 'stdio' | 'remote'; command?: string; args?: string[]; envNames?: string[]; url?: string }
interface NajdPluginPlan { id: string; name: string; description: string; version: string; author: string; skillCount: number; commands: { command: string; description: string; hint: string }[]; servers: NajdPluginServer[]; unsupported: string[]; sourceUrl: string; sourceLabel: string; digest: string }
interface NajdPluginInfo { id: string; name: string; description: string; version: string; author: string; sourceLabel: string; installedAt: string; skills: number; commands: number; servers: NajdPluginServer[]; unsupported: string[] }
interface NajdPluginCommand { plugin: string; pluginName: string; command: string; description: string; hint: string; body: string }
interface NajdPluginListing { market: string; name: string; description: string; category: string; author: string; homepage: string; sourceUrl: string | null }
interface NajdChannelStatus { tokenSaved: boolean; enabled: boolean; state: 'stopped' | 'starting' | 'running' | 'error'; errorCode: string | null; botName: string | null; provider: string | null; model: string | null; accessMode: 'ask' | 'approve' | 'full'; language: 'ar' | 'en'; notify: boolean; allowed: { chatId: number; name: string; pairedAt: string }[]; pairing: { code: string; expiresAt: string } | null }
interface NajdUnionMember { provider: string; model: string; enabled?: boolean }
interface NajdUnionPreset { label?: string; enabled: boolean; references: NajdUnionMember[]; aggregator: { provider: string; model: string } }
interface NajdUnionConfig { default: string | null; presets: Record<string, NajdUnionPreset> }
type NajdProviderId = string   // the catalog grows (see electron/provider-catalog.json); ids are validated in the main process
type NajdReasoningPreference = 'auto' | 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'
interface NajdProvider {
  id: NajdProviderId
  name: string
  kind: 'subscription' | 'api' | 'local' | 'union'
  auth: 'browser' | 'key' | 'optional-key' | 'local' | 'union'
  keyHint: string
  editableUrl?: boolean
  endpoint?: string
  defaultEndpoint?: string
  keySaved?: boolean
  configured: boolean
  verified: boolean
  verifiedModel: string | null
  errorCode: string | null
  accountId?: string | null
}
interface NajdPackStatus {
  state: 'unknown' | 'not-installed' | 'ready' | 'incompatible' | 'damaged'
  reason?: 'lock' | 'engine'
  installing?: 'downloading' | 'verifying'
  lastError?: string
  packages?: { name: string; version: string; license: string | null }[]
  sizeBytes?: number
  installedAt?: string
  packageCount: number
  cleanupPending: boolean
}
interface NajdProviderModel { id: string; label: string; contextWindow?: number | null; efforts: NajdReasoningPreference[] }

type NajdCapabilityId = 'najd-read-document' | 'najd-find-documents' | 'najd-list-apps'
interface NajdInstructionSkill {
  id: string; name: string; description: string; source: string
  external?: boolean; compatibility?: 'instructions-only' | 'needs-runtime' | 'platform-mismatch'; note?: string; sourceUrl?: string
  sourceRevision: string | null; relativePath: string; digest: string; license: string; builtIn?: boolean; author?: string | null
  platforms: string[] | null; enabled: boolean; mode: 'instructions'; dependenciesReady: false
}
interface NajdAccount { id: string; label: string; host: string; username: string; autoLogin: boolean; authorizedAt: string; lastUsedAt: string | null; unresolved?: boolean }
interface NajdAgentTool { name: string; description: string; ready: boolean; reason: string | null; effect: string; group: string; server?: string }
interface NajdMemoryNote { id: string; title: string; text: string; createdAt: string; updatedAt: string }
interface NajdPersonality { enabled: boolean; name: string; instructions: string }
type NajdLearningKind = 'preference' | 'experience'
interface NajdLearningSettings { mode: 'off' | 'review' | 'preferences'; sharePreferences: boolean; shareExperiences: boolean }
interface NajdLearningState {
  settings: NajdLearningSettings; state: 'idle' | 'reviewing' | 'failed'
  pending: Record<NajdLearningKind, NajdMemoryNote[]>
  approved: Record<NajdLearningKind, NajdMemoryNote[]>
}
interface NajdCapability {
  id: NajdCapabilityId; title: string; description: string; version: string; digest: string
  permission: string; source: string; tool: string
  installed: boolean; enabled: boolean; updateRequired: boolean
}
interface NajdSkillSource {
  source: string; sourceRevision: string; limited: boolean
  skills: {
    name: string; description: string | null; relativePath: string; digest: string
    declaredVersion: string | null; declaredAuthor: string | null; declaredLicense: string | null
    platforms: string[] | null; format: string; compatibility: string
    installable: false; executable: false
  }[]
}
interface NajdMcpServer {
  id: string; name: string; commandLine: string; cwd: string | null; envNames: string[]; enabled: boolean
  state: 'disconnected' | 'connecting' | 'connected' | 'failed'; error: string | null
  serverInfo: { name: string; version: string; protocolVersion: string } | null
  tools: { name: string; title: string; description: string; hints: { readOnly: boolean; destructive: boolean; openWorld: boolean } }[]
}

interface NajdConnector {
  id: 'najd-windows-native'
  state: 'disconnected' | 'connecting' | 'connected' | 'disconnecting' | 'failed'
  transport: string; source: string; sourceRevision: string
  protocolVersion: string | null; tools: string[]; executableConfigurable: false
}

interface NajdUpdateStatus {
  state: 'disabled' | 'idle' | 'checking' | 'current' | 'available' | 'manual' | 'downloading' | 'ready' | 'installing' | 'error' | 'cancelled'
  currentVersion: string; version: string | null; notes: string; channel: string; percent: number; errorCode: string | null; checkedAt: string | null
}

type NajdKnowledgeBase = { id: string; name: string; description: string; createdAt: string; updatedAt: string; items: { id: string; name: string; kind: string; characters: number }[] }

interface NajdMemoryDetail { uid: string; source: string; kind: string; scope: string; enabled: boolean; sensitive: boolean; origin: string; createdAt: string; updatedAt: string; entities: string[]; conflicts: number }
interface NajdMemoryChat { id: string; title: string; messageCount: number; updatedAt: string; allowed: boolean }
interface NajdMemoryTrace { id: number; at: string; session_id: string | null; engine: string; budget_tokens: number; tokens: number; ms: number; query_len: number; items: Array<{ id: string; kind: string; source: string; title: string; reason: string; score: number; tokens: number }> }
interface NajdMemoryGraphStatus { engine: string; graphReady: boolean; error: string | null; settings: { engine: 'graph' | 'legacy'; shareNotes: boolean; shareChats: boolean }; stats: Record<string, number> | null; migration: { expected: number; stored: number; backup: string } | null }
interface NajdGraphNode { id: string; type: 'note' | 'star' | 'soul' | 'section' | 'toolset'; label: string; weight: number; noteId?: string; kind?: string; source?: string; text?: string; starType?: string
  updatedAt?: string | null; createdAt?: string; uid?: string; scope?: string; sensitive?: boolean; origin?: string; enabled?: boolean; tools?: number; toolNames?: string[]; loadable?: boolean; start?: boolean; ready?: boolean; profiles?: string[] }
interface NajdGraphEdge { from: string; to: string; kind: string; weight: number }
interface NajdGraphData { nodes: NajdGraphNode[]; edges: NajdGraphEdge[]; stats: Record<string, number>; degraded?: boolean }
interface NajdContextUsage { at: string; tier: string; windowTokens: number | null; profile: string; tools: number; instructions: number; toolDefinitions: number; history: number; taskSoFar: number
  condensed: number; total: number; percent: number | null }
