import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowUp, Box, Hammer, LayoutDashboard, Microscope, Presentation, Star, CalendarClock, Check, ChevronDown, FolderKanban, FolderOpen, MessageSquareText, Mic, Paperclip, Plus, ShieldCheck, Square, X } from 'lucide-react'
import { filterMentionable, insertMention, mentionQuery } from '../mentions'
import { buildSlashItems, filterSlash, slashQuery, type SlashItem } from '../slashCommands'
import type { ProviderControls } from '../useProviders'
import { ModelPicker } from './ModelPicker'
import { iconFor } from './MarketView'
import type { CatalogEntry } from './types'
import { Chip, IconButton, Menu, MenuItem, useLang } from './ui'
import type { AccessMode, Conversation } from './useConversation'

const CHIP_ICONS: Record<string, typeof Star> = { recommended: Star, slides: Presentation, research: Microscope, build: Hammer, dashboard: LayoutDashboard, '3d': Box }
const CATEGORIES = [
  { id: 'recommended', ar: 'مقترح', en: 'Recommended', prompts: [['لخص ما يجب أن أعرفه عن هذا المشروع', 'Summarize what I should know about this project'], ['نظم لي خطة أسبوعي', 'Organize a plan for my week']] },
  { id: 'slides', ar: 'شرائح', en: 'Slides', prompts: [['أنشئ عرض PowerPoint من عشر شرائح عن: ', 'Create a ten-slide PowerPoint deck about: ']] },
  { id: 'research', ar: 'بحث', en: 'Research', prompts: [['ابحث بعمق مع مصادر عن: ', 'Research in depth, with sources: ']] },
  { id: 'build', ar: 'بناء', en: 'Build', prompts: [['ابن صفحة ويب تعمل محليًا عن: ', 'Build a working local web page for: ']] },
  { id: 'dashboard', ar: 'لوحة بيانات', en: 'Dashboard', prompts: [['أنشئ لوحة بيانات تفاعلية لهذه البيانات: ', 'Create an interactive dashboard for this data: ']] },
  { id: '3d', ar: 'ثلاثي الأبعاد', en: '3D', prompts: [['صمم مشهدًا ثلاثي الأبعاد لـ: ', 'Design a 3D scene for: ']] }
] as const
const ACCESS: { id: AccessMode; ar: string; en: string; hintAr: string; hintEn: string }[] = [
  { id: 'ask', ar: 'اسألني عن كل خطوة', en: 'Ask for each step', hintAr: 'أي تغيير يحتاج موافقتك', hintEn: 'Any change needs your approval' },
  { id: 'approve', ar: 'مرر الآمن تلقائيًا', en: 'Approve safe steps', hintAr: 'القراءة الآمنة تمر، والباقي يسألك', hintEn: 'Safe reads pass; the rest asks you' },
  { id: 'full', ar: 'وصول كامل', en: 'Full access', hintAr: 'عدا ما يحتاج موافقتك دائمًا', hintEn: 'Except what always needs your approval' }
]


