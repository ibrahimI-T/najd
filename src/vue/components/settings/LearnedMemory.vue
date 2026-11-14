<script setup lang="ts">
// What NAJD learned (Settings > Conversation memory): the preferences and workflow lessons it keeps about the owner, their mode and sharing, the
// proposals waiting for approval, and the approved ones (edit, remove). The service (electron/learning.cjs) already did all of this; the Vue
// renderer only had a switch on the profile page, so a proposal could never be approved and a learned preference never corrected.
import { nextTick, reactive, ref, watch } from 'vue'
import { memoryFocus } from '../../composables/useMemoryFocus'
import { Check, Pencil, Trash2, X } from 'lucide-vue-next'
import { usePrefs } from '../../composables/usePrefs'
import { useLoad } from '../../composables/useLoad'
import { plain } from '../../lib/plain'
import { confirmAction } from '../../composables/useConfirm'

const { s } = usePrefs()
const host = window
const learning = useLoad(window.najdLearning?.list)
const edit = reactive({ kind: 'preference' as NajdLearningKind, id: '', title: '', text: '' }), editing = ref(false)
const KINDS: { kind: NajdLearningKind; ar: string; en: string; hintAr: string; hintEn: string }[] = [
  { kind: 'preference', ar: 'تفضيلاتك', en: 'Your preferences', hintAr: 'كيف تحب أن يجيبك نجد.', hintEn: 'How you like NAJD to answer.' },
  { kind: 'experience', ar: 'دروس العمل', en: 'Workflow lessons', hintAr: 'ما تعلمه نجد من طريقة عملك.', hintEn: 'What NAJD learned from how you work.' }
]
const MODES: { value: NajdLearningSettings['mode']; ar: string; en: string }[] = [
  { value: 'off', ar: 'متوقف', en: 'Off' },
  { value: 'review', ar: 'يقترح وأوافق أنا', en: 'Suggest, I approve' },
  { value: 'preferences', ar: 'يحفظ تفضيلاتي الصريحة تلقائيًا', en: 'Save my explicit preferences automatically' }
]
function setSettings(patch: Partial<NajdLearningSettings>) {
  const current = learning.value.value?.settings; if (!current) return
  void learning.run(() => host.najdLearning!.setSettings(plain({ ...current, ...patch })), s('حُفظ الإعداد.', 'Setting saved.'))
}
const accept = (kind: NajdLearningKind, id: string) => learning.run(() => host.najdLearning!.accept(kind, id), s('اعتُمدت.', 'Approved.'))
const reject = (kind: NajdLearningKind, id: string) => learning.run(() => host.najdLearning!.reject(kind, id), s('رُفضت.', 'Rejected.'))
// The service writes these titles in English; the interface shows them in its own language (the text itself is the owner's words, left as is).
const TITLES: Record<string, [string, string]> = { 'User preference': ['تفضيل', 'User preference'], 'User correction': ['تصحيح', 'User correction'], 'User profile': ['معلومة عنك', 'User profile'], 'Workflow lesson': ['درس عمل', 'Workflow lesson'] }
const titleOf = (title: string) => TITLES[title] ? s(TITLES[title][0], TITLES[title][1]) : title
async function remove(kind: NajdLearningKind, id: string) {
  if (await confirmAction(s('حذف هذا العنصر؟ لن يستخدمه نجد بعد الآن.', 'Delete this item? NAJD will no longer use it.'), s('حذف', 'Delete'))) await learning.run(() => host.najdLearning!.remove(kind, id), s('حُذفت.', 'Removed.'))
}
// A note chosen in the session panel: shown, highlighted for a moment, then the request is cleared.
const flashed = ref('')
watch([memoryFocus, () => learning.value.value], async ([focus, data]) => {
  if (!focus || !data) return
  const key = focus.kind + ':' + focus.id
  memoryFocus.value = null
  await nextTick()
  const row = document.querySelector(`[data-learning-note="${CSS.escape(key)}"]`)
  if (!row) return
  row.scrollIntoView({ block: 'center' }); flashed.value = key
  setTimeout(() => { if (flashed.value === key) flashed.value = '' }, 2400)
}, { immediate: true })
function begin(kind: NajdLearningKind, note: NajdMemoryNote) { Object.assign(edit, { kind, id: note.id, title: note.title, text: note.text }); editing.value = true }
function cancel() { editing.value = false }
function save() {
  const input = { id: edit.id, title: edit.title, text: edit.text }, kind = edit.kind
  editing.value = false
  void learning.run(() => host.najdLearning!.edit(kind, input), s('حُدّثت.', 'Updated.'))
}
</script>

