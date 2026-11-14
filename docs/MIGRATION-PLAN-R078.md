# NAJD migration plan toward the reference (R-078)

Inputs: `docs/KIMI-REFERENCE-LEDGER.md` (evidence), the owner's screenshots, `CLAUDE_FIX_AND_LIVE_TEST.md`, `docs/NAJD_WORKSTATION_PARITY_SPEC.md`. Status lines in each milestone are updated with evidence as work lands.

## 1. Technology comparison

| | Reference (verified) | NAJD now |
|---|---|---|
| Desktop | Electron, electron-vite layout | Electron 44 |
| Renderer | Vue 3 (+ React islands) | React 19 + TypeScript + Vite |
| Styling | CSS custom properties (Bg/Fills/Labels/Separators/Colors/Radius) | CSS custom properties with the same values (`src/workstation/shell.css`) |
| Native | koffi + N-API addons (UIA, input, capture, OCR) | .NET Windows host over the node gateway (UIA, input, capture) |
| Browser | MV3 extension, CDP via `chrome.debugger`, local WebSocket bridge exe | MV3 extension, injected scripts, authenticated HTTP bridge in the main process |

## 2. Framework decision

**Superseded by the owner (R-079):** use the reference stack. The renderer moves to Vue 3 + TypeScript on Vite with the electron-vite layout; Electron stays. NAJD-owned code only. The analysis below is kept as the record of the earlier choice.

Options weighed:
1. **Keep Electron and React (chosen).** The reference itself is Electron; nothing observable depends on Vue. Every screen in the screenshots is reproducible with React and the observed tokens. No migration cost, existing tests and IPC stay.
2. **Keep Electron, switch the renderer to Vue.** Matches a framework name only. Rewrites every screen and test with no visible gain. Rejected.
3. **Full desktop-stack change.** Would move away from the reference, not toward it. Rejected.

## 3. Gap matrix (screen and capability)

| Area | Reference | NAJD state | Milestone |
|---|---|---|---|
| Rail, Work/Chat, New task, sections, account | screenshot 12–13 | rebuilt (0.10.27) | done; polish in M3 |
| Home composer, model picker, chips, under-strip | 9–11 | rebuilt; context-length menu missing (no runtime support) | M3 |
| Plugins / Skills market | 5–6 | rebuilt layout over the verified package manager | M3 polish, M5 real sources |
| Right panel Start here / session panel | 4, 8 | rebuilt | done |
| Profile / self-improvement | 7 | rebuilt on learning review | done |
| Browser extension | CDP-based, tab sessions, find_tab | injected scripts, single owned tab plus attach (1.2.0) | **M1 (high priority)** |
| Desktop control | native UIA/input/capture/OCR addons, visible control | .NET host, overlay frame (no cursor) | M4 |
| Skills/plugins/MCP lifecycle | marketplace + gateway | verified package manager, owned MCP servers, HTTP MCP | M5 |
| Token use | not traced | named-skill metadata, observation retirement, routing | M6 |

## 4. Design system

Tokens: the ledger values, already in `shell.css` (`--ground`, `--surface-1..4`, `--label-1..4`, `--line`, colors). Components (`src/workstation/ui.tsx` plus `MarketView`, `ModelPicker`, `SessionPanel`): Button, IconButton, Segmented, Tabs, Chip, Search, Field, Toggle, Row, Section, Badge, Banner, Empty, Skeleton, Page, Dialog, Menu, SplitHandle, MarketCard, CategoryPills. Rules: 4 px rhythm, radii 4–24, 32–40 px controls, focus rings, RTL/LTR, reduced motion.

## 5. Browser extension and bridge protocol (M1)

New extension `browser-extension-v2/` (NAJD Browser 2.0.0), written for this plan; the 1.x extension stays in `browser-extension/` until v2 passes acceptance.

- Browsers: Chrome and Edge (Chromium MV3).
- Transport: the existing authenticated local bridge (`electron/browser-bridge.cjs`): pairing code, bearer secret, origin check, long-poll command queue. No second server. The extension sends `{ protocol: 2, version }` on connect; NAJD refuses unknown major protocols with `PROTOCOL_MISMATCH`.
- Page control through `chrome.debugger` (CDP): `Accessibility.getFullAXTree` for observation, `DOM.getBoxModel` + `Input.dispatchMouseEvent` / `Input.insertText` / `Input.dispatchKeyEvent` for actions, `Page.navigate` for navigation. Every observation has an id; actions name the observation and an element ref (`backendDOMNodeId`); a stale id is refused.
- Ownership: tabs NAJD creates are grouped as "NAJD" and marked `owned`; tabs the owner's page attaches are `attached` and are never navigated away or closed by NAJD. `list_tabs` shows both.
- Commands: `hello`, `list_tabs`, `attach` (exact URL or tab id), `open`, `observe`, `read`, `click`, `type`, `select`, `scroll`, `back`, `focus`, `detach`, `screenshot`.
- Recovery: tab sessions persisted in `chrome.storage.session`; debugger re-attached on demand after service-worker sleep; navigation invalidates observations.
- Safety: passwords and payment fields are reported as sensitive and never typed by the model; private and local addresses refused; actions keep the existing approval policy in NAJD.
- Permissions: debugger, tabs, tabGroups, storage, alarms, sidePanel, scripting (side panel page text), host `<all_urls>` for reading pages the owner asks for.

Acceptance: unit tests for the protocol module; real Chrome test with a fixture site (open, attach exact tab, observe, click a link, verify destination, type and submit a harmless local form); version shown in NAJD equals the loaded extension.

## 6. Skills, plugins, MCP (M5)

Package manager stays the single owner of install/enable/disable/update/rollback/remove; owned MCP servers follow the package; readiness requires a passing probe; missing accounts and keys are named with a setup action.

## 7. Milestones

1. **M1 browser extension v2 and bridge negotiation** — tests, fixture live test, then switch.
2. **M2 desktop control visibility** — cursor position from element bounds where the host reports them.
3. **M3 screen polish** — context-length control when the runtime supports it, remaining dialogs.
4. **M4 desktop observation cost** — fewer re-reads.
5. **M5 market sources and provider adapters.**
6. **M6 token benchmark** — identical tasks before and after.

## 8. Data, rollback, packaging, testing

No user data changes format in M1; the old extension folder is kept. Rollback is the previous installer plus Git history. Each milestone: unit tests, `npm.cmd test`, build, workstation smoke (source and packaged), install, live task with the configured model, measurements in `docs/PROGRESS.md`.
