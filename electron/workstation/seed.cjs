// Packaged bootstrap of the NAJD capability catalog (spec 4.1-4.5, docs/NAJD_CAPABILITY_CATALOG.json). It names what NAJD ships or
// manages; it proves nothing about readiness. `needs` lists health keys that must pass, `probe` names the live check of a real subsystem.
const VERSION = '1.0.0'
const NAJD = { name: 'NAJD' }
const row = (id, kind, layer, categories, en, ar, descEn, descAr, extra = {}) => ({ id, version: extra.version || VERSION, kind, layer, categories, publisher: NAJD,
  displayName: en, description: descEn, i18n: { ar: { displayName: ar, description: descAr } }, permissions: extra.permissions || [], needs: extra.needs || [], ...(extra.probe ? { probe: extra.probe } : {}), ...(extra.prominent ? { prominent: true } : {}) })
const skill = (id, categories, en, ar, descEn, descAr, needs = [], extra = {}) => row(id, 'skill', extra.layer || 'builtin', categories, en, ar, descEn, descAr, { ...extra, needs })
const plugin = (id, version, categories, en, ar, descEn, descAr, extra = {}) => row(id, 'plugin', 'managed', categories, en, ar, descEn, descAr, { ...extra, version })
const P = { files: { id: 'files', scope: 'project-files', reason: 'Reads and writes files in the folders you allow' }, network: { id: 'network', scope: 'https', reason: 'Reaches public services over the internet' },
  browser: { id: 'browser', scope: 'browser', reason: 'Observes and acts in a browser under the browser policy' }, desktop: { id: 'desktop', scope: 'windows-ui', reason: 'Observes and acts on Windows apps with approval' }, media: { id: 'media', scope: 'provider-media', reason: 'Calls the media provider you chose' } }

const builtin = [
  skill('najd-automation', ['installed', 'productivity'], 'Automation', 'الأتمتة', 'Create, run, schedule and inspect durable automations', 'إنشاء الأتمتة الدائمة وتشغيلها وجدولتها وفحصها', ['scheduler']),
  skill('najd-binding', ['installed', 'productivity'], 'Binding', 'الربط', 'Bind automation results to widget slots and repair bindings', 'ربط نتائج الأتمتة بخانات الودجت وإصلاح الربط', ['canvas', 'scheduler']),
  skill('najd-blueprint', ['installed', 'productivity'], 'Blueprint', 'المخطط', 'Route work between automation, widget, binding and canvas', 'توجيه العمل بين الأتمتة والودجت والربط واللوحات', ['canvas', 'scheduler']),
  skill('najd-canvas', ['installed', 'creative'], 'Canvas', 'اللوحة', 'Create canvases and place, move and resize widgets', 'إنشاء اللوحات ووضع الودجت وتحريكها وتغيير حجمها', ['canvas']),
  skill('najd-deep-research', ['installed', 'featured', 'academic'], 'Deep research', 'البحث المعمق', 'Iterative evidence-based research and long-form outputs', 'بحث متكرر قائم على الأدلة ومخرجات مطولة', ['web']),
  skill('najd-browser', ['installed', 'productivity'], 'Built-in browser', 'المتصفح المدمج', 'Open, read and act in the right-panel browser', 'فتح الصفحات وقراءتها والتصرف فيها داخل متصفح اللوحة اليمنى', ['builtin-browser'], { permissions: [P.browser] }),
  skill('najd-design', ['installed', 'creative'], 'Design', 'التصميم', 'Posters, infographics, resumes, tables and charts with image or PPTX export', 'ملصقات وإنفوجرافيك وسير ذاتية وجداول ورسوم مع تصدير صور أو PPTX', ['office']),
  skill('najd-slides', ['installed', 'featured', 'productivity'], 'Slides', 'الشرائح', 'Create, read, edit and render PPTX decks', 'إنشاء عروض PPTX وقراءتها وتعديلها وعرضها', ['office']),
  skill('najd-pet', ['installed', 'creative'], 'Desktop pet', 'الرفيق المكتبي', 'Create and customize the desktop pet', 'إنشاء الرفيق المكتبي وتخصيصه', ['desktop-pet']),
  skill('najd-plugin-builder', ['installed', 'engineering'], 'Plugin builder', 'بناء الإضافات', 'Create, validate and register personal plugins', 'إنشاء الإضافات الشخصية والتحقق منها وتسجيلها', ['packages']),
  skill('najd-skill-creator', ['installed', 'engineering'], 'Skill creator', 'إنشاء المهارات', 'Create, audit, validate and package skills', 'إنشاء المهارات وتدقيقها والتحقق منها وتحزيمها', ['packages']),
  skill('najd-widget', ['installed', 'creative'], 'Widget', 'الودجت', 'Build, render and validate sandboxed interactive widgets', 'بناء ودجت تفاعلية معزولة وعرضها والتحقق منها', ['canvas']),
  skill('najd-widget-design', ['installed', 'creative'], 'Widget design', 'تصميم الودجت', 'Widget design contract, tokens and responsive layout', 'عقد تصميم الودجت ورموزها وتخطيطها المتجاوب', ['canvas']),
  skill('najd-android', ['installed', 'engineering', 'productivity'], 'Android apps', 'تطبيقات أندرويد', 'Build Android apps (APK) from a web app with your Android SDK', 'بناء تطبيقات أندرويد (APK) من تطبيق ويب باستخدام Android SDK لديك', ['mobile-toolchain']),
  skill('najd-3d', ['installed', 'creative', 'engineering'], '3D with Blender', 'ثلاثي الأبعاد مع Blender', 'Build, edit, export and render 3D models with your Blender', 'بناء النماذج ثلاثية الأبعاد وتعديلها وتصديرها وعرضها باستخدام Blender لديك', ['3d-runtime']),
  skill('najd-humanizer', ['installed', 'marketing'], 'Humanizer', 'الصياغة الطبيعية', 'Rewrite text so it reads naturally', 'إعادة صياغة النص ليقرأ بشكل طبيعي'),
  skill('najd-find-skills', ['installed', 'productivity'], 'Find skills', 'البحث عن المهارات', 'Find the right skill or plugin for a task', 'إيجاد المهارة أو الإضافة المناسبة للمهمة', ['packages']),
  skill('najd-model-annotations', ['installed', 'engineering'], 'Model annotations', 'تعليقات النموذج', 'Page annotations and model-linked citations', 'تعليقات الصفحات والاستشهادات المرتبطة بالنموذج', ['builtin-browser']),
  skill('najd-webmcp', ['installed', 'engineering'], 'WebMCP', 'WebMCP', 'Discover and call tools the current page declares', 'اكتشاف الأدوات التي تعلنها الصفحة الحالية واستدعاؤها', ['builtin-browser']),
  skill('najd-office-design', ['installed', 'productivity'], 'Office design', 'تصميم ملفات أوفيس', 'Professional Word, Excel and PowerPoint files with the NAJD Office kit', 'ملفات Word وExcel وPowerPoint احترافية بحزمة أوفيس نجد', ['office']),
  skill('najd-pptx-surgical-edit', ['installed', 'productivity'], 'PPTX surgical edit', 'تعديل PPTX الدقيق', 'Lossless targeted edits of existing decks', 'تعديلات موضعية بلا فقد على العروض الموجودة', ['office'])
]

