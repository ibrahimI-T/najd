const { contextBridge, ipcRenderer, webFrame, webUtils } = require('electron')
contextBridge.exposeInMainWorld('najdUpdates', {
  status: () => ipcRenderer.invoke('najd:updates:status'),
  check: () => ipcRenderer.invoke('najd:updates:check'),
  download: () => ipcRenderer.invoke('najd:updates:download'),
  cancel: () => ipcRenderer.invoke('najd:updates:cancel'),
  install: () => ipcRenderer.invoke('najd:updates:install'),
  stability: () => ipcRenderer.invoke('najd:updates:stability'),
  openReleases: () => ipcRenderer.invoke('najd:updates:releases')
})
// Workstation services (electron/workstation/ipc.cjs): one narrow request per operation, no generic channel.
const wsListener = (channel, listener) => { const handler = (_event, value) => listener(value); ipcRenderer.on(channel, handler); return () => ipcRenderer.removeListener(channel, handler) }
contextBridge.exposeInMainWorld('najdWorkstation', {
  catalog: (...args) => ipcRenderer.invoke('najd:ws:catalog', ...args),
  sync: (...args) => ipcRenderer.invoke('najd:ws:sync', ...args),
  addSource: (...args) => ipcRenderer.invoke('najd:ws:addSource', ...args),
  removeSource: (...args) => ipcRenderer.invoke('najd:ws:removeSource', ...args),
  setBuiltinEnabled: (...args) => ipcRenderer.invoke('najd:ws:setBuiltinEnabled', ...args),
  planFile: (...args) => ipcRenderer.invoke('najd:ws:planFile', ...args),
  planUrl: (...args) => ipcRenderer.invoke('najd:ws:planUrl', ...args),
  install: (...args) => ipcRenderer.invoke('najd:ws:install', ...args),
  localPackages: (...args) => ipcRenderer.invoke('najd:ws:localPackages', ...args),
  planLocal: (...args) => ipcRenderer.invoke('najd:ws:planLocal', ...args),
  installLocal: (...args) => ipcRenderer.invoke('najd:ws:installLocal', ...args),
  setPackageEnabled: (...args) => ipcRenderer.invoke('najd:ws:setPackageEnabled', ...args),
  connectPackageMcp: (...args) => ipcRenderer.invoke('najd:ws:connectPackageMcp', ...args),
  rollback: (...args) => ipcRenderer.invoke('najd:ws:rollback', ...args),
  skillEditable: id => ipcRenderer.invoke('najd:ws:skillEditable', id),
  skillEdit: (id, description, steps) => ipcRenderer.invoke('najd:ws:skillEdit', id, description, steps),
  removePackage: (...args) => ipcRenderer.invoke('najd:ws:removePackage', ...args),
  openSkillsFolder: (...args) => ipcRenderer.invoke('najd:ws:openSkillsFolder', ...args),
  skillGuide: (...args) => ipcRenderer.invoke('najd:ws:skillGuide', ...args),
  tasks: (...args) => ipcRenderer.invoke('najd:ws:tasks', ...args),
  taskCreate: (...args) => ipcRenderer.invoke('najd:ws:taskCreate', ...args),
  taskUpdate: (...args) => ipcRenderer.invoke('najd:ws:taskUpdate', ...args),
  taskStatus: (...args) => ipcRenderer.invoke('najd:ws:taskStatus', ...args),
  taskRemove: (...args) => ipcRenderer.invoke('najd:ws:taskRemove', ...args),
  taskRun: (...args) => ipcRenderer.invoke('najd:ws:taskRun', ...args),
  remote: (...args) => ipcRenderer.invoke('najd:ws:remote', ...args),
  remoteConfigure: (...args) => ipcRenderer.invoke('najd:ws:remoteConfigure', ...args),
  remotePair: (...args) => ipcRenderer.invoke('najd:ws:remotePair', ...args),
  remoteRevoke: (...args) => ipcRenderer.invoke('najd:ws:remoteRevoke', ...args),
  tabs: (...args) => ipcRenderer.invoke('najd:ws:tabs', ...args),
  tabOpen: (...args) => ipcRenderer.invoke('najd:ws:tabOpen', ...args),
  tabClose: (...args) => ipcRenderer.invoke('najd:ws:tabClose', ...args),
  tabNavigate: (...args) => ipcRenderer.invoke('najd:ws:tabNavigate', ...args),
  tabBack: (...args) => ipcRenderer.invoke('najd:ws:tabBack', ...args),
  tabForward: (...args) => ipcRenderer.invoke('najd:ws:tabForward', ...args),
  tabReload: (...args) => ipcRenderer.invoke('najd:ws:tabReload', ...args),
  tabShow: (...args) => ipcRenderer.invoke('najd:ws:tabShow', ...args),
  tabRead: (...args) => ipcRenderer.invoke('najd:ws:tabRead', ...args),
  tabWebMcp: (...args) => ipcRenderer.invoke('najd:ws:tabWebMcp', ...args),
  system: (...args) => ipcRenderer.invoke('najd:ws:system', ...args),
  systemSet: (...args) => ipcRenderer.invoke('najd:ws:systemSet', ...args),
  documents: (...args) => ipcRenderer.invoke('najd:ws:documents', ...args),
  documentSave: (...args) => ipcRenderer.invoke('najd:ws:documentSave', ...args),
  documentRemove: (...args) => ipcRenderer.invoke('najd:ws:documentRemove', ...args),
  onChanged: listener => wsListener('najd:workstation:changed', listener),
  onTabs: listener => wsListener('najd:workstation:tabs', listener),
  onRemote: listener => wsListener('najd:workstation:remote', listener)
})
contextBridge.exposeInMainWorld('najdLinks', { open: name => ipcRenderer.invoke('najd:links:open', name) })