export function Composer({ chat, providers, home, work, onSettings, onOpenHub, onOpenPage, focusSignal, onSchedule }: { chat: Conversation; providers: ProviderControls; home: boolean; work: boolean; onSettings: (route?: string) => void; onOpenHub: () => void; onOpenPage: (section: string) => void; focusSignal: number; onSchedule: (text: string) => void }) {
  const { s, ar, lang } = useLang()
  const field = useRef<HTMLTextAreaElement>(null)
  const [category, setCategory] = useState<string>('recommended')
  const [dragging, setDragging] = useState(false)
  const [index, setIndex] = useState(0), [closed, setClosed] = useState<string | null>(null)
  const [skills, setSkills] = useState<{ id: string; name: string; description: string }[]>([])
  const [commands, setCommands] = useState<NajdPluginCommand[]>([])
  const { draft, setDraft, busy, approval, activeTaskId, importing, attachments, setAttachments, activeSessionId, projects, chatProject } = chat
  useEffect(() => { field.current?.focus() }, [focusSignal])
  useEffect(() => { if (!draft && field.current) field.current.style.height = '' }, [draft])
  const [plugins, setPlugins] = useState<CatalogEntry[]>([])
  useEffect(() => { void window.najdWorkstation?.catalog().then(view => setPlugins(view.entries.filter(entry => entry.kind === 'plugin' && entry.categories.includes('installed') && entry.state === 'AVAILABLE'))).catch(() => {}) }, [])
  useEffect(() => { void window.najdPlugins?.commands().then(setCommands).catch(() => {}); void window.najdSkills?.list().then(list => setSkills(list.filter(item => item.enabled).map(({ id, name, description }) => ({ id, name, description })))).catch(() => {}) }, [])
  const slashItems = useMemo(() => buildSlashItems({ language: lang, hasConversation: !!activeSessionId, busy: busy || !!approval, skills, pluginCommands: commands, efforts: providers.supported,
    actions: { newChat: () => chat.newTask(), openPage: onOpenPage, setAccess: chat.setAccessMode, pinProfile: chat.pinProfile, setEffort: value => providers.setEffort(value as NajdReasoningPreference) } }), [lang, activeSessionId, busy, approval, skills, commands, providers.supported])
  const slashText = slashQuery(draft), slash = slashText !== null && closed !== draft && !busy && !approval ? filterSlash(slashItems, slashText) : []
  const mentionText = slash.length ? null : mentionQuery(draft), mentionable = mentionText !== null && closed !== draft && !busy && !approval ? filterMentionable(chat.sessions, mentionText, activeSessionId) : []
  const list: { id: string; label: string; hint?: string; choose: () => void; disabled?: boolean }[] = slash.length
    ? slash.map((item: SlashItem) => ({ id: item.id, label: '/' + item.command + '  ' + item.label, hint: item.disabled || item.hint, disabled: !!item.disabled, choose: () => { if (item.disabled) return; setIndex(0); if (item.action.kind === 'insert') { setDraft(item.action.text); field.current?.focus() } else { setDraft(''); item.action.run() } } }))
    : mentionable.map(item => ({ id: item.id, label: item.title, choose: () => { setIndex(0); chat.setMentions(all => [...all.filter(entry => entry.id !== item.id), { id: item.id, title: item.title }]); setDraft(text => insertMention(text, item.title)); field.current?.focus() } }))
  const active = Math.min(index, Math.max(0, list.length - 1))
  const project = chatProject ? projects.find(item => item.id === chatProject) : projects.find(item => activeSessionId && item.chats.includes(activeSessionId))
  const working = busy && !!activeTaskId
  const attach = async () => {
    if (!window.najdLibrary) return
    chat.setImporting(true)
    try { const added = await window.najdLibrary.import(); setAttachments([...new Map([...attachments, ...added].map(item => [item.id, item])).values()].slice(0, 20)) } catch { chat.setErrorCode('ATTACHMENT_READ_FAILED') } finally { chat.setImporting(false) }
  }
  async function transfer(data: DataTransfer, kind: 'drop' | 'paste') {
    const library = window.najdLibrary
    if (!library || busy || importing || approval) return
    chat.setImporting(true)
    try {
      const added = kind === 'drop' && data.files.length ? await library.importDropped(Array.from(data.files).slice(0, 8))
        : await Promise.all(Array.from(data.items).filter(item => item.kind === 'file' && /^image\/(png|jpeg|webp|gif|bmp)$/.test(item.type)).map(item => item.getAsFile()).filter((file): file is File => !!file).slice(0, 4).map(async (file, position) => library.importBytes(`Pasted image ${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}-${position + 1}.${file.type.split('/')[1].replace('jpeg', 'jpg')}`, await file.arrayBuffer())))
      setAttachments([...new Map([...attachments, ...added].map(item => [item.id, item])).values()].slice(0, 20))
    } catch { chat.setErrorCode('ATTACHMENT_READ_FAILED') } finally { chat.setImporting(false) }
  }
  const accessNow = ACCESS.find(item => item.id === chat.accessMode)!
  const box = <form className={'k-box' + (dragging ? ' drag' : '')} data-composer onSubmit={event => { event.preventDefault(); void chat.submit() }}
    onDragOver={event => { if (Array.from(event.dataTransfer.types).includes('Files')) { event.preventDefault(); setDragging(true) } }} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false) }}
    onDrop={event => { event.preventDefault(); setDragging(false); void transfer(event.dataTransfer, 'drop') }}>
    {list.length > 0 && <ul className="k-suggest" role="listbox" id="k-suggest" aria-label={s('اقتراحات', 'Suggestions')}>{list.slice(0, 40).map((item, position) => <li key={item.id} id={'k-' + item.id} role="option" aria-selected={position === active} aria-disabled={item.disabled} className={position === active ? 'on' : ''} onMouseEnter={() => setIndex(position)} onMouseDown={event => { event.preventDefault(); item.choose() }}><span dir="auto">{item.label}</span>{item.hint && <small dir="auto">{item.hint}</small>}</li>)}</ul>}
    {attachments.length > 0 && <div className="k-files">{attachments.map(item => <span key={item.id} className="k-file"><Paperclip size={13} aria-hidden /><bdi>{item.name}</bdi><button type="button" aria-label={s('إزالة ', 'Remove ') + item.name} onClick={() => setAttachments(attachments.filter(asset => asset.id !== item.id))}><X size={12} aria-hidden /></button></span>)}</div>}
    <label className="sr" htmlFor="prompt">{s('اكتب طلبك', 'Write your request')}</label>
    <textarea id="prompt" ref={field} rows={home ? 3 : 1} dir="auto" value={draft} placeholder={work ? s('ماذا تريد أن ينجز نجد؟', 'What should NAJD get done?') : s('اكتب رسالة…', 'Write a message…')}
      role={list.length ? 'combobox' : undefined} aria-expanded={list.length ? true : undefined} aria-controls={list.length ? 'k-suggest' : undefined} aria-activedescendant={list.length ? 'k-' + list[active].id : undefined}
      onChange={event => { setDraft(event.target.value); setIndex(0); const element = event.currentTarget; element.style.height = 'auto'; element.style.height = Math.min(240, element.scrollHeight) + 'px' }}
      onPaste={event => { if (Array.from(event.clipboardData.items).some(item => item.kind === 'file' && item.type.startsWith('image/'))) { event.preventDefault(); void transfer(event.clipboardData, 'paste') } }}
      onKeyDown={event => {
        if (list.length) {
          if (event.key === 'ArrowDown') { event.preventDefault(); setIndex((active + 1) % list.length); return }
          if (event.key === 'ArrowUp') { event.preventDefault(); setIndex((active - 1 + list.length) % list.length); return }
          if (event.key === 'Enter' || event.key === 'Tab') { event.preventDefault(); list[active].choose(); return }
          if (event.key === 'Escape') { event.preventDefault(); setClosed(draft); return }
        }
        if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit() }
      }} />
    {chat.queuedSend && <small className="k-wait" role="status">{s('سيُرسل عندما يجهز نجد', 'Sends when NAJD is ready')}</small>}
    <div className="k-bar">
      <IconButton label={s('إرفاق ملفات', 'Attach files')} icon={Plus} size={18} disabled={busy || !!approval || importing} onClick={() => { void attach() }} />
      <Menu label={s('وضع التنفيذ', 'Execution profile')} up trigger={props => <button type="button" {...props} className="k-pill" disabled={busy || !!approval} data-access={chat.accessMode}><ShieldCheck size={14} aria-hidden /><span>{ar ? accessNow.ar : accessNow.en}</span></button>}>
        {close => ACCESS.map(item => <MenuItem key={item.id} icon={item.id === chat.accessMode ? Check : undefined} hint={ar ? item.hintAr : item.hintEn} onClick={() => { chat.setAccessMode(item.id); close() }}>{ar ? item.ar : item.en}</MenuItem>)}
      </Menu>
      <span className="k-grow" />
      <ModelPicker providers={providers} disabled={busy || !!approval || providers.connectionBusy} onSettings={() => onSettings('models')} />
      <IconButton label={s('الإدخال الصوتي غير متاح بعد في هذا الإصدار', 'Voice input is not available in this version yet')} icon={Mic} disabled />
      {working && <button type="button" className="k-send stop" aria-label={s('إيقاف', 'Stop')} onClick={() => { void chat.stop() }}><Square size={12} fill="currentColor" aria-hidden /></button>}
      {(!working || draft.trim()) && <button type="submit" className="k-send" aria-label={working ? s('أضف إلى المهمة', 'Add to the task') : s('إرسال', 'Send')} disabled={!draft.trim() || !!approval || (busy && !activeTaskId)}><ArrowUp size={17} aria-hidden /></button>}
    </div>
  </form>
  const picked = CATEGORIES.find(item => item.id === category)!
  return <div className={'k-wrap' + (home ? ' home' : '')}>
    {box}
    {work && <div className="k-under" data-under-composer>
      <Menu label={s('المشروع', 'Project')} trigger={props => <button type="button" {...props} className="k-link"><FolderKanban size={14} aria-hidden /><bdi>{project?.name || s('بدون مشروع', 'No project')}</bdi><ChevronDown size={12} aria-hidden /></button>}>
        {close => <>
          <MenuItem icon={MessageSquareText} onClick={() => { chat.setChatProject(null); close() }}>{s('بدون مشروع', 'No project')}</MenuItem>
          {projects.map(item => <MenuItem key={item.id} icon={FolderOpen} disabled={!!activeSessionId} onClick={() => { chat.setChatProject(item.id); close() }}>{item.name}</MenuItem>)}
        </>}
      </Menu>
      <button type="button" className="k-link" onClick={onOpenHub}><span className="k-plugins" aria-hidden>{plugins.slice(0, 3).map(entry => { const [Icon, color] = iconFor(entry); return <i key={entry.id} style={{ color, background: color + '22' }}><Icon size={12} /></i> })}</span>{s('الإضافات', 'Plugins')}</button>
      {draft.trim() && <button type="button" className="k-link" data-schedule onClick={() => onSchedule(draft.trim())}><CalendarClock size={14} aria-hidden />{s('جدولة هذا الطلب', 'Schedule this request')}</button>}
    </div>}
    {home && work && <>
      <div className="k-chips" role="group" aria-label={s('نوع المهمة', 'Task category')}>{CATEGORIES.map(item => <Chip key={item.id} active={category === item.id} onClick={() => setCategory(item.id)}>{(() => { const Icon = CHIP_ICONS[item.id]; return Icon ? <Icon size={14} aria-hidden /> : null })()}{ar ? item.ar : item.en}</Chip>)}</div>
      <div className="k-starts">{picked.prompts.map(([arabic, english]) => <button type="button" key={english} onClick={() => { setDraft(ar ? arabic : english); field.current?.focus() }} dir="auto">{ar ? arabic : english}</button>)}</div>
    </>}
  </div>
}
