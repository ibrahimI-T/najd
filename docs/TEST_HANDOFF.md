# NAJD testing hand-over

For an agent or person with no access to earlier conversations. Everything needed to build, install and test NAJD independently is
here or linked from here. Writing a test, passing a fixture and verifying the installed app are three separate milestones; the results
checklist at the end keeps them apart.

## 1. What is under test

| Item | Value |
|---|---|
| Repository | `C:\NAJD AGENT` (branch `main`, local commits only; nothing is pushed) |
| Source revision | see `git log -1 --oneline` (the commit that adds this file's latest results is named in section 9) |
| App version | `package.json` `version`; installed: `(Get-Item "$env:LOCALAPPDATA\Programs\NAJD AGENT\NAJD AGENT.exe").VersionInfo.ProductVersion` |
| Installer | `C:\NAJD AGENT\release\NAJD-AGENT-Setup-<version>.exe` (NotSigned on purpose; SHA-256 in docs/PROGRESS.md) |
| Browser extension | `browser-extension-v2/` (NAJD Browser, `manifest.json` version 2.1.0); the 1.x extension in `browser-extension/` stays until 2.x is accepted by the owner |
| Native runtime | desktop host `native/windows-node-host` (published to `.runtimes/windows-node-host`, shipped inside `build/bundle/najd-runtime-packed/desktop-host.zip`) |

Verify the loaded extension: in NAJD, Settings > Browser shows each linked browser with the extension version it reported and marks an
older one as outdated. In the browser, `edge://extensions` or `chrome://extensions` shows "NAJD Browser" and its version.

Verify the active native runtime: `Get-ChildItem "$env:LOCALAPPDATA\NAJD AGENT\runtime"` lists content-addressed folders
(`desktop-host-<hash>`); `.najd-generations.json` in that folder names the current generation. A desktop task in NAJD (section 5.3)
proves the host answers.

## 2. Rules for the tester

- Use `npm.cmd` in PowerShell. Tests use temporary profiles (`najd-desktop-test-*` under `%TEMP%`) and fake credentials; never the owner's
  data, accounts or browser profile.
- Live scenarios act only on test-owned windows and pages. Reading an owner app is allowed when the scenario says so; never send from one.
- Installing replaces the running app: check the owner is idle first (no task running; `najd-data\sessions.json` not written recently).
- Start NAJD and installers through `explorer.exe` (not directly from an agent shell), or NAJD's data lands in the agent app's container.
- Do not push, publish, or use the owner's accounts or keys without the owner's word.
- Bash heredocs mangle backslash escapes; write scripts with a file tool, then run them.

## 3. Build, automated tests, install

```powershell
cd "C:\NAJD AGENT"
npm.cmd test                       # Vitest + Node unit tests (expect 0 failed)
npm.cmd run build                  # tsc, the .vue type check, vite build
npm.cmd run smoke:workstation      # shell and routes, Arabic/English, 360-1440 px
npm.cmd run smoke:desktop          # the main flows in the real app, isolated profile, fixture providers
npm.cmd run dist                   # installer into release\
npm.cmd run smoke:package          # the same flows on the packaged layout
```

Native host (only after changing `native/windows-node-host`):

```powershell
npm.cmd run build:windows-node
node scripts/refresh-desktop-bundle.cjs      # repack the host into the runtime bundle
npm.cmd test                                 # tests/installer-config.test.cjs names the AddSize value to put in build/installer.nsh
```

Real-host and real-browser checks (each opens its own test windows):

```powershell
npm.cmd run smoke:desktop-host      # WinForms fixture: list, read, type, sensitive refusal, press, stale targets, screenshot
npm.cmd run smoke:desktop-point     # visual route: type and click at window points with the real pointer
npm.cmd run smoke:desktop-electron  # deep Electron chat window: read, real typing, owner takeover, real click
npm.cmd run smoke:browser-v2        # NAJD Browser 2.x in Edge with a temporary profile
npm.cmd run smoke:mcp-gallery       # needs the internet: adds four MCP servers from the gallery and lists their tools
```

Install locally (silent, outside the agent container). Save as `install.cmd`, set the version, run `explorer.exe install.cmd`:

```bat
@echo off
taskkill /IM "NAJD AGENT.exe" /F >nul 2>&1
timeout /t 3 /nobreak >nul
"C:\NAJD AGENT\release\NAJD-AGENT-Setup-<version>.exe" /S
echo %ERRORLEVEL% > "%TEMP%\najd-install-result.txt"
timeout /t 2 /nobreak >nul
start "" "%LOCALAPPDATA%\Programs\NAJD AGENT\NAJD AGENT.exe"
```

Rollback: run an earlier `release\NAJD-AGENT-Setup-<older>.exe` the same way; data in `%APPDATA%\najd-agent` is kept across versions.

Logs and results: `%APPDATA%\najd-agent\najd-data\errors.jsonl` (provider and tool errors), `run-receipts.json` (per-run model, tokens,
calls, tools), `context-usage.jsonl` (per-request size breakdown), `actions.json` (the approval journal), `logs\` (command output).
Smoke screenshots: the path printed by `smoke:workstation`.

## 4. Fixtures in the repository

- `tests/electron-harness.cjs`: the app with an isolated profile and fixture providers. Prompts containing `thinking fixture`,
  `failover fixture`, `activity showcase fixture`, `workspace write fixture` drive fixed model replies.
- `tests/fixtures/deep-chat-fixture.cjs`: an Electron chat window 22 levels deep with a contenteditable input and a Send button.
- `tests/desktop-host-smoke.cjs`, `tests/desktop-point-smoke.cjs`: WinForms windows created by the test.
- `tests/helpers/edge-extension.cjs`: launches Edge (or Chrome with `NAJD_TEST_BROWSER=chrome`, see 5.2) with a temporary profile and
  the unpacked extension.
- A live chat window for model-driven tests (WinForms, safe to send in): save as `live-chat.ps1` and run with `powershell -STA -File`:

```powershell
Add-Type -AssemblyName System.Windows.Forms
$form = New-Object System.Windows.Forms.Form; $form.Text = 'NAJD Live Chat Test'; $form.Width = 520; $form.Height = 360
$log = New-Object System.Windows.Forms.ListBox; $log.AccessibleName = 'Conversation'; $log.Left = 10; $log.Top = 10; $log.Width = 480; $log.Height = 180
[void]$log.Items.Add('Assistant: Hello! The quarterly report is ready.')
$box = New-Object System.Windows.Forms.TextBox; $box.AccessibleName = 'Message'; $box.Left = 10; $box.Top = 200; $box.Width = 380
$send = New-Object System.Windows.Forms.Button; $send.Text = 'Send'; $send.Left = 400; $send.Top = 198; $send.Width = 90
$status = New-Object System.Windows.Forms.Label; $status.Text = 'Nothing sent'; $status.Left = 10; $status.Top = 240; $status.Width = 480
$send.Add_Click({ if ($box.Text.Trim()) { [void]$log.Items.Add('You: ' + $box.Text); $status.Text = 'Sent: ' + $box.Text; $box.Text = '' } })
$form.Controls.AddRange(@($log, $box, $send, $status)); [System.Windows.Forms.Application]::Run($form)
```

## 5. Live scenarios (installed app, the owner's configured model)

Each scenario: the request to type into NAJD, then what must be true. "Verify independently" means check the window, file or page
yourself, not NAJD's sentence.

### 5.1 Edge (needs the owner: the extension loaded in their Edge, linked once in Settings > Browser)

1. "افتح في إيدج بحث عن سعر الذهب اليوم واقرأ النتائج": Edge opens (not the default browser if different); NAJD lists results.
2. "افتح أول نتيجة واذكر عنوان الصفحة": the reported title equals the tab's title. No `NO_NAJD_TAB` in the activity steps.
3. Attach: open any page yourself, then "اقرأ التبويب المفتوح على <address>": NAJD reads it and never navigates it away.
4. Harmless form: with a local test page containing a text field and a button, "اكتب اسمي في الحقل واضغط الزر": one approval when the
   access mode is "ask"; the page shows the result.
Fixture equivalent (no owner needed): `npm.cmd run smoke:browser-v2`.

### 5.2 Chrome (needs the owner)

Same four steps in Chrome. The scripted check cannot load the extension: branded Chrome 157 ignores `--load-extension` and the DevTools
pipe route (`Extensions.loadUnpacked`) hung here; load it by hand (`chrome://extensions` > Developer mode > Load unpacked >
`C:\NAJD AGENT\browser-extension-v2`) or use Chrome for Testing with `NAJD_TEST_BROWSER=chrome`.

