import { useEffect, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import type { ProviderControls } from '../useProviders'
import { Badge, Banner, Button, Segmented, useLang } from './ui'

// Models & providers as one list: choosing a provider opens its setup right below it. A service offered both as a subscription and as an
// API key (ChatGPT / OpenAI, Kimi, GLM, Qwen) is one row with both ways to link it. Keys are sent once and cleared from the field.
const FAMILIES: { id: string; name: string; members: string[] }[] = [
  { id: 'openai', name: 'ChatGPT · OpenAI', members: ['chatgpt', 'openai-api'] },
  { id: 'kimi', name: 'Kimi · Moonshot', members: ['kimi-code', 'moonshot-api'] },
  { id: 'glm', name: 'Z.AI · GLM', members: ['zai-coding', 'zai-api'] },
  { id: 'qwen', name: 'Alibaba · Qwen', members: ['alibaba-coding', 'dashscope-api'] },
  { id: 'minimax', name: 'MiniMax', members: ['minimax-plan'] }
]
const clean = (reason: unknown) => String((reason as Error)?.message || reason).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

function Setup({ item, providers }: { item: NajdProvider; providers: ProviderControls }) {
  const { s } = useLang(), api = window.najdProviders!
  const [key, setKey] = useState(''), [busy, setBusy] = useState(false), [failure, setFailure] = useState<string | null>(null), [tested, setTested] = useState<boolean | null>(null)
  const [chatgpt, setChatgpt] = useState<NajdChatGPTStatus | null>(null)
  useEffect(() => { if (item.id === 'chatgpt') void window.najdChatGPT?.status().then(setChatgpt).catch(() => {}) }, [item.id])
  useEffect(() => { if (item.configured && !providers.models[item.id]) void providers.loadModels(item.id) }, [item.id, item.configured])
  const run = async (work: () => Promise<unknown>) => { setBusy(true); setFailure(null); try { await work(); await providers.refresh() } catch (reason) { setFailure(clean(reason)) } finally { setBusy(false) } }
  const models = providers.models[item.id] || [], chosen = providers.choices[item.id] || ''
  return <div className="ps-setup" data-setup={item.id}>
    {failure && <Banner tone="error">{failure}</Banner>}
    {item.id === 'chatgpt' && <div className="ps-step"><strong>{s('اربط اشتراكك', 'Link your subscription')}</strong><small>{s('يفتح المتصفح لتسجيل الدخول في حسابك؛ لا يرى نجد كلمة المرور.', 'Your browser opens to sign in to your account; NAJD never sees the password.')}</small>
      {chatgpt?.accounts.map(account => <div key={account.id} className="ps-line"><bdi>{account.label}</bdi>{account.signedIn ? <Badge tone="green">{s('مسجل', 'Signed in')}</Badge> : <Badge>{s('غير مسجل', 'Signed out')}</Badge>}
        {chatgpt.activeId !== account.id && <Button onClick={() => { void run(async () => setChatgpt(await window.najdChatGPT!.select(account.id))) }}>{s('استخدام', 'Use')}</Button>}
        <Button variant="danger" onClick={() => { void run(async () => setChatgpt(await window.najdChatGPT!.signOut(account.id))) }}>{s('خروج', 'Sign out')}</Button></div>)}
      <div className="ps-line"><Button variant="primary" disabled={busy || chatgpt?.signingIn} onClick={() => { void run(async () => setChatgpt(await window.najdChatGPT!.start())) }} data-provider-signin>{chatgpt?.signingIn ? s('بانتظار تسجيل الدخول…', 'Waiting for sign-in…') : s('تسجيل الدخول', 'Sign in')}</Button>
        {chatgpt?.signingIn && <Button onClick={() => { void run(async () => setChatgpt(await window.najdChatGPT!.cancel())) }}>{s('إلغاء', 'Cancel')}</Button>}</div></div>}
    {(item.auth === 'key' || item.auth === 'optional-key') && <div className="ps-step"><strong>{item.auth === 'optional-key' ? s('مفتاح (اختياري)', 'Key (optional)') : s('مفتاح API', 'API key')}</strong>
      <div className="ps-line"><input type="password" autoComplete="off" dir="ltr" placeholder={item.keySaved ? s('محفوظ، اكتب مفتاحًا جديدًا لاستبداله', 'Saved; type a new key to replace it') : item.keyHint} aria-label={s('مفتاح API', 'API key')} value={key} onChange={event => setKey(event.target.value)} />
        <Button variant="primary" disabled={!key.trim() || busy} onClick={() => { const value = key.trim(); setKey(''); void run(async () => { await api.saveKey(item.id, value); await providers.loadModels(item.id) }) }}>{s('حفظ', 'Save')}</Button>
        {item.keySaved && <Button variant="danger" disabled={busy} onClick={() => { void run(() => api.clearKey(item.id)) }}>{s('مسح', 'Clear')}</Button>}
        {item.kind !== 'local' && <Button variant="ghost" onClick={() => { void api.openConsole(item.id) }}>{s('الحصول على مفتاح', 'Get a key')}</Button>}</div></div>}
    {item.editableUrl && <div className="ps-step"><strong>{s('العنوان', 'Address')}</strong><input dir="ltr" defaultValue={item.endpoint} aria-label={s('العنوان', 'Address')} onBlur={event => { if (event.target.value && event.target.value !== item.endpoint) void run(() => api.setEndpoint(item.id, event.target.value)) }} /></div>}
    {item.configured && <div className="ps-step"><strong>{s('النموذج', 'Model')}</strong>
      <div className="ps-line"><select className="w-select" aria-label={s('النموذج', 'Model')} value={chosen} onChange={event => providers.chooseModel(item.id, event.target.value)}><option value="">{providers.loading[item.id] ? s('يحمّل…', 'Loading…') : providers.errors[item.id] ? s('تعذر جلب النماذج', 'Could not list models') : s('اختر', 'Choose')}</option>{models.map(model => <option key={model.id} value={model.id}>{model.label}</option>)}</select>
        <Button disabled={!chosen || busy} onClick={() => { setTested(null); void run(async () => setTested((await api.testModel(item.id, chosen)).verified)) }}>{s('اختبار', 'Test')}</Button>
        {tested === true && <Badge tone="green">{s('يعمل', 'Works')}</Badge>}{tested === false && <Badge tone="red">{s('لم يرد', 'No answer')}</Badge>}
        <Button variant={providers.provider === item.id ? 'primary' : 'default'} disabled={!chosen} onClick={() => providers.setProvider(item.id)} data-provider-use>{providers.provider === item.id ? <><Check size={14} aria-hidden />{s('المستخدم الآن', 'In use')}</> : s('استخدام في المحادثة', 'Use in chat')}</Button></div></div>}
  </div>
}

export function ProviderSetup({ providers }: { providers: ProviderControls }) {
  const { s } = useLang()
  const [open, setOpen] = useState<string | null>(null)
  const [pick, setPick] = useState<Record<string, string>>({})
  const [filter, setFilter] = useState<'all' | 'subscription' | 'api' | 'local'>('all')
  const grouped = new Set(FAMILIES.flatMap(family => family.members))
  const rows = [...FAMILIES.map(family => ({ id: family.id, name: family.name, items: family.members.map(id => providers.catalog.find(item => item.id === id)).filter((item): item is NajdProvider => !!item) })).filter(row => row.items.length),
    ...providers.catalog.filter(item => !grouped.has(item.id) && item.kind !== 'union').map(item => ({ id: item.id, name: item.name, items: [item] }))]
    .filter(row => filter === 'all' || row.items.some(item => item.kind === filter))
  const status = (items: NajdProvider[]) => items.some(item => item.verified) ? <Badge tone="green">{s('يعمل', 'Working')}</Badge> : items.some(item => item.configured) ? <Badge tone="blue">{s('مربوط', 'Linked')}</Badge> : null
  return <div className="ps" data-providers>
    <Segmented label={s('النوع', 'Kind')} value={filter} onChange={setFilter} options={[{ value: 'all', label: s('الكل', 'All') }, { value: 'subscription', label: s('اشتراك', 'Subscription') }, { value: 'api', label: 'API' }, { value: 'local', label: s('محلي', 'Local') }]} />
    {rows.map(row => {
      const expanded = open === row.id
      const current = row.items.find(item => item.id === pick[row.id]) || row.items.find(item => item.configured) || row.items[0]
      return <div key={row.id} className={'ps-row' + (expanded ? ' open' : '')} data-provider-row={row.id}>
        <button type="button" className="ps-head" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : row.id)}><strong dir="ltr">{row.name}</strong>{row.items.some(item => item.id === providers.provider) && <Badge tone="blue">{s('الحالي', 'Current')}</Badge>}{status(row.items)}<span className="w-grow" /><ChevronDown size={15} aria-hidden data-open={expanded} /></button>
        {expanded && <>{row.items.length > 1 && <Segmented label={s('طريقة الربط', 'How to link')} value={current.id} onChange={id => setPick({ ...pick, [row.id]: id })} options={row.items.map(item => ({ value: item.id, label: item.kind === 'subscription' ? s('اشتراك', 'Subscription') : 'API' }))} />}
          <Setup key={current.id} item={current} providers={providers} /></>}
      </div>
    })}
  </div>
}
