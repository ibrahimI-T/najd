import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Trash2 } from 'lucide-react'
import type { ProviderControls } from '../useProviders'
import { ProviderSetup } from './ProviderSetup'
import { TOOL_DESCRIPTIONS_AR } from './toolDescriptionsAr'
import type { Prefs } from './prefs'
import { ZOOMS } from './prefs'
import type { SettingsRoute, SystemStatus } from './types'
import { Badge, Banner, Button, Field, IconButton, Page, Row, Search, Section, Segmented, Skeleton, Toggle, useLang } from './ui'

type Say = (ar: string, en: string) => string
const NAV: { id: SettingsRoute; ar: string; en: string; words?: string }[] = [
  { id: 'account-security', ar: 'الحساب والأمان', en: 'Account & Security', words: 'password login حساب كلمة' }, { id: 'models', ar: 'النماذج والمزودون', en: 'Models & Providers', words: 'provider key api نموذج مفتاح' },
  { id: 'notifications', ar: 'الإشعارات', en: 'Notifications' }, { id: 'appearance', ar: 'المظهر', en: 'Appearance', words: 'theme dark light font zoom language لغة خط' }, { id: 'shortcuts', ar: 'الاختصارات', en: 'Shortcuts', words: 'keyboard' },
  { id: 'feature-management', ar: 'إدارة الميزات', en: 'Feature Management', words: 'watermark suggestions' }, { id: 'quick-summon', ar: 'الاستدعاء السريع', en: 'Quick Summon' }, { id: 'startup-launch', ar: 'بدء التشغيل', en: 'Startup & Launch' },
  { id: 'permissions-control', ar: 'الصلاحيات والتحكم', en: 'Permissions & Control', words: 'files folders browser computer مجلد متصفح' }, { id: 'archived-tasks', ar: 'المهام المؤرشفة', en: 'Archived Tasks' }, { id: 'desktop-pet', ar: 'الرفيق المكتبي', en: 'Desktop Pet' },
  { id: 'general', ar: 'عام', en: 'General', words: 'update version legal تحديث' }, { id: 'subscription', ar: 'الاشتراك والفوترة', en: 'Subscription & Billing', words: 'gift card' }, { id: 'conversation-memory', ar: 'ذاكرة المحادثة', en: 'Conversation Memory', words: 'memory ذاكرة' },
  { id: 'chat-settings', ar: 'إعدادات المحادثة', en: 'Chat Settings', words: 'personality شخصية' }, { id: 'common-prompts', ar: 'الأوامر الشائعة', en: 'Common Prompts' }, { id: 'mcp', ar: 'خوادم MCP', en: 'MCP servers' }, { id: 'channels', ar: 'القنوات', en: 'Channels', words: 'telegram' }, { id: 'knowledge', ar: 'قواعد المعرفة', en: 'Knowledge bases' }, { id: 'diagnostics', ar: 'التشخيص والتراخيص', en: 'Diagnostics & Licenses', words: 'logs gateway debug export' }
]
const clean = (reason: unknown) => String((reason as Error)?.message || reason).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
function useLoad<T>(read: (() => Promise<T>) | undefined) {
  const [value, setValue] = useState<T | null>(null), [failure, setFailure] = useState<string | null>(null)
  const load = useCallback(async () => { if (!read) return; try { setValue(await read()); setFailure(null) } catch (reason) { setFailure(clean(reason)) } }, [])
  useEffect(() => { void load() }, [load])
  const run = async (work: () => Promise<unknown>) => { setFailure(null); try { await work(); await load() } catch (reason) { setFailure(clean(reason)); void load() } }
  return { value, failure, load, run }
}

