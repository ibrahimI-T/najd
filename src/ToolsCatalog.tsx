import { TOOL_DESCRIPTIONS_AR } from './toolDescriptionsAr'
import { useEffect, useState } from 'react'
import { Brain, Database, Download, History, FileText, Globe2, Image, Library, Monitor, Plug, Presentation, Search, ShieldCheck, Sparkles, SquareTerminal, Users, Video, Wrench } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

type Language = 'ar' | 'en'
// Every tool NAJD's agent can use, grouped as the runtime loads them, with whether it can run on this computer now
// and whether it reads freely or needs your approval. Read-only: the runtime alone decides what a run may use.
const GROUPS: Record<string, { ar: string; en: string; icon: LucideIcon }> = {
  'files-read': { ar: 'الملفات', en: 'Files', icon: FileText }, files: { ar: 'الملفات', en: 'Files', icon: FileText }, 'files-manage': { ar: 'الملفات', en: 'Files', icon: FileText },
  web: { ar: 'البحث في الإنترنت', en: 'Web search', icon: Search }, browser: { ar: 'المتصفح', en: 'Browser', icon: Globe2 },
  python: { ar: 'Python والكود', en: 'Python and code', icon: SquareTerminal }, terminal: { ar: 'سطر الأوامر', en: 'Command line', icon: SquareTerminal },
  process: { ar: 'العمليات الخلفية', en: 'Background processes', icon: SquareTerminal }, logs: { ar: 'العمليات الخلفية', en: 'Background processes', icon: SquareTerminal },
  desktop: { ar: 'سطح المكتب', en: 'Desktop', icon: Monitor }, screen: { ar: 'سطح المكتب', en: 'Desktop', icon: Monitor },
  office: { ar: 'Office والتصميم', en: 'Office and design', icon: Presentation }, media: { ar: 'الصور', en: 'Images', icon: Image },
  video: { ar: 'الفيديو', en: 'Video', icon: Video }, transcribe: { ar: 'الفيديو', en: 'Video', icon: Video },
  library: { ar: 'المكتبة والمرفقات', en: 'Library and attachments', icon: Library }, memory: { ar: 'الذاكرة', en: 'Memory', icon: Brain },
  delegate: { ar: 'الوكلاء المساعدون', en: 'Helper agents', icon: Users }, core: { ar: 'الاكتشاف', en: 'Discovery', icon: Sparkles },
  chats: { ar: 'المحادثات السابقة', en: 'Earlier chats', icon: History },
  extensions: { ar: 'إضافة قدرات جديدة', en: 'Add new capabilities', icon: Download },
  knowledge: { ar: 'قواعد المعرفة', en: 'Knowledge bases', icon: Library },
  mcp: { ar: 'أدوات MCP المتصلة', en: 'Connected MCP tools', icon: Plug }, connections: { ar: 'الاتصالات', en: 'Connections', icon: Plug }
}
const NAMES: Record<string, [string, string]> = {
  najd_files_list: ['عرض المجلدات', 'List folders'], najd_files_read: ['قراءة ملف', 'Read a file'], najd_files_search: ['البحث في الملفات', 'Search files'], najd_toolbox: ['أدوات الحساب والتحليل', 'Calculation and analysis helpers'],
  najd_files_write: ['إنشاء ملف', 'Write a file'], najd_files_edit: ['تعديل ملف', 'Edit a file'], najd_files_move: ['نقل ملف', 'Move a file'], najd_files_delete: ['حذف ملف', 'Delete a file'],
  najd_web_search: ['البحث في الإنترنت', 'Search the web'], najd_web_extract: ['قراءة صفحة ويب', 'Read a web page'], najd_browser: ['التصفح في تبويب نجد', 'Browse in a NAJD tab'],
  najd_python_run: ['تشغيل Python', 'Run Python'], najd_terminal_run: ['تشغيل أمر', 'Run a command'], najd_log_read: ['قراءة المخرجات', 'Read output'], najd_log_list: ['سجل المخرجات', 'Output logs'],
  najd_process_start: ['تشغيل عملية خلفية', 'Start a background process'], najd_process_list: ['العمليات الجارية', 'Running processes'],
  najd_process_output: ['مخرجات عملية', 'Process output'], najd_process_stop: ['إيقاف عملية', 'Stop a process'],
  najd_desktop_windows: ['النوافذ المفتوحة', 'Open windows'], najd_desktop_open: ['فتح برنامج', 'Open an app'], najd_desktop_read: ['قراءة نافذة', 'Read a window'],
  najd_desktop_act: ['التحكم بنافذة', 'Act in a window'], najd_screen_capture: ['لقطة شاشة', 'Screenshot'], najd_office_review: ['مراجعة ملفات Office', 'Review Office files'],
  najd_image_generate: ['توليد صورة', 'Generate an image'], najd_video_generate: ['توليد فيديو', 'Generate a video'], najd_video_status: ['حالة الفيديو', 'Video status'],
  najd_video_cancel: ['إلغاء فيديو', 'Cancel a video'], najd_video_transcribe: ['تفريغ صوت الفيديو', 'Transcribe a video'], najd_library_read: ['قراءة مرفق', 'Read an attachment'],
  najd_library_search: ['البحث في المرفقات', 'Search attachments'], najd_memory: ['الذاكرة', 'Memory'], najd_delegate: ['تكليف وكيل مساعد', 'Delegate to a helper'],
  najd_chats_search: ['البحث في المحادثات السابقة', 'Search earlier chats'], najd_chats_read: ['قراءة محادثة سابقة', 'Read an earlier chat'],
  najd_knowledge_search: ['البحث في قواعد المعرفة', 'Search knowledge bases'],
  najd_extensions_search: ['البحث عن مهارات وخوادم MCP', 'Find skills and MCP servers'], najd_extension_install: ['تثبيت مهارة أو خادم MCP', 'Install a skill or MCP server'], najd_skill_save: ['حفظ مهارة من عمل متكرر', 'Save a skill from repeated work'],
  najd_capabilities_search: ['اكتشاف القدرات', 'Find capabilities'], najd_capabilities_details: ['تفاصيل قدرة', 'Capability details'], najd_tools_load: ['تحميل أدوات', 'Load tools'], najd_plan: ['خطة المهمة', 'Task plan']
}
const EFFECTS: Record<string, [string, string]> = {
  read: ['يقرأ بدون سؤال', 'Reads freely'], 'change-with-approval': ['يحتاج موافقتك', 'Needs your approval'], 'read-with-approval': ['يحتاج موافقتك', 'Needs your approval'],
  'read-with-approval-vision-models': ['يحتاج موافقتك', 'Needs your approval'], 'read-only-allowlist-or-approval': ['آمن أو بموافقتك', 'Safe or with approval'],
  'stops-own-process': ['يوقف عملياته فقط', 'Stops its own only'],
  'install-with-approval': ['يثبّت بموافقتك دائمًا', 'Always installs with your approval'], 'read-vision-models': ['يقرأ للنماذج التي ترى الصور', 'Reads, for models that see images'], 'read-or-approval': ['يقرأ بحرية، والكتابة بموافقتك', 'Reads freely; typing needs approval']
}

