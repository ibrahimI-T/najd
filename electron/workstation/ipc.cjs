// All workstation services and their sender-validated IPC, created once from main. Renderer input is checked here; nothing from the
// renderer reaches a service unbounded. Scheduled and remote work runs through the core, so the approval policy is unchanged.
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { createWorkstationCatalog } = require('./catalog.cjs')
const { createWorkstationPackages } = require('./packages.cjs')
const { createLocalPackageImporter } = require('./local-package-importer.cjs')
const { createOfficialCompatibleMarket } = require('./official-market.cjs')
const { createTaskCenter } = require('./task-center.cjs')
const { createRemoteControl } = require('./remote-control.cjs')
const { createBrowserTabs } = require('./browser-tabs.cjs')
const { createDocumentStore } = require('./documents.cjs')
const { createSystem } = require('./system.cjs')

const TERMINAL = new Set(['COMPLETED', 'FAILED', 'CANCELLED', 'UNKNOWN_EFFECT'])
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const text = (value, limit) => String(value ?? '').slice(0, limit)

const { connectPackageServer, reconcilePackageServers } = require('./mcp-declarations.cjs')
function registerWorkstation({ electron, ipcMain, app, withWindowSender, directory, core, sessions, health, mainWindow, broadcast, iconPath, mcpServers }) {
  const { dialog, powerSaveBlocker, WebContentsView, session, shell } = electron
  let blocker = null, lastModel = {}
  const system = createSystem({ electron, app, directory, mainWindow, iconPath, onEmergencyStop: () => { const stopped = typeof core.cancelAll === 'function' ? core.cancelAll() : 0; if (stopped) void system.notify('NAJD', 'Stopped ' + stopped + ' running task(s) (Ctrl+Alt+Q)').catch(() => {}) } })
  const notify = kind => broadcast('najd:workstation:changed', kind)

  const packages = createWorkstationPackages({ directory: path.join(directory, 'packages'), appVersion: app.getVersion(), onChange: () => notify('catalog'), beforeChange: async (id, action) => {
    if (!mcpServers) return
    for (const server of (await mcpServers.list()).filter(server => server.ownerPackage === id)) {
      if (action === 'remove') await mcpServers.remove(server.id)
      else if (action === 'disable') await mcpServers.disconnect(server.id)
      else if (action === 'enable') await mcpServers.connect(server.id)
    }
  } })
  const localPackages = createLocalPackageImporter({ roots: [
    path.join(app.getPath('appData'), 'kimi-desktop', 'daimon-share', 'daimon'),
    path.join(app.getPath('appData'), 'kimi-desktop', 'daimon-bundle', 'app', 'daimon')
  ], packages })
  const officialMarket = createOfficialCompatibleMarket({ directory: path.join(directory, 'catalog', 'official-market') })
  const catalog = createWorkstationCatalog({ directory: path.join(directory, 'catalog'), packages, localPackages, probes: health, officialMarket })

  // Unattended work never waits for an approval nobody is there to give: such a run stops and says so.
  async function runAutomation(item) {
    if (!item.provider) return { state: 'FAILED', code: 'MODEL_NOT_CONFIGURED' }
    let conversationId = item.conversationId
    if (conversationId) await sessions.getSession(conversationId).catch(() => { conversationId = null })
    if (!conversationId) conversationId = (await sessions.createSession()).id
    await sessions.appendMessage(conversationId, 'user', item.prompt)
    const started = core.startTask({ text: item.prompt, intentId: randomUUID(), provider: item.provider, modelName: item.model || undefined, history: [{ role: 'user', text: item.prompt }], reasoningEffort: 'auto', conversationId, accessMode: 'ask' })
    for (;;) {
      const task = core.getTask(started.id)
      if (task.state === 'WAITING_APPROVAL') { try { core.cancelTask(started.id) } catch {} void system.notify(item.title, 'Needs your approval').catch(() => {}); return { state: 'NEEDS_APPROVAL', taskId: started.id, conversationId } }
      if (TERMINAL.has(task.state)) {
        // The fourth argument is the task's activity (as the window's own append passes it), not its id: the id failed validation and the
        // answer was never saved, so the task's conversation said "no reply" (live test 2026-11-09). A failure to save is now recorded.
        let saveError = null
        if (task.output) await sessions.appendMessage(conversationId, 'assistant', task.output, task.activity?.finishedAt ? task.activity : undefined).catch(error => { saveError = error?.code || 'HISTORY' })
        broadcast('najd:sessions:changed', { sessionId: conversationId })
        void system.notify(item.title, task.state === 'COMPLETED' ? 'Finished' : task.state).catch(() => {})
        return { state: task.state, output: task.output, taskId: task.id, conversationId, code: task.errorCode || saveError || undefined }
      }
      await sleep(500)
    }
  }
  const taskCenter = createTaskCenter({ directory: path.join(directory, 'task-center'), execute: runAutomation, onChange: () => notify('tasks') })

  const remote = createRemoteControl({ directory: path.join(directory, 'remote'), onChange: () => { notify('remote'); void applyAwake() },
    networkAddress: () => { for (const list of Object.values(require('node:os').networkInterfaces())) for (const item of list || []) if (item.family === 'IPv4' && !item.internal) return item.address; return null },
    handlers: {
      status: async () => ({ busy: core.hasActiveTasks(), tasks: (await taskCenter.list()).filter(item => item.status === 'active').map(item => ({ title: item.title, nextRunAt: item.nextRunAt, lastState: item.runs?.[0]?.state || null })).slice(0, 50) }),
      // The window owns the model selection: an instruction becomes a new conversation there, visible to the owner.
      instruct: async (body, device) => { broadcast('najd:workstation:remote', { kind: 'instruct', text: body, device: device.name }); return { accepted: true } },
      resume: async device => { broadcast('najd:workstation:remote', { kind: 'resume', device: device.name }); return { accepted: true } }
    } })
  async function applyAwake() {
    const status = await remote.status().catch(() => null)
    const wanted = !!(status?.enabled && status.keepAwake)
    if (wanted && blocker === null) blocker = powerSaveBlocker.start('prevent-app-suspension')
    if (!wanted && blocker !== null) { powerSaveBlocker.stop(blocker); blocker = null }
  }

  const tabs = createBrowserTabs({ WebContentsView, session, getWindow: mainWindow, onChange: list => broadcast('najd:workstation:tabs', list) })

  const documents = createDocumentStore({ directory: path.join(directory, 'documents') })

  const handle = (name, operation) => ipcMain.handle('najd:ws:' + name, (event, ...args) => withWindowSender(event, () => operation(...args)))
  handle('catalog', () => catalog.list())
  // Adds (after the native confirmation for a command) and connects a server a package declared; see mcp-declarations.cjs.
  handle('connectPackageMcp', async (id, name, token) => {
    const pack = (await packages.list()).find(item => item.id === text(id, 80))
    return connectPackageServer({ pack, name: text(name, 64), token, servers: mcpServers })
  })
  handle('sync', () => catalog.sync())
  handle('addSource', url => catalog.addSource(text(url, 500)))
  handle('removeSource', url => catalog.removeSource(text(url, 500)))
  handle('setBuiltinEnabled', (id, enabled) => catalog.setEnabled(text(id, 80), !!enabled))
  handle('packageSkills', () => packages.skills())
  handle('planFile', async () => {
    const window = mainWindow()
    const picked = await dialog.showOpenDialog(window, { properties: ['openFile'], filters: [{ name: 'NAJD package', extensions: ['zip', 'najdpkg'] }] })
    return picked.canceled || !picked.filePaths[0] ? null : packages.planFromFile(picked.filePaths[0])
  })
  handle('planUrl', (url, digest, format) => packages.planFromUrl(text(url, 500), text(digest, 64), format === 'compatible-plugin' ? format : undefined))
  // After an update or a rollback the package's own servers follow its declarations: a server the new version no longer declares is
  // removed; manual servers are never touched. Nothing is connected here; the owner connects from the hub.
  async function reconcileOwned(id) {
    if (!mcpServers) return
    await reconcilePackageServers({ pack: (await packages.list()).find(item => item.id === id), servers: mcpServers })
  }
  handle('install', async planId => { const installed = await packages.install(text(planId, 40)); await reconcileOwned(installed.id).catch(() => {}); return installed })
  handle('localPackages', () => localPackages.discover())
  handle('planLocal', ids => localPackages.plan(Array.isArray(ids) ? ids.map(id => text(id, 80)).slice(0, 128) : []))
  handle('installLocal', planId => localPackages.install(text(planId, 40)))
  handle('setPackageEnabled', (id, enabled) => packages.setEnabled(text(id, 80), !!enabled))
  handle('rollback', async id => { const rolled = await packages.rollback(text(id, 80)); await reconcileOwned(rolled.id).catch(() => {}); return rolled })
  handle('removePackage', id => packages.remove(text(id, 80)))
  // The text of a skill's guide for the details dialog: a built-in guide shipped with NAJD, else an installed package's SKILL.md.
  handle('skillGuide', async id => {
    const name = text(id, 80)
    if (!/^[a-z0-9][a-z0-9-]{1,79}$/.test(name)) throw Object.assign(new Error('INVALID_INPUT'), { code: 'INVALID_INPUT' })
    const builtin = await require('node:fs/promises').readFile(path.join(__dirname, 'skills', name + '.md'), 'utf8').catch(() => null)
    if (builtin !== null) return { id: name, text: builtin.slice(0, 20000), source: 'builtin' }
    const read = await packages.readSkill(name, 0, 20000)
    return { id: name, text: read.text, source: 'package' }
  })
  // The owner's own saved skills (source "personal:") can be edited in place: the purpose and the steps; the name stays, since the id comes
  // from it. Saving writes the next version through the same verified package install, so Roll back returns to the earlier wording, and the
  // skill keeps its enabled state. The owner's own press in Settings is the approval (a model never reaches these two calls).
  async function personalPackage(id) {
    const name = text(id, 80)
    const current = (await packages.list()).find(item => item.id === name)
    if (!current || !String(current.source || '').startsWith('personal:')) throw Object.assign(new Error('NOT_PERSONAL'), { code: 'NOT_PERSONAL' })
    return current
  }
  handle('skillEditable', async id => {
    const current = await personalPackage(id)
    const { readPersonalSkill } = require('./personal-skill.cjs')
    const read = await packages.readSkill(current.id, 0, 20000)
    return { id: current.id, name: current.displayName, version: current.version, ...readPersonalSkill(read.text, current.displayName) }
  })
  handle('skillEdit', async (id, description, steps) => {
    const current = await personalPackage(id)
    const { personalSkillArchive } = require('./personal-skill.cjs')
    const archive = personalSkillArchive({ name: current.displayName, description: text(description, 400), steps: typeof steps === 'string' ? steps.slice(0, 6000) : '' }, { currentVersion: current.version })
    if (archive.id !== current.id) throw Object.assign(new Error('INVALID_INPUT'), { code: 'INVALID_INPUT' })
    const plan = await packages.planFromBytes(archive.bytes, 'personal:' + archive.id)
    const installed = await packages.install(plan.planId)
    if (current.enabled === false) await packages.setEnabled(archive.id, false).catch(() => {})
    return { id: installed?.id || archive.id, version: archive.version }
  })
  // The folder is created first: on a new profile it does not exist yet and openPath only returned an error text (agent audit 2026-11-08).
  handle('openSkillsFolder', async () => { const folder = path.join(directory, 'packages', 'installed'); await require('node:fs/promises').mkdir(folder, { recursive: true }); return shell.openPath(folder) })

  handle('tasks', () => taskCenter.list())
  handle('taskCreate', input => taskCenter.create(input && typeof input === 'object' ? input : {}))
  handle('taskUpdate', (id, patch) => taskCenter.update(text(id, 40), patch && typeof patch === 'object' ? patch : {}))
  handle('taskStatus', (id, status) => taskCenter.setStatus(text(id, 40), text(status, 20)))
  handle('taskRemove', id => taskCenter.remove(text(id, 40)))
  handle('taskRun', id => taskCenter.runNow(text(id, 40)))

  handle('remote', () => remote.status())
  handle('remoteConfigure', patch => remote.configure(patch && typeof patch === 'object' ? patch : {}))
  handle('remotePair', scopes => remote.startPairing(scopes))
  handle('remoteRevoke', id => remote.revoke(text(id, 40)))

  handle('system', () => system.status())
  handle('systemSet', patch => system.set(patch && typeof patch === 'object' ? patch : {}))

  handle('tabs', () => tabs.list())
  handle('tabOpen', url => tabs.open(text(url, 2000)))
  handle('tabClose', id => tabs.close(text(id, 20)))
  handle('tabNavigate', (id, url) => tabs.navigate(text(id, 20), text(url, 2000)))
  handle('tabBack', id => tabs.back(text(id, 20)))
  handle('tabForward', id => tabs.forward(text(id, 20)))
  handle('tabReload', id => tabs.reload(text(id, 20)))
  handle('tabShow', (id, area) => tabs.show(id ? text(id, 20) : null, area && typeof area === 'object' ? area : null))
  handle('tabRead', id => tabs.read(text(id, 20)))
  handle('tabWebMcp', id => tabs.webmcp(text(id, 20)))

  handle('documents', kind => documents.list(text(kind, 20)))
  handle('documentSave', input => documents.save(input && typeof input === 'object' ? input : {}))
  handle('documentRemove', id => documents.remove(text(id, 40)))

  // The agent's door to the workstation. Reads run directly; anything that creates, runs or acts asks the owner in chat first.
  async function act(args, { requestApproval }) {
    const ask = async (target, summary) => { if (typeof requestApproval !== 'function') throw Object.assign(new Error('PERMISSION_DENIED'), { code: 'PERMISSION_DENIED' }); return (await requestApproval('najd-workstation', { path: target, summary })) === 'ALLOW_ONCE' }
    const denied = { status: 'denied_by_user', note: 'Nothing was done.' }
    const id = text(args.id, 40)
    switch (args.action) {
      case 'market_search': {
        const query = text(args.text, 200).trim().toLowerCase()
        let view
        try { view = await catalog.sync() } catch { view = await catalog.list() }
        return view.entries.filter(item => !query || [item.id, item.displayName, item.description, ...(item.categories || [])].join(' ').toLowerCase().includes(query)).slice(0, 30).map(item => ({
          id: item.id, name: item.displayName, description: item.description, version: item.version, state: item.state, installable: item.installable, installed: item.packageInstalled === true, localImportable: item.localImportable === true, publisher: item.publisher?.name || null, categories: item.categories, source: item.source || null
        }))
      }
      case 'market_install': {
        let view
        try { view = await catalog.sync() } catch { view = await catalog.list() }
        const item = view.entries.find(entry => entry.id === id)
        if (!item || !item.installable) throw Object.assign(new Error('PACKAGE_NOT_INSTALLABLE'), { code: 'PACKAGE_NOT_INSTALLABLE' })
        if (item.packageUrl && item.sha256) {
          const plan = await packages.planFromUrl(item.packageUrl, item.sha256, item.packageFormat)
          const summary = ['Install "' + plan.displayName + '" ' + plan.version + '.', 'Publisher: ' + (plan.publisher?.name || 'Unknown'), 'License: ' + (plan.license?.spdx || plan.license || 'Unknown'), 'Permissions: ' + (plan.permissions?.length ? plan.permissions.map(value => value.id || value).join(', ') : 'none')].join('\n')
          if (!(await ask('market package · ' + plan.id, summary))) return denied
          return packages.install(plan.planId)
        }
        if (item.localImportable) {
          const plan = await localPackages.plan([item.id]), preview = plan.packages[0]
          if (!(await ask('local package · ' + item.id, 'Install "' + preview.displayName + '" ' + preview.version + ' from the compatible packages already on this computer.'))) return denied
          const result = await localPackages.install(plan.planId)
          if (result.failed.length) throw Object.assign(new Error(result.failed[0].code), { code: result.failed[0].code })
          return result.installed[0]
        }
        throw Object.assign(new Error('PACKAGE_NOT_INSTALLABLE'), { code: 'PACKAGE_NOT_INSTALLABLE' })
      }
      // Saving a procedure the owner wants to repeat as a personal skill package (title: name, text: when to use it, prompt: the steps).
      case 'skill_save': {
        const { personalSkillArchive, normalizeSkill, skillId } = require('./personal-skill.cjs')
        const input = { name: args.title, description: args.text, steps: args.prompt }
        const current = (await packages.list()).find(item => item.id === skillId(normalizeSkill(input).name))
        // Only the owner's own personal skill is ever updated; a package from anyone else with that id is never replaced (review 2026-11-08).
        if (current && !String(current.source || '').startsWith('personal:')) throw Object.assign(new Error('SKILL_ID_TAKEN'), { code: 'SKILL_ID_TAKEN' })
        const archive = personalSkillArchive(input, { currentVersion: current?.version || null })
        // A saved skill is lasting guidance: asked under najd-skill-save, which the core always asks (never auto-allowed in any mode).
        if (typeof requestApproval !== 'function') throw Object.assign(new Error('PERMISSION_DENIED'), { code: 'PERMISSION_DENIED' })
        const summary = `${current ? `Update your skill "${current.displayName}" to` : 'Save the skill'} "${archive.name}" (${archive.id} ${archive.version}): ${archive.description}\n\nSteps (saved exactly as shown):\n${archive.steps}`
        if ((await requestApproval('najd-skill-save', { path: 'skill · ' + archive.name, summary })) !== 'ALLOW_ONCE') return denied
        const plan = await packages.planFromBytes(archive.bytes, 'personal:' + archive.id)
        const installed = await packages.install(plan.planId)
        const enabled = current ? current.enabled !== false : true
        return { status: 'saved', id: archive.id, version: archive.version, enabled, package: installed?.id || archive.id,
          note: enabled ? 'Saved under Skills > Added. Read it later with najd_skills_read id "' + archive.id + '".' : 'Updated, but this skill is disabled; the owner can enable it under Skills > Added.' }
      }
      case 'package_enable': if (!(await ask('package · ' + id, 'Enable this installed package and its skills.'))) return denied; return packages.setEnabled(id, true)
      case 'package_disable': if (!(await ask('package · ' + id, 'Disable this installed package and remove its skills from the active runtime.'))) return denied; return packages.setEnabled(id, false)
      case 'package_remove': if (!(await ask('package · ' + id, 'Remove this installed package and its skills from NAJD.'))) return denied; return packages.remove(id)
      case 'tasks_list': return (await taskCenter.list()).map(({ runs, ...item }) => ({ ...item, lastRun: runs?.[0]?.state || null }))
      case 'task_create': {
        const schedule = args.cron ? { kind: 'cron', cron: text(args.cron, 80), timezone: text(args.timezone, 60) || Intl.DateTimeFormat().resolvedOptions().timeZone } : { kind: 'interval', minutes: Number(args.minutes) }
        if (!(await ask('task · ' + text(args.title, 80), 'Create a scheduled task "' + text(args.title, 120) + '" (' + (args.cron ? args.cron + ' · ' + schedule.timezone : 'every ' + args.minutes + ' min') + '):\n' + text(args.prompt, 2000)))) return denied
        return taskCenter.create({ title: args.title, prompt: args.prompt, schedule, ...lastModel })
      }
      case 'task_run': if (!(await ask('task · ' + id, 'Run this scheduled task now.'))) return denied; return taskCenter.runNow(id)
      case 'task_pause': if (!(await ask('task · ' + id, 'Pause this scheduled task.'))) return denied; return taskCenter.setStatus(id, 'paused')
      case 'tab_list': return tabs.list()
      case 'tab_open': return tabs.open(text(args.url, 2000)) // opening and reading follow the owner's browser policy: no approval
      case 'tab_read': return tabs.read(id)
      case 'tab_observe': return tabs.observe(id)
      case 'tab_webmcp': return tabs.webmcp(id)
      case 'tab_act': {
        const kind = args.kind === 'type' ? 'type' : 'click', index = Number(args.element), target = tabs.target(id, text(args.observation, 40), index)
        if (!(await ask(target.url, (kind === 'click' ? 'Press "' : 'Type into "') + target.element.name + '" on ' + target.url + (kind === 'type' ? ':\n' + text(args.text, 500) : '')))) return denied
        return tabs.act(id, index, kind, text(args.text, 2000))
      }
      case 'dashboard_list': return documents.list('dashboard')
      case 'dashboard_create': if (!(await ask('dashboard · ' + text(args.title, 80), 'Create a dashboard named "' + text(args.title, 120) + '".'))) return denied; return documents.save({ kind: 'dashboard', title: args.title, widgets: [] })
      default: throw Object.assign(new Error('INVALID_INPUT'), { code: 'INVALID_INPUT' })
    }
  }

  void taskCenter.start().catch(() => {})
  void remote.start().then(applyAwake).catch(() => {})
  void system.start().catch(() => {})
  return { pointerMode: () => system.pointerMode(), act, noteModel: request => { if (request?.provider) lastModel = { provider: request.provider, model: request.modelName || null } }, packages, catalog, taskCenter, remote, tabs, stop: async () => { taskCenter.stop(); system.stop(); await remote.stop().catch(() => {}); if (blocker !== null) powerSaveBlocker.stop(blocker) } }
}

module.exports = { registerWorkstation }
