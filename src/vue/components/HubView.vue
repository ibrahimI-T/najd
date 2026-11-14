<script setup lang="ts">
// Plugins and Skills (reference screenshots 5–6) over the verified package manager: install, update, enable, disable, roll back, remove,
// link an account after installing a service package, local import, market sources. Nothing installs without the review dialog.
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { BookOpen, ChevronDown, Pencil, X, ChevronLeft, ChevronRight, Download, FileText, FolderOpen, MessageSquare, MoreHorizontal, Plus, RefreshCw, RotateCcw, Search as SearchIcon, Settings2, ShieldCheck, Trash2, Wand2 } from 'lucide-vue-next'
import { usePrefs } from '../composables/usePrefs'
import { confirmAction } from '../composables/useConfirm'
import { canInstallPackage, canManagePackage, descriptionOf, filterEntries, nameOf, reasonText, stateLabel, type SortKey } from '../../workstation/catalogView'
import { PLUGIN_CATEGORIES, SKILL_CATEGORIES, type CapabilityKind, type CatalogEntry, type CatalogView, type LocalImportPlan, type PackagePlan, type SettingsRoute } from '../../workstation/types'
import { iconFor } from '../lib/icons'

const emit = defineEmits<{ use: [entry: CatalogEntry]; prompt: [text: string]; settings: [route: SettingsRoute]; go: [route: 'remote-control'] }>()
const { s, prefs } = usePrefs()
const lang = computed(() => prefs.language)
const NAMES: Record<string, [string, string]> = { installed: ['مثبت', 'Installed'], featured: ['مميزة', 'Featured'], finance: ['المالية', 'Finance'], productivity: ['الإنتاجية', 'Productivity'], 'creativity-design': ['الإبداع والتصميم', 'Creativity & Design'], '3d': ['ثلاثي الأبعاد', '3D'],
  'developer-tools': ['أدوات المطورين', 'Developer Tools'], research: ['البحث', 'Research'], legal: ['قانوني', 'Legal'], personal: ['شخصي', 'Personal'], academic: ['أكاديمي', 'Academic'], marketing: ['التسويق', 'Marketing'], engineering: ['الهندسة', 'Engineering'], creative: ['إبداعي', 'Creative'] }
