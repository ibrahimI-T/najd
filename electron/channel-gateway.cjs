// Messaging channels: send NAJD tasks from a phone. The first channel is Telegram (Bot API, long polling: no public address, nothing listens on this computer).
// Safety model: only chats the owner paired in NAJD Settings can give orders (a one-time code, ten minutes, five tries); only private chats; messages sent while NAJD was
// off are dropped; every change the agent proposes is asked in the same chat with Allow / Deny buttons (access mode "ask" by default, "approve" or "full" only when the
// owner chose it); /stop cancels; replies are plain text. The conversation is saved in NAJD like any other chat.
const fs = require('node:fs/promises')
const { replaceFile } = require('./atomic-file.cjs')
const path = require('node:path')
const { randomUUID, randomInt, timingSafeEqual } = require('node:crypto')
const { createTelegramApi } = require('./telegram-api.cjs')
const { redactText } = require('./redact.cjs')
const { toTelegramHtml, takeImages } = require('./telegram-format.cjs')

const fail = code => Object.assign(new Error(code), { code })
const providerIds = require('./provider-catalog.json').map(p => p.id)
const TERMINAL = new Set(['COMPLETED', 'FAILED', 'CANCELLED', 'UNKNOWN_EFFECT'])
const PAIR_MINUTES = 10, PAIR_TRIES = 5, MAX_PAIRED = 5, MAX_CHUNK = 3800, STALE_SECONDS = 120

