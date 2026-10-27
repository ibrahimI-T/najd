# Windows capability integration checkpoint

Phase 06 is VERIFIED for the bounded approved capability set described below. General automation, model/device action routing and installer acceptance remain later work. Later dated entries supersede historical preparation descriptions below.

## Inspected source

Official `openclaw/openclaw-windows-node` baseline: d096d5381c9f6aefdcc5f49ca93bc618eaed9c8b. MIT Copyright 2025 OpenClaw Foundation; original LICENSE retained. The submodule is source material, not a second user-facing product or an installed service.

- `SystemCapability` advertises notify, which, run/prepare and exec-approval commands. `includeRunCommands=false` removes and rejects execution before dispatch. Its default approval handler does not authorize arbitrary execution.
- `ICommandRunner` separates executable/argv, shell, cwd, environment and timeout. Prefer direct argv and bounded target-specific commands.
- `WindowsNodeClient` supplies device/Gateway transport. The WinUI `NodeService` owns the shared Gateway/MCP capability registry; GatewayConnectionManager owns connection lifecycle.
- `WinNode.Cli` is an MCP client, not a headless node host. Starting that CLI alone does not provide a Windows adapter.
- Native MCP exposes more than NAJD currently authorizes, including screen, camera, audio, browser and system execution. Do not expose the complete registry to models or inherit the tray's approvals.
- `OPENCLAW_TRAY_DATA_DIR` must point at isolated NAJD-owned/test storage. Changing HOME alone does not isolate Windows known-folder APIs.

## Permission boundary for the next implementation

| Capability | Current NAJD state | Required proof before enabling |
|---|---|---|
| Read a local file | Existing allow-once plus granted roots | Preserve root/sensitive-file and cancellation tests |
| Discover installed apps / system metadata | Approved five fixed app IDs, System32 plus Chrome/Edge App Paths/protected Program Files | Does not enumerate the user's application catalog or promise arbitrary app support |
| Open an app / select its window | Approved isolated Chrome/Edge demo | Immutable app target, owned PID/title, verified postconditions; no arbitrary app target |
| Screen / UI Automation / keyboard and mouse | Native ValuePattern only within the approved demo window | No screen capture or global keystrokes; separate scope required for broader control |
| Camera / microphone / audio | Not implemented | Separate opt-in; never enabled by general device pairing |
| Shell / administrator / deletion / install | Denied | Dedicated design and approval; no silent privilege escalation |

Reuse upstream transport/capabilities behind NAJD's existing authoritative approvals. Do not launch the owner's installed OpenClaw/Hermes profiles. A headless internal host or an explicitly scoped adapter is needed to retain one NAJD interface. Pair only the local managed Gateway; do not enable remote device control by default.

## Development environment and evidence

The source requires .NET SDK 10.0.400; system 10.0.301 did not satisfy global.json. `setup:dotnet` provisions the official checksum-pinned SDK into ignored `.runtimes/`, without replacing the system SDK. Use isolated CLI/NuGet homes, DOTNET_ROOT/PATH and OPENCLAW_REPO_ROOT (submodule `.git` is a file).

Initial full build passed. Initial shared tests: 4274 passed, 4 failed, 36 skipped; tray: 3975 passed, 29 failed. Correct environment/root fixed README and all 44 targeted tray configuration/installer tests. Three unquoted-command fixture tests assumed a checkout path without spaces. A test-only adaptation copies the test host into its own temporary unquoted path; quoted-executable rejection remains intact. Focused binder suite: 95 passed. A full repeat exposed a transient Windows executable cleanup lock; bounded cleanup retry was added. Final full repeat results belong in TEST_MATRIX.md.

The first SDK probe ran before first-run isolation flags and reported creating an untrusted ASP.NET development certificate for the current Windows user. No trust operation was run and the certificate was not removed. Subsequent provisioning/probes suppress certificate generation and telemetry and use a project-owned CLI home. Do not silently alter pre-existing certificates.

Remaining acceptance: headless lifecycle, real private device pairing/MCP discovery, NAJD permission enforcement, target-specific preview, two real safe application operations, denial, cancellation and truthful partial-effect reporting. Unit/build success cannot close these gates.

Final required source baseline repeat: full build passed; shared 4278 passed / 36 skipped / 0 failed; tray 4004 passed / 0 failed. The parent gitlink retains the official baseline; the test adaptation is saved under patches/openclaw-windows-node/ and intentionally applied in the submodule working tree. Do not reset that change.

Full upstream MXC proof passed: 18 tests, including a real temporary WSL Gateway -> Windows node -> sandboxed system.run and refusal to write protected tray data. The fixture created its own distro/state, skipped provider authentication, and completed uninstall/teardown. This validates that upstream path, not NAJD production permissions or its native Gateway node pairing.

