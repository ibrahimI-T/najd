// Toolsets, profiles and run scopes for the NAJD agent (docs/AGENT-PLATFORM-PLAN.md, M1).
// A run starts with the tools of one profile plus any toolsets the request clearly needs; the model can
// load more ready toolsets with najd_tools_load. Every path that adds a tool schema goes through
// createToolsetManager, which applies readiness, the run scope and the provider limit of 24 tools.
const profiles = require('./agent-profiles.json')

const TOOLSETS = {
  core: ['najd_capabilities_search', 'najd_capabilities_details', 'najd_tools_load'],
  // The workflow graph: a short plan whose steps are ticked off with a one-line result each (small windows start with it).
  plan: ['najd_plan'],
  memory: ['najd_memory'],
  // Earlier conversations: loaded when the user refers to another chat (najd_tools_load chats).
  chats: ['najd_chats_search', 'najd_chats_read'],
  extensions: ['najd_extensions_search', 'najd_extension_install', 'najd_skill_save'],
  knowledge: ['najd_knowledge_search', 'najd_library_read'],
  webpreview: ['najd_web_preview'],
  skills: ['najd_skills_read'],
  connections: ['najd_connections_apps'],
  library: ['najd_library_read', 'najd_library_search'],
  // Loaded when the model needs an attachment as a real file (M6); kept out of profiles so ordinary requests stay small.
  'library-export': ['najd_library_export'],
  'files-read': ['najd_files_list', 'najd_files_read', 'najd_files_search'],
  files: ['najd_files_list', 'najd_files_read', 'najd_files_search', 'najd_files_write', 'najd_files_edit'],
  'files-manage': ['najd_files_move', 'najd_files_delete'],
  // Exact local helpers (count, profile, compare, calculate): small answers instead of many reads (owner request R-064).
  toolbox: ['najd_toolbox'],
  terminal: ['najd_terminal_run'],
  web: ['najd_web_search', 'najd_web_extract'],
  browser: ['najd_browser'],
  media: ['najd_image_generate'],
  video: ['najd_video_generate', 'najd_video_status', 'najd_video_cancel'],
  transcribe: ['najd_video_transcribe'],
  mcp: ['najd_mcp_call'],
  python: ['najd_python_run', 'najd_log_read'],
  // Office and design review (M3-8): only the profiles that make documents carry it; others load it on demand.
  office: ['najd_office_review'],
  desktop: ['najd_desktop_windows', 'najd_desktop_open', 'najd_desktop_read', 'najd_desktop_act'],
  screen: ['najd_screen_capture'],
  process: ['najd_process_start', 'najd_process_list', 'najd_process_output', 'najd_process_stop', 'najd_log_read'],
  // Reading this conversation's saved output needs no desktop host, so it is loadable on its own (M2-R21-002).
  logs: ['najd_log_list', 'najd_log_read'],
  delegate: ['najd_delegate'],
  // Added to a task when its first background sub-agent starts (M5); never part of a profile.
  subagents: ['najd_delegate_status', 'najd_delegate_cancel']
}
// Toolsets the model may load itself (najd_tools_load). "transcribe" follows attachments only.
const LOADABLE = ['library-export', 'plan', 'toolbox', 'webpreview', 'knowledge', 'extensions', 'chats', 'memory', 'skills', 'connections', 'library', 'files-read', 'files', 'files-manage', 'terminal', 'web', 'browser', 'media', 'video', 'mcp', 'delegate', 'python', 'office', 'process', 'desktop', 'screen', 'logs']
// Never unloaded: discovery/loading and the user's memory stay available for the whole run (M2-007).
const PERMANENT = new Set(['core', 'memory'])
// A delegated sub-agent reads and researches only (AP-001): no memory, no effects, no further delegation.
const DELEGATED_TOOLS = new Set(['najd_capabilities_search', 'najd_capabilities_details', 'najd_files_list', 'najd_files_read', 'najd_files_search', 'najd_toolbox',
  'najd_web_search', 'najd_web_extract', 'najd_library_read', 'najd_library_search', 'najd_skills_read'])
const MAX_TOOLS = 24
// A profile's own toolsets stay at or under 22 tools, leaving room for the MCP call and attachment tools that are
// added when connected or attached (M2-004, M2-R2-005).
const PROFILE_BASE_LIMIT = 22