const WORDS = {
  en: {
    notPaired: 'This chat is not paired with NAJD. In NAJD open Settings > Channels, press Pair, then send /pair and the code shown there.',
    pairHelp: 'Send /pair followed by the 6-digit code shown in NAJD (Settings > Channels > Pair).', pairNone: 'Pairing is not open. In NAJD press Pair first.', pairBad: 'That code is not valid.',
    paired: 'Paired. You can now give NAJD tasks from here. Commands: /chats (open any conversation), /new (new conversation), /model (change the model), /stop, /status, /help.',
    help: 'Send a message and NAJD works on it on your computer.\n/chats opens any of your conversations (also the ones on the computer)\n/new starts a new conversation\n/model changes the model\n/stop stops the current task\n/status shows the setup\nYou are told here when work on the computer finishes or needs your permission (Settings > Channels). Changes ask your permission here first.',
    notConfigured: 'NAJD has no model selected for this channel. Choose one in Settings > Channels.', busy: 'NAJD is still working on the previous request. Send /stop to stop it.',
    stopped: 'Stopped.', nothingRunning: 'Nothing is running.', newChat: 'New conversation started.', failed: code => `The task could not finish (${code}).`, cancelled: 'The task was stopped.',
    unknown: 'The result of the last action could not be confirmed. Check the computer before repeating it.', empty: 'Done (no text reply).', textOnly: 'Send text or a picture; other kinds of messages are not supported here yet.',
    approval: (tool, detail) => `NAJD asks permission:\n${tool}\n${detail}`, allow: 'Allow once', deny: 'Deny', allowed: 'Allowed.', denied: 'Denied.', expired: 'That request is no longer waiting.',
    timedOut: 'No answer in time: the request was denied.', hidden: 'This request contains values that cannot be shown safely here, so it was denied. Approve it in the NAJD app instead.', tooLong: 'This request has too many details to show safely here, so it was denied. Approve it in the NAJD app instead.', status: (model, mode, running) => `Model: ${model}\nAccess: ${mode}\n${running ? 'A task is running.' : 'Idle.'}`,
    chats: 'Your recent conversations (tap one to continue it here):', noChats: 'There are no conversations yet.', untitled: 'Untitled conversation', opened: title => `Opened: ${title}\nYour next message continues this conversation.`,
    you: 'You', najd: 'NAJD', gone: 'That conversation no longer exists.', providers: current => `Current model: ${current}\nChoose a provider:`, noProviders: 'No provider is connected in NAJD yet.',
    models: provider => `Choose a model of ${provider}:`, noModels: 'This provider listed no models (check it in NAJD Settings > Models).', modelSet: (provider, model) => `Model set: ${provider} / ${model}`,
    started: title => `⏳ NAJD started working in "${title}" on the computer.`, finished: title => `✅ Finished on the computer: ${title}`, failedOn: (title, code) => `⚠️ Could not finish on the computer: ${title} (${code})`,
    approvalOn: title => `✋ "${title}" on the computer is waiting for your permission:`, open: 'Open here', more: '…',
    approvalHead: '\u{1F510} NAJD asks your permission', allowTask: 'Allow for this task', allowedTask: 'Allowed for the rest of this task.',
    tools: { 'najd-screen-capture': 'Take a screenshot', 'najd-desktop-open': 'Open', 'najd-desktop-read': 'Read a window', 'najd-desktop-act': 'Act in a window', 'najd-desktop-windows': 'List windows',
      'najd-files-write': 'Write a file', 'najd-files-edit': 'Edit a file', 'najd-browser': 'Use the browser', 'najd-python-run': 'Run Python', 'najd-process-start': 'Run a command', 'najd-terminal-run': 'Run a command' },
    fields: { summary: 'What', path: 'Target', command: 'Command', query: 'Search', url: 'Address', name: 'Name', target: 'Target', cwd: 'Folder', app: 'App', text: 'Text', preview: 'Preview' },
    photoAsk: 'What is in this picture?', photoFailed: 'The picture could not be received. Try again or send it as a photo.', photoTooBig: 'The picture is larger than 10 MB.',
    noted: '\u{1F4DD} Got it, adding this to the current task.', working: '⏳ NAJD is working…', steps: n => `${n} step${n === 1 ? '' : 's'} so far`,
    doing: { 'najd-web-search': '\u{1F50E} Searching the web', 'najd-web-extract': '\u{1F310} Reading', 'najd-web-preview': '\u{1F441} Opening a page', 'najd-browser': '\u{1F9ED} Using the browser',
      'najd-files-read': '\u{1F4C4} Reading a file', 'najd-files-list': '\u{1F4C1} Looking in a folder', 'najd-files-search': '\u{1F50D} Searching files', 'najd-files-write': '✏️ Writing a file', 'najd-files-edit': '✏️ Editing a file',
      'najd-tools-load': '\u{1F9F0} Getting tools ready', 'najd-capabilities-search': '\u{1F9ED} Looking for a capability', 'najd-capabilities-details': '\u{1F9ED} Reading a capability', 'najd-extensions-search': '\u{1F9E9} Searching extensions',
      'najd-screen-capture': '\u{1F4F8} Taking a screenshot', 'najd-desktop-open': '\u{1F5A5} Opening', 'najd-desktop-read': '\u{1F5A5} Reading a window', 'najd-desktop-act': '\u{1F5B1} Acting in a window', 'najd-desktop-windows': '\u{1F5A5} Listing windows',
      'najd-python-run': '\u{1F40D} Running Python', 'najd-terminal-run': '⌨️ Running a command', 'najd-process-start': '⌨️ Starting a program', 'najd-library-search': '\u{1F4DA} Searching the library', 'najd-library-read': '\u{1F4DA} Reading from the library',
      'najd-knowledge-search': '\u{1F4DA} Searching knowledge bases', 'najd-chats-search': '\u{1F4AC} Searching earlier chats', 'najd-chats-read': '\u{1F4AC} Reading an earlier chat', 'najd-memory': '\u{1F9E0} Updating memory', 'najd-delegate': '\u{1F91D} Asking a helper',
      'najd-image-generate': '\u{1F3A8} Generating an image', 'najd-video-generate': '\u{1F3AC} Generating a video', 'najd-office-review': '\u{1F4D1} Reviewing a document', 'najd-plan': '\u{1F5D2} Planning', 'najd-mcp-call': '\u{1F50C} Using a connection' },
    using: tool => `\u{1F6E0} Using ${tool}`
  },
  ar: {
    notPaired: 'هذه المحادثة غير مقترنة بنجد. في نجد افتح الإعدادات > القنوات واضغط «اقتران»، ثم أرسل /pair والرمز الظاهر هناك.',
    pairHelp: 'أرسل /pair ثم الرمز المكوّن من 6 أرقام الظاهر في نجد (الإعدادات > القنوات > اقتران).', pairNone: 'الاقتران غير مفتوح. اضغط «اقتران» في نجد أولًا.', pairBad: 'الرمز غير صحيح.',
    paired: 'تم الاقتران. يمكنك الآن إعطاء نجد مهامًا من هنا. الأوامر: /chats (فتح أي محادثة)، /new (محادثة جديدة)، /model (تغيير النموذج)، /stop، /status، /help.',
    help: 'أرسل رسالة فيعمل نجد عليها على حاسوبك.\n/chats تفتح أي محادثة من محادثاتك (حتى اللي على الكمبيوتر)\n/new تبدأ محادثة جديدة\n/model تغيّر النموذج\n/stop توقف المهمة الحالية\n/status تعرض الإعداد\nيصلك هنا تنبيه لما ينتهي عمل على الكمبيوتر أو يحتاج إذنك (الإعدادات > القنوات). أي تغيير يطلب إذنك هنا أولًا.',
    notConfigured: 'لم يُحدَّد نموذج لهذه القناة في نجد. اختر واحدًا من الإعدادات > القنوات.', busy: 'نجد ما زال يعمل على الطلب السابق. أرسل /stop لإيقافه.',
    stopped: 'تم الإيقاف.', nothingRunning: 'لا توجد مهمة قيد التنفيذ.', newChat: 'بدأت محادثة جديدة.', failed: code => `تعذّر إكمال المهمة (${code}).`, cancelled: 'أُوقفت المهمة.',
    unknown: 'لم تُؤكَّد نتيجة آخر إجراء. افحص الحاسوب قبل تكراره.', empty: 'تم (بدون رد نصي).', textOnly: 'أرسل نصًا أو صورة؛ الأنواع الأخرى من الرسائل غير مدعومة هنا بعد.',
    hidden: 'يحتوي هذا الطلب على قيم لا يمكن عرضها هنا بأمان، فتم رفضه. وافق عليه من داخل تطبيق نجد.',
    tooLong: 'تفاصيل هذا الطلب أطول من أن تُعرض هنا بأمان، فتم رفضه. وافق عليه من داخل تطبيق نجد.',
    approval: (tool, detail) => `يطلب نجد إذنك:\n${tool}\n${detail}`, allow: 'السماح مرة واحدة', deny: 'رفض', allowed: 'تم السماح.', denied: 'تم الرفض.', expired: 'هذا الطلب لم يعد بانتظار ردك.',
    timedOut: 'انتهت المهلة دون رد: رُفض الطلب.', status: (model, mode, running) => `النموذج: ${model}\nالصلاحية: ${mode}\n${running ? 'توجد مهمة قيد التنفيذ.' : 'لا توجد مهمة قيد التنفيذ.'}`,
    chats: 'محادثاتك الأخيرة (اضغط واحدة لتكملها من هنا):', noChats: 'لا توجد محادثات بعد.', untitled: 'محادثة بلا عنوان', opened: title => `فتحت: ${title}\nرسالتك القادمة تكمل هذه المحادثة.`,
    you: 'أنت', najd: 'نجد', gone: 'هذه المحادثة لم تعد موجودة.', providers: current => `النموذج الحالي: ${current}\nاختر المزوّد:`, noProviders: 'لا يوجد مزوّد متصل في نجد بعد.',
    models: provider => `اختر نموذجًا من ${provider}:`, noModels: 'لم يُرجع هذا المزوّد أي نموذج (راجعه في نجد: الإعدادات > النماذج).', modelSet: (provider, model) => `تم اختيار النموذج: ${provider} / ${model}`,
    started: title => `⏳ بدأ نجد العمل في «${title}» على الكمبيوتر.`, finished: title => `✅ انتهى على الكمبيوتر: ${title}`, failedOn: (title, code) => `⚠️ تعذّر الإكمال على الكمبيوتر: ${title} (${code})`,
    approvalOn: title => `✋ «${title}» على الكمبيوتر ينتظر إذنك:`, open: 'افتحها هنا', more: '…',
    approvalHead: '\u{1F510} يطلب نجد إذنك', allowTask: 'السماح لهذه المهمة', allowedTask: 'تم السماح لبقية هذه المهمة.',
    tools: { 'najd-screen-capture': 'لقطة شاشة', 'najd-desktop-open': 'فتح', 'najd-desktop-read': 'قراءة نافذة', 'najd-desktop-act': 'تنفيذ داخل نافذة', 'najd-desktop-windows': 'عرض النوافذ',
      'najd-files-write': 'كتابة ملف', 'najd-files-edit': 'تعديل ملف', 'najd-browser': 'استخدام المتصفح', 'najd-python-run': 'تشغيل Python', 'najd-process-start': 'تشغيل أمر', 'najd-terminal-run': 'تشغيل أمر' },
    fields: { summary: 'الوصف', path: 'الهدف', command: 'الأمر', query: 'البحث', url: 'العنوان', name: 'الاسم', target: 'الهدف', cwd: 'المجلد', app: 'التطبيق', text: 'النص', preview: 'معاينة' },
    photoAsk: 'وش في هذي الصورة؟', photoFailed: 'تعذّر استلام الصورة. أعد المحاولة أو أرسلها كصورة.', photoTooBig: 'الصورة أكبر من 10 ميجا.',
    noted: '\u{1F4DD} وصلت، أضفتها للمهمة الحالية.', working: '⏳ نجد يشتغل…', steps: n => `${n} ${n === 1 ? 'خطوة' : 'خطوات'} حتى الآن`,
    doing: { 'najd-web-search': '\u{1F50E} يبحث في الإنترنت', 'najd-web-extract': '\u{1F310} يقرأ', 'najd-web-preview': '\u{1F441} يفتح صفحة', 'najd-browser': '\u{1F9ED} يستخدم المتصفح',
      'najd-files-read': '\u{1F4C4} يقرأ ملف', 'najd-files-list': '\u{1F4C1} يشوف مجلد', 'najd-files-search': '\u{1F50D} يبحث في الملفات', 'najd-files-write': '✏️ يكتب ملف', 'najd-files-edit': '✏️ يعدّل ملف',
      'najd-tools-load': '\u{1F9F0} يجهّز أدوات', 'najd-capabilities-search': '\u{1F9ED} يدوّر على قدرة', 'najd-capabilities-details': '\u{1F9ED} يقرأ عن قدرة', 'najd-extensions-search': '\u{1F9E9} يبحث في الإضافات',
      'najd-screen-capture': '\u{1F4F8} يصوّر الشاشة', 'najd-desktop-open': '\u{1F5A5} يفتح', 'najd-desktop-read': '\u{1F5A5} يقرأ نافذة', 'najd-desktop-act': '\u{1F5B1} ينفّذ داخل نافذة', 'najd-desktop-windows': '\u{1F5A5} يشوف النوافذ المفتوحة',
      'najd-python-run': '\u{1F40D} يشغّل Python', 'najd-terminal-run': '⌨️ ينفّذ أمر', 'najd-process-start': '⌨️ يشغّل برنامج', 'najd-library-search': '\u{1F4DA} يبحث في المكتبة', 'najd-library-read': '\u{1F4DA} يقرأ من المكتبة',
      'najd-knowledge-search': '\u{1F4DA} يبحث في قواعد المعرفة', 'najd-chats-search': '\u{1F4AC} يبحث في المحادثات السابقة', 'najd-chats-read': '\u{1F4AC} يقرأ محادثة سابقة', 'najd-memory': '\u{1F9E0} يحدّث الذاكرة', 'najd-delegate': '\u{1F91D} يستعين بمساعد',
      'najd-image-generate': '\u{1F3A8} يولّد صورة', 'najd-video-generate': '\u{1F3AC} يولّد فيديو', 'najd-office-review': '\u{1F4D1} يراجع مستند', 'najd-plan': '\u{1F5D2} يخطط', 'najd-mcp-call': '\u{1F50C} يستخدم اتصال' },
    using: tool => `\u{1F6E0} يستخدم ${tool}`
  }
}

