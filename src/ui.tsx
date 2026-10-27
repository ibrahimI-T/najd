import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'

/* Reusable NAJD UI primitives. Class names match styles.css and the desktop
   smoke contract — do not rename classes without updating tests. */

export function SettingRow({ title, hint, children, className = '' }: {
  title: string; hint?: string; children: ReactNode; className?: string
}) {
  return <div className={'setting-row' + (className ? ' ' + className : '')}>
    <div><h3>{title}</h3>{hint ? <p>{hint}</p> : null}</div>
    {children}
  </div>
}

export function Segmented({ label, children }: { label: string; children: ReactNode }) {
  return <div className="segmented" role="group" aria-label={label}>{children}</div>
}

export function StatusPill({ ready, children }: { ready?: boolean; children: ReactNode }) {
  return <span className={'status-pill' + (ready ? ' ready' : '')}>{children}</span>
}

export function InfoNote({ icon: Icon, title, children }: {
  icon?: LucideIcon; title: string; children: ReactNode
}) {
  return <div className="info-note">{Icon ? <Icon size={18} /> : null}<div><strong>{title}</strong>{children}</div></div>
}

export function CardHeading({ icon: Icon, title, hint, className = 'browser-card-top', size = 21 }: {
  icon: LucideIcon; title: string; hint?: string; className?: string; size?: number
}) {
  return <div className={className}><Icon size={size} /><div><h3>{title}</h3>{hint ? <p>{hint}</p> : null}</div></div>
}
