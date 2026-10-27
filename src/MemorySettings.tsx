import { useEffect, useRef, useState } from 'react'
import { Brain, ShieldCheck } from 'lucide-react'
import type { Copy } from './copy'
import { CardHeading, InfoNote } from './ui'
import { PersonalitySettings } from './PersonalitySettings'
import { LearningSettings } from './LearningSettings'
import { GraphView } from './GraphView'

export function MemorySettings({ t, busy, onUse, language = 'en' }: { t: Copy; busy: boolean; onUse: (text: string) => void; language?: 'ar' | 'en' }) {
  const [notes, setNotes] = useState<NajdMemoryNote[] | null>(null)
  const [id, setId] = useState<string | undefined>(), [title, setTitle] = useState(''), [text, setText] = useState('')
  const [working, setWorking] = useState(false), [error, setError] = useState<'store' | 'conflict' | 'limit' | 'exists' | 'error' | null>(null)
  const [feedback, setFeedback] = useState<'saved' | 'exported' | 'imported' | null>(null)
  const lock = useRef(false), alive = useRef(false), editor = useRef<HTMLInputElement>(null)
  const c = t.memoryNotes, locked = busy || working
  useEffect(() => {
    alive.current = true
    void window.najdMemory?.list().then(value => { if (alive.current) setNotes(value) }).catch(() => { if (alive.current) setError('store') })
    return () => { alive.current = false }
  }, [])
  function clear() { setId(undefined); setTitle(''); setText('') }
  async function perform(work: () => Promise<'saved' | 'exported' | 'imported' | null>) {
    if (lock.current || busy || !window.najdMemory) return
    lock.current = true; setWorking(true); setError(null); setFeedback(null)
    try {
      const result = await work(), value = await window.najdMemory.list()
      if (alive.current) { setNotes(value); setFeedback(result) }
    } catch (reason) {
      const message = String(reason)
      if (alive.current) setError(message.includes('MEMORY_CONFLICT') ? 'conflict' : message.includes('MEMORY_LIMIT') ? 'limit' : message.includes('EXPORT_EXISTS') ? 'exists' : message.includes('MEMORY_STORE_UNAVAILABLE') ? 'store' : 'error')
    } finally { lock.current = false; if (alive.current) setWorking(false) }
  }
  if (!window.najdMemory) return <p className="model-note">{t.capabilities.desktop}</p>
  return <div className="browser-panel memory-panel" aria-busy={working}>
    {window.najdGraph && <GraphView language={language} />}
    <PersonalitySettings t={t} busy={busy || working} />
    <LearningSettings t={t} busy={busy || working} onUse={onUse} />
    <InfoNote icon={ShieldCheck} title={c.title}><p>{c.privacy}</p><p>{c.useHint}</p></InfoNote>
    {error && <p className="browser-error" role="alert">{c[error]}</p>}
    {feedback && <p role="status">{c[feedback]}</p>}
    {!notes && !error && <p role="status">{t.capabilities.loading}</p>}
    <div className="browser-actions memory-actions"><button className="browser-action" disabled={locked} data-memory="refresh" onClick={() => { void perform(async () => null) }}>{t.capabilities.refresh}</button>
      <button className="browser-action" disabled={locked || !notes} data-memory="export" onClick={() => { void perform(async () => (await window.najdMemory!.export()).saved ? 'exported' : null) }}>{c.export}</button>
      <button className="browser-action" disabled={locked || !notes} data-memory="import" onClick={() => { void perform(async () => (await window.najdMemory!.import()).imported ? 'imported' : null) }}>{c.import}</button></div>
    {notes && <>
      <form className="browser-card capability-form memory-editor" onSubmit={event => { event.preventDefault(); void perform(async () => {
        await window.najdMemory!.save({ ...(id ? { id } : {}), title, text }); if (alive.current) clear(); return 'saved'
      }) }}>
        <label>{c.noteTitle}<input ref={editor} value={title} maxLength={80} required disabled={locked} data-memory="title" onChange={event => setTitle(event.target.value)} /></label>
        <label>{c.text}<textarea value={text} maxLength={100000} required disabled={locked} rows={4} data-memory="text" onChange={event => setText(event.target.value)} /></label>
        <div className="browser-actions"><button className="browser-action" disabled={locked || !title.trim() || !text.trim()} data-memory="save">{c.save}</button>
          {id && <button className="browser-action" type="button" disabled={locked} onClick={clear}>{c.cancel}</button>}</div>
      </form>
      {notes.length === 0 && <p>{c.empty}</p>}
      {notes.map(note => <div className="browser-card memory-note" key={note.id} data-memory-id={note.id}>
        <CardHeading icon={Brain} title={note.title} /><p className="memory-text" dir="auto">{note.text}</p>
        <div className="browser-actions"><button className="browser-action" disabled={locked} data-memory="edit" onClick={() => {
          setId(note.id); setTitle(note.title); setText(note.text); editor.current?.focus(); editor.current?.scrollIntoView({ block: 'center' })
        }}>{c.edit}</button><button className="browser-action" disabled={locked} data-memory="use" onClick={() => onUse(note.text)}>{c.use}</button>
          <button className="browser-action" disabled={locked} data-memory="delete" onClick={() => {
            if (window.confirm(c.deleteConfirm)) void perform(async () => { await window.najdMemory!.remove(note.id); if (id === note.id) clear(); return 'saved' })
          }}>{c.remove}</button></div>
      </div>)}
    </>}
  </div>
}
