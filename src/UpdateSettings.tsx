import { useEffect, useRef, useState } from 'react'
import { Download } from 'lucide-react'
import { CardHeading } from './ui'
import type { Copy } from './copy'
import { visibleInterval } from './useVisibleInterval'

export function useUpdates() {
  const [status, setStatus] = useState<NajdUpdateStatus | null>(null)
  useEffect(() => {
    let alive = true
    const refresh = async () => { try { const result = await window.najdUpdates?.status(); if (alive && result) setStatus(result) } catch { /* Quit/install can close IPC. */ } }
    void refresh(); const stopPolling = visibleInterval(() => { void refresh() }, 2000)
    return () => { alive = false; stopPolling() }
  }, [])
  return { status, setStatus }
}
export function DiagnosticsSettings({ t }: { t: Copy }) {
  const [message, setMessage] = useState<'saved' | 'cancelled' | 'failed' | null>(null), [working, setWorking] = useState(false)
  const c = t.diagnostics
  async function save() {
    if (!window.najdDiagnostics || working) return
    setWorking(true); setMessage(null)
    try { setMessage((await window.najdDiagnostics.export()).saved ? 'saved' : 'cancelled') } catch { setMessage('failed') } finally { setWorking(false) }
  }
  return <section className="browser-card" aria-busy={working}>
    <CardHeading icon={Download} title={c.title} hint={c.hint} />
    <div className="browser-actions"><button type="button" className="browser-action" disabled={working} data-diagnostics="save" onClick={() => { void save() }}>{c.save}</button></div>
    {message && <p role={message === 'failed' ? 'alert' : 'status'} className={message === 'failed' ? 'browser-error' : undefined}>{c[message]}</p>}
  </section>
}
export function StabilityNotice({ t }: { t: Copy }) {
  const [info, setInfo] = useState<{ unstable: boolean; attempts: number; previousVersion: string | null; recoveryNote: string | null } | null>(null)
  useEffect(() => { let alive = true; void window.najdUpdates?.stability().then(value => { if (alive) setInfo(value) }).catch(() => {}); return () => { alive = false } }, [])
  if (!info?.unstable) return null
  const c = t.stability
  return <section className="browser-card" role="alert" data-stability="unstable">
    <CardHeading icon={Download} title={c.title} hint={info.previousVersion ? c.bodyWithPrevious : c.body} />
    {info.previousVersion ? <p>{c.previous}: <span dir="ltr">{info.previousVersion}</span>. {c.steps}</p> : <p>{c.noPrevious}</p>}
    <p>{c.diagnose}</p>
    <div className="browser-actions"><button type="button" className="browser-action" onClick={() => { void window.najdUpdates?.openReleases() }}>{c.open}</button></div>
  </section>
}
export function UpdateSettings({ t, status, onChange, busy }: { t: Copy; status: NajdUpdateStatus | null; onChange: (value: NajdUpdateStatus) => void; busy: boolean }) {
  const [working, setWorking] = useState(false), [error, setError] = useState(false)
  const lock = useRef(false), c = t.updates
  async function run(action: 'check' | 'download' | 'cancel' | 'install') {
    if (action === 'cancel' && window.najdUpdates) {
      try { onChange(await window.najdUpdates.cancel()) } catch { setError(true) }
      return
    }
    if (!window.najdUpdates || lock.current || (busy && action === 'install')) return
    lock.current = true; setWorking(true); setError(false)
    try { onChange(await window.najdUpdates[action]()) }
    catch { setError(true) }
    finally { lock.current = false; setWorking(false) }
  }
  const pending = working || status?.state === 'checking' || status?.state === 'installing'
  return <section className="browser-card update-card" aria-busy={working}>
    <CardHeading icon={Download} title={c.title} hint={c.hint} />
    {status && <>
      <p>{c.version}: <span dir="ltr" data-update="current-version">{status.currentVersion}</span> · {c.channel}</p>
      <p role="status" data-update-state={status.state}>{c.states[status.state]}{status.version ? ` (${status.version})` : ''}</p>
      {(error || status.state === 'error') && <p className="browser-error" role="alert">{status.errorCode === 'UPDATE_NOT_PUBLISHED' ? c.notPublished : status.errorCode === 'UPDATE_BUSY' ? c.busy : status.errorCode === 'UPDATE_SIGNATURE_INVALID' || status.errorCode === 'UPDATE_INVALID' ? c.untrusted : c.failed}</p>}
      {status.notes && <p className="update-notes" dir="auto">{status.notes}</p>}
      {status.state === 'downloading' && <div><progress aria-label={c.progress} max={100} value={status.percent} /><span>{Math.floor(status.percent)}%</span></div>}
      <div className="browser-actions">
        {!['disabled', 'downloading', 'ready', 'installing'].includes(status.state) && <button className="browser-action" data-update="check" disabled={pending} onClick={() => { void run('check') }}>{c.check}</button>}
        {status.state === 'manual' && <button className="browser-action" data-update="open-release" onClick={() => { void window.najdUpdates?.openReleases() }}>{c.openRelease}</button>}
        {status.state === 'available' && <button className="browser-action" data-update="download" disabled={pending} onClick={() => { void run('download') }}>{c.download}</button>}
        {status.state === 'downloading' && <button className="browser-action" data-update="cancel" onClick={() => { void run('cancel') }}>{c.cancel}</button>}
        {status.state === 'ready' && <button className="browser-action" data-update="install" disabled={pending || busy} onClick={() => { void run('install') }}>{c.install}</button>}
      </div>
      {busy && status.state === 'ready' && <p className="browser-note">{c.busy}</p>}
      <p className="browser-note">{c.privacy}</p><p className="browser-note">{c.development}</p>
    </>}
  </section>
}
