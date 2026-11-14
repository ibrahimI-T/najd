import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, ChevronLeft, ChevronRight, Settings2 } from 'lucide-react'
import type { ProviderControls } from '../useProviders'
import { useLang } from './ui'

// The model picker of the composer: the models of the linked services as a list, then thinking level and provider as side menus.
// Nothing is changed silently: the pill always shows the model and the thinking level the next request will use.
const EFFORTS: Record<string, [string, string]> = { auto: ['تلقائي', 'Auto'], none: ['بدون', 'None'], minimal: ['أدنى', 'Minimal'], low: ['قياسي', 'Standard'], medium: ['متوسط', 'Medium'], high: ['مرتفع', 'High'], xhigh: ['مرتفع جدًا', 'Very high'], max: ['ماكس', 'Max'] }

export function ModelPicker({ providers, disabled, onSettings }: { providers: ProviderControls; disabled: boolean; onSettings: () => void }) {
  const { s, ar } = useLang()
  const [open, setOpen] = useState(false)
  const [side, setSide] = useState<'effort' | 'provider' | null>(null)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && !box.current?.contains(event.target)) { setOpen(false); setSide(null) } }
    document.addEventListener('pointerdown', outside); return () => document.removeEventListener('pointerdown', outside)
  }, [open])
  const linked = providers.catalog.filter(item => item.configured)
  const current = providers.catalog.find(item => item.id === providers.provider)
  const models = providers.models[providers.provider] || []
  const model = models.find(item => item.id === providers.model)
  const effort = EFFORTS[providers.effort]?.[ar ? 0 : 1] || providers.effort
  const efforts = ['auto', ...providers.supported.filter(item => item !== 'auto')]
  const Arrow = ar ? ChevronLeft : ChevronRight
  return <div className="mp" ref={box} onKeyDown={event => { if (event.key === 'Escape') { setOpen(false); setSide(null) } }}>
    <button type="button" className="mp-pill" disabled={disabled} aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen(value => !value)} data-model-menu>
      <span dir="auto">{model?.label || providers.model || current?.name || s('اختر نموذجًا', 'Choose a model')}</span><small>{effort}</small></button>
    {open && <div className="mp-menu" role="menu" aria-label={s('النموذج', 'Model')}>
      {providers.loading[providers.provider] && <p className="mp-note">{s('يحمّل النماذج…', 'Loading models…')}</p>}
      {!models.length && !providers.loading[providers.provider] && <p className="mp-note">{current?.configured ? s('لا توجد نماذج من هذا المزود.', 'This provider lists no models.') : s('اربط مزودًا أولًا.', 'Link a provider first.')}</p>}
      <div className="mp-models">{models.slice(0, 40).map(item => <button type="button" role="menuitemradio" aria-checked={item.id === providers.model} key={item.id} className="mp-model" onClick={() => { providers.chooseModel(providers.provider, item.id); setOpen(false) }}>
        <strong dir="ltr">{item.label}</strong>{item.contextWindow ? <small>{s('نافذة السياق ', 'Context window ') + Math.round(item.contextWindow / 1000) + 'k'}</small> : null}{item.id === providers.model && <Check size={15} aria-hidden />}</button>)}</div>
      <hr />
      <button type="button" role="menuitem" className="mp-row" aria-expanded={side === 'effort'} onClick={() => setSide(side === 'effort' ? null : 'effort')}><span>{s('مستوى التفكير', 'Thinking level')}</span><small>{effort}</small><Arrow size={14} aria-hidden /></button>
      <button type="button" role="menuitem" className="mp-row" aria-expanded={side === 'provider'} onClick={() => setSide(side === 'provider' ? null : 'provider')}><span>{s('المزود', 'Provider')}</span><small dir="ltr">{current?.name}</small><Arrow size={14} aria-hidden /></button>
      <button type="button" role="menuitem" className="mp-row" onClick={() => { setOpen(false); onSettings() }}><span>{s('إدارة النماذج', 'Manage models')}</span><Settings2 size={14} aria-hidden /></button>
      {side === 'effort' && <div className="mp-side" role="menu">{efforts.map(item => <button type="button" role="menuitemradio" aria-checked={providers.effort === item} key={item} onClick={() => { providers.setEffort(item as NajdReasoningPreference); setSide(null) }}><span>{EFFORTS[item]?.[ar ? 0 : 1] || item}</span>{providers.effort === item && <Check size={15} aria-hidden />}</button>)}</div>}
      {side === 'provider' && <div className="mp-side" role="menu">{(linked.length ? linked : providers.catalog.slice(0, 12)).map(item => <button type="button" role="menuitemradio" aria-checked={providers.provider === item.id} key={item.id} onClick={() => { providers.setProvider(item.id); setSide(null) }}><span dir="ltr">{item.name}</span>{providers.provider === item.id && <Check size={15} aria-hidden />}</button>)}</div>}
    </div>}
    <ChevronDown size={0} aria-hidden style={{ display: 'none' }} />
  </div>
}
