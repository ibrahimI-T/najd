import { useCallback, useEffect, useState } from 'react'
import { LayoutDashboard, Maximize2, Plus, Trash2 } from 'lucide-react'
import { MessageBody } from './Conversation'
import type { Widget, WorkstationDocument } from './types'
import { Banner, Button, Empty, Field, IconButton, Page, Skeleton, Tabs, useLang } from './ui'

const w = (type: Widget['type'], title: string, value: string, column: Widget['column']): Widget => ({ id: crypto.randomUUID(), type, title, value, column })
const chart = (labels: string[]) => '```chart\n' + JSON.stringify({ type: 'bar', labels, series: [{ name: 'Value', values: labels.map(() => 0) }] }) + '\n```'
const TEMPLATES: { id: string; ar: string; en: string; widgets: () => Widget[] }[] = [
  { id: 'finance', ar: 'المالية', en: 'Finance', widgets: () => [w('metric', 'Revenue', '0', 1), w('metric', 'Expenses', '0', 2), w('metric', 'Cash', '0', 3), w('chart', 'Monthly', chart(['Jan', 'Feb', 'Mar']), 1)] },
  { id: 'bi', ar: 'ذكاء الأعمال', en: 'Business intelligence', widgets: () => [w('metric', 'KPI', '0', 1), w('chart', 'Trend', chart(['Q1', 'Q2', 'Q3', 'Q4']), 2), w('note', 'Insights', '', 3)] },
  { id: 'projects', ar: 'المشاريع', en: 'Projects', widgets: () => [w('list', 'To do', '', 1), w('list', 'In progress', '', 2), w('list', 'Done', '', 3)] },
  { id: 'daily', ar: 'الموجز اليومي', en: 'Daily brief', widgets: () => [w('note', 'Today', '', 1), w('list', 'Priorities', '', 2), w('note', 'Notes', '', 3)] },
  { id: 'personal', ar: 'المتابعة الشخصية', en: 'Personal tracking', widgets: () => [w('metric', 'Goal', '0', 1), w('list', 'Habits', '', 2), w('chart', 'Week', chart(['Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri']), 3)] },
  { id: 'custom', ar: 'مخصصة', en: 'Custom', widgets: () => [] }
]

function WidgetView({ widget, editing, onChange, onRemove }: { widget: Widget; editing: boolean; onChange: (widget: Widget) => void; onRemove: () => void }) {
  const { s } = useLang()
  if (editing) return <div className="d-widget edit"><input aria-label={s('العنوان', 'Title')} value={widget.title} onChange={event => onChange({ ...widget, title: event.target.value })} dir="auto" />
    <textarea aria-label={s('المحتوى', 'Content')} rows={widget.type === 'metric' ? 1 : 4} value={widget.value} dir="auto" onChange={event => onChange({ ...widget, value: event.target.value })} />
    <div><select className="w-select" aria-label={s('العمود', 'Column')} value={widget.column} onChange={event => onChange({ ...widget, column: Number(event.target.value) as Widget['column'] })}>{[1, 2, 3].map(value => <option key={value} value={value}>{value}</option>)}</select><IconButton label={s('حذف', 'Delete')} icon={Trash2} onClick={onRemove} /></div></div>
  return <div className={'d-widget ' + widget.type}><h3 dir="auto">{widget.title}</h3>{widget.type === 'metric' ? <strong dir="auto">{widget.value}</strong> : widget.type === 'list' ? <ul>{widget.value.split('\n').filter(Boolean).map((item, index) => <li key={index} dir="auto">{item}</li>)}</ul> : <div dir="auto"><MessageBody text={widget.value} /></div>}</div>
}

