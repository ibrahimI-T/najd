// Capability atlas model: one honest list of what NAJD has on this computer, built only from the live readiness
// data the app already reads (tools, skills, plugins, MCP servers, connections, memory, agent profiles).
// Nothing is listed as ready unless its source reported it ready.
export type AtlasKind = 'tool' | 'skill' | 'plugin' | 'mcp' | 'connection' | 'memory' | 'agent' | 'automation'
export type AtlasStatus = 'ready' | 'guide' | 'needs-setup' | 'disconnected' | 'error' | 'off' | 'unavailable'
export type AtlasPage = 'tools' | 'skills' | 'plugins' | 'connections' | 'memory' | 'models' | 'advanced' | null

export interface AtlasItem {
  id: string
  kind: AtlasKind
  name: string
  description: string
  status: AtlasStatus
  reason: string | null
  source: string
  version: string | null
  permissions: string[]
  group: string
  page: AtlasPage
  lastUsed?: number
}
export interface AtlasInput {
  tools: NajdAgentTool[] | null
  skills: NajdInstructionSkill[]
  capabilities: NajdCapability[]
  pack: NajdPackStatus | null
  servers: NajdMcpServer[]
  connectors: NajdConnector[]
  browserConnected: boolean
  memories: NajdMemoryNote[]
  profiles: { id: string; title: { ar: string; en: string }; toolsets: string[] }[] | null
  // Whether the memory service answered at all (its bridge exists); notes may legitimately be zero.
  memoryAvailable?: boolean
  // Authoritative toolset readiness from main (runtime predicates). When present it decides agent readiness.
  toolsetReady?: Record<string, boolean> | null
  lastUsed?: Record<string, number>
}
export interface AtlasSummary { total: number; byStatus: Record<AtlasStatus, number>; byKind: Record<AtlasKind, number> }

const EFFECT_LABEL: Record<string, { ar: string; en: string }> = {
  read: { ar: 'يقرأ بدون سؤال', en: 'Reads freely' },
  approval: { ar: 'يحتاج موافقتك', en: 'Needs your approval' },
  guidance: { ar: 'إرشاد فقط — لا يمنح أدوات', en: 'Guidance only — grants no tools' },
  external: { ar: 'خادم خارجي — موافقة لكل استدعاء', en: 'External server — approval per call' },
  own: { ar: 'يوقف عملياته فقط', en: 'Stops only its own processes' }
}
function effectOf(effect: string): string {
  if (effect === 'read') return 'read'
  if (effect === 'stops-own-process') return 'own'
  if (effect === 'external-with-approval') return 'external'
  if (/approval/.test(effect)) return 'approval'
  // Unknown effects are shown conservatively as needing approval, never as free reads.
  return 'approval'
}
export function effectLabel(key: string, language: 'ar' | 'en'): string { return EFFECT_LABEL[key]?.[language] || key }

// Toolsets whose capabilities are not rows in the tool list (guidance, discovery and meta tools).
const NOT_LISTED = new Set(['core', 'skills', 'connections'])

const OPTIONAL_TOOLSETS = new Set(['media', 'video'])

// The settings page where a tool that is not ready can actually be fixed (the Tools page only lists it).
const setupPage = (reason: string | null | undefined): AtlasPage =>
  reason === 'ENGINE_NOT_READY' || reason === 'DESKTOP_HOST_OR_ENGINE_NOT_READY' ? 'advanced' : reason === 'SERVICE_NOT_CONFIGURED' ? 'models' : 'tools'

