<script setup lang="ts">
// The composer (reference screenshots 9–11): attach, execution profile, model picker, send/stop, the strip with project and plugins,
// category chips with starter prompts, the "/" command menu and "@" mentions of earlier chats.
import AttachmentThumb from './AttachmentThumb.vue'
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { ArrowUp, Bookmark, Box, CalendarClock, Check, ChevronDown, FolderKanban, FolderOpen, Hammer, LayoutDashboard, MessageSquareText, Mic, Microscope, Paperclip, Plus, Presentation, ShieldCheck, Square, Star, X } from 'lucide-vue-next'
import ModelPicker from './ModelPicker.vue'
import { usePrefs } from '../composables/usePrefs'
import { toast } from '../composables/useToast'
import { useVoiceInput } from '../composables/useVoiceInput'
import type { ProviderState } from '../composables/useProviders'
import type { AccessMode, Conversation } from '../composables/useConversation'
import { filterMentionable, insertMention, mentionQuery } from '../../mentions'
import { buildSlashItems, filterSlash, slashQuery, type SlashItem } from '../../slashCommands'
import type { CatalogEntry } from '../../workstation/types'

const preview = ref<{ id: string; src: string; name: string } | null>(null)
const props = defineProps<{ chat: Conversation; providers: ProviderState; home: boolean; focusSignal: number }>()
const emit = defineEmits<{ settings: [section: string]; hub: []; schedule: [text: string] }>()
const { s, prefs } = usePrefs()
const c = props.chat
const field = ref<HTMLTextAreaElement | null>(null)
const category = ref('recommended'), dragging = ref(false), index = ref(0), closed = ref<string | null>(null)
const accessOpen = ref(false), projectOpen = ref(false)
// Voice input: the transcription is added to the draft, never sent by itself.
const VOICE_ERRORS: Record<string, [string, string]> = {
  VOICE_NEEDS_KEY: ['الإدخال الصوتي يحتاج مفتاح OpenAI API من النماذج (التفريغ خدمة مدفوعة في حسابك).', 'Voice input needs an OpenAI API key in Models (transcription is a paid service on your account).'],
  MICROPHONE_UNAVAILABLE: ['تعذر الوصول إلى الميكروفون. تحقق من إعدادات الخصوصية في ويندوز.', 'The microphone could not be used. Check the Windows privacy settings.'],
  VOICE_EMPTY: ['لم يُسمع كلام في التسجيل.', 'No speech was heard in the recording.']
}
const voice = useVoiceInput(text => { c.draft.value = c.draft.value.trim() ? c.draft.value.trimEnd() + ' ' + text : text; void nextTick(() => field.value?.focus()) },
  code => toast(VOICE_ERRORS[code] ? s(...VOICE_ERRORS[code]) : s('تعذر تفريغ الصوت: ', 'Transcription failed: ') + code, code === 'VOICE_NEEDS_KEY' ? 'info' : 'error'))