// Local, inference-free intent rules (Arabic and English). Order matters only for the profile choice.
// Websites and web apps are built with code, so they choose the coding profile before design (owner request 2026-10-20).
// Only a request to make one counts: "open the Google site" is browsing, not building.
const WEBSITE = /\b(build|make|create|design|develop|code|redesign|need|want)\b[^.\n]{0,40}\b(website|web ?site|landing page|web ?app|webpage|web page|homepage|portfolio)\b|(سو|سوي|سوّي|ابن|ابني|صمم|صمّم|اصنع|طور|طوّر|أنشئ|انشئ|اعمل|بناء|تصميم|برمج|ابي|أبي|أبغى|ابغى|ودي)[^.\n]{0,30}(موقع|صفحة ويب|صفحة هبوط|لاندنق|لاندنج|متجر الكتروني|متجر إلكتروني|ويب سايت|تطبيق ويب)/i
const PROFILE_RULES = [
  ['coding', WEBSITE],
  ['office', /\b(excel|xlsx|spreadsheet|powerpoint|pptx|presentation|slides?|word document|docx|invoice|budget sheet)\b|اكسل|إكسل|جدول بيانات|عرض تقديمي|بريزنتيشن|بريسنتيشن|شرائح|سلايد|باوربوينت|وورد|مستند وورد|فاتورة|\b(convert|resize)\b[^\n]{0,60}\b(pdf|png|jpe?g|webp|csv|xlsx|docx|pptx|md|txt|image|picture|photo)\b|(حوّل|حول|غيّر صيغة|حجّم|صغّر)\s[^\n]{0,60}(pdf|png|jpe?g|webp|csv|صورة|صور|ملف)/i],
  ['coding', /\b(code|coding|program|script|function|bug|debug|compile|repo|repository|git|npm|python|javascript|typescript|api|sql|regex|refactor|unit test)\b|برمج|كود|سكربت|سكريبت|دالة|خطأ برمجي|مستودع|بايثون|جافاسكربت/i],
  ['design', /\b(design|logo|poster|banner|mockup|ui|ux|illustration|image|picture|icon|brand)\b|تصميم|صمم|شعار|لوقو|لوغو|بوستر|بانر|صورة|ايقونة|أيقونة|هوية بصرية/i],
  ['research', /\b(research|compare|comparison|find out|look up|sources|latest news|price of|prices)\b|ابحث|بحث عن|قارن|مقارنة|اسعار|أسعار|بكم|آخر الأخبار|مصادر/i]
]
const TOOLSET_RULES = [
  ['toolbox', /\b(calculate|calculation|total|sum of|average|mean|median|count|how many|compare|diff|duplicates?|csv|tsv|json|checksum|hash|days between|how many days|percent|percentage|inventory|largest files?)\b|احسب|حساب|كم عدد|كم يوم|كم مجموع|المجموع|الاجمالي|الإجمالي|المتوسط|قارن|مقارنة الملفات|الفرق بين|مكرر|مكررة|اكبر الملفات|أكبر الملفات|جدول بيانات|\bcsv\b/i],
  ['files', /\b(save|write|create|edit)\b.*\b(file|folder|document)\b|\b(file|folder)\b.*\b(save|write|create|edit)\b|احفظ|أنشئ ملف|انشئ ملف|سو ملف|سوي ملف|عدل الملف|عدّل/i],
  ['files-manage', /\b(rename|move|delete)\b.*\b(file|folder|document)s?\b|\b(file|folder)s?\b.*\b(rename|move|delete)\b|احذف|انقل الملف|انقل الملفات|غير اسم|رتب الملفات/i],
  ['terminal', /\b(powershell|command|terminal|cmd|install|run the|process)\b|أمر|الطرفية|باورشل|ثبت|شغل الأمر/i],
  ['browser', /\b(browser|website|open the site|sign in|log in|book|order online|tab)\b|المتصفح|الموقع|افتح موقع|سجل دخول|احجز|اطلب من/i],
  ['media', /\b(generate|draw|make|create)\b.*\b(image|picture|logo)\b|ارسم|ولد صورة|سو صورة|سوي صورة/i],
  ['video', /\b(generate|make|create)\b.*\bvideo\b|فيديو|مقطع/i],
  // Building a website: page previews to check the design, plus long-running builds and dev servers.
  ['webpreview', WEBSITE], ['process', WEBSITE], ['media', WEBSITE],
  // Finding and adding a missing skill, plugin or MCP server (owner request 2026-10-20).
  ['extensions', /\b(install|add|find|get)\b.*\b(skills?|plugins?|mcp|connectors?|integrations?|extensions?)\b|\bmcp\b|مهار|اضاف|إضاف|ثبت|حمل|نزل|اتصال/i],
  // Opening an app or Windows Settings (owner request 2026-10-20: "افتح دسكورد").
  ['desktop', /\b(open|launch)\b.*\b(app|program|settings|discord|spotify|steam|word|excel|outlook|teams|whatsapp|telegram)\b|افتح|افتحلي|شغل برنامج|شغّل برنامج/i]
]