const view = ref<CatalogView | null>(null), kind = ref<CapabilityKind>('plugin'), category = ref('installed'), query = ref(''), sort = ref<SortKey>('relevance')
const syncing = ref(false), failure = ref<string | null>(null), menu = ref(false), adding = ref(false), source = ref('')
const details = ref<CatalogEntry | null>(null), plan = ref<PackagePlan | null>(null), localPlan = ref<LocalImportPlan | null>(null), signin = ref<CatalogEntry | null>(null)
const tokens = ref<Record<string, string>>({}), linkState = ref<Record<string, string>>({})
const api = () => window.najdWorkstation!
const raw = (reason: unknown) => String((reason as Error)?.message || reason).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
const CODES: Record<string, [string, string]> = {
  RUNTIME_NOT_READY: ['تحتاج حزمة المستندات محركات نجد أولًا؛ جهّز المحركات ثم أعد المحاولة.', 'The document pack needs the NAJD engines first; prepare the engines, then try again.'],
  RUNTIME_DOWNLOAD_FAILED: ['تعذر تنزيل محركات نجد. تحقق من الاتصال وأعد المحاولة.', 'The NAJD engines could not be downloaded. Check the connection and try again.'],
  RUNTIME_NOT_PUBLISHED: ['محركات هذا الإصدار من نجد غير منشورة للتنزيل؛ النسخة المثبتة تحملها معها.', 'Engines for this NAJD build are not published for download; the installed app carries them.'],
  LOCAL_PACKAGE_SKILLS_MISSING: ['هذه الحزمة على الجهاز لا تحتوي مهارات يمكن لنجد استخدامها.', 'This package on the computer has no skills NAJD can use.'],
  PACKAGE_SOURCE_NOT_AVAILABLE: ['لا يوجد مصدر لتثبيت هذه الحزمة. زامن السوق أولًا.', 'There is no source to install this package from. Sync the market first.'],
  SKILL_ID_TAKEN: ['يوجد بالفعل حزمة أخرى بهذا المعرف.', 'Another package already uses this id.'],
  NOT_FOUND: ['لم يُعثر على دليل هذه المهارة؛ قد تكون معطلة.', 'This skill guide was not found; it may be disabled.'],
  FOLDER_OPEN_FAILED: ['تعذر فتح المجلد.', 'The folder could not be opened.']
}
const clean = (reason: unknown) => { const text = raw(reason), code = /^[A-Z_]+/.exec(text)?.[0] || ''; return CODES[code] ? s(...CODES[code]) + ' (' + code + ')' : text }
async function load() { try { view.value = await api().catalog() } catch (reason) { failure.value = clean(reason) } }
async function act(work: () => Promise<unknown>) { failure.value = null; try { await work(); await load() } catch (reason) { failure.value = clean(reason); if (details.value) fixNote.value = failure.value } }
async function sync() { syncing.value = true; failure.value = null; try { view.value = await api().sync() } catch (reason) { failure.value = clean(reason) } finally { syncing.value = false } }
let off: (() => void) | undefined
let timer: ReturnType<typeof setInterval> | undefined
const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && details.value) details.value = null }
onMounted(() => { void load(); off = window.najdWorkstation?.onChanged(event => { if (event === 'catalog') void load() }); timer = setInterval(() => { if (!document.hidden && !details.value && !plan.value && !localPlan.value) void load() }, 15000); window.addEventListener('keydown', onKey) })
onBeforeUnmount(() => { off?.(); if (timer) clearInterval(timer); window.removeEventListener('keydown', onKey) })
const categories = computed(() => kind.value === 'plugin' ? PLUGIN_CATEGORIES : SKILL_CATEGORIES)
const names = computed<Record<string, [string, string]>>(() => ({ ...NAMES, installed: (kind.value === 'skill' ? ['تمت الإضافة', 'Added'] : ['مثبت', 'Installed']) as [string, string] }))
const entries = computed(() => filterEntries(view.value?.entries || [], { kind: kind.value, category: query.value.trim() ? 'all' : category.value, query: query.value, sort: sort.value, lang: lang.value }))
const installed = computed(() => (view.value?.entries || []).filter(entry => entry.kind === kind.value && entry.categories.includes('installed')))
const sections = computed(() => categories.value.filter(item => item !== 'installed').map(item => ({ id: item, list: (view.value?.entries || []).filter(entry => entry.kind === kind.value && entry.categories.includes(item)) })).filter(section => section.list.length))
const label = (id: string) => names.value[id]?.[lang.value === 'ar' ? 0 : 1] || id
const isInstalled = (entry: CatalogEntry) => entry.packageInstalled || entry.layer === 'builtin' || entry.categories.includes('installed')
const publisher = (name: string) => name === 'You' ? s('أنت', 'You') : name
const meta = (entry: CatalogEntry) => entry.kind === 'skill' ? [entry.publisher.name ? s('من ', 'From ') + publisher(entry.publisher.name) : '', entry.downloads ? entry.downloads.toLocaleString(lang.value) + s(' مستخدم', ' users') : ''].filter(Boolean).join(' · ') : ''
const problem = (entry: CatalogEntry) => isInstalled(entry) && entry.state !== 'AVAILABLE' && entry.state !== 'UPDATE_AVAILABLE' ? (entry.state === 'DISABLED' ? s('معطلة', 'Disabled') : reasonText(entry.reason, lang.value) || s('غير جاهزة', 'Not ready')) : ''
async function prepare(entry: CatalogEntry) {
  if (entry.packageUrl && entry.sha256) plan.value = await api().planUrl(entry.packageUrl, entry.sha256, entry.packageFormat)
  else if (entry.localImportable) localPlan.value = await api().planLocal([entry.id])
  else throw new Error('PACKAGE_SOURCE_NOT_AVAILABLE')
}
function install() { const current = plan.value; if (!current) return; plan.value = null; void act(async () => { await api().install(current.planId); const fresh = await api().catalog(); const entry = fresh.entries.find(item => item.id === current.id); if (entry?.mcpServers?.length) signin.value = entry }) }
function installLocal() { const current = localPlan.value; if (!current) return; localPlan.value = null; void act(async () => { const result = await api().installLocal(current.planId); if (result.failed.length) throw new Error('LOCAL_IMPORT_PARTIAL: ' + result.failed.map(item => item.id + ':' + item.code).join(', ')) }) }
async function remove(entry: CatalogEntry) { if (await confirmAction(s('إزالة هذه الحزمة ومهاراتها من نجد؟', 'Remove this package and its skills from NAJD?'), s('إزالة', 'Remove'))) { details.value = null; void act(() => api().removePackage(entry.id)) } }
const TOKEN_PAGES: [RegExp, string, string][] = [[/github/i, 'GitHub', 'https://github.com/settings/personal-access-tokens/new'], [/notion/i, 'Notion', 'https://www.notion.so/profile/integrations'], [/linear/i, 'Linear', 'https://linear.app/settings/account/security'], [/slack/i, 'Slack', 'https://api.slack.com/apps']]
const tokenPage = (server: { name: string; url?: string }) => TOKEN_PAGES.find(([pattern]) => pattern.test((server.url || '') + server.name))
async function connect(entry: CatalogEntry, name: string) {
  try { const result = await api().connectPackageMcp(entry.id, name, tokens.value[name] || ''); tokens.value = { ...tokens.value, [name]: '' }; linkState.value = { ...linkState.value, [name]: result.state === 'connected' ? 'connected' : result.error || result.status || 'failed' } }
  catch (reason) { linkState.value = { ...linkState.value, [name]: clean(reason) } }
}
// What each card and its details can do (owner audit 2026-11-08: most cards were text with no action). A missing requirement names its fix:
// the document pack and the engines install from here; the others open the settings page that sets them up.
const guide = ref<{ id: string; text: string } | null>(null), guideFailure = ref<string | null>(null), fixing = ref<string | null>(null), fixNote = ref<string | null>(null)
function open(entry: CatalogEntry) { details.value = entry; guide.value = null; guideFailure.value = null; fixNote.value = null; editing.value = null }
// The owner's own saved skills (written by NAJD from repeated work) can be edited here: purpose and steps; saving installs the next version,
// so Roll back returns to the earlier wording (daily-use observation 2026-11-14: changing one step meant asking NAJD to save it again).
const personal = (entry: CatalogEntry) => entry.kind === 'skill' && (String(entry.source || '').startsWith('personal:') || (entry.publisher.name === 'You' && entry.id.startsWith('my-')))
const editing = ref<{ id: string; name: string; description: string; steps: string } | null>(null), editFailure = ref<string | null>(null), editSaving = ref(false)
async function beginEdit(entry: CatalogEntry) {
  editFailure.value = null; guide.value = null
  try { const value = await api().skillEditable(entry.id); editing.value = { id: value.id, name: value.name, description: value.description, steps: value.steps } } catch (reason) { editFailure.value = clean(reason) }
}
const editValid = computed(() => !!editing.value && editing.value.description.trim().length >= 10 && editing.value.description.trim().length <= 300 && editing.value.steps.trim().length >= 20 && editing.value.steps.trim().length <= 6000)
async function saveEdit() {
  if (!editing.value || !editValid.value) return
  editSaving.value = true; editFailure.value = null
  try { const saved = await api().skillEdit(editing.value.id, editing.value.description, editing.value.steps); editing.value = null; await load(); fixNote.value = s(`حُفظت المهارة (الإصدار ${saved.version}).`, `Skill saved (version ${saved.version}).`) }
  catch (reason) { editFailure.value = clean(reason) } finally { editSaving.value = false }
}
async function showGuide(entry: CatalogEntry) {
  guideFailure.value = null
  // The guide is shown without its front matter (the name and description lines are already in the dialog).
  try { const value = await api().skillGuide(entry.id); guide.value = { ...value, text: value.text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n+/, '') } } catch (reason) { guideFailure.value = clean(reason) }
}
const needs = (entry: CatalogEntry) => entry.state === 'NOT_READY' && entry.reason?.startsWith('NEEDS:') ? entry.reason.slice(6).split(',').filter(Boolean) : []
type Fix = { label: [string, string]; detail: [string, string]; action?: [string, string]; run?: () => Promise<unknown>; route?: SettingsRoute }
const FIXES: Record<string, Fix> = {
  office: { label: ['تثبيت حزمة المستندات', 'Install the document pack'], detail: ['Word وExcel وPDF وPowerPoint', 'Word, Excel, PDF and PowerPoint'], action: ['تثبيت', 'Install'], run: () => window.najdPack!.install() },
  web: { label: ['تجهيز محركات نجد', 'Prepare the NAJD engines'], detail: ['أدوات البحث وقراءة صفحات الويب', 'Web search and page reading tools'], action: ['تجهيز', 'Prepare'], run: () => window.najdRuntime!.prepare() },
  media: { label: ['إعداد مزود الصور', 'Set up an image provider'], detail: ['يحتاج مفتاح OpenAI API في النماذج', 'Needs an OpenAI API key in Models'], route: 'models' },
  mcp: { label: ['إضافة خادم MCP', 'Add an MCP server'], detail: ['من صفحة MCP في الإعدادات', 'From the MCP page in Settings'], route: 'mcp' },
  'github-account': { label: ['ربط GitHub', 'Link GitHub'], detail: ['خادم GitHub MCP برمز وصول', 'A GitHub MCP server with an access token'], route: 'mcp' },
  browser: { label: ['ربط إضافة المتصفح', 'Link the browser extension'], detail: ['من الصلاحيات والتحكم', 'From Permissions & Control'], route: 'permissions-control' },
  windows: { label: ['تشغيل التحكم بويندوز', 'Turn on Windows control'], detail: ['من الصلاحيات والتحكم', 'From Permissions & Control'], route: 'permissions-control' },
  gateway: { label: ['تشغيل محرك نجد', 'Start the NAJD engine'], detail: ['حالة المحرك في التشخيص', 'Engine state in Diagnostics'], route: 'diagnostics' },
  channels: { label: ['إعداد القنوات', 'Set up channels'], detail: ['Telegram وغيرها', 'Telegram and others'], route: 'channels' }
}
const UNAVAILABLE: Record<string, [string, string]> = { macos: ['تعمل على macOS فقط.', 'Works on macOS only.'], 'channel-setup': ['إعداد هذه القناة غير متوفر في نجد بعد؛ Telegram متاح من القنوات.', 'Setting up this channel is not available in NAJD yet; Telegram is available in Channels.'], 'mobile-toolchain': ['أدوات بناء تطبيقات الجوال غير متوفرة في نجد بعد.', 'Mobile build tools are not available in NAJD yet.'], '3d-runtime': ['محرك ثلاثي الأبعاد غير متوفر في نجد بعد.', 'The 3D runtime is not available in NAJD yet.'] }
async function fix(key: string) {
  const item = FIXES[key]
  if (!item) return
  if (item.route) { details.value = null; emit('settings', item.route); return }
  fixing.value = key; fixNote.value = null
  try {
    const result = await item.run!() as { state?: string; error?: string; errorCode?: string; lastError?: string; notPublished?: boolean } | null
    const code = result?.notPublished ? 'RUNTIME_NOT_PUBLISHED' : result?.state === 'failed' || result?.state === 'error' ? result.error || result.errorCode || result.lastError || 'FAILED' : null
    if (code) throw new Error(code)
    await load(); details.value = view.value?.entries.find(entry => entry.id === details.value?.id) || details.value
    if (details.value && needs(details.value).includes(key)) fixNote.value = s('بدأ التجهيز؛ قد يستغرق بضع دقائق، وتتحدث الحالة هنا تلقائيًا.', 'Setup started; it can take a few minutes, and the state updates here by itself.')
  } catch (reason) { fixNote.value = clean(reason) } finally { fixing.value = null }
}
const ready = (entry: CatalogEntry) => entry.state === 'AVAILABLE' || entry.state === 'UPDATE_AVAILABLE'
const engineParts = (entry: CatalogEntry) => entry.layer === 'gateway' && entry.kind === 'plugin'
const usable = (entry: CatalogEntry) => ready(entry) && !engineParts(entry)
const ENGINE_PAGES: Record<string, { route: SettingsRoute | 'remote-control'; label: [string, string] }> = {
  'najd-telegram': { route: 'channels', label: ['إعداد القناة', 'Set up the channel'] }, 'najd-device-pair': { route: 'remote-control', label: ['ربط جهاز', 'Pair a device'] },
  'najd-memory-core': { route: 'conversation-memory', label: ['إعدادات الذاكرة', 'Memory settings'] }, 'najd-session-memory': { route: 'conversation-memory', label: ['إعدادات الذاكرة', 'Memory settings'] },
  'najd-boot-context': { route: 'conversation-memory', label: ['إعدادات الذاكرة', 'Memory settings'] }, 'najd-bootstrap-files': { route: 'conversation-memory', label: ['إعدادات الذاكرة', 'Memory settings'] },
  'najd-command-logger': { route: 'diagnostics', label: ['السجلات', 'Logs'] }, 'najd-search': { route: 'diagnostics', label: ['حالة الأدوات', 'Tool state'] }
}
function openEngine(entry: CatalogEntry) { const page = ENGINE_PAGES[entry.id]; if (!page) return; details.value = null; if (page.route === 'remote-control') emit('go', 'remote-control'); else emit('settings', page.route) }
function tryInChat(entry: CatalogEntry) { details.value = null; emit('prompt', s(`ساعدني في: ${descriptionOf(entry, lang.value)} — `, `Help me with: ${descriptionOf(entry, lang.value)} — `)) }
function createSkill(entry: CatalogEntry) { details.value = null; emit('prompt', s(`أنشئ لي مهارة باسم «${nameOf(entry, lang.value)}» باستخدام najd-skill-creator واحفظها في مهاراتي. وظيفتها: `, `Create a skill named "${nameOf(entry, lang.value)}" with najd-skill-creator and save it to my skills. It should: `)) }
const scroll = (direction: number) => document.querySelector('.mk-pills-row')?.scrollBy({ left: direction * 240 * (lang.value === 'ar' ? -1 : 1), behavior: 'smooth' })
</script>

