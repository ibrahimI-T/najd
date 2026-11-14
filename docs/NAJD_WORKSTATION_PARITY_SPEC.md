# NAJD Workstation — Full Product Replacement Specification

Status: owner-approved implementation work order, 2026-11-07.

This is a standalone NAJD product specification assembled by the owner. It is the authoritative target for the next implementation program. Build it as original NAJD code inside the existing repository. Keep the NAJD name, logo, repository history, accounts, provider configuration, chats, projects, and safely migratable user data. Replace the current visible product shell, navigation, capability catalog, work surfaces, and extension experience wherever they conflict with this specification.

Do not create a new repository. Do not copy closed-source binaries, private endpoints, credentials, service tokens, or trademarked assets. Reuse only dependencies whose licenses are reviewed and recorded. Functional and interaction parity is required; implementation must remain NAJD-owned and maintainable.

## 1. Required outcome

Opening NAJD must feel like one coherent agent workstation rather than a chat window with disconnected settings:

- two primary modes: `Work` and `Chat`;
- a permanent left rail for projects, tasks, conversations, control surfaces, and account menu;
- a central conversation/task surface with attachments, model/effort selector, voice input, project selector, plugins, and task-category chips;
- a resizable right workbench with tabs for Apps, browser pages, files, documents, slides, spreadsheets, dashboards, code, media, 3D models, scientific content, canvases, and widgets;
- first-class Skills and Plugins marketplace, installed inventory, search, categories, details, install/update/disable/remove, dependency health, and personal packages;
- real browser control, Windows computer control, WebMCP, scheduling, remote control, persistent projects, memory, and task recovery;
- polished Arabic RTL and English LTR with the same information architecture;
- no dead controls, fake readiness, fabricated tool execution, or silent provider/model changes.

Only NAJD branding may appear in the product UI. Internal compatibility aliases may exist during migration, but user-facing labels, asset names, package display names, and help text use NAJD.

## 2. Existing repository constraints

Keep the proven application foundation unless a measured blocker is documented:

- Electron 44 main/preload process;
- React 19 + TypeScript renderer;
- Vite 8 build;
- CommonJS services under `electron/`;
- current provider adapters, protected credentials, session stores, updater, and signed approval/task journals;
- current OpenClaw and Hermes integrations behind one NAJD orchestration boundary.

The target reference used Electron with separate main, preload, renderer, local agent runner, managed plugin runtime, native Windows modules, and loopback control channels. Reproduce that boundary in the current React architecture; do not migrate the renderer to another framework solely to imitate an implementation detail.

Recommended ownership:

```text
najd-main
  windows, protocols, updater, secure storage, native permissions,
  filesystem policy, plugin provisioning, runner supervision

najd-preload
  typed and sender-validated request/response/event contracts only

najd-renderer
  shell, Work/Chat, projects, task activity, stores, marketplace,
  workbench, settings, accessibility and localization

najd-agent-runtime
  durable model/tool loop, task state, toolset selection, receipts,
  recovery, usage accounting, skills and delegation

najd-plugin-runtime
  manifests, skill resources, MCP servers, managed dependencies,
  install/update/rollback, personal registry and health checks

najd-native-windows
  UI Automation, screen capture, OCR, input, window discovery,
  file-manager selection, named pipes and bounded desktop effects
```

## 3. Primary navigation and screens

### 3.1 Persistent shell

Left rail, top to bottom:

1. compact app/menu button;
2. segmented `Work | Chat` switch;
3. `New task` with shortcut hint;
4. Dashboard;
5. Skills & Plugins;
6. Task Center;
7. Remote Control;
8. Apps;
9. Projects section with add-folder action and project conversations;
10. Tasks/history section;
11. account button and plan badge.

The rail is resizable and collapsible. Keep it on the left in both Arabic and English, while content direction changes correctly.

### 3.2 Work home

- centered NAJD Work mark;
- large rounded task composer;
- attachment/add-content button;
- execution profile button, model/effort selector, voice input, and send;
- project picker and plugin picker below the composer;
- category chips: Recommended, Slides, Research, Build, Dashboard, 3D;
- optional credit/usage notice derived from the active provider, never hardcoded;
- empty, loading, offline, degraded, cancelled, failed, and recovery states.

