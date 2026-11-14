# NAJD takeover plan and ledger (Fable, from 2026-11-10)

Maintained plan for the owner's takeover work order. Earlier evidence stays where it is: `docs/KIMI-REFERENCE-LEDGER.md` (REA analysis of
the installed Kimi), `docs/MIGRATION-PLAN-R078.md` (stack decision, gap matrix, extension protocol), `docs/R072-CAPABILITY-AUDIT.md`,
`docs/NAJD_WORKSTATION_PARITY_SPEC.md`. Testing lives in `docs/TEST_HANDOFF.md`; day-by-day evidence in `docs/PROGRESS.md`.

## 1. Recovered state (verified 2026-11-10)

- `main` at `3b5d552` before this plan; clean except the owner's untracked files (`CLAUDE_FIX_AND_LIVE_TEST.md`, `CLAUDE_START_HERE.md`,
  an old extension zip) and the `third_party/openclaw-windows-node` submodule pointer. Three old detached worktrees under `C:\ClaudeTmp`.
- Installed app equals the source version (checked with the executable's ProductVersion after each install).
- Framework decision stands (owner, R-079): Electron + Vue 3 + TypeScript + Vite, the reference's own stack; the .NET host stays for
  UI Automation, input and capture. No reason found to change it: the measured desktop-control failure was a depth limit, not the stack.

## 2. Capability matrix (status now)

| Area | Status | Evidence | Next |
|---|---|---|---|
| Shell, rail, composer, model picker, workbench, settings | done (Vue) | `smoke:workstation`, `smoke:desktop` | visual pass against Kimi screen by screen (not redone this session) |
| Chat: thinking, file cards, thumbnails, find, branch, pin, rename, export, read aloud | done | PROGRESS R-083; checked on the owner's screen | - |
| Browser extension 2.1 (CDP, owned/attached tabs, protocol 2) | built; Edge fixture passes | `smoke:browser-v2` | owner's Edge and Chrome live (TEST_HANDOFF 5.1, 5.2); then retire 1.x |
| Desktop control | read depth fixed, real pointer/click/type/scroll, visual route, mouse and keyboard takeover, stop | PROGRESS R-084 and 0.10.77; live with the owner's model | drag between read elements, click highlight |
| Skills, plugins, marketplace | verified package manager; skill sources widened | `smoke:desktop`, earlier smokes | declared MCP servers of foreign plugins (R-072 "Next") |
| MCP | gallery of 37, OAuth sign-in, prerequisites check | `smoke:mcp-gallery`, live | owner sign-ins |
| Memory, learning, scheduling, channels, remote | present from earlier phases | earlier smokes | not re-verified this session |
| Runtime: failover, receipts, skill offer, picture fallback | done | unit tests, `smoke:desktop` | repeated-call detection review |
| Tokens | measured; compact and targeted reads | PROGRESS R-084 | instructions and tool definitions (needs before/after tasks) |

## 3. Milestones

1. M-A (done): desktop control root cause and real input.
2. M-B (in progress): original improvements from using NAJD (section 5).
3. M-C: desktop gaps (scroll, drag, keyboard takeover), each with a real-host smoke.
4. M-D: browser live acceptance with the owner; 1.x retirement.
5. M-E: token reduction with the benchmark in TEST_HANDOFF section 6, before and after.
6. M-F: Kimi visual pass per screen with screenshots side by side; English pass.

Release gates for every installed build: `npm.cmd test`, `npm.cmd run build`, `smoke:desktop`, `smoke:package`, then install and
check the version. Rollback: any earlier installer in `release\`; user data is kept.

## 4. Risks

- Electron test windows hanging on this computer (unexplained) weakens `smoke:desktop-electron` until understood.
- Real input (click/type) acts on whatever is under the point: guarded by window identity, the covered-target check and takeover pause;
  a drag action must keep the same guards.
- The owner's signing key is treated as compromised: no release until rotated.

## 5. Original NAJD improvements

Found by using NAJD as a daily agent and by reading what its screens promise.

### 5.1 My prompts (saved requests that actually work)

- Problem noticed: Settings > Common prompts let the owner save prompts, but nothing in the app ever used them; repeating a request that
  worked meant retyping it or digging through old chats.
- Change: a bookmark under every sent message saves it (again removes it); saved prompts come first in the "/" menu, found by any of
  their words, and fill the message box for editing; the home screen shows them under "أوامري / My prompts"; Settings edits them in place.
- Verified: unit test (slash menu), `smoke:desktop` (save, then "/" shows it), and in the installed 0.10.74 on the owner's screen (saved a
  message, saw it first in "/", removed it again).

### 5.2 Run receipt

- Problem noticed: after a task the owner saw "4 tools used" and the model's own sentence; nothing said which steps NAJD itself confirmed
  and which effects were unknown, although the runtime already knows.
- Change: under each finished run, a line in the owner's language from the real step results: confirmed, unconfirmed ("check before
  relying on it"), failed, not done. Notes, planning, discovery and approvals are not counted. Orange when anything is unconfirmed or failed.
- Verified: unit test, `smoke:desktop` (the showcase run with a failing read shows confirmed and failed), installed app (the live desktop
  run shows its four confirmed steps).

### 5.3 MCP prerequisites with a setup action

- Problem noticed: local MCP servers need Node.js or uv; adding one without it fails with COMMAND_NOT_FOUND, which tells the owner nothing.
- Change: the gallery asks the main process which of npx and uvx exist; a card says "ready" or "X is missing on this computer" and then
  offers "Install X" (the official page) and "Recheck" instead of an Add that would fail.
- Verified: installed app shows "ready" on local cards (both tools exist on this computer); the missing case is not tested live.

### 5.4 Continue from where it stopped

- Problem noticed: pressing Stop (or a failure) left only "Dismiss"; asking again made the model start over and repeat steps already done.
- Change: the banner offers "أكمل من حيث توقف"; the request runs again and the model first gets a note of the steps the stopped attempt
  took with their real state, told not to repeat finished steps and to check uncertain ones.
- Verified: unit test, `smoke:desktop` (stop at an approval, continue, approve, the model confirms the note). Live on 0.10.77 with the owner's model: a three-message task stopped after two and continued sent each message exactly once.

### 5.5 Read a window by its title

- Problem noticed: the receipts showed every desktop task paying a model call to list windows before reading the one the owner named.
- Change: `najd_desktop_read` accepts the title or program name; one match is read, several are listed, none is guessed.
- Verified: unit test; installed 0.10.78 with the owner's model on the same task: 4 calls and 17,288 tokens against 5 calls and 21,172.

### 5.7 Drag between two read controls

- Problem noticed: drag worked only between two screenshot points, so moving a list item onto a folder or a card onto a column in a window NAJD could read still needed a screenshot round trip and pixel guesses.
- Change: `najd_desktop_act` action drag takes the control to drag and, in text, the id of the control to drop on (both from the latest read). One approval names both; the host re-checks both identities, that both ends are on the window, takeover pause and cancellation, then presses, glides and releases.
- Verified: unit tests (approval text, both identities sent, denial sends nothing, bad destination refused); real-host smoke (a button dragged onto a field, a changed destination and a drop on itself refused); installed 0.10.80 and 0.10.81 contain it. Not yet run with a model on a live task (OPUS-BLOCKERS B-004).

### 5.8 A ring where NAJD acted

- Problem noticed: the pointer glides, but a click, a typed field or a scroll leaves no mark, so the owner cannot tell afterwards where NAJD acted.
- Change: the host reports the screen position of each act; the control overlay draws a fading ring there on the right display (orange at the start, green at a drag's end); none when the pointer mode is Off.
- Found live on 0.10.81: the model mostly presses controls with `invoke`, and `invoke`, `setValue`, `toggle`, `select` and `focus` reported no position, so no ring would have drawn for the commonest acts. 0.10.82 reports the control's centre for every element act (real-host smokes assert it for a press and a scroll).
- Verified: unit tests (multi-display and DPI conversion, off mode, failures never change the result); overlay page rendered with the rings. The overlay window is excluded from screen capture on purpose, so no screenshot (mine included) can show the ring or the frame: only the owner at the screen can confirm it.

### 5.9 Repeated calls are measured

- Problem noticed: receipts record how many times a tool ran but not whether the same call was made again, so wasted repeats could not be found.
- Change: the run receipt carries `repeatedCalls` (calls identical in tool and arguments to an earlier call of the run); nothing is limited.
- Verified: unit tests for the runtime and the receipt store; installed from 0.10.80, so new receipts in `run-receipts.json` show it.

### 5.10 Fixed tabs follow the language

- Problem noticed: after switching to English, the workbench tab opened earlier still said "التطبيقات".
- Change: fixed tab titles are computed when drawn.
- Verified: `smoke:workstation` asserts the tab name in both languages; screenshot en-1440 shows "Apps"; installed in 0.10.81.

### 5.11 The office guide is served again

- Problem noticed: using NAJD for a Word task showed a red failed step: the instructions name the `najd-office-design` guide but it was no longer served after the migration, so every office task wasted a call and lost the guidance.
- Change: the guide moved into the active workstation layer (R-070) with a catalog entry; a test keeps every guide named by the instructions present.
- Verified: unit test; installed 0.10.83, same request: the step is green and the run completed (4 model calls, 26,744 tokens). The slow Office review now says "≤ 3 min" on its running step (0.10.84, seen in the installed app).

### 5.12 Arabic-first rail

- Problem noticed: a first-launch run showed "Remote control" and "Apps Beta" in English inside the Arabic rail while every other item was Arabic.
- Change: rail and workbench start button labels are translated ("التحكم عن بعد", "التطبيقات", "تجريبي").
- Verified: smoke:workstation (both languages, no overflow); seen in the owner's installed 0.10.85 window.

### 5.13 MCP servers of every kind from packages (R-085)

- Problem noticed: a package's declared stdio MCP commands were dropped on purpose, so most package MCP servers could not be used at all.
- Change: declarations keep the command, arguments and variable names; the package details list them with an "Add and run" button; adding goes
  through NAJD's native confirmation of the exact command; package-owned lifecycle (disable, enable, remove, update); no values copied; nothing
  starts by itself.
- Verified: unit tests (`tests/mcp-declarations.test.cjs`); built and gated as 0.10.89, not yet installed or seen with a real package.

### 5.14 Memory used in the last request

- Problem noticed: the memory trace was recorded for every request but never shown, so the owner could not see what shaped an answer.
- Change: a "Memory used" block in the session details with the notes, their reasons in the owner's language and a pointer to edit them.
- Verified: `smoke:workstation`, `smoke:memory-graph`; seen in the installed 0.10.96 on a real conversation.

### 5.15 A memory chip under each answer

- Problem noticed: only the latest request's memory was visible, not what shaped an earlier answer.
- Change: a brain chip with the note count in each answer's action row that opens the list with reasons.
- Verified: unit tests for the matching and the reason texts; seen in the installed 0.10.98 on a real answer.

### 5.6 Earlier in the same takeover (R-083/R-084, Opus session)

Backup model on failure, Save as a skill after long tasks, picture fallback for text-only models, compact and targeted window reads,
owner-takeover pause and emergency stop. Details and verification in PROGRESS.

## 6. Ledger

| Date | Build | Result |
|---|---|---|
| 2026-11-10 | 0.10.73 | desktop control fixed; live: 5 calls, 21,044 tokens (was 9 calls, 55,363, failed) |
| 2026-11-10 | 0.10.74 | original improvements 5.1-5.3 installed and checked on screen; Edge fixture passes; Chrome scripted loading blocked |
| 2026-11-10 | 0.10.77 | scroll, keyboard takeover, approval fix, continue a stopped run; live desktop task: 5 calls, 21,172 tokens, 18 s |
| 2026-11-13 | 0.10.78 | read a window by title: same desktop task 4 calls, 17,288 tokens (was 5 calls, 21,172) |
| 2026-11-13 | 0.10.79 | drag on the visual route (real-host smoke); Ctrl+Alt+Q live; system prompt measured and kept (cached) |
| 2026-11-13 | 0.10.80 | drag between read controls, click ring, `repeatedCalls` in receipts, MCP missing-card test (Opus session) |
| 2026-11-13 | 0.10.81 | workbench tab titles follow the language |
| 2026-11-13 | 0.10.87 | model chip no longer names an unconfigured provider; "/" tip on the Skills page (from the Kimi comparison) |
| 2026-11-13 | 0.10.86 | ring tested in real Electron, waits for a cold-start page, larger and longer |
| 2026-11-13 | 0.10.85 | Arabic labels in the rail (found in a first-launch run) |
| 2026-11-13 | 0.10.84 | Office review step says it can take up to 3 minutes |
| 2026-11-13 | 0.10.83 | office design guide served again (found in a live document task) |
| 2026-11-13 | 0.10.82 | ring also for press, set value, toggle, select and focus (found in a live run) |
