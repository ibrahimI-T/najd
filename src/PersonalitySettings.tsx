import { useEffect, useRef, useState } from 'react'
import { Brain } from 'lucide-react'
import type { Copy } from './copy'
import { CardHeading } from './ui'

export function PersonalitySettings({ t, busy }: { t: Copy; busy: boolean }) {
  const [profile, setProfile] = useState<NajdPersonality | null>(null)
  const [working, setWorking] = useState(false), [error, setError] = useState(false), [saved, setSaved] = useState(false)
  const lock = useRef(false), alive = useRef(false)
  const c = t.personality
  useEffect(() => {
    alive.current = true
    void window.najdPersonality?.get().then(value => { if (alive.current) setProfile(value) }).catch(() => { if (alive.current) setError(true) })
    return () => { alive.current = false }
  }, [])
  async function save(event: React.FormEvent) {
    event.preventDefault()
    if (lock.current || busy || !profile || !window.najdPersonality) return
    lock.current = true; setWorking(true); setError(false); setSaved(false)
    try {
      const value = await window.najdPersonality.save(profile)
      if (alive.current) { setProfile(value); setSaved(true) }
    } catch { if (alive.current) setError(true) }
    finally { lock.current = false; if (alive.current) setWorking(false) }
  }
  async function restore() {
    if (lock.current || busy || !window.najdPersonality || !window.confirm(c.restoreConfirm)) return
    lock.current = true; setWorking(true); setError(false); setSaved(false)
    try { const value = await window.najdPersonality.reset(); if (alive.current) { setProfile(value); setSaved(true) } }
    catch { if (alive.current) setError(true) }
    finally { lock.current = false; if (alive.current) setWorking(false) }
  }
  if (!window.najdPersonality) return null
  return <div className="browser-card personality-card" aria-busy={working}>
    <CardHeading icon={Brain} title={c.title} hint={c.hint} /><p className="browser-note">{c.disclosure}</p>
    {error && <p className="browser-error" role="alert">{c.error}</p>}{saved && <p role="status">{c.saved}</p>}
    {!profile && !error && <p role="status">{t.capabilities.loading}</p>}
    {profile && <form className="capability-form personality-editor" onSubmit={save}>
      <label className="personality-enable"><input type="checkbox" data-personality="enabled" disabled={busy || working} checked={profile.enabled} onChange={event => { setProfile({ ...profile, enabled: event.target.checked }); setSaved(false) }} />{c.enabled}</label>
      <label>{c.name}<input data-personality="name" required maxLength={40} disabled={busy || working} value={profile.name} onChange={event => { setProfile({ ...profile, name: event.target.value }); setSaved(false) }} /></label>
      <label>{c.instructions}<textarea data-personality="instructions" rows={14} required maxLength={12000} dir="auto" disabled={busy || working} value={profile.instructions} onChange={event => { setProfile({ ...profile, instructions: event.target.value }); setSaved(false) }} /></label>
      <div className="browser-actions">
        <button className="browser-action" data-personality="save" disabled={busy || working || !profile.name.trim() || !profile.instructions.trim()}>{c.save}</button>
        <button type="button" className="browser-action" data-personality="restore" disabled={busy || working} onClick={() => { void restore() }}>{c.restore}</button>
      </div>
    </form>}
  </div>
}
