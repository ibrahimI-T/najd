import { Map as MapIcon } from 'lucide-react'
import { CardHeading } from './ui'

// What NAJD does. A feature is listed only when it works in this build; nothing unavailable is advertised.
type Feature = { ar: [string, string]; en: [string, string] }

export const AVAILABLE: Feature[] = [
  { ar: ['محادثة ذكية بأقوى النماذج', 'استخدم اشتراكك في ChatGPT أو مفتاح API أو نموذجًا محليًا، واختر مستوى التفكير المناسب لكل مهمة، بواجهة عربية وإنجليزية كاملة.'],
    en: ['Intelligent chat with leading models', 'Use your ChatGPT plan, an API key or a local model, choose the right depth of thinking for each task, in a fully Arabic and English interface.'] },
  { ar: ['ينجز على جهازك مباشرة', 'يفتح أي برنامج مثبت عندك، ويقرأ النوافذ ويتحكم بها، ويلتقط الشاشة، ويشغّل الأوامر وPython لإنجاز المهمة كاملة.'],
    en: ['Gets work done on your computer', 'Opens any installed app, reads and operates windows, captures the screen, and runs commands and Python to finish the whole task.'] },
  { ar: ['ملفاتك كلها في متناوله', 'يقرأ ويبحث وينشئ ويعدّل الملفات في أي مكان تسمح به، مع سجل لكل تغيير وإمكانية الاستعادة.'],
    en: ['All your files within reach', 'Reads, searches, creates and edits files wherever you allow, with a record of every change and the ability to restore.'] },
  { ar: ['يفهم مرفقاتك', 'PDF وWord وExcel وPowerPoint والصور ومقاطع الفيديو، حتى عشرين ملفًا في الرسالة الواحدة.'],
    en: ['Understands your attachments', 'PDF, Word, Excel, PowerPoint, images and video, up to twenty files in a single message.'] },
  { ar: ['يكمّل نفسه بنفسه', 'إذا احتاج قدرة غير موجودة، يبحث عنها في سجل MCP الرسمي ومستودعات المهارات، ويثبتها بعد موافقتك ويستخدمها فورًا.'],
    en: ['Extends itself', 'When a task needs something NAJD does not have, it finds it in the official MCP Registry and skill repositories, installs it with your approval and uses it right away.'] },
  { ar: ['ذاكرة تمتد عبر محادثاتك', 'يتذكر تفضيلاتك وأسلوب عملك، ويرجع إلى محادثاتك السابقة متى احتجت.'],
    en: ['Memory across your chats', 'Remembers your preferences and how you work, and draws on your earlier chats whenever you need.'] },
  { ar: ['قواعد المعرفة', 'أضف مراجعك، مثل سياسات شركتك أو اللوائح والمعايير التي تنطبق عليك، فيبحث فيها نجد ويجيب منها مع ذكر المستند، ويطابق مستنداتك معها ويوضح ما يخالفها والتعديل المقترح.'],
    en: ['Knowledge bases', 'Add your references, such as company policies or the regulations and standards that apply to you; NAJD searches them, answers with the document named, and checks your documents against them with what does not comply and what to change.'] },
  { ar: ['المهارات والإضافات', 'أكثر من مئة مهارة جاهزة وإضافات احترافية، مثل حزمة Office والتصميم.'],
    en: ['Skills and plugins', 'More than a hundred ready skills and professional plugins, such as the Office and design pack.'] },
  { ar: ['الاتصالات', 'اربط نجد بأي خادم MCP ليعمل مع خدماتك وأدواتك.'], en: ['Connections', 'Connect NAJD to any MCP server so it works with your services and tools.'] },
  { ar: ['صلاحيات بيدك', 'ثلاثة أوضاع: يستأذنك في كل خطوة، أو ينجز الآمن وحده، أو وصول كامل لإنجاز المهمة دون توقف.'],
    en: ['Permissions in your hands', 'Three modes: ask at every step, handle safe actions alone, or full access to finish tasks without stopping.'] },
  { ar: ['الأدوات', 'صفحة واحدة تعرض كل أدوات نجد وحالتها وما يحتاج موافقتك.'], en: ['Tools', 'One page showing every NAJD tool, its status and what needs your approval.'] },
  { ar: ['حزمة Office والتصميم', 'مستندات وجداول وعروض تقديمية احترافية دون الحاجة إلى Microsoft Office، تُراجَع في Office عند توفره.'],
    en: ['Office and design pack', 'Professional documents, workbooks and presentations without Microsoft Office, reviewed in Office when it is installed.'] },
  { ar: ['التكامل مع المتصفح', 'يتصفح نجد عبر إضافته في Chrome أو Edge: يبحث ويفتح ويقرأ في تبويب خاص به، ويطلب موافقتك قبل الكتابة والنقر.'],
    en: ['Browser integration', 'NAJD browses through its extension in Chrome or Edge: it searches, opens and reads in its own tab, and asks for your approval before typing or clicking.'] },
  { ar: ['الحسابات المفوّضة', 'تسجّل الدخول نيابةً عنك إلى الحسابات التي تفوّضها، وكلمات المرور في مخزن ويندوز المحمي ولا تصل إلى النموذج.'],
    en: ['Authorized accounts', 'Signs in for you to the accounts you authorize; passwords stay in Windows protected storage and never reach the model.'] },
  { ar: ['خدمات الطرف الثالث', 'اربط Canva وfal وReplicate وElevenLabs وغيرها لإنشاء التصاميم والصور والفيديو والصوت من داخل المحادثة.'],
    en: ['Third-party services', 'Connect Canva, fal, Replicate, ElevenLabs and more to create designs, images, video and audio from inside the chat.'] },
  { ar: ['الوكلاء الفرعيون', 'مهام تعمل في الخلفية مع متابعة حالتها وإلغائها.'], en: ['Sub-agents', 'Background tasks you can follow and cancel.'] },
  { ar: ['أوامر الشرطة', 'اكتب / في صندوق الرسالة لتظهر الأوامر: محادثة جديدة، فتح الصفحات، الصلاحيات، نوع المهمة، عمق التفكير والمهارات.'],
    en: ['Slash commands', 'Type / in the message box to see commands: new chat, open pages, access, task type, thinking depth and skills.'] },
  { ar: ['يعمل في الخلفية', 'عند إغلاق النافذة يبقى نجد في شريط المهام ويكمل عمله، وتنهيه تمامًا من قائمة أيقونته.'],
    en: ['Runs in the background', 'Closing the window keeps NAJD running from the system tray; quit it completely from the tray menu.'] },
  { ar: ['خريطة النجوم', 'ذكريات موثقة بمصادرها، وعرض بصري يربط بينها.'], en: ['Star Map', 'Memories linked to their sources, with a visual view of how they connect.'] },
]

export function FeatureMap({ language }: { language: 'ar' | 'en' }) {
  const ar = language === 'ar'
  return <div className="browser-card feature-map" data-feature-map>
    <CardHeading icon={MapIcon} title={ar ? 'مميزات نجد' : 'NAJD features'} hint={ar ? 'ما يقدّمه نجد في هذا الإصدار' : 'What NAJD offers in this version'} />
    <ul className="feature-list">
      {AVAILABLE.map(item => { const [title, body] = ar ? item.ar : item.en; return <li key={item.en[0]} data-feature-ready="true"><div><strong>{title}</strong><p>{body}</p></div></li> })}
    </ul>
  </div>
}