<template>
  <section v-if="learning.value.value" class="w-section" data-learned>
    <header><div><h3>{{ s('ما تعلّمه نجد عنك', 'What NAJD learned about you') }}</h3>
      <p>{{ s('هنا ترى ما يحتفظ به نجد عن تفضيلاتك وطريقة عملك، وتعدّله أو تحذفه، وتعتمد ما يقترحه قبل أن يُستخدم.', 'See what NAJD keeps about your preferences and way of working; correct or remove it, and approve what it proposes before it is used.') }}</p></div></header>
    <div v-if="learning.failure.value" class="w-banner error">{{ learning.failure.value }}</div>
    <div class="w-row"><div><strong>{{ s('وضع التعلم', 'Learning mode') }}</strong></div>
      <select class="w-select" data-learning-mode :value="learning.value.value.settings.mode" :disabled="learning.busy.value" @change="setSettings({ mode: ($event.target as HTMLSelectElement).value as NajdLearningSettings['mode'] })"><option v-for="mode in MODES" :key="mode.value" :value="mode.value">{{ s(mode.ar, mode.en) }}</option></select></div>
    <div class="w-row"><div><strong>{{ s('مشاركة تفضيلاتي المعتمدة مع النموذج', 'Share my approved preferences with the model') }}</strong></div>
      <button type="button" role="switch" data-learning-share="preference" :aria-checked="learning.value.value.settings.sharePreferences" :aria-label="s('مشاركة التفضيلات', 'Share preferences')" :class="['w-toggle', { on: learning.value.value.settings.sharePreferences }]" :disabled="learning.busy.value" @click="setSettings({ sharePreferences: !learning.value.value!.settings.sharePreferences })"><i /></button></div>
    <div class="w-row"><div><strong>{{ s('مشاركة دروس العمل المعتمدة مع النموذج', 'Share my approved workflow lessons with the model') }}</strong><small>{{ s('تُرسل فقط عندما تتطابق كلماتها مع طلبك.', 'Sent only when their words match your request.') }}</small></div>
      <button type="button" role="switch" data-learning-share="experience" :aria-checked="learning.value.value.settings.shareExperiences" :aria-label="s('مشاركة الدروس', 'Share lessons')" :class="['w-toggle', { on: learning.value.value.settings.shareExperiences }]" :disabled="learning.busy.value" @click="setSettings({ shareExperiences: !learning.value.value!.settings.shareExperiences })"><i /></button></div>

    <div v-for="group in KINDS" :key="group.kind" class="s-learn" :data-learning-kind="group.kind">
      <div class="w-row"><div><strong>{{ s(group.ar, group.en) }}</strong><small>{{ s(group.hintAr, group.hintEn) }}</small></div>
        <div class="w-row-end"><button type="button" class="w-btn" :disabled="learning.busy.value" @click="learning.run(() => host.najdLearning!.import(group.kind), result => result?.imported ? s(`استُورد ${result.count} عنصر`, `Imported ${result.count} items`) : s('لم يُختر ملف.', 'No file was chosen.'))">{{ s('استيراد', 'Import') }}</button>
          <button type="button" class="w-btn" :disabled="learning.busy.value" @click="learning.run(() => host.najdLearning!.export(group.kind), result => result?.saved ? s('تم التصدير.', 'Exported.') : s('أُلغي التصدير.', 'Export cancelled.'))">{{ s('تصدير', 'Export') }}</button></div></div>
      <div v-for="note in learning.value.value.pending[group.kind]" :key="note.id" :class="['w-row', { 's-flash': flashed === group.kind + ':' + note.id }]" data-learning-status="pending" :data-learning-note="group.kind + ':' + note.id"><div><strong dir="auto">{{ titleOf(note.title) }}</strong><small dir="auto">{{ note.text }}</small><small>{{ s('بانتظار موافقتك', 'Waiting for your approval') }}</small></div>
        <div class="w-row-end"><button type="button" class="w-icon" data-learning-accept :aria-label="s('اعتماد', 'Approve')" :disabled="learning.busy.value" @click="accept(group.kind, note.id)"><Check :size="16" /></button>
          <button type="button" class="w-icon" data-learning-reject :aria-label="s('رفض', 'Reject')" :disabled="learning.busy.value" @click="reject(group.kind, note.id)"><X :size="16" /></button></div></div>
      <template v-for="note in learning.value.value.approved[group.kind]" :key="note.id"><div v-if="!(editing && edit.id === note.id)" :class="['w-row', { 's-flash': flashed === group.kind + ':' + note.id }]" data-learning-status="approved" :data-learning-note="group.kind + ':' + note.id"><div><strong dir="auto">{{ titleOf(note.title) }}</strong><small dir="auto">{{ note.text }}</small></div>
        <div class="w-row-end"><button type="button" class="w-icon" data-learning-edit :aria-label="s('تعديل', 'Edit')" @click="begin(group.kind, note)"><Pencil :size="16" /></button>
          <button type="button" class="w-icon" data-learning-remove :aria-label="s('حذف', 'Delete')" :disabled="learning.busy.value" @click="remove(group.kind, note.id)"><Trash2 :size="16" /></button></div></div>
        <div v-else class="s-form" data-learning-form><label class="w-field"><span>{{ s('العنوان', 'Title') }}</span><input v-model="edit.title" dir="auto" maxlength="80" /></label>
          <label class="w-field"><span>{{ s('النص', 'Text') }}</span><textarea v-model="edit.text" rows="3" dir="auto" data-learning-edit-text /></label>
          <div class="w-row-end"><button type="button" class="w-btn primary" data-learning-save :disabled="!edit.title.trim() || !edit.text.trim()" @click="save">{{ s('حفظ', 'Save') }}</button><button type="button" class="w-btn" @click="cancel">{{ s('إلغاء', 'Cancel') }}</button></div></div></template>
      <p v-if="!learning.value.value.pending[group.kind].length && !learning.value.value.approved[group.kind].length" class="pf-note" data-learning-empty>{{ s('لا شيء بعد.', 'Nothing yet.') }}</p>
    </div>

  </section>
</template>
