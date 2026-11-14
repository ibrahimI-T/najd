<script setup lang="ts">
// Settings: searchable navigation on one side, the chosen page on the other (reference screenshots 7–8).
import { computed, ref } from 'vue'
import { Trash2 } from 'lucide-vue-next'
import { usePrefs } from '../composables/usePrefs'
import type { ProviderState } from '../composables/useProviders'
import { ZOOMS, type Prefs } from '../../workstation/prefs'
import type { SettingsRoute } from '../../workstation/types'
import ProviderSetupView from './ProviderSetupView.vue'
import AccountsPage from './settings/AccountsPage.vue'
import PermissionsPage from './settings/PermissionsPage.vue'
import ServicePages from './settings/ServicePages.vue'
import LibraryPage from './settings/LibraryPage.vue'

const props = defineProps<{ route: SettingsRoute; providers: ProviderState }>()
const emit = defineEmits<{ route: [route: SettingsRoute]; openChat: [id: string] }>()
const { s, prefs, change } = usePrefs()
const NAV: { id: SettingsRoute; ar: string; en: string; words?: string }[] = [
  { id: 'account-security', ar: 'الحساب والأمان', en: 'Account & Security', words: 'password login حساب كلمة' }, { id: 'models', ar: 'النماذج والمزودون', en: 'Models & Providers', words: 'provider key api نموذج مفتاح' },
  { id: 'notifications', ar: 'الإشعارات', en: 'Notifications' }, { id: 'appearance', ar: 'المظهر', en: 'Appearance', words: 'theme dark light font zoom language لغة خط' }, { id: 'shortcuts', ar: 'الاختصارات', en: 'Shortcuts', words: 'keyboard' },
  { id: 'feature-management', ar: 'إدارة الميزات', en: 'Feature Management', words: 'watermark suggestions' }, { id: 'quick-summon', ar: 'الاستدعاء السريع', en: 'Quick Summon' }, { id: 'startup-launch', ar: 'بدء التشغيل', en: 'Startup & Launch' },
  { id: 'permissions-control', ar: 'الصلاحيات والتحكم', en: 'Permissions & Control', words: 'files folders browser computer مجلد متصفح' }, { id: 'archived-tasks', ar: 'المهام المؤرشفة', en: 'Archived Tasks' }, { id: 'desktop-pet', ar: 'الرفيق المكتبي', en: 'Desktop Pet' },
  { id: 'general', ar: 'عام', en: 'General', words: 'update version legal تحديث' }, { id: 'subscription', ar: 'الاشتراك والفوترة', en: 'Subscription & Billing', words: 'gift card' }, { id: 'conversation-memory', ar: 'ذاكرة المحادثة', en: 'Conversation Memory', words: 'memory ذاكرة' },
  { id: 'chat-settings', ar: 'إعدادات المحادثة', en: 'Chat Settings', words: 'personality شخصية' }, { id: 'common-prompts', ar: 'الأوامر الشائعة', en: 'Common Prompts' }, { id: 'mcp', ar: 'خوادم MCP', en: 'MCP servers' }, { id: 'channels', ar: 'القنوات', en: 'Channels', words: 'telegram' }, { id: 'knowledge', ar: 'قواعد المعرفة', en: 'Knowledge bases' }, { id: 'library', ar: 'مكتبة المرفقات', en: 'Attachment library', words: 'files attachments images documents ملفات مرفقات صور' }, { id: 'diagnostics', ar: 'التشخيص والتراخيص', en: 'Diagnostics & Licenses', words: 'logs gateway debug export' }]
