import { useEffect, useRef, useState } from 'react'
import type { Copy } from './copy'
import { visibleInterval } from './useVisibleInterval'

export function GatewaySettings({ t }: { t: Copy }) {
  const [status, setStatus] = useState<NajdGatewayStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  const mounted = useRef(true)
  const operation = useRef(0)
  useEffect(() => {
    mounted.current = true
    const bridge = window.najdGateway
    if (!bridge) return
    let disposed = false, pending = false
    const refresh = async () => {
      if (pending) return
      pending = true
      try { const result = await bridge.status(); if (!disposed) setStatus(result) }
      catch { if (!disposed) setError(true) }
      finally { pending = false }
    }
    void refresh()
    const stopPolling = visibleInterval(() => { void refresh() }, 1500)
    return () => { disposed = true; mounted.current = false; stopPolling() }
  }, [])
  async function control(action: 'start' | 'stop') {
    const bridge = window.najdGateway
    if (!bridge) return
    const request = ++operation.current
    setBusy(true); setError(false)
    try {
      const result = await bridge[action]()
      if (mounted.current && request === operation.current) setStatus(result)
    } catch {
      if (mounted.current && request === operation.current) {
        setError(true)
        try { const result = await bridge.status(); if (mounted.current && request === operation.current) setStatus(result) }
        catch { if (mounted.current && request === operation.current) setStatus(null) }
      }
    } finally { if (mounted.current && request === operation.current) setBusy(false) }
  }
  const transitioning = status && ['preparing', 'starting', 'stopping'].includes(status.state)
  return <div className="browser-panel"><div className="browser-card">
    <h3>{t.gatewayTitle}</h3><p className="browser-note">{t.gatewayDesc}</p>
    {!window.najdGateway ? <p className="browser-note">{t.gatewayDesktopOnly}</p> : <>
      <p className="gateway-status" role="status" aria-live="polite">
        <span className={'status-pill ' + (status?.state === 'healthy' ? 'ready' : '')}>
          {status ? t.gatewayStates[status.state] : error ? t.gatewayStates.failed : t.gatewayStates.preparing}
        </span>
      </p>
      <div className="browser-actions">
        <button type="button" className="browser-action" disabled={busy || !!transitioning || status?.state === 'healthy'} onClick={() => { void control('start') }}>{t.gatewayRetry}</button>
        <button type="button" className="browser-action" disabled={status?.state === 'stopping' || status?.state === 'stopped' || status?.state === 'not_installed'} onClick={() => { void control('stop') }}>{t.gatewayStop}</button>
      </div>
      {(error || status?.state === 'failed' || status?.state === 'degraded') && <p className="browser-error" role="alert">{t.gatewayError}</p>}
    </>}
  </div></div>
}
