import { useCallback, useEffect, useState } from 'react'
import { Send } from 'lucide-react'
import { CardHeading } from './ui'
import { QrCode } from './QrCode'
import type { ProviderControls } from './useProviders'

const TEXT = {
  ar: {
    title: 'تيليجرام', hint: 'أرسل مهامك إلى نجد من هاتفك عبر بوت تيليجرام خاص بك. يعمل دون عنوان عام ودون فتح أي منفذ على جهازك، ويبقى نجد شغالًا في الخلفية لاستقبال الرسائل. أي تغيير يقترحه نجد يطلب موافقتك في المحادثة نفسها بزرّي «السماح» و«رفض».',
    steps: ['امسح الرمز بكاميرا جوالك ليفتح @BotFather في تيليجرام، وأرسل له /newbot واتبع الخطوات.', 'انسخ الرمز (Token) الذي يعطيك إياه والصقه هنا.', 'اختر النموذج وفعّل القناة، ثم اضغط «اربط جوالك» وامسح الرمز الذي يظهر.'],
    createTitle: 'أنشئ بوتك', createHint: 'امسح لفتح BotFather في جوالك', botFather: 'رمز يفتح BotFather في تيليجرام', linkTitle: 'اربط جوالك', linkHint: 'امسح الرمز بكاميرا جوالك واضغط «ابدأ» (Start) في تيليجرام. يصلح مرة واحدة ولمدة عشر دقائق.',
    linkQr: 'رمز يربط جوالك ببوت نجد', orSend: 'أو أرسل لبوتك:', notify: 'ما تبدأه على الكمبيوتر يبقى على الكمبيوتر. لو تبي النتيجة على تيليجرام قلها في طلبك (مثل: «إذا خلصت أرسلها لي على التلجرام»)، أو افتح المحادثة من البوت بالأمر /open وكمّل منه.',
    commands: 'أوامر البوت: /chats فتح أي محادثة (حتى اللي على الكمبيوتر)، /new محادثة جديدة، /model تغيير النموذج، /stop إيقاف، /status الإعداد.',
    token: 'رمز البوت (Token)', saveToken: 'حفظ الرمز والتحقق منه', removeToken: 'حذف الرمز', tokenSaved: 'الرمز محفوظ مشفّرًا على هذا الجهاز.', tokenInvalid: 'رفض تيليجرام هذا الرمز أو تعذّر الاتصال. تحقق منه وحاول مرة أخرى.',
    provider: 'المزوّد', model: 'النموذج', chooseProvider: 'اختر المزوّد', chooseModel: 'اختر النموذج', access: 'صلاحية المهام القادمة من الهاتف',
    ask: 'اسألني عن كل خطوة (موصى به)', approve: 'وافق على الآمن تلقائيًا', full: 'وصول كامل (بدون أسئلة، عدا ما يطلب موافقتك دائمًا)', fullWarn: 'تحذير: أي شخص يملك هاتفك المقترن يستطيع أن يأمر نجد بتنفيذ مهام على حاسوبك دون أسئلة.',
    language: 'لغة ردود البوت', enable: 'تفعيل القناة', state: 'الحالة', states: { stopped: 'متوقفة', starting: 'جارٍ التشغيل', running: 'تعمل', error: 'خطأ' }, errors: { INVALID_TOKEN: 'الرمز غير صالح.', CONFLICT: 'برنامج آخر يستقبل رسائل هذا البوت. أوقفه أو استخدم بوتًا جديدًا.', NETWORK: 'تعذّر الاتصال بتيليجرام.' },
    pair: 'اقتران', pairHint: 'أرسل إلى بوتك من هاتفك:', pairExpires: 'ينتهي خلال عشر دقائق، ويصلح لمرة واحدة.', paired: 'المحادثات المقترنة', noPaired: 'لا توجد محادثات مقترنة بعد.', unpair: 'إلغاء الاقتران', saved: 'تم الحفظ.', failed: 'تعذّرت العملية.',
    note: 'ترسل لنجد نصًا فقط حاليًا، وتصلك ردوده منسقة ومعها الصور (مثل لقطات الشاشة). الرسائل التي تُرسل أثناء إغلاق نجد تُتجاهل. المحادثة تُحفظ في قائمة محادثاتك بعلامة الهاتف.'
  },
  en: {
    title: 'Telegram', hint: 'Send tasks to NAJD from your phone through your own Telegram bot. It needs no public address and opens no port on your computer, and NAJD keeps running in the background to receive messages. Any change NAJD proposes asks for your permission in the same chat with Allow and Deny buttons.',
    steps: ['Scan the code with your phone camera to open @BotFather in Telegram, send it /newbot and follow the steps.', 'Copy the token it gives you and paste it here.', 'Choose the model and enable the channel, then press "Link your phone" and scan the code that appears.'],
    createTitle: 'Create your bot', createHint: 'Scan to open BotFather on your phone', botFather: 'Code that opens BotFather in Telegram', linkTitle: 'Link your phone', linkHint: 'Scan the code with your phone camera and press Start in Telegram. It works once, for ten minutes.',
    linkQr: 'Code that links your phone to the NAJD bot', orSend: 'Or send to your bot:', notify: 'Work you start on the computer stays on the computer. To get the result on Telegram, say so in your request (\"when you finish, send it to me on Telegram\"), or open the conversation from the bot with /open and continue there.',
    commands: 'Bot commands: /chats open any conversation (also the ones on the computer), /new new conversation, /model change the model, /stop, /status.',
    token: 'Bot token', saveToken: 'Save and verify the token', removeToken: 'Remove the token', tokenSaved: 'The token is saved encrypted on this computer.', tokenInvalid: 'Telegram rejected this token or could not be reached. Check it and try again.',
    provider: 'Provider', model: 'Model', chooseProvider: 'Choose a provider', chooseModel: 'Choose a model', access: 'Access for tasks that come from the phone',
    ask: 'Ask me for each step (recommended)', approve: 'Approve safe steps automatically', full: 'Full access (no questions, except what always asks)', fullWarn: 'Warning: anyone holding your paired phone can have NAJD run tasks on your computer without questions.',
    language: 'Language of the bot replies', enable: 'Enable the channel', state: 'Status', states: { stopped: 'Stopped', starting: 'Starting', running: 'Running', error: 'Error' }, errors: { INVALID_TOKEN: 'The token is not valid.', CONFLICT: 'Another program is receiving this bot’s messages. Stop it or use a new bot.', NETWORK: 'Telegram could not be reached.' },
    pair: 'Pair', pairHint: 'From your phone, send to your bot:', pairExpires: 'It expires in ten minutes and works once.', paired: 'Paired chats', noPaired: 'No chats are paired yet.', unpair: 'Unpair', saved: 'Saved.', failed: 'The operation failed.',
    note: 'You send NAJD text for now; its replies arrive formatted, with their pictures (such as screenshots). Messages sent while NAJD is closed are ignored. The conversation is saved in your chat list with a phone mark.'
  }
}

