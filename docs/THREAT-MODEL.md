# NAJD threat model and security checklist (Phase 14)

Date: 2026-10-26. Scope: the desktop app as shipped from this repository (Electron main process, sandboxed renderer, managed
OpenClaw Gateway / Windows host / Hermes runtimes, browser extension link, update channel). Earlier per-phase boundaries are in
docs/SECURITY-RUNTIME.md; the public summary is SECURITY.md. This document is the Phase 14 deliverable: assets, trust
boundaries, threats with the enforcing mechanism and its evidence, and the residual risks that remain open.

## Assets

- Owner credentials: provider API keys, subscription sessions, Settings > Accounts passwords (Windows Credential Manager / safeStorage).
- Owner files and chats, memory graph, asset library, learned skills.
- The owner's machine: processes, windows, installed apps, browser tabs shared with NAJD.
- The update channel and the installer the owner runs.

## Trust boundaries

1. Owner chat messages (the only source of authority) -> renderer -> sender-checked IPC -> main process.
2. Model output, tool results, files, web pages, MCP output, skill text -> data only; reach effects solely through core
   decisions (najd-core.cjs, action-policy.cjs) and immutable approvals.
3. Main process -> managed runtimes (Gateway, Windows host, Hermes, Python engine) over private stdio or loopback with a
   per-run random token and an owned-PID check.
4. Browser extension -> loopback bridge, paired once with a native-confirmed code.
5. Update server -> signed manifest -> hashed installer.

## Threats, mitigations and evidence

| # | Threat | Enforced by (not only the prompt) | Evidence |
|---|---|---|---|
| T1 | Prompt injection in files, web pages, tool results or MCP output asks for an effect | Core decides every effect from the tool call and the owner's access mode; ALWAYS_ASK set (payments, password changes, orders, account deletion); immutable approval details; untrusted text never selects an executable, URL, root or grant | tests/najd-core.test.cjs, tests/action-policy.test.cjs, tests/agent-runtime.test.cjs; docs/SPEC-action-policy.md |
| T2 | A skill or learned skill tries to run code | Skill files are guidance; their scripts never run; installs only from a single skill folder after confirmation; learned skills are text saved by the owner's run | tests/external-skills.test.cjs, tests/extensions.test.cjs |
| T3 | A malicious MCP server | Added only after a native confirmation showing the exact command; secret environment values encrypted; tool calls pass the same approvals | tests/plugins.test.cjs |
| T4 | Another window, a preview frame or a page the model wrote calls NAJD IPC | Every handler goes through withWindowSender: the sender must be the main frame of a window NAJD created (appWindows WeakSet), else UNTRUSTED_SENDER | electron/main.cjs; 168 handlers counted, all sender-checked; smoke:chat, smoke:attachments |
| T5 | A page inside NAJD requests camera, microphone, location, notifications, HID/serial | Session permission request/check handlers refuse everything except clipboard write and full screen for NAJD's own file: main frame (electron/permissions.cjs) | tests/permissions.test.cjs |
| T6 | A local process impersonates the Gateway or reads its token | Loopback only, main-owned random token in memory/env, listener PID verified before sending credentials; the Windows host uses private stdio | docs/SECURITY-RUNTIME.md; tests/openclaw-gateway.test.cjs, tests/windows-node-gateway-smoke.cjs |
| T7 | A web page or another extension talks to the browser bridge | 127.0.0.1 random port, off by default, 128-bit pairing code confirmed natively; typing/clicking needs in-chat approval and is journaled; passwords filled by NAJD without reaching the model | docs/SPEC-browser-link.md, docs/SPEC-accounts.md; npm run smoke:browser |
| T8 | A forged or tampered update | Ed25519-signed manifest with a pinned public key, strict increasing version, fixed basename, size and SHA-512, rehashed before install; channel stays off for public use until the key is rotated | docs/SPEC-updates.md; tests/update-manifest.test.cjs, tests/updates.test.cjs |
| T9 | Secrets leak through logs, diagnostics, chats or Git | redact.cjs masks keys/tokens/password arguments in activity, logs and diagnostics; keys are transient in the renderer and cleared after saving; secret scan of the repository finds only fake test keys | tests/redact.test.cjs; secret scan 2026-10-26 |
| T10 | A downloaded or attached file is opened as trusted | Opened copies keep Mark-of-the-Web; macro formats are not produced; Office review works on a private copy | tests/workspace-tools.test.cjs, tests/office-review.test.cjs |
| T11 | Effects outside the allowed folders | Scoped file roots with canonical path, junction and protected-namespace checks; writes are journaled and approved | tests/workspace-tools.test.cjs, tests/document-finder.test.cjs |
| T12 | A crash or kill mid-action replays an effect or loses credentials | Action journal never replays an uncertain effect (UNKNOWN_EFFECT); credentials recovered after abrupt termination; an unanswered request shows a resume card instead of re-running silently | npm run smoke:kill; tests/action-journal.test.cjs; src/App.tsx interrupted card |
| T13 | Vulnerable dependencies | npm audit of the app dependencies | npm audit 2026-10-26: 0 vulnerabilities |
| T14 | Private state shipped in the installer | Packaging includes dist, electron and pinned runtimes only; no user profile, chats or keys; smoke:package checks the payload | npm run smoke:package |

## Recoverability

- Provider unreachable: the request fails with a readable error, no automatic paid retry (docs/SPEC-provider-limits.md).
- Gateway unavailable or still starting: the Windows host and Python tools work without it (gatewayDeferred); status shows GATEWAY_STARTING.
- Skill or tool crash: the tool returns an error to the run; the run continues or stops with the reason shown in the activity.
- Interrupted install/update: the old installation stays; the update is rehashed before install.
- Interrupted request: the resume card offers to continue it; nothing is re-run without the owner's click.

## Checklist before a public release

The owner's part, step by step: docs/OWNER-STEPS.md.

- [ ] Host cleaned after the 2026-10-17 malware incident; update-signing key rotated on a clean device; new public key pinned.
- [ ] Windows code-signing certificate.
- [ ] Private vulnerability reporting enabled on the repository.
- [ ] Clean-Windows install, update and uninstall test (Phase 15/16).
- [ ] Owner acceptance with real accounts and the owner's own browser.

## Residual risks (open)

- R1 High until resolved: the current update-signing key lived on a host that had malware; no signed public release until rotation.
- R2 Closed 2026-10-26: retention for every log NAJD writes. Command logs: earlier sessions' logs older than 30 days are removed, and all logs together stay within 512 MB (exec-logs.cjs prune, at start). Crash dumps: the newest 20, none older than 30 days. install.log: 256 KB. The other logs keep their own caps (log-retention.cjs, tests/log-retention.test.cjs).
- R3 Medium: Full access mode lets most actions run without asking (by the owner's choice); ALWAYS_ASK actions still ask.
- R4 Low: tool-free Python and the Windows host are process isolation, not an OS sandbox; arbitrary executable extensions stay disabled.
- R5 Closed 2026-10-26: the smoke:desktop Chrome fixture failed because it required the Windows foreground, which Windows refuses to a background process while the user works in another app. The fixture now proves that the window and the field belong to the owned process family instead, and passes with the owner's Chrome open.
- R6 Low: dormant vulnerable copies inside embedded npm tooling of the Gateway runtime (docs/SECURITY-RUNTIME.md) are not reachable through NAJD's exposed surface; they must be excluded or patched before package installs through the Gateway are enabled.