contextBridge.exposeInMainWorld('najdUnions', { get: () => ipcRenderer.invoke('najd:unions:get'), save: config => ipcRenderer.invoke('najd:unions:save', config) })
contextBridge.exposeInMainWorld('najdPlugins', {
  list: () => ipcRenderer.invoke('najd:plugins:list'), commands: () => ipcRenderer.invoke('najd:plugins:commands'),
  search: (query, market) => ipcRenderer.invoke('najd:plugins:search', query, market), preview: url => ipcRenderer.invoke('najd:plugins:preview', url),
  install: (url, digest) => ipcRenderer.invoke('najd:plugins:install', url, digest), remove: id => ipcRenderer.invoke('najd:plugins:remove', id),
  markets: () => ipcRenderer.invoke('najd:plugins:markets'), addMarket: repo => ipcRenderer.invoke('najd:plugins:addMarket', repo), removeMarket: id => ipcRenderer.invoke('najd:plugins:removeMarket', id)
})
contextBridge.exposeInMainWorld('najdChannels', {
  status: () => ipcRenderer.invoke('najd:channels:status'), saveToken: token => ipcRenderer.invoke('najd:channels:saveToken', token), clearToken: () => ipcRenderer.invoke('najd:channels:clearToken'),
  configure: input => ipcRenderer.invoke('najd:channels:configure', input), pair: () => ipcRenderer.invoke('najd:channels:pair'), unpair: chatId => ipcRenderer.invoke('najd:channels:unpair', chatId),
  onSessionsChanged: listener => { const handler = (_event, entry) => listener(entry); ipcRenderer.on('najd:sessions:changed', handler); return () => ipcRenderer.removeListener('najd:sessions:changed', handler) }
})
// True when an automated run drives the window (remote debugging): the first-run welcome stays out of the way unless a test asks for it.
contextBridge.exposeInMainWorld('najdAutomation', process.argv.includes('--najd-automation'))
contextBridge.exposeInMainWorld('najdDiagnostics', { export: () => ipcRenderer.invoke('najd:diagnostics:export') })
contextBridge.exposeInMainWorld('najdVoice', { status: () => ipcRenderer.invoke('najd:voice:status'), transcribe: (audio, mime, seconds) => ipcRenderer.invoke('najd:voice:transcribe', audio, mime, seconds) })