### 5.3 Desktop control

1. Start `live-chat.ps1`. "في نافذة «NAJD Live Chat Test» اكتب في خانة Message: مرحبا من نجد، ثم اضغط Send وتأكد أن الرسالة ظهرت":
   the real mouse pointer moves to the field and the button; the window shows `You: مرحبا من نجد` and `Sent: مرحبا من نجد`; the reply's
   receipt line says the steps were confirmed. Reference on 0.10.78: 4 model calls, about 17k tokens (gpt-5.6-luna); the steps start with a read, not a window list.
2. Owner takeover: during step 1 move the mouse; the step returns paused (USER_ACTIVE) and NAJD asks instead of acting.
3. Emergency stop: start a long task, press Ctrl+Alt+Q: the task stops and a notification says how many were stopped.
4. Read an Electron app (reading only): "اقرأ نافذة تطبيق Claude وقل لي عنوان المحادثة وهل تلقى خانة الكتابة. لا تكتب ولا ترسل": the
   title and the input "Prompt" are reported.
5. Settings > Quick summon: switch the pointer mode to Fast and Off and repeat step 1; the pointer jumps, or moves only for the click.

### 5.4 Skills

"/" in the message box lists skills; choose one and send a short request that needs it. Skills & Plugins > Skills: open a card, read its
guide, press Use. After a task with five or more tool steps, "Save as a skill" appears; it saves only after approval.

