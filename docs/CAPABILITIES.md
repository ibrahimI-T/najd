# NAJD capability map

Updated: 2026-10-14. Responsibilities and stable module IDs guide independent, testable increments.

| ID | Responsibility | Dependency | Current state |
|---|---|---|---|
| najd-core | Validated tasks, events, providers, tool proposals, approvals, cancellation | None | In-memory task engine implemented; durable resumption/streaming pending |
| desktop-shell | Windows window, navigation, chats, settings | najd-core | Implemented development preview |
| localization | Arabic/English, RTL/LTR, saved appearance, date formatting | desktop-shell | Implemented |
| permissions | Folder grants, allow-once/deny, activity | core, desktop | Read-only files implemented; grants reset on restart |
| browser-control | Existing Chrome/Edge tabs, read/click/type/navigation and verification | core, permissions | 0.4.0 manual selected-tab click/type, named controls, refresh, practice page; live action and model-driven control pending |
| capabilities | Models, files, tools/skills, later messaging | core, permissions | Ollama, Kimi Code connector, explicit read commands; model tool loop/skills/MCP pending |
| distribution | One installer, repair/upgrade/remove, notices | Desktop runtime | NSIS prototype built; clean-machine/update/signing checks pending |

The required browser experience includes observing permitted tabs, taking an action, and observing its effect, with user intervention for login/security prompts. A separate hidden browser does not alone meet that requirement.

Mobile channels, organization integrations, large local models, and public skill catalogs remain optional. D-031/D-032 and USER_REQUIREMENTS.md supersede the earlier references-only engine policy: real OpenClaw/Hermes integration and an essential skills/MCP workflow are now P0. Current rows describe the existing implementation, not completion of these requirements.

## Model-controls increment — implemented in 0.2.0

The user requested researched subscription connectors, separate API/subscription dropdowns, a small green connected badge, model selection in the composer, and adjustable/automatic thinking. Existing module IDs above remain unchanged.

| Module ID | Responsibility | Depends on |
|---|---|---|
| provider-catalog | Explicit billing/auth routes, actual connector availability, provider/model capabilities, sanitized verification state | Existing main-process provider services |
| provider-picker | Settings disclosure bars, provider rows, connection details, verified-status badges | provider-catalog, localization |
| reasoning-policy | Validated effort choices and bounded local Auto selection; no provider/model fallback | provider-catalog |
| composer-models | Choose a connected provider and its models/effort without leaving the chat | provider-picker, reasoning-policy |

The user approved broad supported-provider coverage on 2026-10-14. All four modules are implemented and fixture-tested: three subscriptions, nine APIs, Ollama; captured model/effort; protected verification proof; bilingual dropdowns. Real-account acceptance is separate. Eligibility remains governed by docs/SUBSCRIPTION-RESEARCH.md. Copilot external-agent mode is not included without an explicit architecture choice. Browser actions remain manual-only in the 0.4.0 preview and await user acceptance; model-generated actions are deferred.
