# Limited Gateway runtime security review

## Phase 10 capability boundary

The source app acquires Electron's single-instance lock before constructing services. A second launch using the same data profile exits and activates the existing NAJD window, preventing competing main-process writers. Tested with two actual isolated source Electron launches; this does not serialize unrelated private test profiles.

Registry version/digest/enablement is separate from filesystem roots and allow-once approval. Core dispatch rechecks the registry and cancellation before starting a tool. Disable/remove/update revokes pending bound tasks. Atomic serialized writes and bounded reads preserve corrupt/oversized data and fail closed. The API accepts only shipped catalog IDs and exact input fields; source skill instructions/scripts are never loaded as executable extensions.

Source discovery reads only pinned source metadata with bounded traversal/output, rejects external junction/root links, preserves declared authorship and reports unsupported formats/platforms. Fixed MCP negotiation reuses the existing native-host owner and validates exact protocol/two-tool surface. The manager exposes no direct call or renderer-configurable executable/env/URL. Existing core approvals remain required for Windows/file actions. Read-only metadata/MCP connection does not grant task scope. New handlers use the same sender validation as existing IPC. Full arbitrary-extension sandboxing is not claimed.

## Phase 09 Hermes boundary

Tool-free AIAgent runs one bounded turn with private state, scrubbed environment, source checkout .env refusal, no context-file/memory/background-review loading and an asserted empty tool surface. Python receives only an opaque one-task broker token; selection/limits/credentials remain in NAJD. The broker rejects Origin, wrong auth/method/model/roles, changed original prompt, tool schemas, auxiliary/repeated inference and oversized UTF-8 bodies. System text counts against input policy. Frames bind exact instance/task/sequence; completion requires valid output and normal process closure.

Cancellation/deadline aborts inference and stops the owned process/tree before releasing the lease. Owner EOF terminates blocked Python; restart is explicit. Delete temporary task profiles after closure; uncertain stop failure preserves state and reports RUNTIME_STOP_FAILED. Drain bounded SDK stderr in memory, never renderer logs. Internal status has no token/PID/path/raw trace. Tool-free Python is process isolation, not an OS sandbox for arbitrary plugins: executable extensions remain disabled pending separate enforcement. No TLS/security feature was disabled. Full dependency/license redistribution remains Phase 15.

Phase 05, 2026-10-14; full Phase 14 and release acceptance remain open.

Current boundary: main-owned random token in memory/env only; no config/argv/UI token. OS listener PID is checked before sending credentials, since client token authentication alone does not authenticate an arbitrary loopback responder. A real benign authenticated RPC is required for healthy state. Main-frame IPC exposes only status/start/stop. Separate NAJD home/config/state, tools/plugins/cron disabled, mDNS off, no global service or personal Hermes profile.

CLI identity is temporary beneath protected engine storage; file tools deny that namespace through parent grants and junctions. Upstream server device/auth persistence still needs full at-rest review/migration policy. Private IPC provides graceful Windows and owner-disconnect shutdown; fallback targets only a still-owned PID/tree. Native lifecycle and noncooperative descendant tests pass.

## Actual dependency findings

Runtime audit: 3 high, 2 moderate, 0 critical. All vulnerable copies belong to embedded npm 12.1.0 under node_modules/npm/node_modules/:

