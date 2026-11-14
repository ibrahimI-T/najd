# Hard items for Fable

Written by the Opus session while working through `docs/OPUS-WORK-PLAN.md`. Each entry is something Opus could not finish or should
not decide alone. The owner hands this file back to Fable. Newest entry at the bottom. Do not delete entries; Fable marks them resolved.

## Entry format

```
## B-<number>: <one-line title>

- Task: T<n> of OPUS-WORK-PLAN (or "original improvement", "found in passing")
- Kind: unknown cause | needs a guard weakened | owner decision | owner access | flaky test | unsure the change is right | proposal
- Date, source commit, installed version:
- What was wanted:
- What happens instead: exact command, exact output or error code, file and line, screenshot or log path
- Attempts (each: what was changed, what was observed):
  1.
  2.
- Ruled out:
- Best guess at the cause, and how sure:
- State of the tree: clean | committed <hash> with <what works / what does not> | test added but skipped? (never skip silently)
- What Fable should try first:
```

## Entries

## B-001: stdio MCP servers declared by foreign packages (T4) need an owner decision

- Task: T4 of OPUS-WORK-PLAN. Kind: owner decision (executes foreign commands).
- Date, source commit, installed version: 2026-11-13, `87ce355`, 0.10.80.
- What was wanted: install, show and run MCP servers that a foreign package declares, with lifecycle tied to the package.
- What exists already (so the R072 audit's "Next" line is partly stale): remote (HTTPS URL) declarations are kept by `electron/workstation/mcp-declarations.cjs`, shown in the Hub package details (`src/vue/components/HubView.vue` ~line 190), added through the sign-in/token flow in `electron/workstation/ipc.cjs` (~lines 89-96) with `ownerPackage`, and disabled, enabled, removed and pruned with the package (ipc.cjs lines 26-30, 112-115). Claude-style plugins (`electron/plugins.cjs`) list `.mcp.json` servers (stdio and remote) as `pendingServers` and the model tells the owner to add them in Settings; no Vue screen lists them.
- What is missing: stdio declarations (`command` + `args` + env names). `mcpDeclarations` drops them on purpose ("retain public connection locations only"), and AGENTS.md / TEST_MATRIX say other executable third-party and arbitrary MCP configurations stay unsupported, with no silent prerequisite or permission grant.
- Why not built: running a command a package author wrote is a security-policy change, not an engineering detail. Opus did not change it.
- Proposal for Fable and the owner: keep the drop by default; add an explicit per-server "Add to NAJD" action in the package details and in the plugin install result that shows the exact command line, folder and secret names and goes through the existing native confirmation (`main.cjs` ~line 608, `mcpServers.add` without `approvedInChat`), tagged with `ownerPackage` so remove/disable follow the package; never start before that confirmation; never copy env values. Needs: importer change, `HubView` row, types, unit tests, one smoke with a harmless fixture server (`tests/fixtures/mcp-fixture-server.cjs` exists).
- State of the tree: clean for this task (nothing changed).
- What Fable should try first: ask the owner whether stdio declarations may be offered behind the native confirmation; if yes, implement the proposal above.

## B-002: the shipped design skill packs are no longer listed or usable (found by T6)

- Task: T6. Kind: owner decision (restores an older requirement, changes what the model sees).
- Date, source commit, installed version: 2026-11-13, `87ce355`, 0.10.80.
- Evidence: `npm.cmd run smoke:skill-packs` fails at `tests/skill-packs-smoke.cjs:17` with `listed: pack-taste-design-taste-frontend` (`window.najdSkills.list()` has no `pack-*` rows). In `electron/main.cjs`, `skillPacks` (line 119) is created and never used (the editor flags it as unused); the bundle at line 570 holds only `workstationSkillRows`, and `createSkillSurface` at line 573 is built with `packages` and `legacy: false` and no `packs`. `git show e680b8e -- electron/main.cjs` shows the Vue-migration commit removed `...skillPacks.rows()` from the bundle and `packs: skillPacks` from the surface. `skill-packs/` (Taste Skill, Impeccable, GSAP, Playwright CLI, Designlang) is still copied into the installer (`package.json` build.extraResources), so the installer carries them unused.
- CORRECTION (same day, found later): this was deliberate. R-070 in docs/USER_REQUIREMENTS.md says the workstation catalog is the only active skill surface and the model must not receive the former upstream, skill-pack, external-skill or legacy catalogs; the comment at electron/main.cjs line 114 says the same. So the packs being absent is the owner's requirement, and `smoke:skill-packs` is a stale test (rewrite or delete it), not a product bug. Only the remaining question stands: whether the shipped `skill-packs/` resource should still be copied into the installer.
- (original text) Unknown: whether the migration dropped them on purpose (new package-based skill model) or by accident. Commits `0a1db46` and `65e5409` say they were required to be built in and always on.
- Not changed because: adding them back puts more skills in the model's catalog (tokens) and changes the new skill surface; the owner should choose.
- Options: (a) re-add `...skillPacks.rows()` to the bundle (one line) and make the surface list them, keep `smoke:skill-packs`; (b) deliver them as Hub packages and delete the smoke and the resource copy; (c) drop them. State of the tree: clean for this task.
- What Fable should try first: ask the owner (a), (b) or (c); then do it with `smoke:skill-packs`, `tests/skill-surface.test.cjs`, and a before/after token count of one request.

## B-003: seven old-UI smokes target the removed screen and fail the same way (T6)

- Update 2026-11-14: `smoke:slash`, `smoke:activity`, `smoke:channels`, `smoke:chat`, `smoke:learning`, `smoke:memory` and `smoke:plugins` were rewritten for the Vue renderer and pass (the last one found a real Copy/Open bug, fixed in 0.10.102) (the "/" menu in Arabic and English; the approved-tool and denied-skill timelines after a full restart, folded and expandable, no file body in them). None remain stale (`smoke:plugins` now tests installing a package from a file; the old GitHub-address plugin flow has no Vue counterpart by design, R-070); they still wait on the removed old selectors. The personality/learning/plugin screens still need an owner decision before they are rewritten.

- Task: T6. Kind: stale tests (not product bugs), rewrite needed.
- Date, source commit, installed version: 2026-11-13, `87ce355`, 0.10.80.
- Evidence: `smoke:memory`, `smoke:learning`, `smoke:slash`, `smoke:chat`, `smoke:activity` time out in `tests/electron-ui-smoke.cjs:112` (`waitFor`) waiting for old selectors such as `.sidebar-link[aria-label="الإعدادات"]`; `smoke:plugins` and `smoke:channels` stop with `Missing control: .sidebar-link[aria-label]`. `grep -rc sidebar-link src/vue` finds nothing: the selector belongs to the React UI that AGENTS.md says is not loaded. They passed in earlier phases against that UI.
- Same run, passing today on 0.10.80: `smoke:memory-graph`, `smoke:extension-store`, `smoke:browser-v2`, `smoke:browser-login-v2`, `smoke:kill`, `smoke:mcp-gallery`, `smoke:desktop`, `smoke:package`, `smoke:features` (Task Center create/pause/run-now with a fixture provider, memory note, MCP, Telegram malformed token, knowledge base, remote control).
- Coverage still missing against the Vue UI: personality and learning screens, the plugin install flow (Claude-style plugins have no Vue screen at all, see B-001), the full activity timeline details, a scheduled task that needs approval being reported instead of acting.
- Not done: rewriting seven smokes is a large job; none was skipped or weakened, they simply remain failing and are named here.
- What Fable should try first: rewrite `slash` and `activity` first (cheap, the Vue selectors exist in `smoke:desktop`), decide with the owner whether the personality/learning/plugin screens still exist as product features.

## B-004: group B live model runs (T10, T11) not run

- Task: T10 (desktop control with the owner's model: scroll, visual route, drag, ask-mode approval, click ring seen live) and T11 (benchmarks other than the 2026-11-13 desktop row).
- Kind: owner access. They need someone to type into the installed NAJD with the owner's configured provider and to leave the mouse alone while NAJD acts; the owner is using this computer, and an earlier session's screen-access requests were refused or denied. Nothing was attempted or simulated.
- What exists to run them: requests in `docs/TEST_HANDOFF.md` sections 5.3 and 6, the `live-chat.ps1` fixture (section 4), the drag pad in `tests/desktop-point-smoke.cjs`, and installed 0.10.80 (drag between controls, click ring, `repeatedCalls` in receipts). The ring has been seen only on a rendered overlay page, not on a real screen during a task.
- What Fable or the owner should do: run 5.3 steps 1 and 5 plus scroll, drag and ask-mode approval once with the owner idle, then read `run-receipts.json` (`repeatedCalls`, tools, tokens) and the ring on screen.

- Update 2026-11-13 (same day): the element drag was run live on 0.10.81 and passed (see PROGRESS). Still not run: scroll with a model, the visual route with a model, ask-mode approval, the click ring seen on a real screen, and the other benchmark rows.

- Update 2026-11-13: B-001 decided by the owner: allow MCP servers of all kinds (stdio and remote), keeping the native confirmation of the exact command. B-004: the ring was seen by the owner and ask-mode approvals appear for them. Old worktrees were deleted at the owner's word (T14 done).

- B-001 implemented 2026-11-13 (0.10.89): stdio declarations are kept and offered with an "Add and run" button in the Hub package details; the native confirmation of the exact command stays. Not covered: Claude-style plugins (`electron/plugins.cjs`) still only list their `.mcp.json` servers to the model as pending proposals, and no live package with a stdio declaration was installed to see the row in the installed app (unit tests only).

## B-005: a JSON response page reads as empty text through najd_browser (found live, cause unknown)

- **Update 2026-11-14 (owner approved the download in chat: "وافق"): does not reproduce in a clean Chrome 157.** Chrome for Testing 157.0.8103.78 (`chrome-win64.zip`, 209,854,321 bytes from storage.googleapis.com/chrome-for-testing-public, unpacked and run only from a temporary folder, deleted afterwards) ran the whole `browser-extension-v2-smoke` with the 2.1.0 extension in a temporary profile and it passed, including the real POST form whose reply must read as text (`custname` present, a later read agrees). The same Chrome version as the owner's, a clean profile, and the failure is gone. So the empty reply on the owner's computer most likely comes from something specific to that Chrome profile (an extension that renders JSON, a policy or antivirus web protection) or from the public httpbin page; the extension itself reads a POST reply correctly. Not proven: no run was made against the live httpbin.org (that would send a form to a public site), and the owner's profile was not inspected. If it appears again, check in the owner's Chrome with all other extensions disabled, and note `document.contentType` of the reply. The test helper now accepts `NAJD_TEST_BROWSER_PATH` so the same checks can run in any Chrome build.

- Task: found in passing (live Chrome run, 2026-11-13, 0.10.97). Kind: unknown cause.
- What happened: after pressing Submit order on `https://httpbin.org/forms/post` in the owner's Chrome, the press result returned the address `https://httpbin.org/post` and an empty page text; a separate later `najd_browser read` of the same tab also returned empty text (twice, so not only a snapshot taken before rendering). The response of that address is JSON.
- Narrowed the same day (0.10.97): `https://httpbin.org/get` (a JSON reply to a plain GET) reads fine in the owner's Chrome (`{ "args": {}, "headers": {...`), and the real-Edge smoke now asserts that a JSON page and a plain-text page open and read as text (`smoke:browser-v2`, passes). So JSON pages are not the problem; the empty text appeared only on the page that follows a form POST press (twice, in Chrome). Not reproduced in Edge or with a fixture POST; the fixture forms in the smoke prevent the real submit.
- Edge does not reproduce it: `smoke:browser-v2` now has a real POST form (`/postform` posting to `/echo`, a JSON reply) and asserts that the page after the press reads as text (`custname` present, URL ends with `/echo`) and that a later `read` shows the typed value; it passes. So the empty text is specific to branded Chrome 157 (the only place seen) or to httpbin's response. Next to try: Chrome for Testing with the extension (`NAJD_TEST_BROWSER=chrome`, see TEST_HANDOFF 5.2), or repeat the live Chrome request and read `document.contentType` and `document.body.innerText` through a one-off diagnostic in the extension right after the navigation.
- Where to look: `browser-extension-v2/src/page-scripts.js` line 113 builds `text` from `document.body.innerText`; check `document.contentType` and how Chrome 157 renders raw JSON (a `<pre>` possibly inside a shadow root or an extension-injected viewer), and whether `observe.js` skips non-HTML documents. A fix could fall back to `document.documentElement.innerText` or to the raw response text for non-HTML content types, with the same masking and length limits.
- Effect: a task that submits a form and wants to confirm the server's reply cannot read it; the address change (`navigated`) is the only evidence.
- State of the tree: clean for this item (nothing changed). Tools for the check: a public echo page such as httpbin.org/forms/post, Edge or Chrome with the extension loaded.
