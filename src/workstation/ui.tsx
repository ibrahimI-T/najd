import { createContext, useContext, useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type ComponentType, type ReactNode } from 'react'
import { Search as SearchIcon, X } from 'lucide-react'
import type { Lang } from './types'

// Shared components of the workstation (spec 8.3). All are keyboard operable with visible focus and accessible names.
export const LangContext = createContext<Lang>('ar')
export const useLang = () => { const lang = useContext(LangContext); return { lang, ar: lang === 'ar', s: (arabic: string, english: string) => lang === 'ar' ? arabic : english } }
type Icon = ComponentType<{ size?: number; strokeWidth?: number; 'aria-hidden'?: boolean }>

export function Button({ variant = 'default', icon: Glyph, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'default' | 'primary' | 'ghost' | 'danger'; icon?: Icon }) {
  return <button type="button" {...rest} className={'w-btn ' + variant + (rest.className ? ' ' + rest.className : '')}>{Glyph && <Glyph size={15} aria-hidden />}{children}</button>
}
export function IconButton({ label, icon: Glyph, size = 16, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; icon: Icon; size?: number }) {
  return <button type="button" title={label} aria-label={label} {...rest} className={'w-icon' + (rest.className ? ' ' + rest.className : '')}><Glyph size={size} strokeWidth={1.8} aria-hidden /></button>
}
export function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (value: T) => void }) {
  return <div className="w-seg" role="radiogroup" aria-label={label}>{options.map(option => <button type="button" key={option.value} role="radio" aria-checked={value === option.value} className={value === option.value ? 'on' : ''} onClick={() => onChange(option.value)}>{option.label}</button>)}</div>
}
export function Tabs<T extends string>({ label, value, tabs, onChange }: { label: string; value: T; tabs: { value: T; label: string; count?: number }[]; onChange: (value: T) => void }) {
  return <div className="w-tabs" role="tablist" aria-label={label}>{tabs.map(tab => <button type="button" key={tab.value} role="tab" aria-selected={value === tab.value} className={value === tab.value ? 'on' : ''} onClick={() => onChange(tab.value)}>{tab.label}{tab.count !== undefined && <small>{tab.count}</small>}</button>)}</div>
}
export function Chip({ active, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return <button type="button" aria-pressed={active} {...rest} className={'w-chip' + (active ? ' on' : '')}>{children}</button>
}
export function Search({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) {
  return <label className="w-search"><SearchIcon size={15} aria-hidden /><span className="sr">{placeholder}</span><input type="search" value={value} maxLength={120} placeholder={placeholder} onChange={event => onChange(event.target.value)} /></label>
}
export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return <label className="w-field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>
}
export function Toggle({ label, checked, disabled, onChange }: { label: string; checked: boolean; disabled?: boolean; onChange: (checked: boolean) => void }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} className={'w-toggle' + (checked ? ' on' : '')} onClick={() => onChange(!checked)}><i /></button>
}
export function Row({ title, hint, children }: { title: string; hint?: ReactNode; children?: ReactNode }) {
  return <div className="w-row"><div><strong>{title}</strong>{hint && <small>{hint}</small>}</div>{children && <div className="w-row-end">{children}</div>}</div>
}
export function Section({ title, hint, actions, children }: { title: string; hint?: string; actions?: ReactNode; children: ReactNode }) {
  return <section className="w-section"><header><div><h3>{title}</h3>{hint && <p>{hint}</p>}</div>{actions}</header>{children}</section>
}
export function Badge({ tone = 'neutral', children }: { tone?: 'neutral' | 'green' | 'orange' | 'red' | 'blue'; children: ReactNode }) { return <span className={'w-badge ' + tone}>{children}</span> }
export function Banner({ tone = 'info', children, action }: { tone?: 'info' | 'warn' | 'error'; children: ReactNode; action?: ReactNode }) {
  return <div className={'w-banner ' + tone} role={tone === 'error' ? 'alert' : 'status'}><span>{children}</span>{action}</div>
}
export function Empty({ icon: Glyph, title, body, action }: { icon?: Icon; title: string; body?: string; action?: ReactNode }) {
  return <div className="w-empty">{Glyph && <Glyph size={26} strokeWidth={1.5} aria-hidden />}<strong>{title}</strong>{body && <p>{body}</p>}{action}</div>
}
export function Skeleton({ rows = 3 }: { rows?: number }) { return <div className="w-skeleton" aria-busy="true">{Array.from({ length: rows }, (_, index) => <i key={index} />)}</div> }
export function Page({ title, intro, actions, children }: { title: string; intro?: string; actions?: ReactNode; children: ReactNode }) {
  return <div className="w-page"><header className="w-page-head"><div><h1>{title}</h1>{intro && <p>{intro}</p>}</div>{actions && <div className="w-page-actions">{actions}</div>}</header>{children}</div>
}
export function Dialog({ title, onClose, children, footer, wide }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const { s } = useLang(), id = useId(), box = useRef<HTMLDivElement>(null)
  useEffect(() => { const previous = document.activeElement as HTMLElement | null; box.current?.querySelector<HTMLElement>('input,textarea,select,button:not([data-close])')?.focus(); return () => previous?.focus?.() }, [])
  return <div className="w-scrim" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <div ref={box} className={'w-dialog' + (wide ? ' wide' : '')} role="dialog" aria-modal="true" aria-labelledby={id} onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); onClose() } }}>
      <header><h2 id={id}>{title}</h2><IconButton data-close label={s('إغلاق', 'Close')} icon={X} onClick={onClose} /></header>
      <div className="w-dialog-body">{children}</div>{footer && <footer>{footer}</footer>}
    </div></div>
}
// A menu anchored to its button; closes on Escape or an outside click, and returns focus.
export function Menu({ label, trigger, children, align = 'start', up }: { label: string; trigger: (props: { onClick: () => void; 'aria-expanded': boolean; 'aria-haspopup': 'menu' }) => ReactNode; children: (close: () => void) => ReactNode; align?: 'start' | 'end'; up?: boolean }) {
  const [open, setOpen] = useState(false), box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && !box.current?.contains(event.target)) setOpen(false) }
    document.addEventListener('pointerdown', outside); return () => document.removeEventListener('pointerdown', outside)
  }, [open])
  return <div className="w-menu-box" ref={box} onKeyDown={event => { if (event.key === 'Escape' && open) { event.stopPropagation(); setOpen(false); box.current?.querySelector('button')?.focus() } }}>
    {trigger({ onClick: () => setOpen(value => !value), 'aria-expanded': open, 'aria-haspopup': 'menu' })}
    {open && <div className={'w-menu ' + align + (up ? ' up' : '')} role="menu" aria-label={label}>{children(() => setOpen(false))}</div>}
  </div>
}
export function MenuItem({ icon: Glyph, children, hint, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { icon?: Icon; hint?: string }) {
  return <button type="button" role="menuitem" {...rest} className="w-menu-item">{Glyph && <Glyph size={15} aria-hidden />}<span>{children}{hint && <small>{hint}</small>}</span></button>
}
// Resize handle: drag or arrow keys. Direction is physical: the shell keeps the rail left and the workbench right in both languages.
export function SplitHandle({ label, value, min, max, side, onChange }: { label: string; value: number; min: number; max: number; side: 'left' | 'right'; onChange: (value: number) => void }) {
  const sign = side === 'left' ? 1 : -1
  return <div className="w-split" role="separator" aria-orientation="vertical" aria-label={label} aria-valuenow={value} aria-valuemin={min} aria-valuemax={max} tabIndex={0}
    onKeyDown={event => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); onChange(Math.min(max, Math.max(min, value + (event.key === 'ArrowRight' ? 16 : -16) * sign))) } }}
    onPointerDown={event => {
      const start = event.clientX, from = value, target = event.currentTarget
      target.setPointerCapture(event.pointerId)
      const move = (next: PointerEvent) => onChange(Math.min(max, Math.max(min, from + (next.clientX - start) * sign)))
      const up = () => { target.removeEventListener('pointermove', move); target.removeEventListener('pointerup', up) }
      target.addEventListener('pointermove', move); target.addEventListener('pointerup', up)
    }} />
}
