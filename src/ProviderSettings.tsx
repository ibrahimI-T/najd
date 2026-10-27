import { useEffect, useState } from 'react'
import { KeyRound } from 'lucide-react'
import type { Copy } from './copy'
import type { ProviderControls } from './useProviders'
import { ProviderMenu } from './ProviderMenu'
import { ChatGPTSettings } from './ChatGPTSettings'
import { CardHeading } from './ui'
import { UnionSettings } from './UnionSettings'

export function providerBadge(p: NajdProvider, t: Copy) {
  return p.verified ? t.connectedBadge : p.errorCode ? t.providerFailed : p.configured && p.auth !== 'local' ? t.savedBadge : p.auth === 'local' ? 'Ollama' : t.disconnectedBadge
}

export function ProviderSettings({ t, controls: c, busy, initial }: { t: Copy; controls: ProviderControls; busy: boolean; initial: NajdProviderId }) {
  const [selection, setSelection] = useState(initial)
  const p = c.catalog.find(p => p.id === selection)
  const locked = busy || c.connectionBusy
  useEffect(() => {
    if (p?.configured && !c.models[selection] && !c.loading[selection]) void c.loadModels(selection)
  }, [p?.configured, c.models, c.loading, c.loadModels, selection])
  if (!window.najdProviders) return <p className="model-note">{t.localModelDesktopOnly}</p>
  return <div className="model-panel provider-settings">
    <div className="model-card setup-guide"><h3>{t.setupTitle}</h3><ol><li>{t.setupChoose}</li><li>{t.setupConfigure}</li><li>{t.setupTest}</li></ol><p className="model-note">{t.setupCosts}</p><p className="model-note">{t.modelFileHelp}</p></div>
    {(['subscription', 'api', 'local'] as const).map(kind => <div className="provider-group" data-group={kind} key={kind}>
      <ProviderMenu label={kind === 'subscription' ? t.linkSubscription : kind === 'api' ? t.connectAPI : t.localProviders}
        selected={selection} disabled={locked} onSelect={id => setSelection(id as NajdProviderId)}
        options={c.catalog.filter(p => p.kind === kind).map(p => ({ id: p.id, label: p.name, badge: providerBadge(p, t), verified: p.verified }))} />
      {kind === 'local' && <LocalDetector t={t} locked={locked} onPick={id => setSelection(id)} />}
      {p?.kind === kind && <>
        <p className="connection-receipt"><span dir="ltr">{p.name}</span><small className={'provider-badge' + (p.verified ? ' verified' : '')}>{providerBadge(p, t)}</small></p>
        {p.auth === 'browser' ? <ChatGPTSettings t={t} modelName={c.choices.chatgpt || ''} active={c.provider === 'chatgpt'} busy={locked}
          onModelChange={model => c.chooseModel('chatgpt', model)} onActivate={() => { c.setProvider('chatgpt'); void c.loadModels('chatgpt') }}
          onWorking={c.setConnectionBusy} onStatusRefresh={c.refresh} /> : <KeyProviderPanel key={p.id} p={p} c={c} t={t} busy={busy} />}
      </>}
    </div>)}
    <UnionSettings t={t} c={c} busy={locked} />
    <p className="model-note">{t.credentialProofNote}</p><p className="model-note">{t.unsupportedPlans}</p>
  </div>
}

function LocalDetector({ t, locked, onPick }: { t: Copy; locked: boolean; onPick: (id: string) => void }) {
  const [state, setState] = useState<'idle' | 'looking' | 'done'>('idle')
  const [found, setFound] = useState<{ id: string; name: string; endpoint: string }[]>([])
  async function detect() {
    if (locked || state === 'looking') return
    setState('looking')
    try { setFound(await window.najdProviders!.detectLocal()) } catch { setFound([]) }
    setState('done')
  }
  return <div className="local-detector">
    <button type="button" className="model-refresh" data-action="detect-local" disabled={locked || state === 'looking'} onClick={() => { void detect() }}>{state === 'looking' ? t.detectLooking : t.detectLocal}</button>
    {state === 'done' && (found.length ? <p className="model-note" role="status">{t.detectFound} {found.map(item => <button type="button" key={item.id} className="browser-action" data-detected={item.id} onClick={() => onPick(item.id)}>{item.name}</button>)}</p>
      : <p className="model-note" role="status">{t.detectNone}</p>)}
  </div>
}

