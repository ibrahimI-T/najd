import { useCallback, useEffect, useRef, useState } from 'react'
import { visibleInterval } from './useVisibleInterval'

// Non-secret preferences only. Catalogs and credential state always come from main.
const effortKey = 'najd.effort.v1'
const effortValues: readonly NajdReasoningPreference[] = ['auto', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']

export function useProviders(draft: string) {
  const [catalog, setCatalog] = useState<NajdProvider[]>([])
  const [provider, setProvider] = useState<NajdProviderId>(() => (localStorage.getItem('najd.provider.v1') || 'ollama') as NajdProviderId)
  const [models, setModels] = useState<Partial<Record<NajdProviderId, NajdProviderModel[]>>>({})
  const [choices, setChoices] = useState<Partial<Record<NajdProviderId, string>>>(() => {
    try {
      const stored = JSON.parse(localStorage.getItem('najd.models.v2') || '{}')
      return { ollama: localStorage.getItem('najd.ollama.model.v1') || '', 'kimi-code': localStorage.getItem('najd.kimi.model.v1') || 'k3-256k', chatgpt: localStorage.getItem('najd.chatgpt.model.v1') || '', ...stored }
    } catch { return {} }
  })
  const [effort, setEffort] = useState<NajdReasoningPreference>(() => {
    const stored = localStorage.getItem(effortKey)
    return effortValues.includes(stored as NajdReasoningPreference) ? stored as NajdReasoningPreference : 'auto'
  })
  const [preview, setPreview] = useState<NajdReasoningPreference | null>(null)
  const [loading, setLoading] = useState<Partial<Record<NajdProviderId, boolean>>>({})
  const [errors, setErrors] = useState<Partial<Record<NajdProviderId, boolean>>>({})
  const [connectionBusy, setConnectionBusy] = useState(false)
  const alive = useRef(true)
  const tickets = useRef<Partial<Record<NajdProviderId, number>>>({})
  const previous = useRef<NajdProvider[]>([])
  const refresh = useCallback(async () => {
    if (!window.najdProviders) return
    try {
      const next = await window.najdProviders.catalog()
      if (!alive.current) return
      for (const p of next) {
        const old = previous.current.find(o => o.id === p.id)
        if (old && (old.accountId !== p.accountId || old.configured !== p.configured)) {
          tickets.current[p.id] = (tickets.current[p.id] || 0) + 1
          setModels(m => ({ ...m, [p.id]: undefined }))
          setLoading(m => ({ ...m, [p.id]: false }))
          if (p.id === 'chatgpt' || !p.configured) setChoices(m => ({ ...m, [p.id]: '' }))
        }
      }
      previous.current = next
      setCatalog(next)
      if (!next.some(p => p.id === provider)) setProvider('ollama')
    } catch { /* No credentials are inferred from a failed status read. */ setCatalog([]) }
  }, [provider])
  useEffect(() => {
    alive.current = true
    void refresh()
    const stopPolling = visibleInterval(() => { void refresh() }, 2000)
    return () => { alive.current = false; stopPolling() }
  }, [refresh])
  const loadModels = useCallback(async (id: NajdProviderId) => {
    if (!window.najdProviders) return
    const ticket = tickets.current[id] = (tickets.current[id] || 0) + 1
    setLoading(m => ({ ...m, [id]: true })); setErrors(m => ({ ...m, [id]: false }))
    try {
      const list = await window.najdProviders.models(id)
      if (!alive.current || tickets.current[id] !== ticket) return
      setModels(m => ({ ...m, [id]: list }))
      setChoices(m => ({ ...m, [id]: list.some(o => o.id === m[id]) ? m[id] : '' }))
    } catch {
      if (alive.current && tickets.current[id] === ticket) { setModels(m => ({ ...m, [id]: [] })); setErrors(m => ({ ...m, [id]: true })) }
    } finally { if (alive.current && tickets.current[id] === ticket) setLoading(m => ({ ...m, [id]: false })) }
  }, [])
  const current = catalog.find(p => p.id === provider)
  useEffect(() => {
    if (current?.configured && !models[provider] && !loading[provider]) void loadModels(provider)
  }, [current?.configured, models, provider, loading, loadModels])
  useEffect(() => { localStorage.setItem('najd.provider.v1', provider) }, [provider])
  useEffect(() => { localStorage.setItem('najd.models.v2', JSON.stringify(choices)) }, [choices])
  useEffect(() => { localStorage.setItem(effortKey, effort) }, [effort])
  const model = typeof choices[provider] === 'string' ? choices[provider]! : ''
  const supported = models[provider]?.find(m => m.id === model)?.efforts || []
  useEffect(() => {
    // Missing or failed catalogs cannot invalidate a saved preference.
    if (models[provider] && !loading[provider] && !errors[provider] && effort !== 'auto' && !supported.includes(effort)) setEffort('auto')
  }, [models, provider, loading, errors, effort, supported])
  useEffect(() => {
    let mounted = true
    setPreview(null)
    const timer = window.setTimeout(() => {
      if (!model || !window.najdProviders) return
      void window.najdProviders.previewReasoning(provider, model, draft.slice(0, 4000), effort)
        .then(value => { if (mounted) setPreview(value) }).catch(() => {})
    }, 180)
    return () => { mounted = false; window.clearTimeout(timer) }
  }, [provider, model, draft, effort])
  const chooseModel = useCallback((id: NajdProviderId, name: string) => setChoices(m => ({ ...m, [id]: name })), [])
  return { catalog, provider, setProvider, models, choices, model, chooseModel, effort, setEffort, supported, preview,
    loading, errors, refresh, loadModels, connectionBusy, setConnectionBusy }
}
export type ProviderControls = ReturnType<typeof useProviders>