function Accounts({ s }: { s: Say }) {
  const api = window.najdAccounts, { value, failure, run } = useLoad(api?.list)
  const [form, setForm] = useState({ label: '', siteUrl: '', username: '', password: '', autoLogin: true })
  return <><Section title={s('الحسابات المفوضة', 'Authorized accounts')} hint={s('تذهب كلمة المرور إلى مدير بيانات اعتماد ويندوز ولا تصل إلى النموذج.', 'The password goes to Windows Credential Manager and never reaches the model.')}>
    {failure && <Banner tone="error">{failure}</Banner>}
    {(value || []).map(account => <Row key={account.id} title={account.label} hint={account.username + ' · ' + account.host}><Toggle label={s('دخول تلقائي', 'Auto sign-in')} checked={account.autoLogin} onChange={enabled => { void run(() => api!.setAutoLogin(account.id, enabled)) }} /><IconButton label={s('إزالة', 'Remove')} icon={Trash2} onClick={() => { void run(() => api!.remove(account.id)) }} /></Row>)}
    <div className="s-form"><Field label={s('الاسم', 'Label')}><input value={form.label} onChange={event => setForm({ ...form, label: event.target.value })} /></Field><Field label={s('الموقع', 'Site')}><input dir="ltr" value={form.siteUrl} onChange={event => setForm({ ...form, siteUrl: event.target.value })} /></Field>
      <Field label={s('اسم المستخدم', 'Username')}><input dir="ltr" autoComplete="off" value={form.username} onChange={event => setForm({ ...form, username: event.target.value })} /></Field><Field label={s('كلمة المرور', 'Password')}><input type="password" dir="ltr" autoComplete="off" value={form.password} onChange={event => setForm({ ...form, password: event.target.value })} /></Field>
      <Button variant="primary" disabled={!form.label || !form.siteUrl || !form.username || !form.password} onClick={() => { const input = form; setForm({ label: '', siteUrl: '', username: '', password: '', autoLogin: true }); void run(() => api!.add(input)) }}>{s('تفويض', 'Authorize')}</Button></div></Section></>
}

