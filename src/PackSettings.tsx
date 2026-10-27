import { useEffect, useRef, useState } from 'react'
import { Package, ShieldCheck } from 'lucide-react'
import type { Copy } from './copy'
import { CardHeading, InfoNote, StatusPill } from './ui'
import { visibleInterval } from './useVisibleInterval'

// The phase shown while an install runs; an install still waiting on main counts as downloading (M3-I020).
export function installingPhase(status: NajdPackStatus | null, pending: string | null): NajdPackStatus['installing'] {
  return status?.installing || (pending === 'install' ? 'downloading' : undefined)
}

// The Office and design pack (docs/AGENT-PLATFORM-M3-PLAN.md, M3-6). The renderer only asks main to act; main
// decides every path, package and URL.
export function PackSettings({ t, busy }: { t: Copy; busy: boolean }) {
  const p = t.pack
  const [status, setStatus] = useState<NajdPackStatus | null>(null)
  const [working, setWorking] = useState(false), [error, setError] = useState<string | null>(null), [note, setNote] = useState<string | null>(null)
  const lock = useRef(false)
  // The action waiting on main; an install keeps the phase polled and Cancel available from the first moment (M3-I020).
  const [pending, setPending] = useState<string | null>(null)
  const api = window.najdPack
  useEffect(() => {
    let alive = true
    const read = async () => { try { const value = await api?.status(); if (alive && value) setStatus(value) } catch { /* keep the last state */ } }
    void read()
    // While an install runs (or waits on main) its phase is shown; otherwise the state is read now and then.
    const installingNow = !!status?.installing || pending === 'install'
    const stop = visibleInterval(() => { if (!lock.current || installingNow) void read() }, installingNow ? 1000 : 5000)
    return () => { alive = false; stop() }
  }, [api, status?.installing, pending])
  async function run(action: 'install' | 'cancel' | 'check' | 'remove') {
    if (!api || (lock.current && action !== 'cancel')) return
    if (action !== 'cancel') { lock.current = true; setWorking(true); setPending(action) }
    setError(null); setNote(null)
    try {
      const next = await api[action]()
      setStatus(next)
      if (next.lastError && action === 'install') setError(p.errors[next.lastError as keyof typeof p.errors] || p.errors.PACK_INSTALL_FAILED)
      if (action === 'check' && next.state === 'ready') setNote(p.checked)
    } catch (failure) {
      const code = (failure as { message?: string })?.message?.match(/[A-Z_]{4,}/)?.[0] || 'PACK_INSTALL_FAILED'
      setError(p.errors[code as keyof typeof p.errors] || p.errors.PACK_INSTALL_FAILED)
    } finally { if (action !== 'cancel') { lock.current = false; setWorking(false); setPending(null) } }
  }
  if (!api) return null
  const state = status?.state || 'unknown'
  const installing = installingPhase(status, pending)
  const size = status?.sizeBytes ? Math.round(status.sizeBytes / 1024 / 1024) + ' MB' : null
  return <div className="browser-card pack-card" data-pack={state} aria-busy={!!installing || working}>
    <CardHeading icon={Package} title={p.title} hint={size ? `${status?.packages?.length || status?.packageCount} · ${size}` : undefined} />
    <InfoNote icon={ShieldCheck} title={p.title}><p>{p.help}</p>{state !== 'ready' && <p>{p.size}</p>}</InfoNote>
    <div className="browser-actions">
      <StatusPill ready={state === 'ready'}><span role="status" data-pack-state={installing ? 'installing' : state}>{installing ? p.phases[installing] : p.states[state]}</span></StatusPill>
      {installing ? <button className="browser-action" type="button" data-pack-action="cancel" onClick={() => { void run('cancel') }}>{p.cancel}</button> : <>
        {state !== 'ready' && <button className="browser-action" type="button" data-pack-action="install" disabled={working || busy} onClick={() => { void run('install') }}>
          {state === 'not-installed' || state === 'unknown' ? p.install : p.reinstall}</button>}
        {state !== 'not-installed' && state !== 'unknown' && <button className="browser-action" type="button" data-pack-action="check" disabled={working || busy} onClick={() => { void run('check') }}>{p.check}</button>}
        {state !== 'not-installed' && state !== 'unknown' && <button className="browser-action" type="button" data-pack-action="remove" disabled={working || busy} onClick={() => { void run('remove') }}>{p.remove}</button>}
      </>}
    </div>
    {status?.reason && state === 'incompatible' && <p className="model-note">{p.reasons[status.reason]}</p>}
    {error && <p role="alert" className="browser-error">{error}</p>}
    {note && <p role="status" className="model-note">{note}</p>}
    {status?.cleanupPending && <p className="model-note">{p.cleanup}</p>}
    {status?.packages?.length ? <details className="capability-details"><summary>{p.packages}</summary>
      <ul className="pack-list">{status.packages.map(row => <li key={row.name}><bdi dir="ltr">{row.name} {row.version}</bdi><span dir="ltr">{row.license || '—'}</span></li>)}</ul>
      {status.installedAt && <p>{p.installedAt}: <bdi dir="ltr">{new Date(status.installedAt).toLocaleString()}</bdi></p>}
    </details> : null}
  </div>
}
