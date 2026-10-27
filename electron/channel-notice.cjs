// Work started on the computer is told on Telegram only when the owner asks for it in that request or a message added to it
// ("when you finish, send it to me on Telegram"); a chat the owner opened on Telegram reports itself.
// The ask must be the owner's own positive instruction (C16-01 .. C19-01): in one sentence, Telegram as the destination, a verb
// of sending or telling, and the owner as the receiver in explicit words, with no negation, no reported speech and no question.
// Quoted text, code, lines quoted with ">", and the middle of a long pasted text never count. When in doubt nothing is sent: a
// missed notice is better than an answer sent where the owner did not want it, and the only receivers are the owner's own paired chats.
const NAMES = 'تلجرام|تلقرام|تلغرام|تليجرام|تليقرام|تليغرام|تيليجرام|تيليقرام|تيليغرام|تيلجرام|تيلقرام|تيلغرام'
// Telegram as the destination: "on/via/through/over/by/to Telegram", "على/في/عبر التلجرام", "بالتلجرام", "عالتلجرام".
const TELEGRAM = new RegExp(`\\b(on|via|through|over|by|to|in)\\s+(the\\s+)?(my\\s+)?telegram\\b|(^|\\s)(على|في|عبر|ع)\\s*(ال)?(${NAMES})|(^|\\s)(بال|ب|عال|فال)(${NAMES})`, 'i')
const SEND = /\b(send|tell|notify|message|ping|report|let me know|forward)\b|رسل|بعث|ابعث|بلغ|بلّغ|نبه|نبّه|علمني|علّمني|خبرني|خبّرني|قل لي|قول لي|قولي|حط|حطه|حطها/i
// The owner as the receiver, said in so many words (C18-01).
const ME = /\b(to me|send me|tell me|notify me|message me|ping me|let me know|forward me|me on telegram)\b|(^|\s)(لي|إلي|عندي)(?=\s|$)|(^|\s)\S*(رسل|بعث)(ه|ها|هم)?(لي|ني)(?=\s|$)|(نبه|نبّه|علم|علّم|خبر|خبّر|بلغ|بلّغ|طمن|طمّن|ذكر|ذكّر|كلم|كلّم)ني(?=\s|$)/i
// "بعد ما / أول ما / لين ما / لما" mean "when", not "not".
const WHEN = /(بعد|اول|أول|لين|الين|إلى|الى|حتى|كل)\s+ما(?=\s)/g
const NOT = /\b(don'?t|do not|never|not|no|without|avoid|stop)\b|(^|\s)(لا|ما|مو|مب|ماني|بدون|دون|ممنوع|إياك|اياك|غير)(?=\s|$)|(^|\s)(لا|ما)ت?(رسل|ترسل|بعث|تبعث|بلغ|تبلغ|نبه|تنبه|تعلم|تقول|تحط)/i
const REPORTED = /\b(said|says|say|wrote|writes|asked|asks|told|quote|quoted|according)\b|(^|\s)(قال|قالت|يقول|تقول|يقولون|كتب|كتبت|يكتب|طلب|طلبت|يطلب|حسب|مكتوب|يبي|تبي|يبغى|تبغى)(?=\s|$)/i
// A question about Telegram (how to use it, what it is) is not an ask to be told there.
const QUESTION = /\b(how|what|why|which|where|can|could|would|is|are|does|about|explain)\b|(^|\s)(كيف|وش|ايش|إيش|شلون|ليش|هل|وين|اشرح|اشرحلي|عرفني|عن)(?=\s|$)/i
const QUOTED = /```[\s\S]*?```|`[^`\n]*`|"[^"\n]*"|“[^”\n]*”|«[^»\n]*»|„[^“”\n]*[“”]|'[^'\n]{3,}'|‘[^’\n]*’|^\s*>.*$/gm
const EDGE = 400 // a long text is mostly pasted material: only its opening and closing words are the owner's instruction
function asksForChannelNotice(text) {
  if (typeof text !== 'string') return false
  const own = text.length > EDGE * 2 ? text.slice(0, EDGE) + '\n' + text.slice(-EDGE) : text
  return own.replace(QUOTED, '\n').replace(WHEN, ' ').split(/[.!?؟،,;؛\n]+/)
    .some(sentence => TELEGRAM.test(sentence) && SEND.test(sentence) && ME.test(sentence) && !NOT.test(sentence) && !REPORTED.test(sentence) && !QUESTION.test(sentence))
}
module.exports = { asksForChannelNotice }