export function buildAtlas(input: AtlasInput, language: 'ar' | 'en'): AtlasItem[] {
  const ar = language === 'ar'
  const items: AtlasItem[] = []
  const windowsHost = input.connectors.some(connector => connector.state === 'connected')
  const used = input.lastUsed || {}
  const toolReady = new Map<string, boolean>()
  for (const tool of input.tools || []) {
    const browser = tool.group === 'browser'
    toolReady.set(tool.group, (toolReady.get(tool.group) || false) || tool.ready)
    items.push({
      id: 'tool:' + tool.group + ':' + (tool.server || '') + ':' + tool.name, kind: tool.group === 'mcp' ? 'mcp' : 'tool', name: tool.name, description: tool.description,
      status: tool.ready ? 'ready' : browser ? 'disconnected' : 'needs-setup', reason: tool.ready ? null : tool.reason || (browser ? 'NOT_CONNECTED' : 'UNAVAILABLE'),
      source: tool.server ? (ar ? 'خادم MCP: ' : 'MCP server: ') + tool.server : 'NAJD', version: null, permissions: [tool.group === 'mcp' ? 'external' : effectOf(tool.effect)], group: tool.group,
      page: tool.group === 'mcp' ? 'connections' : tool.ready ? 'tools' : setupPage(tool.reason), lastUsed: used[tool.name.replaceAll('_', '-')]
    })
  }
  for (const skill of input.skills) {
    if (skill.compatibility === 'platform-mismatch') continue
    items.push({
      id: 'skill:' + skill.id, kind: 'skill', name: skill.name, description: skill.description,
      status: !skill.enabled ? 'off' : skill.compatibility === 'needs-runtime' ? 'needs-setup' : 'guide',
      reason: !skill.enabled ? 'DISABLED' : skill.compatibility === 'needs-runtime' ? 'NEEDS_RUNTIME' : null,
      source: skill.source + (skill.license ? ' · ' + skill.license : ''), version: skill.sourceRevision ? skill.sourceRevision.slice(0, 8) : null,
      permissions: ['guidance'], group: skill.builtIn ? 'builtin' : 'imported', page: 'skills'
    })
  }
  for (const plugin of input.capabilities) {
    items.push({
      id: 'plugin:' + plugin.id, kind: 'plugin', name: plugin.title, description: plugin.description,
      // Installed and enabled is not runnable: capabilities that need the Windows companion are ready only while it is connected.
      status: plugin.updateRequired || !plugin.installed ? 'needs-setup' : !plugin.enabled ? 'off' : plugin.permission === 'windows:discover' && !windowsHost ? 'disconnected' : 'ready',
      reason: plugin.updateRequired ? 'UPDATE_REQUIRED' : !plugin.installed ? 'NOT_INSTALLED' : !plugin.enabled ? 'DISABLED' : plugin.permission === 'windows:discover' && !windowsHost ? 'NOT_CONNECTED' : null,
      source: plugin.source, version: plugin.version, permissions: [plugin.permission], group: 'capability', page: 'plugins', lastUsed: used[plugin.id]
    })
  }
  if (input.pack) {
    const pack = input.pack
    items.push({
      id: 'plugin:office-pack', kind: 'plugin', name: ar ? 'حزمة Office والتصميم' : 'Office and design pack',
      description: ar ? 'Word وExcel وPowerPoint وPDF والرسوم عبر Python المُدار.' : 'Word, Excel, PowerPoint, PDF and charts through managed Python.',
      status: pack.state === 'ready' ? 'ready' : pack.state === 'damaged' || pack.state === 'incompatible' ? 'error' : 'needs-setup',
      reason: pack.state === 'ready' ? null : pack.installing ? 'INSTALLING' : pack.state.toUpperCase().replace(/-/g, '_'),
      source: 'NAJD pinned pack', version: pack.packageCount ? String(pack.packageCount) + (ar ? ' حزمة' : ' packages') : null, permissions: ['approval'], group: 'pack', page: 'plugins'
    })
  }
  for (const server of input.servers) {
    items.push({
      id: 'mcp:' + server.id, kind: 'mcp', name: server.name, description: server.tools.length ? server.tools.slice(0, 4).map(tool => tool.title || tool.name).join(', ') : (ar ? 'خادم MCP أضفته' : 'MCP server you added'),
      status: !server.enabled ? 'off' : server.state === 'connected' ? 'ready' : server.state === 'failed' ? 'error' : 'disconnected',
      reason: !server.enabled ? 'DISABLED' : server.state === 'failed' ? server.error || 'FAILED' : server.state === 'connected' ? null : 'NOT_CONNECTED',
      source: ar ? 'خادم أضفته' : 'Added by you', version: server.serverInfo?.version || null, permissions: ['external'], group: 'mcp-server', page: 'connections'
    })
  }
  items.push({
    id: 'connection:browser', kind: 'connection', name: ar ? 'متصفح نجد' : 'NAJD browser', description: ar ? 'إضافة المتصفح: يتصفح نجد في تبويبه الخاص بموافقتك.' : 'Browser extension: NAJD browses in its own tab with your approval.',
    status: input.browserConnected ? 'ready' : 'disconnected', reason: input.browserConnected ? null : 'NOT_CONNECTED', source: 'NAJD extension', version: null, permissions: ['approval'], group: 'browser', page: 'connections'
  })
  for (const connector of input.connectors) {
    items.push({
      id: 'connection:' + connector.id, kind: 'connection', name: ar ? 'التحكم بسطح المكتب' : 'Desktop control',
      description: ar ? 'رفيق Windows المحلي لتشغيل البرامج وقراءة النوافذ.' : 'Local Windows companion that opens apps and reads windows.',
      status: connector.state === 'connected' ? 'ready' : connector.state === 'failed' ? 'error' : 'disconnected', reason: connector.state === 'connected' ? null : connector.state === 'failed' ? 'FAILED' : 'NOT_CONNECTED',
      source: connector.source, version: connector.sourceRevision ? connector.sourceRevision.slice(0, 8) : null, permissions: ['approval'], group: 'desktop', page: 'connections'
    })
  }
  if (input.memoryAvailable !== false) items.push({
    id: 'memory:notes', kind: 'memory', name: ar ? 'الذاكرة' : 'Memory', description: ar ? `${input.memories.length} ملاحظة محفوظة محليًا. لا يُعرض محتواها هنا.` : `${input.memories.length} notes saved locally. Their contents are not shown here.`,
    status: 'ready', reason: null, source: 'NAJD', version: null, permissions: ['approval'], group: 'memory', page: 'memory'
  })
  for (const profile of input.profiles || []) {
    // Only toolsets that appear in the live tool list can be judged; each of them must have a ready tool.
    // Every required toolset must have a ready tool. Only these have no rows in the tool list by design.
    const sets = profile.toolsets.filter(name => !NOT_LISTED.has(name))
    const isReady = (name: string) => input.toolsetReady && name in input.toolsetReady ? input.toolsetReady[name] : !input.toolsetReady && toolReady.get(name) === true
    const ready = sets.filter(isReady)
    // Paid-service toolsets are optional for an agent: without their key the agent still works, so they never make it "needs setup".
    const missing = sets.filter(name => !isReady(name) && !OPTIONAL_TOOLSETS.has(name))
    const optionalMissing = sets.filter(name => !isReady(name) && OPTIONAL_TOOLSETS.has(name))
    items.push({
      id: 'agent:' + profile.id, kind: 'agent', name: profile.title[language], description: (ar ? 'مجموعات الأدوات: ' : 'Toolsets: ') + profile.toolsets.join(', '),
      status: !input.tools || !sets.length || missing.length ? 'needs-setup' : 'ready', reason: !input.tools ? null : !sets.length ? 'NO_READY_TOOLS' : missing.length ? 'MISSING:' + missing.join(', ') : optionalMissing.length ? 'OPTIONAL:' + optionalMissing.join(', ') : null,
      source: 'NAJD', version: ready.length + '/' + sets.length, permissions: ['approval'], group: 'profile', page: null
    })
  }
  // Capabilities that do not exist yet are not listed at all.
  return items
}