// Window minimized/hidden state pushed by main (document visibility alone can stay "visible" when minimized).
let windowHidden = false
const hiddenListeners = new Set()
ipcRenderer.on('najd:window:hidden', (_event, value) => {
  windowHidden = value === true
  for (const listener of [...hiddenListeners]) { try { listener() } catch {} }
})
contextBridge.exposeInMainWorld('najdWindow', {
  isHidden: () => windowHidden,
  onHiddenChange: listener => {
    if (typeof listener !== 'function') return () => {}
    hiddenListeners.add(listener)
    return () => { hiddenListeners.delete(listener) }
  }
})

// Task change notifications pushed by main (ids only); the renderer fetches the snapshot itself.
const taskListeners = new Set()
ipcRenderer.on('najd:task:changed', (_event, value) => {
  if (!value || typeof value !== 'object' || typeof value.taskId !== 'string' || !/^[0-9a-f-]{36}$/.test(value.taskId) || !Number.isSafeInteger(value.sequence)) return
  for (const listener of [...taskListeners]) { try { listener(value.taskId, value.sequence) } catch {} }
})

contextBridge.exposeInMainWorld('najdAgent', {
  onTaskChanged: listener => {
    if (typeof listener !== 'function') return () => {}
    taskListeners.add(listener)
    return () => { taskListeners.delete(listener) }
  },
  context: conversationId => ipcRenderer.invoke('najd:agent:context', conversationId),
  tools: () => ipcRenderer.invoke('najd:agent:tools'),
  profiles: () => ipcRenderer.invoke('najd:agent:profiles'),
  toolsets: () => ipcRenderer.invoke('najd:agent:toolsets'),
  openOutput: (conversationId, filePath, mode) => ipcRenderer.invoke('najd:outputs:open', conversationId, filePath, mode),
  previewOutput: (conversationId, filePath) => ipcRenderer.invoke('najd:outputs:preview', conversationId, filePath)
})

// Knowledge bases (R-057): named collections of library documents NAJD searches and cites.
contextBridge.exposeInMainWorld('najdKnowledge', {
  list: () => ipcRenderer.invoke('najd:kb:list'),
  create: (name, description) => ipcRenderer.invoke('najd:kb:create', name, description),
  update: (id, input) => ipcRenderer.invoke('najd:kb:update', id, input),
  remove: id => ipcRenderer.invoke('najd:kb:remove', id),
  addFiles: id => ipcRenderer.invoke('najd:kb:addFiles', id),
  removeItem: (id, assetId) => ipcRenderer.invoke('najd:kb:removeItem', id, assetId)
})

contextBridge.exposeInMainWorld('najdRuntime', {
  status: () => ipcRenderer.invoke('najd:runtime:status'),
  prepare: () => ipcRenderer.invoke('najd:runtime:prepare'),
  cancel: () => ipcRenderer.invoke('najd:runtime:cancel')
})

