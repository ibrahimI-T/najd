// Owner acceptance workflows with a real model (owner request 2026-10-31), through the real desktop app in an isolated
// profile (temporary user data and documents; the owner's chats, settings and credentials are never read).
// The model is a real local Ollama model; NAJD's real tools run. Approvals are answered by this script from a fixed
// policy per workflow, checked against the exact approval target: only what that workflow needs is allowed (workspace
// file writes, page previews, a screenshot of this script's own fixture window, a skill save); everything else is
// denied, so a weak model cannot change anything else on this computer. Desktop actions in real apps are never
// approved here: the owner's own windows (for example Notepad's restored unsaved tabs) stay untouched. The desktop
// mechanism is proven separately on a fixture window (tests/desktop-recovery-smoke.cjs).
// Each workflow reports its outcome, the tools called, model calls and the provider-reported tokens from the receipt.
// Usage: npm run build && node tests/real-model-acceptance.cjs [model] [workflow,...]
//   default model qwen3-vl:4b-instruct; workflows: file,counter,research,screenshot,skill (default: all)
// Results are written to release/qa-real-model/<model>-<time>.json. Fixture tests are not real-model evidence; this is.
const assert = require('node:assert/strict')
const fs = require('node:fs/promises'), fss = require('node:fs'), path = require('node:path'), os = require('node:os')
const { launch, stop } = require('./electron-ui-smoke.cjs')

const model = process.argv[2] || 'qwen3-vl:4b-instruct'
const only = (process.argv[3] || '').split(',').filter(Boolean)
const { spawn } = require('node:child_process')
const FIXTURE = 'NAJD Vision Fixture ' + Math.random().toString(36).slice(2, 8)
// Per workflow: the tools it may use, and for each a test of the exact approval card.
const POLICY = {
  file: { 'najd-files-write': card => /najd-test[\\/]test\.txt/.test(card) },
  counter: { 'najd-files-write': card => /counter/.test(card), 'najd-files-edit': card => /counter/.test(card) },
  research: {},
  screenshot: { 'najd-screen-capture': card => card.includes(FIXTURE) },
  skill: { 'najd-skill-save': () => true, 'najd-files-write': card => /najd-test[\\/]again\.txt/.test(card) }
}

function managedEngine() {
  const base = path.join(process.env.LOCALAPPDATA || '', 'NAJD AGENT', 'runtime')
  const name = fss.existsSync(base) ? fss.readdirSync(base).find(item => item.startsWith('engine-') && fss.existsSync(path.join(base, item, 'najd-core.json'))) : null
  return name ? path.join(base, name) : null
}

const WORKFLOWS = {
  file: { text: 'أنشئ الملف najd-test/test.txt وفيه خمسة أسطر مرقمة من 1 إلى 5، ثم اقرأه وتأكد أن المحتوى صحيح.',
    check: async ({ docs }) => {
      const body = await fs.readFile(path.join(docs, 'NAJD', 'najd-test', 'test.txt'), 'utf8').catch(() => null)
      const lines = body ? body.trim().split(/\r?\n/) : []
      return { ok: lines.length === 5 && lines.every((line, index) => line.includes(String(index + 1))), detail: body }
    } },
  counter: { text: 'سوّ صفحة HTML بسيطة counter/index.html فيها عداد وزر زيادة وزر تصفير، وافتح معاينة لها واختبر أن الزيادة والتصفير يشتغلون فعلًا.',
    check: async ({ docs, task }) => {
      const file = path.join(docs, 'NAJD', 'counter', 'index.html')
      const html = await fs.readFile(file, 'utf8').catch(() => null)
      const events = task.activity?.events || []
      const tested = events.some(step => step.tool === 'najd-web-preview' && step.type === 'tool.started')
      return { ok: !!html && /button/i.test(html), tested, detail: html ? html.length + ' characters' : 'missing' }
    } },
  research: { text: 'ابحث عن آخر إصدار مستقر من Python من المصادر الرسمية (python.org) واذكر رقم الإصدار وتاريخه مع الرابط.',
    check: async ({ task }) => ({ ok: /3\.\d+\.\d+/.test(task.output || '') && /python\.org/.test(task.output || ''), detail: task.output?.slice(0, 400) }) },
  screenshot: { text: 'خذ لقطة شاشة لنافذة "' + FIXTURE + '" وقل لي وش الرقم المكتوب فيها.',
    check: async ({ task }) => ({ ok: /najd-screen-capture/.test(JSON.stringify(task.activity?.events || [])) && /4821/.test(task.output || ''), detail: task.output?.slice(0, 300) }) },
  skill: { text: 'احفظ طريقة إنشاء ملف نصي مرقم والتحقق منه كمهارة باسم "Numbered text file" (الخطوات: اكتب الملف بـ najd_files_write ثم اقرأه بـ najd_files_read وقارن كل سطر).',
    then: 'استخدم مهارتك المحفوظة "Numbered text file" لإنشاء najd-test/again.txt فيه ثلاثة أسطر مرقمة وتحقق منه.',
    check: async ({ docs, task }) => {
      const body = await fs.readFile(path.join(docs, 'NAJD', 'najd-test', 'again.txt'), 'utf8').catch(() => null)
      return { ok: !!body && body.trim().split(/\r?\n/).length === 3 && /najd-skills-read/.test(JSON.stringify(task.activity?.events || [])), detail: body }
    } }
}

