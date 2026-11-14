import type { ComponentType, ReactElement } from 'react'
import { BookOpen, Bot, Box, Brain, ChevronLeft, ChevronRight, Code, Database, FileSpreadsheet, FileText, Globe, GraduationCap, Landmark, Mail, Megaphone, Microscope, Monitor, MoreHorizontal, Music, Palette, PenLine, Presentation, Puzzle, Scale, Search as SearchIcon, Smartphone, Sparkles, Video, Wand2, Wrench } from 'lucide-react'
import { canInstallPackage, descriptionOf, nameOf, reasonText } from './catalogView'
import type { CapabilityKind, CatalogEntry } from './types'
import { useLang } from './ui'

// The marketplace look: a centred column, a title with its search, category pills, two-column cards with a coloured icon tile, and,
// on the Installed view, the other categories below as sections with "show more". Every action comes from the hub, so nothing here
// installs, enables or removes on its own.
type Glyph = ComponentType<{ size?: number; strokeWidth?: number }>
const ICONS: [RegExp, Glyph, string][] = [
  [/pdf/, FileText, '#e5484d'], [/excel|sheet|xlsx/, FileSpreadsheet, '#30a46c'], [/word|docx/, FileText, '#3e63dd'], [/slide|pptx|keynote|presentation/, Presentation, '#f76b15'],
  [/github|code|dev|test|refactor|api|terraform/, Code, '#8e8c99'], [/image|logo|design|theme|palette/, Palette, '#e93d82'], [/3d|model3d|scene/, Box, '#8e4ec6'], [/video/, Video, '#e5484d'],
  [/audio|tts|podcast|speech/, Music, '#12a594'], [/scholar|academic|cite|anki|cv|interview/, GraduationCap, '#0090ff'], [/imf|finance|stock|equity|invest|pricing|saas|value/, Landmark, '#f5d90a'],
  [/world-bank|igo|data|metrics/, Database, '#12a594'], [/edgar|legal|tos|regulat|iso|risk/, Scale, '#a1a1aa'], [/browser|web|seo|landing|site/, Globe, '#0090ff'], [/computer|desktop/, Monitor, '#0090ff'],
  [/mobile|android|ios|wechat/, Smartphone, '#30a46c'], [/mail|newsletter/, Mail, '#3e63dd'], [/marketing|campaign|copy|churn|ad-/, Megaphone, '#f76b15'], [/research|scientific|cross-examine/, Microscope, '#3e63dd'],
  [/humanizer|writing|writer|edit/, PenLine, '#e5484d'], [/find-skills|search/, SearchIcon, '#30a46c'], [/agent|delegat|automation/, Bot, '#8e4ec6'], [/brain|memory|plan/, Brain, '#e93d82'],
  [/doc|guide|glossary|minutes|recap/, BookOpen, '#0090ff'], [/tool|builder|creator/, Wrench, '#8e8c99']
]
export function iconFor(entry: Pick<CatalogEntry, 'id' | 'kind' | 'categories'>): [Glyph, string] {
  const key = (entry.id + ' ' + entry.categories.join(' ')).toLowerCase()
  const found = ICONS.find(([pattern]) => pattern.test(key))
  return found ? [found[1], found[2]] : entry.kind === 'plugin' ? [Puzzle, '#8e8c99'] : [Wand2, '#8e8c99']
}

