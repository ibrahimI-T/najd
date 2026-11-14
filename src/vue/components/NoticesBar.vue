<script setup lang="ts">
// What the owner must know before working: steps an earlier run left unconfirmed (NAJD never repeats them), an engine still being
// prepared, an update, and a missing model.
import { onMounted, onScopeDispose, ref } from 'vue'
import { usePrefs } from '../composables/usePrefs'
import { visibleInterval } from '../../useVisibleInterval'

defineProps<{ noModel: boolean }>()
const emit = defineEmits<{ models: []; updates: [] }>()
const { s } = usePrefs()
const recovery = ref<NajdActionRecovery | null>(null), reviewing = ref(false), failed = ref(false)
const engine = ref<NajdRuntimeStatus | null>(null), update = ref<NajdUpdateStatus | null>(null)
onMounted(() => {
  void window.najdCore?.recovery?.().then(value => { recovery.value = value }).catch(() => { recovery.value = { available: false, actions: [] } })
  void window.najdUpdates?.status().then(value => { update.value = value }).catch(() => {})
})
onScopeDispose(visibleInterval(() => { void window.najdRuntime?.status().then(value => { engine.value = value }).catch(() => {}) }, 2000))
function prepare() { void window.najdRuntime?.prepare() }
async function settle(id: string, resolution: 'done' | 'not-done' | 'dismiss') {
  failed.value = false
  try { await window.najdCore!.reconcileAction!(id, resolution); if (recovery.value) recovery.value = { ...recovery.value, actions: recovery.value.actions.filter(item => item.id !== id) } } catch { failed.value = true }
}
</script>

<template>
  <div class="n-notices">
    <div v-if="recovery && !recovery.available" class="w-banner error" role="alert"><span>{{ s('تعذر قراءة سجل التنفيذ. لن تعمل إجراءات الجهاز المسجلة حتى يصلح السجل.', 'The action journal could not be read. Recorded device actions stay off until it is repaired.') }}</span></div>
    <div v-else-if="recovery && recovery.actions.length" class="n-recovery" data-recovery>
      <div class="w-banner warn" role="status"><span>{{ s(`إجراءات من التشغيل السابق تحتاج مراجعتك (${recovery.actions.length}). لم يعد نجد تنفيذ شيء تلقائيًا.`, `Actions from the previous run need your review (${recovery.actions.length}). NAJD repeated nothing.`) }}</span>
        <button type="button" class="w-btn" @click="reviewing = !reviewing">{{ reviewing ? s('إخفاء', 'Hide') : s('مراجعة', 'Review') }}</button></div>
      <template v-if="reviewing"><div v-for="item in recovery.actions" :key="item.id" class="w-row"><div><strong dir="ltr">{{ item.operation }}</strong><small dir="ltr" :title="item.target">{{ item.target.slice(0, 140) }}</small></div><div class="w-row-end">
        <template v-if="item.state === 'UNKNOWN_EFFECT'"><button type="button" class="w-btn" @click="settle(item.id, 'done')">{{ s('تم فعلًا', 'It happened') }}</button><button type="button" class="w-btn" @click="settle(item.id, 'not-done')">{{ s('لم يتم', 'It did not') }}</button></template>
        <button v-else type="button" class="w-btn" @click="settle(item.id, 'dismiss')">{{ s('تجاهل', 'Dismiss') }}</button></div></div></template>
      <div v-if="failed" class="w-banner error" role="alert"><span>{{ s('تعذر الحفظ.', 'Could not save.') }}</span></div></div>
    <div v-if="engine?.bundled && engine.state !== 'ready'" :class="['w-banner', engine.error ? 'error' : 'info']" role="status"><span>{{ engine.error ? s('تعذر تجهيز المحرك: ', 'The engine could not be prepared: ') + engine.error : s('يجهز نجد محركه…', 'NAJD is preparing its engine…') }}</span>
      <button v-if="engine.error" type="button" class="w-btn" @click="prepare">{{ s('إعادة المحاولة', 'Try again') }}</button></div>
    <div v-if="update && ['available', 'manual', 'ready'].includes(update.state)" class="w-banner info" role="status"><span>{{ s('يوجد تحديث: ', 'An update is available: ') }}<bdi dir="ltr">{{ update.version }}</bdi></span><button type="button" class="w-btn" @click="emit('updates')">{{ s('فتح', 'Open') }}</button></div>
    <div v-if="noModel" class="w-banner info" role="status"><span>{{ s('اربط نموذجًا لتبدأ. يمكنك استخدام اشتراك أو مفتاح API أو نموذج محلي.', 'Connect a model to begin: a subscription, an API key or a local model.') }}</span><button type="button" class="w-btn primary" data-connect-model @click="emit('models')">{{ s('ربط نموذج', 'Connect a model') }}</button></div>
  </div>
</template>