async function main() {
  const engine = managedEngine()
  if (engine) process.env.NAJD_DEV_AGENT_CORE = engine
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'najd-desktop-test-'))
  const docs = root + '-documents'
  const results = []
  let instance, fixture = null
  try {
    if (!only.length || only.includes('screenshot')) fixture = spawn('powershell.exe', ['-NoProfile', '-STA', '-Command', `Add-Type -AssemblyName System.Windows.Forms
$form = New-Object System.Windows.Forms.Form; $form.Text = '${FIXTURE}'; $form.Width = 520; $form.Height = 260; $form.BackColor = 'White'
$label = New-Object System.Windows.Forms.Label; $label.Text = '4821'; $label.Font = New-Object System.Drawing.Font('Segoe UI', 64); $label.AutoSize = $true; $label.Top = 40; $label.Left = 120
$form.Controls.Add($label); [System.Windows.Forms.Application]::Run($form)`], { windowsHide: false, stdio: 'ignore' })
    instance = await launch(root)
    const client = instance.client
    const run = async expression => {
      const result = await client.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
      assert.ok(!result.exceptionDetails, JSON.stringify(result.exceptionDetails))
      return result.result.value
    }
    async function chat(text, conversationId, policy) {
      let task = await run(`window.najdCore.startTask(${JSON.stringify(text)},crypto.randomUUID(),'ollama',${JSON.stringify(model)},[{role:'user',text:${JSON.stringify(text)}}],'auto',[],${JSON.stringify(conversationId)})`)
      const approvals = []
      const started = Date.now()
      while (!['COMPLETED', 'FAILED', 'CANCELLED', 'UNKNOWN_EFFECT'].includes(task.state) && Date.now() - started < 15 * 60000) {
        await new Promise(resolve => setTimeout(resolve, 250))
        task = await run(`window.najdCore.getTask(${JSON.stringify(task.id)})`)
        if (task.state === 'WAITING_APPROVAL' && task.approvalId) {
          const card = Object.values(task.proposedInput || {}).map(String).join(' ')
          const decision = policy[task.proposedTool]?.(card) ? 'ALLOW_ONCE' : 'DENY'
          approvals.push([task.proposedTool, decision, card.slice(0, 160)])
          task = await run(`window.najdCore.respondApproval(${JSON.stringify(task.approvalId)},${JSON.stringify(decision)})`)
        }
      }
      if (!['COMPLETED', 'FAILED', 'CANCELLED', 'UNKNOWN_EFFECT'].includes(task.state)) task = await run(`window.najdCore.cancelTask(${JSON.stringify(task.id)})`)
      return { task: await run(`window.najdCore.getTask(${JSON.stringify(task.id)})`), approvals, seconds: Math.round((Date.now() - started) / 1000) }
    }
    for (const [name, workflow] of Object.entries(WORKFLOWS)) {
      if (only.length && !only.includes(name)) continue
      let outcome = await chat(workflow.text, 'acceptance-' + name, POLICY[name])
      let usage = outcome.task.receipt?.usage || {}
      const first = { calls: outcome.task.receipt?.modelCalls ?? usage.modelCalls, total: usage.total }
      if (workflow.then) {
        const second = await chat(workflow.then, 'acceptance-' + name + '-reuse', POLICY[name])
        outcome = { ...second, approvals: [...outcome.approvals, ...second.approvals], first }
        usage = second.task.receipt?.usage || {}
      }
      const verdict = await workflow.check({ docs, task: outcome.task })
      const tools = (outcome.task.activity?.events || []).filter(step => step.type === 'tool.started' || step.type === 'tool.failed').map(step => (step.type === 'tool.failed' ? 'FAILED ' : '') + step.tool + (step.detail ? ' ' + String(step.detail).slice(0, 80) : ''))
      const row = { workflow: name, state: outcome.task.state, errorCode: outcome.task.errorCode || null, verified: verdict.ok, ...(verdict.tested !== undefined ? { previewUsed: verdict.tested } : {}),
        modelCalls: usage.modelCalls ?? null, input: usage.input ?? null, cached: usage.cached ?? null, output: usage.output ?? null, total: usage.total ?? null,
        seconds: outcome.seconds, approvals: outcome.approvals, tools, ...(outcome.first ? { saveRun: outcome.first } : {}), answer: String(outcome.task.output || '').slice(0, 600), detail: verdict.detail ?? null }
      results.push(row)
      console.log(JSON.stringify({ workflow: name, state: row.state, verified: row.verified, modelCalls: row.modelCalls, total: row.total, seconds: row.seconds, tools: row.tools.length }))
    }
  } finally {
    if (instance) await stop(instance).catch(() => {})
    try { fixture?.kill() } catch {}
    const out = path.join(__dirname, '..', 'release', 'qa-real-model')
    await fs.mkdir(out, { recursive: true })
    const file = path.join(out, model.replace(/[^a-z0-9.-]+/gi, '_') + '-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json')
    await fs.writeFile(file, JSON.stringify({ model, at: new Date().toISOString(), note: 'Real local model through the isolated desktop app; scripted approval policy.', results }, null, 2))
    console.log('Results: ' + file)
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(root).startsWith('najd-desktop-test-')) throw Error('Unsafe cleanup')
    for (const dir of [root, docs]) await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 }).catch(() => {})
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
