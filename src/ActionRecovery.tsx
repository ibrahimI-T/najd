import { useEffect, useState } from 'react'

type Item = NajdActionRecovery['actions'][number]

// Actions left unconfirmed by the previous run. NAJD never repeats them; the owner checks the result and records what happened, or dismisses a stale approval.
export function ActionRecovery({ language }: { language: 'ar' | 'en' }) {
  const [status, setStatus] = useState<NajdActionRecovery | null>(null)
  const [busy, setBusy] = useState<string | null>(null), [failed, setFailed] = useState(false)
  const ar = language === 'ar'
  useEffect(() => {
    let active = true
    void window.najdCore?.recovery?.().then(result => { if (active) setStatus(result) })
      .catch(() => { if (active) setStatus({ available: false, actions: [] }) })
    return () => { active = false }
  }, [])
  async function settle(item: Item, resolution: 'done' | 'not-done' | 'dismiss') {
    if (!window.najdCore?.reconcileAction || busy) return
    setBusy(item.id); setFailed(false)
    try {
      await window.najdCore.reconcileAction(item.id, resolution)
      setStatus(current => current ? { ...current, actions: current.actions.filter(action => action.id !== item.id) } : current)
    } catch { setFailed(true) } finally { setBusy(null) }
  }
  if (!status || status.available && !status.actions.length) return null
  if (!status.available) return <aside className="action-recovery" role="status">{ar ? 'تعذّر قراءة سجل التنفيذ. يلزم إصلاح السجل قبل تنفيذ إجراءات الجهاز المسجّلة.' : 'Execution history could not be read. Repair it before running recorded device actions.'}</aside>
  const label = (item: Item) => item.target === 'chrome' ? 'Google Chrome' : item.target === 'edge' ? 'Microsoft Edge' : item.target
  return <details className="action-recovery" open>
    <summary>{ar ? 'إجراءات من التشغيل السابق تحتاج مراجعتك' : 'Actions from the previous run need your review'} ({status.actions.length})</summary>
    <p>{ar ? 'لم يُعد نجد تنفيذ أي إجراء تلقائيًا. الإجراء غير المؤكد قد يكون نُفّذ فعلًا؛ تحقق من نتيجته بنفسك ثم سجّل ما حدث. لا تُستخدم الموافقات السابقة بعد إعادة التشغيل.' : 'NAJD did not repeat any action. An unconfirmed action may have happened; check the result yourself, then record what happened. Earlier approvals are not reused after a restart.'}</p>
    <ul>{status.actions.map(item => <li key={item.id} data-recovery-state={item.state}>
      <strong dir="auto">{label(item)}</strong>
      <span>{item.state === 'UNKNOWN_EFFECT' ? (ar ? 'النتيجة غير مؤكدة' : 'Outcome unconfirmed') : (ar ? 'توقّف قبل التنفيذ؛ يحتاج موافقة جديدة' : 'Stopped before execution; fresh approval required')}</span>
      <time dateTime={item.updatedAt}>{new Date(item.updatedAt).toLocaleString(ar ? 'ar-SA' : 'en-GB')}</time>
      {window.najdCore?.reconcileAction && <span className="recovery-actions">
        {item.state === 'UNKNOWN_EFFECT' ? <>
          <button type="button" disabled={busy !== null} data-recovery="done" onClick={() => { void settle(item, 'done') }}>{ar ? 'تم تنفيذه' : 'It happened'}</button>
          <button type="button" disabled={busy !== null} data-recovery="not-done" onClick={() => { void settle(item, 'not-done') }}>{ar ? 'لم يُنفَّذ' : 'It did not happen'}</button>
        </> : <button type="button" disabled={busy !== null} data-recovery="dismiss" onClick={() => { void settle(item, 'dismiss') }}>{ar ? 'تجاهل' : 'Dismiss'}</button>}
      </span>}
    </li>)}</ul>
    {failed && <p role="alert">{ar ? 'تعذّر تسجيل ذلك. حاول مرة أخرى.' : 'That could not be recorded. Try again.'}</p>}
    <small>{ar ? 'ما تسجّله هنا يُحفظ كإفادة منك ولا يتحقق منه نجد، ولا يبدأ أي إجراء.' : 'What you record here is kept as your statement; NAJD does not verify it and it starts nothing.'}</small>
  </details>
}
