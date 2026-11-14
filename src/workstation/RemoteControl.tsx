import { useCallback, useEffect, useMemo, useState } from 'react'
import { Smartphone, Trash2 } from 'lucide-react'
import QRCode from 'qrcode-generator'
import type { RemoteStatus } from './types'
import { Badge, Banner, Button, Empty, IconButton, Page, Row, Section, Skeleton, Toggle, useLang } from './ui'

const SCOPES: { id: string; ar: string; en: string }[] = [{ id: 'status', ar: 'متابعة التقدم', en: 'Check progress' }, { id: 'instruct', ar: 'إضافة تعليمات', en: 'Add instructions' }, { id: 'resume', ar: 'استئناف العمل', en: 'Resume work' }]

function Qr({ text }: { text: string }) {
  const svg = useMemo(() => { const qr = QRCode(0, 'M'); qr.addData(text); qr.make(); return qr.createDataURL(5, 8) }, [text])
  return <img className="r-qr" src={svg} alt={text} width={180} height={180} />
}
export function RemoteControl() {
  const { s, ar, lang } = useLang(), api = window.najdWorkstation
  const [status, setStatus] = useState<RemoteStatus | null>(null)
  const [scopes, setScopes] = useState<string[]>(['status'])
  const [failure, setFailure] = useState<string | null>(null)
  const load = useCallback(async () => { try { if (api) setStatus(await api.remote()) } catch { setFailure('REMOTE') } }, [api])
  useEffect(() => { void load(); return api?.onChanged(kind => { if (kind === 'remote') void load() }) }, [load, api])
  const act = async (work: () => Promise<RemoteStatus>) => { setFailure(null); try { setStatus(await work()) } catch (reason) { setFailure(String((reason as Error).message).split(': ').pop() || 'FAILED') } }
  if (!status || !api) return <Page title={s('التحكم عن بعد', 'Remote Control')}><Skeleton /></Page>
  const url = status.port ? `http://${status.address}:${status.port}/` : null
  return <Page title={s('التحكم عن بعد', 'Remote Control')} intro={s('اربط جهازًا برمز لمرة واحدة وصلاحيات محددة يمكن سحبها. لا تصل بيانات الدخول إلى النموذج.', 'Pair a device with a one-time code and scoped, revocable access. Credentials never reach the model.')}>
    {failure && <Banner tone="error">{failure}</Banner>}
    <Section title={s('السماح', 'Access')}>
      <Row title={s('السماح بالتحكم عن بعد', 'Allow remote control')} hint={s('متوقف افتراضيًا. عند الإيقاف لا يستمع نجد لأي اتصال.', 'Off by default. When off, NAJD listens for nothing.')}><Toggle label={s('السماح بالتحكم عن بعد', 'Allow remote control')} checked={status.enabled} onChange={enabled => { void act(() => api.remoteConfigure({ enabled })) }} /></Row>
      <Row title={s('الشبكة المحلية', 'Local network')} hint={s('يعمل على هذا الجهاز فقط ما لم تفعل هذا. الاتصال داخل الشبكة غير مشفر، ففعله على شبكة تثق بها فقط.', 'Works on this computer only unless you turn this on. Traffic on the network is not encrypted, so use it only on a network you trust.')}><Toggle label={s('الشبكة المحلية', 'Local network')} checked={status.lan} disabled={!status.enabled} onChange={value => { void act(() => api.remoteConfigure({ lan: value })) }} /></Row>
      <Row title={s('إبقاء الحاسوب مستيقظًا', 'Keep the computer awake')} hint={s('يمنع السكون التلقائي ما دام التحكم عن بعد مفعلًا؛ تنطفئ الشاشة كالمعتاد ويزيد استهلاك الطاقة.', 'Prevents automatic sleep while remote control is on; the screen still turns off and power use rises.')}><Toggle label={s('إبقاء الحاسوب مستيقظًا', 'Keep the computer awake')} checked={status.keepAwake} disabled={!status.enabled} onChange={keepAwake => { void act(() => api.remoteConfigure({ keepAwake })) }} /></Row>
    </Section>
    {status.enabled && <Section title={s('ربط جهاز', 'Pair a device')} hint={s('افتح العنوان من الجهاز، ثم أدخل الرمز خلال خمس دقائق.', 'Open the address on the device, then enter the code within five minutes.')}>
      <div className="r-scopes" role="group" aria-label={s('الصلاحيات', 'Permissions')}>{SCOPES.map(scope => <label key={scope.id}><input type="checkbox" checked={scopes.includes(scope.id)} onChange={event => setScopes(event.target.checked ? [...scopes, scope.id] : scopes.filter(item => item !== scope.id))} />{ar ? scope.ar : scope.en}</label>)}</div>
      <Button variant="primary" disabled={!scopes.length} onClick={() => { void act(() => api.remotePair(scopes)) }} data-remote="pair">{s('إنشاء رمز ربط', 'Create a pairing code')}</Button>
      {status.pairing && url && <div className="r-pair"><Qr text={url} /><div><code dir="ltr" data-remote="url">{url}</code><strong className="r-code" dir="ltr" data-remote="code">{status.pairing.code}</strong></div></div>}
    </Section>}
    <Section title={s('الأجهزة', 'Devices')}>{status.devices.length === 0 ? <Empty icon={Smartphone} title={s('لا توجد أجهزة مربوطة', 'No paired devices')} /> : status.devices.map(device => <Row key={device.id} title={device.name} hint={s('آخر ظهور: ', 'Last seen: ') + new Date(device.lastSeenAt).toLocaleString(lang === 'ar' ? 'ar-SA' : 'en-US')}>{device.scopes.map(scope => <Badge key={scope}>{scope}</Badge>)}<IconButton label={s('سحب', 'Revoke')} icon={Trash2} onClick={() => { void act(() => api.remoteRevoke(device.id)) }} /></Row>)}</Section>
    <Section title={s('السجل', 'Audit trail')}>{status.audit.length === 0 ? <small>{s('لا شيء بعد.', 'Nothing yet.')}</small> : <ol className="r-audit">{status.audit.map((entry, index) => <li key={index}><time>{new Date(entry.at).toLocaleString(lang === 'ar' ? 'ar-SA' : 'en-US')}</time><code dir="ltr">{entry.action}</code><bdi>{entry.device}</bdi></li>)}</ol>}</Section>
  </Page>
}
