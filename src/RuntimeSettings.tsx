import { useEffect, useState } from 'react'
import { HardDrive } from 'lucide-react'
import { CardHeading } from './ui'

const errors: Record<string, [string, string]> = {
  RUNTIME_DOWNLOAD_FAILED: ['تعذّر التنزيل. تأكد من الاتصال وحاول مرة أخرى.', 'Download failed. Check your connection and retry.'],
  RUNTIME_SIGNATURE_INVALID: ['الملف لا يطابق التوقيع المعتمد، فتم رفضه.', 'The file did not match the signed catalog and was rejected.'],
  RUNTIME_MANIFEST_INVALID: ['قائمة المكونات غير صالحة.', 'The component catalog is invalid.'],
  RUNTIME_ARCHIVE_INVALID: ['حزمة المكون غير صالحة.', 'A component archive is invalid.'],
  RUNTIME_HEALTH_FAILED: ['فشل فحص سلامة المكون؛ بقيت النسخة السابقة كما هي.', 'A health check failed; the previous version was kept.'],
  SETUP_ACTIVATION_BUSY: ['نجد مشغول بمهمة. سيتم التفعيل عند إعادة المحاولة بعد انتهائها.', 'NAJD is busy with a task. Retry after it finishes to activate.'],
  INCOMPATIBLE_RUNTIME: ['هذه المكونات تحتاج نسخة أحدث من نجد.', 'These components need a newer NAJD version.'],
  SETUP_STORE_UNAVAILABLE: ['مجلد المكونات غير متاح أو غير مملوك لنجد؛ لم يُحذف شيء.', 'The component folder is unavailable or not owned by NAJD; nothing was deleted.']
}

const componentNames: Record<string, [string, string]> = {
  engine: ['محرك الوكيل', 'Agent engine'], gateway: ['البوابة', 'Gateway'], node: ['بيئة Node', 'Node runtime'],
  dotnet: ['بيئة .NET', '.NET runtime'], 'desktop-host': ['التحكم بسطح المكتب', 'Desktop control']
}

export function useRuntimeStatus() {
  const [status, setStatus] = useState<NajdRuntimeStatus | null>(null)
  useEffect(() => {
    let alive = true, timer: ReturnType<typeof setTimeout>
    const refresh = async () => {
      try { const value = await window.najdRuntime?.status(); if (alive && value) setStatus(value) } catch { /* window closing */ }
      if (alive) timer = setTimeout(() => { void refresh() }, 1000)
    }
    void refresh()
    return () => { alive = false; clearTimeout(timer) }
  }, [])
  return status
}

// First-run unpacking of the components shipped in the installer, shown as it happens.
function BundleProgress({ status, ar }: { status: NajdRuntimeStatus; ar: boolean }) {
  const percent = status.total ? Math.min(100, Math.round(status.downloaded / status.total * 100)) : 0
  const name = status.component ? componentNames[status.component] : null
  if (status.state === 'ready') return <p className="runtime-line">{ar ? 'كل مكونات نجد مضمّنة مع التثبيت وجاهزة؛ لا يحتاج أي تنزيل أو برنامج إضافي.' : 'All NAJD components ship with the installation and are ready; nothing else is downloaded or installed.'}</p>
  if (status.state === 'failed') return <><p role="alert">{ar ? 'تعذّر تجهيز مكونات نجد. ملفات التثبيت سليمة؛ أعد المحاولة، وإن تكرر أعد تثبيت نجد.' : 'NAJD could not prepare its components. Retry; if it repeats, reinstall NAJD.'}</p>
    <div className="browser-actions"><button type="button" className="browser-action" onClick={() => { void window.najdRuntime!.prepare() }}>{ar ? 'إعادة المحاولة' : 'Retry'}</button></div></>
  return <div className="runtime-progress" role="status">
    <p className="runtime-line">{ar ? 'تجهيز مكونات نجد لأول مرة' : 'Preparing NAJD components for first use'}{name ? ' · ' + (ar ? name[0] : name[1]) : ''} · {percent}%</p>
    <progress max={100} value={percent} />
    <p className="runtime-line">{ar ? 'يمكنك استخدام المحادثة الآن؛ الأدوات المحلية والويب تتفعّل تلقائيًا عند الانتهاء.' : 'You can chat now; local and web tools turn on automatically when this finishes.'}</p>
  </div>
}

