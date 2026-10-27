// The "/" menu of the composer: typing "/" at the start of a message lists what can be done from the keyboard (start a chat, open a settings page, set the access
// mode, pin a profile, choose the reasoning effort, insert a skill). This module is only the list and the filtering; the menu itself is SlashMenu.tsx.
// A command never sends anything: choosing one runs a local action or puts plain text in the message box that the owner can read and edit before sending.

export type SlashGroup = 'chat' | 'settings' | 'access' | 'profile' | 'effort' | 'skill' | 'plugin'
export type SlashAction = { kind: 'insert'; text: string } | { kind: 'run'; run: () => void }
export interface SlashItem {
  id: string
  group: SlashGroup
  command: string          // what is typed after the slash
  label: string
  hint: string
  keywords: string         // extra words that find it (both languages)
  disabled?: string        // why it cannot be used right now (shown instead of running it)
  action: SlashAction
}

export const GROUP_ORDER: SlashGroup[] = ['chat', 'settings', 'access', 'profile', 'effort', 'skill', 'plugin']
export const GROUP_LABEL: Record<SlashGroup, { ar: string; en: string }> = {
  chat: { ar: 'المحادثة', en: 'Chat' },
  settings: { ar: 'فتح صفحة', en: 'Open a page' },
  access: { ar: 'الصلاحيات', en: 'Access' },
  profile: { ar: 'نوع المهمة', en: 'Task type' },
  effort: { ar: 'عمق التفكير', en: 'Reasoning effort' },
  skill: { ar: 'المهارات', en: 'Skills' },
  plugin: { ar: 'أوامر الإضافات', en: 'Plugin commands' }
}

// "/co" -> "co"; "/" -> ""; anything that is not a lone first word starting with a slash (a path, a sentence, "/read file") -> null.
export function slashQuery(draft: string): string | null {
  const match = /^\/([^\s/\\]*)$/.exec(draft)
  return match ? match[1].toLowerCase() : null
}

const norm = (text: string) => text.toLowerCase().normalize('NFKD').replace(/[ً-ٰٟ]/g, '')

// Commands that start with the typed text first, then those whose command, label or keywords contain it. The order inside a group is the order given.
export function filterSlash(items: SlashItem[], query: string): SlashItem[] {
  const q = norm(query)
  if (!q) return [...items].sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group))
  const scored: { item: SlashItem; rank: number; order: number }[] = []
  items.forEach((item, order) => {
    const command = norm(item.command)
    const rank = command.startsWith(q) ? 0 : command.split('-').some(part => part.startsWith(q)) ? 1 : norm(item.label + ' ' + item.keywords).includes(q) ? 2 : -1
    if (rank >= 0) scored.push({ item, rank, order })
  })
  return scored.sort((a, b) => a.rank - b.rank || GROUP_ORDER.indexOf(a.item.group) - GROUP_ORDER.indexOf(b.item.group) || a.order - b.order).map(entry => entry.item)
}

export interface SlashContext {
  language: 'ar' | 'en'
  hasConversation: boolean
  busy: boolean
  skills: { id: string; name: string; description: string }[]
  pluginCommands?: { command: string; pluginName: string; description: string; body: string }[]   // commands of installed plugins: they put their text in the message box
  efforts: string[]                       // the reasoning efforts the selected model offers
  actions: {
    newChat(): void
    openPage(section: string): void
    setAccess(mode: 'ask' | 'approve' | 'full'): void
    pinProfile(profile: string | null): void
    setEffort(effort: string): void
  }
}

const PAGES: { section: string; command: string; ar: string; en: string; words: string }[] = [
  { section: 'models', command: 'models', ar: 'النماذج والحسابات', en: 'Models and accounts', words: 'model provider chatgpt kimi ollama نموذج مزود' },
  { section: 'tools', command: 'tools', ar: 'الأدوات', en: 'Tools', words: 'tool أداة ادوات' },
  { section: 'skills', command: 'skills', ar: 'المهارات', en: 'Skills', words: 'skill مهارة مهارات' },
  { section: 'plugins', command: 'plugins', ar: 'الإضافات والخوادم', en: 'Plugins and servers', words: 'plugin mcp server اضافة خادم' },
  { section: 'browser', command: 'browser', ar: 'المتصفح', en: 'Browser', words: 'chrome edge extension متصفح اضافة' },
  { section: 'accounts', command: 'accounts', ar: 'الحسابات المفوّضة', en: 'Authorized accounts', words: 'login password sign in حساب تسجيل دخول' },
  { section: 'memory', command: 'memory', ar: 'الذاكرة', en: 'Memory', words: 'remember ذاكرة' },
  { section: 'knowledge', command: 'knowledge', ar: 'قواعد المعرفة', en: 'Knowledge bases', words: 'documents مستندات معرفة' },
  { section: 'connections', command: 'connections', ar: 'الاتصالات', en: 'Connections', words: 'connect اتصال' },
  { section: 'permissions', command: 'permissions', ar: 'الصلاحيات والمجلدات', en: 'Permissions and folders', words: 'folder access صلاحيات مجلد' },
  { section: 'general', command: 'settings', ar: 'الإعدادات', en: 'Settings', words: 'preferences language theme إعدادات لغة' }
]
const PROFILES: { id: string | null; command: string; ar: string; en: string; words: string }[] = [
  { id: null, command: 'profile-auto', ar: 'تلقائي', en: 'Automatic', words: 'auto default تلقائي' },
  { id: 'general', command: 'profile-general', ar: 'عام', en: 'General', words: 'general عام' },
  { id: 'coding', command: 'profile-coding', ar: 'برمجة', en: 'Coding', words: 'code program برمجة كود' },
  { id: 'design', command: 'profile-design', ar: 'تصميم', en: 'Design', words: 'design image تصميم' },
  { id: 'research', command: 'profile-research', ar: 'بحث', en: 'Research', words: 'research search بحث' },
  { id: 'office', command: 'profile-office', ar: 'مستندات وجداول', en: 'Office documents', words: 'word excel powerpoint office اكسل وورد' }
]
const EFFORTS: { id: string; ar: string; en: string }[] = [
  { id: 'auto', ar: 'تلقائي', en: 'Automatic' }, { id: 'low', ar: 'منخفض', en: 'Low' }, { id: 'medium', ar: 'متوسط', en: 'Medium' }, { id: 'high', ar: 'عالٍ', en: 'High' }
]