export function ChannelsSettings({ language, c, busy }: { language: 'ar' | 'en'; c: ProviderControls; busy: boolean }) {
  const t = TEXT[language]
  const api = window.najdChannels
  const [status, setStatus] = useState<NajdChannelStatus | null>(null)
  const [token, setToken] = useState(''), [working, setWorking] = useState(false), [message, setMessage] = useState<'saved' | 'tokenInvalid' | 'failed' | null>(null)
  const [code, setCode] = useState<{ code: string; expiresAt: string } | null>(null)
  const usable = c.catalog.filter(p => p.kind !== 'union' && p.configured)
  const reload = useCallback(async () => { if (!api) return; try { setStatus(await api.status()) } catch { /* shown on action */ } }, [api])
  useEffect(() => { void reload(); const timer = setInterval(() => { void reload() }, 3000); return () => clearInterval(timer) }, [reload])
  useEffect(() => { if (status?.provider && !c.models[status.provider] && !c.loading[status.provider]) void c.loadModels(status.provider) }, [status?.provider, c.models, c.loading, c.loadModels])
  if (!api) return null
  async function run(work: () => Promise<void>, invalid: 'failed' | 'tokenInvalid' = 'failed') {
    if (working || busy) return
    setWorking(true); setMessage(null)
    try { await work() } catch { setMessage(invalid) } finally { setWorking(false) }
  }
  const configure = (input: Parameters<NonNullable<typeof api>['configure']>[0]) => run(async () => { setStatus(await api.configure(input)); setMessage('saved') })
  const models = status?.provider ? c.models[status.provider] || [] : []
  // The bot's username (from Telegram) makes the link a phone opens: t.me/<bot>?start=<code> sends "/start <code>", which pairs.
  const bot = /^@?([A-Za-z][A-Za-z0-9_]{3,31})$/.exec(status?.botName || '')?.[1] || null
  return <div className="browser-card channels-card" data-channel="telegram" aria-busy={working}>
    <CardHeading icon={Send} title={t.title} hint={t.hint} />
    {!status?.tokenSaved && <div className="channel-create" data-channel="create">
      <figure className="channel-qr"><QrCode value="https://t.me/BotFather" label={t.botFather} /><figcaption>{t.createHint}</figcaption></figure>
      <div><h4>{t.createTitle}</h4><ol className="channel-steps">{t.steps.map(step => <li key={step}>{step}</li>)}</ol></div>
    </div>}
    <label className="model-choice"><span>{t.token}</span><input type="password" dir="ltr" value={token} autoComplete="off" spellCheck={false} data-channel-token placeholder={status?.tokenSaved ? '••••••••' : '123456789:AA…'} disabled={working || busy} onChange={event => setToken(event.target.value)} /></label>
    <div className="model-actions">
      <button type="button" className="model-refresh" data-action="channel-save-token" disabled={working || busy || !token.trim()} onClick={() => { void run(async () => { setStatus(await api.saveToken(token.trim())); setToken(''); setMessage('saved') }, 'tokenInvalid') }}>{t.saveToken}</button>
      {status?.tokenSaved && <button type="button" className="model-refresh" disabled={working || busy} onClick={() => { void run(async () => { setStatus(await api.clearToken()); setCode(null) }) }}>{t.removeToken}</button>}
    </div>
    {status?.tokenSaved && <>
      <p className="model-note" role="status">{t.tokenSaved}{status.botName && <bdi dir="ltr"> {status.botName}</bdi>}</p>
      <div className="union-pick">
        <select aria-label={t.provider} data-channel-provider value={status.provider || ''} disabled={working || busy} onChange={event => { void configure({ provider: event.target.value || null, model: null }) }}>
          <option value="">{t.chooseProvider}</option>{usable.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select aria-label={t.model} data-channel-model value={status.model || ''} disabled={working || busy || !status.provider} onChange={event => { void configure({ model: event.target.value || null }) }}>
          <option value="">{t.chooseModel}</option>{status.model && !models.some(m => m.id === status.model) && <option value={status.model}>{status.model}</option>}{models.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
        </select>
      </div>
      <label className="model-choice"><span>{t.access}</span>
        <select aria-label={t.access} data-channel-access value={status.accessMode} disabled={working || busy} onChange={event => { void configure({ accessMode: event.target.value as 'ask' | 'approve' | 'full' }) }}>
          <option value="ask">{t.ask}</option><option value="approve">{t.approve}</option><option value="full">{t.full}</option>
        </select></label>
      {status.accessMode === 'full' && <p className="model-error" role="alert">{t.fullWarn}</p>}
      <label className="model-choice"><span>{t.language}</span>
        <select aria-label={t.language} value={status.language} disabled={working || busy} onChange={event => { void configure({ language: event.target.value as 'ar' | 'en' }) }}><option value="ar">العربية</option><option value="en">English</option></select></label>
      <label className="union-toggle"><input type="checkbox" data-channel-enabled checked={status.enabled} disabled={working || busy || !status.provider || !status.model} onChange={event => { void configure({ enabled: event.target.checked }) }} />{t.enable}</label>
      <p className="model-note" data-channel-notify>{t.notify}</p>
      <p className="model-note" role="status">{t.state}: <strong data-channel-state={status.state}>{t.states[status.state]}</strong>{status.errorCode && <> · {(t.errors as Record<string, string>)[status.errorCode] || status.errorCode}</>}</p>
      <div className="model-actions"><button type="button" className="model-refresh" data-action="channel-pair" disabled={working || busy || status.state !== 'running'} onClick={() => { void run(async () => { setCode(await api.pair()); await reload() }) }}>{t.linkTitle}</button></div>
      {(code || status.pairing) && <div className="channel-pair channel-create" role="status">
        {bot && <figure className="channel-qr"><QrCode value={`https://t.me/${bot}?start=${(code || status.pairing)!.code}`} label={t.linkQr} /></figure>}
        <div><h4>{t.linkTitle}</h4><p>{bot ? t.linkHint : t.pairHint}</p><p>{t.orSend}</p><code dir="ltr" data-channel-code>/pair {(code || status.pairing)!.code}</code><small>{t.pairExpires}</small></div>
      </div>}
      <p className="model-note">{t.commands}</p>
      <h4>{t.paired}</h4>
      {status.allowed.length === 0 ? <p className="model-note">{t.noPaired}</p> : <ul className="channel-paired">{status.allowed.map(item => <li key={item.chatId}><span>{item.name}</span>
        <button type="button" className="model-refresh" disabled={working || busy} onClick={() => { void run(async () => { setStatus(await api.unpair(item.chatId)) }) }}>{t.unpair}</button></li>)}</ul>}
    </>}
    <p className="model-note">{t.note}</p>
    {message === 'saved' && <p className="model-note" role="status">{t.saved}</p>}
    {message === 'tokenInvalid' && <p className="model-error" role="alert">{t.tokenInvalid}</p>}
    {message === 'failed' && <p className="model-error" role="alert">{t.failed}</p>}
  </div>
}
