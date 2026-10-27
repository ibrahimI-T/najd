import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Bot, CheckCircle2, CircleDashed, KeyRound, ShieldCheck, Slash } from 'lucide-react'

export const welcomeKey = 'najd.welcome.v1'
export const welcomeSeen = () => { try { const value = localStorage.getItem(welcomeKey); return window.najdAutomation ? value !== 'force' : value === '1' } catch { return true } }
export const markWelcomeSeen = () => { try { localStorage.setItem(welcomeKey, '1') } catch { /* private mode: it shows again next time */ } }

const TEXT = {
  ar: {
    title: 'أهلًا بك في نجد', lead: 'وكيل يعمل على جهازك بأدوات حقيقية. أربع خطوات قصيرة لتبدأ، وكلها اختيارية.',
    steps: [
      { icon: KeyRound, title: 'اربط نموذجًا', body: 'اختر ChatGPT أو مفتاح API أو نموذجًا محليًا. بدون نموذج لا يستطيع نجد الرد.' },
      { icon: ShieldCheck, title: 'أنت تتحكم بالصلاحيات', body: 'في أسفل الرسالة تختار: اسألني عن كل خطوة، أو وافق على الآمن، أو وصول كامل. كلمات المرور والمدفوعات تبقى لك دائمًا.' },
      { icon: Slash, title: 'اكتب / لترى الأوامر', body: 'محادثة جديدة، فتح الصفحات، الصلاحيات، نوع المهمة، المهارات. لا يُرسل شيء قبل أن تضغط إرسال.' },
      { icon: Bot, title: 'جرّب مهمة آمنة', body: 'مثلًا: «لخّص لي هذا الملف» بعد إرفاقه، أو «افتح الآلة الحاسبة». كل إجراء يظهر لك خطوة بخطوة.' }
    ],
    connect: 'ربط نموذج الآن', later: 'ابدأ بدون ربط', privacy: 'لا يُرسل نجد شيئًا إلى أحد بدون اختيارك، ومحادثاتك تبقى على جهازك.',
    check: 'فحص سريع', model: 'النموذج', modelOn: (name: string) => 'مربوط: ' + name, modelOff: 'غير مربوط بعد',
    modelSaved: (name: string) => name + ' محفوظ ولم يُختبر بعد (اختبره من الإعدادات)', modelFailed: (name: string) => 'تعذّر الاتصال بـ ' + name + ' (راجع الإعدادات)',
    parts: 'مكونات نجد', partsReady: 'جاهزة', partsWorking: (percent: number) => 'تُجهَّز الآن · ' + percent + '%', partsFailed: 'تعذّر تجهيزها (الإعدادات > متقدم)', partsUnknown: 'لم تُفحص',
    tryIt: 'جرّب مهمة آمنة', sample: 'ما نظام التشغيل على جهازي، وكم مساحة القرص المتبقية؟ اقرأ فقط ولا تغيّر شيئًا.'
  },
  en: {
    title: 'Welcome to NAJD', lead: 'An agent that works on your computer with real tools. Four short steps to start, all optional.',
    steps: [
      { icon: KeyRound, title: 'Connect a model', body: 'Choose ChatGPT, an API key or a local model. Without a model NAJD cannot reply.' },
      { icon: ShieldCheck, title: 'You control access', body: 'Below the message box pick: ask for each step, approve safe steps, or full access. Passwords and payments always stay with you.' },
      { icon: Slash, title: 'Type / to see commands', body: 'New chat, open pages, access, task type, skills. Nothing is sent until you press send.' },
      { icon: Bot, title: 'Try a safe task', body: 'For example "summarize this file" after attaching it, or "open the calculator". Every action is shown step by step.' }
    ],
    connect: 'Connect a model now', later: 'Start without connecting', privacy: 'NAJD sends nothing to anyone unless you choose to, and your chats stay on this computer.',
    check: 'Quick check', model: 'Model', modelOn: (name: string) => 'Connected: ' + name, modelOff: 'Not connected yet',
    modelSaved: (name: string) => name + ' saved, not tested yet (test it in Settings)', modelFailed: (name: string) => name + ' could not connect (see Settings)',
    parts: 'NAJD components', partsReady: 'Ready', partsWorking: (percent: number) => 'Preparing · ' + percent + '%', partsFailed: 'Could not be prepared (Settings > Advanced)', partsUnknown: 'Not checked',
    tryIt: 'Try a safe task', sample: 'What operating system is on my computer, and how much disk space is left? Only read; change nothing.'
  }
}

