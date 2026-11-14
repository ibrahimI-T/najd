<script setup lang="ts">
// The owner's page: time together, an activity grid from saved conversations, display name, and self-improvement (learning review).
import { plain } from '../lib/plain'
import { computed, onMounted, ref } from 'vue'
import { usePrefs } from '../composables/usePrefs'
import { activityStats } from '../../workstation/profileStats'

const props = defineProps<{ sessions: NajdSessionSummary[] }>()
const { s, prefs, change } = usePrefs()
const DAY = 86400000
const view = ref<'closeness' | 'growth'>('closeness'), learning = ref<NajdLearningState | null>(null), failed = ref(false), draft = ref(prefs.displayName)
onMounted(() => { void window.najdLearning?.list().then(value => { learning.value = value }).catch(() => { failed.value = true }) })
const stats = computed(() => activityStats(props.sessions as { updatedAt: string; createdAt?: string }[]))
const dayKey = (time: number) => new Date(time).toISOString().slice(0, 10)
const cells = computed(() => { const today = new Date(), weeks = 53, start = today.getTime() - (weeks * 7 - 1) * DAY - today.getDay() * DAY; return Array.from({ length: weeks * 7 }, (_, index) => { const time = start + index * DAY, count = stats.value.days.get(dayKey(time)) || 0; return { key: dayKey(time), count, level: time > today.getTime() ? 'none' : count >= 4 ? 3 : count >= 2 ? 2 : count ? 1 : 0 } }) })
const months = computed(() => Array.from({ length: 12 }, (_, index) => new Date(new Date().getFullYear(), new Date().getMonth() - 11 + index, 1).toLocaleDateString(prefs.language, { month: 'long' })))
const on = computed(() => !!learning.value && learning.value.settings.mode !== 'off')
const pending = computed(() => learning.value ? learning.value.pending.preference.length + learning.value.pending.experience.length : 0)
const approved = computed(() => learning.value ? learning.value.approved.preference.length + learning.value.approved.experience.length : 0)
async function toggle() { if (!learning.value || !window.najdLearning) return; try { const settings = await window.najdLearning.setSettings(plain({ ...learning.value.settings, mode: on.value ? 'off' : 'review' })); learning.value = { ...learning.value, settings } } catch { failed.value = true } }
</script>

<template>
  <div class="pf" data-profile>
    <div class="pf-head"><span class="pf-avatar">{{ (prefs.displayName || 'N').charAt(0).toUpperCase() }}</span><div><h1>{{ s(`نجد الخاص بـ ${prefs.displayName || '…'}`, `${prefs.displayName || '…'}'s NAJD`) }}</h1>
      <p>{{ s(`الأيام معًا: ${stats.together} · المحادثات: ${stats.conversations} · سلسلة الأيام الحالية: ${stats.streak}`, `Days together: ${stats.together} · Conversations: ${stats.conversations} · Current streak: ${stats.streak}`) }}</p></div>
      <span class="w-grow" /><button type="button" :class="['w-btn', on ? '' : 'primary']" :disabled="!learning" data-self-evolution @click="toggle">{{ on ? s('إيقاف التطور الذاتي', 'Turn off self-improvement') : s('تفعيل التطور الذاتي', 'Turn on self-improvement') }}</button></div>
    <label class="w-field"><span>{{ s('الاسم الظاهر', 'Display name') }}</span><input v-model="draft" maxlength="60" dir="auto" @blur="change({ displayName: draft.trim() })" /></label>
    <div class="w-seg" role="radiogroup"><button v-for="option in [{ value: 'closeness', label: s('التقارب', 'Closeness') }, { value: 'growth', label: s('التطور', 'Growth') }]" :key="option.value" type="button" role="radio" :aria-checked="view === option.value" :class="{ on: view === option.value }" @click="view = option.value as 'closeness' | 'growth'">{{ option.label }}</button></div>
    <template v-if="view === 'closeness'">
      <p class="pf-note">{{ s('كلما تحدثت أكثر أو أسندت مهامًا أكثر، امتلأت الشبكة.', 'The more you talk and hand over tasks, the fuller the grid gets.') }}</p>
      <div class="pf-grid" dir="ltr" role="img" :aria-label="s('نشاط السنة', 'Activity this year')"><i v-for="cell in cells" :key="cell.key" :title="cell.key + ' · ' + cell.count" :data-level="cell.level" /></div>
      <div class="pf-months" dir="ltr"><span v-for="month in months" :key="month">{{ month }}</span></div>
    </template>
    <div v-else class="pf-growth"><h2>{{ s('الآن يمكن لنجد التعلم والتطور من تلقاء نفسه', 'NAJD can now learn and improve on its own') }}</h2>
      <p>{{ s('عند تفعيله يقترح نجد ما تعلمه من تفضيلاتك وطريقة عملك، ولا يعتمد شيئًا قبل موافقتك في إعدادات ذاكرة المحادثة.', 'When on, NAJD proposes what it learned about your preferences and way of working, and keeps nothing before you approve it in Conversation Memory.') }}</p>
      <p>{{ s(`بانتظار مراجعتك: ${pending} · معتمد: ${approved}`, `Waiting for your review: ${pending} · Approved: ${approved}`) }}</p>
      <p v-if="failed" class="pf-note">{{ s('تعذرت قراءة حالة التعلم.', 'The learning state could not be read.') }}</p></div>
  </div>
</template>
