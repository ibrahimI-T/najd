import type { Copy } from './copy'
import type { ProviderControls } from './useProviders'
import { ProviderMenu } from './ProviderMenu'
import { providerBadge } from './ProviderSettings'
import { EffortSlider } from './EffortSlider'

export function effortLabel(value: NajdReasoningPreference, t: Copy) {
  return { auto: t.reasoningAuto, none: t.reasoningNone, minimal: t.reasoningMinimal, low: t.reasoningLow,
    medium: t.reasoningMedium, high: t.reasoningHigh, xhigh: t.reasoningXhigh, max: t.reasoningMax }[value]
}

export function ComposerModels({ c, t, disabled, onConnect }: { c: ProviderControls; t: Copy; disabled: boolean; onConnect(id: NajdProviderId): void }) {
  const provider = c.catalog.find(p => p.id === c.provider)
  return <div className="composer-models">
    <ProviderMenu upward label={provider?.name || t.providerPicker} selected={c.provider} disabled={disabled}
      options={c.catalog.map(p => ({ id: p.id, label: p.name, badge: providerBadge(p, t), verified: p.verified }))}
      onSelect={id => { const p = c.catalog.find(p => p.id === id)!; c.setProvider(p.id); if (!p.configured) onConnect(p.id) }} />
    <div className="composer-model-group">
      <label className="composer-select"><span className="sr-only">{t.localModelChoose}</span>
        <select aria-label={t.localModelChoose} value={c.model} disabled={disabled || c.loading[c.provider] || !provider?.configured}
          onChange={e => c.chooseModel(c.provider, e.target.value)}>
          <option value="">{c.loading[c.provider] ? t.localModelLoading : t.localModelChoosePlaceholder}</option>
          {(c.models[c.provider] || []).map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
        </select></label>
      <EffortSlider t={t} value={c.effort} supported={c.supported} preview={c.preview} disabled={disabled || !c.model} onChange={c.setEffort} />
    </div>
  </div>
}