export function ToolsCatalog({ language }: { language: Language }) {
  const ar = language === 'ar'
  const [tools, setTools] = useState<NajdAgentTool[] | null>(null)
  const [query, setQuery] = useState('')
  useEffect(() => { void window.najdAgent?.tools?.().then(setTools).catch(() => setTools([])) }, [])
  if (!window.najdAgent?.tools) return null
  const words = query.trim().toLowerCase()
  const label = (tool: NajdAgentTool) => NAMES[tool.name]?.[ar ? 0 : 1] || tool.name
  const shown = (tools || []).filter(tool => !words || `${label(tool)} ${tool.name} ${tool.description} ${TOOL_DESCRIPTIONS_AR[tool.name] || ''} ${tool.server || ''}`.toLowerCase().includes(words))
  const groups = new Map<string, NajdAgentTool[]>()
  for (const tool of shown) { const key = GROUPS[tool.group] ? (GROUPS[tool.group][ar ? 'ar' : 'en']) : tool.group; groups.set(key, [...(groups.get(key) || []), tool]) }
  const ready = (tools || []).filter(tool => tool.ready).length
  return <section className="market tools-catalog" aria-label={ar ? 'الأدوات' : 'Tools'}>
    <header className="market-head"><h3>{ar ? 'أدوات نجد' : 'NAJD tools'}</h3>
      <span className="market-installed on"><ShieldCheck size={14} />{ar ? `جاهز ${ready} من ${tools?.length ?? 0}` : `Ready ${ready} of ${tools?.length ?? 0}`}</span></header>
    <p className="tools-intro">{ar ? 'هذه الأدوات هي يدا نجد على جهازك. يختار منها ما تحتاجه مهمتك، ويضيف الجديد عند الحاجة، ويعمل وفق وضع الصلاحيات الذي تحدده.'
      : 'These tools are how NAJD works on your computer. It picks what each task needs, adds new ones when required, and always follows the permission mode you set.'}</p>
    <label className="market-search"><Search size={17} /><input type="search" value={query} maxLength={200} placeholder={ar ? 'ابحث في الأدوات…' : 'Search tools…'} onChange={event => setQuery(event.target.value)} /></label>
    {tools === null ? <p className="market-empty">{ar ? 'جاري القراءة…' : 'Loading…'}</p> : [...groups].map(([group, items]) => {
      const Icon = GROUPS[items[0].group]?.icon || Wrench
      return <div key={group} className="tools-group">
        <h4><Icon size={16} />{group}<small>{items.length}</small></h4>
        <div className="market-grid">{items.map(tool => <article key={tool.group + tool.name + (tool.server || '')} className="market-card" data-installed={tool.ready}>
          <div className="market-icon" aria-hidden="true">{tool.group === 'mcp' ? <Database size={24} strokeWidth={1.6} /> : <Icon size={24} strokeWidth={1.6} />}</div>
          <div className="market-text">
            <strong dir="auto">{label(tool)}</strong>
            <p dir="auto">{tool.server ? `${tool.server} · ` : ''}{ar && !tool.server ? TOOL_DESCRIPTIONS_AR[tool.name] || tool.description : tool.description}</p>
            <div className="market-foot"><span className={'market-status' + (tool.ready ? ' on' : '')}>{tool.ready ? (ar ? 'جاهز' : 'Ready') : (ar ? 'غير جاهز على هذا الجهاز' : 'Not ready on this computer')}</span>
              <span className="tool-effect">{EFFECTS[tool.effect]?.[ar ? 0 : 1] || tool.effect}</span></div>
          </div>
        </article>)}</div>
      </div>
    })}
  </section>
}
