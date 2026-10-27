import { useEffect, useState } from 'react'
import { Users } from 'lucide-react'
import type { Copy } from './copy'
import type { ProviderControls } from './useProviders'
import { CardHeading } from './ui'

const emptyPreset = (label?: string): NajdUnionPreset => ({ ...(label ? { label } : {}), enabled: true, references: [], aggregator: { provider: '', model: '' } })
// A preset's id is also its model id (English letters, digits, . _ : -); any other name (Arabic, spaces) is kept as its label with an id like union-1.
const ID_RULE = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,39}$/
function newId(name: string, taken: Record<string, unknown>) {
  if (ID_RULE.test(name) && !taken[name]) return name
  let n = 1
  while (taken['union-' + n]) n++
  return 'union-' + n
}
const shown = (key: string, preset?: NajdUnionPreset) => preset?.label || key

// Model unions: named presets that appear as one model. The aggregator acts (runs the tool loop); references advise once per user turn.
export function UnionSettings({ t, c, busy }: { t: Copy; c: ProviderControls; busy: boolean }) {
  const [config, setConfig] = useState<NajdUnionConfig>({ default: null, presets: {} })
  const [name, setName] = useState<string>(''), [fresh, setFresh] = useState('')
  const [state, setState] = useState<'idle' | 'saved' | 'error'>('idle'), [working, setWorking] = useState(false)
  const u = t.union
  const usable = c.catalog.filter(p => p.kind !== 'union' && p.configured)
  useEffect(() => {
    let alive = true
    void window.najdUnions?.get().then(value => { if (alive) { setConfig(value); setName(value.default || Object.keys(value.presets)[0] || '') } }).catch(() => { if (alive) setState('error') })
    return () => { alive = false }
  }, [])
  const preset = config.presets[name]
  useEffect(() => {
    if (!preset) return
    for (const id of new Set([preset.aggregator.provider, ...preset.references.map(item => item.provider)].filter(Boolean))) if (!c.models[id] && !c.loading[id]) void c.loadModels(id)
  }, [preset, c.models, c.loading, c.loadModels])
  if (!window.najdUnions) return null
  const change = (next: NajdUnionConfig) => { setConfig(next); setState('idle') }
  const patch = (value: Partial<NajdUnionPreset>) => change({ ...config, presets: { ...config.presets, [name]: { ...preset, ...value } } })
  async function save() {
    if (working || busy) return
    setWorking(true); setState('idle')
    try { const saved = await window.najdUnions!.save(config); setConfig(saved); setState('saved') } catch { setState('error') } finally { setWorking(false) }
  }
  const pick = (provider: string, model: string, onChange: (next: { provider: string; model: string }) => void, label: string) => {
    const models = c.models[provider] || []
    return <div className="union-pick">
      <select aria-label={`${label} · ${u.provider}`} value={provider} disabled={busy || working} onChange={event => onChange({ provider: event.target.value, model: '' })}>
        <option value="">{u.chooseProvider}</option>{usable.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      <select aria-label={`${label} · ${u.model}`} value={model} disabled={busy || working || !provider} onChange={event => onChange({ provider, model: event.target.value })}>
        <option value="">{u.chooseModel}</option>{model && !models.some(m => m.id === model) && <option value={model}>{model}</option>}{models.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
      </select>
    </div>
  }
  return <div className="model-card union-card" data-union>
    <CardHeading icon={Users} title={u.title} hint={u.hint} size={20} className="model-card-heading" />
    {!usable.length && <p className="model-note">{u.noProviders}</p>}
    <div className="union-presets">
      <select aria-label={u.preset} value={name} disabled={busy || working} onChange={event => setName(event.target.value)}>
        {Object.keys(config.presets).length === 0 && <option value="">{u.noPresets}</option>}
        {Object.keys(config.presets).map(key => <option key={key} value={key}>{shown(key, config.presets[key])}{config.default === key ? ' ★' : ''}</option>)}
      </select>
      {preset && <>
        <label className="union-toggle"><input type="checkbox" checked={preset.enabled} disabled={busy || working} onChange={event => patch({ enabled: event.target.checked })} />{u.enabled}</label>
        <button type="button" className="model-refresh" disabled={busy || working || config.default === name} onClick={() => change({ ...config, default: name })}>{u.setDefault}</button>
        <button type="button" className="model-refresh" disabled={busy || working} onClick={() => { const { [name]: _removed, ...rest } = config.presets; const left = Object.keys(rest); change({ default: config.default === name ? left[0] || null : config.default, presets: rest }); setName(left[0] || '') }}>{u.remove}</button>
      </>}
    </div>
    <div className="union-new">
      <input value={fresh} maxLength={40} placeholder={u.newName} aria-label={u.newName} disabled={busy || working} onChange={event => setFresh(event.target.value)} />
      <button type="button" className="model-refresh" data-action="union-add" disabled={busy || working || !fresh.trim() || Object.entries(config.presets).some(([key, value]) => shown(key, value) === fresh.trim())}
        onClick={() => { const label = fresh.trim(), key = newId(label, config.presets); change({ default: config.default || key, presets: { ...config.presets, [key]: emptyPreset(key === label ? undefined : label) } }); setName(key); setFresh('') }}>{u.add}</button>
    </div>
    {preset && <>
      <h4>{u.references}<small>{u.referencesHint}</small></h4>
      {preset.references.map((item, index) => <div className="union-row" key={index}>
        {pick(item.provider, item.model, next => patch({ references: preset.references.map((ref, i) => i === index ? { ...ref, ...next } : ref) }), `${u.reference} ${index + 1}`)}
        <label className="union-toggle"><input type="checkbox" checked={item.enabled !== false} disabled={busy || working} onChange={event => patch({ references: preset.references.map((ref, i) => i === index ? { ...ref, enabled: event.target.checked } : ref) })} />{u.enabled}</label>
        <button type="button" className="model-refresh" disabled={busy || working} onClick={() => patch({ references: preset.references.filter((_, i) => i !== index) })}>{u.removeReference}</button>
      </div>)}
      <button type="button" className="model-refresh" data-action="union-add-reference" disabled={busy || working || preset.references.length >= 12} onClick={() => patch({ references: [...preset.references, { provider: '', model: '', enabled: true }] })}>{u.addReference}</button>
      <h4>{u.aggregator}<small>{u.aggregatorHint}</small></h4>
      {pick(preset.aggregator.provider, preset.aggregator.model, next => patch({ aggregator: next }), u.aggregator)}
    </>}
    <div className="model-actions">
      <button type="button" className="model-refresh" data-action="union-save" disabled={busy || working || (!!preset && (!preset.aggregator.provider || !preset.aggregator.model || preset.references.some(item => !item.provider || !item.model)))} onClick={() => { void save() }}>{u.save}</button>
    </div>
    {state === 'saved' && <p className="model-note" role="status">{u.saved}</p>}
    {state === 'error' && <p className="model-error" role="alert">{u.error}</p>}
  </div>
}