const voiceLabel = computed(() => voice.state.value === 'recording' ? s(`إيقاف التسجيل (${voice.seconds.value} ث)`, `Stop recording (${voice.seconds.value}s)`) : voice.state.value === 'transcribing' ? s('يجري التفريغ…', 'Transcribing…') : voice.available.value === false ? s(VOICE_ERRORS.VOICE_NEEDS_KEY[0], VOICE_ERRORS.VOICE_NEEDS_KEY[1]) : s('إدخال صوتي (يُرسل التسجيل إلى OpenAI بمفتاحك عند الإيقاف)', 'Voice input (the recording goes to OpenAI with your key when you stop)'))
onMounted(() => { void voice.refresh() })
const skills = ref<{ id: string; name: string; description: string }[]>([]), commands = ref<NajdPluginCommand[]>([]), plugins = ref<CatalogEntry[]>([])
const work = computed(() => prefs.mode === 'work')
const CATEGORIES = [
  { id: 'recommended', icon: Star, ar: 'مقترح', en: 'Recommended', prompts: [['لخص ما يجب أن أعرفه عن هذا المشروع', 'Summarize what I should know about this project'], ['نظم لي خطة أسبوعي', 'Organize a plan for my week']] },
  { id: 'slides', icon: Presentation, ar: 'شرائح', en: 'Slides', prompts: [['أنشئ عرض PowerPoint من عشر شرائح عن: ', 'Create a ten-slide PowerPoint deck about: ']] },
  { id: 'research', icon: Microscope, ar: 'بحث', en: 'Research', prompts: [['ابحث بعمق مع مصادر عن: ', 'Research in depth, with sources: ']] },
  { id: 'build', icon: Hammer, ar: 'بناء', en: 'Build', prompts: [['ابن صفحة ويب تعمل محليًا عن: ', 'Build a working local web page for: ']] },
  { id: 'dashboard', icon: LayoutDashboard, ar: 'لوحة بيانات', en: 'Dashboard', prompts: [['أنشئ لوحة بيانات تفاعلية لهذه البيانات: ', 'Create an interactive dashboard for this data: ']] },
  { id: '3d', icon: Box, ar: 'ثلاثي الأبعاد', en: '3D', prompts: [['صمم مشهدًا ثلاثي الأبعاد لـ: ', 'Design a 3D scene for: ']] }
]
const ACCESS: { id: AccessMode; ar: string; en: string; hintAr: string; hintEn: string }[] = [
  { id: 'ask', ar: 'اسألني عن كل خطوة', en: 'Ask for each step', hintAr: 'أي تغيير يحتاج موافقتك', hintEn: 'Any change needs your approval' },
  { id: 'approve', ar: 'مرر الآمن تلقائيًا', en: 'Approve safe steps', hintAr: 'القراءة الآمنة تمر، والباقي يسألك', hintEn: 'Safe reads pass; the rest asks you' },
  { id: 'full', ar: 'وصول كامل', en: 'Full access', hintAr: 'عدا ما يحتاج موافقتك دائمًا', hintEn: 'Except what always needs your approval' }
]
const ar = computed(() => prefs.language === 'ar')
onMounted(() => {
  void window.najdPlugins?.commands().then(value => { commands.value = value }).catch(() => {})
  void window.najdSkills?.list().then(list => { skills.value = list.filter(item => item.enabled).map(({ id, name, description }) => ({ id, name, description })) }).catch(() => {})
  void window.najdWorkstation?.catalog().then(view => { plugins.value = view.entries.filter(entry => entry.kind === 'plugin' && entry.categories.includes('installed') && entry.state === 'AVAILABLE') }).catch(() => {})
  field.value?.focus()
})
watch(() => props.focusSignal, () => field.value?.focus())
const slashItems = computed(() => buildSlashItems({ language: prefs.language, hasConversation: !!c.activeSessionId.value, busy: c.busy.value || !!c.approval.value, skills: skills.value, pluginCommands: commands.value, prompts: prefs.prompts, efforts: props.providers.supported.value,
  actions: { newChat: () => c.newTask(), openPage: section => emit('settings', section), setAccess: mode => { c.accessMode.value = mode }, pinProfile: c.pinProfile, setEffort: value => props.providers.setEffort(value as NajdReasoningPreference) } }))
