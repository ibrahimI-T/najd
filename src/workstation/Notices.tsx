import { useEffect, useState } from 'react'
import { useVisibleIntervalEffect } from './useInterval'
import { Banner, Button, useLang } from './ui'

// What the owner must know before working: steps left unconfirmed by an earlier run (never repeated by NAJD), an engine still being
// prepared, an update, and a missing model.
function Recovery() {
  const { s } = useLang()
  const [status, setStatus] = useState<NajdActionRecovery | null>(null), [open, setOpen] = useState(false), [failed, setFailed] = useState(false)
  useEffect(() => { void window.najdCore?.recovery?.().then(setStatus).catch(() => setStatus({ available: false, actions: [] })) }, [])
  const settle = async (id: string, resolution: 'done' | 'not-done' | 'dismiss') => { setFailed(false); try { await window.najdCore!.reconcileAction!(id, resolution); setStatus(current => current && { ...current, actions: current.actions.filter(item => item.id !== id) }) } catch { setFailed(true) } }
  if (!status || status.available && !status.actions.length) return null
  if (!status.available) return <Banner tone="error">{s('تعذر قراءة سجل التنفيذ. لن تعمل إجراءات الجهاز المسجلة حتى يصلح السجل.', 'The action journal could not be read. Recorded device actions stay off until it is repaired.')}</Banner>
  return <div className="n-recovery" data-recovery><Banner tone="warn" action={<Button onClick={() => setOpen(value => !value)}>{open ? s('إخفاء', 'Hide') : s('مراجعة', 'Review')}</Button>}>{s(`إجراءات من التشغيل السابق تحتاج مراجعتك (${status.actions.length}). لم يعد نجد تنفيذ شيء تلقائيًا.`, `Actions from the previous run need your review (${status.actions.length}). NAJD repeated nothing.`)}</Banner>
    {open && status.actions.map(item => <div key={item.id} className="w-row"><div><strong dir="ltr">{item.operation}</strong><small dir="ltr" title={item.target}>{item.target.slice(0, 140)}</small></div><div className="w-row-end">
      {item.state === 'UNKNOWN_EFFECT' ? <><Button onClick={() => { void settle(item.id, 'done') }}>{s('تم فعلًا', 'It happened')}</Button><Button onClick={() => { void settle(item.id, 'not-done') }}>{s('لم يتم', 'It did not')}</Button></> : <Button onClick={() => { void settle(item.id, 'dismiss') }}>{s('تجاهل', 'Dismiss')}</Button>}</div></div>)}
    {failed && <Banner tone="error">{s('تعذر الحفظ.', 'Could not save.')}</Banner>}</div>
}
function Engine() {
  const { s } = useLang(), [status, setStatus] = useState<NajdRuntimeStatus | null>(null)
  useVisibleIntervalEffect(() => { void window.najdRuntime?.status().then(setStatus).catch(() => {}) }, 2000)
  if (!status?.bundled || status.state === 'ready') return null
  return <Banner tone={status.error ? 'error' : 'info'} action={status.error ? <Button onClick={() => { void window.najdRuntime!.prepare() }}>{s('إعادة المحاولة', 'Try again')}</Button> : undefined}>{status.error ? s('تعذر تجهيز المحرك: ', 'The engine could not be prepared: ') + status.error : s('يجهز نجد محركه…', 'NAJD is preparing its engine…')}</Banner>
}
function Update({ onOpen }: { onOpen: () => void }) {
  const { s } = useLang(), [status, setStatus] = useState<NajdUpdateStatus | null>(null)
  useEffect(() => { void window.najdUpdates?.status().then(setStatus).catch(() => {}) }, [])
  if (!status || !['available', 'manual', 'ready'].includes(status.state)) return null
  return <Banner action={<Button onClick={onOpen}>{s('فتح', 'Open')}</Button>}>{s('يوجد تحديث: ', 'An update is available: ')}<bdi dir="ltr">{status.version}</bdi></Banner>
}
export function Notices({ noModel, onModels, onUpdates }: { noModel: boolean; onModels: () => void; onUpdates: () => void }) {
  const { s } = useLang()
  return <div className="n-notices"><Recovery /><Engine /><Update onOpen={onUpdates} />
    {noModel && <Banner action={<Button variant="primary" onClick={onModels} data-connect-model>{s('ربط نموذج', 'Connect a model')}</Button>}>{s('اربط نموذجًا لتبدأ. يمكنك استخدام اشتراك أو مفتاح API أو نموذج محلي.', 'Connect a model to begin: a subscription, an API key or a local model.')}</Banner>}</div>
}
