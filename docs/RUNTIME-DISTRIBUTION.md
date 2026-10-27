# NAJD managed runtime distribution (R-030)

Owner confirmed 2026-10-16: every recipient installs one NAJD application. Setup
prepares the pinned runtimes and required programs; the user does not separately
install or launch Hermes/OpenClaw. WSL is permitted where required. This document
extends the approved capability map; it does not claim these distribution gates
are complete in the current 0.7.1 development installer.

## Authority and execution

Electron main remains the sole owner of provider credentials, selected model,
task identity, action policy/approval, durable effects, sessions and memory. Reuse
actual upstream tools through narrow adapters. Loading a skill does not authorize
its commands. Hermes/OpenClaw must not independently retry billable inference or
write canonical NAJD stores. Preserve their original licenses and source pins.

Current Hermes integration is one tool-free Ollama planning lease. The current
Gateway/native adapter is genuine but has deliberately limited commands. Expand
those contracts with mediated tool execution; removing their restrictions globally
would bypass NAJD's existing permissions and duplicate orchestration.

## Recipient runtime layout

Use versioned NAJD-owned runtime directories and isolated per-engine state. Never
borrow standalone Hermes/OpenClaw installations, credentials, Python environments
or unrelated WSL distributions. Keep publisher-built immutable runtime payloads
separate from writable user config, caches, attachments and extension installations.

The setup orchestrator must detect, download, verify, stage, health-check and activate
components, then resume safely after interruption. A failed upgrade preserves the
previous working generation. Verify artifacts before extraction/launch using pinned
integrity and the authenticated NAJD release channel. Do not run live branch-head
installer scripts, expose publisher tokens, or ship developer caches/profiles.

The existing updater currently authenticates the app installer only. A component
manifest and its version/compatibility/size/hash/signature contract must be implemented
and tested before downloading executable runtime packs through this path.

## Reuse inventory and route

| Component | Existing evidence | Distribution work remaining |
|---|---|---|
| Node | 24.21.0 checksum pinned in runtime-pins.json, provision-node.cjs | Recipient-owned verified provisioning/activation |
| OpenClaw | 2026.10.3 package and locked dependency closure; source pin 9ad5e98 | Relocatable runtime pack, notices/audit and recipient Gateway health |
| Hermes | Source c70332f, upstream PM frozen environment preparation | Source + dependency pack, fresh relocatable environment and mediated executable bridge |
| Python/uv | Hermes PM lock pins Python 3.14.7+20260901 and uv 0.12.3 for win32-x64 | Reuse verified PM artifacts without copying developer venv absolute paths |
| Windows control | Existing genuine native MCP companion/.NET host | Distribute runtime prerequisites or verified self-contained build; keep Windows control on host |
| Skill prerequisites | Upstream PM lock includes Git, ripgrep, ffmpeg, gh, Chromium and cua-driver | Per-feature dependency graph and actual health/availability checks; account-required features remain sign-in gated |
| Linux-dependent tools | WSL explicitly approved | Detect support, guided OS elevation/reboot, isolated NAJD distribution and post-reboot resume |

Do not silently replace NAJD's Node pin with Hermes PM's different Node version.
Distinct engine generations may require distinct pinned executables. Do not ship
local model weights unless chosen separately with clear download size/license.

## Native and WSL policy

Prefer the route demonstrated compatible for the required tools, not a blanket
performance claim. Hermes documents a native Windows route; OpenClaw's pinned
Windows documentation includes native and app-owned WSL Gateway routes. WSL may
serve Linux-only executors while Windows UIA remains on Windows. Communication
crosses an authenticated, bounded NAJD-owned bridge, not arbitrary renderer shell.

Windows feature installation can require OS elevation and a restart. Setup must
show that requirement, save progress and continue afterward. Do not pretend this
can always finish silently, modify another distribution, or force a reboot.

## Acceptance and order

1. Finish and checkpoint in-progress instruction/discovery/connected-read changes.
2. Implement authenticated component manifests and deterministic setup lifecycle
   tests (interruption, bad hash, disk/permission/network failures, cancel, rollback).
3. Package/provision native core components on an isolated recipient profile with
   no developer checkout/global Python/Node/Git dependency.
4. Connect real selected-provider calls to allowlisted upstream executors, preserving
   exact change preview, durable claim, postcondition and unknown-effect handling.
5. Implement external skill/plugin Git/URL review/install/update/remove and MCP
   transports; adapters declare readiness based on real dependencies/accounts.
6. Add WSL setup/executors for demonstrated native gaps; test reboot/resume and
   host bridge separately. Complete clean-Windows acceptance before public parity claims.

## Implemented trust contract foundation (unreleased)

runtime-manifest.cjs authenticates a distinct `najd-runtime-v1` catalog, channel,
exact configured catalog generation, Windows x64 platform and minimum app version. It permits only fixed core component
IDs/entrypoints, bounded archive sizes and complete SHA-512 identities. It rejects
commands/hooks/URLs, unknown fields, traversal names, duplicate IDs, missing required
prerequisites and dependency cycles. Planning is dependency-first and downloads are
restricted to the configured distribution repository's immutable runtime version tag.
Full archive verification reuses the existing bounded file-hash reader. The shared
signed-envelope parser preserves existing app-update validation behavior; runtime
catalogs cannot be passed off as app updates or vice versa.

Runtime publications must use dedicated `runtime-v<version>` tags and must not replace
the app's latest release feed. This module does not yet download/extract/activate or
launch components, and no runtime pack is published. Recipient setup remains open.

The next verified source increment adds runtime-setup.cjs with staged downloading,
verification, bounded worker extraction/comparison, health gating, atomic activation,
cancel and restart/cache reuse. Actual isolated Node executable proof passes under
fixture signing/transport. SPEC-runtime-setup.md records its API/limits and required
production activation coordinator. Main onboarding and actual redistributed complete
engine packs are not connected yet; this is not installed-recipient acceptance.

Measure provider attempts/input/output context, local execution time, startup,
disk/download size and CPU/RAM. Progressive schema loading, local search/extraction
and bounded results can reduce context; they do not eliminate model token charges.

## Sources

- Pinned repository sources: third_party/hermes-agent/pm/lock.json, pm/, tools/registry.py,
  website/docs/user-guide/windows-native.md; third_party/openclaw/docs/platforms/windows.md.
- https://hermes-agent.nousresearch.com/docs/user-guide/windows-native
- https://learn.microsoft.com/en-us/windows/wsl/install
- https://learn.microsoft.com/en-us/windows/wsl/basic-commands