const suggestions = computed(() => {
  const text = c.draft.value, blocked = c.busy.value || !!c.approval.value || closed.value === text
  const slash = slashQuery(text)
  if (slash !== null && !blocked) { const items = filterSlash(slashItems.value, slash); if (items.length) return items.map((item: SlashItem) => ({ id: item.id, label: '/' + item.command + '  ' + item.label, hint: item.disabled || item.hint, disabled: !!item.disabled, choose: () => { if (item.disabled) return; index.value = 0; if (item.action.kind === 'insert') c.draft.value = item.action.text; else { c.draft.value = ''; item.action.run() } field.value?.focus() } })) }
  const mention = mentionQuery(text)
  if (mention === null || blocked) return []
  return filterMentionable(c.sessions.value, mention, c.activeSessionId.value).map(item => ({ id: item.id, label: item.title, hint: '', disabled: false, choose: () => { index.value = 0; c.mentions.value = [...c.mentions.value.filter(entry => entry.id !== item.id), { id: item.id, title: item.title }]; c.draft.value = insertMention(c.draft.value, item.title); field.value?.focus() } }))
})
const active = computed(() => Math.min(index.value, Math.max(0, suggestions.value.length - 1)))
const project = computed(() => c.chatProject.value ? c.projects.value.find(item => item.id === c.chatProject.value) : c.projects.value.find(item => !!c.activeSessionId.value && item.chats.includes(c.activeSessionId.value)))
const working = computed(() => c.busy.value && !!c.activeTaskId.value)
const accessNow = computed(() => ACCESS.find(item => item.id === c.accessMode.value)!)
const picked = computed(() => CATEGORIES.find(item => item.id === category.value)!)
const iconColor = (entry: CatalogEntry) => ({ pdf: '#e5484d', excel: '#30a46c', word: '#3e63dd', github: '#8e8c99' } as Record<string, string>)[entry.id.replace('najd-', '')] || '#0090ff'

function grow() { const element = field.value; if (!element) return; element.style.height = 'auto'; element.style.height = Math.min(240, element.scrollHeight) + 'px' }
watch(c.draft, async value => { index.value = 0; await nextTick(); if (!value && field.value) field.value.style.height = ''; else grow() })
async function attach() {
  if (!window.najdLibrary) return
  c.importing.value = true
  try { const added = await window.najdLibrary.import(); c.attachments.value = [...new Map([...c.attachments.value, ...added].map(item => [item.id, item])).values()].slice(0, 20) } catch { { c.errorCode.value = 'ATTACHMENT_READ_FAILED'; toast(s('تعذر قراءة الملف المرفق.', 'The attached file could not be read.'), 'error') } } finally { c.importing.value = false }
}
function drop(event: Event) { dragging.value = false; const data = (event as DragEvent).dataTransfer; if (data) void transfer(data, 'drop') }
async function transfer(data: DataTransfer, kind: 'drop' | 'paste') {
  const library = window.najdLibrary
  if (!library || c.locked.value) return
  c.importing.value = true
  try {
    const added = kind === 'drop' && data.files.length ? await library.importDropped(Array.from(data.files).slice(0, 8))
      : await Promise.all(Array.from(data.items).filter(item => item.kind === 'file' && /^image\/(png|jpeg|webp|gif|bmp)$/.test(item.type)).map(item => item.getAsFile()).filter((file): file is File => !!file).slice(0, 4).map(async (file, position) => library.importBytes(`Pasted image ${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}-${position + 1}.${file.type.split('/')[1].replace('jpeg', 'jpg')}`, await file.arrayBuffer())))
    c.attachments.value = [...new Map([...c.attachments.value, ...added].map(item => [item.id, item])).values()].slice(0, 20)
  } catch { { c.errorCode.value = 'ATTACHMENT_READ_FAILED'; toast(s('تعذر قراءة الملف المرفق.', 'The attached file could not be read.'), 'error') } } finally { c.importing.value = false }
}
function keydown(event: KeyboardEvent) {
  const list = suggestions.value
  if (list.length) {
    if (event.key === 'ArrowDown') { event.preventDefault(); index.value = (active.value + 1) % list.length; return }
    if (event.key === 'ArrowUp') { event.preventDefault(); index.value = (active.value - 1 + list.length) % list.length; return }
    if (event.key === 'Enter' || event.key === 'Tab') { event.preventDefault(); list[active.value].choose(); return }
    if (event.key === 'Escape') { event.preventDefault(); closed.value = c.draft.value; return }
  }
  if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void c.submit() }
}
function paste(event: ClipboardEvent) { if (event.clipboardData && Array.from(event.clipboardData.items).some(item => item.kind === 'file' && item.type.startsWith('image/'))) { event.preventDefault(); void transfer(event.clipboardData, 'paste') } }
</script>

