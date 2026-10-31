# NAJD 0.10.12 local update

Fixes the real failures the owner found in 0.10.11 (live tests 2026-10-31), adds Projects and @ mentions of earlier
chats, and makes a new chat start clean. Local update only; no public release, signing or publisher change.

## Root causes and fixes

- **Skill guides refused as NOT_FOUND.** The `najd_skills_read` schema is strict, so every call must carry `file`.
  Models filled it with `SKILL.md` or the guide's file name, and any value for a non-pack guide was refused. The skill
  surface moved to `electron/skill-surface.cjs`: an empty value, `SKILL.md`, the id, `<id>.md` or the listed path all
  mean the main guide; pack files must still be listed; errors carry a hint (listed files, near ids); long guides return
  `nextOffset`. The tool description now says `file: ""` for the main guide.
- **Desktop read after opening Notepad: NOT_FOUND.** `najd_desktop_open` returned a window id that was never registered
  for the run. Reads now look an unknown id up in a fresh read-only list (approval still required).
- **Desktop read after "New tab": STALE_TARGET.** The host refuses a changed title. A read is retried once for the same
  window handle, process id and creation time; another process is never followed. Actions are never retried.
- **Fewer turns for desktop work.** Each `najd_desktop_act` returns `after`, the window read again (bounded, no new
  approval), so the model verifies without another read.
- **HTML counter loop.** `najd_terminal_run` refuses server and watcher commands before running (`USE_PROCESS_TOOL`)
  and loads the process tools; `najd_web_preview` is offered to every model (text, console errors, overflow; the
  picture only to vision models) and gains `steps` (click, fill, read, expect, wait) to prove buttons and forms work on
  local files and localhost only. The activity line reports `steps N/M passed`. "HTML page" and "preview" requests now
  load the preview tool.
- **Wrong toolset loaded first.** Loadable toolsets are listed with their purpose; a named file to create loads the
  write tools.
- **Repeated work.** The same deterministic observation that failed is answered from that failure until NAJD changes
  something (`REPEATED_FAILURE`); the same call five times in a row is stopped before it runs (`LOOP_DETECTED`).
  Errors carry a `hint` the model can act on.

## New chats, @ mentions and Projects (owner request 2026-10-31)

- A new chat starts with no attachments, activity or files of another chat; memory recall no longer adds excerpts of
  other conversations automatically. Personality and saved memories still apply.
- Typing `@` in the composer lists earlier chats; the chosen chat's newest messages (bounded) are quoted for the model
  as data and stay referenced for that conversation.
- Projects in the sidebar: name, instructions, library files (up to 20, attached to the project's chats), an optional
  folder granted through the owner's own folder dialog, and the project's chats. Only chats in a project see it.

## Usage accounting (owner's 0.10.11 runs, Kimi Code)

| Run | Model calls | Reported total | Input | Cached input | Output |
|---|---:|---:|---:|---:|---:|
| Notepad test | 12 | 77,398 | 75,829 | 62,208 | 1,569 |
| Five-line file test | 5 | 26,086 | 25,519 | 9,728 | 567 |

The reported total includes provider-cached input; cached tokens are usually billed lower or count differently against
a subscription, so the total is not the billed amount. Each call resends instructions and tool schemas (about 6k
tokens in these runs), so the main saving is fewer calls: the failures above cost at least 4 extra calls in the Notepad run and
2 in the file run.

## Real-model evidence (local qwen3-vl:4b-instruct through the isolated app, scripted scoped approvals)

`tests/real-model-acceptance.cjs`; results in `release/qa-real-model/`.

| Workflow | Result | Model calls | Reported tokens |
|---|---|---:|---:|
| Five numbered lines, write and read back | passed | 3 | 7,539 |
| HTML counter: write and preview | file written, preview used | 5 | 18,402 |
| Screenshot of a fixture window (vision) | passed: read the number 4821 from the image | 3 | 8,162 |
| Save a skill, then reuse it | saved; the 4B model did not reuse it | 2 + 2 | 10,258 |
| Latest Python release (research) | failed: INVALID_MODEL_OUTPUT on the first call | 1 | 2,006 |

This is one small local model. Real Notepad was not driven by a model in these runs to keep the owner's restored
unsaved Notepad tabs untouched; the desktop mechanism is proven on a fixture window through the real host
(`tests/desktop-recovery-smoke.cjs`). Kimi, ChatGPT and other subscription models were not run (no credentials are
imported into isolated tests); the owner's manual acceptance on them is pending.