function Permissions({ s }: { s: Say }) {
  const files = window.najdFiles, { value: roots, failure, run } = useLoad(files?.listRoots), browser = useLoad(window.najdBrowser?.status), [code, setCode] = useState<string | null>(null)
  const [whole, setWhole] = useState(false), [activity, setActivity] = useState<NajdActivityEntry[]>([]), pack = useLoad(window.najdPack?.status), connector = useLoad(window.najdMcp?.list)
  useEffect(() => { void files?.wholeComputer?.().then(item => setWhole(item.wholeComputer)).catch(() => {}); void files?.activity().then(list => setActivity([...list].reverse().slice(0, 50))).catch(() => {}) }, [])
  const windows = connector.value?.[0]
  return <>{failure && <Banner tone="error">{failure}</Banner>}
    <Section title={s('استخدام حاسوب ويندوز', 'Windows computer use')} hint={s('مكون ويندوز يراقب ويتصرف بموافقتك.', 'The Windows component observes and acts with your approval.')}><Row title={s('الحالة', 'State')}>{windows ? <Badge tone={windows.state === 'connected' ? 'green' : 'neutral'}>{windows.state}</Badge> : '—'}{windows && <Button onClick={() => { void connector.run(() => windows.state === 'connected' ? window.najdMcp!.disconnect(windows.id) : window.najdMcp!.connect(windows.id)) }}>{windows.state === 'connected' ? s('فصل', 'Disconnect') : s('اتصال', 'Connect')}</Button>}</Row>
      <Row title={s('الوصول إلى الحاسوب كاملًا', 'Whole-computer access')}><Toggle label={s('الوصول إلى الحاسوب كاملًا', 'Whole-computer access')} checked={whole} onChange={enabled => { void files?.wholeComputer?.(enabled).then(item => setWhole(item.wholeComputer)) }} /></Row></Section>
    <Section title={s('متصفحك', 'Your browser')} hint={s('الربط مرة واحدة مع إضافة نجد.', 'Link once with the NAJD extension.')}><Row title={s('الحالة', 'State')} hint={browser.value?.extensionPath}><Badge tone={browser.value?.connected ? 'green' : browser.value?.paired ? 'orange' : 'neutral'}>{browser.value?.connected ? s('متصل', 'Connected') : browser.value?.paired ? s('مربوط، غير متصل', 'Linked, not connected') : s('غير مربوط', 'Not linked')}</Badge><Button onClick={() => { void window.najdBrowser?.pairingCode().then(setCode) }}>{s('رمز الربط', 'Pairing code')}</Button></Row>{code && <code dir="ltr">{code}</code>}
      {(browser.value?.links || []).filter(link => link.connected).length > 1 && <Banner tone="warn">{s('أكثر من إضافة نجد متصلة الآن. عطّل الإصدار القديم (1.x) في صفحة إضافات المتصفح حتى لا تتعارض.', 'More than one NAJD extension is connected. Turn off the old 1.x extension in the browser so they do not conflict.')}</Banner>}
      {(browser.value?.links || []).map(link => <Row key={link.id + (link.instance || '')} title={link.name + ((link as { version?: string | null }).version ? ' · ' + (link as { version?: string | null }).version : '')} hint={link.connected ? s('متصلة', 'Connected') : s('غير متصلة', 'Not connected')}><Button variant="danger" onClick={() => { void browser.run(() => window.najdBrowser!.unpair(link.id, link.instance)) }}>{s('فك الربط', 'Unlink')}</Button></Row>)}</Section>
    <Section title={s('المتصفح المدمج', 'Built-in browser')} hint={s('جلسة منفصلة داخل نجد، ولا تُستورد ملفات تعريف من متصفح آخر.', 'A separate session inside NAJD; no cookies are imported from another browser.')}><Row title={s('الحالة', 'State')}><Badge tone="green">{s('متاح', 'Available')}</Badge></Row></Section>
    <Section title={s('حزمة المستندات', 'Document pack')}><Row title="Word, Excel, PDF, PowerPoint" hint={pack.value?.lastError}><Badge tone={pack.value?.state === 'ready' ? 'green' : 'neutral'}>{pack.value?.installing || pack.value?.state || '—'}</Badge>{pack.value?.state === 'ready' ? <Button variant="danger" onClick={() => { void pack.run(() => window.najdPack!.remove()) }}>{s('إزالة', 'Remove')}</Button> : <Button disabled={!!pack.value?.installing} onClick={() => { void pack.run(() => window.najdPack!.install()) }}>{s('تثبيت', 'Install')}</Button>}</Row></Section>
    <Section title={s('المجلدات المسموحة', 'Allowed folders')} actions={<Button onClick={() => { void run(() => files!.grantRoot()) }}>{s('إضافة مجلد', 'Add a folder')}</Button>}>{(roots || []).map(root => <Row key={root} title={root}><Button variant="danger" onClick={() => { void run(() => files!.revokeRoot(root)) }}>{s('سحب', 'Revoke')}</Button></Row>)}</Section>
    <Section title={s('السجل', 'Activity')}>{activity.map((entry, index) => <Row key={index} title={entry.action || ''} hint={entry.path}>{entry.decision}</Row>)}</Section></>
}

