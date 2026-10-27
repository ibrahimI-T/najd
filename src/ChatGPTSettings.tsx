import { useEffect, useState } from 'react'
import { KeyRound } from 'lucide-react'
import type { Copy } from './copy'
import { CardHeading, InfoNote } from './ui'

const empty: NajdChatGPTStatus = { signingIn: false, activeId: null, signedIn: false, accounts: [], errorCode: null, revocationConfirmed: null }

export function ChatGPTSettings({ t, modelName, active, busy, onModelChange, onActivate, onWorking, onStatusRefresh }: {
  t: Copy; modelName: string; active: boolean; busy: boolean
  onModelChange(model: string): void; onActivate(): void
  onWorking(busy: boolean): void
  onStatusRefresh(): Promise<void>
}) {
  const [status, setStatus] = useState(empty)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState(false)
  const [models, setModels] = useState<{ id: string; label: string }[]>([])
  const [loadingModels, setLoadingModels] = useState(false)
  const [testState, setTestState] = useState<'idle' | 'testing' | 'passed' | 'failed'>('idle')
  const [refresh, setRefresh] = useState(0)
  const [showPlanNote, setShowPlanNote] = useState(false)

  useEffect(() => {
    if (!window.najdChatGPT) return
    let mounted = true
    const read = async () => {
      try { const next = await window.najdChatGPT!.status(); await onStatusRefresh(); if (mounted) setStatus(next) }
      catch { if (mounted) setError(true) }
    }
    void read()
    const timer = status.signingIn ? window.setInterval(() => { void read() }, 1000) : undefined
    return () => { mounted = false; if (timer) window.clearInterval(timer) }
  }, [status.signingIn])

  useEffect(() => {
    setTestState('idle')
    if (!status.signedIn || !window.najdChatGPT) { setModels([]); return }
    if (!localStorage.getItem('najd.chatgpt.plan-explained.v1')) setShowPlanNote(true)
    let mounted = true
    setLoadingModels(true)
    setError(false)
    void window.najdChatGPT.models().then(list => {
      if (!mounted) return
      setModels(list)
      if (modelName && !list.some(m => m.id === modelName)) onModelChange('')
    }).catch(() => { if (mounted) { setError(true); setModels([]) } })
      .finally(() => { if (mounted) setLoadingModels(false) })
    return () => { mounted = false }
  }, [status.activeId, status.signedIn, refresh])

  useEffect(() => { setTestState('idle') }, [modelName])

  async function action(operation: () => Promise<NajdChatGPTStatus>) {
    if (working || busy) return
    setWorking(true)
    onWorking(true)
    setError(false)
    try { const next = await operation(); await onStatusRefresh(); setStatus(next) }
    catch { setError(true) }
    finally { setWorking(false); onWorking(false) }
  }

  async function testModel() {
    if (!window.najdChatGPT || !modelName) return
    setTestState('testing')
    onWorking(true)
    try { await window.najdChatGPT.testModel(modelName); setTestState('passed') }
    catch { setTestState('failed') }
    finally { onWorking(false) }
  }

  const authError = status.errorCode === 'AUTH_DENIED' ? t.chatgptDenied : status.errorCode === 'AUTH_TIMEOUT' ? t.chatgptTimeout :
    status.errorCode === 'PLAN_NOT_ENABLED' ? t.planUnavailable : status.errorCode === 'AUTH_INVALID_RESPONSE' ? t.chatgptInvalid : t.providerConnectError
  const locked = working || busy || testState === 'testing'

  return <div className="model-card chatgpt-card">
    <CardHeading icon={KeyRound} title="ChatGPT" hint={t.chatgptExplain} className="model-card-heading" />
    {!window.najdChatGPT ? <p className="model-note">{t.localModelDesktopOnly}</p> : <>
      <p className="model-note" role="status">{status.signingIn ? t.chatgptSigningIn : status.signedIn ? t.chatgptSignedIn : t.chatgptSignedOut}</p>
      {status.accounts.length > 0 && <label className="model-choice"><span>{t.chatgptAccount}</span>
        <select value={status.activeId || ''} disabled={locked || status.signingIn} onChange={event => { void action(() => window.najdChatGPT!.select(event.target.value)) }}>
          {status.accounts.map(account => <option key={account.id} value={account.id}>{account.label}</option>)}
        </select></label>}
      <div className="model-actions subscription-actions">
        {status.signingIn ? <button type="button" className="model-refresh" disabled={locked} onClick={() => { void action(() => window.najdChatGPT!.cancel()) }}>{t.cancelSignIn}</button>
          : <button type="button" className="model-refresh" disabled={locked} onClick={() => { void action(() => window.najdChatGPT!.start(status.activeId)) }}>{t.continueChatGPT}</button>}
        {!status.signingIn && status.accounts.length > 0 && <button type="button" className="model-refresh" disabled={locked} onClick={() => { void action(() => window.najdChatGPT!.start()) }}>{t.addChatGPTAccount}</button>}
        {status.signedIn && <button type="button" className="model-refresh" disabled={locked || status.signingIn} onClick={() => { void action(() => window.najdChatGPT!.signOut(status.activeId!)) }}>{t.signOut}</button>}
      </div>
      {showPlanNote && status.signedIn && <InfoNote title={t.usingChatGPTPlan}><p>{t.chatgptPlanNote}</p>
        <button className="model-refresh" type="button" onClick={() => { localStorage.setItem('najd.chatgpt.plan-explained.v1', 'true'); setShowPlanNote(false) }}>{t.gotIt}</button></InfoNote>}
      {status.signedIn && <>
        <label className="model-choice"><span>{loadingModels ? t.localModelLoading : t.chatgptModel}</span><select aria-label={t.chatgptModel} value={modelName} disabled={locked || loadingModels || status.signingIn}
          onChange={event => onModelChange(event.target.value)}><option value="">{t.localModelChoosePlaceholder}</option>{models.map(model => <option key={model.id} value={model.id}>{model.label}</option>)}</select></label>
        <div className="model-actions subscription-actions">
          <button className="model-refresh" type="button" disabled={locked || !modelName || status.signingIn} aria-pressed={active} onClick={onActivate}>{active ? t.chatgptActive : t.chatgptUse}</button>
          <button className="model-refresh" type="button" aria-label={t.testConnection} disabled={locked || !modelName || status.signingIn} onClick={() => { void testModel() }}>{testState === 'testing' ? t.connectionTesting : t.testConnection}</button>
          <button className="model-refresh" type="button" disabled={locked || loadingModels || status.signingIn} onClick={() => setRefresh(n => n + 1)}>{t.localModelRefresh}</button>
        </div>
      </>}
      {testState === 'passed' && <p className="model-note" role="status">{t.connectionPassed}</p>}
      {testState === 'failed' && <p className="model-error" role="alert">{t.connectionFailed}</p>}
      {(error || status.errorCode) && <p className="model-error" role="alert">{status.errorCode ? authError : t.providerConnectError}</p>}
      {status.revocationConfirmed === false && <p className="model-note" role="status">{t.revocationUnconfirmed}</p>}
      <div className="model-actions"><button className="model-refresh" type="button" onClick={() => { void window.najdProviderPages?.open('chatgpt-usage') }}>{t.manageUsage}</button></div>
    </>}
  </div>
}
