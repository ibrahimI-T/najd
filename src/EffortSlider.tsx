import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { Brain, ChevronDown } from 'lucide-react'
import type { Copy } from './copy'
import { effortLabel } from './ComposerModels'

const ORDER: readonly NajdReasoningPreference[] = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']

// Thinking level as a pill slider (owner reference 2026-10-19): one stop per level the selected model actually
// supports, in order, with the chosen level's name above it. Auto leaves the choice to NAJD per request.
export function EffortSlider({ t, value, supported, preview, disabled, onChange, defaultOpen = false }: {
  t: Copy; value: NajdReasoningPreference; supported: NajdReasoningPreference[]; preview: NajdReasoningPreference | null; disabled: boolean
  onChange: (value: NajdReasoningPreference) => void; defaultOpen?: boolean
}) {
  const levels = ORDER.filter(level => supported.includes(level))
  const [open, setOpen] = useState(defaultOpen)
  const container = useRef<HTMLDivElement>(null), track = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const close = (event: globalThis.PointerEvent) => { if (event.target instanceof Node && !container.current?.contains(event.target)) setOpen(false) }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [])
  const index = levels.indexOf(value)
  const shown = value === 'auto' ? (preview ? `${t.reasoningAuto} · ${effortLabel(preview, t)}` : t.reasoningAuto) : effortLabel(value, t)
  const fill = levels.length < 2 ? 100 : index < 0 ? 0 : index / (levels.length - 1) * 100
  const choose = (next: number) => { const level = levels[Math.max(0, Math.min(levels.length - 1, next))]; if (level) onChange(level) }
  const fromPointer = (event: PointerEvent<HTMLDivElement>) => {
    const box = track.current?.getBoundingClientRect()
    if (!box || levels.length < 2) { choose(0); return }
    // The track runs left to right in both languages, like the reference.
    const ratio = Math.max(0, Math.min(1, (event.clientX - box.left - 22) / Math.max(1, box.width - 44)))
    choose(Math.round(ratio * (levels.length - 1)))
  }
  const key = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') { event.preventDefault(); choose(index < 0 ? 0 : index + 1) }
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') { event.preventDefault(); choose(index < 0 ? 0 : index - 1) }
    else if (event.key === 'Home') { event.preventDefault(); choose(0) }
    else if (event.key === 'End') { event.preventDefault(); choose(levels.length - 1) }
    else if (event.key === 'Escape') setOpen(false)
  }
  return <div className="effort" ref={container}>
    <button type="button" className="effort-trigger" disabled={disabled} aria-expanded={open} title={t.autoReasoningNote}
      onClick={() => setOpen(current => !current)}><Brain size={15} /><span>{shown}</span><ChevronDown size={13} /></button>
    {open && <div className="effort-popover" role="dialog" aria-label={t.reasoningLabel}>
      <div className="effort-head">
        <span>{t.reasoningLabel}</span>
        <button type="button" className={'effort-auto' + (value === 'auto' ? ' on' : '')} aria-pressed={value === 'auto'} onClick={() => onChange('auto')}>{t.reasoningAuto}</button>
      </div>
      <p className="effort-value" aria-live="polite">{value === 'auto' ? shown : effortLabel(value, t)}</p>
      {levels.length ? <div ref={track} className="effort-track" data-auto={value === 'auto'} role="slider" tabIndex={0} dir="ltr"
        aria-label={t.reasoningLabel} aria-valuemin={0} aria-valuemax={levels.length - 1} aria-valuenow={Math.max(0, index)} aria-valuetext={shown}
        onKeyDown={key} onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); fromPointer(event) }}
        onPointerMove={event => { if (event.buttons) fromPointer(event) }}>
        <div className="effort-fill" style={{ width: `calc(36px + (100% - 36px) * ${fill / 100})` }} />
        {levels.map((level, at) => <span key={level} className="effort-stop" data-level={level} title={effortLabel(level, t)}
          style={{ left: levels.length < 2 ? '50%' : `calc(18px + (100% - 36px) * ${at / (levels.length - 1)})` }} />)}
        {index >= 0 && <span className="effort-knob" style={{ left: levels.length < 2 ? '50%' : `calc(18px + (100% - 36px) * ${index / (levels.length - 1)})` }} />}
      </div> : <p className="effort-none">{t.reasoningDefault}</p>}
      {levels.length > 0 && <div className="effort-scale" dir="ltr"><span>{effortLabel(levels[0], t)}</span><span>{effortLabel(levels[levels.length - 1], t)}</span></div>}
    </div>}
  </div>
}