function Memory({ s }: { s: Say }) {
  const api = window.najdMemory, { value, failure, run } = useLoad(api?.list), [note, setNote] = useState({ title: '', text: '' })
  return <Section title={s('الملاحظات', 'Notes')} actions={<><Button onClick={() => { void run(() => api!.import()) }}>{s('استيراد', 'Import')}</Button><Button onClick={() => { void run(() => api!.export()) }}>{s('تصدير', 'Export')}</Button></>}>{failure && <Banner tone="error">{failure}</Banner>}
    {(value || []).map(item => <Row key={item.id} title={item.title} hint={item.text.slice(0, 160)}><IconButton label={s('حذف', 'Delete')} icon={Trash2} onClick={() => { void run(() => api!.remove(item.id)) }} /></Row>)}
    <div className="s-form"><Field label={s('العنوان', 'Title')}><input value={note.title} dir="auto" onChange={event => setNote({ ...note, title: event.target.value })} /></Field><Field label={s('النص', 'Text')}><textarea rows={3} dir="auto" value={note.text} onChange={event => setNote({ ...note, text: event.target.value })} /></Field><Button variant="primary" disabled={!note.title.trim() || !note.text.trim()} onClick={() => { const input = note; setNote({ title: '', text: '' }); void run(() => api!.save(input)) }}>{s('حفظ', 'Save')}</Button></div></Section>
}
function ChatSettings({ s }: { s: Say }) {
  const api = window.najdPersonality, { value, failure, run } = useLoad(api?.get), [draft, setDraft] = useState<NajdPersonality | null>(null), current = draft || value
  if (!current) return <Skeleton />
  return <Section title={s('الشخصية', 'Personality')}>{failure && <Banner tone="error">{failure}</Banner>}<Row title={s('مفعلة', 'Enabled')}><Toggle label={s('مفعلة', 'Enabled')} checked={current.enabled} onChange={enabled => setDraft({ ...current, enabled })} /></Row>
    <Field label={s('الاسم', 'Name')}><input value={current.name} dir="auto" onChange={event => setDraft({ ...current, name: event.target.value })} /></Field><Field label={s('التعليمات', 'Instructions')}><textarea rows={6} dir="auto" value={current.instructions} onChange={event => setDraft({ ...current, instructions: event.target.value })} /></Field>
    <div className="s-inline"><Button variant="primary" onClick={() => { void run(() => api!.save(current)).then(() => setDraft(null)) }}>{s('حفظ', 'Save')}</Button><Button onClick={() => { void run(() => api!.reset()).then(() => setDraft(null)) }}>{s('استعادة', 'Reset')}</Button></div></Section>
}
function Mcp({ s }: { s: Say }) {
  const api = window.najdMcpServers, { value, failure, run } = useLoad(api?.list), [form, setForm] = useState({ name: '', command: '', args: '' }), [token, setToken] = useState('')
  return <Section title={s('الخوادم', 'Servers')}>{failure && <Banner tone="error">{failure}</Banner>}
    {(value || []).map(server => <Row key={server.id} title={server.name} hint={server.error || server.commandLine}><Badge tone={server.state === 'connected' ? 'green' : server.state === 'failed' ? 'red' : 'neutral'}>{server.state}</Badge><Button onClick={() => { void run(() => server.state === 'connected' ? api!.disconnect(server.id) : api!.connect(server.id)) }}>{server.state === 'connected' ? s('فصل', 'Disconnect') : s('اتصال', 'Connect')}</Button><IconButton label={s('إزالة', 'Remove')} icon={Trash2} onClick={() => { void run(() => api!.remove(server.id)) }} /></Row>)}
    <div className="s-form"><Field label={s('الاسم', 'Name')}><input value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} /></Field><Field label={s('الأمر', 'Command')}><input dir="ltr" value={form.command} onChange={event => setForm({ ...form, command: event.target.value })} /></Field><Field label={s('المعاملات', 'Arguments')}><input dir="ltr" value={form.args} onChange={event => setForm({ ...form, args: event.target.value })} /></Field>
      <Field label={s('رمز الوصول للخادم الخارجي (اختياري)', 'Remote server access token (optional)')}><input type="password" autoComplete="off" value={token} onChange={event => setToken(event.target.value)} /></Field>
      <p>{s('أدخل أمر خادم محلي أو عنوان HTTPS لخادم MCP. المعاملات المحلية بصيغة مصفوفة JSON عند احتوائها على مسافات.', 'Enter a local command or HTTPS MCP endpoint. Use a JSON array for local arguments containing spaces.')}</p>
      <Button variant="primary" disabled={!form.name || !form.command} onClick={() => { const input = form, secret = token; void run(async () => { const args: string[] = input.args.trim().startsWith('[') ? JSON.parse(input.args) : input.args.split(/\s+/).filter(Boolean); setToken(''); const result = await api!.add({ name: input.name, command: input.command, ...(input.command.startsWith('https://') ? { url: input.command } : {}), args, cwd: '', env: secret ? { MCP_TOKEN: secret } : {} }); if (result.status === 'added') { setForm({ name: '', command: '', args: '' }); if (result.server) await api!.connect(result.server.id) } }) }}>{s('إضافة واتصال', 'Add and connect')}</Button></div></Section>
}
function Channels({ s }: { s: Say }) {
  const api = window.najdChannels, { value, failure, run } = useLoad(api?.status), [token, setToken] = useState(''), [pair, setPair] = useState<string | null>(null)
  return <Section title="Telegram">{failure && <Banner tone="error">{failure}</Banner>}{value && <><Row title={s('الحالة', 'State')} hint={value.botName || value.errorCode || undefined}><Badge tone={value.state === 'running' ? 'green' : value.state === 'error' ? 'red' : 'neutral'}>{value.state}</Badge><Toggle label={s('مفعلة', 'Enabled')} checked={value.enabled} disabled={!value.tokenSaved} onChange={enabled => { void run(() => api!.configure({ enabled })) }} /></Row>
    <div className="s-inline"><input type="password" autoComplete="off" aria-label={s('رمز البوت', 'Bot token')} dir="ltr" value={token} onChange={event => setToken(event.target.value)} /><Button disabled={!token.trim()} onClick={() => { const value2 = token; setToken(''); void run(() => api!.saveToken(value2)) }}>{s('حفظ', 'Save')}</Button>{value.tokenSaved && <Button variant="danger" onClick={() => { void run(() => api!.clearToken()) }}>{s('مسح', 'Clear')}</Button>}</div>
    {value.tokenSaved && <Row title={s('ربط محادثة', 'Pair a chat')}>{pair && <code dir="ltr">{pair}</code>}<Button onClick={() => { void api!.pair().then(item => setPair(item.code)) }}>{s('إنشاء رمز', 'Create a code')}</Button></Row>}
    {value.allowed.map(chat => <Row key={chat.chatId} title={chat.name}><Button variant="danger" onClick={() => { void run(() => api!.unpair(chat.chatId)) }}>{s('فك الربط', 'Unpair')}</Button></Row>)}</>}</Section>
}
function Knowledge({ s }: { s: Say }) {
  const api = window.najdKnowledge, { value, failure, run } = useLoad(api?.list), [name, setName] = useState('')
  return <Section title={s('القواعد', 'Bases')}>{failure && <Banner tone="error">{failure}</Banner>}{(value || []).map(base => <Row key={base.id} title={base.name} hint={s(`${base.items.length} ملف`, `${base.items.length} files`)}><Button onClick={() => { void run(() => api!.addFiles(base.id)) }}>{s('إضافة ملفات', 'Add files')}</Button><IconButton label={s('حذف', 'Delete')} icon={Trash2} onClick={() => { void run(() => api!.remove(base.id)) }} /></Row>)}
    <div className="s-inline"><input aria-label={s('الاسم', 'Name')} value={name} dir="auto" onChange={event => setName(event.target.value)} /><Button variant="primary" disabled={!name.trim()} onClick={() => { const value2 = name; setName(''); void run(() => api!.create(value2, '')) }}>{s('إنشاء', 'Create')}</Button></div></Section>
}
function General({ s, prefs, change }: { s: Say; prefs: Prefs; change: (patch: Partial<Prefs>) => void }) {
  const api = window.najdUpdates, { value, failure, run } = useLoad(api?.status)
  return <>{failure && <Banner tone="error">{failure}</Banner>}<Section title={s('اللغة', 'Language')}><Segmented label={s('اللغة', 'Language')} value={prefs.language} onChange={language => change({ language })} options={[{ value: 'ar', label: 'العربية' }, { value: 'en', label: 'English' }]} /></Section>
    <Section title={s('التحديثات', 'Updates')}><Row title={s('الإصدار', 'Version')} hint={value?.version ? s('متاح: ', 'Available: ') + value.version : undefined}><code dir="ltr">{value?.currentVersion}</code><Badge>{value?.state}</Badge>
      {value?.state === 'available' ? <Button onClick={() => { void run(() => api!.download()) }}>{s('تنزيل', 'Download')}</Button> : value?.state === 'ready' ? <Button variant="primary" onClick={() => { void run(() => api!.install()) }}>{s('تثبيت', 'Install')}</Button> : <Button onClick={() => { void run(() => api!.check()) }}>{s('فحص', 'Check')}</Button>}</Row></Section></>
}
function Diagnostics({ s }: { s: Say }) {
  const gateway = useLoad(window.najdGateway?.status), notices = useLoad(window.najdAbout?.notices), [open, setOpen] = useState(false), [tools, setTools] = useState<NajdAgentTool[]>([])
  useEffect(() => { void window.najdAgent?.tools?.().then(setTools).catch(() => {}) }, [])
  return <><Section title={s('البوابة', 'Gateway')}><Row title={gateway.value?.engine || 'openclaw'} hint={gateway.value?.errorCode || undefined}><Badge tone={gateway.value?.state === 'healthy' ? 'green' : 'neutral'}>{gateway.value?.state}</Badge><Button onClick={() => { void gateway.run(() => gateway.value?.state === 'healthy' ? window.najdGateway!.stop() : window.najdGateway!.start()) }}>{gateway.value?.state === 'healthy' ? s('إيقاف', 'Stop') : s('تشغيل', 'Start')}</Button></Row></Section>
    <Section title={s('التشخيص', 'Diagnostics')}><Row title={s('تصدير حزمة تشخيص', 'Export a diagnostics bundle')}><Button onClick={() => { void window.najdDiagnostics?.export() }}>{s('تصدير', 'Export')}</Button></Row></Section>
    <Section title={s('الأدوات', 'Tools')} hint={s(`${tools.filter(tool => tool.ready).length} جاهزة من ${tools.length}`, `${tools.filter(tool => tool.ready).length} of ${tools.length} ready`)}>{tools.slice(0, 200).map(tool => <Row key={tool.name} title={tool.name} hint={tool.reason || (document.documentElement.lang === 'ar' && TOOL_DESCRIPTIONS_AR[tool.name]) || tool.description}><Badge tone={tool.ready ? 'green' : 'orange'}>{tool.group}</Badge></Row>)}</Section>
    <Section title={s('التراخيص', 'Licenses')}><Button onClick={() => setOpen(value => !value)}>{open ? s('إخفاء', 'Hide') : s('عرض', 'Show')}</Button>{open && <pre className="s-legal" tabIndex={0} dir="ltr">{notices.value?.text}</pre>}</Section></>
}
function SystemPage({ s, part }: { s: Say; part: 'notifications' | 'quick-summon' | 'startup-launch' | 'desktop-pet' }) {
  const api = window.najdWorkstation, { value, failure, run } = useLoad(api?.system)
  if (!value) return failure ? <Banner tone="error">{failure}</Banner> : <Skeleton />
  const set = (patch: Partial<SystemStatus>) => { void run(() => api!.systemSet(patch)) }
  return <Section title={s('الإعداد', 'Setting')}>{failure && <Banner tone="error">{failure}</Banner>}
    {part === 'notifications' && <Row title={s('إشعار عند انتهاء مهمة مجدولة', 'Notify when a scheduled task finishes')}><Toggle label={s('إشعار', 'Notify')} checked={value.notifyFinished} onChange={notifyFinished => set({ notifyFinished })} /></Row>}
    {part === 'quick-summon' && <><Row title={s('استدعاء نجد باختصار عام', 'Bring NAJD up with a global shortcut')} hint={value.quickSummon && !value.shortcutActive ? s('الاختصار محجوز لبرنامج آخر.', 'Another program holds this shortcut.') : undefined}><Toggle label={s('الاستدعاء السريع', 'Quick summon')} checked={value.quickSummon} onChange={quickSummon => set({ quickSummon })} /></Row><Field label={s('الاختصار', 'Shortcut')} hint="Control+Alt+N"><input dir="ltr" defaultValue={value.accelerator} onBlur={event => set({ accelerator: event.target.value })} /></Field></>}
    {part === 'startup-launch' && <Row title={s('التشغيل مع ويندوز', 'Start with Windows')} hint={value.packaged ? undefined : s('يعمل في النسخة المثبتة فقط.', 'Works in the installed app only.')}><Toggle label={s('التشغيل مع ويندوز', 'Start with Windows')} checked={value.launchAtLogin} disabled={!value.packaged} onChange={launchAtLogin => set({ launchAtLogin })} /></Row>}
    {part === 'desktop-pet' && <Row title={s('إظهار الرفيق المكتبي', 'Show the desktop pet')} hint={s('نافذة صغيرة فوق النوافذ؛ النقر المزدوج يفتح نجد.', 'A small window on top; double-click opens NAJD.')}><Toggle label={s('الرفيق المكتبي', 'Desktop pet')} checked={value.pet} onChange={pet => set({ pet })} /></Row>}
  </Section>
}
const SHORTCUTS: [string, string, string][] = [['Enter', 'إرسال', 'Send'], ['Shift+Enter', 'سطر جديد', 'New line'], ['/', 'الأوامر', 'Commands'], ['@', 'الإشارة إلى محادثة', 'Mention a chat'], ['Ctrl+N', 'مهمة جديدة', 'New task'], ['Ctrl+B', 'طي الشريط', 'Collapse the rail'], ['Ctrl+,', 'الإعدادات', 'Settings'], ['Escape', 'إغلاق', 'Close']]