<template>
  <div :class="['k-wrap', { home }]">
    <form :class="['k-box', { drag: dragging }]" data-composer @submit.prevent="c.submit()"
      @dragover="event => { if (event.dataTransfer && Array.from(event.dataTransfer.types).includes('Files')) { event.preventDefault(); dragging = true } }"
      @dragleave="event => { if (!(event.currentTarget as HTMLElement).contains(event.relatedTarget as Node)) dragging = false }"
      @drop.prevent="drop">
      <ul v-if="suggestions.length" id="k-suggest" class="k-suggest" role="listbox" :aria-label="s('اقتراحات', 'Suggestions')">
        <li v-for="(item, position) in suggestions.slice(0, 40)" :id="'k-' + item.id" :key="item.id" role="option" :aria-selected="position === active" :aria-disabled="item.disabled" :class="{ on: position === active }" @mouseenter="index = position" @mousedown.prevent="item.choose()"><span dir="auto">{{ item.label }}</span><small v-if="item.hint" dir="auto">{{ item.hint }}</small></li>
      </ul>
      <div v-if="c.attachments.value.length" class="k-files"><AttachmentThumb v-for="item in c.attachments.value" :key="item.id" :id="item.id" :name="item.name" :kind="item.kind" removable @remove="c.attachments.value = c.attachments.value.filter(asset => asset.id !== item.id)" @view="item => preview = item" /></div>
      <div v-if="preview" class="c-viewer" role="dialog" aria-modal="true" :aria-label="preview.name" @mousedown.self="preview = null" @keydown.esc="preview = null"><img :src="preview.src" :alt="preview.name" /><div class="c-viewer-bar"><bdi>{{ preview.name }}</bdi><span class="w-grow" /><button type="button" class="w-btn primary" @click="preview = null">{{ s('إغلاق', 'Close') }}</button></div></div>
      <label class="sr" for="prompt">{{ s('اكتب طلبك', 'Write your request') }}</label>
      <textarea id="prompt" ref="field" v-model="c.draft.value" :rows="home ? 3 : 1" dir="auto" :placeholder="work ? s('ماذا تريد أن ينجز نجد؟', 'What should NAJD get done?') : s('اكتب رسالة…', 'Write a message…')"
        :role="suggestions.length ? 'combobox' : undefined" :aria-expanded="suggestions.length ? true : undefined" :aria-controls="suggestions.length ? 'k-suggest' : undefined" :aria-activedescendant="suggestions.length ? 'k-' + suggestions[active].id : undefined"
        @keydown="keydown" @paste="paste" />
      <small v-if="c.queuedSend.value" class="k-wait" role="status">{{ s('سيُرسل عندما يجهز نجد', 'Sends when NAJD is ready') }}</small>
      <div class="k-bar">
        <button type="button" class="w-icon" :aria-label="s('إرفاق ملفات', 'Attach files')" :disabled="c.locked.value" @click="attach"><Plus :size="18" /></button>
        <div class="w-menu-box"><button type="button" class="k-pill" :disabled="c.busy.value || !!c.approval.value" :data-access="c.accessMode.value" :aria-expanded="accessOpen" @click="accessOpen = !accessOpen"><ShieldCheck :size="14" /><span>{{ ar ? accessNow.ar : accessNow.en }}</span></button>
          <div v-if="accessOpen" class="w-menu up" role="menu"><button v-for="item in ACCESS" :key="item.id" type="button" role="menuitem" class="w-menu-item" @click="c.accessMode.value = item.id; accessOpen = false"><Check v-if="item.id === c.accessMode.value" :size="15" /><span>{{ ar ? item.ar : item.en }}<small>{{ ar ? item.hintAr : item.hintEn }}</small></span></button></div></div>
        <span class="k-grow" />
        <ModelPicker :providers="providers" :disabled="c.busy.value || !!c.approval.value || providers.connectionBusy.value" @manage="emit('settings', 'models')" />
        <button type="button" :class="['w-icon', 'k-voice', voice.state.value]" :disabled="voice.state.value === 'transcribing' || c.locked.value" :title="voiceLabel" :aria-label="voiceLabel" :aria-pressed="voice.state.value === 'recording'" data-voice @click="voice.toggle()" @keydown.esc.stop="voice.cancel()"><Mic :size="16" /><small v-if="voice.state.value === 'recording'" dir="ltr">{{ voice.seconds.value }}</small></button>
        <button v-if="working" type="button" class="k-send stop" :aria-label="s('إيقاف', 'Stop')" @click="c.stop()"><Square :size="12" fill="currentColor" /></button>
        <button v-if="!working || c.draft.value.trim()" type="submit" class="k-send" :aria-label="working ? s('أضف إلى المهمة', 'Add to the task') : s('إرسال', 'Send')" :disabled="!c.draft.value.trim() || !!c.approval.value || (c.busy.value && !c.activeTaskId.value)"><ArrowUp :size="17" /></button>
      </div>
    </form>
    <div v-if="work" class="k-under" data-under-composer>
      <div class="w-menu-box"><button type="button" class="k-link" :aria-expanded="projectOpen" @click="projectOpen = !projectOpen"><FolderKanban :size="14" /><bdi>{{ project?.name || s('بدون مشروع', 'No project') }}</bdi><ChevronDown :size="12" /></button>
        <div v-if="projectOpen" class="w-menu" role="menu"><button type="button" role="menuitem" class="w-menu-item" @click="c.chatProject.value = null; projectOpen = false"><MessageSquareText :size="15" /><span>{{ s('بدون مشروع', 'No project') }}</span></button>
          <button v-for="item in c.projects.value" :key="item.id" type="button" role="menuitem" class="w-menu-item" :disabled="!!c.activeSessionId.value" @click="c.chatProject.value = item.id; projectOpen = false"><FolderOpen :size="15" /><span>{{ item.name }}</span></button></div></div>
      <button type="button" class="k-link" @click="emit('hub')"><span class="k-plugins" aria-hidden="true"><i v-for="entry in plugins.slice(0, 3)" :key="entry.id" :style="{ color: iconColor(entry), background: iconColor(entry) + '22' }">{{ (entry.displayName || entry.id).charAt(0) }}</i></span>{{ s('الإضافات', 'Plugins') }}</button>
      <button v-if="c.draft.value.trim()" type="button" class="k-link" data-schedule @click="emit('schedule', c.draft.value.trim())"><CalendarClock :size="14" />{{ s('جدولة هذا الطلب', 'Schedule this request') }}</button>
    </div>
    <template v-if="home && work">
      <div class="k-chips" role="group" :aria-label="s('نوع المهمة', 'Task category')"><button v-if="prefs.prompts.length" type="button" :class="['w-chip', { on: category === 'mine' }]" :aria-pressed="category === 'mine'" data-my-prompts @click="category = 'mine'"><Bookmark :size="14" />{{ s('أوامري', 'My prompts') }}</button><button v-for="item in CATEGORIES" :key="item.id" type="button" :class="['w-chip', { on: category === item.id }]" :aria-pressed="category === item.id" @click="category = item.id"><component :is="item.icon" :size="14" />{{ ar ? item.ar : item.en }}</button></div>
      <div v-if="category === 'mine' && prefs.prompts.length" class="k-starts"><button v-for="(text, position) in prefs.prompts.slice(0, 8)" :key="position" type="button" dir="auto" data-my-prompt @click="c.draft.value = text; field?.focus()">{{ text.length > 90 ? text.slice(0, 90) + '…' : text }}</button></div>
      <div v-else-if="picked" class="k-starts"><button v-for="[arabic, english] in picked.prompts" :key="english" type="button" dir="auto" @click="c.draft.value = ar ? arabic : english; field?.focus()">{{ ar ? arabic : english }}</button></div>
    </template>
  </div>
</template>
