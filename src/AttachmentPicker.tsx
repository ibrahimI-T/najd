import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, ExternalLink, Eye, FolderOpen, Library, Paperclip, Plus, Search, Trash2, Wrench } from 'lucide-react'

// Files the main process opens with their default program (electron/main.cjs LIBRARY_OPENABLE).
const OPENABLE = /\.(pdf|docx|xlsx|csv|pptx|txt|md|png|jpe?g|gif|webp|bmp)$/i

export function AttachmentPicker({ language, selected, onChange, onBusyChange, onManageTools, disabled }: {
  language: 'ar' | 'en'; selected: NajdAsset[]; onChange: (items: NajdAsset[]) => void; onBusyChange: (busy: boolean) => void; onManageTools?: () => void; disabled: boolean
}) {
  const ar = language === 'ar'
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<'add' | 'library'>('add')
  const [items, setItems] = useState<NajdAsset[]>([])
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const [merged, setMerged] = useState(false)
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<Set<string> | null>(null)
  const [preview, setPreview] = useState<{ id: string; text: string; hasMore: boolean } | null>(null)
  const container = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const close = (event: PointerEvent) => { if (event.target instanceof Node && !container.current?.contains(event.target)) setOpen(false) }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [])
  async function refresh() {
    setFailed(false)
    try { setItems(await window.najdLibrary!.list()) } catch { setFailed(true) }
  }
  async function runSearch(value: string) {
    setQuery(value)
    if (!value.trim()) { setHits(null); return }
    try { setHits(new Set((await window.najdLibrary!.search(value.trim())).map(hit => hit.id))) } catch { setHits(new Set()) }
  }
  async function remove(item: NajdAsset) {
    if (!window.confirm((ar ? 'حذف من المكتبة: ' : 'Remove from library: ') + item.name + '?')) return
    try { await window.najdLibrary!.remove(item.id); onChange(selected.filter(asset => asset.id !== item.id)); if (preview?.id === item.id) setPreview(null); await refresh() } catch { setFailed(true) }
  }
  async function show(item: NajdAsset) {
    if (preview?.id === item.id) { setPreview(null); return }
    try { setPreview({ id: item.id, ...(await window.najdLibrary!.preview(item.id)) }) } catch { setFailed(true) }
  }
  const visible = hits ? items.filter(item => hits.has(item.id) || item.name.toLowerCase().includes(query.trim().toLowerCase())) : items
  return <div className="attachment-picker" ref={container} onKeyDown={event => { if (event.key === 'Escape') { setOpen(false); container.current?.querySelector('button')?.focus() } }}>
    <button type="button" className="attach-button" disabled={disabled || !window.najdLibrary || loading}
      aria-label={ar ? 'المرفقات والمكتبة' : 'Attachments and library'} aria-expanded={open}
      onClick={() => { setOpen(!open); if (!open) { setView('add'); void refresh() } }}><Plus size={18} /></button>
    {open && <section className="attachment-popover" dir={ar ? 'rtl' : 'ltr'} aria-label={ar ? 'المكتبة' : 'Library'}>
      {view === 'library' && <button type="button" className="library-back add-menu-item" onClick={() => setView('add')}><ArrowLeft size={15} />{ar ? 'رجوع' : 'Back'}</button>}
      <button type="button" className="model-refresh" disabled={disabled || loading || selected.length >= 20} onClick={async () => {
        setLoading(true); onBusyChange(true); setFailed(false)
        try {
          const imported = await window.najdLibrary!.import()
          // Files with identical content are one library item, so they attach once (the library deduplicates by content).
          setMerged(new Set(imported.map(item => item.id)).size < imported.length)
          onChange([...new Map([...selected, ...imported].map(item => [item.id, item])).values()].slice(0, 20))
          await refresh()
        } catch { setFailed(true) } finally { setLoading(false); onBusyChange(false) }
      }}><Paperclip size={17} /><span className="add-menu-text"><strong>{loading ? (ar ? 'جاري تجهيز الملفات…' : 'Preparing files…') : (ar ? 'إرفاق ملفات وصور ومقاطع' : 'Attach files, photos and videos')}</strong>
        <small>{ar ? 'مستندات، جداول، عروض، PDF، صور، فيديو، كود ونصوص' : 'Documents, sheets, slides, PDF, images, video, code and text'}</small></span></button>
      {view === 'add' && <>
        <button type="button" className="library-open add-menu-item" disabled={disabled || loading} onClick={() => setView('library')}><Library size={17} /><span className="add-menu-text"><strong>{ar ? 'من المكتبة' : 'From library'}</strong><small>{ar ? 'ملفات أرفقتها أو أنشأها نجد' : 'Files you attached or NAJD created'}</small></span><b className="add-menu-count">{items.length}</b></button>
        {onManageTools && <button type="button" className="add-menu-item" disabled={disabled || loading} onClick={() => { setOpen(false); onManageTools() }}><Wrench size={17} /><span className="add-menu-text"><strong>{ar ? 'الأدوات والمهارات' : 'Tools and skills'}</strong><small>{ar ? 'المهارات والإضافات والاتصالات' : 'Skills, plugins and connections'}</small></span></button>}
      </>}
      <p className="add-menu-note">{ar ? 'حتى 20 ملف، وحتى 25 ميجابايت للملف. تُحفظ على جهازك، ويُرسل لمزوّدك المختار ما يحتاجه سؤالك فقط.' : 'Up to 20 files, 25 MB each. Kept on this computer; only what your question needs goes to your selected provider.'}</p>
      {merged && <p role="status">{ar ? 'بعض الملفات التي اخترتها متطابقة المحتوى، فأُرفقت مرة واحدة.' : 'Some chosen files have identical content, so they were attached once.'}</p>}
      {failed && <p role="alert">{ar ? 'تعذّر تجهيز أحد الملفات. نجد يقرأ المستندات والجداول والعروض وPDF والصور والفيديو والكود والنصوص حتى 25 ميجابايت، ولا يقرأ الملفات المحمية أو التالفة.' : 'Could not prepare a file. NAJD reads documents, sheets, slides, PDF, images, video, code and text up to 25 MB; protected or damaged files cannot be read.'}</p>}
      {view === 'library' && <label className="library-search"><Search size={14} /><input type="search" value={query} placeholder={ar ? 'ابحث في الأسماء والمحتوى' : 'Search names and content'} onChange={event => { void runSearch(event.target.value) }} /></label>}
      {view === 'library' && <div className="library-items">{!items.length && <p>{ar ? 'مكتبتك فارغة. كل ملف ترفقه يُحفظ هنا لتعود إليه متى شئت.' : 'Your library is empty. Every file you attach is kept here for whenever you need it again.'}</p>}{items.length > 0 && !visible.length && <p>{ar ? 'لا توجد نتائج مطابقة.' : 'No matches.'}</p>}{visible.map(item => <div className="library-row" key={item.id}><label>
        <input type="checkbox" checked={selected.some(asset => asset.id === item.id)} disabled={disabled || loading || selected.length >= 20 && !selected.some(asset => asset.id === item.id)}
          onChange={event => onChange(event.target.checked ? [...selected, item] : selected.filter(asset => asset.id !== item.id))} />
        <span dir="auto">{item.name}</span><small>{item.origin === 'artifact' ? (ar ? 'مُولَّد' : 'Generated') : item.kind.toUpperCase()}</small>
      </label>
        <button type="button" aria-label={ar ? 'معاينة' : 'Preview'} onClick={() => { void show(item) }}><Eye size={14} /></button>
        {window.najdLibrary?.open && OPENABLE.test(item.name) && <button type="button" aria-label={ar ? 'فتح' : 'Open'} title={ar ? 'فتح بالبرنامج الافتراضي' : 'Open with its default program'} onClick={() => { void window.najdLibrary!.open!(item.id).catch(() => setFailed(true)) }}><ExternalLink size={14} /></button>}
        {item.origin === 'artifact' && <button type="button" aria-label={ar ? 'إظهار في المجلد' : 'Show in folder'} onClick={() => { void window.najdLibrary!.reveal(item.id).catch(() => setFailed(true)) }}><FolderOpen size={14} /></button>}
        <button type="button" aria-label={ar ? 'حذف' : 'Remove'} disabled={disabled || loading} onClick={() => { void remove(item) }}><Trash2 size={14} /></button>
        {preview?.id === item.id && <pre className="library-preview" dir="auto">{preview.text}{preview.hasMore ? ' …' : ''}</pre>}
      </div>)}</div>}
    </section>}
  </div>
}