### 5.5 Marketplace

Skills & Plugins > sync; install a package (review dialog), disable, enable, roll back, remove. Each state shows on the card; a removed
package's skills disappear from "/".

### 5.6 MCP

Settings > MCP: local cards say "ready" when Node.js / uv exist, otherwise offer "Install Node.js" / "Install uv". Add DeepWiki (no
account): state `connected`, three tools. Ask "اسأل DeepWiki عن مستودع microsoft/playwright: ما الغرض منه؟": an MCP tool call appears
in the steps. Servers that need the owner's account (Figma, Canva, Notion, Linear, GitHub): Sign in opens the provider's page.

### 5.7 Memory

Settings > Conversation memory: add a note, ask a question that needs it in a new chat, delete the note, ask again.

### 5.8 Scheduling

Task Center > New task: a prompt with a time two minutes ahead; it runs, a notification appears, the result is listed; a task that needs
approval is reported as needing approval instead of acting.

### 5.9 Arabic and English UI

Settings > Appearance > language: every screen in both languages, right-to-left and left-to-right, at a narrow window. Type "/" and
Ctrl+F in both. `smoke:workstation` covers widths 360 to 1440 px automatically.

### 5.10 Original NAJD improvements (see docs/TAKEOVER-PLAN.md)

1. My prompts: press the bookmark under a message you sent; type "/" in the message box: the prompt is first; the home screen shows
   "أوامري"; Settings > Common prompts edits it in place.
2. Run receipt: under a finished reply that used tools, a line says how many steps were confirmed, unconfirmed, failed or not done.
3. MCP prerequisites: 5.6 first sentence.
4. Continue a stopped run: start a multi-step task, press Stop, press "أكمل من حيث توقف": the task finishes without redoing finished steps.
5. Scroll: with a long list or page open, "مرّر لأسفل في نافذة <name>": the wheel turns and the step is confirmed.

## 6. Benchmark procedure

Same provider, model and effort for every run; a new conversation per task; note the time before sending.

For each task record from `%APPDATA%\najd-agent\najd-data\run-receipts.json` (last entry): `usage.input`, `usage.output`,
`usage.cached`, `usage.modelCalls`, `toolCalls`, `tools`, and the duration shown on the activity box; success is judged independently.

| Task | Request |
|---|---|
| Short skill question | "وش مهارة humanizer وش تسوي؟ باختصار" |
| Browser workflow | 5.1 steps 1-2 |
| Desktop action | 5.3 step 1 |
| Document creation | "سوّ مستند وورد اسمه bench-report.docx في مجلد نجد فيه عنوان وجدول من 3 صفوف" |
| Marketplace lifecycle | 5.5 (no model tokens; record time and outcome) |
| MCP call | 5.6 DeepWiki question |
| Scheduled task | 5.8 |

Keep cached and uncached input apart: a lower `input` with the same `cached` share is a real reduction; a higher `cached` only is the
provider's cache.

## 7. What needs the owner

| Scenario | Needs | Fixture alternative |
|---|---|---|
| Edge and Chrome with the owner's profile | the extension loaded and linked by the owner | `smoke:browser-v2` (Edge, temporary profile) |
| Saved-account sign-in | accounts the owner authorised in Settings > Accounts | `npm.cmd run smoke:browser-login-v2` |
| Figma, Canva, Notion, Linear, GitHub MCP | the owner's sign-in | `smoke:mcp-gallery` (servers without accounts) |
| Any live model task | the owner's configured provider | `smoke:desktop` (fixture providers) |
| Telegram channel | the owner's bot token | `npm.cmd run smoke:channels` |
| Publishing, pushing, signing | the owner's word and rotated keys | none |

