import { computed, onScopeDispose, reactive, ref, watch } from 'vue'
import { visibleInterval } from '../../useVisibleInterval'

// Vue version of the provider state (same storage keys as the current renderer, so the chosen provider, model and effort carry over).
// Catalogs and credential state always come from the main process; nothing secret is kept here.
const EFFORTS: NajdReasoningPreference[] = ['auto', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']

export function useProviders() {
  const catalog = ref<NajdProvider[]>([])
  const provider = ref<string>(localStorage.getItem('najd.provider.v1') || 'ollama')
  const models = reactive<Record<string, NajdProviderModel[] | undefined>>({})
  const loading = reactive<Record<string, boolean>>({})
  const errors = reactive<Record<string, boolean>>({})
  const choices = reactive<Record<string, string>>((() => { try { return JSON.parse(localStorage.getItem('najd.models.v2') || '{}') || {} } catch { return {} } })())
  const stored = localStorage.getItem('najd.effort.v1') as NajdReasoningPreference | null
  const effort = ref<NajdReasoningPreference>(stored && EFFORTS.includes(stored) ? stored : 'auto')
  const connectionBusy = ref(false)
  let ticket = 0

  async function refresh() {
    if (!window.najdProviders) return
    try {
      catalog.value = await window.najdProviders.catalog()
      if (!catalog.value.some(item => item.id === provider.value)) provider.value = 'ollama'
    } catch { catalog.value = [] }
  }
  async function loadModels(id: string) {
    if (!window.najdProviders) return
    const mine = ++ticket
    loading[id] = true; errors[id] = false
    try {
      const list = await window.najdProviders.models(id)
      if (mine !== ticket) return
      models[id] = list
      if (!list.some(item => item.id === choices[id])) choices[id] = ''
    } catch { models[id] = []; errors[id] = true } finally { loading[id] = false }
  }
  const current = computed(() => catalog.value.find(item => item.id === provider.value))
  const model = computed(() => choices[provider.value] || '')
  const supported = computed(() => models[provider.value]?.find(item => item.id === model.value)?.efforts || [])

  void refresh()
  const stop = visibleInterval(() => { void refresh() }, 2000)
  onScopeDispose(stop)
  watch(() => [current.value?.configured, provider.value] as const, ([configured]) => { if (configured && !models[provider.value] && !loading[provider.value]) void loadModels(provider.value) }, { immediate: true })
  watch(provider, value => localStorage.setItem('najd.provider.v1', value))
  watch(choices, value => localStorage.setItem('najd.models.v2', JSON.stringify(value)), { deep: true })
  watch(effort, value => localStorage.setItem('najd.effort.v1', value))
  // A model that does not offer the saved effort falls back to automatic, never silently to another level.
  watch(supported, list => { if (models[provider.value] && !errors[provider.value] && effort.value !== 'auto' && !list.includes(effort.value)) effort.value = 'auto' })

  return { catalog, provider, models, loading, errors, choices, effort, connectionBusy, current, model, supported, refresh, loadModels,
    setProvider: (id: string) => { provider.value = id }, chooseModel: (id: string, name: string) => { choices[id] = name }, setEffort: (value: NajdReasoningPreference) => { effort.value = value } }
}
export type ProviderState = ReturnType<typeof useProviders>
