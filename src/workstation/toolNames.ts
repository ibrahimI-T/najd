// Short Arabic and English names of NAJD's agent tools for the conversation usage panel. A tool not listed here (an MCP tool, a newer
// tool) is shown by its own name without the najd_ prefix.
const NAMES: Record<string, [string, string]> = {
  najd_capabilities_search: ['بحث القدرات', 'Capability search'], najd_capabilities_details: ['تفاصيل القدرة', 'Capability details'],
  najd_library_read: ['قراءة المكتبة', 'Library read'], najd_library_search: ['بحث المكتبة', 'Library search'], najd_library_export: ['تصدير من المكتبة', 'Library export'],
  najd_chats_search: ['بحث المحادثات', 'Chat search'], najd_chats_read: ['قراءة محادثة', 'Chat read'], najd_skills_read: ['قراءة مهارة', 'Skill read'],
  najd_connections_apps: ['تطبيقات الاتصال', 'Connected apps'], najd_files_list: ['عرض الملفات', 'List files'], najd_files_read: ['قراءة ملف', 'Read file'],
  najd_files_search: ['بحث الملفات', 'Search files'], najd_toolbox: ['صندوق الأدوات', 'Toolbox'], najd_files_write: ['كتابة ملف', 'Write file'],
  najd_files_edit: ['تعديل ملف', 'Edit file'], najd_files_move: ['نقل ملف', 'Move file'], najd_files_delete: ['حذف ملف', 'Delete file'],
  najd_web_search: ['بحث الويب', 'Web search'], najd_web_extract: ['قراءة صفحة ويب', 'Web page read'], najd_image_generate: ['توليد صورة', 'Image generation'],
  najd_video_generate: ['توليد فيديو', 'Video generation'], najd_video_status: ['حالة الفيديو', 'Video status'], najd_video_cancel: ['إلغاء الفيديو', 'Video cancel'],
  najd_memory: ['الذاكرة', 'Memory'], najd_delegate: ['وكيل فرعي', 'Sub-agent'], najd_delegate_status: ['حالة الوكيل الفرعي', 'Sub-agent status'],
  najd_delegate_cancel: ['إيقاف الوكيل الفرعي', 'Sub-agent stop'], najd_terminal_run: ['الطرفية', 'Terminal'], najd_video_transcribe: ['تفريغ فيديو', 'Video transcript'],
  najd_browser: ['المتصفح', 'Browser'], najd_mcp_call: ['أداة MCP', 'MCP tool'], najd_python_run: ['تشغيل Python', 'Python'], najd_blender_run: ['Blender (ثلاثي الأبعاد)', 'Blender (3D)'], najd_android_build: ['بناء تطبيق أندرويد', 'Android build'],
  najd_process_start: ['تشغيل عملية', 'Start process'], najd_process_list: ['العمليات', 'Processes'], najd_process_output: ['مخرجات العملية', 'Process output'],
  najd_process_stop: ['إيقاف عملية', 'Stop process'], najd_desktop_windows: ['نوافذ ويندوز', 'Windows list'], najd_desktop_open: ['فتح تطبيق', 'Open app'],
  najd_desktop_read: ['قراءة نافذة', 'Read window'], najd_desktop_act: ['التحكم بنافذة', 'Act in window'], najd_office_review: ['مراجعة مستند', 'Document review'],
  najd_screen_capture: ['لقطة شاشة', 'Screenshot'], najd_log_list: ['السجلات', 'Logs'], najd_log_read: ['قراءة سجل', 'Log read'], najd_web_preview: ['معاينة ويب', 'Web preview'],
  najd_knowledge_search: ['قاعدة المعرفة', 'Knowledge search'], najd_extensions_search: ['بحث الإضافات', 'Extension search'], najd_skill_save: ['حفظ مهارة', 'Save skill'],
  najd_extension_install: ['تثبيت إضافة', 'Install extension'], najd_workstation: ['مساحة العمل', 'Workstation'], najd_plan: ['الخطة', 'Plan'], najd_tools_load: ['تحميل أدوات', 'Load tools']
}
export function toolName(name: string, ar: boolean): string {
  const known = NAMES[name]
  if (known) return known[ar ? 0 : 1]
  return name.replace(/^najd_/, '').replace(/_/g, ' ')
}