function selectProfile({ text = '', pinned = null, last = null, attachmentKinds = [] } = {}) {
  if (pinned && profiles[pinned]) return { profile: pinned, reason: 'pinned', extra: extraToolsets(text) }
  const value = String(text).slice(0, 4000)
  const match = PROFILE_RULES.find(([, rule]) => rule.test(value))
  if (match) return { profile: match[0], reason: 'intent', extra: extraToolsets(value) }
  if (attachmentKinds.some(kind => ['xlsx', 'pptx'].includes(kind))) return { profile: 'office', reason: 'attachment', extra: extraToolsets(value) }
  if (last && profiles[last]) return { profile: last, reason: 'previous', extra: extraToolsets(value) }
  return { profile: 'general', reason: 'default', extra: extraToolsets(value) }
}
function extraToolsets(text) { return TOOLSET_RULES.filter(([, rule]) => rule.test(String(text).slice(0, 4000))).map(([name]) => name) }

// ready(name) -> boolean for a toolset; definitions: the runtime's tool definitions (by name).
function createToolsetManager({ definitions, ready, scope = 'main' }) {
  const byName = new Map(definitions.map(item => [item.name, item]))
  const active = [], loaded = [], removed = new Set()
  let limit = MAX_TOOLS // a lean run starts under a smaller limit and raises it as the task grows
  const allowedTool = name => scope === 'main' || DELEGATED_TOOLS.has(name)
  function addTool(name) {
    const definition = byName.get(name)
    if (!definition || !allowedTool(name)) return 'NOT_ALLOWED'
    if (active.includes(definition)) return 'ALREADY_LOADED'
    if (active.length >= limit) return 'TOOL_LIMIT'
    active.push(definition)
    return 'LOADED'
  }
  function addToolset(name, { force = false } = {}) {
    if (!TOOLSETS[name]) return 'UNKNOWN_TOOLSET'
    if (!force && !ready(name)) return 'NOT_READY'
    const tools = TOOLSETS[name].filter(allowedTool)
    if (!tools.length) return 'NOT_ALLOWED'
    const missing = tools.filter(tool => !active.some(item => item.name === tool))
    if (active.length + missing.length > limit) return 'TOOL_LIMIT'
    for (const tool of missing) addTool(tool)
    if (!loaded.includes(name)) loaded.push(name)
    return 'LOADED'
  }
  // Removes loaded toolsets and adds another in one step, only when the result fits (M2-007). Tools still needed by
  // another loaded toolset stay; core and memory are never removed.
  function replaceToolsets(unload, name, { force = false } = {}) {
    const removing = unload.filter(item => loaded.includes(item))
    if (unload.some(item => PERMANENT.has(item))) return 'NOT_ALLOWED'
    if (!TOOLSETS[name]) return 'UNKNOWN_TOOLSET'
    if (!force && !ready(name)) return 'NOT_READY'
    const keep = loaded.filter(item => !removing.includes(item))
    const kept = new Set(keep.flatMap(item => TOOLSETS[item]).concat(active.filter(item => !Object.values(TOOLSETS).flat().includes(item.name)).map(item => item.name)))
    const after = active.filter(item => kept.has(item.name))
    const adding = TOOLSETS[name].filter(allowedTool).filter(tool => !after.some(item => item.name === tool) && byName.has(tool))
    if (!adding.length && !TOOLSETS[name].some(tool => after.some(item => item.name === tool))) return 'NOT_ALLOWED'
    if (after.length + adding.length > limit) return 'TOOL_LIMIT'
    for (const item of removing) removed.add(item)
    removed.delete(name)
    active.splice(0, active.length, ...after, ...adding.map(tool => byName.get(tool)))
    loaded.splice(0, loaded.length, ...keep, ...(keep.includes(name) ? [] : [name]))
    return 'LOADED'
  }
  return {
    addTool, addToolset, replaceToolsets,
    setLimit: value => { limit = Math.max(1, Math.min(MAX_TOOLS, value)) },
    // Toolsets the model unloaded in this run; they come back only through an explicit najd_tools_load.
    wasUnloaded: name => removed.has(name),
    has: name => active.some(item => item.name === name),
    find: name => active.find(item => item.name === name),
    tools: () => active.slice(),
    loaded: () => loaded.slice(),
    // Ready toolsets the model could still load (shown in the profile block, never more than needed).
    loadable: () => LOADABLE.filter(name => !loaded.includes(name) && TOOLSETS[name].some(allowedTool) && ready(name) &&
      !(name === 'files-read' && loaded.includes('files'))),
    allowed: allowedTool
  }
}

module.exports = { TOOLSETS, LOADABLE, DELEGATED_TOOLS, MAX_TOOLS, PROFILE_BASE_LIMIT, profiles, selectProfile, extraToolsets, createToolsetManager }
