<script setup lang="ts">
// Model picker of the composer: the linked service's models, then thinking level and provider as side menus. Nothing changes silently.
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { Check, ChevronLeft, ChevronRight, LifeBuoy, Settings2, X } from 'lucide-vue-next'
import { loadFallback, saveFallback, type ModelRef } from '../../workstation/failover'
import { usePrefs } from '../composables/usePrefs'
import type { ProviderState } from '../composables/useProviders'

const props = defineProps<{ providers: ProviderState; disabled: boolean }>()
const emit = defineEmits<{ manage: [] }>()
const { s, prefs } = usePrefs()
const EFFORTS: Record<string, [string, string]> = { auto: ['تلقائي', 'Auto'], none: ['بدون', 'None'], minimal: ['أدنى', 'Minimal'], low: ['قياسي', 'Standard'], medium: ['متوسط', 'Medium'], high: ['مرتفع', 'High'], xhigh: ['مرتفع جدًا', 'Very high'], max: ['ماكس', 'Max'] }
const open = ref(false), side = ref<'effort' | 'provider' | null>(null), box = ref<HTMLElement | null>(null)
const p = props.providers
// Where a model's window comes from (detected, never assumed: owner request 2026-11-09).
const SOURCES: Record<string, [string, string]> = { modelfile: ['من إعداد النموذج في Ollama', 'From the model settings in Ollama'], 'server-setting': ['من إعداد خادم Ollama', 'From the Ollama server setting'], model: ['أقصى ما يدعمه النموذج', 'The model maximum'], server: ['كما يعمل الخادم المحلي', 'As the local server runs it'], listed: ['من قائمة المزود', 'From the provider list'], name: ['من اسم النموذج', 'From the model name'], fallback: ['تقدير محافظ: لم يذكر الخادم النافذة', 'A conservative estimate: the server did not report it'] }
const windowNote = (item: NajdProviderModel) => { const source = item.contextSource && SOURCES[item.contextSource]; return source ? s(source[0], source[1]) : '' }
const models = computed(() => p.models[p.provider.value] || [])
// Backup model (workstation/failover.ts): the current model becomes the backup; NAJD uses it once when the chosen model fails before any tool ran.
const backup = ref<ModelRef | null>(loadFallback(localStorage))
const isBackup = computed(() => !!backup.value && backup.value.provider === p.provider.value && backup.value.model === p.model.value)
function setBackup(value: ModelRef | null) { saveFallback(localStorage, value); backup.value = value }
const label = computed(() => models.value.find(item => item.id === p.model.value)?.label || p.model.value || (p.current.value?.configured ? p.current.value.name : '') || s('اختر نموذجًا', 'Choose a model'))
// (A provider that is not set up is not shown as if it were chosen: a first launch said "Ollama" with nothing connected.)
const effortName = (value: string) => EFFORTS[value]?.[prefs.language === 'ar' ? 0 : 1] || value
const efforts = computed(() => ['auto', ...p.supported.value.filter(item => item !== 'auto')])
const linked = computed(() => { const list = p.catalog.value.filter(item => item.configured); return list.length ? list : p.catalog.value.slice(0, 12) })
const outside = (event: PointerEvent) => { if (event.target instanceof Node && !box.value?.contains(event.target)) { open.value = false; side.value = null } }
watch(open, value => { if (value) document.addEventListener('pointerdown', outside); else document.removeEventListener('pointerdown', outside) })
onBeforeUnmount(() => document.removeEventListener('pointerdown', outside))
</script>

<template>
  <div ref="box" class="mp" @keydown.esc="open = false; side = null">
    <button type="button" class="mp-pill" :disabled="disabled" :aria-expanded="open" aria-haspopup="menu" data-model-menu @click="open = !open"><span dir="auto">{{ label }}</span><small>{{ effortName(p.effort.value) }}</small></button>
    <div v-if="open" class="mp-menu" role="menu" :aria-label="s('النموذج', 'Model')">
      <p v-if="p.loading[p.provider.value]" class="mp-note">{{ s('يحمّل النماذج…', 'Loading models…') }}</p>
      <p v-else-if="!models.length" class="mp-note">{{ p.current.value?.configured ? s('لا توجد نماذج من هذا المزود.', 'This provider lists no models.') : s('اربط مزودًا أولًا.', 'Link a provider first.') }}</p>
      <div class="mp-models"><button v-for="item in models.slice(0, 40)" :key="item.id" type="button" role="menuitemradio" :aria-checked="item.id === p.model.value" class="mp-model" @click="p.chooseModel(p.provider.value, item.id); open = false">
        <strong dir="ltr">{{ item.label }}</strong><small v-if="item.contextWindow" :title="windowNote(item)">{{ s('نافذة السياق ', 'Context window ') + Math.round(item.contextWindow / 1000) + 'k' + (item.contextEstimated ? s(' (تقديري)', ' (estimated)') : '') }}</small><Check v-if="item.id === p.model.value" :size="15" /></button></div>
      <hr />
      <button type="button" role="menuitem" class="mp-row" :aria-expanded="side === 'effort'" @click="side = side === 'effort' ? null : 'effort'"><span>{{ s('مستوى التفكير', 'Thinking level') }}</span><small>{{ effortName(p.effort.value) }}</small><component :is="prefs.language === 'ar' ? ChevronLeft : ChevronRight" :size="14" /></button>
      <button type="button" role="menuitem" class="mp-row" :aria-expanded="side === 'provider'" @click="side = side === 'provider' ? null : 'provider'"><span>{{ s('المزود', 'Provider') }}</span><small dir="ltr">{{ p.current.value?.name }}</small><component :is="prefs.language === 'ar' ? ChevronLeft : ChevronRight" :size="14" /></button>
      <button v-if="p.model.value && !isBackup" type="button" role="menuitem" class="mp-row" data-backup-set :title="s('إذا تعطل نموذجك قبل أن تعمل أي أداة، يكمل نجد بهذا النموذج مرة واحدة ويخبرك.', 'If your model fails before any tool runs, NAJD continues once with this model and tells you.')" @click="setBackup({ provider: p.provider.value, model: p.model.value })"><span>{{ s('اجعله النموذج الاحتياطي', 'Make this the backup model') }}</span><LifeBuoy :size="14" /></button>
      <div v-if="backup" class="mp-row mp-backup" data-backup><span>{{ s('الاحتياطي: ', 'Backup: ') }}<bdi dir="ltr">{{ backup.model }}</bdi></span><button type="button" class="w-icon" :aria-label="s('إلغاء النموذج الاحتياطي', 'Remove the backup model')" @click="setBackup(null)"><X :size="13" /></button></div>
      <button type="button" role="menuitem" class="mp-row" @click="open = false; emit('manage')"><span>{{ s('إدارة النماذج', 'Manage models') }}</span><Settings2 :size="14" /></button>
      <div v-if="side === 'effort'" class="mp-side" role="menu"><button v-for="item in efforts" :key="item" type="button" role="menuitemradio" :aria-checked="p.effort.value === item" @click="p.setEffort(item as NajdReasoningPreference); side = null"><span>{{ effortName(item) }}</span><Check v-if="p.effort.value === item" :size="15" /></button></div>
      <div v-if="side === 'provider'" class="mp-side" role="menu"><button v-for="item in linked" :key="item.id" type="button" role="menuitemradio" :aria-checked="p.provider.value === item.id" @click="p.setProvider(item.id); side = null"><span dir="ltr">{{ item.name }}</span><Check v-if="p.provider.value === item.id" :size="15" /></button></div>
    </div>
  </div>
</template>