### 3.3 Chat mode

- ordinary conversations without workspace execution chrome unless tools run;
- transparent assistant replies, compact owner bubbles, code blocks, citations, copy, retry, edit, stop, and jump-to-latest;
- provider/model/effort stays visible and persists per conversation;
- actual tool activity appears above the response and can expand after completion.

### 3.4 Dashboard gallery

- tabbed dashboard work surface;
- starter templates and preview cards;
- interactive preview, edit toolbar, full-width mode, and save-to-project;
- template families for finance, BI, projects, daily brief, personal tracking, and custom dashboards;
- responsive grid and empty/loading/error states.

### 3.5 Skills and Plugins hub

Two top tabs: `Plugins` and `Skills`.

Plugins:

- title, explanation, search, `Add new`;
- categories: Installed, Featured, Finance, Productivity, Creativity & Design, 3D, Developer Tools, Research, Legal, Personal;
- cards show icon, title, publisher, short capability, readiness, install/update state, details menu;
- personal market supports local packages, Git URL, reviewed registry source, and one-click install without app restart where safe.

Skills:

- local-skills folder action;
- search and `Custom skill` action;
- categories: Installed, Featured, Productivity, Finance, Academic, Marketing, Engineering, Creative;
- cards show publisher, users/download count when the source supplies it, description, Use, Install/Update, More;
- progressive disclosure: descriptions are indexed, full procedures load only when selected;
- marketplace pagination must continue until `nextCursor` is null. Never stop after the first visible cards.

### 3.6 Task Center

- scheduled and recurring tasks;
- create from chat;
- list, next run, last result, delivery destination, status, run history;
- enable, pause, edit, run now, cancel, archive, delete with the existing approval policy;
- Cron/timezone/DST handling and restart-safe execution.

### 3.7 Remote Control

- pair phone/device with scoped, revocable tokens;
- allow/deny remote control;
- keep-computer-awake option with clear power behavior;
- QR/onboarding instructions;
- check progress, add instructions, resume incomplete work;
- device list, last seen, permissions, revoke, audit trail;
- loopback/local-first transport and no credential exposure to the model.

### 3.8 Apps workbench

- opens as a resizable right panel beside the task composer;
- tab strip, new-tab action, close, and full-width toggle;
- apps can expose structured tools the agent can understand and operate;
- initial app families: Lark, GitHub, Notion, AI Florist, Walk Together, board game, Shader Editor, Logo Maker, Draw & Guess, Visual Solution, Vivid Menu, Data Canvas;
- external apps declare origin, tools, permissions, authentication, and readiness;
- WebMCP tools are discovered from the current visible page and never invented.

### 3.9 Settings

Searchable settings with these routes:

- Account & Security;
- Notifications;
- Appearance;
- Shortcuts;
- Feature Management;
- Quick Summon;
- Startup & Launch;
- Permissions & Control;
- Archived Tasks;
- Desktop Pet;
- General;
- Subscription, Billing and Gift Cards only through provider-neutral adapters;
- Conversation Memory;
- Chat Settings;
- Common Prompts.

Appearance supports Light, System, Dark; font size; language; UI zoom with reset. Permissions & Control has separate managed states for Windows computer use, owner-browser use, and the built-in browser. Feature Management includes task suggestions and generated-media watermarking.

Additional advanced surfaces remain available from Settings/Capability Atlas: Agents, Sessions, Cron, MCP, Channels, Nodes, Instances, Usage, Config, Logs, Debug, Workbench, updates, diagnostics, licenses, and data export/deletion.

## 4. Complete capability catalog

This is not a fixed short list. Implement three catalog layers:

1. `builtin`: shipped and versioned with NAJD;
2. `managed`: signed/reviewed packages installed and updated by NAJD;
3. `marketplace`: remote, cursor-paginated metadata installed only after compatibility, provenance, and permission checks.