<template>
  <div class="mk" :data-hub-kind="kind">
    <div class="mk-top" role="tablist"><button v-for="value in (['plugin', 'skill'] as const)" :key="value" type="button" role="tab" :aria-selected="kind === value" :class="{ on: kind === value }" :data-hub-tab="value" @click="kind = value; category = 'installed'">{{ value === 'plugin' ? s('المكونات الإضافية', 'Plugins') : s('المهارات', 'Skills') }}</button></div>
    <div class="mk-col">
      <header class="mk-head"><div><h1>{{ kind === 'plugin' ? s('المكونات الإضافية', 'Plugins') : s('المهارات', 'Skills') }}</h1><p>{{ kind === 'plugin' ? s('اربط الأدوات الخارجية بنجد ليتمكن من استخدام التطبيقات والخدمات لإكمال المهام.', 'Connect external tools so NAJD can use apps and services to finish tasks.') : s('حوّل خبراتك إلى مهارات يمكنك إعادة استخدامها في أي وقت. اكتب / في المحادثة لاستخدام أي مهارة.', 'Turn your know-how into skills you can reuse any time. Type / in the chat to use one.') }}</p></div>
        <div class="mk-tools"><label class="mk-search"><SearchIcon :size="14" /><input v-model="query" type="search" :placeholder="kind === 'plugin' ? s('البحث عن إضافات', 'Search plugins') : s('البحث عن مهارات', 'Search skills')" :aria-label="s('بحث', 'Search')" /></label>
          <div class="w-menu-box"><button type="button" class="mk-pill strong" :aria-expanded="menu" data-hub="add" @click="menu = !menu">{{ kind === 'plugin' ? s('إضافة جديدة', 'Add new') : s('المهارات المخصصة', 'Custom skills') }}<ChevronDown :size="13" /></button>
            <div v-if="menu" class="w-menu end" role="menu">
              <button type="button" role="menuitem" class="w-menu-item" @click="menu = false; adding = true"><Plus :size="15" /><span>{{ s('من ملف أو مصدر سوق أو هذا الجهاز', 'From a file, a market source or this computer') }}</span></button>
              <button v-if="kind === 'skill'" type="button" role="menuitem" class="w-menu-item" @click="menu = false; emit('prompt', s('أنشئ لي مهارة جديدة باستخدام najd-skill-creator تفعل: ', 'Create a new skill with najd-skill-creator that does: '))"><Wand2 :size="15" /><span>{{ s('إنشاء مهارة بالمحادثة', 'Create a skill in chat') }}</span></button>
              <button v-if="kind === 'skill'" type="button" role="menuitem" class="w-menu-item" @click="menu = false; act(async () => { const problem = await api().openSkillsFolder(); if (problem) throw new Error('FOLDER_OPEN_FAILED') })"><FolderOpen :size="15" /><span>{{ s('مجلد المهارات المحلية', 'Local skills folder') }}</span></button>
              <button type="button" role="menuitem" class="w-menu-item" :disabled="syncing" @click="menu = false; sync()"><RefreshCw :size="15" /><span>{{ syncing ? s('يزامن…', 'Syncing…') : s('مزامنة السوق', 'Sync the market') }}</span></button>
              <div class="mk-sort"><span>{{ s('الترتيب', 'Sort') }}</span><select v-model="sort" class="w-select" :aria-label="s('الترتيب', 'Sort')"><option value="relevance">{{ s('الأنسب', 'Relevance') }}</option><option value="name">{{ s('الاسم', 'Name') }}</option><option value="downloads">{{ s('الأكثر تنزيلًا', 'Downloads') }}</option></select></div>
            </div></div></div></header>
      <div v-if="kind === 'skill'" class="mk-banner"><div class="mk-banner-art"><FileText :size="22" /></div><div><strong>{{ s('تحويل مستندات Office إلى مهارات', 'Turn Office documents into skills') }}</strong><small>{{ s('حوّل المستندات إلى مهارات لإعادة إنشاء أنماطها بسهولة.', 'Turn documents into skills that recreate their style.') }}</small></div><span class="w-grow" />
        <button type="button" class="mk-pill strong" @click="emit('prompt', s('حوّل هذا المستند إلى مهارة قابلة لإعادة الاستخدام باستخدام najd-skill-creator (أرفقت المستند): ', 'Turn the attached document into a reusable skill with najd-skill-creator: '))">{{ s('تحويل', 'Convert') }}</button></div>
      <div class="mk-pills"><button type="button" class="mk-arrow" :aria-label="s('السابق', 'Previous')" @click="scroll(-1)"><component :is="lang === 'ar' ? ChevronRight : ChevronLeft" :size="15" /></button>
        <div class="mk-pills-row" role="tablist"><button v-for="item in categories" :key="item" type="button" role="tab" :aria-selected="category === item" :class="{ on: category === item }" :data-category="item" @click="category = item">{{ label(item) }}</button></div>
        <button type="button" class="mk-arrow" :aria-label="s('التالي', 'Next')" @click="scroll(1)"><component :is="lang === 'ar' ? ChevronLeft : ChevronRight" :size="15" /></button></div>
      <div v-if="failure" class="w-banner error">{{ failure }}</div>
      <div v-if="view?.state === 'no-source'" class="w-banner"><span>{{ s('لا يوجد مصدر سوق مضبوط بعد. عناصر السوق وصف فقط ولا يمكن تثبيتها.', 'No marketplace source is set up yet; marketplace items are descriptions only.') }}</span><button type="button" class="w-btn" @click="adding = true">{{ s('إضافة مصدر', 'Add a source') }}</button></div>
      <div v-if="view?.state === 'offline' && !view.syncedAt" class="w-banner"><span>{{ s('لم تتم مزامنة السوق في هذه الجلسة بعد؛ تُعرض آخر نسخة محفوظة.', 'The market has not been synced in this session; the last saved copy is shown.') }}</span><button type="button" class="w-btn" :disabled="syncing" data-hub="sync-now" @click="sync()">{{ syncing ? s('يزامن…', 'Syncing…') : s('مزامنة الآن', 'Sync now') }}</button></div>
      <div v-else-if="view?.state === 'offline'" class="w-banner warn">{{ s('تعذر الوصول إلى بعض المصادر؛ يعرض نجد آخر نسخة كاملة محفوظة.', 'Some sources could not be reached; NAJD shows the last complete snapshot.') }}</div>
      <small v-if="view?.state === 'online'" class="h-sync" data-hub="synced">{{ s(`تمت قراءة ${view.pagesRead} صفحة من كل الفئات`, `${view.pagesRead} pages read across every category`) }}</small>
      <div v-if="!view" class="w-skeleton"><i /><i /><i /></div>
      <template v-else>
        <template v-for="block in (category === 'installed' && !query.trim() ? [{ id: 'installed', list: installed }, ...sections] : [{ id: query.trim() ? 'search' : category, list: entries }])" :key="block.id">
          <section :class="block.id === 'installed' || !(category === 'installed' && !query.trim()) ? '' : 'mk-section'">
            <h3 v-if="category === 'installed' && !query.trim() && block.id !== 'installed'">{{ label(block.id) }}</h3>
            <p v-if="!block.list.length" class="mk-empty">{{ block.id === 'installed' ? s('لا شيء مثبت بعد.', 'Nothing installed yet.') : s('لا توجد نتائج.', 'Nothing found.') }}</p>
            <div v-else class="mk-grid" :data-hub="block.id === category || block.id === 'search' ? 'grid' : undefined">
              <article v-for="entry in (category === 'installed' && !query.trim() && block.id !== 'installed' ? block.list.slice(0, 8) : block.list)" :key="entry.id + '@' + entry.version" :class="['mk-card', 'clickable', entry.kind]" :data-entry="entry.id" :data-state="entry.state" tabindex="0" @click="open(entry)" @keydown.enter.self="open(entry)">
                <div class="mk-icon" :style="{ color: iconFor(entry)[1], background: iconFor(entry)[1] + '22' }"><component :is="iconFor(entry)[0]" :size="20" :stroke-width="1.8" /></div>
                <div class="mk-text"><strong dir="auto">{{ nameOf(entry, lang) }}</strong><small v-if="meta(entry)" dir="auto">{{ meta(entry) }}</small><small v-else dir="auto" class="mk-line">{{ descriptionOf(entry, lang) }}</small></div>
                <div class="mk-end" @click.stop>
                  <button v-if="usable(entry)" type="button" class="mk-pill" :data-use="entry.id" @click="emit('use', entry)">{{ s('استخدام', 'Use') }}</button>
                  <button v-if="canInstallPackage(entry) && !isInstalled(entry)" type="button" class="mk-pill" :data-install="entry.id" @click="act(() => prepare(entry))">{{ entry.kind === 'skill' ? s('إضافة', 'Add') : s('تثبيت', 'Install') }}</button>
                  <button v-if="entry.packageInstalled && entry.state === 'UPDATE_AVAILABLE' && entry.installable" type="button" class="mk-pill" @click="act(() => prepare(entry))">{{ s('تحديث', 'Update') }}</button>
                  <button v-if="needs(entry).length" type="button" class="mk-pill warn" :data-setup="entry.id" @click="open(entry)">{{ s('إعداد', 'Set up') }}</button>
                  <button v-if="engineParts(entry) && ready(entry) && ENGINE_PAGES[entry.id]" type="button" class="mk-pill" :data-engine-page="entry.id" @click="openEngine(entry)">{{ s(...ENGINE_PAGES[entry.id].label) }}</button>
                  <small v-else-if="engineParts(entry) && ready(entry)" class="mk-meta">{{ s('ضمن المحرك', 'In the engine') }}</small>
                  <button v-if="entry.metadataOnly" type="button" class="mk-pill" :data-create="entry.id" @click="createSkill(entry)">{{ s('إنشاء', 'Create') }}</button>
                  <button type="button" class="mk-more" :aria-label="s('التفاصيل', 'Details')" :data-details="entry.id" @click="open(entry)"><MoreHorizontal :size="16" /></button></div>
                <p v-if="entry.kind === 'skill'" class="mk-desc" dir="auto">{{ descriptionOf(entry, lang) }}</p>
                <small v-if="problem(entry)" class="mk-problem" dir="auto">{{ problem(entry) }}</small>
              </article></div>
            <button v-if="category === 'installed' && !query.trim() && block.id !== 'installed' && block.list.length > 8" type="button" class="mk-showmore" @click="category = block.id">{{ s(`عرض ${block.list.length - 8} أخرى`, `Show ${block.list.length - 8} more`) }}</button>
          </section>
        </template>
      </template>
    </div>

    <div v-if="details" class="w-scrim" @mousedown.self="details = null"><div class="w-dialog" role="dialog" aria-modal="true" @keydown.esc="details = null"><header><h2>{{ nameOf(details, lang) }}</h2><span class="w-grow" /><button type="button" class="w-icon" :aria-label="s('إغلاق', 'Close')" data-details-close @click="details = null"><X :size="16" /></button></header>
      <div class="w-dialog-body h-details" data-hub="details"><p dir="auto">{{ descriptionOf(details, lang) }}</p>
        <div class="h-actions" data-details-actions>
          <button v-if="usable(details)" type="button" class="w-btn primary" data-details-use @click="emit('use', details!); details = null"><MessageSquare :size="15" />{{ s('استخدام في المحادثة', 'Use in chat') }}</button>
          <button v-if="details.kind === 'skill' && (details.layer === 'builtin' || details.packageInstalled)" type="button" class="w-btn" data-details-guide @click="showGuide(details!)"><BookOpen :size="15" />{{ s('عرض الدليل', 'Show the guide') }}</button>
          <button v-if="canInstallPackage(details) && !isInstalled(details)" type="button" class="w-btn primary" @click="act(() => prepare(details!)); details = null"><Download :size="15" />{{ details.kind === 'skill' ? s('إضافة', 'Add') : s('تثبيت', 'Install') }}</button>
          <button v-if="details.metadataOnly" type="button" class="w-btn primary" data-details-create @click="createSkill(details!)"><Wand2 :size="15" />{{ s('إنشاؤها كمهارة لي', 'Create it as my skill') }}</button>
          <button v-if="!usable(details) && !details.metadataOnly && !details.installable && details.layer !== 'builtin' && !engineParts(details)" type="button" class="w-btn" data-details-try @click="tryInChat(details!)"><MessageSquare :size="15" />{{ s('جرّبها في المحادثة', 'Try it in chat') }}</button></div>
        <div v-if="details.metadataOnly" class="w-banner">{{ s('هذه بطاقة وصف من السوق بلا حزمة قابلة للتثبيت. يمكن لنجد إنشاؤها لك كمهارة شخصية بعد موافقتك.', 'This is a marketplace description without an installable package. NAJD can write it for you as a personal skill after you approve it.') }}</div>
        <div v-else-if="engineParts(details) && ready(details)" class="w-banner">{{ s('جزء من محرك نجد ويعمل تلقائيًا؛ لا يُستخدم مباشرة في المحادثة.', 'Part of the NAJD engine and works by itself; it is not used directly in chat.') }}<button v-if="ENGINE_PAGES[details.id]" type="button" class="w-btn" @click="openEngine(details!)"><Settings2 :size="15" />{{ s(...ENGINE_PAGES[details.id].label) }}</button></div>
        <div v-else-if="details.layer === 'gateway' && !isInstalled(details)" class="w-banner">{{ s('جزء من محرك نجد؛ تظهر جاهزة عندما يعمل المحرك.', 'Part of the NAJD engine; it shows as ready when the engine runs.') }}<button type="button" class="w-btn" @click="details = null; emit('settings', 'diagnostics')"><Settings2 :size="15" />{{ s('حالة المحرك', 'Engine state') }}</button></div>
        <div v-else-if="details.layer === 'managed' && details.kind === 'skill' && !isInstalled(details)" class="w-banner">{{ s('تأتي مع حزمة من نجد غير موجودة على هذا الجهاز بعد. يمكنك تجربة المهمة في المحادثة بأدوات نجد الحالية.', 'Comes with a NAJD package that is not on this computer yet. You can try the task in chat with the tools NAJD has now.') }}</div>
        <section v-if="needs(details).length" class="w-section" data-details-needs><header><div><h3>{{ s('ما ينقصها لتعمل', 'What it needs to work') }}</h3></div></header>
          <div v-for="key in needs(details)" :key="key" class="w-row"><div><strong>{{ FIXES[key] ? s(...FIXES[key].label) : key }}</strong><small>{{ FIXES[key] ? s(...FIXES[key].detail) : UNAVAILABLE[key] ? s(...UNAVAILABLE[key]) : '' }}</small></div>
            <button v-if="FIXES[key]" type="button" class="w-btn" :data-fix="key" :disabled="fixing !== null" @click="fix(key)">{{ fixing === key ? s('يجري…', 'Working…') : FIXES[key].route ? s('فتح', 'Open') : s(...FIXES[key].action!) }}</button></div></section>
        <div v-if="fixNote" class="w-banner" data-fix-note>{{ fixNote }}</div>
        <div v-if="guideFailure" class="w-banner error">{{ guideFailure }}</div>
        <pre v-if="guide" class="h-guide" dir="auto" data-details-guide-text>{{ guide.text }}</pre>
        <div class="w-row"><div><strong>{{ s('الحالة', 'State') }}</strong><small>{{ reasonText(details.reason, lang) }}</small></div><span class="w-badge">{{ stateLabel(details.state, lang) }}</span></div>
        <div class="w-row"><div><strong>{{ s('المعرف والإصدار', 'ID and version') }}</strong></div><code dir="ltr">{{ details.id }}@{{ details.version }}</code></div>
        <div class="w-row"><div><strong>{{ s('الناشر', 'Publisher') }}</strong></div><span dir="auto">{{ publisher(details.publisher.name) }}</span></div>
        <div v-for="server in details.mcpServers || []" :key="server.name" class="w-row" :data-mcp-kind="server.kind || 'remote'"><div><strong>{{ 'MCP · ' + server.name }}</strong><small dir="ltr">{{ server.kind === 'stdio' ? [server.command, ...(server.args || [])].join(' ') : server.url }}</small><small v-if="server.kind === 'stdio' && server.envNames?.length">{{ s('يطلب متغيرات: ', 'Wants variables: ') + server.envNames.join(', ') }}</small><small v-if="linkState[server.name] && linkState[server.name] !== 'connected'" class="h-error">{{ linkState[server.name] }}</small></div>
          <span v-if="linkState[server.name] === 'connected'" class="w-badge green">{{ s('متصل', 'Connected') }}</span>
          <button v-else-if="server.kind === 'stdio'" type="button" class="w-btn" data-mcp-add :title="s('يعرض نجد الأمر كاملًا ويطلب موافقتك قبل التشغيل', 'NAJD shows the full command and asks for your approval before running it')" @click="connect(details!, server.name)">{{ s('إضافة وتشغيل', 'Add and run') }}</button>
          <button v-else type="button" class="w-btn" @click="signin = details; details = null">{{ s('ربط الحساب', 'Link account') }}</button></div>
        <section class="w-section"><header><div><h3>{{ s('الصلاحيات', 'Permissions') }}</h3></div></header><small v-if="!details.permissions.length">{{ s('لا تعلن صلاحيات.', 'Declares no permissions.') }}</small><div v-for="item in details.permissions" :key="item.id" class="w-row"><div><strong>{{ item.id }}</strong><small>{{ item.reason }}</small></div><ShieldCheck :size="15" /></div></section>
        <div v-if="details.layer === 'builtin'" class="w-row"><div><strong>{{ s('مفعلة', 'Enabled') }}</strong></div><button type="button" role="switch" :aria-label="s('مفعلة', 'Enabled')" :aria-checked="details.state !== 'DISABLED'" :class="['w-toggle', { on: details.state !== 'DISABLED' }]" @click="act(() => api().setBuiltinEnabled(details!.id, details!.state === 'DISABLED')); details = null"><i /></button></div>
        <section v-if="editing" class="w-section" data-skill-edit><header><div><h3>{{ s('تعديل المهارة', 'Edit the skill') }}</h3><p>{{ s('الاسم يبقى كما هو. يُحفظ إصدار جديد، ويمكنك الرجوع للإصدار السابق.', 'The name stays. A new version is saved; you can roll back to the earlier one.') }}</p></div></header>
          <label class="w-field"><span>{{ s('متى تُستخدم', 'When to use it') }}</span><textarea v-model="editing.description" rows="2" dir="auto" maxlength="300" data-skill-edit-description /></label>
          <label class="w-field"><span>{{ s('الخطوات', 'Steps') }}</span><textarea v-model="editing.steps" rows="10" dir="auto" maxlength="6000" data-skill-edit-steps /></label>
          <div v-if="editFailure" class="w-banner error">{{ editFailure }}</div>
          <div class="h-actions"><button type="button" class="w-btn primary" data-skill-edit-save :disabled="!editValid || editSaving" @click="saveEdit">{{ editSaving ? s('يحفظ…', 'Saving…') : s('حفظ', 'Save') }}</button>
            <button type="button" class="w-btn" :disabled="editSaving" @click="editing = null">{{ s('إلغاء', 'Cancel') }}</button></div></section>
        <div v-else-if="editFailure" class="w-banner error">{{ editFailure }}</div>
        <div v-if="canManagePackage(details)" class="h-actions">
          <button v-if="personal(details) && !editing" type="button" class="w-btn" data-skill-edit-open @click="beginEdit(details!)"><Pencil :size="15" />{{ s('تعديل', 'Edit') }}</button>
          <button type="button" class="w-btn" @click="act(() => api().setPackageEnabled(details!.id, details!.state === 'DISABLED')); details = null">{{ details.state === 'DISABLED' ? s('تفعيل', 'Enable') : s('تعطيل', 'Disable') }}</button>
          <button v-if="details.canRollback" type="button" class="w-btn" @click="act(() => api().rollback(details!.id)); details = null"><RotateCcw :size="15" />{{ s('الرجوع للإصدار السابق', 'Roll back') }}</button>
          <button type="button" class="w-btn danger" @click="remove(details!)"><Trash2 :size="15" />{{ s('إزالة', 'Remove') }}</button></div></div></div></div>

    <div v-if="adding" class="w-scrim" @mousedown.self="adding = false"><div class="w-dialog" role="dialog" aria-modal="true" @keydown.esc="adding = false"><header><h2>{{ s('إضافة', 'Add') }}</h2></header><div class="w-dialog-body">
      <section class="w-section"><header><div><h3>{{ s('استيراد الحزم المحلية', 'Import local packages') }}</h3><p>{{ s('يحوّل حزم المهارات الموجودة على هذا الجهاز إلى حزم NAJD ويمررها عبر فحص التثبيت نفسه. لا يستورد الحسابات أو المفاتيح.', 'Converts skill packages already on this computer into NAJD packages through the same verified install. Accounts and keys are not imported.') }}</p></div></header><button type="button" class="w-btn" data-hub="local-import" @click="act(async () => { localPlan = await api().planLocal(); adding = false })"><Download :size="15" />{{ s('فحص وتجهيز الكل', 'Scan and prepare all') }}</button></section>
      <section class="w-section"><header><div><h3>{{ s('حزمة من ملف', 'Package from a file') }}</h3></div></header><button type="button" class="w-btn" data-hub="file" @click="act(async () => { const value = await api().planFile(); if (value) { adding = false; plan = value } })"><FolderOpen :size="15" />{{ s('اختيار ملف', 'Choose a file') }}</button></section>
      <section class="w-section"><header><div><h3>{{ s('مصدر سوق', 'Marketplace source') }}</h3><p>{{ s('عنوان HTTPS لسجل يقدم صفحات الكتالوج.', 'The HTTPS address of a registry that serves catalog pages.') }}</p></div></header>
        <label class="w-field"><span>{{ s('العنوان', 'Address') }}</span><input v-model="source" dir="ltr" placeholder="https://" /></label>
        <button type="button" class="w-btn primary" :disabled="!source.trim()" @click="act(async () => { await api().addSource(source); source = ''; await sync() })">{{ s('إضافة ومزامنة', 'Add and sync') }}</button>
        <div v-for="item in view?.removableSources || []" :key="item" class="w-row"><div><strong>{{ item }}</strong></div><button type="button" class="w-icon" :aria-label="s('إزالة', 'Remove')" @click="act(() => api().removeSource(item))"><Trash2 :size="16" /></button></div></section>
    </div></div></div>

    <div v-if="plan" class="w-scrim" @mousedown.self="plan = null"><div class="w-dialog" role="dialog" aria-modal="true"><header><h2>{{ s('مراجعة التثبيت', 'Review the install') }}</h2></header><div class="w-dialog-body">
      <div class="w-row"><div><strong>{{ plan.displayName }}</strong><small>{{ plan.description }}</small></div><code dir="ltr">{{ plan.currentVersion ? plan.currentVersion + ' → ' : '' }}{{ plan.version }}</code></div>
      <div class="w-row"><div><strong>{{ s('الناشر', 'Publisher') }}</strong></div>{{ plan.publisher.name }}</div><div class="w-row"><div><strong>{{ s('الترخيص', 'License') }}</strong></div>{{ plan.license.spdx || s('غير محدد', 'Not stated') }}</div>
      <section class="w-section"><header><div><h3>{{ s('الصلاحيات المطلوبة', 'Requested permissions') }}</h3></div></header><small v-if="!plan.permissions.length">{{ s('لا شيء.', 'None.') }}</small><div v-for="item in plan.permissions" :key="item.id" class="w-row"><div><strong>{{ item.id }}</strong><small>{{ item.reason }}</small></div></div></section>
      <div v-if="plan.executables.length" class="w-banner warn">{{ s('تحتوي الحزمة ملفات تنفيذية: ', 'The package contains executables: ') }}<code dir="ltr">{{ plan.executables.join(', ') }}</code></div>
      <div v-if="plan.dependencies.some(item => item.satisfied === false)" class="w-banner warn">{{ s('بعض الاعتماديات غير مثبتة؛ ستكون الحزمة غير جاهزة حتى تُثبت.', 'Some dependencies are missing; the package stays not ready until they are installed.') }}</div></div>
      <footer><button type="button" class="w-btn" @click="plan = null">{{ s('إلغاء', 'Cancel') }}</button><button type="button" class="w-btn primary" data-hub="install" @click="install">{{ plan.currentVersion ? s('تحديث', 'Update') : s('تثبيت', 'Install') }}</button></footer></div></div>

    <div v-if="localPlan" class="w-scrim" @mousedown.self="localPlan = null"><div class="w-dialog" role="dialog" aria-modal="true"><header><h2>{{ s('مراجعة الاستيراد المحلي', 'Review local import') }}</h2></header><div class="w-dialog-body">
      <div class="w-banner">{{ s('تُثبت نسخ محلية باسم NAJD مع الاحتفاظ ببيان المصدر والترخيص. لا تُنسخ بيانات الحساب أو رموز الدخول.', 'Local NAJD-named copies are installed keeping source and license notices. Account data and access tokens are not copied.') }}</div>
      <div v-for="item in localPlan.packages" :key="item.id" class="w-row"><div><strong>{{ item.displayName }}</strong><small>{{ item.id }}@{{ item.version }}</small></div><span class="w-badge">{{ item.license.spdx || s('محلي', 'Local') }}</span></div></div>
      <footer><button type="button" class="w-btn" @click="localPlan = null">{{ s('إلغاء', 'Cancel') }}</button><button type="button" class="w-btn primary" data-hub="install-local" @click="installLocal">{{ localPlan.count === 1 ? s('تثبيت حزمة واحدة', 'Install 1 package') : s(`تثبيت ${localPlan.count} حزم`, `Install ${localPlan.count} packages`) }}</button></footer></div></div>

    <div v-if="signin" class="w-scrim" @mousedown.self="signin = null"><div class="w-dialog" role="dialog" aria-modal="true"><header><h2>{{ s('اربط حسابك', 'Link your account') }}</h2></header><div class="w-dialog-body">
      <p>{{ s('سجّل الدخول في الخدمة، أنشئ رمز وصول بأقل صلاحيات تحتاجها، ثم الصقه هنا. يُحفظ مشفرًا ولا يصل إلى النموذج.', 'Sign in to the service, create an access token with the least access you need, then paste it here. It is stored encrypted and never reaches the model.') }}</p>
      <section v-for="server in signin.mcpServers || []" :key="server.name" class="w-section"><header><div><h3>{{ tokenPage(server)?.[1] || server.name }}</h3><p>{{ server.url }}</p></div></header>
        <a v-if="tokenPage(server)" :href="tokenPage(server)![2]" target="_blank" rel="noreferrer noopener" data-token-page>{{ s('افتح صفحة إنشاء الرمز في ', 'Open the token page on ') + tokenPage(server)![1] }}</a>
        <div class="s-inline"><input v-model="tokens[server.name]" type="password" autocomplete="off" dir="ltr" :aria-label="s('رمز الوصول', 'Access token')" /><button type="button" class="w-btn primary" data-account-connect @click="connect(signin!, server.name)">{{ tokens[server.name] ? s('حفظ واتصال', 'Save and connect') : s('اتصال بدون رمز', 'Connect without a token') }}</button></div>
        <span v-if="linkState[server.name] === 'connected'" class="w-badge green">{{ s('متصل', 'Connected') }}</span><div v-else-if="linkState[server.name]" class="w-banner error">{{ linkState[server.name] }}</div></section>
      <small>{{ s('تسجيل الدخول المباشر عبر OAuth غير متوفر بعد؛ الربط حاليًا برمز وصول.', 'Direct OAuth sign-in is not available yet; linking uses an access token for now.') }}</small></div>
      <footer><button type="button" class="w-btn" @click="signin = null">{{ s('لاحقًا', 'Later') }}</button><button type="button" class="w-btn primary" @click="signin = null; load()">{{ s('تم', 'Done') }}</button></footer></div></div>
  </div>
</template>