const family = (id, categories, en, ar, descEn, descAr, needs = ['packages']) => skill(id, categories, en, ar, descEn, descAr, needs, { layer: 'managed' })
const production = [
  family('najd-about-me-avatar', ['creative'], 'About-Me avatar', 'صورة التعريف', 'Build a personal avatar and profile page', 'بناء صورة شخصية وصفحة تعريف', ['media']),
  family('najd-android-app-building', ['engineering'], 'Android app building', 'بناء تطبيقات أندرويد', 'Produce Android apps', 'إنتاج تطبيقات أندرويد', ['mobile-toolchain']),
  family('najd-ios-app-building', ['engineering'], 'iOS app building', 'بناء تطبيقات iOS', 'Produce iOS apps', 'إنتاج تطبيقات iOS', ['mobile-toolchain']),
  family('najd-ios-app-intents', ['engineering'], 'iOS App Intents', 'App Intents لنظام iOS', 'Expose app actions through App Intents', 'إتاحة أوامر التطبيق عبر App Intents', ['mobile-toolchain']),
  family('najd-ios-debug', ['engineering'], 'iOS performance debugging', 'تشخيص أداء iOS', 'Debug iOS app performance', 'تشخيص أداء تطبيقات iOS', ['mobile-toolchain']),
  family('najd-mobile-app-preview', ['engineering'], 'Mobile app preview', 'معاينة تطبيقات الجوال', 'Preview mobile apps', 'معاينة تطبيقات الجوال', ['mobile-toolchain']),
  family('najd-wechat-miniprogram-building', ['engineering'], 'WeChat mini-program building', 'بناء برامج WeChat المصغرة', 'Produce WeChat mini-programs', 'إنتاج برامج WeChat المصغرة', ['mobile-toolchain']),
  family('najd-app-ui-theme', ['creative', 'engineering'], 'App UI theming', 'تنسيق واجهات التطبيقات', 'Cross-platform app theming', 'تنسيق واجهات التطبيقات لعدة منصات'),
  family('najd-content-creation', ['marketing', 'creative'], 'Content creation', 'صناعة المحتوى', 'Plan and write content', 'تخطيط المحتوى وكتابته', []),
  family('najd-game-building', ['creative', 'engineering'], 'Browser games', 'ألعاب المتصفح', 'Build browser games', 'بناء ألعاب تعمل في المتصفح', ['web-preview']),
  family('najd-webapp-building', ['engineering'], 'Web app building', 'بناء تطبيقات الويب', 'Build web apps with local preview', 'بناء تطبيقات ويب مع معاينة محلية', ['web-preview']),
  family('najd-webapp-publish', ['engineering'], 'Static-site publishing', 'نشر المواقع الثابتة', 'Prepare and publish static sites', 'تجهيز المواقع الثابتة ونشرها', ['web-preview']),
  family('najd-obsidian-markdown', ['productivity'], 'Obsidian-flavored Markdown', 'Markdown بأسلوب Obsidian', 'Write linked notes in Obsidian-flavored Markdown', 'كتابة ملاحظات مترابطة بصيغة Obsidian', [])
]