Every catalog query must return all pages, deduplicate by immutable package ID + version, preserve category membership, and cache an offline snapshot. Installed state is separate from catalog visibility. A skill can be visible while not installed; a plugin can be installed while its dependency state is `NOT_READY`.

The machine-readable seed and observed inventory is `docs/NAJD_CAPABILITY_CATALOG.json`. It is a bootstrap/test fixture, not a ceiling: the marketplace client must still retrieve every live category and page.

### 4.1 Built-in NAJD skills

Ship original NAJD versions of these observed workstation procedures:

| NAJD ID | Scope |
|---|---|
| `najd-automation` | create/read/update/delete/run/cancel/schedule/inspect durable automations and runs |
| `najd-binding` | bind automation results and widget slots/events; validate and repair bindings |
| `najd-blueprint` | route between automation, widget, binding and canvas domains |
| `najd-canvas` | create/update/delete canvases; place, move, resize, order and inspect widgets |
| `najd-deep-research` | iterative evidence-based research and long-form outputs |
| `najd-browser` | open/read/interact in the built-in right-panel browser |
| `najd-design` | design DSL for posters, infographics, resumes, tables and charts; image/PPTX export |
| `najd-slides` | create/read/edit/render PPTX through a stable intermediate representation |
| `najd-pet` | create and customize the desktop pet and interactions |
| `najd-plugin-builder` | create, validate, migrate, update and register personal plugins |
| `najd-skill-creator` | create, audit, validate and package skills and resources |
| `najd-widget` | build, render, update and validate sandboxed interactive widgets |
| `najd-widget-design` | widget runtime/design contract, tokens, responsive layout and host components |

The installed layer must also include:

- `najd-humanizer`;
- `najd-find-skills`;
- `najd-model-annotations`;
- `najd-webmcp`;
- `najd-pptx-surgical-edit` for lossless targeted edits of existing decks.

### 4.2 Managed production skill families

Support and expose the full current production family, using NAJD display names and IDs:

- 3D editor and scene production;
- About-Me avatar;
- Android app building;
- iOS app building, App Intents and performance debugging;
- mobile app preview;
- WeChat mini-program building;
- cross-platform app UI theming;
- audio generation;
- video generation;
- image generation;
- 3D model generation, retopology, LOD, retexturing and segmentation;
- content creation, browser games, webapp building and static-site publishing;
- GitHub MCP workflows;
- Windows Computer Use;
- owner-browser bridge;
- Word, Excel, PDF and PPTX surgical editing;
- Scholar, SEC EDGAR, IMF, World Bank, Yahoo Finance and intergovernmental open-data research;
- Obsidian-flavored Markdown;
- dashboard, canvas, widget and automation creation.

### 4.3 Agent/gateway skill pack

Keep equivalent NAJD procedures for the gateway/runtime layer:

- skill hub search/install/update/publish;
- coding-agent delegation to supported coding runtimes;
- Discord and Telegram operations;
- GitHub CLI operations;
- host health/security checks;
- model usage/cost reports;
- Notion API;
- session-log analysis;
- durable terminal/PTY sessions;
- video-frame extraction;
- weather;
- remote device pairing;
- Feishu/Lark, Weixin and supported platform channels;
- durable scoped memory;
- startup context, bootstrap files, command logging and session-memory hooks.

These procedures never replace executable tools. They may advertise only tools whose health checks pass.

### 4.4 Managed plugin packages

Provide a registry and install adapters for this complete current package set:

| NAJD package ID | Capability |
|---|---|
| `najd-audio-generation` | speech and sound-effect generation |
| `najd-3d-editor` | preview/edit scenes, materials, lights, cameras and animation |
| `najd-github` | official GitHub MCP adapter |
| `najd-igo-data` | WHO, Eurostat, ECB, UNICEF, OECD, FAO, UNSD, FRED |
| `najd-image-generation` | text/reference image generation |
| `najd-imf` | macroeconomic statistics and forecasts |
| `najd-computer-use-windows` | persistent JavaScript UI-control runtime |
| `najd-excel` | spreadsheet analysis, charts and finance models |
| `najd-pdf` | PDF create/extract/forms/pages/conversion |
| `najd-browser-bridge` | owner-browser control and page context |
| `najd-word` | DOCX create/edit/repair/comments/tracked changes |
| `najd-web-publish` | build and publish static websites |
| `najd-mobile-app-building` | Android, iOS and mini-program production |
| `najd-model3d-generation` | GLB creation and editing workflows |
| `najd-scholar` | academic search and author metrics |
| `najd-sec-edgar` | filings, XBRL and company financial data |
| `najd-video-generation` | text/reference-to-video workflows |
| `najd-world-bank-data` | development indicators and time series |
| `najd-yahoo-finance` | market/company/financial data |