export function buildSlashItems(context: SlashContext): SlashItem[] {
  const ar = context.language === 'ar'
  const pick = (item: { ar: string; en: string }) => (ar ? item.ar : item.en)
  const items: SlashItem[] = []
  items.push({ id: 'new', group: 'chat', command: 'new', label: ar ? 'محادثة جديدة' : 'New chat', hint: ar ? 'ابدأ محادثة فارغة' : 'Start an empty conversation', keywords: 'new chat clear محادثة جديدة',
    disabled: context.busy ? (ar ? 'انتظر انتهاء المهمة الحالية' : 'Wait for the current task to finish') : undefined, action: { kind: 'run', run: context.actions.newChat } })
  items.push({ id: 'read', group: 'chat', command: 'read', label: ar ? 'قراءة ملف' : 'Read a file', hint: ar ? 'يضع /read في الرسالة؛ اكتب بعده مسار الملف' : 'Puts /read in the message; type the file path after it', keywords: 'file path open ملف مسار',
    action: { kind: 'insert', text: '/read ' } })
  for (const page of PAGES) items.push({ id: 'page-' + page.section, group: 'settings', command: page.command, label: pick(page), hint: ar ? 'يفتح هذه الصفحة' : 'Opens this page', keywords: page.words,
    action: { kind: 'run', run: () => context.actions.openPage(page.section) } })
  const modes: { id: 'ask' | 'approve' | 'full'; ar: string; en: string; hintAr: string; hintEn: string }[] = [
    { id: 'ask', ar: 'اسألني عن كل خطوة', en: 'Ask me for each step', hintAr: 'أي تغيير أو إجراء يحتاج موافقتك', hintEn: 'Any change or action needs your approval' },
    { id: 'approve', ar: 'وافق على الآمن تلقائيًا', en: 'Approve safe steps', hintAr: 'القراءة الآمنة تمر؛ الباقي يسألك', hintEn: 'Safe reads go through; the rest asks you' },
    { id: 'full', ar: 'وصول كامل', en: 'Full access', hintAr: 'ينفّذ بلا سؤال، عدا ما يطلب موافقتك دائمًا (كلمات المرور والمدفوعات)', hintEn: 'Runs without asking, except what always asks (passwords, payments)' }
  ]
  for (const mode of modes) items.push({ id: 'access-' + mode.id, group: 'access', command: 'access-' + mode.id, label: pick(mode), hint: ar ? mode.hintAr : mode.hintEn, keywords: 'access permission mode صلاحية وضع موافقة',
    action: { kind: 'run', run: () => context.actions.setAccess(mode.id) } })
  for (const profile of PROFILES) items.push({ id: profile.command, group: 'profile', command: profile.command, label: pick(profile), hint: ar ? 'يثبّت نوع المهمة لهذه المحادثة' : 'Pins the task type for this conversation', keywords: 'profile type mode نوع مهمة ' + profile.words,
    disabled: context.hasConversation ? undefined : (ar ? 'أرسل رسالة أولًا ليكون عندك محادثة' : 'Send a message first so there is a conversation'), action: { kind: 'run', run: () => context.actions.pinProfile(profile.id) } })
  for (const effort of EFFORTS.filter(item => item.id === 'auto' || context.efforts.includes(item.id))) items.push({ id: 'effort-' + effort.id, group: 'effort', command: 'effort-' + effort.id, label: pick(effort),
    hint: ar ? 'عمق تفكير النموذج' : 'How deeply the model thinks', keywords: 'effort reasoning think thinking تفكير عمق جهد', action: { kind: 'run', run: () => context.actions.setEffort(effort.id) } })
  for (const skill of context.skills) items.push({ id: 'skill-' + skill.id, group: 'skill', command: 'skill-' + skill.id, label: skill.name, hint: skill.description.slice(0, 120), keywords: 'skill مهارة ' + skill.id,
    action: { kind: 'insert', text: ar ? `استخدم مهارة «${skill.name}» في: ` : `Use the skill "${skill.name}" for: ` } })
  // A plugin command only puts its prompt text in the message box (the owner edits and sends it); the argument placeholder is left for the owner to fill in.
  for (const command of context.pluginCommands || []) items.push({ id: 'plugin-' + command.command, group: 'plugin', command: command.command, label: command.command, hint: (command.description || command.pluginName).slice(0, 120),
    keywords: 'plugin command ' + command.pluginName + ' ' + command.description, action: { kind: 'insert', text: command.body.replace(/\$ARGUMENTS|\$\{ARGUMENTS\}/g, '').trimEnd() + ' ' } })
  return items
}