contextBridge.exposeInMainWorld('najdCapabilities', {
  list: () => ipcRenderer.invoke('najd:capabilities:list'),
  discoverSources: () => ipcRenderer.invoke('najd:capabilities:sources'),
  install: id => ipcRenderer.invoke('najd:capabilities:install', id),
  setEnabled: (id, enabled) => ipcRenderer.invoke('najd:capabilities:enable', id, enabled),
  update: id => ipcRenderer.invoke('najd:capabilities:update', id),
  remove: id => ipcRenderer.invoke('najd:capabilities:remove', id),
  run: (id, input, intentId) => ipcRenderer.invoke('najd:capabilities:run', id, input, intentId)
})
contextBridge.exposeInMainWorld('najdMemory', {
  list: () => ipcRenderer.invoke('najd:memory:list'),
  save: input => ipcRenderer.invoke('najd:memory:save', input),
  remove: id => ipcRenderer.invoke('najd:memory:remove', id),
  export: () => ipcRenderer.invoke('najd:memory:export'),
  import: () => ipcRenderer.invoke('najd:memory:import')
})
contextBridge.exposeInMainWorld('najdPersonality', {
  get: () => ipcRenderer.invoke('najd:personality:get'),
  save: input => ipcRenderer.invoke('najd:personality:save', input),
  reset: () => ipcRenderer.invoke('najd:personality:reset')
})
contextBridge.exposeInMainWorld('najdMemoryGraph', {
  status: () => ipcRenderer.invoke('najd:memorygraph:status'),
  settings: input => ipcRenderer.invoke('najd:memorygraph:settings', input),
  detail: uid => ipcRenderer.invoke('najd:memorygraph:detail', uid),
  setEnabled: (uid, enabled) => ipcRenderer.invoke('najd:memorygraph:enabled', uid, enabled),
  setScope: (uid, scope) => ipcRenderer.invoke('najd:memorygraph:scope', uid, scope),
  traces: () => ipcRenderer.invoke('najd:memorygraph:traces'),
  rebuild: () => ipcRenderer.invoke('najd:memorygraph:rebuild'),
  chats: input => ipcRenderer.invoke('najd:memorygraph:chats', input),
  setChatAllowed: (id, allowed) => ipcRenderer.invoke('najd:memorygraph:chatallowed', id, allowed)
})
contextBridge.exposeInMainWorld('najdGraph', {
  memory: () => ipcRenderer.invoke('najd:graph:memory'),
  tools: () => ipcRenderer.invoke('najd:graph:tools'),
  usage: () => ipcRenderer.invoke('najd:graph:usage')
})
contextBridge.exposeInMainWorld('najdLearning', {
  list: () => ipcRenderer.invoke('najd:learning:list'),
  setSettings: input => ipcRenderer.invoke('najd:learning:settings', input),
  accept: (kind, id) => ipcRenderer.invoke('najd:learning:accept', kind, id),
  reject: (kind, id) => ipcRenderer.invoke('najd:learning:reject', kind, id),
  edit: (kind, input) => ipcRenderer.invoke('najd:learning:edit', kind, input),
  remove: (kind, id) => ipcRenderer.invoke('najd:learning:remove', kind, id),
  export: kind => ipcRenderer.invoke('najd:learning:export', kind),
  import: kind => ipcRenderer.invoke('najd:learning:import', kind)
})
contextBridge.exposeInMainWorld('najdMcp', {
  list: () => ipcRenderer.invoke('najd:mcp:list'),
  connect: id => ipcRenderer.invoke('najd:mcp:connect', id),
  disconnect: id => ipcRenderer.invoke('najd:mcp:disconnect', id)
})
// The Office and design pack (M3): no arguments cross from the renderer.
contextBridge.exposeInMainWorld('najdPack', {
  status: () => ipcRenderer.invoke('najd:pack:status'),
  install: () => ipcRenderer.invoke('najd:pack:install'),
  cancel: () => ipcRenderer.invoke('najd:pack:cancel'),
  check: () => ipcRenderer.invoke('najd:pack:check'),
  remove: () => ipcRenderer.invoke('najd:pack:remove')
})
contextBridge.exposeInMainWorld('najdMcpServers', {
  list: () => ipcRenderer.invoke('najd:mcp-servers:list'),
  add: input => ipcRenderer.invoke('najd:mcp-servers:add', input),
  remove: id => ipcRenderer.invoke('najd:mcp-servers:remove', id),
  connect: id => ipcRenderer.invoke('najd:mcp-servers:connect', id),
  signIn: id => ipcRenderer.invoke('najd:mcp-servers:signin', id),
  disconnect: id => ipcRenderer.invoke('najd:mcp-servers:disconnect', id),
  pickCommand: () => ipcRenderer.invoke('najd:mcp-servers:pick-command'),
  programs: () => ipcRenderer.invoke('najd:mcp-servers:programs')
})
contextBridge.exposeInMainWorld('najdSkills', {
  list: () => ipcRenderer.invoke('najd:skills:list'),
  setEnabled: (id, enabled) => ipcRenderer.invoke('najd:skills:enable', id, enabled),
  install: url => ipcRenderer.invoke('najd:skills:install', url),
  update: id => ipcRenderer.invoke('najd:skills:update', id),
  remove: id => ipcRenderer.invoke('najd:skills:remove', id)
})

