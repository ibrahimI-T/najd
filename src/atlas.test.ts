import { describe, expect, it } from 'vitest'
import { buildAtlas, summarizeAtlas, reasonText, type AtlasInput } from './atlas'

const base: AtlasInput = { tools: [], skills: [], capabilities: [], pack: null, servers: [], connectors: [], browserConnected: false, memories: [], profiles: [] }

describe('capability atlas', () => {
  it('lists a tool as ready only when its readiness check passed', () => {
    const items = buildAtlas({ ...base, tools: [
      { name: 'najd_files_read', description: 'Read', ready: true, reason: null, effect: 'read', group: 'files-read' },
      { name: 'najd_python_run', description: 'Run', ready: false, reason: 'ENGINE_NOT_READY', effect: 'change-with-approval', group: 'python' },
      { name: 'najd_browser', description: 'Browse', ready: false, reason: null, effect: 'read-or-approval', group: 'browser' }
    ] }, 'en')
    const byName = Object.fromEntries(items.filter(item => item.kind === 'tool').map(item => [item.name, item]))
    expect(byName.najd_files_read.status).toBe('ready')
    expect(byName.najd_python_run.status).toBe('needs-setup')
    expect(byName.najd_python_run.reason).toBe('ENGINE_NOT_READY')
    expect(byName.najd_python_run.permissions).toEqual(['approval'])
    expect(byName.najd_browser.status).toBe('disconnected')
  })

  it('maps MCP, connection and pack states without inventing readiness', () => {
    const items = buildAtlas({ ...base, browserConnected: true,
      servers: [
        { id: 's1', name: 'files', commandLine: '', cwd: null, envNames: [], enabled: true, state: 'failed', error: 'spawn ENOENT', serverInfo: null, tools: [] },
        { id: 's2', name: 'docs', commandLine: '', cwd: null, envNames: [], enabled: true, state: 'connected', error: null, serverInfo: { name: 'docs', version: '1.2.0', protocolVersion: 'x' }, tools: [] }
      ],
      pack: { state: 'damaged', packageCount: 0, cleanupPending: false } }, 'en')
    expect(items.find(item => item.id === 'mcp:s1')).toMatchObject({ status: 'error', reason: 'spawn ENOENT' })
    expect(items.find(item => item.id === 'mcp:s2')).toMatchObject({ status: 'ready', version: '1.2.0' })
    expect(items.find(item => item.id === 'plugin:office-pack')!.status).toBe('error')
    expect(items.find(item => item.id === 'connection:browser')!.status).toBe('ready')
  })

  it('lists no capability that does not exist, and hides mismatched skills', () => {
    const skill = { id: 'a', name: 'apple-notes', description: 'x', source: 'upstream', sourceRevision: null, relativePath: '', digest: '', license: 'MIT', platforms: null, enabled: true, mode: 'instructions', dependenciesReady: false } as const
    const items = buildAtlas({ ...base, skills: [{ ...skill, compatibility: 'platform-mismatch' }, { ...skill, id: 'b', name: 'writer', compatibility: 'instructions-only' }] }, 'ar')
    expect(items.filter(item => item.kind === 'skill').map(item => item.name)).toEqual(['writer'])
    // Enabled instruction skills are guides, never counted as live-checked ready capabilities.
    expect(items.find(item => item.name === 'writer')!.status).toBe('guide')
    expect(summarizeAtlas(items).byStatus.ready).toBe(items.filter(item => item.status === 'ready').length)
    const summary = summarizeAtlas(items)
    expect(summary.byKind.automation).toBe(0)
    expect(summary.byStatus.unavailable).toBe(0)
    expect(items.some(item => item.status === 'unavailable')).toBe(false)
    expect(summary.total).toBe(items.length)
  })

  it('does not mark an agent as needing setup only because an optional paid service has no key', () => {
    const profiles = [{ id: 'design', title: { ar: 'تصميم', en: 'Design' }, toolsets: ['core', 'media', 'python'] }]
    const tool = (name: string, group: string, ready: boolean) => ({ name, description: '', ready, reason: ready ? null : 'SERVICE_NOT_CONFIGURED', effect: 'read', group })
    const items = buildAtlas({ ...base, profiles, tools: [tool('najd_python_run', 'python', true), tool('najd_image_generate', 'media', false)] }, 'en')
    expect(items.find(item => item.kind === 'agent')).toMatchObject({ status: 'ready', reason: 'OPTIONAL:media' })
    expect(reasonText('OPTIONAL:media', 'en')).toMatch(/optional/)
  })

  it('marks an agent ready only when every judged toolset has a ready tool', () => {
    const profiles = [{ id: 'coder', title: { ar: 'مبرمج', en: 'Coder' }, toolsets: ['core', 'python', 'terminal'] }]
    const tool = (name: string, group: string, ready: boolean) => ({ name, description: '', ready, reason: ready ? null : 'X', effect: 'read', group })
    const partial = buildAtlas({ ...base, profiles, tools: [tool('najd_python_run', 'python', false), tool('najd_terminal_run', 'terminal', true)] }, 'en')
    expect(partial.find(item => item.kind === 'agent')).toMatchObject({ status: 'needs-setup', reason: 'MISSING:python', version: '1/2' })
    expect(reasonText('MISSING:python', 'en')).toBe('Toolsets not ready: python')
    const full = buildAtlas({ ...base, profiles, tools: [tool('najd_python_run', 'python', true), tool('najd_terminal_run', 'terminal', true)] }, 'en')
    expect(full.find(item => item.kind === 'agent')).toMatchObject({ status: 'ready', version: '2/2', name: 'Coder' })
    // A required toolset with no row in the live tool list is not ready (only core, skills and connections are exempt).
    const absent = buildAtlas({ ...base, profiles: [{ id: 'web', title: { ar: 'ويب', en: 'Web' }, toolsets: ['core', 'terminal', 'web'] }], tools: [tool('najd_terminal_run', 'terminal', true)] }, 'en')
    expect(absent.find(item => item.kind === 'agent')).toMatchObject({ status: 'needs-setup', reason: 'MISSING:web' })
    const none = buildAtlas({ ...base, profiles, tools: [] }, 'en')
    expect(none.find(item => item.kind === 'agent')!.status).toBe('needs-setup')
  })

  it('uses the authoritative toolset readiness from main when it is available', () => {
    const profiles = [{ id: 'office', title: { ar: 'مكتب', en: 'Office' }, toolsets: ['core', 'python', 'logs'] }]
    // najd_log_read is shared by several toolsets and ready on its own, but the python toolset is not ready.
    const tools = [{ name: 'najd_log_read', description: '', ready: true, reason: null, effect: 'read', group: 'python' }]
    const guessed = buildAtlas({ ...base, profiles, tools }, 'en').find(item => item.kind === 'agent')!
    expect(guessed.status).toBe('needs-setup') // 'logs' has no listed row of its own
    const exact = buildAtlas({ ...base, profiles, tools, toolsetReady: { python: false, logs: true } }, 'en').find(item => item.kind === 'agent')!
    expect(exact).toMatchObject({ status: 'needs-setup', reason: 'MISSING:python' })
    const ok = buildAtlas({ ...base, profiles, tools, toolsetReady: { python: true, logs: true } }, 'en').find(item => item.kind === 'agent')!
    expect(ok.status).toBe('ready')
  })

  it('labels external MCP tools as approval per call even when the server calls them read-only', () => {
    const items = buildAtlas({ ...base, tools: [{ name: 'echo', description: '', ready: true, reason: null, effect: 'read', group: 'mcp', server: 's' }] }, 'en')
    expect(items.find(item => item.name === 'echo')!.permissions).toEqual(['external'])
  })

  it('shows the Windows discovery plugin ready only while the Windows companion is connected', () => {
    const plugin = { id: 'najd-list-apps', title: 'Discover Windows apps', description: '', version: '1.0.0', digest: '', permission: 'windows:discover', source: 'NAJD', tool: 'windows-apps', installed: true, enabled: true, updateRequired: false } as const
    expect(buildAtlas({ ...base, capabilities: [plugin] }, 'en').find(item => item.id === 'plugin:najd-list-apps')).toMatchObject({ status: 'disconnected', reason: 'NOT_CONNECTED' })
    const connector = { id: 'najd-windows-native', state: 'connected', transport: '', source: '', sourceRevision: '', protocolVersion: null, tools: [] as string[], executableConfigurable: false } as const
    expect(buildAtlas({ ...base, capabilities: [plugin], connectors: [connector] }, 'en').find(item => item.id === 'plugin:najd-list-apps')!.status).toBe('ready')
  })

  it('omits the memory row when the memory service is unavailable', () => {
    expect(buildAtlas({ ...base, memoryAvailable: false }, 'en').some(item => item.kind === 'memory')).toBe(false)
    expect(buildAtlas({ ...base, memoryAvailable: true }, 'en').some(item => item.kind === 'memory')).toBe(true)
  })

  it('never exposes memory contents and explains reasons in both languages', () => {
    const items = buildAtlas({ ...base, memories: [{ id: '1', title: 'secret title', text: 'private body', createdAt: '', updatedAt: '' }] }, 'en')
    expect(JSON.stringify(items)).not.toContain('private body')
    expect(JSON.stringify(items)).not.toContain('secret title')
    expect(reasonText('NOT_CONNECTED', 'ar')).toContain('غير متصل')
    expect(reasonText('spawn ENOENT', 'en')).toBe('spawn ENOENT')
  })
})

describe('round 20 permissions', () => {
  it('never shows an unknown or paid effect as a free read', () => {
    const items = buildAtlas({ ...base, tools: [{ name: 'najd_image_generate', description: '', ready: true, reason: null, effect: 'change-with-approval', group: 'media' },
      { name: 'najd_mystery', description: '', ready: true, reason: null, effect: 'something-new', group: 'core' }] }, 'en')
    expect(items.find(item => item.name === 'najd_image_generate')!.permissions).toEqual(['approval'])
    expect(items.find(item => item.name === 'najd_mystery')!.permissions).toEqual(['approval'])
  })
})
