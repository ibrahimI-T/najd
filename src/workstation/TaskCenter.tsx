import { useCallback, useEffect, useState } from 'react'
import { Archive, CalendarClock, Pause, Play, Plus, Trash2, Zap } from 'lucide-react'
import type { ProviderControls } from '../useProviders'
import type { Automation, Schedule } from './types'
import { Badge, Banner, Button, Dialog, Empty, Field, IconButton, Page, Segmented, Skeleton, useLang } from './ui'

const STATES: Record<string, [string, string, 'green' | 'orange' | 'red' | 'blue' | 'neutral']> = {
  RUNNING: ['قيد التشغيل', 'Running', 'blue'], COMPLETED: ['اكتملت', 'Completed', 'green'], FAILED: ['فشلت', 'Failed', 'red'], CANCELLED: ['أوقفت', 'Cancelled', 'neutral'], INTERRUPTED: ['انقطعت', 'Interrupted', 'orange'],
  NEEDS_APPROVAL: ['تحتاج موافقتك', 'Needs your approval', 'orange'], UNKNOWN_EFFECT: ['نتيجة غير مؤكدة', 'Unconfirmed result', 'orange']
}
type Form = { id?: string; title: string; prompt: string; kind: Schedule['kind']; at: string; minutes: number; cron: string; timezone: string }
const blank = (): Form => ({ title: '', prompt: '', kind: 'cron', at: '', minutes: 60, cron: '0 9 * * *', timezone: Intl.DateTimeFormat().resolvedOptions().timeZone })
const toSchedule = (form: Form): Schedule => form.kind === 'once' ? { kind: 'once', at: new Date(form.at).toISOString() } : form.kind === 'interval' ? { kind: 'interval', minutes: form.minutes } : { kind: 'cron', cron: form.cron, timezone: form.timezone }