contextBridge.exposeInMainWorld('najdAppearance', {
  setScale: scale => { if ([0.8, 0.9, 1, 1.1, 1.25, 1.5].includes(scale)) webFrame.setZoomFactor(scale) }
})
contextBridge.exposeInMainWorld('najdAbout', {
  notices: () => ipcRenderer.invoke('najd:about:notices')
})

contextBridge.exposeInMainWorld('najdGateway', {
  status: () => ipcRenderer.invoke('najd:gateway:status'),
  start: () => ipcRenderer.invoke('najd:gateway:start'),
  stop: () => ipcRenderer.invoke('najd:gateway:stop'),
  repair: () => ipcRenderer.invoke('najd:gateway:repair')
})

contextBridge.exposeInMainWorld('najdCore', {
  recovery: () => ipcRenderer.invoke('najd:actions:recovery'),
  reconcileAction: (id, resolution) => ipcRenderer.invoke('najd:actions:reconcile', id, resolution),
  startTask: (text, intentId, provider, modelName, history, reasoningEffort, assetIds, conversationId, profile, accessMode, browserContext, askId) => ipcRenderer.invoke('najd:task:start', { text, intentId, provider, modelName, history, reasoningEffort, assetIds,
    ...(browserContext ? { browserContext } : {}), ...(typeof askId === 'string' ? { askId } : {}),
    ...(conversationId ? { conversationId } : {}), ...(profile ? { profile } : {}), ...(accessMode && accessMode !== 'ask' ? { accessMode } : {}) }),
  getTask: taskId => ipcRenderer.invoke('najd:task:get', taskId),
  respondApproval: (approvalId, decision) => ipcRenderer.invoke('najd:task:respond', approvalId, decision),
  cancelTask: taskId => ipcRenderer.invoke('najd:task:cancel', taskId),
  addNote: (taskId, text) => ipcRenderer.invoke('najd:task:addNote', taskId, text)
})

contextBridge.exposeInMainWorld('najdProviders', {
  limits: () => ipcRenderer.invoke('najd:providers:limits'),
  setLimits: policy => ipcRenderer.invoke('najd:providers:setLimits', policy),
  catalog: () => ipcRenderer.invoke('najd:providers:catalog'),
  models: id => ipcRenderer.invoke('najd:providers:models', id),
  saveKey: (id, key) => ipcRenderer.invoke('najd:providers:save', id, key),
  setEndpoint: (id, url) => ipcRenderer.invoke('najd:providers:setEndpoint', id, url),
  detectLocal: () => ipcRenderer.invoke('najd:providers:detectLocal'),
  clearKey: id => ipcRenderer.invoke('najd:providers:clear', id),
  testModel: (id, model) => ipcRenderer.invoke('najd:providers:test', id, model),
  previewReasoning: (id, model, text, preference) => ipcRenderer.invoke('najd:providers:reasoning', id, model, text, preference),
  openConsole: id => ipcRenderer.invoke('najd:providers:console', id)
})

contextBridge.exposeInMainWorld('najdModels', {
  list: () => ipcRenderer.invoke('najd:model:list')
})

contextBridge.exposeInMainWorld('najdKimi', {
  status: () => ipcRenderer.invoke('najd:kimi:status'),
  saveKey: key => ipcRenderer.invoke('najd:kimi:save', key),
  clearKey: () => ipcRenderer.invoke('najd:kimi:clear'),
  testModel: modelName => ipcRenderer.invoke('najd:kimi:test', modelName)
})

contextBridge.exposeInMainWorld('najdChatGPT', {
  status: () => ipcRenderer.invoke('najd:chatgpt:status'),
  start: accountId => ipcRenderer.invoke('najd:chatgpt:start', accountId ?? null),
  cancel: () => ipcRenderer.invoke('najd:chatgpt:cancel'),
  select: accountId => ipcRenderer.invoke('najd:chatgpt:select', accountId),
  signOut: accountId => ipcRenderer.invoke('najd:chatgpt:signOut', accountId),
  models: () => ipcRenderer.invoke('najd:chatgpt:models'),
  testModel: modelName => ipcRenderer.invoke('najd:chatgpt:test', modelName)
})