## 8. Known gaps (do not report as regressions)

- Desktop control: the click ring is verified by unit tests and a rendered overlay page, not yet seen on a real screen during a live task; the owner-approval takeover exemption is unit-tested only.
- `smoke:desktop-electron` passed twice, then Electron test windows from `node_modules` began to hang or render blank on this computer
  (cause not established); rerun it and treat a hang as an environment finding to investigate.
- Chrome scripted extension loading (5.2).
- Token work: reads are compact and targeted and a desktop task needs one call fewer; the static system prompt was measured and left as it is because the provider caches it (PROGRESS, 2026-11-13).
- One `smoke:desktop` run timed out once and passed on rerun without changes (2026-11-10); note repeats.

## 9. Results checklist

Status values: passed, failed, blocked (say by what), not run. Latest results, 2026-11-10, source after commit `3b5d552` plus the
"original improvements" commit, installed 0.10.79 (rows not rerun since 0.10.74 say so in PROGRESS):

| Area | Automated test written | Fixture run | Installed app, live |
|---|---|---|---|
| Unit tests (`npm.cmd test`) | yes | passed (123 Vitest + 1157 Node) | n/a |
| Main flows (`smoke:desktop`, `smoke:package`) | yes | passed | n/a |
| Desktop host (WinForms) | yes | passed | passed (5.3 step 1, model gpt-6.1-sol) |
| Desktop visual route | yes | passed | not run with a model |
| Desktop Electron deep chat | yes | passed 3 of 3 on 2026-11-13 (earlier hang not reproduced) | passed reading the Claude app (5.3 step 4) |
| Owner takeover, emergency stop | takeover yes; stop no | takeover passed | takeover seen live (USER_ACTIVE after the mouse was used); Ctrl+Alt+Q passed live (run CANCELLED at once) |
| Edge extension 2.1.0 | yes | passed | loaded and connected in the owner's Edge (2026-11-13); search, first result, attach to an open tab and a public test form run live (PROGRESS, 2026-11-13) |
| Chrome extension 2.1.0 | yes (env switch) | blocked (Chrome 157 refuses scripted loading) | loaded by hand and connected in the owner's Chrome (2026-11-13); the public test form run live, the other requests not run |
| MCP gallery | yes | passed (4 servers) | passed (owner added Context7, Playwright, Exa; Notion and GitHub connected) |
| MCP prerequisites card | yes (`smoke:features`) | passed (missing and ready cases) | passed for the ready case |
| My prompts | yes (`smoke:desktop`, unit) | passed | passed |
| Continue a stopped run | yes (`smoke:desktop`, unit) | passed | passed (three messages, stopped after two, continued: each sent once) |
| Desktop scroll and drag (points and read elements) | yes (`smoke:desktop-point`, unit) | passed | element drag, scroll (top row 15 = Row 16) and the visual-route drag all passed with the owner's model, each confirmed by reading the window; ask-mode approval not run |
| Click ring on screen | unit, `smoke:overlay` (real Electron, painted pixels) | passed | seen by the owner on 2026-11-13 (flashed and vanished) |
| Run receipt | yes (`smoke:desktop`, unit) | passed | passed |
| Skills, marketplace | yes (`smoke:desktop`, `smoke:skill-packs`) | passed in earlier sessions | not run this session |
| Memory (graph, note), scheduling (Task Center run-now) | yes (`smoke:memory-graph`, `smoke:features`) | passed 2026-11-13 | not run |
| Old-UI smokes (memory, learning, slash, chat, activity, plugins, channels) | stale | failing on the removed screen (OPUS-BLOCKERS B-003) | n/a |
| Design skill packs listing (`smoke:skill-packs`) | yes | failing: packs not listed since the Vue migration (OPUS-BLOCKERS B-002) | not run |
| Arabic/English UI | yes (`smoke:workstation`) | passed | Arabic seen live; English seen in a throwaway profile on 0.10.84 (Apps tab follows the language) |
| Benchmarks (section 6) | procedure | n/a | 2026-11-13 on 0.10.8x: skill question 3,943 tokens; MCP (Context7) 24,148; Word document 26,744; desktop drag 13,385; scroll 18,423; visual drag 39,950 (table in PROGRESS); marketplace, scheduled task and browser not run live |