export function MarketCard({ entry, onDetails, onInstall, onUse }: { entry: CatalogEntry; onDetails: () => void; onInstall: () => void; onUse?: () => void }) {
  const { s, lang } = useLang()
  const [Icon, color] = iconFor(entry)
  const installed = entry.packageInstalled || entry.layer === 'builtin' || entry.categories.includes('installed')
  const problem = installed && entry.state !== 'AVAILABLE' && entry.state !== 'UPDATE_AVAILABLE'
  const meta = entry.kind === 'skill' ? [entry.publisher.name ? s('من ', 'From ') + entry.publisher.name : '', entry.downloads ? entry.downloads.toLocaleString(lang) + s(' مستخدم', ' users') : ''].filter(Boolean).join(' · ') : ''
  return <article className={'mk-card ' + entry.kind} data-entry={entry.id} data-state={entry.state}>
    <div className="mk-icon" style={{ color, background: color + '22' }} aria-hidden><Icon size={20} strokeWidth={1.8} /></div>
    <div className="mk-text"><strong dir="auto">{nameOf(entry, lang)}</strong>{meta ? <small dir="auto">{meta}</small> : <small dir="auto" className="mk-line">{descriptionOf(entry, lang)}</small>}</div>
    <div className="mk-end">
      {entry.state === 'AVAILABLE' && entry.kind === 'skill' && onUse && <button type="button" className="mk-pill" onClick={onUse}>{s('استخدام', 'Use')}</button>}
      {canInstallPackage(entry) && !installed && <button type="button" className="mk-pill" onClick={onInstall} data-install={entry.id}>{entry.kind === 'skill' ? s('إضافة', 'Add') : s('تثبيت', 'Install')}</button>}
      {entry.packageInstalled && entry.state === 'UPDATE_AVAILABLE' && entry.installable && <button type="button" className="mk-pill" onClick={onInstall}>{s('تحديث', 'Update')}</button>}
      {entry.metadataOnly && <small className="mk-meta">{s('وصف فقط', 'Description only')}</small>}
      <button type="button" className="mk-more" aria-label={s('التفاصيل', 'Details')} onClick={onDetails} data-details={entry.id}><MoreHorizontal size={16} aria-hidden /></button>
    </div>
    {entry.kind === 'skill' && <p className="mk-desc" dir="auto">{descriptionOf(entry, lang)}</p>}
    {problem && <small className="mk-problem" dir="auto">{entry.state === 'DISABLED' ? s('معطلة', 'Disabled') : reasonText(entry.reason, lang) || s('غير جاهزة', 'Not ready')}</small>}
  </article>
}

export function CategoryPills({ categories, value, names, onChange }: { categories: readonly string[]; value: string; names: Record<string, [string, string]>; onChange: (value: string) => void }) {
  const { s, ar } = useLang()
  const scroll = (direction: number) => document.querySelector('.mk-pills-row')?.scrollBy({ left: direction * 240 * (ar ? -1 : 1), behavior: 'smooth' })
  return <div className="mk-pills">
    <button type="button" className="mk-arrow" aria-label={s('السابق', 'Previous')} onClick={() => scroll(-1)}>{ar ? <ChevronRight size={15} /> : <ChevronLeft size={15} />}</button>
    <div className="mk-pills-row" role="tablist">{categories.map(item => <button type="button" role="tab" key={item} aria-selected={value === item} className={value === item ? 'on' : ''} onClick={() => onChange(item)} data-category={item}>{names[item]?.[ar ? 0 : 1] || item}</button>)}</div>
    <button type="button" className="mk-arrow" aria-label={s('التالي', 'Next')} onClick={() => scroll(1)}>{ar ? <ChevronLeft size={15} /> : <ChevronRight size={15} />}</button>
  </div>
}

// The Installed view: what is installed first, then every other category as a section of eight with a "show more" line.
export function SectionedList({ entries, kind, categories, names, render, onShowAll }: { entries: CatalogEntry[]; kind: CapabilityKind; categories: readonly string[]; names: Record<string, [string, string]>; render: (entry: CatalogEntry) => ReactElement; onShowAll: (category: string) => void }) {
  const { s, ar } = useLang()
  const installed = entries.filter(entry => entry.kind === kind && entry.categories.includes('installed'))
  const others = categories.filter(item => item !== 'installed')
  return <>
    {installed.length ? <div className="mk-grid" data-hub="grid">{installed.map(render)}</div> : <p className="mk-empty">{s('لا شيء مثبت بعد.', 'Nothing installed yet.')}</p>}
    {others.map(category => {
      const list = entries.filter(entry => entry.kind === kind && entry.categories.includes(category))
      if (!list.length) return null
      return <section key={category} className="mk-section"><h3>{names[category]?.[ar ? 0 : 1] || category}</h3>
        <div className="mk-grid">{list.slice(0, 8).map(render)}</div>
        {list.length > 8 && <button type="button" className="mk-showmore" onClick={() => onShowAll(category)}><Sparkles size={13} aria-hidden />{s(`عرض ${list.length - 8} أخرى`, `Show ${list.length - 8} more`)}</button>}
      </section>
    })}
  </>
}
