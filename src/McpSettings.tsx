import { useEffect, useRef, useState } from 'react'
import { Plug, ShieldCheck } from 'lucide-react'
import type { Copy } from './copy'
import { CardHeading, InfoNote, StatusPill } from './ui'
import { McpServers } from './McpServers'
import { visibleInterval } from './useVisibleInterval'

export function McpSettings({ t, busy }: { t: Copy; busy: boolean }) {
  const [items, setItems] = useState<NajdConnector[] | null>(null)
  const [error, setError] = useState(false), [working, setWorking] = useState(false)
  const lock = useRef(false)
  const c = t.capabilities
  useEffect(() => {
    let alive = true
    async function refresh() {
      try { const value = await window.najdMcp?.list(); if (alive && value) setItems(value) }
      catch { if (alive) setError(true) }
    }
    void refresh()
    const stopPolling = visibleInterval(() => { if (!lock.current) void refresh() }, 2000)
    return () => { alive = false; stopPolling() }
  }, [])
  async function run(operation: 'connect' | 'disconnect' | 'list') {
    if (!window.najdMcp || lock.current || busy) return
    lock.current = true; setWorking(true); setError(false)
    try {
      if (operation !== 'list') await window.najdMcp[operation]('najd-windows-native')
      setItems(await window.najdMcp.list())
    } catch { setError(true) }
    finally { lock.current = false; setWorking(false) }
  }
  if (!window.najdMcp) return <p className="model-note">{c.desktop}</p>
  return <div className="browser-panel mcp-panel" aria-busy={working}>
    <InfoNote icon={ShieldCheck} title={c.mcpTitle}><p>{c.mcpHelp}</p></InfoNote>
    {error && <p role="alert" className="browser-error">{c.error}</p>}
    {!items && !error && <p role="status">{c.loading}</p>}
    <button className="browser-action" type="button" disabled={working || busy} data-mcp-action="refresh" onClick={() => { void run('list') }}>{items ? c.refresh : c.retry}</button>
    {items?.map(item => <div className="browser-card" key={item.id} data-mcp={item.id}>
      <CardHeading icon={Plug} title={c.mcpTitle} hint={item.source} />
      <div className="browser-actions"><StatusPill ready={item.state === 'connected'}><span data-mcp-state={item.state} role="status">{c.states[item.state]}</span></StatusPill>
        <button className="browser-action" type="button" data-mcp-action={item.state === 'connected' ? 'disconnect' : 'connect'}
          disabled={working || busy || item.state === 'connecting' || item.state === 'disconnecting'}
          onClick={() => { void run(item.state === 'connected' ? 'disconnect' : 'connect') }}>{item.state === 'connected' ? c.disconnect : c.connect}</button></div>
      <details className="capability-details"><summary>{c.details}</summary><code dir="ltr">{item.sourceRevision}</code><p><bdi>{item.transport}</bdi></p>
        {item.protocolVersion && <p>{c.protocol}: <bdi>{item.protocolVersion}</bdi></p>}
        {item.tools.length > 0 && <><h4>{c.tools}</h4><ul>{item.tools.map(tool => <li key={tool}><bdi>{tool}</bdi></li>)}</ul></>}
      </details>
    </div>)}
    <McpServers t={t} busy={busy} />
  </div>
}