const SERVICE: Partial<Record<SettingsRoute, 'memory' | 'chat' | 'mcp' | 'channels' | 'knowledge' | 'general' | 'diagnostics' | 'notifications' | 'quick-summon' | 'startup-launch' | 'desktop-pet'>> = { 'conversation-memory': 'memory', 'chat-settings': 'chat', mcp: 'mcp', channels: 'channels', knowledge: 'knowledge', general: 'general', diagnostics: 'diagnostics', notifications: 'notifications', 'quick-summon': 'quick-summon', 'startup-launch': 'startup-launch', 'desktop-pet': 'desktop-pet' }
const SHORTCUTS: [string, string, string][] = [['Enter', 'إرسال', 'Send'], ['Shift+Enter', 'سطر جديد', 'New line'], ['/', 'الأوامر', 'Commands'], ['@', 'الإشارة إلى محادثة', 'Mention a chat'], ['Ctrl+N', 'مهمة جديدة', 'New task'], ['Ctrl+B', 'طي الشريط', 'Collapse the rail'], ['Ctrl+,', 'الإعدادات', 'Settings'], ['Escape', 'إغلاق', 'Close']]
// Group headings in the list (like the reference app's "Subscription" and "Personalization"): a heading shows before the first item of its
// group, and only while the list is not filtered by a search.
const GROUPS: Partial<Record<SettingsRoute, [string, string]>> = { subscription: ['الاشتراك', 'Subscription'], 'conversation-memory': ['التخصيص', 'Personalization'], mcp: ['التكاملات', 'Integrations'], diagnostics: ['النظام', 'System'] }
const query = ref(''), newPrompt = ref('')
const nav = computed(() => { const word = query.value.trim().toLowerCase(); return NAV.filter(item => !word || [item.ar, item.en, item.words].some(field => field?.toLowerCase().includes(word))) })
const title = computed(() => NAV.find(item => item.id === props.route) || NAV[3])
const ar = computed(() => prefs.language === 'ar')
const seg = <T extends string>(options: { value: T; label: string }[]) => options
const subscriptions = computed(() => props.providers.catalog.value.filter(item => item.kind === 'subscription' && item.configured))
function openConsole(id: string) { void window.najdProviders?.openConsole(id) }
function editPrompt(index: number, text: string) { const clean = text.trim(); change({ prompts: clean ? prefs.prompts.map((item, position) => position === index ? clean.slice(0, 4000) : item) : prefs.prompts.filter((_, position) => position !== index) }) }
function addPrompt() { change({ prompts: [...prefs.prompts, newPrompt.value.trim()].slice(0, 100) }); newPrompt.value = '' }
</script>

