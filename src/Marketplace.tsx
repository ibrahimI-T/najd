import { useState, type ReactNode } from 'react'
import { BadgeCheck, Blocks, Search } from 'lucide-react'

// A store-style catalog (owner reference 2026-10-19): search, an "Installed N" chip that shows only what is installed,
// and cards with an icon tile, the name, a verified mark and a two-line description. Used for skills, plugins and
// connections; each card may carry its own control (a switch, a status).
export type MarketItem = { id: string; name: string; description: string; installed: boolean; verified?: boolean; status?: string; statusOn?: boolean; control?: ReactNode; icon?: ReactNode }

export function Marketplace({ id, language, title, items, initialInstalled = false, empty }: {
  id: string; language: 'ar' | 'en'; title: string; items: MarketItem[]; initialInstalled?: boolean; empty?: string
}) {
  const ar = language === 'ar'
  const [query, setQuery] = useState('')
  const [installedOnly, setInstalledOnly] = useState(initialInstalled)
  const installed = items.filter(item => item.installed).length
  const words = query.trim().toLowerCase()
  const shown = items.filter(item => (!installedOnly || item.installed) && (!words || `${item.name} ${item.description}`.toLowerCase().includes(words)))
  return <section className="market" data-market={id} aria-label={title}>
    <header className="market-head">
      <h3>{title}</h3>
      <button type="button" className={'market-installed' + (installedOnly ? ' on' : '')} aria-pressed={installedOnly} onClick={() => setInstalledOnly(value => !value)}>
        <BadgeCheck size={14} />{ar ? `مثبّت ${installed}` : `Installed ${installed}`}</button>
    </header>
    <label className="market-search"><Search size={17} /><input type="search" value={query} maxLength={200} placeholder={ar ? 'ابحث…' : 'Search…'} onChange={event => setQuery(event.target.value)} /></label>
    {shown.length ? <div className="market-grid">
      {shown.slice(0, 60).map(item => <article key={item.id} className="market-card" data-installed={item.installed}>
        <div className="market-icon" aria-hidden="true">{item.icon || <Blocks size={26} strokeWidth={1.6} />}</div>
        <div className="market-text">
          <strong dir="auto">{item.name}{item.verified && <BadgeCheck size={15} className="market-verified" aria-label={ar ? 'موثّق' : 'Verified'} />}</strong>
          <p dir="auto">{item.description}</p>
          {(item.status || item.control) && <div className="market-foot">{item.status && <span className={'market-status' + ((item.statusOn ?? item.installed) ? ' on' : '')}>{item.status}</span>}{item.control}</div>}
        </div>
      </article>)}
    </div> : <p className="market-empty">{installedOnly && !installed ? (ar ? 'لا توجد عناصر مثبّتة هنا بعد، ويضيف نجد ما تحتاجه مهامك عند الحاجة.' : 'Nothing installed here yet; NAJD adds what your tasks need when they need it.') : empty || (ar ? 'لا توجد نتائج مطابقة. جرّب كلمة أخرى.' : 'No matches. Try another word.')}</p>}
    {shown.length > 60 && <p className="market-empty">{ar ? `عرض 60 من ${shown.length}؛ استخدم البحث للتحديد.` : `Showing 60 of ${shown.length}; search to narrow.`}</p>}
  </section>
}