const plugins = [
  plugin('najd-audio-generation', '0.2.3', ['creativity-design'], 'Audio generation', 'توليد الصوت', 'Speech and sound-effect generation', 'توليد الكلام والمؤثرات الصوتية', { permissions: [P.media], needs: ['media'] }),
  plugin('najd-3d-editor', '0.2.6', ['3d', 'creativity-design'], '3D editor', 'محرر ثلاثي الأبعاد', 'Preview and edit scenes, materials, lights, cameras and animation', 'معاينة المشاهد والخامات والإضاءة والكاميرات والحركة وتعديلها', { prominent: true, permissions: [P.files], needs: ['3d-runtime'] }),
  plugin('najd-github', '0.1.14', ['developer-tools', 'featured'], 'GitHub', 'GitHub', 'GitHub MCP adapter', 'مهايئ GitHub عبر MCP', { prominent: true, permissions: [P.network], needs: ['mcp', 'github-account'] }),
  plugin('najd-igo-data', '0.1.9', ['research'], 'Intergovernmental data', 'بيانات المنظمات الدولية', 'WHO, Eurostat, ECB, UNICEF, OECD, FAO, UNSD and FRED', 'بيانات WHO وEurostat وECB وUNICEF وOECD وFAO وUNSD وFRED', { permissions: [P.network], needs: ['web'] }),
  plugin('najd-image-generation', '0.3.4', ['creativity-design', 'featured'], 'Image generation', 'توليد الصور', 'Text and reference image generation', 'توليد الصور من نص أو مرجع', { prominent: true, permissions: [P.media], needs: ['media'] }),
  plugin('najd-imf', '0.1.13', ['finance', 'research'], 'IMF data', 'بيانات صندوق النقد', 'Macroeconomic statistics and forecasts', 'إحصاءات وتوقعات الاقتصاد الكلي', { permissions: [P.network], needs: ['web'] }),
  plugin('najd-computer-use-windows', '0.3.13', ['productivity', 'featured'], 'Computer Use', 'التحكم بالحاسوب', 'Observe, act and verify in Windows apps', 'مراقبة تطبيقات ويندوز والتصرف فيها والتحقق', { prominent: true, permissions: [P.desktop], probe: 'windows' }),
  plugin('najd-excel', '0.2.18', ['productivity', 'finance', 'featured'], 'Excel', 'Excel', 'Spreadsheet analysis, charts and finance models', 'تحليل الجداول والرسوم والنماذج المالية', { prominent: true, permissions: [P.files], probe: 'office' }),
  plugin('najd-pdf', '0.2.15', ['productivity', 'featured'], 'PDF', 'PDF', 'Create, extract, fill and convert PDF', 'إنشاء PDF واستخراجه وتعبئته وتحويله', { prominent: true, permissions: [P.files], probe: 'office' }),
  plugin('najd-browser-bridge', '1.11.6', ['productivity', 'featured'], 'Browser extension', 'إضافة المتصفح', 'Owner-browser control and page context', 'التحكم بمتصفحك وسياق الصفحة', { prominent: true, permissions: [P.browser], probe: 'browser' }),
  plugin('najd-word', '0.4.12', ['productivity', 'featured'], 'Word', 'Word', 'Create, edit and repair DOCX with comments and tracked changes', 'إنشاء DOCX وتعديله وإصلاحه مع التعليقات وتتبع التغييرات', { prominent: true, permissions: [P.files], probe: 'office' }),
  plugin('najd-web-publish', '1.0.16', ['developer-tools', 'featured'], 'Build', 'البناء', 'Build and publish static websites', 'بناء المواقع الثابتة ونشرها', { prominent: true, permissions: [P.files, P.network], needs: ['web-preview'] }),
  plugin('najd-mobile-app-building', '0.5.0', ['developer-tools'], 'Mobile App Building', 'بناء تطبيقات الجوال', 'Android, iOS and mini-program production', 'إنتاج تطبيقات أندرويد وiOS والبرامج المصغرة', { prominent: true, permissions: [P.files], needs: ['mobile-toolchain'] }),
  plugin('najd-model3d-generation', '0.2.6', ['3d'], '3D Generation', 'التوليد ثلاثي الأبعاد', 'GLB creation and editing workflows', 'إنشاء ملفات GLB وتعديلها', { prominent: true, permissions: [P.media], needs: ['media', '3d-runtime'] }),
  plugin('najd-scholar', '0.1.9', ['research', 'featured'], 'Academic Data', 'البيانات الأكاديمية', 'Academic search and author metrics', 'البحث الأكاديمي ومؤشرات المؤلفين', { prominent: true, permissions: [P.network], needs: ['web'] }),
  plugin('najd-sec-edgar', '0.1.12', ['finance', 'research'], 'SEC EDGAR', 'SEC EDGAR', 'Filings, XBRL and company financial data', 'الإفصاحات وXBRL والبيانات المالية للشركات', { permissions: [P.network], needs: ['web'] }),
  plugin('najd-video-generation', '0.2.8', ['creativity-design'], 'Video generation', 'توليد الفيديو', 'Text and reference video workflows', 'توليد الفيديو من نص أو مرجع', { permissions: [P.media], needs: ['media'] }),
  plugin('najd-world-bank-data', '0.1.10', ['research'], 'World Bank data', 'بيانات البنك الدولي', 'Development indicators and time series', 'مؤشرات التنمية والسلاسل الزمنية', { permissions: [P.network], needs: ['web'] }),
  plugin('najd-yahoo-finance', '0.1.13', ['finance'], 'Market data', 'بيانات الأسواق', 'Market, company and financial data', 'بيانات الأسواق والشركات والبيانات المالية', { permissions: [P.network], needs: ['web'] })
]