export function TaskCenter({ providers, onOpenChat, seed }: { providers: ProviderControls; onOpenChat: (id: string) => void; seed?: string | null }) {
  const { s, ar, lang } = useLang(), api = window.najdWorkstation
  const [items, setItems] = useState<Automation[] | null>(null)
  const [form, setForm] = useState<Form | null>(seed ? { ...blank(), prompt: seed, title: seed.slice(0, 60) } : null)
  const [failure, setFailure] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [archived, setArchived] = useState(false)
  const load = useCallback(async () => { try { if (api) setItems(await api.tasks()) } catch { setFailure('TASKS') } }, [api])
  useEffect(() => { void load(); return api?.onChanged(kind => { if (kind === 'tasks') void load() }) }, [load, api])
  const act = async (work: () => Promise<unknown>) => { setFailure(null); try { await work(); await load() } catch (reason) { setFailure(String((reason as Error).message).split(': ').pop() || 'FAILED') } }
  const when = (value: string | null) => value ? new Date(value).toLocaleString(lang === 'ar' ? 'ar-SA' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' }) : '—'
  const describe = (schedule: Schedule) => schedule.kind === 'once' ? s('مرة واحدة', 'Once') : schedule.kind === 'interval' ? s(`كل ${schedule.minutes} دقيقة`, `Every ${schedule.minutes} min`) : `${schedule.cron} · ${schedule.timezone}`
  const save = () => { if (!form || !api) return; const current = form; void act(async () => {
    if (current.id) await api.taskUpdate(current.id, { title: current.title, prompt: current.prompt, schedule: toSchedule(current) })
    else await api.taskCreate({ title: current.title, prompt: current.prompt, schedule: toSchedule(current), provider: providers.provider, model: providers.model || null })
    setForm(null)
  }) }
  const shown = (items || []).filter(item => (item.status === 'archived') === archived)
  return <Page title={s('مركز المهام', 'Task Center')} intro={s('مهام مجدولة ومتكررة تستمر بعد إعادة التشغيل. تتوقف أي مهمة تحتاج موافقة وتعرض ذلك هنا بدل التنفيذ دون إذنك.', 'Scheduled and recurring tasks that survive a restart. A task that needs an approval stops and says so here instead of acting without you.')}
    actions={<><Button onClick={() => setArchived(value => !value)}>{archived ? s('النشطة', 'Active') : s('المؤرشفة', 'Archived')}</Button><Button variant="primary" icon={Plus} onClick={() => setForm(blank())} data-task="new">{s('مهمة جديدة', 'New task')}</Button></>}>
    {failure && <Banner tone="error">{failure}</Banner>}
    {!items ? <Skeleton /> : shown.length === 0 ? <Empty icon={CalendarClock} title={s('لا توجد مهام مجدولة', 'No scheduled tasks')} body={s('أنشئ مهمة ليعمل نجد في الوقت الذي تحدده.', 'Create a task and NAJD works at the time you set.')} />
      : <ul className="t-list">{shown.map(item => { const last = item.runs[0], state = last && (STATES[last.state] || [last.state, last.state, 'neutral'] as const); return <li key={item.id} className="t-card" data-automation={item.id}>
        <button type="button" className="t-open" aria-expanded={open === item.id} onClick={() => setOpen(open === item.id ? null : item.id)}><strong dir="auto">{item.title}</strong><small dir="ltr">{describe(item.schedule)}</small></button>
        <dl><div><dt>{s('التشغيل القادم', 'Next run')}</dt><dd>{item.status === 'active' ? when(item.nextRunAt) : item.status === 'paused' ? s('موقوفة مؤقتًا', 'Paused') : s('انتهت', 'Finished')}</dd></div>
          <div><dt>{s('آخر نتيجة', 'Last result')}</dt><dd>{state ? <Badge tone={state[2]}>{state[ar ? 0 : 1]}</Badge> : '—'}</dd></div>
          <div><dt>{s('التسليم', 'Delivery')}</dt><dd>{item.delivery === 'notification' ? s('إشعار', 'Notification') : s('محادثة', 'Conversation')}</dd></div></dl>
        <div className="t-actions">
          <IconButton label={s('تشغيل الآن', 'Run now')} icon={Zap} disabled={last?.state === 'RUNNING'} onClick={() => { void act(() => api!.taskRun(item.id)) }} />
          {item.status === 'active' ? <IconButton label={s('إيقاف مؤقت', 'Pause')} icon={Pause} onClick={() => { void act(() => api!.taskStatus(item.id, 'paused')) }} /> : <IconButton label={s('تفعيل', 'Enable')} icon={Play} onClick={() => { void act(() => api!.taskStatus(item.id, 'active')) }} />}
          <Button variant="ghost" onClick={() => setForm({ ...blank(), id: item.id, title: item.title, prompt: item.prompt, kind: item.schedule.kind, ...(item.schedule.kind === 'cron' ? { cron: item.schedule.cron, timezone: item.schedule.timezone } : item.schedule.kind === 'interval' ? { minutes: item.schedule.minutes } : { at: item.schedule.at.slice(0, 16) }) })}>{s('تعديل', 'Edit')}</Button>
          <IconButton label={s('أرشفة', 'Archive')} icon={Archive} onClick={() => { void act(() => api!.taskStatus(item.id, 'archived')) }} />
          <IconButton label={s('حذف', 'Delete')} icon={Trash2} onClick={() => { if (window.confirm(s('حذف هذه المهمة وسجلها؟', 'Delete this task and its history?'))) void act(() => api!.taskRemove(item.id)) }} />
        </div>
        {open === item.id && <ol className="t-runs">{item.runs.length === 0 ? <li>{s('لم تعمل بعد.', 'Has not run yet.')}</li> : item.runs.map(run => { const label = STATES[run.state]; return <li key={run.id}><time>{when(run.startedAt)}</time><Badge tone={label?.[2] || 'neutral'}>{label ? label[ar ? 0 : 1] : run.state}</Badge>{run.late && <small>{s('متأخرة', 'Late')}</small>}{run.code && <code dir="ltr">{run.code}</code>}{run.conversationId && <Button variant="ghost" onClick={() => onOpenChat(run.conversationId!)}>{s('فتح المحادثة', 'Open conversation')}</Button>}</li> })}</ol>}
      </li> })}</ul>}
    {form && <Dialog title={form.id ? s('تعديل المهمة', 'Edit task') : s('مهمة جديدة', 'New task')} onClose={() => setForm(null)} footer={<><Button onClick={() => setForm(null)}>{s('إلغاء', 'Cancel')}</Button><Button variant="primary" data-task="save" disabled={!form.title.trim() || !form.prompt.trim() || (form.kind === 'once' && !form.at)} onClick={save}>{s('حفظ', 'Save')}</Button></>}>
      <Field label={s('الاسم', 'Name')}><input value={form.title} maxLength={120} dir="auto" data-task="title" onChange={event => setForm({ ...form, title: event.target.value })} /></Field>
      <Field label={s('التعليمات', 'Instructions')}><textarea value={form.prompt} rows={4} maxLength={8000} dir="auto" data-task="prompt" onChange={event => setForm({ ...form, prompt: event.target.value })} /></Field>
      <Segmented label={s('الجدولة', 'Schedule')} value={form.kind} onChange={kind => setForm({ ...form, kind })} options={[{ value: 'cron', label: 'Cron' }, { value: 'interval', label: s('متكررة', 'Interval') }, { value: 'once', label: s('مرة واحدة', 'Once') }]} />
      {form.kind === 'cron' && <><Field label="Cron" hint={s('دقيقة ساعة يوم شهر يوم-الأسبوع', 'minute hour day month weekday')}><input dir="ltr" value={form.cron} onChange={event => setForm({ ...form, cron: event.target.value })} /></Field><Field label={s('المنطقة الزمنية', 'Time zone')}><input dir="ltr" value={form.timezone} onChange={event => setForm({ ...form, timezone: event.target.value })} /></Field></>}
      {form.kind === 'interval' && <Field label={s('كل (دقيقة)', 'Every (minutes)')}><input type="number" min={1} value={form.minutes} onChange={event => setForm({ ...form, minutes: Number(event.target.value) })} /></Field>}
      {form.kind === 'once' && <Field label={s('الوقت', 'Time')}><input type="datetime-local" value={form.at} onChange={event => setForm({ ...form, at: event.target.value })} /></Field>}
      {!form.id && <small>{s(`ستعمل بالنموذج الحالي: ${providers.provider} ${providers.model}`, `Runs with the current model: ${providers.provider} ${providers.model}`)}</small>}
    </Dialog>}
  </Page>
}
