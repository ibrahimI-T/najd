import { useState } from 'react'
import type { getCopy } from './copy'

export function LegalNotices({ t }: { t: ReturnType<typeof getCopy> }) {
  const [info, setInfo] = useState<{ version: string; text: string } | null>(null)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  async function show() {
    if (info) { setOpen(value => !value); return }
    setBusy(true); setError(false)
    try {
      if (!window.najdAbout) throw new Error('Desktop only')
      setInfo(await window.najdAbout.notices()); setOpen(true)
    } catch { setError(true) }
    finally { setBusy(false) }
  }
  return <section className="legal-card" aria-label={t.legalTitle}>
    <h3>{t.legalTitle}</h3><p>{t.legalDescription}</p>
    <button type="button" className="browser-action legal-toggle" disabled={busy} aria-expanded={open} onClick={() => { void show() }}>{open ? t.legalHide : t.legalShow}</button>
    {error && <p role="alert">{t.legalError}</p>}
    {open && info && <><p>{t.legalVersion}: {info.version}</p><pre tabIndex={0} dir="ltr" aria-label={t.legalTitle}>{info.text}</pre></>}
  </section>
}
