import { useEffect, useMemo, useState } from 'react'
import { Button, Field, Segmented, useLang } from './ui'

// The owner's page: how long and how often they have worked with NAJD (from the saved conversations on this computer), an activity grid
// for the last year, and self-improvement, which is the existing learning review: NAJD proposes what it learned and the owner approves it.
import { activityStats } from './profileStats'
const DAY = 86400000
const dayKey = (time: number) => new Date(time).toISOString().slice(0, 10)
export function Profile({ name, onName, sessions }: { name: string; onName: (name: string) => void; sessions: NajdSessionSummary[] }) {
  const { s, lang } = useLang()
  const [view, setView] = useState<'closeness' | 'growth'>('closeness')
  const [learning, setLearning] = useState<NajdLearningState | null>(null)
  const [draft, setDraft] = useState(name)
  const [failed, setFailed] = useState(false)
  useEffect(() => { void window.najdLearning?.list().then(setLearning).catch(() => setFailed(true)) }, [])
  const stats = useMemo(() => activityStats(sessions as { updatedAt: string; createdAt?: string }[]), [sessions])
  const weeks = 53, today = new Date(), start = new Date(today.getTime() - (weeks * 7 - 1) * DAY - today.getDay() * DAY)
  const cells = Array.from({ length: weeks * 7 }, (_, index) => { const time = start.getTime() + index * DAY; return { key: dayKey(time), count: stats.days.get(dayKey(time)) || 0, future: time > today.getTime() } })
  const months = Array.from({ length: 12 }, (_, index) => new Date(today.getFullYear(), today.getMonth() - 11 + index, 1).toLocaleDateString(lang === 'ar' ? 'ar' : 'en', { month: 'long' }))
  const on = learning ? learning.settings.mode !== 'off' : false
  const toggle = async () => { if (!learning || !window.najdLearning) return; try { const settings = await window.najdLearning.setSettings({ ...learning.settings, mode: on ? 'off' : 'review' }); setLearning({ ...learning, settings }) } catch { setFailed(true) } }
  const pending = learning ? learning.pending.preference.length + learning.pending.experience.length : 0
  const approved = learning ? learning.approved.preference.length + learning.approved.experience.length : 0
  return <div className="pf" data-profile>
    <div className="pf-head"><span className="pf-avatar" aria-hidden>{(name || 'N').charAt(0).toUpperCase()}</span><div><h1>{s(`نجد الخاص بـ ${name || '…'}`, `${name || '…'}'s NAJD`)}</h1>
      <p>{s(`الأيام معًا: ${stats.together} · المحادثات: ${stats.conversations} · سلسلة الأيام الحالية: ${stats.streak}`, `Days together: ${stats.together} · Conversations: ${stats.conversations} · Current streak: ${stats.streak}`)}</p></div>
      <span className="w-grow" /><Button variant={on ? 'default' : 'primary'} onClick={() => { void toggle() }} disabled={!learning} data-self-evolution>{on ? s('إيقاف التطور الذاتي', 'Turn off self-improvement') : s('تفعيل التطور الذاتي', 'Turn on self-improvement')}</Button></div>
    <Field label={s('الاسم الظاهر', 'Display name')}><input value={draft} maxLength={60} dir="auto" onChange={event => setDraft(event.target.value)} onBlur={() => onName(draft.trim())} /></Field>
    <Segmented label={s('العرض', 'View')} value={view} onChange={setView} options={[{ value: 'closeness', label: s('التقارب', 'Closeness') }, { value: 'growth', label: s('التطور', 'Growth') }]} />
    {view === 'closeness' ? <>
      <p className="pf-note">{s('كلما تحدثت أكثر أو أسندت مهامًا أكثر، امتلأت الشبكة.', 'The more you talk and hand over tasks, the fuller the grid gets.')}</p>
      <div className="pf-grid" dir="ltr" role="img" aria-label={s('نشاط السنة', 'Activity this year')}>{cells.map(cell => <i key={cell.key} title={cell.key + ' · ' + cell.count} data-level={cell.future ? 'none' : cell.count >= 4 ? 3 : cell.count >= 2 ? 2 : cell.count ? 1 : 0} />)}</div>
      <div className="pf-months" dir="ltr">{months.map(month => <span key={month}>{month}</span>)}</div>
    </> : <div className="pf-growth">
      <h2>{s('الآن يمكن لنجد التعلم والتطور من تلقاء نفسه', 'NAJD can now learn and improve on its own')}</h2>
      <p>{s('عند تفعيله يقترح نجد ما تعلمه من تفضيلاتك وطريقة عملك، ولا يعتمد شيئًا قبل موافقتك في إعدادات ذاكرة المحادثة.', 'When on, NAJD proposes what it learned about your preferences and way of working, and keeps nothing before you approve it in Conversation Memory.')}</p>
      <p>{s(`بانتظار مراجعتك: ${pending} · معتمد: ${approved}`, `Waiting for your review: ${pending} · Approved: ${approved}`)}</p>
      {failed && <p className="pf-note">{s('تعذرت قراءة حالة التعلم.', 'The learning state could not be read.')}</p>}
    </div>}
  </div>
}