export function Dashboard({ onOpenTab, documentId, projects }: { onOpenTab?: (document: WorkstationDocument) => void; documentId?: string; projects: NajdProject[] }) {
  const { s, ar } = useLang(), api = window.najdWorkstation
  const [items, setItems] = useState<WorkstationDocument[] | null>(null)
  const [active, setActive] = useState<string | null>(documentId || null)
  const [editing, setEditing] = useState(false)
  const [failure, setFailure] = useState(false)
  const load = useCallback(async () => { try { if (api) { const list = await api.documents('dashboard'); setItems(list); setActive(current => current && list.some(item => item.id === current) ? current : list[0]?.id ?? null) } } catch { setFailure(true) } }, [api])
  useEffect(() => { void load() }, [load])
  const current = items?.find(item => item.id === active) || null
  const save = async (document: WorkstationDocument) => { setItems(list => (list || []).map(item => item.id === document.id ? document : item)); try { await api!.documentSave(document) } catch { setFailure(true) } }
  const create = async (template: typeof TEMPLATES[number]) => { try { const made = await api!.documentSave({ id: crypto.randomUUID(), kind: 'dashboard', title: ar ? template.ar : template.en, template: template.id, widgets: template.widgets() }); await load(); setActive(made.id); setEditing(template.id === 'custom') } catch { setFailure(true) } }
  const gallery = <div className="d-gallery">{TEMPLATES.map(template => <button type="button" key={template.id} className="d-template" data-template={template.id} onClick={() => { void create(template) }}><LayoutDashboard size={18} aria-hidden /><strong>{ar ? template.ar : template.en}</strong><small>{template.widgets().length || '+'}</small></button>)}</div>
  return <Page title={s('لوحات البيانات', 'Dashboard')} intro={s('ابدأ من قالب، وعدل الودجت، واحفظ اللوحة في مشروع.', 'Start from a template, edit the widgets and save the board to a project.')}
    actions={current && <><Button onClick={() => setEditing(value => !value)} data-dashboard="edit">{editing ? s('انتهيت', 'Done') : s('تعديل', 'Edit')}</Button>
      {editing && <Button icon={Plus} onClick={() => { void save({ ...current, widgets: [...current.widgets, w('note', s('ودجت', 'Widget'), '', 1)] }) }}>{s('ودجت', 'Widget')}</Button>}
      {onOpenTab && <IconButton label={s('فتح في مساحة العمل', 'Open in the workbench')} icon={Maximize2} onClick={() => onOpenTab(current)} />}
      <select className="w-select" aria-label={s('حفظ في مشروع', 'Save to project')} value={current.projectId || ''} onChange={event => { void save({ ...current, projectId: event.target.value || null }) }}><option value="">{s('بدون مشروع', 'No project')}</option>{projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select>
      <IconButton label={s('حذف', 'Delete')} icon={Trash2} onClick={() => { if (window.confirm(s('حذف هذه اللوحة؟', 'Delete this board?'))) void api!.documentRemove(current.id).then(load) }} /></>}>
    {failure && <Banner tone="error">{s('تعذر حفظ اللوحة.', 'The board could not be saved.')}</Banner>}
    {!items ? <Skeleton rows={4} /> : items.length === 0 ? <><Empty icon={LayoutDashboard} title={s('لا توجد لوحات بعد', 'No boards yet')} body={s('اختر قالبًا للبدء.', 'Choose a template to start.')} />{gallery}</> : <>
      <Tabs label={s('اللوحات', 'Boards')} value={active || ''} onChange={setActive} tabs={items.map(item => ({ value: item.id, label: item.title }))} />
      {current && <>{editing && <Field label={s('الاسم', 'Name')}><input value={current.title} dir="auto" onChange={event => { void save({ ...current, title: event.target.value || current.title }) }} /></Field>}
        <div className="d-grid" data-dashboard="grid">{[1, 2, 3].map(column => <div key={column}>{current.widgets.filter(widget => widget.column === column).map(widget => <WidgetView key={widget.id} widget={widget} editing={editing} onChange={next => { void save({ ...current, widgets: current.widgets.map(item => item.id === next.id ? next : item) }) }} onRemove={() => { void save({ ...current, widgets: current.widgets.filter(item => item.id !== widget.id) }) }} />)}</div>)}</div></>}
      <h2 className="d-more">{s('قالب جديد', 'New from a template')}</h2>{gallery}</>}
  </Page>
}