NAJD's internal headless native/windows-node-host references the original MCP/SystemCapability library. It advertises only system.which with executable base names notepad, calc and mspaint. Production Electron now uses private stdio through core allow-once for `/apps` and `/تطبيقات`. Fixed app IDs/booleans are localized in chat; denial/cancel prevents queued dispatch. HTTP mode remains an isolated authenticated transport test, not the production channel. Windows HTTP.sys owns HttpListener sockets, so production does not mistake its kernel PID for a private child. Upstream which appends PATHEXT; query base names.

The worker pairs its own isolated identity to the real native managed Gateway, advertising zero action commands. Its pending request/device ID crosses the owned pipe. Main checks node-host, node-only role, empty scopes and exact IDs before dedicated devices CLI approval. Raw gateway-call pairing RPC failed with INVALID/PAIRING; the dedicated CLI supplies upstream scope/view/local-owner handling. Explicit acknowledgement reconnects the socket closed by NOT_PAIRED. The successful handshake receipt is not live connection health. Native pairing, same-identity restart and metadata lookup pass. Gateway secrets stay in main/owned pipes; source identity/cache encryption remains a Phase 14 gate.

Parent verification: 107 Node + 13 Vitest, TypeScript/Vite and isolated Electron desktop smoke pass, including Arabic/English permission/denial, real native lookup after allow and no native state directory after denial. No application-open operation is implemented yet; the two-real-application action acceptance remains open. Continue Phase 06 before Phase 07.

## 2026-10-15 bounded native action proof

`/windows chrome|edge` (Arabic `/ويندوز`) opens an immutable allow-once proposal. The stdio-only native capability selects protected Program Files binaries, creates a fresh local CSP fixture/profile, starts suspended inside a kill-on-close job, selects the matching owned PID/title window, sets a fixed field through UIA3 ValuePattern, reads it back, terminates the entire owned job and removes the fixture. Results expose only fixed booleans/stages. No normal browser profile, account, global keystroke, remote debugger, generic URL, shell or elevation is involved. Interrupted or unverifiable effects are UNKNOWN_EFFECT with no automatic retry.

Actual debugging: a private USERPROFILE needs AppData/Roaming, Local, LocalLow and known-folder directories; merely changing HOME is insufficient. Native browser occlusion hid the local document from UIA. Accessibility/UIA and occlusion/background/GPU fixture flags resolve this within the new test window; no global browser or Windows security setting changed. Early probes failed field lookup or foreground selection. A later desktop run passed Chrome but truthfully reported Edge focus failure. CDP clicks alone did not activate NAJD after the previous browser closed; the harness now explicitly brings NAJD forward before a click, matching a user activating the approval UI. Final source desktop smoke passes both real applications plus English denial and existing regression flows. The standalone background Node demo can still encounter OS foreground refusal; retain that as a failure, never force focus settings or retry effects automatically.

Evidence: 110 Node + 13 Vitest; TypeScript/Vite; locked native publish; restricted HTTP auth/origin/EOF smoke; real local Gateway pairing/same-identity restart; full bilingual source desktop smoke. Further Phase 06 work: bounded filename search under approved roots, additional app discovery and cancellation/interrupted-profile reconciliation. Screen/audio/general input remain disabled. Source baseline tests previously passed unchanged; no new source implementation edits in this increment.

### Approved document filename search

`/find <absolute directory> | <literal name>` or `/ابحث` now previews both immutable fields. Main searches only a currently granted root; ordinary document extensions, no contents, no links, no hidden/sensitive names or protected engine paths. Limits are 1000 entries, three nested levels and 12 results with explicit limited output. Revocation/cancel prevents later result delivery. Later content read needs separate approval. Unit/core and bilingual isolated desktop proof pass; see SPEC-document-finder.md. This closes bounded document finding, not unrestricted filesystem indexing.

## Final Phase 06 acceptance

Five fixed app IDs are now disclosed in the immutable `/apps` scope. Chrome/Edge discovery reads only their HKLM App Paths keys in 32/64-bit views, validates the result against exact protected installed files, and falls back to those same protected paths. No registry entry can provide arbitrary argv/executable authority. No start-menu/private application catalog enumeration is implied. The real registry proof found both applications through App Paths. API reference: https://learn.microsoft.com/en-us/windows/win32/shell/app-registration.

Native stdio reads owner control concurrently with its one active RPC. Private cancel/EOF signals cancel only the owned fixture operation; the helper awaits job closure/profile cleanup before returning its fixed proof and exiting. Parent stop invalidates old queued operations; later explicit requests can restart. A bounded eight-second kill fallback retains conservative uncertain-effect reporting if cooperative shutdown stalls. Real cancel/EOF/queue/cleanup/restart proof passes. The initial Console.In.ReadAsync scheduling failure was fixed by putting the single bounded owner reader on a dedicated task/thread. General model/device actions, screen/audio and arbitrary shell stay disabled. Phase 06's bounded two-application/deny/partial-outcome gate is now verified; installer and general recovery remain later gates.