function KeyProviderPanel({ p, c, t, busy }: { p: NajdProvider; c: ProviderControls; t: Copy; busy: boolean }) {
  const [key, setKey] = useState('')
  const [endpoint, setEndpointText] = useState(p.endpoint || '')
  const [endpointState, setEndpointState] = useState<'saved' | 'invalid' | null>(null)
  const [error, setError] = useState(false)
  const [tested, setTested] = useState(false)
  const locked = busy || c.connectionBusy
  const model = c.choices[p.id] || ''
  useEffect(() => { setTested(false) }, [model])
  async function saveEndpoint(value: string) {
    if (locked) return
    c.setConnectionBusy(true); setEndpointState(null)
    try {
      const result = await window.najdProviders!.setEndpoint(p.id, value)
      setEndpointText(result.endpoint); setEndpointState('saved'); await c.refresh(); void c.loadModels(p.id)
    } catch { setEndpointState('invalid') } finally { c.setConnectionBusy(false) }
  }
  async function run(operation: () => Promise<unknown>) {
    if (locked) return
    c.setConnectionBusy(true); setError(false); setTested(false)
    try { await operation(); await c.refresh() }
    catch { setError(true) }
    finally { setKey(''); c.setConnectionBusy(false) }
  }
  return <div className="model-card key-provider-card" data-provider={p.id}>
    <CardHeading icon={KeyRound} title={p.name} size={20} className="model-card-heading"
      hint={p.auth === 'local' ? t.localModelExplain : p.kind === 'subscription' ? t.subscriptionKeyNote : t.apiBillingNote} />
    {p.editableUrl && <>
      <label className="model-choice"><span>{t.endpointLabel}</span><input dir="ltr" value={endpoint} spellCheck={false} autoComplete="off" data-endpoint={p.id} placeholder={p.defaultEndpoint || 'https://…/v1'}
        disabled={locked} onChange={e => { setEndpointText(e.target.value); setEndpointState(null) }} /></label>
      <small className="model-note">{t.endpointHint}</small>
      <div className="model-actions">
        <button type="button" className="model-refresh" data-action="save-endpoint" disabled={locked || !endpoint.trim()} onClick={() => { void saveEndpoint(endpoint.trim()) }}>{t.endpointSave}</button>
        {p.defaultEndpoint && p.endpoint !== p.defaultEndpoint && <button type="button" className="model-refresh" disabled={locked} onClick={() => { void saveEndpoint('') }}>{t.endpointReset}</button>}
      </div>
      {endpointState === 'saved' && <p className="model-note" role="status">{t.endpointSaved}</p>}
      {endpointState === 'invalid' && <p className="model-error" role="alert">{t.endpointInvalid}</p>}
    </>}
    {p.auth === 'optional-key' && <p className="model-note">{t.optionalKeyNote}</p>}
    {(p.auth === 'key' || p.auth === 'optional-key') && <>
      <label className="model-choice"><span>{t.providerKey}</span><input type="password" value={key} autoComplete="off" spellCheck={false}
        aria-label={`${p.name} · ${t.providerKey}`} placeholder={p.keyHint} disabled={locked} onChange={e => setKey(e.target.value)} /></label>
      <div className="model-actions">
        <button type="button" data-action="save" className="model-refresh" disabled={locked || !key.trim()}
          onClick={() => { void run(async () => { await window.najdProviders!.saveKey(p.id, key.trim()); await c.refresh(); await c.loadModels(p.id) }) }}>{t.saveProviderKey}</button>
        {(p.auth === 'optional-key' ? p.keySaved : p.configured) && <button type="button" className="model-refresh" disabled={locked} onClick={() => { void run(() => window.najdProviders!.clearKey(p.id)) }}>{t.removeProviderKey}</button>}
        {p.kind === 'subscription' && <button type="button" className="model-refresh" disabled={locked} onClick={() => { void run(() => window.najdProviders!.openConsole(p.id)) }}>{t.providerConsole}</button>}
      </div>
    </>}
    {p.configured && <>
      <label className="model-choice"><span>{c.loading[p.id] ? t.localModelLoading : t.localModelChoose}</span>
        <select value={model} disabled={locked || c.loading[p.id]} aria-label={`${p.name} · ${t.localModelChoose}`} onChange={e => c.chooseModel(p.id, e.target.value)}>
          <option value="">{t.localModelChoosePlaceholder}</option>{(c.models[p.id] || []).map(m => <option value={m.id} key={m.id}>{m.label}</option>)}
        </select></label>
      <div className="model-actions">
        <button type="button" className="model-refresh" disabled={locked || c.loading[p.id]} onClick={() => { void c.loadModels(p.id) }}>{t.localModelRefresh}</button>
        <button type="button" data-action="activate" className="model-refresh" disabled={locked || !model} aria-pressed={c.provider === p.id} onClick={() => c.setProvider(p.id)}>{c.provider === p.id ? t.activeSelection : t.useProvider}</button>
        <button type="button" data-action="test" className="model-refresh" disabled={locked || !model} onClick={() => { void run(async () => { await window.najdProviders!.testModel(p.id, model); setTested(true) }) }}>{c.connectionBusy ? t.connectionTesting : t.testConnection}</button>
      </div>
      {c.errors[p.id] ? <p className="model-error" role="alert">{t.providerLoadError}</p> : !c.loading[p.id] && !c.models[p.id]?.length ? <p className="model-note">{t.providerEmpty}</p> : null}
    </>}
    {tested && <p className="model-note" role="status">{t.connectionPassed}</p>}
    {error && <p className="model-error" role="alert">{t.connectionFailed}</p>}
  </div>
}