// The components' state for the quick check: ready, preparing (with percent) or failed. A development run without a
// bundle has nothing to prepare and counts as ready.
function partsState(status: NajdRuntimeStatus | null): { kind: 'ready' | 'working' | 'failed' | 'unknown'; percent: number } {
  if (!status) return { kind: 'unknown', percent: 0 }
  if (status.state === 'ready' || (!status.bundled && !status.active && status.state === 'idle')) return { kind: 'ready', percent: 100 }
  if (status.state === 'failed' || status.state === 'cancelled') return { kind: 'failed', percent: 0 }
  return { kind: 'working', percent: status.total > 0 ? Math.min(100, Math.round(status.downloaded / status.total * 100)) : 0 }
}

// Shown once on the first launch with no conversations. Keyboard: focus starts on the main button, Tab stays inside, Escape closes it like "Start without connecting".
// The quick check (Phase 15 first run) reads the connected model and the components' state; "Try a safe task" only puts a
// read-only request in the message box, and nothing is sent until the owner presses send.
export function Welcome({ language, providers = [], onConnect, onClose, onTry }: { language: 'ar' | 'en'; providers?: NajdProvider[]; onConnect(): void; onClose(): void; onTry?(text: string): void }) {
  const text = TEXT[language], root = useRef<HTMLDivElement>(null), first = useRef<HTMLButtonElement>(null)
  const [runtime, setRuntime] = useState<NajdRuntimeStatus | null>(null)
  useEffect(() => { first.current?.focus() }, [])
  useEffect(() => {
    let live = true
    const read = () => { void window.najdRuntime?.status().then(status => { if (live) setRuntime(status) }).catch(() => {}) }
    read()
    const timer = window.setInterval(read, 2000)
    return () => { live = false; window.clearInterval(timer) }
  }, [])
  // Connected means a model answered (verified, the "Connected" badge in Settings) or a local server lists models (App
  // passes local providers only then). A saved key that was not tested, or failed, is shown as such and is not ready.
  const usable = providers.filter(item => item.kind !== 'union')
  const connected = usable.find(item => !item.errorCode && (item.verified || item.kind === 'local'))
  const pending = connected ? undefined : usable.find(item => item.configured && item.kind !== 'local')
  const parts = partsState(runtime)
  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === 'Escape') { event.preventDefault(); onClose(); return }
    if (event.key !== 'Tab') return
    const buttons = [...(root.current?.querySelectorAll<HTMLElement>('button') || [])]
    if (!buttons.length) return
    const index = buttons.indexOf(document.activeElement as HTMLElement)
    const next = event.shiftKey ? (index <= 0 ? buttons.length - 1 : index - 1) : (index === buttons.length - 1 ? 0 : index + 1)
    event.preventDefault(); buttons[next].focus()
  }
  // Portaled to the page body so no transformed ancestor of the app shell can displace the fixed overlay.
  return createPortal(<div className="welcome-backdrop" onKeyDown={onKeyDown}>
    <div className="welcome-card" role="dialog" aria-modal="true" aria-labelledby="welcome-title" ref={root} dir={language === 'ar' ? 'rtl' : 'ltr'} data-welcome>
      <h2 id="welcome-title">{text.title}</h2>
      <p className="welcome-lead">{text.lead}</p>
      <ol className="welcome-steps">{text.steps.map(step => <li key={step.title}><step.icon size={18} aria-hidden="true" /><div><strong>{step.title}</strong><span>{step.body}</span></div></li>)}</ol>
      <section className="welcome-check" aria-label={text.check} data-welcome-check>
        <strong>{text.check}</strong>
        <p data-check="model" data-ok={!!connected}>{connected ? <CheckCircle2 size={15} aria-hidden="true" /> : <CircleDashed size={15} aria-hidden="true" />}<span>{text.model}: {connected ? text.modelOn(connected.name) : pending ? (pending.errorCode ? text.modelFailed : text.modelSaved)(pending.name) : text.modelOff}</span></p>
        <p data-check="parts" data-ok={parts.kind === 'ready'} role="status">{parts.kind === 'ready' ? <CheckCircle2 size={15} aria-hidden="true" /> : <CircleDashed size={15} aria-hidden="true" />}
          <span>{text.parts}: {parts.kind === 'ready' ? text.partsReady : parts.kind === 'working' ? text.partsWorking(parts.percent) : parts.kind === 'failed' ? text.partsFailed : text.partsUnknown}</span></p>
      </section>
      <p className="welcome-privacy">{text.privacy}</p>
      <div className="welcome-actions">
        {connected && onTry
          ? <button type="button" className="welcome-primary" ref={first} data-welcome="try" onClick={() => onTry(text.sample)}>{text.tryIt}</button>
          : <button type="button" className="welcome-primary" ref={first} data-welcome="connect" onClick={onConnect}>{text.connect}</button>}
        <button type="button" className="welcome-secondary" data-welcome="later" onClick={onClose}>{text.later}</button>
      </div>
    </div>
  </div>, document.body)
}
