import { useEffect, useRef, useState } from 'react'
import { BookOpenText, FileText, Image, Library, Trash2, Video } from 'lucide-react'
import { CardHeading, InfoNote } from './ui'

type Language = 'ar' | 'en'
// Knowledge bases (R-057): named collections of documents NAJD searches and cites, such as company policies or the regulations that apply to the user.
// Main picks and imports the files; this page only names bases and asks.
const words = {
  ar: {
    intro: 'أنشئ قاعدة لكل مرجع تعتمد عليه، مثل سياسات شركتك أو اللوائح والمعايير التي تنطبق عليك، وأضف ملفاتها. عندها يبحث نجد فيها عند كل سؤال يخصها، ويجيب منها مع ذكر المصدر، ويطابق مستنداتك معها ويوضح ما يخالفها.',
    howTitle: 'كيف تستخدمها', how: 'اسأل في المحادثة بأي صيغة، مثل: «حسب كود البناء، كم أقل عرض للدرج؟» أو أرفق مخطط بيتك وقل: «طابق المخطط مع كود البناء».',
    name: 'اسم القاعدة', description: 'وصف قصير (اختياري)', create: 'إنشاء القاعدة', add: 'إضافة ملفات', remove: 'حذف القاعدة',
    removeConfirm: 'تحذف هذه القاعدة؟ تبقى ملفاتها في مكتبتك.', removeFile: 'إزالة من القاعدة', empty: 'لا توجد قواعد بعد. ابدأ بإنشاء أول قاعدة.',
    noFiles: 'لا توجد ملفات بعد. أضف ملفات PDF أو Word أو Excel أو نصوص.', documents: (n: number) => `${n} ملف`,
    added: (n: number) => `أُضيف ${n} ملف.`, failed: 'تعذّرت إضافة:', loading: 'جاري التحميل…',
    visual: 'الصور والفيديو تُحفظ في القاعدة، والبحث النصي يشمل المستندات فقط.',
    errors: { NAME_TAKEN: 'يوجد قاعدة بهذا الاسم.', INVALID_NAME: 'اكتب اسمًا للقاعدة (حتى 80 حرفًا).', LIMIT_REACHED: 'وصلت الحد الأعلى للقواعد أو الملفات.', default: 'تعذّرت العملية. حاول مرة أخرى.' } as Record<string, string>
  },
  en: {
    intro: 'Create a base for each reference you rely on, such as your company policies or the regulations and standards that apply to you, and add its files. NAJD then searches it whenever a question concerns it, answers from it with the source named, and checks your documents against it.',
    howTitle: 'How to use it', how: 'Ask in the chat in any words, for example "Under the building code, what is the minimum stair width?", or attach your house plan and say "Check this plan against the building code".',
    name: 'Base name', description: 'Short description (optional)', create: 'Create base', add: 'Add files', remove: 'Delete base',
    removeConfirm: 'Delete this knowledge base? Its files stay in your library.', removeFile: 'Remove from base', empty: 'No knowledge bases yet. Create your first one.',
    noFiles: 'No files yet. Add PDF, Word, Excel or text files.', documents: (n: number) => `${n} files`,
    added: (n: number) => `${n} files added.`, failed: 'Could not add:', loading: 'Loading…',
    visual: 'Images and videos are kept in the base; text search covers documents only.',
    errors: { NAME_TAKEN: 'A base with this name already exists.', INVALID_NAME: 'Enter a name for the base (up to 80 characters).', LIMIT_REACHED: 'The limit for bases or files was reached.', default: 'That did not work. Please try again.' } as Record<string, string>
  }
}

export function KnowledgeBases({ language, busy }: { language: Language; busy: boolean }) {
  const w = words[language]
  const [bases, setBases] = useState<NajdKnowledgeBase[] | null>(null)
  const [name, setName] = useState(''), [description, setDescription] = useState('')
  const [working, setWorking] = useState(false), [error, setError] = useState(''), [status, setStatus] = useState('')
  const alive = useRef(false), lock = useRef(false)
  const api = window.najdKnowledge
  useEffect(() => {
    alive.current = true
    void api?.list().then(value => { if (alive.current) setBases(value) }).catch(() => { if (alive.current) setError(w.errors.default) })
    return () => { alive.current = false }
  }, [])
  async function perform(work: () => Promise<string | void>) {
    if (lock.current || busy || !api) return
    lock.current = true; setWorking(true); setError(''); setStatus('')
    try {
      const note = await work(), value = await api.list()
      if (alive.current) { setBases(value); if (note) setStatus(note) }
    } catch (reason) {
      const code = Object.keys(w.errors).find(key => String(reason).includes(key))
      if (alive.current) setError(w.errors[code || 'default'])
    } finally { lock.current = false; if (alive.current) setWorking(false) }
  }
  if (!api) return null
  const locked = busy || working
  const icon = (kind: string) => kind === 'image' ? Image : kind === 'video' ? Video : FileText
  return <div className="browser-panel knowledge-panel" aria-busy={working}>
    <p className="tools-intro">{w.intro}</p>
    <InfoNote icon={BookOpenText} title={w.howTitle}><p>{w.how}</p></InfoNote>
    {error && <p className="browser-error" role="alert">{error}</p>}
    {status && <p role="status">{status}</p>}
    <form className="browser-card capability-form" data-knowledge="create" onSubmit={event => { event.preventDefault(); void perform(async () => {
      await api.create(name, description); if (alive.current) { setName(''); setDescription('') }
    }) }}>
      <label>{w.name}<input value={name} maxLength={80} required disabled={locked} data-knowledge="name" onChange={event => setName(event.target.value)} /></label>
      <label>{w.description}<input value={description} maxLength={400} disabled={locked} data-knowledge="description" onChange={event => setDescription(event.target.value)} /></label>
      <div className="browser-actions"><button className="browser-action" disabled={locked || !name.trim()} data-knowledge="save">{w.create}</button></div>
    </form>
    {!bases && !error && <p role="status">{w.loading}</p>}
    {bases?.length === 0 && <p>{w.empty}</p>}
    {bases?.map(base => <section className="browser-card knowledge-base" key={base.id} data-knowledge-id={base.id}>
      <CardHeading icon={Library} title={base.name} hint={[base.description, w.documents(base.items.length)].filter(Boolean).join(' · ')} />
      {base.items.length === 0 ? <p className="model-note">{w.noFiles}</p> : <ul className="knowledge-files">
        {base.items.map(item => { const Icon = icon(item.kind); return <li key={item.id}><Icon size={15} /><span dir="auto">{item.name}</span>
          <button type="button" className="knowledge-remove" disabled={locked} aria-label={w.removeFile + ': ' + item.name} title={w.removeFile}
            onClick={() => { void perform(async () => { await api.removeItem(base.id, item.id) }) }}><Trash2 size={14} /></button></li> })}
      </ul>}
      {base.items.some(item => ['image', 'video'].includes(item.kind)) && <p className="model-note">{w.visual}</p>}
      <div className="browser-actions">
        <button className="browser-action" disabled={locked} data-knowledge="add" onClick={() => { void perform(async () => {
          const result = await api.addFiles(base.id)
          if (!result) return
          return [result.added ? w.added(result.added) : '', result.failed.length ? w.failed + ' ' + result.failed.map(row => row.name).join('، ') : ''].filter(Boolean).join(' ')
        }) }}>{w.add}</button>
        <button className="browser-action" disabled={locked} data-knowledge="delete" onClick={() => {
          if (window.confirm(w.removeConfirm)) void perform(async () => { await api.remove(base.id) })
        }}>{w.remove}</button>
      </div>
    </section>)}
  </div>
}
