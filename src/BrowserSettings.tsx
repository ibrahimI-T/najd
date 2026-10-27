import { useEffect, useState } from 'react'
import { Globe2, Link2, ShieldCheck, Unlink } from 'lucide-react'
import type { Copy } from './copy'
import { CardHeading, InfoNote, StatusPill } from './ui'
import { visibleInterval } from './useVisibleInterval'

const COPY = {
  ar: {
    linked: 'المتصفحات المربوطة', none: 'لا يوجد متصفح مربوط بعد.', connected: 'متصل', offline: 'غير متصل الآن', lastSeen: 'آخر ظهور', unlink: 'فصل', unlinkLabel: 'فصل المتصفح ',
    connectTitle: 'ربط متصفح', steps: ['ثبّت إضافة «NAJD AGENT» من متجر Chrome أو متجر إضافات Edge.', 'افتح الإضافة واضغط «اتصال». تجد نجد تلقائيًا على هذا الجهاز.', 'تظهر هنا نافذة فيها رمز من 6 أرقام. اسمح فقط إذا طابق الرمز المعروض في الإضافة.'],
    manual: 'ربط برمز (بديل)', manualHint: 'إن لم يتصل تلقائيًا، الصق هذا الرمز في الإضافة. يعمل مرة واحدة ثم يتغير.', rotate: 'رمز جديد', developer: 'تثبيت للتطوير (غير مضغوط)',
    developerHint: 'افتح chrome://extensions أو edge://extensions، فعّل وضع المطوّر، اختر «تحميل غير مضغوط» ثم هذا المجلد:'
  },
  en: {
    linked: 'Linked browsers', none: 'No browser linked yet.', connected: 'Connected', offline: 'Not connected now', lastSeen: 'Last seen', unlink: 'Unlink', unlinkLabel: 'Unlink browser ',
    connectTitle: 'Link a browser', steps: ['Install the "NAJD AGENT" extension from the Chrome Web Store or Edge Add-ons.', 'Open the extension and press Connect. It finds NAJD on this computer by itself.', 'A window with a 6-digit code appears here. Allow only if it matches the code shown in the extension.'],
    manual: 'Link with a code (alternative)', manualHint: 'If it does not connect by itself, paste this code into the extension. It works once, then changes.', rotate: 'New code', developer: 'Developer install (unpacked)',
    developerHint: 'Open chrome://extensions or edge://extensions, turn on Developer mode, choose "Load unpacked" and select this folder:'
  }
} as const

// Settings > Browser: the NAJD extension finds the app by itself; the user confirms the link here. Several browsers can be linked.
export function BrowserSettings({ t, language }: { t: Copy; language: 'ar' | 'en' }) {
  const b = t.bridge, c = COPY[language]
  const [status, setStatus] = useState<NajdBrowserStatus | null>(null)
  const [code, setCode] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)
  const api = window.najdBrowser
  useEffect(() => {
    if (!api) return
    let alive = true
    const refresh = async () => { try { const value = await api.status(); if (alive) setStatus(value) } catch {} }
    void refresh()
    const stopPolling = visibleInterval(() => { void refresh() }, 2000)
    return () => { alive = false; stopPolling() }
  }, [api])
  if (!api) return <p className="browser-note">{t.browserDesktopOnly}</p>
  const state = status?.connected ? 'connected' : status?.paired ? 'waiting' : 'notLinked'
  const when = (value: string | null) => value ? new Date(value).toLocaleString(language === 'ar' ? 'ar-SA' : 'en-GB') : '—'
  return <div className="browser-panel" data-browser-state={state}>
    <div className="browser-card">
      <CardHeading icon={Globe2} title={b.title} hint={b.explain} />
      <div className="browser-actions">
        <StatusPill ready={state === 'connected'}><span role="status">{state === 'connected' ? b.connected : state === 'waiting' ? b.waiting : b.notLinked}</span></StatusPill>
        {status?.active && <button type="button" className="browser-action" onClick={() => { void api.openDemo(language) }}>{b.practice}</button>}
      </div>
      {status?.page && <p className="browser-note">{b.current}: <bdi>{status.page.title || status.page.url}</bdi></p>}
      <h4 className="browser-sub">{c.linked}</h4>
      {status?.links?.length ? <ul className="browser-links">{status.links.map(link => <li key={link.id + (link.instance || '')}>
        <span className={'browser-dot ' + (link.connected ? 'on' : '')} aria-hidden="true" />
        <span className="browser-link-main"><strong dir="auto">{link.name || 'NAJD extension'}</strong><small dir="ltr">{link.id.slice(0, 8)}…</small>
          <small>{link.connected ? c.connected : c.offline} · {c.lastSeen}: {when(link.lastSeenAt)}</small></span>
        <button type="button" className="browser-action" disabled={busy} data-bridge-action="unpair" aria-label={c.unlinkLabel + (link.name || link.id.slice(0, 8))}
          onClick={() => { setBusy(true); void api.unpair(link.id, link.instance || undefined).then(value => { setStatus(value) }).finally(() => setBusy(false)) }}><Unlink size={14} aria-hidden="true" />{c.unlink}</button>
      </li>)}</ul> : <p className="browser-note">{c.none}</p>}
    </div>
    <div className="browser-card">
      <CardHeading icon={Link2} title={c.connectTitle} />
      <ol className="bridge-steps">{c.steps.map(step => <li key={step}>{step}</li>)}</ol>
      <details className="browser-more"><summary>{c.manual}</summary>
        <p className="browser-note">{c.manualHint}</p>
        {code ? <div className="browser-code"><span>{b.code}</span>
          <div className="bridge-code-row"><input readOnly dir="ltr" value={code} onFocus={event => event.currentTarget.select()} aria-label={b.code} data-bridge-code />
            <button type="button" className="browser-action" onClick={() => { void navigator.clipboard.writeText(code).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 2000) }) }}>{copied ? b.copied : b.copy}</button>
            <button type="button" className="browser-action" disabled={busy} onClick={() => { setBusy(true); void api.rotateCode().then(setCode).finally(() => setBusy(false)) }}>{c.rotate}</button></div></div>
          : <button type="button" className="browser-action" disabled={busy || !status?.active} data-bridge-action="show-code" onClick={() => { void api.pairingCode().then(setCode) }}>{b.showCode}</button>}
      </details>
      {status?.extensionPath && <details className="browser-more"><summary>{c.developer}</summary>
        <p className="browser-note">{c.developerHint}</p>
        <div className="browser-code"><input readOnly dir="ltr" value={status.extensionPath} onFocus={event => event.currentTarget.select()} aria-label={b.folder} /></div></details>}
    </div>
    <InfoNote icon={ShieldCheck} title={b.title}><p>{b.policy}</p></InfoNote>
  </div>
}
