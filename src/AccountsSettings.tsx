import { useCallback, useEffect, useState } from 'react'
import { KeyRound, Plus, ShieldCheck, Trash2 } from 'lucide-react'
import './accounts.css'

type Language = 'ar' | 'en'
const ERROR_AR: Record<string, string> = {
  INVALID_INPUT: 'تحقق من البيانات: الموقع يجب أن يكون عنوان https، والاسم وكلمة المرور مطلوبان.', ACCOUNT_EXISTS: 'هذا الحساب مضاف لهذا الموقع من قبل.', ACCOUNT_LIMIT: 'وصلت للحد الأقصى من الحسابات.',
  CREDENTIAL_STORE_UNAVAILABLE: 'تعذّر الوصول لمدير بيانات اعتماد Windows.', CREDENTIAL_STORE_FAILED: 'تعذّر حفظ كلمة المرور في مدير بيانات اعتماد Windows.', ACCOUNT_STORE_UNAVAILABLE: 'ملف الحسابات تالف؛ لم يُغيَّر.'
}
const ERROR_EN: Record<string, string> = {
  INVALID_INPUT: 'Check the fields: the site must be an https address, and the username and password are required.', ACCOUNT_EXISTS: 'This account is already added for this site.', ACCOUNT_LIMIT: 'The account limit has been reached.',
  CREDENTIAL_STORE_UNAVAILABLE: 'Windows Credential Manager is not reachable.', CREDENTIAL_STORE_FAILED: 'The password could not be saved in Windows Credential Manager.', ACCOUNT_STORE_UNAVAILABLE: 'The accounts file is damaged; it was left unchanged.'
}
const codeOf = (failure: unknown) => { const text = String((failure as { message?: string })?.message || ''); return /[A-Z_]{4,}/.exec(text)?.[0] || 'ERROR' }