<template>
  <div class="s-layout" :data-settings="route">
    <nav class="s-nav" :aria-label="s('الإعدادات', 'Settings')">
      <label class="w-search"><input v-model="query" type="search" :placeholder="s('ابحث في الإعدادات', 'Search settings')" :aria-label="s('ابحث في الإعدادات', 'Search settings')" /></label>
      <template v-for="item in nav" :key="item.id"><span v-if="!query.trim() && GROUPS[item.id]" class="s-nav-group" aria-hidden="true">{{ ar ? GROUPS[item.id]![0] : GROUPS[item.id]![1] }}</span>
        <button type="button" :data-settings-route="item.id" :aria-current="route === item.id ? 'page' : undefined" :class="{ on: route === item.id }" @click="emit('route', item.id)">{{ ar ? item.ar : item.en }}</button></template></nav>
    <div class="w-page"><header class="w-page-head"><div><h1>{{ ar ? title.ar : title.en }}</h1></div></header>
      <ProviderSetupView v-if="route === 'models'" :providers="providers" />
      <AccountsPage v-else-if="route === 'account-security'" />
      <PermissionsPage v-else-if="route === 'permissions-control'" />
      <LibraryPage v-else-if="route === 'library'" />
      <ServicePages v-else-if="SERVICE[route]" :key="route" :page="SERVICE[route]!" />
      <section v-else-if="route === 'appearance'" class="w-section"><header><div><h3>{{ s('المظهر', 'Appearance') }}</h3></div></header>
        <div class="w-row"><div><strong>{{ s('السمة', 'Theme') }}</strong></div><div class="w-seg" role="radiogroup"><button v-for="option in seg([{ value: 'light', label: s('فاتح', 'Light') }, { value: 'system', label: s('النظام', 'System') }, { value: 'dark', label: s('داكن', 'Dark') }] as { value: Prefs['theme']; label: string }[])" :key="option.value" type="button" role="radio" :aria-checked="prefs.theme === option.value" :class="{ on: prefs.theme === option.value }" @click="change({ theme: option.value })">{{ option.label }}</button></div></div>
        <div class="w-row"><div><strong>{{ s('حجم الخط', 'Font size') }}</strong></div><div class="w-seg" role="radiogroup"><button v-for="size in [13, 14, 15, 16] as const" :key="size" type="button" role="radio" :aria-checked="prefs.fontSize === size" :class="{ on: prefs.fontSize === size }" @click="change({ fontSize: size })">{{ size }}</button></div></div>
        <div class="w-row"><div><strong>{{ s('الكثافة', 'Density') }}</strong></div><div class="w-seg" role="radiogroup"><button v-for="option in [{ value: 'comfortable', label: s('مريحة', 'Comfortable') }, { value: 'compact', label: s('مضغوطة', 'Compact') }] as { value: Prefs['density']; label: string }[]" :key="option.value" type="button" role="radio" :aria-checked="prefs.density === option.value" :class="{ on: prefs.density === option.value }" @click="change({ density: option.value })">{{ option.label }}</button></div></div>
        <div class="w-row"><div><strong>{{ s('اللغة', 'Language') }}</strong></div><div class="w-seg" role="radiogroup"><button v-for="option in [{ value: 'ar', label: 'العربية' }, { value: 'en', label: 'English' }] as { value: Prefs['language']; label: string }[]" :key="option.value" type="button" role="radio" :aria-checked="prefs.language === option.value" :class="{ on: prefs.language === option.value }" @click="change({ language: option.value })">{{ option.label }}</button></div></div>
        <div class="w-row"><div><strong>{{ s('تكبير الواجهة', 'UI zoom') }}</strong></div><div class="w-row-end"><div class="w-seg" role="radiogroup"><button v-for="zoom in ZOOMS" :key="zoom" type="button" role="radio" :aria-checked="prefs.zoom === zoom" :class="{ on: prefs.zoom === zoom }" @click="change({ zoom })">{{ Math.round(zoom * 100) + '%' }}</button></div><button type="button" class="w-btn" :disabled="prefs.zoom === 1" @click="change({ zoom: 1 })">{{ s('إعادة', 'Reset') }}</button></div></div></section>
      <section v-else-if="route === 'shortcuts'" class="w-section"><header><div><h3>{{ s('الاختصارات', 'Shortcuts') }}</h3></div></header><div v-for="[keys, arabic, english] in SHORTCUTS" :key="keys" class="w-row"><div><strong>{{ ar ? arabic : english }}</strong></div><kbd dir="ltr">{{ keys }}</kbd></div></section>
      <section v-else-if="route === 'feature-management'" class="w-section"><header><div><h3>{{ s('الميزات', 'Features') }}</h3></div></header>
        <div class="w-row"><div><strong>{{ s('اقتراحات المهام', 'Task suggestions') }}</strong><small>{{ s('تظهر في الشاشة الرئيسية.', 'Shown on the home screen.') }}</small></div><button type="button" role="switch" :aria-label="s('اقتراحات المهام', 'Task suggestions')" :aria-checked="prefs.taskSuggestions" :class="['w-toggle', { on: prefs.taskSuggestions }]" @click="change({ taskSuggestions: !prefs.taskSuggestions })"><i /></button></div>
        <div class="w-row"><div><strong>{{ s('علامة مائية للوسائط المولدة', 'Generated-media watermark') }}</strong><small>{{ s('يحفظ التفضيل؛ تطبيقه على الملفات لم يُبنَ بعد.', 'Stores the preference; applying it to files is not built yet.') }}</small></div><button type="button" role="switch" :aria-label="s('علامة مائية للوسائط المولدة', 'Generated-media watermark')" :aria-checked="prefs.watermarkMedia" :class="['w-toggle', { on: prefs.watermarkMedia }]" @click="change({ watermarkMedia: !prefs.watermarkMedia })"><i /></button></div></section>
      <section v-else-if="route === 'archived-tasks'" class="w-section"><header><div><h3>{{ s('المهام المؤرشفة', 'Archived tasks') }}</h3><p>{{ s('تجدها في مركز المهام عبر زر المؤرشفة.', 'Find them in Task Center with the Archived button.') }}</p></div></header><button type="button" class="w-btn" @click="emit('openChat', '')">{{ s('فتح مركز المهام', 'Open Task Center') }}</button></section>
      <section v-else-if="route === 'subscription'" class="w-section"><header><div><h3>{{ s('الاشتراك', 'Subscription') }}</h3><p>{{ s('نجد لا يبيع اشتراكًا. يدار الدفع لدى كل مزود.', 'NAJD sells no subscription. Billing is handled by each provider.') }}</p></div></header>
        <div v-for="item in subscriptions" :key="item.id" class="w-row"><div><strong>{{ item.name }}</strong></div><button type="button" class="w-btn" @click="openConsole(item.id)">{{ s('فتح الحساب', 'Open the account') }}</button></div></section>
      <section v-else-if="route === 'common-prompts'" class="w-section"><header><div><h3>{{ s('الأوامر الشائعة', 'Common prompts') }}</h3></div></header>
        <p class="s-note">{{ s('أوامرك المحفوظة تظهر في خانة الكتابة عند كتابة / وفي «أوامري» بالصفحة الرئيسية. عدّل النص هنا مباشرة.', 'Your saved prompts appear in the message box when you type / and under "My prompts" on the home screen. Edit the text here directly.') }}</p>
        <div v-for="(item, index) in prefs.prompts" :key="index" class="w-row"><textarea class="s-prompt-edit" rows="2" dir="auto" :value="item" :aria-label="s('نص الأمر', 'Prompt text')" data-prompt-edit @change="editPrompt(index, ($event.target as HTMLTextAreaElement).value)" /><button type="button" class="w-icon" :aria-label="s('حذف', 'Delete')" @click="change({ prompts: prefs.prompts.filter((_, position) => position !== index) })"><Trash2 :size="16" /></button></div>
        <div class="s-inline"><input v-model="newPrompt" :aria-label="s('أمر جديد', 'New prompt')" dir="auto" /><button type="button" class="w-btn" :disabled="!newPrompt.trim()" @click="addPrompt">{{ s('إضافة', 'Add') }}</button></div></section>
    </div>
  </div>
</template>