const gatewaySkill = (id, en, ar, descEn, descAr, needs = []) => skill(id, ['engineering'], en, ar, descEn, descAr, needs, { layer: 'gateway' })
const gatewayPlugin = (id, en, ar, descEn, descAr, needs = []) => row(id, 'plugin', 'gateway', ['developer-tools'], en, ar, descEn, descAr, { needs })
const gateway = [
  gatewaySkill('najd-canvas-node', 'Canvas node', 'عقدة اللوحة', 'Canvas operations on the gateway', 'عمليات اللوحة عبر البوابة', ['canvas', 'gateway']),
  gatewaySkill('najd-skill-hub', 'Skill hub', 'مركز المهارات', 'Search, install, update and publish skills', 'البحث عن المهارات وتثبيتها وتحديثها ونشرها', ['packages']),
  gatewaySkill('najd-coding-agent', 'Coding-agent delegation', 'تفويض وكلاء البرمجة', 'Delegate to supported coding runtimes', 'التفويض إلى بيئات البرمجة المدعومة', ['gateway']),
  gatewaySkill('najd-discord', 'Discord', 'Discord', 'Discord operations', 'عمليات Discord', ['gateway']),
  gatewaySkill('najd-github-cli', 'GitHub CLI', 'GitHub CLI', 'GitHub CLI operations', 'عمليات GitHub CLI', ['gateway']),
  gatewaySkill('najd-healthcheck', 'Host health', 'فحص الجهاز', 'Host health and security checks', 'فحص صحة الجهاز وأمانه'),
  gatewaySkill('najd-model-usage', 'Model usage', 'استهلاك النماذج', 'Model usage and cost reports', 'تقارير استهلاك النماذج وتكلفتها'),
  gatewaySkill('najd-notion', 'Notion', 'Notion', 'Notion API procedures', 'إجراءات Notion API', ['gateway']),
  gatewaySkill('najd-session-logs', 'Session logs', 'سجلات الجلسات', 'Session-log analysis', 'تحليل سجلات الجلسات'),
  gatewaySkill('najd-skill-creator-gateway', 'Gateway skill creator', 'إنشاء مهارات البوابة', 'Create skills for the gateway', 'إنشاء مهارات للبوابة', ['gateway']),
  gatewaySkill('najd-terminal-session', 'Terminal sessions', 'جلسات الطرفية', 'Durable terminal sessions', 'جلسات طرفية دائمة', ['gateway']),
  gatewaySkill('najd-video-frames', 'Video frames', 'إطارات الفيديو', 'Video-frame extraction', 'استخراج إطارات الفيديو', ['gateway']),
  gatewaySkill('najd-weather', 'Weather', 'الطقس', 'Weather reports', 'تقارير الطقس', ['web']),
  gatewayPlugin('najd-device-pair', 'Device pairing', 'ربط الأجهزة', 'Remote device pairing', 'ربط الأجهزة عن بعد', ['remote']),
  gatewayPlugin('najd-feishu-lark', 'Lark channel', 'قناة Lark', 'Feishu and Lark channel', 'قناة Feishu وLark', ['gateway', 'channel-setup']),
  gatewayPlugin('najd-imessage', 'iMessage channel', 'قناة iMessage', 'iMessage channel', 'قناة iMessage', ['gateway', 'macos']),
  gatewayPlugin('najd-agent-channel', 'Agent channel', 'قناة الوكيل', 'Channel between agents', 'قناة بين الوكلاء', ['gateway']),
  gatewayPlugin('najd-search', 'Search', 'البحث', 'Search extension', 'إضافة البحث', ['web']),
  gatewayPlugin('najd-memory-core', 'Memory core', 'نواة الذاكرة', 'Durable scoped memory', 'ذاكرة دائمة محددة النطاق', ['memory']),
  gatewayPlugin('najd-weixin', 'Weixin channel', 'قناة Weixin', 'Weixin channel', 'قناة Weixin', ['gateway', 'channel-setup']),
  gatewayPlugin('najd-extension-shared', 'Extension shared', 'مشترك الإضافات', 'Shared code of the extensions', 'الشيفرة المشتركة للإضافات', ['gateway']),
  gatewayPlugin('najd-telegram', 'Telegram channel', 'قناة Telegram', 'Telegram channel', 'قناة Telegram', ['channels']),
  gatewayPlugin('najd-boot-context', 'Startup context', 'سياق البدء', 'Hook: startup context', 'خطاف: سياق البدء', ['memory']),
  gatewayPlugin('najd-bootstrap-files', 'Bootstrap files', 'ملفات التهيئة', 'Hook: bootstrap files', 'خطاف: ملفات التهيئة', ['memory']),
  gatewayPlugin('najd-command-logger', 'Command logger', 'سجل الأوامر', 'Hook: command logging', 'خطاف: تسجيل الأوامر', ['memory']),
  gatewayPlugin('najd-session-memory', 'Session memory', 'ذاكرة الجلسة', 'Hook: session memory', 'خطاف: ذاكرة الجلسة', ['memory'])
]