contextBridge.exposeInMainWorld('najdProviderPages', {
  open: page => ipcRenderer.invoke('najd:provider:page', page)
})

contextBridge.exposeInMainWorld('najdProjects', {
  list: () => ipcRenderer.invoke('najd:projects:list'),
  save: input => ipcRenderer.invoke('najd:projects:save', input),
  remove: id => ipcRenderer.invoke('najd:projects:remove', id),
  assign: (chatId, projectId) => ipcRenderer.invoke('najd:projects:assign', chatId, projectId),
  setFiles: (id, assetIds) => ipcRenderer.invoke('najd:projects:setFiles', id, assetIds),
  chooseFolder: id => ipcRenderer.invoke('najd:projects:chooseFolder', id),
  clearFolder: id => ipcRenderer.invoke('najd:projects:clearFolder', id)
})
contextBridge.exposeInMainWorld('najdSessions', {
  list: () => ipcRenderer.invoke('najd:session:list'),
  search: query => ipcRenderer.invoke('najd:session:search', query),
  get: id => ipcRenderer.invoke('najd:session:get', id),
  create: () => ipcRenderer.invoke('najd:session:create'),
  append: (id, role, text, taskId, assetIds) => ipcRenderer.invoke('najd:session:append', id, role, text, taskId, assetIds),
  delete: id => ipcRenderer.invoke('najd:session:delete', id),
  rename: (id, title) => ipcRenderer.invoke('najd:session:rename', id, title),
  export: id => ipcRenderer.invoke('najd:session:export', id),
  saveBlock: input => ipcRenderer.invoke('najd:session:saveBlock', input),
  openFile: input => ipcRenderer.invoke('najd:session:openFile', input),
  previewFile: input => ipcRenderer.invoke('najd:session:previewFile', input),
  speak: (text, language) => ipcRenderer.invoke('najd:speech:synthesize', text, language)
})

contextBridge.exposeInMainWorld('najdAccounts', {
  list: () => ipcRenderer.invoke('najd:accounts:list'),
  add: input => ipcRenderer.invoke('najd:accounts:add', { label: input?.label, siteUrl: input?.siteUrl, username: input?.username, password: input?.password, autoLogin: input?.autoLogin === true }),
  setAutoLogin: (id, enabled) => ipcRenderer.invoke('najd:accounts:setAutoLogin', id, enabled),
  remove: id => ipcRenderer.invoke('najd:accounts:remove', id),
  pending: () => ipcRenderer.invoke('najd:accounts:pending'),
  acknowledge: id => ipcRenderer.invoke('najd:accounts:acknowledge', id),
  retry: () => ipcRenderer.invoke('najd:accounts:retry')
})