| Component | Version | Finding / primary source |
|---|---|---|
| brace-expansion | 5.0.9 | Recursive expansion denial of service; [advisory](https://github.com/advisories/GHSA-qhr7-859c-m2p7) |
| http-cache-semantics | 4.2.0 | Cross-user cached response disclosure; [advisory](https://github.com/advisories/GHSA-ch52-4w7c-c8xp) |
| undici | 6.28.0 | Unrequested subprotocol crash; [advisory](https://github.com/advisories/GHSA-rfgv-xxqx-mfg5) |
| ip-address | 10.5.0 | Address trust/SSRF classification issues; npm audit advisory group |
| postcss-selector-parser | 7.1.4 | Parsing resource exhaustion; [advisory](https://github.com/advisories/GHSA-rj75-hqrm-r3gf) |

Active Gateway undici is 8.11.2; root brace-expansion 5.0.12 and ip-address 10.7.4 are newer separate copies. NAJD currently calls fixed health RPC only and exposes no npm/plugin/install/browser/arbitrary tool command. Embedded installer paths are dormant under this restricted feature boundary, not declared patched.

Mandatory gate: exclude unused embedded package-manager tooling or build a tested compatible patched assembly before enabling package/skill/plugin installs or distributing the runtime. Pin the new lock and repeat lifecycle/auth tests; never force incompatible peers. Audit all future native/transitive components and preserve full notices. Node's bundled npm is not automatically the canonical development CLI.

No real-provider auth/paid inference, screenshots, clipboard/device operations or untrusted executable capability was enabled by this phase.
# Phase 06 private native MCP boundary

Trust boundary: renderer task text -> validated core proposal -> immutable allow-once -> main-only native stdio -> restricted upstream capability. Assets: Gateway credentials, device identity, user documents and process ownership. External/model text cannot pick a URL, executable, app target, native arguments or change grants.

Discovery allows only three executable base names, reads a trusted System32 PATH and returns fixed IDs/booleans. Core denial prevents launch; cancellation prevents queued dispatch and ignores later read results. No app-open/shell/input/camera/audio action is enabled. Private stdio identifies the child started by NAJD without an exposed endpoint/token. The optional HTTP host mode is tested independently with fresh tokens, browser-origin refusal and EOF closure. HttpListener uses Windows HTTP.sys: socket PID checks do not identify its owning application, so production does not weaken that check or send secrets to a guessed network responder.

Private device pairing must use the already authenticated owned native Gateway, loopback only and isolated engine identity storage. Pairing does not grant remote control or an action capability. Source payload notices/hash/audit and upstream identity encryption remain installer/Phase 14 gates. Do not claim these mitigations patch existing dormant npm vulnerabilities.

## Approved isolated Windows demo (2026-10-15)

The production stdio channel additionally permits the fixed `najd.windows.demo` capability after core allow-once. HTTP remains discovery-only and the Gateway node still advertises zero action commands. Exact Chrome/Edge protected paths, no reparse executable/ancestors, generated argv, new private profile/local CSP page and suspended-before-job assignment restrict process scope. UIA is limited to the owned PID/title window and a fixed non-password editable field; no global input, debugger port, shell, arbitrary file/URL or admin execution. Job closure proves the whole owned family exited; cleanup covers only the generated fixture descendant. Unsupported/elevated requests refuse before action. MCP failures/timeouts after dispatch are conservatively UNKNOWN_EFFECT; known closed partial outcomes retain booleans without retry. An interrupted private profile may remain until Phase 06 cleanup/recovery proof; never claim its removal without evidence. Respect OS foreground refusal and report partial failure.

The document finder is a separate read-only main-owned adapter. It never delegates scanning to model text, a shell, a browser or an index service. Directory/query are immutable approval scope; live grant/cancel checks occur throughout bounded traversal and before returning results. Symlinks/junctions, hidden/sensitive names and the protected engine namespace are excluded; canonical root/protected-path checks also reject explicit aliases. File contents never enter results/logs. Traversal is not an OS filesystem snapshot; concurrent rename races can fail the operation. Phase 14 must review the complete file boundary before release.

Phase 06 completion: Chrome/Edge App Paths are read-only hints, accepted only when identical to fixed protected file candidates. Both 32/64-bit machine views are checked; user registry/catalog enumeration and registry-supplied argv are absent. App opening and discovery share the same protected-path resolver.

Private cancel/owner-EOF now cooperatively closes the active owned browser job and removes its generated fixture before receipt/exit. Stop invalidates previously queued operations and has an eight-second owned-process fallback. Real Chrome cancel and Edge EOF/queued refusal/cleanup/restart tests pass. Hard termination or missing proof remains uncertain; no filesystem sweep of old prefixes, no automatic uncertain task replay and no global security/focus changes. Core cancellation retains UNKNOWN_EFFECT pending Phase 12 reconciliation even after native cleanup proof.

Phase 07 legal display accepts no renderer file paths and reads only fixed distribution/source license assets with per-file/total byte bounds. Missing files fail visibly. React renders notice text without HTML interpretation. Packaged mode reads shipped notices/Electron license without accessing source or user profiles. Native zoom is a fixed 1/1.15/1.25 allowlist exposed by sandboxed preload, with no general Electron API. Windows help only populates a draft; explicit send/core approval remains required and existing draft text is preserved.

Phase 08 request policy is non-secret validated bounded JSON, serialized through atomic writes; corrupt state is preserved and inference fails closed. Chat and connection tests share concurrency, input-character, timeout and optional per-run cloud-attempt enforcement. Limits are checked before dispatch, not inferred from renderer badges; captured limits govern an active request. Local calls do not consume the cloud cap. There is no automatic retry/fallback, no monetary guarantee and no token-cap claim in this increment.

The explicit model-file proposal command exposes only a single strict path enum chosen in user intent. Supported adapters parse one expected function call and the core rechecks its exact target; backend root/sensitive-file and allow-once checks remain mandatory. Unknown routes refuse before inference. New preview bodies are renderer-temporary and excluded from chat persistence/model history; later provider fixtures assert no content transfer. The user path itself goes to the selected provider, disclosed in setup help. General model loops and file upload approval are not introduced.

Output-token caps are validated numeric policy (zero retains the connector default), captured per request and sent using the supported protocol field. Legacy policy files gain zero in memory; writes remain explicit/atomic. Invalid caps refuse before HTTP; provider rejection/incomplete output fails without automatic retry or proof. Caps can include reasoning usage and do not imply an exact currency guarantee. All existing credential/replacement/cancellation checks remain enforced; kill-recovery smoke was repeated successfully.

Real Phase 08 proof uses a hash-pinned, valid Ollama Inc. signed installed executable with a private HOME/AppData, project-only model cache, cloud inference disabled, PID-verified random loopback listener and owned-tree termination. Every model/config/template/license blob is independently SHA-256 checked before inference. Full MIT/Apache notices are retained; caches are not redistributed. No normal model cache, SSH/auth profile or cloud key is read.

The final wire function has no arguments: the exact user target stays in the core. Unexpected path/other arguments are rejected rather than normalized. Explicit proposal requests send only their own user prompt; normal chat is unchanged. Local proposals use deterministic sampling and source-supported no-truncate/no-shift options. Incomplete local text/tool responses cannot verify inference. Synthetic diagnostic capture exists only in the isolated test harness.