Default document plugins shown prominently in the hub: PDF, Excel, Word, Computer Use, GitHub, 3D Editor, Mobile App Building, 3D Generation, Build, Browser Extension, Image Generation, Academic Data.

### 4.5 Marketplace behavior and seed taxonomy

The remote registry is authoritative and dynamic. Sync every category and page, not just seed items. Seed the UI/test fixtures with representative IDs that were observed in the live catalog:

- Featured: equity-research, find-skills, theme-factory, seo-audit, scientific-problem-selection, pricing-strategy, humanizer, copywriting;
- Productivity: process-doc, work-recap-writer, whatsapp-integration, weighted-scorer, structured-minutes, story-map-builder, sprint-plan-builder, project-sizing-guide;
- Finance/Legal: saas-metrics-coach, legal-risk-assessment, value-investing-scorecard, tos-clause-scanner, stock-signal-analyzer, regulatory-audit-generator, iso-27001-evidence-collection, investor-pitch-planner;
- Academic: translation-craft, scholarly-writing-refiner, mock-interview-drill, dev-guide-generator, cv-tailor, cite-style-converter, anki-card-maker, adhd-assistant;
- Marketing: copy-editing, churn-prevention, campaign-plan, support-response-writer, seo-content-writer, landing-page-scaffold, html-mailer-builder, email-newsletter-builder;
- Engineering: test-suite-architect, terraform-deploy-pitfalls, localization-toolkit, test-driven-dev, domain-glossary, deep-module-refactor, cross-examine, api-shape-explorer;
- Creative: video-quality-diff, x-thread-crafter, timeline-builder, sun-path, podcast-episode-writer, keynote-composer, edge-tts, cross-platform-adapter.

Acceptance is not the presence of these fixtures. Acceptance is a registry client that retrieves all categories and cursor pages, displays every returned entry, handles search/filter/sort, and safely installs compatible versions.

### 4.6 Manifest and readiness contract

```ts
type CapabilityState =
  | 'AVAILABLE'
  | 'NOT_INSTALLED'
  | 'INSTALLING'
  | 'NOT_READY'
  | 'DISABLED'
  | 'UPDATE_AVAILABLE'
  | 'QUARANTINED'
  | 'ERROR';

interface NajdPackageManifest {
  schemaVersion: 1;
  id: string;
  displayName: string;
  version: string;
  publisher: { name: string; url?: string };
  description: string;
  categories: string[];
  skills?: string[];
  toolsets?: string[];
  mcpServers?: Record<string, McpDefinition>;
  permissions: PermissionDeclaration[];
  dependencies: DependencyDeclaration[];
  compatibility: { os: string[]; arch: string[]; minNajd: string };
  integrity: { sha256: string; signature?: string; sourceRevision?: string };
  license: { spdx?: string; noticePath?: string };
}
```

Install flow: download to staging -> hash/signature/provenance check -> archive traversal and executable scan -> manifest validation -> dependency plan -> permission preview -> atomic install -> health check -> activate -> rollback on failure. Never execute package lifecycle code before validation and approval.

## 5. Browser and Windows computer control

### 5.1 Built-in browser

- right-panel tabs with address/title/favicon and resizable/full-width layouts;
- navigate/back/forward/reload/close;
- DOM/accessibility/screenshot/console/bounded network observations;
- click/type/select/scroll/hover/drag/upload/download/waits;
- visible target identity and fresh observation IDs;
- WebMCP discovery/calls from the current page;
- page annotations and model-linked citations;
- local preview for generated sites;
- no silent cross-profile cookie import.

