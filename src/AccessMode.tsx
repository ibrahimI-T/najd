import { useEffect, useRef } from 'react'
import { Check, ChevronDown, ShieldCheck } from 'lucide-react'
import type { Copy } from './copy'

export type AccessMode = 'ask' | 'approve' | 'full'

// All three modes are enforced by the core (najd-core.cjs agentApproval): 'ask' asks for every action, 'approve'
// answers lower-risk actions itself, 'full' answers every action; automatic answers are recorded.
export const enforcedAccessModes: readonly AccessMode[] = ['ask', 'approve', 'full']

export function normalizeAccessMode(value: unknown): AccessMode {
  return enforcedAccessModes.includes(value as AccessMode) ? (value as AccessMode) : 'ask'
}

export function AccessModeMenu({ mode, disabled, t, onSelect }: {
  mode: AccessMode; disabled: boolean; t: Copy; onSelect(mode: AccessMode): void
}) {
  const disclosure = useRef<HTMLDetailsElement>(null)
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !disclosure.current?.contains(event.target) && disclosure.current) disclosure.current.open = false
    }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [])
  useEffect(() => { if (disabled && disclosure.current) disclosure.current.open = false }, [disabled])
  const close = () => { if (disclosure.current) { disclosure.current.open = false; disclosure.current.querySelector('summary')?.focus() } }
  const options: { id: AccessMode; label: string; description: string }[] = [
    { id: 'ask', label: t.accessAsk, description: t.accessAskDesc },
    { id: 'approve', label: t.accessApprove, description: t.accessApproveDesc },
    { id: 'full', label: t.accessFull, description: t.accessFullDesc }
  ]
  const current = options.find(option => option.id === mode) ?? options[0]
  return <details ref={disclosure} className="provider-menu upward access-menu"
    onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); close() } }}>
    <summary aria-disabled={disabled} tabIndex={disabled ? -1 : 0} aria-label={t.accessLabel}
      onClick={event => { if (disabled) event.preventDefault() }}>
      <ShieldCheck size={14} /><span className="access-current">{current.label}</span><ChevronDown size={15} />
    </summary>
    <div className="provider-options access-options">
      <p className="access-title">{t.accessPrompt}</p>
      <div className="provider-options-list">{options.map(option => {
        const enforced = enforcedAccessModes.includes(option.id)
        return <button type="button" key={option.id} data-access={option.id} disabled={disabled || !enforced}
          aria-pressed={option.id === mode} onClick={() => { onSelect(option.id); close() }}>
          <span className="access-option-text">
            <span className="access-option-name">{option.label}</span>
            <small className="access-option-desc">{option.description}</small>
          </span>
          {!enforced && <small className="access-planned">{t.planned}</small>}
          {enforced && option.id === mode && <Check size={14} />}
        </button>
      })}</div>
    </div>
  </details>
}