export function Settings({ route, onRoute, prefs, change, providers, onOpenChat }: { route: SettingsRoute; onRoute: (route: SettingsRoute) => void; prefs: Prefs; change: (patch: Partial<Prefs>) => void; providers: ProviderControls; onOpenChat: (id: string) => void }) {
  const { s, ar } = useLang(), [query, setQuery] = useState(''), [prompt, setPrompt] = useState('')
  const nav = useMemo(() => { const word = query.trim().toLowerCase(); return NAV.filter(item => !word || [item.ar, item.en, item.words].some(field => field?.toLowerCase().includes(word))) }, [query])
  const title = NAV.find(item => item.id === route)!
  let body: ReactNode
  switch (route) {
    case 'notifications': case 'quick-summon': case 'startup-launch': case 'desktop-pet': body = <SystemPage s={s} part={route} />; break
    case 'models': body = <ProviderSetup providers={providers} />; break
    case 'account-security': body = <Accounts s={s} />; break
    case 'permissions-control': body = <Permissions s={s} />; break
    case 'conversation-memory': body = <Memory s={s} />; break
    case 'chat-settings': body = <ChatSettings s={s} />; break
    case 'mcp': body = <Mcp s={s} />; break
    case 'channels': body = <Channels s={s} />; break
    case 'knowledge': body = <Knowledge s={s} />; break
    case 'general': body = <General s={s} prefs={prefs} change={change} />; break
    case 'diagnostics': body = <Diagnostics s={s} />; break
    case 'appearance': body = <Section title={s('المظهر', 'Appearance')}>
      <Row title={s('السمة', 'Theme')}><Segmented label={s('السمة', 'Theme')} value={prefs.theme} onChange={theme => change({ theme })} options={[{ value: 'light', label: s('فاتح', 'Light') }, { value: 'system', label: s('النظام', 'System') }, { value: 'dark', label: s('داكن', 'Dark') }]} /></Row>
      <Row title={s('حجم الخط', 'Font size')}><Segmented label={s('حجم الخط', 'Font size')} value={String(prefs.fontSize)} onChange={value => change({ fontSize: Number(value) as Prefs['fontSize'] })} options={['13', '14', '15', '16'].map(value => ({ value, label: value }))} /></Row>
      <Row title={s('الكثافة', 'Density')}><Segmented label={s('الكثافة', 'Density')} value={prefs.density} onChange={density => change({ density })} options={[{ value: 'comfortable', label: s('مريحة', 'Comfortable') }, { value: 'compact', label: s('مضغوطة', 'Compact') }]} /></Row>
      <Row title={s('اللغة', 'Language')}><Segmented label={s('اللغة', 'Language')} value={prefs.language} onChange={language => change({ language })} options={[{ value: 'ar', label: 'العربية' }, { value: 'en', label: 'English' }]} /></Row>
      <Row title={s('تكبير الواجهة', 'UI zoom')}><Segmented label={s('تكبير الواجهة', 'UI zoom')} value={String(prefs.zoom)} onChange={value => change({ zoom: Number(value) })} options={ZOOMS.map(value => ({ value: String(value), label: Math.round(value * 100) + '%' }))} /><Button disabled={prefs.zoom === 1} onClick={() => change({ zoom: 1 })}>{s('إعادة', 'Reset')}</Button></Row></Section>; break
    case 'shortcuts': body = <Section title={s('الاختصارات', 'Shortcuts')}>{SHORTCUTS.map(([keys, arabic, english]) => <Row key={keys} title={ar ? arabic : english}><kbd dir="ltr">{keys}</kbd></Row>)}</Section>; break
    case 'feature-management': body = <Section title={s('الميزات', 'Features')}><Row title={s('اقتراحات المهام', 'Task suggestions')} hint={s('تظهر في الشاشة الرئيسية.', 'Shown on the home screen.')}><Toggle label={s('اقتراحات المهام', 'Task suggestions')} checked={prefs.taskSuggestions} onChange={taskSuggestions => change({ taskSuggestions })} /></Row><Row title={s('علامة مائية للوسائط المولدة', 'Generated-media watermark')} hint={s('يحفظ التفضيل؛ تطبيقه على الملفات لم يُبنَ بعد.', 'Stores the preference; applying it to files is not built yet.')}><Toggle label={s('علامة مائية', 'Watermark')} checked={prefs.watermarkMedia} onChange={watermarkMedia => change({ watermarkMedia })} /></Row></Section>; break
    case 'archived-tasks': body = <Section title={s('المهام المؤرشفة', 'Archived tasks')} hint={s('تجدها في مركز المهام عبر زر المؤرشفة.', 'Find them in Task Center with the Archived button.')}><Button onClick={() => onOpenChat('')}>{s('العودة', 'Back')}</Button></Section>; break
    case 'subscription': body = <Section title={s('الاشتراك', 'Subscription')} hint={s('نجد لا يبيع اشتراكًا. يدار الدفع لدى كل مزود.', 'NAJD sells no subscription. Billing is handled by each provider.')}>{providers.catalog.filter(item => item.kind === 'subscription' && item.configured).map(item => <Row key={item.id} title={item.name}><Button onClick={() => { void window.najdProviders?.openConsole(item.id) }}>{s('فتح الحساب', 'Open the account')}</Button></Row>)}</Section>; break
    case 'common-prompts': body = <Section title={s('الأوامر الشائعة', 'Common prompts')}>{prefs.prompts.map((item, index) => <Row key={index} title={item}><IconButton label={s('حذف', 'Delete')} icon={Trash2} onClick={() => change({ prompts: prefs.prompts.filter((_, position) => position !== index) })} /></Row>)}<div className="s-inline"><input aria-label={s('أمر جديد', 'New prompt')} value={prompt} dir="auto" onChange={event => setPrompt(event.target.value)} /><Button disabled={!prompt.trim()} onClick={() => { change({ prompts: [...prefs.prompts, prompt.trim()].slice(0, 100) }); setPrompt('') }}>{s('إضافة', 'Add')}</Button></div></Section>; break
  }
  return <div className="s-layout" data-settings={route}>
    <nav className="s-nav" aria-label={s('الإعدادات', 'Settings')}><Search value={query} onChange={setQuery} placeholder={s('ابحث في الإعدادات', 'Search settings')} />{nav.map(item => <button type="button" key={item.id} data-settings-route={item.id} aria-current={route === item.id ? 'page' : undefined} className={route === item.id ? 'on' : ''} onClick={() => onRoute(item.id)}>{ar ? item.ar : item.en}</button>)}</nav>
    <Page title={ar ? title.ar : title.en}>{body}</Page></div>
}