// Marketplace fixtures (spec 4.5): metadata only until a registry source supplies the package, so they can never be installed from here.
const seeds = {
  featured: 'equity-research find-skills theme-factory seo-audit scientific-problem-selection pricing-strategy humanizer copywriting',
  productivity: 'process-doc work-recap-writer whatsapp-integration weighted-scorer structured-minutes story-map-builder sprint-plan-builder project-sizing-guide',
  finance: 'saas-metrics-coach legal-risk-assessment value-investing-scorecard tos-clause-scanner stock-signal-analyzer regulatory-audit-generator iso-27001-evidence-collection investor-pitch-planner',
  academic: 'translation-craft scholarly-writing-refiner mock-interview-drill dev-guide-generator cv-tailor cite-style-converter anki-card-maker adhd-assistant',
  marketing: 'copy-editing churn-prevention campaign-plan support-response-writer seo-content-writer landing-page-scaffold html-mailer-builder email-newsletter-builder',
  engineering: 'test-suite-architect terraform-deploy-pitfalls localization-toolkit test-driven-dev domain-glossary deep-module-refactor cross-examine api-shape-explorer',
  creative: 'video-quality-diff x-thread-crafter timeline-builder sun-path podcast-episode-writer keynote-composer edge-tts cross-platform-adapter'
}
const title = id => id.split('-').map(word => word[0].toUpperCase() + word.slice(1)).join(' ')
const marketplace = Object.entries(seeds).flatMap(([category, ids]) => ids.split(' ').map(id => ({ id, version: '0.0.0', kind: 'skill', layer: 'marketplace', categories: [category], publisher: { name: 'Marketplace' }, displayName: title(id), permissions: [], needs: [], metadataOnly: true })))

module.exports = { entries: [...builtin, ...production, ...plugins, ...gateway, ...marketplace] }