### 5.2 Owner-browser extension

- side-panel chat with active-page context, quick actions, model selector, text attachment, voice typing, activity list, highlighting, Review in NAJD, offline recovery, and toolbar toggle;
- one authenticated local bridge, no second competing server;
- current browser action policy and Windows Credential Manager boundary remain authoritative;
- no passwords, verification codes, payment data, or private page content enter model logs.

### 5.3 Windows computer use

Use an observe -> act -> verify loop:

```text
discover exact app/window
  -> observe accessibility and/or screenshot
  -> bind operation to observation + target identity
  -> apply approval policy
  -> perform one effect
  -> refresh observation
  -> verify the requested postcondition
  -> journal result or quarantine unknown effect
```

Required operations: list/launch/select windows; accessibility tree; screenshot regions; click; type/paste; key presses; scroll; drag; OCR; file chooser; focus and modal recovery. Never reuse stale element indexes or coordinates after state changes. Unknown effects are operation/target-bound and never replayed blindly.

## 6. Agent execution model

```text
request
 -> local task contract
 -> retrieve project/memory context
 -> select one atomic toolset
 -> load only required skill procedures
 -> model step
 -> schema + permission validation
 -> execute with operation_id
 -> observe effect
 -> verify postcondition
 -> continue, bounded-repair, ask, or stop
 -> persist receipt, artifacts, usage and recovery state
```

Mandatory invariants:

- incomplete tool groups are `NOT_READY` and are not advertised;
- toolsets are bounded; discovery and guide reads are not counted as task progress;
- selected provider/model/reasoning never changes silently;
- bounded invalid-call repair, duplicate/no-progress detection, timeout and cancellation;
- exact approval target/effect, single-use decisions, and user-visible journal;
- provider-neutral streaming events;
- per-call input/output/cached tokens, latency and tool duration;
- compaction preserves task state and unresolved approvals without replaying effects;
- subagents/helpers have scoped context, tool permissions and budgets.

## 7. Data model and storage

Use versioned local stores with atomic writes, backups, corruption preservation, and migrations:

- accounts/providers/models/credentials references;
- app preferences, theme, language, zoom, shortcuts;
- projects, folders, instructions, files and conversations;
- conversations, messages, attachments and citations;
- tasks, steps, approvals, effects, recovery checkpoints and outputs;
- skills, plugins, registry cache, dependencies, permissions and health;
- MCP servers, connections, browser sessions, remote devices and channels;
- automations, schedules, run history and deliveries;
- memory, preferences, corrections and work lessons;
- dashboards, canvases, widgets, bindings and placements;
- usage, logs and diagnostics with retention limits.

Credentials remain in protected main-process storage/Windows Credential Manager. Renderer persistence contains references only. Remote catalog metadata is untrusted and cannot grant permissions.

## 8. Design system

### 8.1 Color tokens

```css
:root {
  --ground: #fbfaf9;
  --surface-1: #ffffff;
  --surface-2: #f5f5f5;
  --label-1: rgba(0,0,0,.90);
  --label-2: rgba(0,0,0,.60);
  --label-3: rgba(0,0,0,.45);
  --label-4: rgba(0,0,0,.30);
  --blue: #1783ff;
  --green: #16c456;
  --red: #ff3849;
  --orange: #ff9500;
  --purple: #985ffb;
}

[data-theme='dark'] {
  --ground: #181817;
  --surface-1: #121212;
  --surface-2: #1f1f1f;
  --surface-3: #292929;
  --surface-4: #4d4d4d;
  --label-1: rgba(255,255,255,.84);
  --label-2: rgba(255,255,255,.56);
  --label-3: rgba(255,255,255,.42);
  --label-4: rgba(255,255,255,.26);
  --blue: #1a88ff;
  --green: #16c456;
  --red: #ff4756;
  --orange: #ff9f0a;
  --purple: #a16bff;
}
```

### 8.2 Typography, spacing and geometry