export function summarizeAtlas(items: AtlasItem[]): AtlasSummary {
  const byStatus: Record<AtlasStatus, number> = { ready: 0, guide: 0, 'needs-setup': 0, disconnected: 0, error: 0, off: 0, unavailable: 0 }
  const byKind: Record<AtlasKind, number> = { tool: 0, skill: 0, plugin: 0, mcp: 0, connection: 0, memory: 0, agent: 0, automation: 0 }
  // Items that are not implemented are shown for honesty but never counted in the total.
  const counted = items.filter(item => item.status !== 'unavailable')
  for (const item of items) { byStatus[item.status]++; byKind[item.kind]++ }
  return { total: counted.length, byStatus, byKind }
}

export function reasonText(reason: string | null, language: 'ar' | 'en'): string {
  if (!reason) return ''
  const table: Record<string, { ar: string; en: string }> = {
    NOT_CONNECTED: { ar: 'غير متصل. اتصل به من صفحة الاتصالات.', en: 'Not connected. Connect it on the Connections page.' },
    DISABLED: { ar: 'متوقف. فعّله من صفحته.', en: 'Turned off. Turn it on from its page.' },
    NOT_INSTALLED: { ar: 'غير مثبّت بعد.', en: 'Not installed yet.' },
    UPDATE_REQUIRED: { ar: 'يحتاج تحديثًا.', en: 'Needs an update.' },
    NEEDS_RUNTIME: { ar: 'يحتاج مكونات تشغيل غير جاهزة؛ يعمل كإرشاد فقط.', en: 'Needs runtime parts that are not ready; works as guidance only.' },
    UNAVAILABLE: { ar: 'غير جاهز على هذا الجهاز.', en: 'Not ready on this computer.' },
    ENGINE_NOT_READY: { ar: 'محرك نجد غير جاهز بعد. افتح صفحة «متقدم» وشغّل المحرك، أو أعد تثبيت النسخة الكاملة من نجد.', en: 'The NAJD engine is not ready yet. Open Advanced and start the engine, or reinstall the full NAJD version.' },
    DESKTOP_HOST_OR_ENGINE_NOT_READY: { ar: 'خدمة التحكم بسطح المكتب أو المحرك غير جاهزة. افتح صفحة «متقدم» وتحقق من حالتهما.', en: 'The desktop control service or the engine is not ready. Open Advanced to check their status.' },
    SERVICE_NOT_CONFIGURED: { ar: 'توليد الصور والفيديو المدمج يحتاج مفتاح OpenAI API. في صفحة النماذج اختر «ربط API» ثم OpenAI واحفظ المفتاح. وللخدمات الأخرى (fal وReplicate وCanva) أضفها من صفحة الاتصالات.', en: 'Built-in image and video generation needs an OpenAI API key. On the Models page choose Connect an API, then OpenAI, and save the key. For other services (fal, Replicate, Canva) add them on the Connections page.' },
    INSTALLING: { ar: 'قيد التثبيت.', en: 'Installing.' },
    DAMAGED: { ar: 'ملفاته تالفة. أعد تثبيته.', en: 'Its files are damaged. Reinstall it.' },
    INCOMPATIBLE: { ar: 'غير متوافق مع هذا الإصدار. أعد تثبيته.', en: 'Incompatible with this version. Reinstall it.' },
    FAILED: { ar: 'فشل الاتصال.', en: 'The connection failed.' },
    NO_READY_TOOLS: { ar: 'لا توجد أدوات جاهزة لهذا الوكيل بعد.', en: 'No ready tools for this agent yet.' },
    NOT_IMPLEMENTED: { ar: 'غير متوفر في هذا الإصدار.', en: 'Not available in this version.' }
  }
  if (reason.startsWith('OPTIONAL:')) return language === 'ar' ? 'جاهز. الصور والفيديو تحتاج مفتاح OpenAI API (اختياري).' : 'Ready. Images and video need an OpenAI API key (optional).'
  if (reason.startsWith('MISSING:')) return (language === 'ar' ? 'مجموعات أدوات غير جاهزة: ' : 'Toolsets not ready: ') + reason.slice(8)
  return table[reason]?.[language] || reason
}
