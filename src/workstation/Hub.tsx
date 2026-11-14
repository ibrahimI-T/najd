import { useCallback, useEffect, useMemo, useState } from 'react'
import { Blocks, ChevronDown, Download, FileText, FolderOpen, Plus, RefreshCw, RotateCcw, Search as SearchIcon, ShieldCheck, Trash2, Wand2 } from 'lucide-react'
import { CategoryPills, MarketCard, SectionedList } from './MarketView'
import { canManagePackage, descriptionOf, filterEntries, nameOf, reasonText, stateLabel, type SortKey } from './catalogView'
import { PLUGIN_CATEGORIES, SKILL_CATEGORIES, type CapabilityKind, type CatalogEntry, type CatalogView, type LocalImportPlan, type PackagePlan } from './types'
import { Badge, Banner, Button, Dialog, Empty, Field, IconButton, MenuItem, Page, Row, Section, Skeleton, Toggle, useLang } from './ui'

const CATEGORY_NAMES: Record<string, [string, string]> = {
  installed: ['المثبتة', 'Installed'], featured: ['مميزة', 'Featured'], finance: ['المالية', 'Finance'], productivity: ['الإنتاجية', 'Productivity'], 'creativity-design': ['الإبداع والتصميم', 'Creativity & Design'], '3d': ['ثلاثي الأبعاد', '3D'],
  'developer-tools': ['أدوات المطورين', 'Developer Tools'], research: ['البحث', 'Research'], legal: ['قانوني', 'Legal'], personal: ['شخصي', 'Personal'], academic: ['أكاديمي', 'Academic'], marketing: ['التسويق', 'Marketing'], engineering: ['الهندسة', 'Engineering'], creative: ['إبداعي', 'Creative']
}
const tone = (entry: CatalogEntry) => entry.state === 'AVAILABLE' ? 'green' : entry.state === 'UPDATE_AVAILABLE' ? 'blue' : entry.state === 'NOT_INSTALLED' ? 'neutral' : entry.state === 'NOT_READY' || entry.state === 'DISABLED' ? 'orange' : 'red'

