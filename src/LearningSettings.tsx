import { useEffect, useRef, useState } from 'react'
import { Brain } from 'lucide-react'
import type { Copy } from './copy'
import { CardHeading } from './ui'
import { visibleInterval } from './useVisibleInterval'

export function LearningSettings({ t, busy, onUse }: { t: Copy; busy: boolean; onUse: (text: string) => void }) {
  const [data, setData] = useState<NajdLearningState | null>(null)
  const [working, setWorking] = useState(false), [error, setError] = useState(false), [saved, setSaved] = useState(false)
  const [editing, setEditing] = useState<{ kind: NajdLearningKind; id: string; title: string; text: string } | null>(null)
  const lock = useRef(false), alive = useRef(false)
  const c = t.learning, locked = busy || working
  useEffect(() => {
    alive.current = true
    async function refresh() {
      try { const value = await window.najdLearning?.list(); if (alive.current && value) setData(value) }
      catch { if (alive.current) setError(true) }
    }
    void refresh()
    const stopPolling = visibleInterval(() => { if (!lock.current) void refresh() }, 1500)
    return () => { alive.current = false; stopPolling() }
  }, [])
  async function run(operation: () => Promise<unknown>) {
    if (lock.current || busy || !window.najdLearning) return
    lock.current = true; setWorking(true); setError(false); setSaved(false)
    try {
      const result = await operation(), value = await window.najdLearning.list()
      const cancelled = result !== null && typeof result === 'object' && (('saved' in result && result.saved === false) || ('imported' in result && result.imported === false))
      if (alive.current) { setData(value); setSaved(!cancelled) }
    } catch { if (alive.current) setError(true) }
    finally { lock.current = false; if (alive.current) setWorking(false) }
  }
  if (!window.najdLearning) return null
  return <div className="browser-card learning-panel" aria-busy={working}>
    <CardHeading icon={Brain} title={c.title} hint={c.description} />
    {error && <p className="browser-error" role="alert">{t.memoryNotes.error}</p>}
    {saved && <p role="status">{c.saved}</p>}
    {!data && !error && <p>{t.capabilities.loading}</p>}
    {data && <>
      <div className="capability-form learning-policy"><label>{c.mode}<select data-learning="mode" value={data.settings.mode} disabled={locked}
        onChange={event => { const mode = event.target.value as NajdLearningSettings['mode']; void run(() => window.najdLearning!.setSettings({ ...data.settings, mode })) }}>
        <option value="off">{c.off}</option><option value="review">{c.review}</option><option value="preferences">{c.preferences}</option>
      </select></label>
        <label className="personality-enable"><input type="checkbox" data-learning="share" checked={data.settings.sharePreferences} disabled={locked}
          onChange={event => { const sharePreferences = event.target.checked; void run(() => window.najdLearning!.setSettings({ ...data.settings, sharePreferences })) }} />{c.share}</label>
        <label className="personality-enable"><input type="checkbox" data-learning="share-experiences" checked={data.settings.shareExperiences} disabled={locked}
          onChange={event => { const shareExperiences = event.target.checked; void run(() => window.najdLearning!.setSettings({ ...data.settings, shareExperiences })) }} />{c.shareExperiences}</label>
      </div><p className="browser-note">{c.shareHint}</p><p className="browser-note">{c.warning}</p>
      <p role="status" data-learning-state={data.state}>{c[data.state]}</p>
      {editing && <form className="capability-form memory-editor" onSubmit={event => { event.preventDefault(); const current = editing; void run(async () => {
        await window.najdLearning!.edit(current.kind, { id: current.id, title: current.title, text: current.text }); setEditing(null)
      }) }}>
        <label>{t.memoryNotes.noteTitle}<input data-learning="edit-title" value={editing.title} required maxLength={80} disabled={locked} onChange={event => setEditing({ ...editing, title: event.target.value })} /></label>
        <label>{t.memoryNotes.text}<textarea data-learning="edit-text" value={editing.text} required maxLength={2000} rows={4} disabled={locked} onChange={event => setEditing({ ...editing, text: event.target.value })} /></label>
        <div className="browser-actions"><button className="browser-action" data-learning="save-edit" disabled={locked}>{t.memoryNotes.save}</button>
          <button className="browser-action" type="button" disabled={locked} onClick={() => setEditing(null)}>{t.memoryNotes.cancel}</button></div>
      </form>}
      {(['preference', 'experience'] as const).map(kind => <div className="learning-group" key={kind} data-learning-kind={kind}>
        <h4>{c[kind]}</h4><div className="browser-actions"><button className="browser-action" data-learning="export" disabled={locked} onClick={() => { void run(() => window.najdLearning!.export(kind)) }}>{t.memoryNotes.export}</button>
          <button className="browser-action" data-learning="import" disabled={locked} onClick={() => { void run(() => window.najdLearning!.import(kind)) }}>{t.memoryNotes.import}</button></div>
        {(['pending', 'approved'] as const).map(status => <div key={status} data-learning-status={status}>
          <h5>{c[status]}</h5>{data[status][kind].length === 0 && <p>{c.empty}</p>}
          {data[status][kind].map(note => <div className="browser-tab learning-note" key={note.id} data-learning-id={note.id}>
            <strong dir="auto">{note.title}</strong><p dir="auto">{note.text}</p>
            <div className="browser-actions">{status === 'pending' ? <>
              <button className="browser-action" data-learning="accept" disabled={locked} onClick={() => { void run(() => window.najdLearning!.accept(kind, note.id)) }}>{c.accept}</button>
              <button className="browser-action" data-learning="reject" disabled={locked} onClick={() => { void run(() => window.najdLearning!.reject(kind, note.id)) }}>{c.reject}</button>
            </> : <>
              <button className="browser-action" data-learning="edit" disabled={locked} onClick={() => setEditing({ kind, ...note })}>{t.memoryNotes.edit}</button>
              <button className="browser-action" data-learning="use" disabled={locked} onClick={() => onUse(note.text)}>{t.memoryNotes.use}</button>
              <button className="browser-action" data-learning="remove" disabled={locked} onClick={() => { if (window.confirm(t.memoryNotes.deleteConfirm)) void run(() => window.najdLearning!.remove(kind, note.id)) }}>{t.memoryNotes.remove}</button>
            </>}</div>
          </div>)}
        </div>)}
      </div>)}
    </>}
  </div>
}
