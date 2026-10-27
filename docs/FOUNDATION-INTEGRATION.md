# NAJD AGENT — OpenClaw + Hermes Foundation Integration

Status: repository recovery and managed-process lifecycle verified; engine execution and application wiring remain unfinished. Decisions: D-031/D-032 (user-directed; supersede the "never" wording of D-003/T05 and adjust D-010). Backup branch: `backup/pre-openclaw-foundation`. Current evidence: docs/PROGRESS.md.

## Recovered source and actual implementation (2026-10-14)

- NAJD baseline HEAD at recovery: `54849c8` (T44 tests); Electron 44, React 19, TypeScript and Vite remain the existing application. The new manager is not imported by main.cjs; existing provider/session flows still use NAJD's core.
- OpenClaw: clean submodule at `9ad5e98edb514da1ceb4d98af1b8a2817d6eb8aa`; package.json declares 2026.10.3. This checkout is not an exact release tag. Its Node constraint is `>=24.16.0 <25 || >=26.1.0`; development Node 24.15.0 does not satisfy it. No built/installed OpenClaw runtime has been verified.
- Hermes: clean submodule at `c70332f88886932337619a1e57029bd885c28b9d`, recovered from the user's existing clean upstream source checkout. The committed submodule URL is the official GitHub repository; no personal installation path is required by other developers. No profile, credentials, installed desktop binary, or build output was transferred.
- Hermes's checked-out pyproject.toml admits Python `>=3.11,<3.15` for old updater compatibility, but its inline contract supports only Python 3.14. Plan a managed 3.14 runtime; do not infer support for 3.11 from metadata. Its package/desktop manifests use 0.0.0; this SHA is not an exact v0.22.0 tag.
- Source isolation contracts exist: OpenClaw OPENCLAW_STATE_DIR/OPENCLAW_CONFIG_PATH, Hermes HERMES_HOME. The forthcoming adapters must set NAJD-owned directories explicitly; these are not yet wired.
- Recovered manager tests initially passed 2/6. Repairs now pass 10/10: startup, health, timeout, process failure, restart, concurrent calls, cancellation, and validation. The fixture's readiness handler formerly fell through and crashed after responding; that was not evidence of a Node/Windows timeout defect.
- The manager supervises the immediate child process. Descendant-process cleanup, authenticated engine ownership, provisioning, protocol adapters, permissions bridging and installer inclusion remain open. A healthy fixture is not proof of upstream integration.

## Source customization and unified ownership

NAJD owns its product name, interface, orchestration policy, provider selection, credentials and user-facing workflow. Selected upstream capabilities may be adapted and extended under D-032. Keep upstream baselines pinned; document each customized scope and preserve upstream notices and authorship. Use adapters at incompatible boundaries, and decide one owner for memory, sessions, scheduling, skills and approvals before enabling either engine's parallel systems.

## Earlier preliminary upstream research (not runtime acceptance)

| Project | Repo | Version pinned | License | Runtime | Windows |
|---|---|---|---|---|---|
| OpenClaw | openclaw/openclaw | v2026.10.3 (npm `openclaw@2026.10.3`) | MIT — OpenClaw Foundation | Node `>=24.16 <25 \|\| >=26.1` (engines) | Official: Windows installer (`install.ps1`), native Windows app, `test:windows:ci` scripts |
| Hermes Agent | NousResearch/hermes-agent | v0.22.0 | MIT — Nous Research | Python (uv-managed, wants 3.14) + Node for TUI; `%LOCALAPPDATA%\hermes` layout | Official native Windows PowerShell installer |
| Hermesclaw | ZY-LI-F/Hermesclaw | main (reference only, not vendored) | MIT | OpenClaw CLI backend → FastAPI bridge → Hermes AIAgent | Self-declared MVP integration baseline |

## Embedding strategy (preliminary, to be confirmed against cloned source)

1. **OpenClaw**: consume the published self-contained npm package (99 MB tarball bundling Gateway, Control UI with an `ar` locale, skills, and node_modules). NAJD pins the version, installs it under its own directory, and manages the Gateway process with NAJD-owned config/state dirs so the product identity stays NAJD. Alternative (run from git source) is heavier and not needed for the foundation.
2. **Hermes**: install from the vendored git tag via `uv`/pip into a NAJD-owned environment (never the user's global Python), managed start/stop by NAJD, exposed to NAJD through a thin bridge adapter (Hermesclaw pattern: explicit, thin boundary; its code is a reference, not a dependency).
3. **NAJD shell**: the existing Electron 44 + React 19 app (D-021 retained) stays the user-facing identity; upstreams are internal engines only.

## Prerequisite gaps on this development machine

- Node is v24.15.0; OpenClaw engines require >=24.16 or >=26.1. Dev work needs Node 24.16+/26.1+ (e.g. nvm/fnm or a project-local runtime). The final product must bundle/provision its own Node per OpenClaw's installer contract.
- Python is 3.11.4/3.13.13; Hermes wants 3.14 via its PM installer. Use `uv` (present, 0.11.21) to provision a project-local Python 3.14.
- Neither upstream is installed globally; NAJD must vendor both to keep the machine and the product clean.

## Risks and open questions

- OpenClaw Gateway is a long-running daemon with its own config schema, pairing, and channels; embedding must scope it to local desktop use (no external channels by default) and keep all state under NAJD's app-data dir.
- Hermes bundles its own memory/skills/cron systems; NAJD must pick one owner per concern (D-031: unified orchestration, no duplicated memory stores) — design in Phase 2.
- Both upstreams are MIT; NAJD must preserve LICENSE/THIRD_PARTY_NOTICES and never rebrand upstream code as originally NAJD-written.

## Phase plan

See tasks/todo.md (T45-T48) and docs/PROGRESS.md. Next: project-owned runtime provisioning and an authenticated, isolated OpenClaw Gateway adapter. Preserve existing working NAJD behavior while this path is disabled.


## Hermes tool bridge (2026-10-16)

`electron/hermes-tools.cjs` starts `electron/hermes-tools-worker.py` with the activated sealed core's own
Python (or `NAJD_DEV_AGENT_CORE` in an unpackaged checkout) and an isolated throwaway profile. The worker
loads the original Hermes registry, exposes only an allowlist (currently web_search and web_extract, both
verified to work without accounts) and returns bounded results. NAJD keeps the model, approvals, sessions
and memory: the worker never receives provider credentials, and auxiliary model clients stay unconfigured,
so no duplicate model requests occur. The NAJD agent loop exposes najd_web_search / najd_web_extract only
when the core is available and refuses model-chosen URLs that target localhost or private networks.