// Settings > Accounts: the sites the user lets NAJD sign in to. The password is typed here once, goes to Windows Credential Manager and is
// never shown again, never sent to a model and never written to chats or logs. Revoking removes the authorization and the saved password.
export function AccountsSettings({ language, busy }: { language: Language; busy: boolean }) {
  const ar = language === 'ar'
  const [accounts, setAccounts] = useState<NajdAccount[] | null>(null)
  const [form, setForm] = useState({ label: '', siteUrl: '', username: '', password: '', autoLogin: false })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)
  // Revoked accounts whose saved password could not be deleted yet (retried automatically; the user can retry too).
  const [pending, setPending] = useState<NajdAccount[]>([])
  const api = window.najdAccounts
  const reload = useCallback(async () => { try { setAccounts(api ? await api.list() : []); setPending(api ? await api.pending() : []) } catch { setAccounts([]); setError('ACCOUNT_STORE_UNAVAILABLE') } }, [api])
  useEffect(() => { void reload() }, [reload])
  if (!api) return null
  const message = (code: string) => (ar ? ERROR_AR : ERROR_EN)[code] || (ar ? 'تعذّرت العملية.' : 'The operation failed.')
  const add = async (event: React.FormEvent) => {
    event.preventDefault()
    if (saving || busy) return
    setSaving(true); setError(null)
    try {
      await api.add(form)
      setForm({ label: '', siteUrl: '', username: '', password: '', autoLogin: false }) // the password does not stay in the page
      await reload()
    } catch (failure) { setError(codeOf(failure)); setForm(current => ({ ...current, password: '' })) } finally { setSaving(false) }
  }
  const stamp = (value: string | null) => value ? new Date(value).toLocaleString(ar ? 'ar-SA' : 'en-GB') : (ar ? 'لم يُستخدم بعد' : 'Not used yet')
  return <section className="accounts" aria-label={ar ? 'الحسابات المفوّضة' : 'Authorized accounts'}>
    <p className="accounts-intro"><ShieldCheck size={16} aria-hidden="true" />{ar
      ? 'الحسابات التي تسمح لنجد بتسجيل الدخول إليها نيابةً عنك. تُحفظ كلمة المرور في مدير بيانات اعتماد Windows فقط، ولا تصل إلى نموذج الذكاء الاصطناعي ولا إلى المحادثات أو السجلات. تغيير كلمات المرور والدفع وحذف الحسابات تبقى بموافقتك دائمًا.'
      : 'Accounts you let NAJD sign in to for you. The password is kept only in Windows Credential Manager and never reaches the AI model, chats or logs. Changing passwords, paying and deleting accounts always need your approval.'}</p>
    <form className="accounts-form" onSubmit={event => { void add(event) }} autoComplete="off">
      <h3><Plus size={15} aria-hidden="true" />{ar ? 'إضافة حساب وتفويضه' : 'Add and authorize an account'}</h3>
      <label>{ar ? 'اسم للحساب' : 'Name'}<input value={form.label} maxLength={60} onChange={event => setForm({ ...form, label: event.target.value })} placeholder={ar ? 'مثال: بريدي الشخصي' : 'e.g. My personal mail'} /></label>
      <label>{ar ? 'الموقع (https)' : 'Site (https)'}<input dir="ltr" value={form.siteUrl} maxLength={300} onChange={event => setForm({ ...form, siteUrl: event.target.value })} placeholder="https://mail.example.com" required /></label>
      <label>{ar ? 'اسم المستخدم أو البريد' : 'Username or email'}<input dir="ltr" value={form.username} maxLength={320} onChange={event => setForm({ ...form, username: event.target.value })} autoComplete="off" required /></label>
      <label>{ar ? 'كلمة المرور' : 'Password'}<input dir="ltr" type="password" value={form.password} maxLength={1000} onChange={event => setForm({ ...form, password: event.target.value })} autoComplete="new-password" required /></label>
      <label className="accounts-check"><input type="checkbox" checked={form.autoLogin} onChange={event => setForm({ ...form, autoLogin: event.target.checked })} />
        {ar ? 'تسجيل دخول تلقائي بدون سؤالي كل مرة' : 'Sign in automatically without asking each time'}</label>
      {error && <p className="accounts-error" role="alert">{message(error)}</p>}
      <button type="submit" className="accounts-save" disabled={saving || busy}><KeyRound size={14} aria-hidden="true" />{saving ? (ar ? 'جارٍ الحفظ…' : 'Saving…') : (ar ? 'حفظ وتفويض' : 'Save and authorize')}</button>
    </form>
    {pending.length > 0 && <p className="accounts-error" role="alert">{ar ? `ألغيتَ ${pending.length} حساب لكن لم تُحذف كلمة مروره المحفوظة بعد من مدير بيانات اعتماد Windows. تُعاد المحاولة تلقائيًا.` : `${pending.length} revoked account(s) still have a saved password that Windows Credential Manager has not deleted yet. NAJD retries automatically.`} <button type="button" disabled={busy} onClick={() => { void api.retry().then(setPending).catch(() => setError('CREDENTIAL_STORE_UNAVAILABLE')) }}>{ar ? 'إعادة المحاولة الآن' : 'Retry now'}</button></p>}
    {pending.some(account => account.unresolved) && <p className="accounts-error" role="alert">{ar ? 'انقطع إلغاء حساب قبل تسجيل اكتماله، فقد يعرض تبويب مفتوح كلمة مروره ولا يمكن إخفاؤها. أغلق تبويبات هذا الموقع أو حدّثها ثم أكّد. وإلى حين ذلك لا يقرأ نجد الصفحات.' : 'A revocation was interrupted before it was recorded as finished, so an open tab may still show its password and it cannot be masked. Close or refresh the tabs of that site, then confirm. Until then NAJD does not read pages.'} <button type="button" disabled={busy} onClick={() => { void (async () => { let list = pending; for (const account of pending.filter(item => item.unresolved)) list = await api.acknowledge(account.id); setPending(list) })().catch(() => setError('ACCOUNT_STORE_UNAVAILABLE')) }}>{ar ? 'أغلقت التبويبات، أكّد' : 'Tabs closed, confirm'}</button></p>}
    <h3 className="accounts-list-title">{ar ? 'الحسابات المفوّضة' : 'Authorized accounts'}</h3>
    {accounts === null ? <p className="accounts-empty">{ar ? 'جاري القراءة…' : 'Loading…'}</p>
      : accounts.length === 0 ? <p className="accounts-empty">{ar ? 'لم تفوّض أي حساب بعد.' : 'No account authorized yet.'}</p>
        : <ul className="accounts-list">{accounts.map(account => <li key={account.id}>
          <div className="accounts-main"><strong dir="auto">{account.label}</strong><bdi dir="ltr">{account.username} · {account.host}</bdi>
            <small>{ar ? 'آخر استخدام: ' : 'Last used: '}{stamp(account.lastUsedAt)}</small></div>
          <label className="accounts-check"><input type="checkbox" checked={account.autoLogin} disabled={busy}
            onChange={event => { void api.setAutoLogin(account.id, event.target.checked).then(reload).catch(() => setError('ACCOUNT_STORE_UNAVAILABLE')) }} />
            {ar ? 'دخول تلقائي' : 'Auto sign-in'}</label>
          {confirming === account.id
            ? <span className="accounts-confirm"><button type="button" className="danger" disabled={busy} onClick={() => { void api.remove(account.id).then(() => { setConfirming(null); return reload() }).catch(failure => { setConfirming(null); setError(codeOf(failure)); void reload() }) }}>
              {ar ? 'تأكيد الإلغاء وحذف كلمة المرور' : 'Confirm: revoke and delete the password'}</button>
              <button type="button" onClick={() => setConfirming(null)}>{ar ? 'تراجع' : 'Cancel'}</button></span>
            : <button type="button" className="accounts-remove" disabled={busy} onClick={() => setConfirming(account.id)} aria-label={(ar ? 'إلغاء تفويض ' : 'Revoke ') + account.label}><Trash2 size={14} aria-hidden="true" />{ar ? 'إلغاء التفويض' : 'Revoke'}</button>}
        </li>)}</ul>}
  </section>
}
