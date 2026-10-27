import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'

export function ProviderMenu({ label, options, selected, disabled, upward = false, onSelect }: {
  label: string; options: { id: string; label: string; badge?: string; verified?: boolean }[]
  selected: string; disabled: boolean; upward?: boolean; onSelect(id: string): void
}) {
  const disclosure = useRef<HTMLDetailsElement>(null)
  const [search, setSearch] = useState('')
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !disclosure.current?.contains(event.target) && disclosure.current) disclosure.current.open = false
    }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [])
  useEffect(() => { if (disabled && disclosure.current) disclosure.current.open = false }, [disabled])
  const close = () => { if (disclosure.current) { disclosure.current.open = false; disclosure.current.querySelector('summary')?.focus() } }
  return <details ref={disclosure} className={'provider-menu' + (upward ? ' upward' : '')} onToggle={() => setSearch('')}
    onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); close() } }}>
    <summary aria-disabled={disabled} tabIndex={disabled ? -1 : 0} onClick={event => { if (disabled) event.preventDefault() }}>
      <span>{label}</span><ChevronDown size={15} />
    </summary>
    <div className="provider-options">
      {options.length > 15 && <input type="search" aria-label={label} placeholder="⌕" value={search} onChange={e => setSearch(e.target.value)} />}
      <div className="provider-options-list">{options.filter(o => o.label.toLowerCase().includes(search.toLowerCase())).map(option =>
        <button type="button" key={option.id} data-choice={option.id} disabled={disabled} aria-pressed={option.id === selected}
          onClick={() => { onSelect(option.id); close() }}>
          <span className="provider-option-name">{option.label}</span>
          {option.badge && <small className={'provider-badge' + (option.verified ? ' verified' : '')}>{option.badge}</small>}
          {option.id === selected && <Check size={14} />}
        </button>)}</div>
    </div>
  </details>
}