export function Hub({ onUse, onPrompt, initialKind = 'plugin' }: { onUse: (entry: CatalogEntry) => void; onPrompt?: (text: string) => void; initialKind?: CapabilityKind }) {
  const { s, lang } = useLang()
  const api = window.najdWorkstation
  const [view, setView] = useState<CatalogView | null>(null)
  const [kind, setKind] = useState<CapabilityKind>(initialKind)
  const [category, setCategory] = useState('installed')
  const [menu, setMenu] = useState(false)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SortKey>('relevance')
  const [syncing, setSyncing] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [details, setDetails] = useState<CatalogEntry | null>(null)
  const [plan, setPlan] = useState<PackagePlan | null>(null)
  const [signin, setSignin] = useState<CatalogEntry | null>(null)
  const [localPlan, setLocalPlan] = useState<LocalImportPlan | null>(null)
  const [adding, setAdding] = useState(false)
  const [source, setSource] = useState('')
  const load = useCallback(async () => { try { if (api) setView(await api.catalog()) } catch (reason) { setFailure(String(reason)) } }, [api])
  useEffect(() => { void load(); return api?.onChanged(event => { if (event === 'catalog') void load() }) }, [load, api])
  const act = async (work: () => Promise<unknown>) => { setFailure(null); try { await work(); await load() } catch (reason) { setFailure(String((reason as Error).message || reason).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')) } }
  const sync = async () => { setSyncing(true); setFailure(null); try { if (api) setView(await api.sync()) } catch (reason) { setFailure(String(reason)) } finally { setSyncing(false) } }
  const preparePackage = async (entry: CatalogEntry) => {
    if (!api) throw new Error('SERVICE_UNAVAILABLE')
    if (entry.packageUrl && entry.sha256) setPlan(await api.planUrl(entry.packageUrl, entry.sha256, entry.packageFormat))
    else if (entry.localImportable) setLocalPlan(await api.planLocal([entry.id]))
    else throw new Error('PACKAGE_SOURCE_NOT_AVAILABLE')
  }
  const categories = kind === 'plugin' ? PLUGIN_CATEGORIES : SKILL_CATEGORIES
  const entries = useMemo(() => filterEntries(view?.entries || [], { kind, category, query, sort, lang }), [view, kind, category, query, sort, lang])
  if (!api) return <Page title={s('المهارات والإضافات', 'Skills & Plugins')}><Banner tone="error">{s('الخدمة غير متاحة في هذه النافذة.', 'The service is not available in this window.')}</Banner></Page>
  const card = (entry: CatalogEntry) => <MarketCard key={entry.id + '@' + entry.version} entry={entry} onDetails={() => setDetails(entry)} onInstall={() => { void act(() => preparePackage(entry)) }} onUse={() => onUse(entry)} />
  const names: Record<string, [string, string]> = { ...CATEGORY_NAMES, installed: kind === 'skill' ? ['تمت الإضافة', 'Added'] : ['مثبت', 'Installed'] }
  return <div className="mk" data-hub-kind={kind}>
    <div className="mk-top" role="tablist" aria-label={s('النوع', 'Kind')}>{(['plugin', 'skill'] as const).map(value => <button type="button" role="tab" key={value} aria-selected={kind === value} className={kind === value ? 'on' : ''} onClick={() => { setKind(value); setCategory('installed') }} data-hub-tab={value}>{value === 'plugin' ? s('المكونات الإضافية', 'Plugins') : s('المهارات', 'Skills')}</button>)}</div>
    <div className="mk-col">
      <header className="mk-head"><div><h1>{kind === 'plugin' ? s('المكونات الإضافية', 'Plugins') : s('المهارات', 'Skills')}</h1><p>{kind === 'plugin' ? s('اربط الأدوات الخارجية بنجد ليتمكن من استخدام التطبيقات والخدمات لإكمال المهام.', 'Connect external tools so NAJD can use apps and services to finish tasks.') : s('حوّل خبراتك إلى مهارات يمكنك إعادة استخدامها في أي وقت.', 'Turn your know-how into skills you can reuse any time.')}</p></div>
        <div className="mk-tools"><label className="mk-search"><SearchIcon size={14} aria-hidden /><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder={kind === 'plugin' ? s('البحث عن إضافات', 'Search plugins') : s('البحث عن مهارات', 'Search skills')} aria-label={s('بحث', 'Search')} /></label>
          <div className="w-menu-box"><button type="button" className="mk-pill strong" aria-expanded={menu} onClick={() => setMenu(value => !value)} data-hub="add">{kind === 'plugin' ? s('إضافة جديدة', 'Add new') : s('المهارات المخصصة', 'Custom skills')}<ChevronDown size={13} aria-hidden /></button>
            {menu && <div className="w-menu end" role="menu">
              <MenuItem icon={Plus} onClick={() => { setMenu(false); setAdding(true) }}>{s('من ملف أو مصدر سوق أو هذا الجهاز', 'From a file, a market source or this computer')}</MenuItem>
              {kind === 'skill' && onPrompt && <MenuItem icon={Wand2} onClick={() => { setMenu(false); onPrompt(s('أنشئ لي مهارة جديدة باستخدام najd-skill-creator تفعل: ', 'Create a new skill with najd-skill-creator that does: ')) }}>{s('إنشاء مهارة بالمحادثة', 'Create a skill in chat')}</MenuItem>}
              {kind === 'skill' && <MenuItem icon={FolderOpen} onClick={() => { setMenu(false); void api.openSkillsFolder() }}>{s('مجلد المهارات المحلية', 'Local skills folder')}</MenuItem>}
              <MenuItem icon={RefreshCw} disabled={syncing} onClick={() => { setMenu(false); void sync() }}>{syncing ? s('يزامن…', 'Syncing…') : s('مزامنة السوق', 'Sync the market')}</MenuItem>
              <div className="mk-sort"><span>{s('الترتيب', 'Sort')}</span><select className="w-select" aria-label={s('الترتيب', 'Sort')} value={sort} onChange={event => setSort(event.target.value as SortKey)}><option value="relevance">{s('الأنسب', 'Relevance')}</option><option value="name">{s('الاسم', 'Name')}</option><option value="downloads">{s('الأكثر تنزيلًا', 'Downloads')}</option></select></div>
            </div>}</div></div></header>
      {kind === 'skill' && onPrompt && <div className="mk-banner"><div className="mk-banner-art" aria-hidden><FileText size={22} /></div><div><strong>{s('تحويل مستندات Office إلى مهارات', 'Turn Office documents into skills')}</strong><small>{s('حوّل المستندات إلى مهارات لإعادة إنشاء أنماطها بسهولة.', 'Turn documents into skills that recreate their style.')}</small></div><span className="w-grow" /><button type="button" className="mk-pill strong" onClick={() => onPrompt(s('حوّل هذا المستند إلى مهارة قابلة لإعادة الاستخدام باستخدام najd-skill-creator (أرفقت المستند): ', 'Turn the attached document into a reusable skill with najd-skill-creator: '))}>{s('تحويل', 'Convert')}</button></div>}
      <CategoryPills categories={categories} value={category} names={names} onChange={setCategory} />
      {failure && <Banner tone="error">{failure}</Banner>}
      {view?.state === 'no-source' && <Banner action={<Button onClick={() => setAdding(true)}>{s('إضافة مصدر', 'Add a source')}</Button>}>{s('لا يوجد مصدر سوق مضبوط بعد. عناصر السوق وصف فقط ولا يمكن تثبيتها.', 'No marketplace source is set up yet; marketplace items are descriptions only.')}</Banner>}
      {view?.state === 'offline' && <Banner tone="warn">{s('تعذر الوصول إلى بعض المصادر؛ يعرض نجد آخر نسخة كاملة محفوظة.', 'Some sources could not be reached; NAJD shows the last complete snapshot.')}</Banner>}
      {view?.state === 'online' && <small className="h-sync" data-hub="synced">{s(`تمت قراءة ${view.pagesRead} صفحة من كل الفئات`, `${view.pagesRead} pages read across every category`)}</small>}
      {!view ? <Skeleton rows={6} /> : category === 'installed' && !query.trim() ? <SectionedList entries={view.entries} kind={kind} categories={categories} names={names} render={card} onShowAll={setCategory} />
        : entries.length === 0 ? <Empty icon={Blocks} title={s('لا توجد نتائج', 'Nothing found')} body={s('جرب فئة أو كلمة أخرى.', 'Try another category or word.')} />
        : <div className="mk-grid" data-hub="grid">{entries.map(card)}</div>}
    </div>
    {details && <Dialog title={nameOf(details, lang)} onClose={() => setDetails(null)}><div className="h-details" data-hub="details">
      <p dir="auto">{descriptionOf(details, lang)}</p>
      <Row title={s('الحالة', 'State')} hint={reasonText(details.reason, lang)}><Badge tone={tone(details)}>{stateLabel(details.state, lang)}</Badge></Row>
      <Row title={s('المعرف والإصدار', 'ID and version')}><code dir="ltr">{details.id}@{details.version}</code></Row>
      <Row title={s('الناشر', 'Publisher')}><span dir="auto">{details.publisher.name}</span></Row>
      <Row title={s('الطبقة', 'Layer')}>{details.layer}</Row>
      {(details.mcpServers || []).map(server => <Row key={server.name} title={'MCP · ' + server.name} hint={server.url}><Button onClick={() => { void act(async () => { const state = await api.connectPackageMcp(details.id, server.name); if (state.state !== 'connected' && state.status !== 'cancelled') { setSignin(details); throw new Error(state.error || 'MCP_NOT_CONNECTED') } }) }}>{s('ربط الخادم', 'Connect server')}</Button></Row>)}
      <Section title={s('الصلاحيات', 'Permissions')}>{details.permissions.length ? details.permissions.map(item => <Row key={item.id} title={item.id} hint={item.reason}><ShieldCheck size={15} aria-hidden /></Row>) : <small>{s('لا تعلن صلاحيات.', 'Declares no permissions.')}</small>}</Section>
      {details.layer === 'builtin' && <Row title={s('مفعلة', 'Enabled')}><Toggle label={s('مفعلة', 'Enabled')} checked={details.state !== 'DISABLED'} onChange={value => { void act(() => api.setBuiltinEnabled(details.id, value)); setDetails(null) }} /></Row>}
      {canManagePackage(details) && <div className="h-actions">
        <Button onClick={() => { void act(() => api.setPackageEnabled(details.id, details.state === 'DISABLED')); setDetails(null) }}>{details.state === 'DISABLED' ? s('تفعيل', 'Enable') : s('تعطيل', 'Disable')}</Button>
        {details.canRollback && <Button icon={RotateCcw} onClick={() => { void act(() => api.rollback(details.id)); setDetails(null) }}>{s('الرجوع للإصدار السابق', 'Roll back')}</Button>}
        <Button variant="danger" icon={Trash2} onClick={() => { if (window.confirm(s('إزالة هذه الحزمة ومهاراتها من نجد؟ يمكنك تثبيتها مرة أخرى من السوق.', 'Remove this package and its skills from NAJD? You can install it again from the market.'))) { void act(() => api.removePackage(details.id)); setDetails(null) } }}>{s('إزالة', 'Remove')}</Button></div>}
    </div></Dialog>}
    {adding && <Dialog title={s('إضافة', 'Add')} onClose={() => setAdding(false)}>
      <Section title={s('استيراد الحزم المحلية', 'Import local packages')} hint={s('يبحث عن حزم المهارات الموجودة على هذا الجهاز، ويحوّلها إلى حزم NAJD محلية ثم يمررها عبر فحص التثبيت نفسه. لا يستورد الحسابات أو المحادثات أو المفاتيح.', 'Finds compatible skill packages already on this computer, converts them into local NAJD packages, and sends them through the same verified install pipeline. Accounts, chats and keys are not imported.')}>
        <Button icon={Download} onClick={() => { void act(async () => { const value = await api.planLocal(); setAdding(false); setLocalPlan(value) }) }} data-hub="local-import">{s('فحص وتجهيز الكل', 'Scan and prepare all')}</Button>
      </Section>
      <Section title={s('حزمة من ملف', 'Package from a file')} hint={s('تُفحص الحزمة ولا يعمل منها شيء قبل موافقتك.', 'The package is checked and nothing in it runs before your approval.')}><Button icon={FolderOpen} onClick={() => { void act(async () => { const value = await api.planFile(); if (value) { setAdding(false); setPlan(value) } }) }} data-hub="file">{s('اختيار ملف', 'Choose a file')}</Button></Section>
      <Section title={s('مصدر سوق', 'Marketplace source')} hint={s('عنوان HTTPS لسجل يقدم صفحات الكتالوج.', 'The HTTPS address of a registry that serves catalog pages.')}>
        <Field label={s('العنوان', 'Address')}><input dir="ltr" value={source} onChange={event => setSource(event.target.value)} placeholder="https://" /></Field>
        <Button variant="primary" disabled={!source.trim()} onClick={() => { void act(async () => { await api.addSource(source); setSource(''); await sync() }) }}>{s('إضافة ومزامنة', 'Add and sync')}</Button>
        {(view?.removableSources || []).map(item => <Row key={item} title={item}><IconButton label={s('إزالة', 'Remove')} icon={Trash2} onClick={() => { void act(() => api.removeSource(item)) }} /></Row>)}
      </Section></Dialog>}
    {signin && <AccountLink entry={signin} onClose={() => setSignin(null)} onDone={() => { setSignin(null); void load() }} />}
    {plan && <Dialog title={s('مراجعة التثبيت', 'Review the install')} onClose={() => setPlan(null)} footer={<><Button onClick={() => setPlan(null)}>{s('إلغاء', 'Cancel')}</Button><Button variant="primary" data-hub="install" onClick={() => { const id = plan.planId, packageId = plan.id; setPlan(null); void act(async () => { await api.install(id); const fresh = await api.catalog(); const entry = fresh.entries.find(item => item.id === packageId); if (entry?.mcpServers?.length) setSignin(entry) }) }}>{plan.currentVersion ? s('تحديث', 'Update') : s('تثبيت', 'Install')}</Button></>}>
      <Row title={plan.displayName} hint={plan.description}><code dir="ltr">{plan.currentVersion ? plan.currentVersion + ' → ' : ''}{plan.version}</code></Row>
      <Row title={s('الناشر', 'Publisher')}>{plan.publisher.name}</Row><Row title={s('الترخيص', 'License')}>{plan.license.spdx || s('غير محدد', 'Not stated')}</Row>
      <Section title={s('الصلاحيات المطلوبة', 'Requested permissions')}>{plan.permissions.length ? plan.permissions.map(item => <Row key={item.id} title={item.id} hint={item.reason} />) : <small>{s('لا شيء.', 'None.')}</small>}</Section>
      {plan.executables.length > 0 && <Banner tone="warn">{s('تحتوي الحزمة ملفات تنفيذية: ', 'The package contains executables: ')}<code dir="ltr">{plan.executables.join(', ')}</code></Banner>}
      {plan.dependencies.some(item => item.satisfied === false) && <Banner tone="warn">{s('بعض الاعتماديات غير مثبتة؛ ستكون الحزمة غير جاهزة حتى تُثبت.', 'Some dependencies are missing; the package stays not ready until they are installed.')}</Banner>}
    </Dialog>}
    {localPlan && <Dialog title={s('مراجعة الاستيراد المحلي', 'Review local import')} onClose={() => setLocalPlan(null)} footer={<><Button onClick={() => setLocalPlan(null)}>{s('إلغاء', 'Cancel')}</Button><Button variant="primary" data-hub="install-local" onClick={() => { const id = localPlan.planId; setLocalPlan(null); void act(async () => { const result = await api.installLocal(id); if (result.failed.length) throw new Error(`LOCAL_IMPORT_PARTIAL: ${result.failed.map(item => item.id + ':' + item.code).join(', ')}`) }) }}>{s(`تثبيت ${localPlan.count} حزمة`, `Install ${localPlan.count} packages`)}</Button></>}>
      <Banner>{s('ستُثبت نسخ محلية باسم NAJD مع الاحتفاظ ببيان المصدر والترخيص داخل الحزمة. لن تُنسخ بيانات الحساب أو المحادثات أو رموز الدخول.', 'Local NAJD-named copies will be installed while keeping source and license notices inside each package. Account data, chats and access tokens are not copied.')}</Banner>
      <div className="h-details">{localPlan.packages.map(item => <Row key={item.id} title={item.displayName} hint={`${item.id}@${item.version}`}><Badge tone="neutral">{item.license.spdx || s('محلي', 'Local')}</Badge></Row>)}</div>
    </Dialog>}
  </div>
}

// After installing a package that talks to an online service, the owner links their own account right away. NAJD never borrows another
// app's sign-in; the token goes straight to the protected store.
const TOKEN_PAGES: [RegExp, string, string][] = [[/github/i, 'GitHub', 'https://github.com/settings/personal-access-tokens/new'], [/notion/i, 'Notion', 'https://www.notion.so/profile/integrations'], [/linear/i, 'Linear', 'https://linear.app/settings/account/security'], [/slack/i, 'Slack', 'https://api.slack.com/apps']]
function AccountLink({ entry, onClose, onDone }: { entry: CatalogEntry; onClose: () => void; onDone: () => void }) {
  const { s, lang } = useLang(), api = window.najdWorkstation!
  const [tokens, setTokens] = useState<Record<string, string>>({}), [state, setState] = useState<Record<string, string>>({}), [busy, setBusy] = useState(false)
  const connect = async (name: string) => {
    setBusy(true)
    try { const result = await api.connectPackageMcp(entry.id, name, tokens[name] || ''); setTokens(current => ({ ...current, [name]: '' })); setState(current => ({ ...current, [name]: result.state === 'connected' ? 'connected' : result.error || result.status || 'failed' })) }
    catch (reason) { setState(current => ({ ...current, [name]: String((reason as Error).message || reason).replace(/^Error invoking remote method '[^']+': (Error: )?/, '') })) } finally { setBusy(false) }
  }
  return <Dialog title={s('اربط حسابك', 'Link your account')} onClose={onClose} footer={<><Button onClick={onClose}>{s('لاحقًا', 'Later')}</Button><Button variant="primary" onClick={onDone}>{s('تم', 'Done')}</Button></>}>
    <p>{s(`تتصل «${nameOf(entry, lang)}» بخدمة على الإنترنت. سجّل الدخول في الخدمة، أنشئ رمز وصول بأقل صلاحيات تحتاجها، ثم الصقه هنا. يُحفظ مشفرًا ولا يصل إلى النموذج.`, `"${nameOf(entry, lang)}" talks to an online service. Sign in there, create an access token with the least access you need, then paste it here. It is stored encrypted and never reaches the model.`)}</p>
    {(entry.mcpServers || []).map(server => { const page = TOKEN_PAGES.find(([pattern]) => pattern.test(server.url + server.name)); return <Section key={server.name} title={page ? page[1] : server.name} hint={server.url}>
      {page && <a href={page[2]} target="_blank" rel="noreferrer noopener" data-token-page>{s('افتح صفحة إنشاء الرمز في ', 'Open the token page on ') + page[1]}</a>}
      <div className="s-inline"><input type="password" autoComplete="off" dir="ltr" aria-label={s('رمز الوصول', 'Access token')} value={tokens[server.name] || ''} onChange={event => setTokens({ ...tokens, [server.name]: event.target.value })} />
        <Button variant="primary" disabled={busy} onClick={() => { void connect(server.name) }} data-account-connect>{tokens[server.name] ? s('حفظ واتصال', 'Save and connect') : s('اتصال بدون رمز', 'Connect without a token')}</Button></div>
      {state[server.name] && (state[server.name] === 'connected' ? <Badge tone="green">{s('متصل', 'Connected')}</Badge> : <Banner tone="error">{state[server.name]}</Banner>)}
    </Section> })}
    <small>{s('تسجيل الدخول المباشر عبر OAuth غير متوفر بعد؛ الربط حاليًا برمز وصول.', 'Direct OAuth sign-in is not available yet; linking uses an access token for now.')}</small>
  </Dialog>
}