- system UI font stack with Arabic-capable fallback; code uses a system monospace stack;
- dominant UI text `14/20`, secondary `12/18`, titles `16/22-24`;
- markdown H1 `24/39`, with proportional H2-H6;
- 4 px base rhythm; gaps 8, 12, 16, 24;
- radii 4, 6, 8, 10, 12, 16, 24, pill 999;
- controls typically 32-40 px high; icon buttons have at least 32 px hit area;
- subtle 1 px borders, minimal shadows, flat graphite surfaces;
- motion 120-180 ms for hover/menu/panel, 180-240 ms for page transitions; respect reduced motion.

### 8.3 Shared components

Implement documented variants and states for Button, IconButton, SegmentedControl, Tabs, Chip, Input, Search, Composer, Select, Menu, Tooltip, Dialog, Drawer, Popover, Toast, Banner, EmptyState, Skeleton, Card, MarketplaceCard, TaskCard, DataTable, Tree, CodeBlock, FileCard, AttachmentCard, ActivityTimeline, ApprovalCard, WorkbenchTabs, SplitPane, StatusBadge, UsageMeter, SettingsRow, PermissionRow and VirtualList.

All components require keyboard operation, focus rings, accessible names, loading/disabled/error states, RTL snapshots, and compact/comfortable density.

## 9. Implementation sequence

1. Record this requirement as the newest owner directive and map conflicts.
2. Add a feature flag and non-destructive rollback snapshot; preserve unrelated dirty work.
3. Define typed domain models and IPC contracts for shell, workbench, registry, tasks and permissions.
4. Build tokens and shared components with Storybook/test routes and RTL/LTR screenshots.
5. Replace the application shell and implement Work/Chat, projects and conversations.
6. Implement the right workbench and Apps/browser/file/document surfaces.
7. Implement catalog registry, all-page sync, installed inventory, package validation, managed dependencies and personal market.
8. Port/build the complete skill and plugin families above under NAJD IDs.
9. Integrate browser, WebMCP and Windows computer use through the existing approval/task boundary.
10. Implement Task Center, Remote Control, dashboards, canvases, widgets and settings.
11. Migrate existing user data; old visible catalog disappears after acceptance; compatibility aliases remain bounded and hidden.
12. Run unit, integration, desktop smoke, browser, package, migration, accessibility, performance and clean-profile tests.
13. Remove the rollback implementation only after owner acceptance; retain exportable backup and Git history.

Do not respond with a plan only. Implement vertical slices in this order and keep the app runnable at each checkpoint.

## 10. Acceptance gates

The replacement is complete only when:

- first launch shows the NAJD Work/Chat shell and every listed route is reachable;
- Arabic and English pass at 360, 480, 768, 1024 and 1440 CSS px with correct RTL/LTR and keyboard navigation;
- registry sync exhausts every category/page and distinguishes catalog, installed and ready states;
- all built-in and managed families above have NAJD manifests, health checks, permissions and working details pages;
- one skill and one plugin can install/update/disable/remove/rollback without restart or data loss where supported;
- Word, Excel, PDF, Slides, design, image, video, audio, 3D, web-build and research workflows produce verified artifacts;
- built-in browser and owner-browser workflows visibly observe, act and verify under policy;
- Windows Computer Use succeeds in two isolated real apps and refuses/recovers safely from changed targets;
- scheduled task survives restart and records a run result;
- remote device pairing/revocation works with scoped tokens;
- task cancellation, provider failure, malformed calls, unknown effects and crash recovery have reproducible tests;
- existing chats, projects, provider settings, authorized credentials and memory migrate successfully;
- no user-facing foreign product name, logo, endpoint or package display name remains;
- `npm.cmd test`, `npm.cmd run build`, relevant smoke suites, packaged smoke and migration tests pass with recorded evidence.

## 11. Evidence boundary

Current evidence covers installed artifact inventory, local package manifests, accessibility trees, visible screens, navigation, settings categories, live installed skills, plugin packages, and runtime process/storage layout. It does not provide permission to redistribute closed-source files, private service APIs, credentials, or vendor trademarks. Implement the behavior from this specification using reviewed upstreams and original NAJD code.