export function RuntimeBanner({ language }: { language: 'ar' | 'en' }) {
  const status = useRuntimeStatus(), ar = language === 'ar'
  if (!status?.bundled || status.state === 'ready') return null
  return <div className="runtime-banner"><BundleProgress status={status} ar={ar} /></div>
}

export function RuntimeSettings({ language }: { language: 'ar' | 'en' }) {
  const ar = language === 'ar'
  const status = useRuntimeStatus()
  if (!window.najdRuntime || !status) return null
  const running = ['validating', 'downloading', 'verifying', 'preparing', 'checking', 'activating'].includes(status.state)
  const phase: Record<string, [string, string]> = {
    validating: ['التحقق من القائمة الموقّعة', 'Verifying the signed catalog'], downloading: ['تنزيل', 'Downloading'],
    verifying: ['التحقق من الملف', 'Verifying file'], preparing: ['تجهيز', 'Preparing'], checking: ['فحص السلامة', 'Health check'],
    activating: ['تفعيل', 'Activating'], ready: ['جاهزة', 'Ready'], cancelled: ['أُلغي', 'Cancelled'], failed: ['تعذّر', 'Failed'], idle: ['', '']
  }
  const percent = status.total ? Math.round(status.downloaded / status.total * 100) : 0
  const pick = (pair: [string, string]) => ar ? pair[0] : pair[1]
  return <section className="browser-card runtime-card" data-runtime-state={status.state}>
    <CardHeading icon={HardDrive} title={ar ? 'مكونات نجد المحلية' : 'NAJD local components'}
      hint={ar ? 'نجد يجهّز تلقائيًا بيئة التشغيل المثبتة والموقّعة للوكيل، بدون Python أو برامج أخرى من جهازك.' : 'NAJD prepares its pinned, signed agent runtime automatically, without your own Python or other programs.'} />
    {status.bundled ? <BundleProgress status={status} ar={ar} />: <>
    <p className="runtime-line">{status.active
      ? (ar ? `النسخة المفعّلة: ${status.active.catalogVersion} (${status.active.components.join(', ')})` : `Active: ${status.active.catalogVersion} (${status.active.components.join(', ')})`)
      : (ar ? 'لا توجد مكونات مفعّلة بعد.' : 'No components are active yet.')}</p>
    {running && <p className="runtime-line" role="status">{pick(phase[status.state])}{status.component ? ` · ${status.component}` : ''}{status.state === 'downloading' ? ` · ${percent}%` : ''}</p>}
    {running && status.state === 'downloading' && <progress max={100} value={percent} />}
    {status.state === 'failed' && <p role="alert">{status.notPublished
      ? (ar ? 'حزمة المكونات لهذا الإصدار لم تُنشر بعد. ستعمل الميزات الحالية، وستُجهّز المكونات تلقائيًا عند نشرها.' : 'The component pack for this version is not published yet. Current features keep working; components prepare once published.')
      : pick(errors[status.error || ''] || ['تعذّر التجهيز.', 'Preparation failed.'])}</p>}
    {status.state === 'ready' && <p className="runtime-line">{ar ? 'تم التحقق والتفعيل.' : 'Verified and activated.'}</p>}
    <div className="browser-actions">
      {running ? <button type="button" className="browser-action" disabled={!status.canCancel} onClick={() => { void window.najdRuntime!.cancel() }}>{ar ? 'إلغاء' : 'Cancel'}</button>
        : <button type="button" className="browser-action" onClick={() => { void window.najdRuntime!.prepare().catch(() => {}) }}>
          {status.active ? (ar ? 'تحقق من التحديثات' : 'Check again') : status.state === 'failed' || status.state === 'cancelled' ? (ar ? 'إعادة المحاولة' : 'Retry') : (ar ? 'تجهيز الآن' : 'Prepare now')}</button>}
    </div></>}
  </section>
}