// notify: kept for older settings files; work on the computer is told on Telegram only when its request asks for it (channel-notice.cjs).
const defaults = () => ({ version: 1, telegram: { enabled: false, provider: null, model: null, accessMode: 'ask', language: 'en', botName: null, allowed: [], sessions: {}, notify: true } })
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_LISTED = 10, MAX_MODELS = 24, MAX_ALBUM = 10
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const chunks = (text, max = MAX_CHUNK) => {
  const out = []
  let rest = String(text)
  while (rest.length > max) {
    let cut = rest.lastIndexOf('\n', max)
    if (cut < max / 2) cut = max
    out.push(rest.slice(0, cut)); rest = rest.slice(cut).replace(/^\n+/, '')
  }
  if (rest) out.push(rest)
  return out
}

// providers (optional): { catalog(), models(id) } from the provider service, for /model.
// readImage (optional): id -> data URL of a library picture, so pictures in a reply arrive as photos.
// importImage (optional): (name, bytes) -> library asset { id, name }, for pictures the owner sends to the bot; removeImage(id) takes one
// back when its task never started.
function createChannelGateway({ core, sessions, filePath, tokenStore, providers = null, readImage = null, importImage = null, removeImage = null, makeApi = createTelegramApi, now = () => Date.now(), onActivity = () => {}, pollMs = 700, approvalTimeoutMs = 15 * 60000, longPollSeconds = 25, albumWaitMs = 1500 }) {
  if (!path.isAbsolute(filePath || '')) throw fail('INVALID_INPUT')
  let queue = Promise.resolve()
  const serial = work => { const result = queue.then(work); queue = result.catch(() => {}); return result }
  let api = null, loopController = null, loopPromise = null
  const state = { state: 'stopped', errorCode: null, botName: null }
  let pairing = null
  const running = new Map()          // chatId -> { taskId, typing }
  const approvals = new Map()        // approvalId -> { chatId, messageId, timer }
  const noticed = new Map()          // chatId -> last "not paired" reply time
  const ownTasks = new Set()         // tasks this channel started (bounded), never told as work on the computer
  const preparing = new Set()        // chats whose picture is being downloaded (their task slot is reserved)
  const albums = new Map()           // chatId:media_group_id -> pictures of an album still arriving

  async function read() {
    try {
      const value = JSON.parse(await fs.readFile(filePath, 'utf8'))
      if (!value || value.version !== 1 || typeof value.telegram !== 'object') throw fail('CHANNELS_UNAVAILABLE')
      return { version: 1, telegram: { ...defaults().telegram, ...value.telegram } }
    } catch (error) { if (error.code === 'ENOENT') return defaults(); throw fail('CHANNELS_UNAVAILABLE') }
  }
  async function write(next) {
    const temporary = `${filePath}.${randomUUID()}.tmp`
    try { await fs.mkdir(path.dirname(filePath), { recursive: true }); await fs.writeFile(temporary, JSON.stringify(next, null, 2) + '\n', { flag: 'wx' }); await replaceFile(temporary, filePath) }
    catch { throw fail('CHANNELS_UNAVAILABLE') } finally { await fs.unlink(temporary).catch(() => {}) }
  }
  const update = change => serial(async () => { const settings = await read(); const result = await change(settings.telegram); await write(settings); return result })
  const words = settings => WORDS[settings.language === 'ar' ? 'ar' : 'en']

  async function say(chatId, text, extra) {
    let last = null
    for (const part of chunks(text)) last = await api.sendMessage(chatId, part, extra).catch(() => null)
    return last
  }
  // A model's answer: formatted (plain text when Telegram refuses the formatting) and its pictures sent as photos after it.
  // Only pictures the task saved itself (task.images) are sent; any other library reference in the text is dropped, so a model
  // naming an older library item cannot have it sent out. Buttons go on the last text part.
  async function sayReply(chatId, text, extra, allowedImages = []) {
    const { text: body, ids: named } = takeImages(text)
    const ids = named.filter(id => allowedImages.includes(id))
    const parts = body ? chunks(body, 3000) : []
    let last = null
    for (const [index, part] of parts.entries()) {
      const more = index === parts.length - 1 ? extra : undefined, html = toTelegramHtml(part)
      last = html.length <= 4096 ? await api.sendMessage(chatId, html, { ...more, parse_mode: 'HTML' }).catch(() => null) : null
      if (!last) last = await api.sendMessage(chatId, part, more).catch(() => null)
    }
    for (const id of ids) {
      try {
        const url = readImage ? await readImage(id) : null
        const match = /^data:(image\/(?:jpeg|png));base64,(.+)$/.exec(url || '')
        if (match && api.sendPhoto) await api.sendPhoto(chatId, Buffer.from(match[2], 'base64'), { mime: match[1] })
      } catch { /* a picture that cannot be read or sent is skipped; the answer itself was sent */ }
    }
    if (!parts.length && extra) last = await api.sendMessage(chatId, '•', extra).catch(() => null)
    return last
  }

  // ---------- pairing ----------
  function openPairing() {
    pairing = { code: String(randomInt(100000, 1000000)), expiresAt: now() + PAIR_MINUTES * 60000, tries: 0 }
    return { code: pairing.code, expiresAt: new Date(pairing.expiresAt).toISOString() }
  }
  const pairingOpen = () => pairing && pairing.expiresAt > now() && pairing.tries < PAIR_TRIES
  const sameCode = (a, b) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y) }

  async function handlePairing(message, settings) {
    const w = words(settings), chat = message.chat
    const match = /^\/(?:start|pair)(?:@\w+)?(?:\s+(\d{6}))?\s*$/.exec(message.text || '')
    if (!match) {
      if (!noticed.has(chat.id) || now() - noticed.get(chat.id) > 10 * 60000) { noticed.set(chat.id, now()); await say(chat.id, w.notPaired) }
      return
    }
    if (!match[1]) { await say(chat.id, w.pairHelp); return }
    if (!pairingOpen()) { await say(chat.id, w.pairNone); return }
    pairing.tries++
    if (!sameCode(match[1], pairing.code)) { await say(chat.id, w.pairBad); return }
    pairing = null
    await update(async telegram => {
      if (telegram.allowed.length >= MAX_PAIRED) throw fail('LIMIT_REACHED')
      if (!telegram.allowed.some(item => item.chatId === chat.id)) telegram.allowed.push({ chatId: chat.id, userId: message.from?.id ?? null, name: String(message.from?.first_name || message.from?.username || 'Telegram').slice(0, 40), pairedAt: new Date(now()).toISOString() })
    }).then(() => say(chat.id, w.paired), () => say(chat.id, w.notPaired))
  }

  // ---------- tasks ----------
  // The request's own values, word for word, each under a label in the reply language (labels only translate the field names).
  const detailOf = (input, w = WORDS.en) => {
    if (!input || typeof input !== 'object') return ''
    const label = key => w.fields?.[key] || key
    const pick = ['summary', 'path', 'command', 'query', 'url', 'name', 'target', 'cwd', 'app', 'text'].filter(key => typeof input[key] === 'string').map(key => `${label(key)}: ${input[key]}`)
    const preview = typeof input.preview === 'string' ? [label('preview') + ': ' + input.preview] : (input.preview && typeof input.preview === 'object' ? [label('preview') + ': ' + JSON.stringify(input.preview)] : [])
    return [...(pick.length ? pick : (preview.length ? [] : [JSON.stringify(input)])), ...preview].join('\n')
  }
  // A card that was answered (or is no longer waiting) is removed, so the chat keeps only the work itself; if Telegram refuses, it is marked instead.
  async function clearCard(chatId, messageId, mark) {
    if (!messageId) return
    const removed = api.deleteMessage ? await api.deleteMessage(chatId, messageId).then(() => true, () => false) : false
    if (!removed && mark) await api.editMessageText(chatId, messageId, mark).catch(() => {})
  }
  // relayed: a task started on the computer. Unanswered, its request is only withdrawn here (the owner may still answer in the app), never denied.
  async function askApproval(chatId, task, settings, { relayed = false } = {}) {
    const w = words(settings), id = task.approvalId
    const detail = detailOf(task.proposedInput, w)
    // What the owner approves must be exactly what runs: masking could hide part of a command, so a request with anything to mask is not approved remotely.
    const flat = text => text.replace(/\s+/g, ' ').trim()
    // A producer that shows only part of an action (a long file body or edit) cannot be approved here either.
    if (task.proposedInput?.truncated === true) { try { core.respondApproval(id, 'DENY') } catch { /* already answered */ } await say(chatId, w.tooLong); return }
    if (flat(redactText(detail, 1000000)) !== flat(detail)) { try { core.respondApproval(id, 'DENY') } catch { /* already answered */ } await say(chatId, w.hidden); return }
    // Executable details are never cut: when they do not fit one message the request is denied and the owner approves it in the app.
    if (detail.length > MAX_CHUNK - 300) { try { core.respondApproval(id, 'DENY') } catch { /* already answered */ } await say(chatId, w.tooLong); return }
    const tool = task.proposedTool || 'action'
    const card = `${w.approvalHead}\n\n${w.tools?.[tool] || tool} (${tool})\n${detail}`
    // Agent steps can be allowed for the rest of their task, which spares one card per step of a multi-step request.
    const buttons = task.viaAgent ? [[{ text: w.allow, callback_data: `a:${id}:y` }, { text: w.allowTask, callback_data: `a:${id}:t` }], [{ text: w.deny, callback_data: `a:${id}:n` }]]
      : [[{ text: w.allow, callback_data: `a:${id}:y` }, { text: w.deny, callback_data: `a:${id}:n` }]]
    const sent = await api.sendMessage(chatId, card, { reply_markup: { inline_keyboard: buttons } }).catch(() => null)
    const timer = setTimeout(() => {
      if (!approvals.has(id)) return
      approvals.delete(id)
      void clearCard(chatId, sent?.message_id, card + '\n\n' + w.expired)
      if (relayed) return
      try { core.respondApproval(id, 'DENY') } catch { /* already answered */ }
      void say(chatId, w.timedOut)
    }, approvalTimeoutMs)
    timer.unref?.()
    approvals.set(id, { chatId, messageId: sent?.message_id ?? null, timer, taskId: task.id })
  }
  // A request answered elsewhere (in the NAJD app) or no longer waiting: its card leaves the chat too.
  function settleCards(task) {
    for (const [id, item] of [...approvals]) {
      if (item.taskId !== task.id || (task.state === 'WAITING_APPROVAL' && task.approvalId === id)) continue
      approvals.delete(id); clearTimeout(item.timer)
      void clearCard(item.chatId, item.messageId, null)
    }
  }

  async function addToRunning(chat, current, text, telegram) {
    const w = words(telegram)
    if (current.taskId) {
      try { core.addNote(current.taskId, text) }
      catch (error) { if (error?.code === 'LIMIT_REACHED' || error?.code === 'INVALID_INPUT') { await say(chat.id, w.busy); return } current.pendingNotes.push(text) }
    } else current.pendingNotes.push(text)
    if (current.sessionId && current.mainSaved) await sessions.appendMessage(current.sessionId, 'user', text).catch(() => {})
    else current.unsavedNotes.push(text) // saved by runMessage right after the message it follows
    onActivity({ sessionId: current.sessionId })
    await say(chat.id, w.noted)
  }

  // Live progress (owner request 2026-10-24): one message that shows what NAJD is doing (searching, reading a site, using a tool) from the
  // task's own activity record (details already masked by the core), edited at most every 1.5 s, and deleted when the answer arrives.
  const shortDetail = (tool, detail) => {
    if (tool === 'najd-web-extract' || tool === 'najd-web-preview') { try { return new URL(detail).hostname } catch { /* not an address */ } }
    return detail.length > 80 ? detail.slice(0, 79) + '…' : detail
  }
  function createProgress(chatId, w) {
    let messageId = null, shown = '', lastEdit = 0, seen = 0, count = 0, cleared = false
    const lines = []
    return {
      async update(task) {
        for (const event of task.activity?.events || []) {
          const seq = Number(event.seq) || 0
          if (seq <= seen) continue
          seen = seq
          if (event.type !== 'tool.started' || typeof event.tool !== 'string') continue
          count++
          const label = w.doing?.[event.tool] || w.using(event.tool.replace(/^najd-/, ''))
          const detail = typeof event.detail === 'string' && event.detail.trim() ? shortDetail(event.tool, event.detail.trim()) : ''
          lines.push(detail ? `${label}: ${detail}` : label)
          if (lines.length > 6) lines.shift()
        }
        if (!count || cleared) return
        const text = [w.working, '', ...lines, '', w.steps(count)].join('\n')
        if (text === shown || now() - lastEdit < 1500) return
        shown = text; lastEdit = now()
        if (messageId === null) { const sent = await api.sendMessage(chatId, text).catch(() => null); messageId = sent?.message_id ?? -1 }
        else if (messageId > 0) await api.editMessageText(chatId, messageId, text).catch(() => {})
      },
      async clear() { cleared = true; if (messageId > 0 && api.deleteMessage) await api.deleteMessage(chatId, messageId).catch(() => {}); messageId = -1 }
    }
  }

  // assets: pictures the owner sent with this message, already in the library ({ id, name }); they reach the model as images.
  // reserved: the caller holds this chat's reservation (a photo that was downloading); every other message waits for it.
  // alreadySaved: the text is already in the conversation (messages added during the previous task that it never read).
  async function runMessage(chat, text, telegram, userId, loopEpoch = epoch, assets = [], reserved = false, { alreadySaved = false } = {}) {
    const w = words(telegram)
    if (running.has(chat.id) || (preparing.has(chat.id) && !reserved)) { await say(chat.id, w.busy); return false }
    if (!telegram.provider || !telegram.model) { await say(chat.id, w.notConfigured); return false }
    const entry = { taskId: null, typing: null, revoked: false, sessionId: null, pendingNotes: [], unsavedNotes: [] }
    let leftover = []
    running.set(chat.id, entry)
    const progress = createProgress(chat.id, w)
    const typing = setInterval(() => { void api.sendChatAction(chat.id).catch(() => {}) }, 4500)
    entry.typing = typing
    try {
      let sessionId = telegram.sessions[chat.id], session = sessionId ? await sessions.getSession(sessionId).catch(() => null) : null
      let first = false
      if (!session) { session = await sessions.createSession(); sessionId = session.id; first = true; await update(async value => { value.sessions[chat.id] = sessionId }) }
      entry.sessionId = sessionId
      // The most recent turns that fit a generous character budget (the runtime then fits them to the model's own window).
      const past = []
      let size = text.length
      for (const { role, text: body } of [...session.messages].reverse()) { if (past.length >= 300 || size + body.length > 1500000) break; past.unshift({ role, text: body }); size += body.length }
      // The core validates the request first; the message is saved only when the task really started.
      // Still authorized, and the channel still on, at the moment the task starts.
      const current = (await serial(read)).telegram
      if (entry.revoked || loopEpoch !== epoch || !current.allowed.some(item => item.chatId === chat.id && (item.userId === null || item.userId === (userId ?? null)))) return false
      const started = core.startTask({ text, intentId: randomUUID(), provider: telegram.provider, modelName: telegram.model, history: [...past, { role: 'user', text }], reasoningEffort: 'auto', assetIds: assets.map(item => item.id), conversationId: sessionId, profile: null, accessMode: telegram.accessMode })
      entry.taskId = started.id // recorded before anything else is awaited, so a revoke can always find the task
      ownTasks.add(started.id); if (ownTasks.size > 300) ownTasks.delete(ownTasks.values().next().value)
      // Messages added before the task had an id join it now.
      for (const note of entry.pendingNotes.splice(0)) { try { core.addNote(started.id, note) } catch { leftover.push(note) } }
      if (entry.revoked) { try { core.cancelTask(started.id) } catch { /* already finished */ } return true }
      if (!alreadySaved) await sessions.appendMessage(sessionId, 'user', first ? '\u{1F4F1} ' + text : text, undefined, assets.length ? assets : undefined).catch(() => {})
      // Messages added before the conversation existed are saved now, once, after the message they follow (C10-02).
      for (const note of entry.unsavedNotes.splice(0)) await sessions.appendMessage(sessionId, 'user', note).catch(() => {})
      entry.mainSaved = true
      for (const note of entry.unsavedNotes.splice(0)) await sessions.appendMessage(sessionId, 'user', note).catch(() => {})
      onActivity({ sessionId })
      let task = started
      for (;;) {
        task = core.getTask(started.id)
        settleCards(task)
        await progress.update(task)
        if (task.state === 'WAITING_APPROVAL' && task.approvalId && !approvals.has(task.approvalId)) await askApproval(chat.id, task, telegram)
        if (TERMINAL.has(task.state)) break
        await sleep(pollMs)
      }
      await progress.clear()
      leftover.push(...(Array.isArray(task.unreadNotes) ? task.unreadNotes : []))
      const output = typeof task.output === 'string' ? task.output.trim() : ''
      if (output && ['COMPLETED', 'UNKNOWN_EFFECT'].includes(task.state)) { await sessions.appendMessage(sessionId, 'assistant', output).catch(() => {}); onActivity({ sessionId }) }
      if (task.state === 'COMPLETED') await sayReply(chat.id, output || w.empty, undefined, task.images || [])
      else if (task.state === 'CANCELLED') await say(chat.id, w.cancelled)
      else if (task.state === 'UNKNOWN_EFFECT') await sayReply(chat.id, [output, w.unknown].filter(Boolean).join('\n\n'), undefined, task.images || [])
      else await say(chat.id, w.failed(task.errorCode || 'FAILED'))
      return true
    } catch (error) {
      await say(chat.id, w.failed(error?.code || 'FAILED'))
      return !!entry.taskId
    } finally {
      await progress.clear()
      clearInterval(typing); if (running.get(chat.id) === entry) running.delete(chat.id)
      leftover.push(...entry.pendingNotes.splice(0))
      // Messages never saved (the task ended before its first message was saved) are saved now, or, without a conversation, by the next request.
      let leftoverSaved = true
      if (entry.unsavedNotes.length) { if (entry.sessionId) { for (const note of entry.unsavedNotes.splice(0)) await sessions.appendMessage(entry.sessionId, 'user', note).catch(() => {}) } else leftoverSaved = false }
      // What the owner added that this task never read (it ended first) becomes the next request right after, so nothing is lost.
      if (leftover.length && !entry.revoked && loopEpoch === epoch) {
        const next = leftover.join('\n\n')
        setImmediate(() => { void (async () => {
          // If another task took the chat meanwhile, the text joins it; otherwise it is the next request, in the same conversation (the
          // settings are read again: the first message may have just created it).
          const other = running.get(chat.id)
          if (other && other.taskId) { try { core.addNote(other.taskId, next); return } catch { /* ended: start a new request */ } }
          const fresh = (await serial(read)).telegram
          await runMessage(chat, next, fresh, userId, loopEpoch, [], false, { alreadySaved: leftoverSaved })
        })().catch(() => {}) })
      }
    }
  }

  async function handleMessage(message, settings, loopEpoch = epoch) {
    const telegram = settings
    const chat = message.chat
    if (!chat || chat.type !== 'private') return
    if (typeof message.date === 'number' && now() / 1000 - message.date > STALE_SECONDS) return
    // Authorization binds the chat AND the Telegram user who paired it.
    const allowed = telegram.allowed.some(item => item.chatId === chat.id && (item.userId === null || item.userId === (message.from?.id ?? null)))
    if (!allowed) { await handlePairing(message, telegram); return }
    const w = words(telegram), text = typeof message.text === 'string' ? message.text.trim() : ''
    // A picture (a photo, or an image sent as a file) with its caption: imported into the library and given to the model as an image.
    const picture = Array.isArray(message.photo) && message.photo.length ? message.photo.at(-1)
      : message.document && /^image\/(png|jpeg|webp|gif)$/.test(String(message.document.mime_type || '')) ? message.document : null
    if (picture && !text) {
      if (!importImage || !api.downloadFile) { await say(chat.id, w.textOnly); return }
      const item = { picture, mime: message.document ? message.document.mime_type : 'image/jpeg' }
      const caption = typeof message.caption === 'string' ? message.caption.trim().slice(0, 4000) : ''
      // Telegram sends an album as one message per picture with the same media_group_id (the caption on one of them): they are
      // gathered for a moment and handled as one request.
      if (typeof message.media_group_id === 'string' && /^\w{1,64}$/.test(message.media_group_id)) {
        const key = chat.id + ':' + message.media_group_id
        const album = albums.get(key) || { items: [], caption: '', timer: null }
        if (album.items.length < MAX_ALBUM) album.items.push(item)
        if (caption && !album.caption) album.caption = caption
        clearTimeout(album.timer)
        album.timer = setTimeout(() => { albums.delete(key); void handlePictures(chat, album.items, album.caption, telegram, message.from?.id, loopEpoch).catch(() => {}) }, albumWaitMs)
        album.timer.unref?.()
        albums.set(key, album)
        return
      }
      await handlePictures(chat, [item], caption, telegram, message.from?.id, loopEpoch)
      return
    }
    if (!text) { await say(chat.id, w.textOnly); return }
    const command = /^\/(\w+)(?:@\w+)?\s*$/.exec(text)?.[1]?.toLowerCase()
    if (command === 'start' || command === 'help') { await say(chat.id, w.help); return }
    if (command === 'status') { await say(chat.id, w.status(`${telegram.provider || '-'} / ${telegram.model || '-'}`, telegram.accessMode, running.has(chat.id))); return }
    if (command === 'stop') {
      const current = running.get(chat.id)
      if (!current) { await say(chat.id, w.nothingRunning); return }
      current.revoked = true // a request still preparing is stopped before it starts
      if (current.taskId) { try { core.cancelTask(current.taskId) } catch { /* already finished */ } }
      await say(chat.id, w.stopped); return
    }
    if (command === 'new') { await update(async value => { delete value.sessions[chat.id] }); await say(chat.id, w.newChat); return }
    if (command === 'pair') { await say(chat.id, w.help); return }
    if (command === 'chats' || command === 'open') { await listChats(chat.id, telegram); return }
    if (command === 'model' || command === 'models') { await listProviders(chat.id, telegram); return }
    // A message sent while a task works joins that task (the agent reads it at its next step) instead of being turned away.
    const current = running.get(chat.id)
    if (current && !current.revoked && !preparing.has(chat.id)) { await addToRunning(chat, current, text, telegram); return }
    await runMessage(chat, text, telegram, message.from?.id, loopEpoch)
  }

  // Pictures the owner sent (one photo, or an album), imported into the library and given to the model as images with the caption.
  // Nothing is downloaded or kept unless they can be worked on now: the chat is free (and stays reserved while they download,
  // C6-01) and a model is chosen (C5-02); if one fails or the task never starts, the ones already imported are removed.
  async function handlePictures(chat, items, caption, telegram, userId, loopEpoch) {
    const w = words(telegram)
    if (items.some(item => Number(item.picture.file_size) > 10 * 1024 * 1024)) { await say(chat.id, w.photoTooBig); return }
    if (running.has(chat.id) || preparing.has(chat.id)) { await say(chat.id, w.busy); return }
    if (!telegram.provider || !telegram.model) { await say(chat.id, w.notConfigured); return }
    // Still paired, and the channel still the one that received them, right before anything is downloaded (an album waits a moment, C8-01).
    const current = (await serial(read)).telegram
    if (loopEpoch !== epoch || !current.allowed.some(item => item.chatId === chat.id && (item.userId === null || item.userId === (userId ?? null)))) return
    if (running.has(chat.id) || preparing.has(chat.id)) { await say(chat.id, w.busy); return }
    preparing.add(chat.id)
    const assets = []
    const discard = () => Promise.all(assets.map(asset => removeImage ? Promise.resolve().then(() => removeImage(asset.id)).catch(() => {}) : null))
    try {
      for (const [index, item] of items.entries()) {
        const { bytes } = await api.downloadFile(item.picture.file_id)
        const extension = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' }[item.mime] || 'jpg'
        const name = `Telegram photo ${new Date(now()).toISOString().slice(0, 19).replace(/[:T]/g, '-')}${items.length > 1 ? '-' + (index + 1) : ''}.${extension}`
        const asset = await importImage(name, bytes)
        assets.push({ id: asset.id, name: String(asset.name || 'photo').slice(0, 120) })
      }
    } catch (error) { preparing.delete(chat.id); await discard(); await say(chat.id, error?.code === 'FILE_TOO_LARGE' ? w.photoTooBig : w.photoFailed); return }
    // The reservation is held until the task has taken the chat's slot (running), so no other message can start in between.
    let started = false
    try { started = await runMessage(chat, caption || w.photoAsk, telegram, userId, loopEpoch, assets, true) }
    finally { preparing.delete(chat.id) }
    if (!started) await discard()
  }

  // ---------- remote control: conversations and models ----------
  const titleOf = session => (session?.title || '').trim()
  async function listChats(chatId, telegram) {
    const w = words(telegram)
    const list = (await sessions.listSessions().catch(() => [])).filter(item => SESSION_ID.test(item.id)).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0, MAX_LISTED)
    if (!list.length) { await say(chatId, w.noChats); return }
    const current = telegram.sessions[chatId]
    await api.sendMessage(chatId, w.chats, { reply_markup: { inline_keyboard: list.map(item => [{ text: (item.id === current ? '● ' : '') + (titleOf(item) || w.untitled).slice(0, 48), callback_data: 'o:' + item.id }]) } }).catch(() => null)
  }
  // The last turns of an opened conversation, so the owner sees where it stands (secrets masked, each turn cut short).
  async function openChat(chatId, sessionId, telegram) {
    const w = words(telegram)
    const session = await sessions.getSession(sessionId).catch(() => null)
    if (!session) { await say(chatId, w.gone); return }
    await update(async value => { value.sessions[chatId] = sessionId })
    // Pictures in a turn are named, not spelled out (their library address would read as a masked secret).
    const recap = session.messages.slice(-2).map(message => { const { text: body, ids } = takeImages(String(message.text)); return `${message.role === 'user' ? w.you : w.najd}: ${redactText(body, 700)}${ids.length || message.attachments?.length ? ' \u{1F5BC}' : ''}` }).join('\n\n')
    await sayReply(chatId, w.opened(titleOf(session) || w.untitled) + (recap ? '\n\n' + recap : ''))
  }
  const modelMenus = new Map() // chatId -> { provider, ids } (model ids can be longer than a button's data)
  async function listProviders(chatId, telegram) {
    const w = words(telegram)
    const configured = providers ? (await providers.catalog().catch(() => [])).filter(p => p.kind !== 'union' && p.configured) : []
    // A local server (LM Studio, vLLM, ...) is offered only when it answers with models now; a quick check, two and a half seconds at most.
    const answers = async id => { let timer; try { return await Promise.race([providers.models(id).then(list => Array.isArray(list) && list.length > 0, () => false), new Promise(resolve => { timer = setTimeout(() => resolve(false), 2500) })]) } finally { clearTimeout(timer) } }
    const reachable = await Promise.all(configured.map(p => p.kind === 'local' ? answers(p.id) : true))
    const list = configured.filter((_, index) => reachable[index])
    if (!list.length) { await say(chatId, w.noProviders); return }
    await api.sendMessage(chatId, w.providers(`${telegram.provider || '-'} / ${telegram.model || '-'}`), { reply_markup: { inline_keyboard: list.slice(0, 20).map(p => [{ text: (p.id === telegram.provider ? '● ' : '') + p.name, callback_data: 'p:' + p.id }]) } }).catch(() => null)
  }
  async function listModels(chatId, providerId, telegram) {
    const w = words(telegram)
    if (!providers || !providerIds.includes(providerId)) return
    const list = (await providers.models(providerId).catch(() => [])).filter(m => typeof m?.id === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/.test(m.id)).slice(0, MAX_MODELS)
    if (!list.length) { await say(chatId, w.noModels); return }
    modelMenus.set(chatId, { provider: providerId, ids: list.map(m => m.id) })
    const rows = []
    for (let i = 0; i < list.length; i += 2) rows.push(list.slice(i, i + 2).map((m, j) => ({ text: ((m.id === telegram.model && providerId === telegram.provider) ? '● ' : '') + String(m.label || m.id).slice(0, 30), callback_data: 'm:' + (i + j) })))
    await api.sendMessage(chatId, w.models(providerId), { reply_markup: { inline_keyboard: rows } }).catch(() => null)
  }

  async function handleCallback(query, settings) {
    const chatId = query.message?.chat?.id
    const allowed = settings.allowed.some(item => item.chatId === chatId && (item.userId === null || item.userId === (query.from?.id ?? null)))
    const w = words(settings)
    if (allowed && typeof query.data === 'string') {
      const open = /^o:([0-9a-f-]{36})$/.exec(query.data), provider = /^p:([a-z0-9-]{1,40})$/.exec(query.data), model = /^m:(\d{1,2})$/.exec(query.data)
      if (open || provider || model) {
        await api.answerCallbackQuery(query.id).catch(() => {})
        if (open && SESSION_ID.test(open[1])) await openChat(chatId, open[1], settings)
        else if (provider) await listModels(chatId, provider[1], settings)
        else if (model) {
          const menu = modelMenus.get(chatId), id = menu?.ids[Number(model[1])]
          if (!id) { await say(chatId, w.expired); return }
          await update(async value => { value.provider = menu.provider; value.model = id })
          modelMenus.delete(chatId)
          await say(chatId, w.modelSet(menu.provider, id))
        }
        return
      }
    }
    const match = /^a:([0-9a-f-]{36}):([ytn])$/.exec(query.data || '')
    if (!allowed || !match) { await api.answerCallbackQuery(query.id).catch(() => {}); return }
    const pending = approvals.get(match[1])
    if (!pending || pending.chatId !== chatId) { await api.answerCallbackQuery(query.id, w.expired).catch(() => {}); await clearCard(chatId, query.message?.message_id, null); return }
    approvals.delete(match[1]); clearTimeout(pending.timer)
    const decision = { y: 'ALLOW_ONCE', t: 'ALLOW_TASK', n: 'DENY' }[match[2]]
    try { core.respondApproval(match[1], decision) } catch { await api.answerCallbackQuery(query.id, w.expired).catch(() => {}); await clearCard(chatId, pending.messageId, null); return }
    const note = decision === 'DENY' ? w.denied : decision === 'ALLOW_TASK' ? w.allowedTask : w.allowed
    // The answer shows as a brief notice on the phone and the card leaves the chat (the decision stays in NAJD's activity record).
    await api.answerCallbackQuery(query.id, note).catch(() => {})
    await clearCard(chatId, pending.messageId, (query.message?.text || '') + '\n\n' + note)
  }

  // ---------- work on the computer, told on the phone when the owner asks ----------
  // Work the owner does on the computer stays on the computer: it is told here only when that request (or a message added to it) asks for Telegram
  // ("when you finish, send it to me on Telegram"), and then the answer, or a permission request, goes to the chat following that conversation, else every paired chat.
  // A conversation continued on Telegram (/open) reports itself through the channel's own tasks.
  const seenStates = new Map() // taskId -> last state told (bounded)
  async function taskChanged({ taskId, conversationId }) {
    if (!api || state.state !== 'running' || typeof conversationId !== 'string' || !SESSION_ID.test(conversationId)) return
    if (ownTasks.has(taskId)) return // the channel's own task reports itself
    let task
    try { task = core.getTask(taskId) } catch { return }
    settleCards(task)
    if (!task.channelNotice) return
    // State and request together: two permission requests in a row are two changes.
    const previous = seenStates.get(taskId), key = task.state + ':' + (task.approvalId || '')
    if (previous === key) return
    seenStates.set(taskId, key)
    if (seenStates.size > 300) seenStates.delete(seenStates.keys().next().value)
    const settings = (await serial(read)).telegram // the loop runs only while the channel is enabled
    if (state.state !== 'running') return
    const w = words(settings)
    const paired = settings.allowed.map(item => item.chatId)
    const followers = paired.filter(chatId => settings.sessions[chatId] === conversationId)
    const targets = followers.length ? followers : paired
    if (!targets.length) return
    const title = titleOf(await sessions.getSession(conversationId).catch(() => null)) || w.untitled
    const openButton = chatId => followers.includes(chatId) ? undefined : { reply_markup: { inline_keyboard: [[{ text: w.open, callback_data: 'o:' + conversationId }]] } }
    if (task.state === 'WAITING_APPROVAL' && task.approvalId && !approvals.has(task.approvalId)) {
      await say(targets[0], w.approvalOn(title))
      await askApproval(targets[0], task, settings, { relayed: true })
    } else if (TERMINAL.has(task.state)) {
      // The last state stays remembered (bounded), so a later report of the same ended task is not told twice.
      const output = typeof task.output === 'string' ? task.output.trim() : ''
      const ok = task.state === 'COMPLETED' || task.state === 'UNKNOWN_EFFECT'
      for (const chatId of targets) {
        if (ok) await sayReply(chatId, `**${w.finished(title)}**\n\n${output || w.empty}${task.state === 'UNKNOWN_EFFECT' ? '\n\n' + w.unknown : ''}`, openButton(chatId), task.images || [])
        else await say(chatId, task.state === 'CANCELLED' ? `${title}: ${w.cancelled}` : w.failedOn(title, task.errorCode || 'FAILED'), openButton(chatId))
      }
    }
  }
  // ---------- the polling loop ----------
  async function loop(signal) {
    let offset = 0, delay = 1000
    // Messages sent while NAJD was off are dropped: the backlog is skipped before anything is handled.
    // Nothing is handled until this succeeds, so a failed first request never lets old messages through.
    for (;;) {
      try { const backlog = await api.getUpdates(-1, signal, 0); if (backlog.length) offset = backlog.at(-1).update_id + 1; break } catch (error) { if (signal.aborted) return; state.errorCode = error.code; await sleep(Math.min(delay, 5000)); delay = Math.min(delay * 2, 30000) }
    }
    delay = 1000
    const myEpoch = epoch
    while (!signal.aborted) {
      try {
        const updates = await api.getUpdates(offset, signal, longPollSeconds)
        state.state = 'running'; state.errorCode = null; delay = 1000
        for (const item of updates) {
          if (signal.aborted || myEpoch !== epoch) return
          offset = item.update_id + 1
          const settings = (await serial(read)).telegram
          if (signal.aborted || myEpoch !== epoch) return
          // Handled without waiting, so a long task never blocks the next update (an approval answer or /stop).
          if (item.message) void handleMessage(item.message, settings, myEpoch).catch(() => {})
          else if (item.callback_query) void handleCallback(item.callback_query, settings).catch(() => {})
        }
      } catch (error) {
        if (signal.aborted) return
        state.errorCode = error.code || 'NETWORK'
        if (['INVALID_TOKEN'].includes(error.code)) { state.state = 'error'; return }
        state.state = error.code === 'CONFLICT' ? 'error' : 'running'
        await sleep(Math.min(30000, error.retryAfter ? error.retryAfter * 1000 : delay)); delay = Math.min(30000, delay * 2)
      }
    }
  }

  const setCommandMenu = language => api.setMyCommands(language === 'ar'
    ? [{ command: 'chats', description: 'فتح محادثة' }, { command: 'new', description: 'محادثة جديدة' }, { command: 'model', description: 'تغيير النموذج' }, { command: 'stop', description: 'إيقاف المهمة الحالية' }, { command: 'status', description: 'الإعداد الحالي' }, { command: 'help', description: 'المساعدة' }]
    : [{ command: 'chats', description: 'Open a conversation' }, { command: 'new', description: 'New conversation' }, { command: 'model', description: 'Change the model' }, { command: 'stop', description: 'Stop the current task' }, { command: 'status', description: 'Show the setup' }, { command: 'help', description: 'Help' }]).catch(() => {})

  async function start() {
    await stop()
    const settings = (await serial(read)).telegram
    const token = await tokenStore.readKey().catch(() => null)
    if (!settings.enabled || !token) return status()
    state.state = 'starting'; state.errorCode = null
    try { api = makeApi({ token }) } catch (error) { state.state = 'error'; state.errorCode = error.code; return status() }
    loopController = new AbortController()
    loopPromise = (async () => {
      try {
        const me = await api.getMe(loopController.signal)
        state.botName = me?.username ? '@' + me.username : null
        await setCommandMenu(settings.language)
        await loop(loopController.signal)
      } catch (error) { if (!loopController?.signal.aborted) { state.state = 'error'; state.errorCode = error.code || 'NETWORK' } }
    })()
    return status()
  }
  // Stopping the channel or revoking a chat ends its work: running tasks are cancelled and pending approvals denied, so nothing continues after the owner took access away.
  function revoke(chatId) {
    for (const [id, item] of [...approvals]) if (chatId === undefined || item.chatId === chatId) { clearTimeout(item.timer); approvals.delete(id); try { core.respondApproval(id, 'DENY') } catch { /* already answered */ } }
    for (const [chat, item] of [...running]) if (chatId === undefined || chat === chatId) { item.revoked = true; if (item.taskId) { try { core.cancelTask(item.taskId) } catch { /* already finished */ } } clearInterval(item.typing) }
    // Albums still gathering are dropped without downloading anything.
    for (const [key, album] of [...albums]) if (chatId === undefined || key.startsWith(chatId + ':')) { clearTimeout(album.timer); albums.delete(key) }
  }
  let epoch = 0 // every stop starts a new epoch: updates fetched before it can no longer start work
  async function stop({ cancel = false } = {}) {
    epoch++
    for (const [key, album] of [...albums]) { clearTimeout(album.timer); albums.delete(key) } // received before the stop: never downloaded
    if (cancel) revoke()
    if (loopController) loopController.abort()
    const pendingLoop = loopPromise
    loopController = null; loopPromise = null
    await pendingLoop?.catch(() => {})
    // Without `cancel` (a restart of the loop) work that is already running keeps its state; the api object is replaced only when the loop starts again.
    if (cancel) { for (const [, item] of running) { item.revoked = true; clearInterval(item.typing) } }
    state.state = 'stopped'
  }

  async function status() {
    const settings = (await serial(read)).telegram
    const tokenState = await tokenStore.status().catch(() => ({ saved: false }))
    return { tokenSaved: !!tokenState.saved, enabled: settings.enabled, state: state.state, errorCode: state.errorCode, botName: state.botName || settings.botName, provider: settings.provider, model: settings.model,
      accessMode: settings.accessMode, language: settings.language, notify: settings.notify !== false, allowed: settings.allowed.map(({ chatId, name, pairedAt }) => ({ chatId, name, pairedAt })),
      pairing: pairingOpen() ? { code: pairing.code, expiresAt: new Date(pairing.expiresAt).toISOString() } : null }
  }

  return {
    status,
    start,
    stop,
    dispose: () => stop({ cancel: true }),
    // Saves the token after Telegram accepts it (getMe); the token never leaves the encrypted store.
    async saveToken(token) {
      const probe = makeApi({ token })
      const me = await probe.getMe().catch(error => { throw fail(error.code === 'INVALID_TOKEN' ? 'INVALID_TOKEN' : 'NETWORK') })
      await tokenStore.saveKey(token)
      await update(async value => { value.botName = me?.username ? '@' + me.username : null })
      // A replacement token takes over at once: the old bot stops (its work is cancelled) and the channel restarts with the new one.
      if ((await serial(read)).telegram.enabled) { await stop({ cancel: true }); await start() }
      return status()
    },
    async clearToken() { await stop({ cancel: true }); await tokenStore.clearKey(); await update(async value => { value.enabled = false; value.botName = null }); return status() },
    async configure(input) {
      await update(async value => {
        if (input.provider !== undefined) { if (input.provider !== null && !providerIds.includes(input.provider)) throw fail('INVALID_INPUT'); value.provider = input.provider }
        if (input.model !== undefined) { if (input.model !== null && !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/.test(input.model)) throw fail('INVALID_INPUT'); value.model = input.model }
        if (input.accessMode !== undefined) { if (!['ask', 'approve', 'full'].includes(input.accessMode)) throw fail('INVALID_INPUT'); value.accessMode = input.accessMode }
        if (input.language !== undefined) { if (!['ar', 'en'].includes(input.language)) throw fail('INVALID_INPUT'); value.language = input.language }
        if (input.enabled !== undefined) { if (typeof input.enabled !== 'boolean') throw fail('INVALID_INPUT'); value.enabled = input.enabled }
        if (input.notify !== undefined) { if (typeof input.notify !== 'boolean') throw fail('INVALID_INPUT'); value.notify = input.notify }
      })
      // The command menu follows the reply language.
      if (input.language !== undefined && api && state.state === 'running') await setCommandMenu(input.language)
      // Model, access and language changes apply to the next message without restarting; only switching on, off or recovering from an error (re)starts the loop.
      const enabled = (await serial(read)).telegram.enabled
      if (!enabled) await stop({ cancel: true })
      else if (!loopController || state.state === 'error' || state.state === 'stopped') await start()
      return status()
    },
    startPairing: () => { if (state.state !== 'running') throw fail('NOT_RUNNING'); return { ...openPairing(), botName: state.botName } },
    // Called for every task change in the core (main.cjs); never throws.
    // Handled after the current call returns: the core can report a task inside startTask, before the channel has recorded it as its own.
    taskChanged: change => { setImmediate(() => { void taskChanged(change || {}).catch(() => {}) }) },
    // The authorization is removed first and work is revoked afterwards, so a request that was already being dispatched meets the removed entry when it rechecks.
    async unpair(chatId) { await update(async value => { value.allowed = value.allowed.filter(item => item.chatId !== chatId); delete value.sessions[chatId] }); revoke(chatId); return status() },
    // For tests.
    _handle: async update_ => { const settings = (await serial(read)).telegram; if (update_.message) await handleMessage(update_.message, settings); else if (update_.callback_query) await handleCallback(update_.callback_query, settings) },
    _handleWith: (message, settings) => handleMessage(message, settings),
    _setApi: value => { api = value; state.state = 'running' }
  }
}
module.exports = { createChannelGateway, WORDS, chunks }
