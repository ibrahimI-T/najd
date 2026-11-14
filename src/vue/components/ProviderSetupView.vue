<script setup lang="ts">
// Models & providers as one list: choosing a provider opens its setup right below it. A service offered both as a subscription and as an
// API key (ChatGPT / OpenAI, Kimi, GLM, Qwen) is one row with both ways to link it.
import { computed, ref } from 'vue'
import { ChevronDown } from 'lucide-vue-next'
import { usePrefs } from '../composables/usePrefs'
import type { ProviderState } from '../composables/useProviders'
import ProviderSetupItem from './ProviderSetupItem.vue'

const props = defineProps<{ providers: ProviderState }>()
const { s } = usePrefs()
const FAMILIES: { id: string; name: string; members: string[] }[] = [
  { id: 'openai', name: 'ChatGPT · OpenAI', members: ['chatgpt', 'openai-api'] }, { id: 'kimi', name: 'Kimi · Moonshot', members: ['kimi-code', 'moonshot-api'] },
  { id: 'glm', name: 'Z.AI · GLM', members: ['zai-coding', 'zai-api'] }, { id: 'qwen', name: 'Alibaba · Qwen', members: ['alibaba-coding', 'dashscope-api'] }, { id: 'minimax', name: 'MiniMax', members: ['minimax-plan'] }]
const open = ref<string | null>(null), pick = ref<Record<string, string>>({}), filter = ref<'all' | 'subscription' | 'api' | 'local'>('all')
const rows = computed(() => {
  const catalog = props.providers.catalog.value, grouped = new Set(FAMILIES.flatMap(family => family.members))
  return [...FAMILIES.map(family => ({ id: family.id, name: family.name, items: family.members.map(id => catalog.find(item => item.id === id)).filter((item): item is NajdProvider => !!item) })).filter(row => row.items.length),
    ...catalog.filter(item => !grouped.has(item.id) && item.kind !== 'union').map(item => ({ id: item.id, name: item.name, items: [item] }))]
    .filter(row => filter.value === 'all' || row.items.some(item => item.kind === filter.value))
})
const current = (row: { id: string; items: NajdProvider[] }) => row.items.find(item => item.id === pick.value[row.id]) || row.items.find(item => item.configured) || row.items[0]
const FILTERS = computed(() => [{ value: 'all', label: s('الكل', 'All') }, { value: 'subscription', label: s('اشتراك', 'Subscription') }, { value: 'api', label: 'API' }, { value: 'local', label: s('محلي', 'Local') }] as const)
</script>

<template>
  <div class="ps" data-providers>
    <div class="w-seg" role="radiogroup" :aria-label="s('النوع', 'Kind')"><button v-for="option in FILTERS" :key="option.value" type="button" role="radio" :aria-checked="filter === option.value" :class="{ on: filter === option.value }" @click="filter = option.value">{{ option.label }}</button></div>
    <div v-for="row in rows" :key="row.id" :class="['ps-row', { open: open === row.id }]" :data-provider-row="row.id">
      <button type="button" class="ps-head" :aria-expanded="open === row.id" @click="open = open === row.id ? null : row.id"><strong dir="ltr">{{ row.name }}</strong>
        <span v-if="row.items.some(item => item.id === providers.provider.value)" class="w-badge blue">{{ s('الحالي', 'Current') }}</span>
        <span v-if="row.items.some(item => item.verified)" class="w-badge green">{{ s('يعمل', 'Working') }}</span><span v-else-if="row.items.some(item => item.configured)" class="w-badge blue">{{ s('مربوط', 'Linked') }}</span>
        <span class="w-grow" /><ChevronDown :size="15" :data-open="open === row.id" /></button>
      <template v-if="open === row.id">
        <div v-if="row.items.length > 1" class="w-seg" role="radiogroup" :aria-label="s('طريقة الربط', 'How to link')"><button v-for="item in row.items" :key="item.id" type="button" role="radio" :aria-checked="current(row).id === item.id" :class="{ on: current(row).id === item.id }" @click="pick = { ...pick, [row.id]: item.id }">{{ item.kind === 'subscription' ? s('اشتراك', 'Subscription') : 'API' }}</button></div>
        <ProviderSetupItem :key="current(row).id" :item="current(row)" :providers="providers" />
      </template>
    </div>
  </div>
</template>
