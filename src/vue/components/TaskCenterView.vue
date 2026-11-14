<script setup lang="ts">
// Task Center: scheduled and recurring tasks that survive a restart; a task that needs an approval stops and says so.
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { Archive, CalendarClock, Pause, Play, Plus, Trash2, Zap } from 'lucide-vue-next'
import { usePrefs } from '../composables/usePrefs'
import { confirmAction } from '../composables/useConfirm'
import type { ProviderState } from '../composables/useProviders'
import type { Automation, Schedule } from '../../workstation/types'

const props = defineProps<{ providers: ProviderState; seed: string | null }>()
const emit = defineEmits<{ openChat: [id: string]; prompt: [text: string] }>()
const { s, prefs } = usePrefs()
const STATES: Record<string, [string, string, string]> = { RUNNING: ['قيد التشغيل', 'Running', 'blue'], COMPLETED: ['اكتملت', 'Completed', 'green'], FAILED: ['فشلت', 'Failed', 'red'], CANCELLED: ['أوقفت', 'Cancelled', 'neutral'], INTERRUPTED: ['انقطعت', 'Interrupted', 'orange'], NEEDS_APPROVAL: ['تحتاج موافقتك', 'Needs your approval', 'orange'], UNKNOWN_EFFECT: ['نتيجة غير مؤكدة', 'Unconfirmed result', 'orange'] }
type Form = { id?: string; title: string; prompt: string; kind: Schedule['kind']; at: string; minutes: number; cron: string; timezone: string }
const blank = (): Form => ({ title: '', prompt: '', kind: 'cron', at: '', minutes: 60, cron: '0 9 * * *', timezone: Intl.DateTimeFormat().resolvedOptions().timeZone })
const items = ref<Automation[] | null>(null), form = ref<Form | null>(props.seed ? { ...blank(), prompt: props.seed, title: props.seed.slice(0, 60) } : null), failure = ref<string | null>(null), open = ref<string | null>(null), archived = ref(false)
const api = () => window.najdWorkstation!
async function load() { try { items.value = await api().tasks() } catch { failure.value = 'TASKS' } }
let off: (() => void) | undefined
onMounted(() => { void load(); off = window.najdWorkstation?.onChanged(kind => { if (kind === 'tasks') void load() }) })
onBeforeUnmount(() => off?.())
async function act(work: () => Promise<unknown>) { failure.value = null; try { await work(); await load() } catch (reason) { failure.value = String((reason as Error).message).split(': ').pop() || 'FAILED' } }
const when = (value: string | null) => value ? new Date(value).toLocaleString(prefs.language === 'ar' ? 'ar-SA' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' }) : '—'
const describe = (schedule: Schedule) => schedule.kind === 'once' ? s('مرة واحدة', 'Once') : schedule.kind === 'interval' ? s(`كل ${schedule.minutes} دقيقة`, `Every ${schedule.minutes} min`) : `${schedule.cron} · ${schedule.timezone}`
const toSchedule = (value: Form): Schedule => value.kind === 'once' ? { kind: 'once', at: new Date(value.at).toISOString() } : value.kind === 'interval' ? { kind: 'interval', minutes: value.minutes } : { kind: 'cron', cron: value.cron, timezone: value.timezone }
const shown = computed(() => (items.value || []).filter(item => (item.status === 'archived') === archived.value))
const label = (state: string) => STATES[state] || [state, state, 'neutral']
function save() { const value = form.value; if (!value) return; void act(async () => {
  if (value.id) await api().taskUpdate(value.id, { title: value.title, prompt: value.prompt, schedule: toSchedule(value) })
  else await api().taskCreate({ title: value.title, prompt: value.prompt, schedule: toSchedule(value), provider: props.providers.provider.value, model: props.providers.model.value || null })
  form.value = null }) }
async function removeTask(item: Automation) { if (await confirmAction(s('حذف هذه المهمة وسجلها؟', 'Delete this task and its history?'), s('حذف', 'Delete'))) void act(() => api().taskRemove(item.id)) }
function edit(item: Automation) { form.value = { ...blank(), id: item.id, title: item.title, prompt: item.prompt, kind: item.schedule.kind, ...(item.schedule.kind === 'cron' ? { cron: item.schedule.cron, timezone: item.schedule.timezone } : item.schedule.kind === 'interval' ? { minutes: item.schedule.minutes } : { at: item.schedule.at.slice(0, 16) }) } }
</script>

<template>
  <div class="w-page">
    <header class="w-page-head"><div><h1>{{ s('مركز المهام', 'Task Center') }}</h1><p>{{ s('مهام مجدولة ومتكررة تستمر بعد إعادة التشغيل. تتوقف أي مهمة تحتاج موافقة وتعرض ذلك هنا بدل التنفيذ دون إذنك.', 'Scheduled and recurring tasks that survive a restart. A task that needs an approval stops and says so here instead of acting without you.') }}</p></div>
      <div class="w-page-actions"><button type="button" class="w-btn" @click="archived = !archived">{{ archived ? s('النشطة', 'Active') : s('المؤرشفة', 'Archived') }}</button><button type="button" class="w-btn" data-task="from-chat" :title="s('صِف المهمة والوقت بكلماتك في المحادثة', 'Describe the task and its time in your own words in the chat')" @click="emit('prompt', s('جدول لي مهمة: ', 'Schedule a task for me: '))">{{ s('من المحادثة', 'From chat') }}</button><button type="button" class="w-btn primary" data-task="new" @click="form = blank()"><Plus :size="15" />{{ s('مهمة جديدة', 'New task') }}</button></div></header>
    <div v-if="failure" class="w-banner error">{{ failure }}</div>
    <div v-if="!items" class="w-skeleton"><i /><i /><i /></div>
    <div v-else-if="!shown.length" class="w-empty"><CalendarClock :size="26" /><strong>{{ s('لا توجد مهام مجدولة', 'No scheduled tasks') }}</strong><p>{{ s('أنشئ مهمة ليعمل نجد في الوقت الذي تحدده.', 'Create a task and NAJD works at the time you set.') }}</p></div>
    <ul v-else class="t-list"><li v-for="item in shown" :key="item.id" class="t-card" :data-automation="item.id">
      <button type="button" class="t-open" :aria-expanded="open === item.id" @click="open = open === item.id ? null : item.id"><strong dir="auto">{{ item.title }}</strong><small dir="ltr">{{ describe(item.schedule) }}</small></button>
      <dl><div><dt>{{ s('التشغيل القادم', 'Next run') }}</dt><dd>{{ item.status === 'active' ? when(item.nextRunAt) : item.status === 'paused' ? s('موقوفة مؤقتًا', 'Paused') : s('انتهت', 'Finished') }}</dd></div>
        <div><dt>{{ s('آخر نتيجة', 'Last result') }}</dt><dd><span v-if="item.runs[0]" :class="['w-badge', label(item.runs[0].state)[2]]">{{ label(item.runs[0].state)[prefs.language === 'ar' ? 0 : 1] }}</span><template v-else>—</template></dd></div>
        <div><dt>{{ s('التسليم', 'Delivery') }}</dt><dd>{{ item.delivery === 'notification' ? s('إشعار', 'Notification') : s('محادثة', 'Conversation') }}</dd></div></dl>
      <div class="t-actions">
        <button type="button" class="w-icon" :aria-label="s('تشغيل الآن', 'Run now')" :disabled="item.runs[0]?.state === 'RUNNING'" @click="act(() => api().taskRun(item.id))"><Zap :size="16" /></button>
        <button v-if="item.status === 'active'" type="button" class="w-icon" :aria-label="s('إيقاف مؤقت', 'Pause')" @click="act(() => api().taskStatus(item.id, 'paused'))"><Pause :size="16" /></button>
        <button v-else type="button" class="w-icon" :aria-label="s('تفعيل', 'Enable')" @click="act(() => api().taskStatus(item.id, 'active'))"><Play :size="16" /></button>
        <button type="button" class="w-btn ghost" @click="edit(item)">{{ s('تعديل', 'Edit') }}</button>
        <button type="button" class="w-icon" :aria-label="s('أرشفة', 'Archive')" @click="act(() => api().taskStatus(item.id, 'archived'))"><Archive :size="16" /></button>
        <button type="button" class="w-icon" :aria-label="s('حذف', 'Delete')" @click="removeTask(item)"><Trash2 :size="16" /></button>
      </div>
      <ol v-if="open === item.id" class="t-runs"><li v-if="!item.runs.length">{{ s('لم تعمل بعد.', 'Has not run yet.') }}</li>
        <li v-for="run in item.runs" :key="run.id"><time>{{ when(run.startedAt) }}</time><span :class="['w-badge', label(run.state)[2]]">{{ label(run.state)[prefs.language === 'ar' ? 0 : 1] }}</span><small v-if="run.late">{{ s('متأخرة', 'Late') }}</small><code v-if="run.code" dir="ltr">{{ run.code }}</code>
          <button v-if="run.conversationId" type="button" class="w-btn ghost" @click="emit('openChat', run.conversationId!)">{{ s('فتح المحادثة', 'Open conversation') }}</button></li></ol>
    </li></ul>
    <div v-if="form" class="w-scrim" @mousedown.self="form = null"><div class="w-dialog" role="dialog" aria-modal="true" @keydown.esc="form = null">
      <header><h2>{{ form.id ? s('تعديل المهمة', 'Edit task') : s('مهمة جديدة', 'New task') }}</h2></header>
      <div class="w-dialog-body">
        <label class="w-field"><span>{{ s('الاسم', 'Name') }}</span><input v-model="form.title" maxlength="120" dir="auto" data-task="title" /></label>
        <label class="w-field"><span>{{ s('التعليمات', 'Instructions') }}</span><textarea v-model="form.prompt" rows="4" maxlength="8000" dir="auto" data-task="prompt" /></label>
        <div class="w-seg" role="radiogroup"><button v-for="option in [{ value: 'cron', label: 'Cron' }, { value: 'interval', label: s('متكررة', 'Interval') }, { value: 'once', label: s('مرة واحدة', 'Once') }]" :key="option.value" type="button" role="radio" :aria-checked="form.kind === option.value" :class="{ on: form.kind === option.value }" @click="form.kind = option.value as Schedule['kind']">{{ option.label }}</button></div>
        <template v-if="form.kind === 'cron'"><label class="w-field"><span>Cron</span><input v-model="form.cron" dir="ltr" /><small>{{ s('دقيقة ساعة يوم شهر يوم-الأسبوع', 'minute hour day month weekday') }}</small></label><label class="w-field"><span>{{ s('المنطقة الزمنية', 'Time zone') }}</span><input v-model="form.timezone" dir="ltr" /></label></template>
        <label v-if="form.kind === 'interval'" class="w-field"><span>{{ s('كل (دقيقة)', 'Every (minutes)') }}</span><input v-model.number="form.minutes" type="number" min="1" /></label>
        <label v-if="form.kind === 'once'" class="w-field"><span>{{ s('الوقت', 'Time') }}</span><input v-model="form.at" type="datetime-local" /></label>
        <small v-if="!form.id">{{ s(`ستعمل بالنموذج الحالي: ${providers.current.value?.name || providers.provider.value} · ${providers.model.value}`, `Runs with the current model: ${providers.current.value?.name || providers.provider.value} · ${providers.model.value}`) }}</small>
      </div>
      <footer><button type="button" class="w-btn" @click="form = null">{{ s('إلغاء', 'Cancel') }}</button><button type="button" class="w-btn primary" data-task="save" :disabled="!form.title.trim() || !form.prompt.trim() || (form.kind === 'once' && !form.at)" @click="save">{{ s('حفظ', 'Save') }}</button></footer>
    </div></div>
  </div>
</template>
