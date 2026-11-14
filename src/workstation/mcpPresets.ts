// Well-known MCP servers from GitHub and the official MCP registry (owner request 2026-11-10: "the famous skills, plugins, connections and MCP").
// Picking one only fills the add form; adding still shows the exact command line in NAJD's native confirmation, and each tool still asks before it runs.
// Hosted entries after Exa come from Hermes Agent's reviewed catalog (third_party/hermes-agent/optional-mcps, MIT, each verified live there);
// payment and trading services are left out on purpose (owner policy: payments stay with the owner).
// Local servers need Node (npx) or uv (uvx) on the computer; remote ones connect over HTTPS and sign in through the server's own page when it asks.
export type McpPreset = {
  id: string
  name: string
  command: string
  args: string[]
  needs: 'npx' | 'uvx' | 'https'
  token?: boolean
  home: string
  about: [ar: string, en: string]
}

export const MCP_PRESETS: McpPreset[] = [
  { id: 'playwright', name: 'Playwright', command: 'npx', args: ['-y', '@playwright/mcp@latest'], needs: 'npx', home: 'https://github.com/microsoft/playwright-mcp',
    about: ['يتصفح ويختبر المواقع في متصفح مستقل (من Microsoft).', 'Browses and tests websites in a separate browser (by Microsoft).'] },
  { id: 'context7', name: 'Context7', command: 'https://mcp.context7.com/mcp', args: [], needs: 'https', home: 'https://github.com/upstash/context7',
    about: ['توثيق محدث لأي مكتبة برمجية وقت الكتابة.', 'Up-to-date documentation for any code library while writing.'] },
  { id: 'chrome-devtools', name: 'Chrome DevTools', command: 'npx', args: ['-y', 'chrome-devtools-mcp@latest'], needs: 'npx', home: 'https://github.com/ChromeDevTools/chrome-devtools-mcp',
    about: ['يفحص أداء الصفحات وأخطاءها عبر أدوات مطوري Chrome.', 'Inspects page performance and errors through Chrome DevTools.'] },
  { id: 'github', name: 'GitHub', command: 'https://api.githubcopilot.com/mcp/', args: [], needs: 'https', token: true, home: 'https://github.com/github/github-mcp-server',
    about: ['المستودعات والمشكلات وطلبات الدمج في GitHub (يحتاج رمز وصول).', 'GitHub repositories, issues and pull requests (needs an access token).'] },
  { id: 'memory', name: 'Memory graph', command: 'npx', args: ['-y', '@modelcontextprotocol/server-memory'], needs: 'npx', home: 'https://github.com/modelcontextprotocol/servers/tree/main/src/memory',
    about: ['ذاكرة معرفية على شكل شبكة كيانات وعلاقات.', 'A knowledge-graph memory of entities and relations.'] },
  { id: 'sequential-thinking', name: 'Sequential thinking', command: 'npx', args: ['-y', '@modelcontextprotocol/server-sequential-thinking'], needs: 'npx', home: 'https://github.com/modelcontextprotocol/servers/tree/main/src/sequentialthinking',
    about: ['تفكير متسلسل قابل للمراجعة للمسائل المعقدة.', 'Step-by-step, revisable thinking for hard problems.'] },
  { id: 'fetch', name: 'Fetch', command: 'uvx', args: ['mcp-server-fetch'], needs: 'uvx', home: 'https://github.com/modelcontextprotocol/servers/tree/main/src/fetch',
    about: ['يجلب صفحات الويب ويحولها إلى Markdown.', 'Fetches web pages and converts them to Markdown.'] },
  { id: 'time', name: 'Time', command: 'uvx', args: ['mcp-server-time'], needs: 'uvx', home: 'https://github.com/modelcontextprotocol/servers/tree/main/src/time',
    about: ['الوقت وتحويل المناطق الزمنية.', 'Current time and time-zone conversion.'] },
  { id: 'git', name: 'Git', command: 'uvx', args: ['mcp-server-git'], needs: 'uvx', home: 'https://github.com/modelcontextprotocol/servers/tree/main/src/git',
    about: ['قراءة مستودعات Git المحلية والبحث فيها وتعديلها.', 'Read, search and change local Git repositories.'] },
  { id: 'desktop-commander', name: 'Desktop Commander', command: 'npx', args: ['-y', '@wonderwhy-er/desktop-commander'], needs: 'npx', home: 'https://github.com/wonderwhy-er/DesktopCommanderMCP',
    about: ['طرفية وتحرير ملفات وإدارة عمليات على الجهاز.', 'Terminal, file editing and process control on this computer.'] },
  { id: 'blender', name: 'Blender', command: 'uvx', args: ['blender-mcp'], needs: 'uvx', home: 'https://github.com/ahujasid/blender-mcp',
    about: ['يتحكم في Blender لبناء مشاهد ثلاثية الأبعاد (مع إضافة Blender الخاصة به).', 'Controls Blender to build 3D scenes (with its Blender add-on).'] },
  { id: 'deepwiki', name: 'DeepWiki', command: 'https://mcp.deepwiki.com/mcp', args: [], needs: 'https', home: 'https://docs.devin.ai/work-with-devin/deepwiki-mcp',
    about: ['أسئلة وشروحات عن أي مستودع عام في GitHub، بدون حساب.', 'Questions and explanations about any public GitHub repository, no account.'] },
  { id: 'notion', name: 'Notion', command: 'https://mcp.notion.com/mcp', args: [], needs: 'https', home: 'https://developers.notion.com/docs/mcp',
    about: ['صفحات وقواعد بيانات Notion (تسجيل دخول من صفحة Notion).', 'Notion pages and databases (sign in on Notion\'s page).'] },
  { id: 'linear', name: 'Linear', command: 'https://mcp.linear.app/mcp', args: [], needs: 'https', home: 'https://linear.app/docs/mcp',
    about: ['مهام ومشاريع Linear (تسجيل دخول من صفحة Linear).', 'Linear issues and projects (sign in on Linear\'s page).'] },
  { id: 'sentry', name: 'Sentry', command: 'https://mcp.sentry.dev/mcp', args: [], needs: 'https', home: 'https://docs.sentry.io/product/sentry-mcp/',
    about: ['أخطاء التطبيقات وتتبعها في Sentry.', 'Application errors and traces in Sentry.'] },
  { id: 'exa', name: 'Exa search', command: 'https://mcp.exa.ai/mcp', args: [], needs: 'https', home: 'https://github.com/exa-labs/exa-mcp-server',
    about: ['بحث ويب عميق مخصص للوكلاء.', 'Deep web search built for agents.'] },
  { id: 'microsoft-learn', name: 'Microsoft Learn', command: 'https://learn.microsoft.com/api/mcp', args: [], needs: 'https', home: 'https://learn.microsoft.com/en-us/training/support/mcp-get-started',
    about: ['توثيق Microsoft وAzure و.NET الرسمي مع أمثلة.', 'Official Microsoft, Azure and .NET docs with code samples.'] },
  { id: 'aws-knowledge', name: 'AWS Knowledge', command: 'https://knowledge-mcp.global.api.aws', args: [], needs: 'https', home: 'https://awslabs.github.io/mcp/servers/aws-knowledge-mcp-server',
    about: ['توثيق AWS الرسمي وأفضل الممارسات، بدون حساب.', 'Official AWS docs and best practices, no account.'] },
  { id: 'wolfram', name: 'Wolfram|Alpha', command: 'https://agenttools.wolfram.com/mcp', args: [], needs: 'https', home: 'https://www.wolfram.com/artificial-intelligence/',
    about: ['حسابات رياضية ومعرفة موثقة من Wolfram|Alpha.', 'Math, computation and curated knowledge from Wolfram|Alpha.'] },
  { id: 'hugging-face', name: 'Hugging Face', command: 'https://huggingface.co/mcp', args: [], needs: 'https', home: 'https://huggingface.co/docs/hub/agents-mcp',
    about: ['النماذج ومجموعات البيانات والأوراق في Hugging Face.', 'Models, datasets, Spaces and papers on Hugging Face.'] },
  { id: 'figma', name: 'Figma', command: 'https://mcp.figma.com/mcp', args: [], needs: 'https', home: 'https://help.figma.com/hc/en-us/articles/32132100833559',
    about: ['قراءة التصاميم والكتابة على لوحة Figma.', 'Read designs and write to the Figma canvas.'] },
  { id: 'canva', name: 'Canva', command: 'https://mcp.canva.com/mcp', args: [], needs: 'https', home: 'https://www.canva.dev/docs/mcp/',
    about: ['إنشاء تصاميم Canva والبحث فيها وإدارتها.', 'Create, search and manage Canva designs.'] },
  { id: 'gamma', name: 'Gamma', command: 'https://mcp.gamma.app/mcp', args: [], needs: 'https', home: 'https://gamma.app',
    about: ['عروض ومستندات ومواقع بالذكاء الاصطناعي من Gamma.', 'AI presentations, docs and sites with Gamma.'] },
  { id: 'comfy-cloud', name: 'Comfy Cloud', command: 'https://cloud.comfy.org/mcp', args: [], needs: 'https', home: 'https://cloud.comfy.org',
    about: ['توليد صور وفيديو وصوت وثلاثي أبعاد على Comfy Cloud.', 'Generate images, video, audio and 3D on Comfy Cloud.'] },
  { id: 'supabase', name: 'Supabase', command: 'https://mcp.supabase.com/mcp', args: [], needs: 'https', home: 'https://supabase.com/docs/guides/getting-started/mcp',
    about: ['قواعد البيانات والمصادقة والتخزين في Supabase.', 'Database, auth and storage in your Supabase projects.'] },
  { id: 'vercel', name: 'Vercel', command: 'https://mcp.vercel.com', args: [], needs: 'https', home: 'https://vercel.com/docs/mcp',
    about: ['النشر والسجلات والمشاريع في Vercel.', 'Deployments, logs and projects on Vercel.'] },
  { id: 'cloudflare', name: 'Cloudflare', command: 'https://mcp.cloudflare.com/mcp?codemode=false', args: [], needs: 'https', home: 'https://developers.cloudflare.com/agents/model-context-protocol/',
    about: ['واجهة Cloudflare كاملة عبر خادمها الرسمي.', 'The full Cloudflare API through its official server.'] },
  { id: 'gitlab', name: 'GitLab', command: 'https://gitlab.com/api/v4/mcp', args: [], needs: 'https', home: 'https://docs.gitlab.com/user/gitlab_duo/model_context_protocol/',
    about: ['المشكلات وطلبات الدمج وخطوط CI في GitLab.', 'GitLab issues, merge requests and pipelines.'] },
  { id: 'atlassian', name: 'Jira & Confluence', command: 'https://mcp.atlassian.com/v1/mcp/authv2', args: [], needs: 'https', home: 'https://www.atlassian.com/platform/remote-mcp-server',
    about: ['مهام Jira وصفحات Confluence.', 'Jira issues and Confluence pages.'] },
  { id: 'asana', name: 'Asana', command: 'https://mcp.asana.com/v2/mcp', args: [], needs: 'https', home: 'https://developers.asana.com/docs/using-asanas-mcp-server',
    about: ['المهام والمشاريع والأهداف في Asana.', 'Tasks, projects and goals in Asana.'] },
  { id: 'todoist', name: 'Todoist', command: 'https://ai.todoist.net/mcp', args: [], needs: 'https', home: 'https://www.todoist.com/help/articles/use-todoist-with-ai-tools',
    about: ['إدارة مهام ومشاريع Todoist.', 'Manage Todoist tasks and projects.'] },
  { id: 'miro', name: 'Miro', command: 'https://mcp.miro.com/', args: [], needs: 'https', home: 'https://developers.miro.com/docs/connecting-to-miro-mcp',
    about: ['قراءة وتعديل لوحات Miro والمخططات.', 'Read and edit Miro boards and diagrams.'] },
  { id: 'airtable', name: 'Airtable', command: 'https://mcp.airtable.com/mcp', args: [], needs: 'https', home: 'https://support.airtable.com/docs/using-the-airtable-mcp-server',
    about: ['القواعد والجداول والسجلات في Airtable.', 'Bases, tables and records in Airtable.'] },
  { id: 'dropbox', name: 'Dropbox', command: 'https://mcp.dropbox.com/mcp', args: [], needs: 'https', home: 'https://www.dropbox.com/developers',
    about: ['البحث في ملفات Dropbox وقراءتها وإدارتها.', 'Search, read and manage files in Dropbox.'] },
  { id: 'semgrep', name: 'Semgrep', command: 'https://mcp.semgrep.ai/mcp', args: [], needs: 'https', home: 'https://semgrep.dev/docs/mcp',
    about: ['فحص الكود بحثًا عن ثغرات أمنية.', 'Scan code for security vulnerabilities.'] },
  { id: 'kiwi', name: 'Kiwi.com flights', command: 'https://mcp.kiwi.com', args: [], needs: 'https', home: 'https://www.kiwi.com',
    about: ['البحث عن رحلات طيران مع روابط حجز مباشرة، بدون حساب.', 'Flight search with direct booking links, no account.'] },
  { id: 'trivago', name: 'trivago hotels', command: 'https://mcp.trivago.com/mcp', args: [], needs: 'https', home: 'https://www.trivago.com',
    about: ['مقارنة أسعار الفنادق حسب المدينة والتاريخ، بدون حساب.', 'Compare hotel prices by city and dates, no account.'] }
]

// The form values for one preset: arguments with spaces become a JSON array, the way the form reads them.
export const presetForm = (preset: McpPreset) => ({ name: preset.name, command: preset.command, args: preset.args.some(arg => /\s/.test(arg)) ? JSON.stringify(preset.args) : preset.args.join(' ') })