contextBridge.exposeInMainWorld('najdBrowser', {
  status: () => ipcRenderer.invoke('najd:browser:status'),
  pairingCode: () => ipcRenderer.invoke('najd:browser:pairingCode'),
  unpair: (id, instance) => ipcRenderer.invoke('najd:browser:unpair', typeof id === 'string' ? id : undefined, typeof instance === 'string' ? instance : undefined),
  rotateCode: () => ipcRenderer.invoke('najd:browser:rotateCode'),
  // Questions typed in the browser extension arrive here (ids and bounded text only); progress goes back through askUpdate.
  onAsk: listener => {
    if (typeof listener !== 'function') return () => {}
    const handler = (_event, ask) => {
      if (!ask || typeof ask.id !== 'string' || !/^[a-f0-9]{24}$/.test(ask.id) || typeof ask.text !== 'string' || ask.text.length > 4000) return
      const page = ask.page && typeof ask.page === 'object' ? ask.page : null
      const attachment = page?.attachment && typeof page.attachment === 'object' ? { name: String(page.attachment.name || '').slice(0, 120), text: String(page.attachment.text || '').slice(0, 20000) } : null
      const tabs = Array.isArray(page?.tabs) ? page.tabs.slice(0, 3).filter(tab => tab && typeof tab === 'object').map(tab => ({ url: String(tab.url || '').slice(0, 500), title: String(tab.title || '').slice(0, 200), text: String(tab.text || '').slice(0, 6000) })).filter(tab => tab.url) : []
      listener({ id: ask.id, text: ask.text,
        page: page ? { url: String(page.url || ''), title: String(page.title || ''), selection: String(page.selection || ''), text: String(page.text || '').slice(0, 12000), lang: String(page.lang || '').slice(0, 16), ...(attachment?.text ? { attachment } : {}), ...(tabs.length ? { tabs } : {}) } : null,
        // A follow-up from the panel continues this conversation; a model chosen in the panel (checked against NAJD's own list by the bridge).
        conversationId: typeof ask.conversationId === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(ask.conversationId) ? ask.conversationId : null,
        // A picture of the page, already in NAJD's library (its id and name only).
        pictures: Array.isArray(ask.pictures) ? ask.pictures.slice(0, 1).filter(item => item && typeof item.id === 'string' && /^[a-f0-9]{64}$/.test(item.id)).map(item => ({ id: item.id, name: String(item.name || 'page.jpg').slice(0, 120) })) : [],
        model: ask.model && typeof ask.model === 'object' && typeof ask.model.provider === 'string' && typeof ask.model.model === 'string' ? { provider: ask.model.provider.slice(0, 40), model: ask.model.model.slice(0, 200) } : null })
    }
    ipcRenderer.on('najd:ask:incoming', handler)
    return () => { ipcRenderer.removeListener('najd:ask:incoming', handler) }
  },
  // A question stopped from the browser: the renderer drops it from its queue, or clears its approval card.
  onAskCancelled: listener => {
    if (typeof listener !== 'function') return () => {}
    const handler = (_event, value) => {
      if (!value || typeof value.id !== 'string' || !/^[a-f0-9]{24}$/.test(value.id)) return
      listener({ id: value.id, taskId: typeof value.taskId === 'string' && /^[0-9a-f-]{36}$/.test(value.taskId) ? value.taskId : null })
    }
    ipcRenderer.on('najd:ask:cancelled', handler)
    return () => { ipcRenderer.removeListener('najd:ask:cancelled', handler) }
  },
  askUpdate: (id, patch) => ipcRenderer.invoke('najd:ask:update', id, patch),
  activeAsks: () => ipcRenderer.invoke('najd:ask:active'),
  // The answer of a browser question is saved in its conversation: the app no longer needs to keep it for recovery.
  askSaved: taskId => (typeof taskId === 'string' && /^[0-9a-f-]{36}$/.test(taskId) ? ipcRenderer.invoke('najd:ask:saved', taskId) : Promise.resolve(false)),
  openDemo: language => ipcRenderer.invoke('najd:browser:openDemo', language)
})

contextBridge.exposeInMainWorld('najdFiles', {
  grantRoot: () => ipcRenderer.invoke('najd:files:grantRoot'),
  listRoots: () => ipcRenderer.invoke('najd:files:listRoots'),
  revokeRoot: root => ipcRenderer.invoke('najd:files:revokeRoot', root),
  activity: () => ipcRenderer.invoke('najd:files:activity'),
  wholeComputer: enabled => ipcRenderer.invoke('najd:files:wholeComputer', enabled)
})
contextBridge.exposeInMainWorld('najdLibrary', {
  list: () => ipcRenderer.invoke('najd:library:list'),
  import: () => ipcRenderer.invoke('najd:library:import'),
  search: query => ipcRenderer.invoke('najd:library:search', query),
  preview: id => ipcRenderer.invoke('najd:library:preview', id),
  remove: id => ipcRenderer.invoke('najd:library:remove', id),
  reveal: id => ipcRenderer.invoke('najd:library:reveal', id),
  open: id => ipcRenderer.invoke('najd:library:open', id),
  // Only real dropped File objects resolve to paths here; the renderer never invents paths.
  importDropped: files => ipcRenderer.invoke('najd:library:importPaths', Array.from(files).map(file => webUtils.getPathForFile(file)).filter(Boolean)),
  importBytes: (name, data) => ipcRenderer.invoke('najd:library:importBytes', name, data),
  thumbnail: id => ipcRenderer.invoke('najd:library:thumbnail', id)
})
