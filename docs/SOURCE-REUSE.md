# Source reuse and managed upstream integration

## 2026-10-16 instruction skill bundle (unreleased)

Transfer scope: the 49 `skills/**/SKILL.md` instruction files at
https://github.com/openclaw/openclaw/tree/9ad5e98edb514da1ceb4d98af1b8a2817d6eb8aa/skills
and 58 at
https://github.com/NousResearch/hermes-agent/tree/c70332f88886932337619a1e57029bd885c28b9d/skills.
`scripts/bundle-upstream-skills.cjs` reads exact Git objects at those pins, preserves
each original UTF-8 body, path, SHA-256, source and declared author/license in
electron/upstream-skills.json. No upstream source edits or branding artwork copied.
Retain both root MIT licenses, Hermes' five per-skill notices including original
Siqi Chen attribution, and OpenClaw skill-creator's Apache-2.0 license (eight total
notice files, including the two roots). The notice generator includes these full
texts in the packaged acknowledgements. Executable scripts/resources are not
transferred by this instruction-only increment; it does not establish runtime
dependencies, account access or full skill execution. NAJD adds the bounded reader,
saved enabling, catalog/provider adapter and UI; upstream authorship is preserved.

Phase 09 (2026-10-15): electron/hermes-worker.py imports original pinned AIAgent and uses its public constructor/run_conversation/close APIs. electron/hermes.cjs, engine-router.cjs and provision/test bridges are NAJD additions; no Hermes source copied or modified. Original MIT notices remain. Native Windows Python/uv/core dependencies are developer-only hash/lock-pinned artifacts, not installer contents; full transitive notices must accompany redistribution. A genuine tool-free Hermes task/lifecycle/NAJD policy/IPC passes, replacing the historical "runtime acceptance open" state for this limited slice.

Policy established: 2026-10-13. The user authorized selective reuse of suitable upstream code.

1. Study agent loops, tools, skills, session management, approvals, and installation patterns. Select units that can be maintained within NAJD.
2. D-031/D-032 supersede the former references-only policy: NAJD may manage upstream runtimes and customize selected source within its unified product. Preserve existing NAJD behavior and explicitly document runtime, permission and data ownership boundaries.
3. Before copying source, record the upstream file URL and commit, transferred scope, modifications, license, and required copyright notice. Review each transfer independently.
4. Upstream names, logos, artwork, and interface assets need separate permission/license review; a source license does not automatically license every brand asset.
5. The inspected [Hermes license](https://github.com/NousResearch/hermes-agent/blob/main/LICENSE) and [OpenClaw license](https://github.com/openclaw/openclaw/blob/main/LICENSE) declare MIT. Reusing substantial source requires preserving the relevant notices. This does not decide NAJD's own future source license.

## Transfer ledger

OpenClaw and Hermes source baselines remain unmodified. Phase 05 separately runs the pinned published OpenClaw package as a managed native Gateway; see PROGRESS.md. No upstream source tree is bundled in the current installer. Record each subsequent customization before transferring code into product modules or modifying a fork.

| Upstream file and commit | NAJD file | Transferred scope and edits | Notice | Review |
|---|---|---|---|---|
| openclaw/openclaw @ 9ad5e98edb514da1ceb4d98af1b8a2817d6eb8aa | third_party/openclaw | Entire committed source baseline; no modifications | Upstream LICENSE (MIT, OpenClaw Foundation) retained | Source/pin verified; runtime acceptance open |
| NousResearch/hermes-agent @ c70332f88886932337619a1e57029bd885c28b9d | third_party/hermes-agent | Entire committed source baseline; no personal profile or build output | Upstream LICENSE (MIT, Nous Research) retained | Source/pin verified; runtime acceptance open |
| openclaw/openclaw-windows-node @ d096d5381c9f6aefdcc5f49ca93bc618eaed9c8b | third_party/openclaw-windows-node | Official native companion source; test-only ExecReusableCommandBinderTests adaptation for checkout paths containing spaces and bounded Windows fixture cleanup | Original MIT Copyright 2025 OpenClaw Foundation retained | Full build/shared/tray verification required; no product Windows action wired |
| Same baseline: src/OpenClaw.Shared/Mcp/{McpToolBridge,McpHttpServer}.cs and Capabilities/SystemCapability.cs | native/windows-node-host via ProjectReference | Reuse original library; NAJD-branded private headless host exposes only system.which with three approved executable base names; no copied branding assets or upstream profile | Original upstream MIT LICENSE retained; runtime/transitive notices required before packaging | Real isolated native MCP discovery/call, denial/auth/origin/owner-EOF proof passes; not yet production-wired or Gateway-paired |
| Same baseline: WindowsNodeClient.cs, WebSocketClientBase.cs and DeviceIdentity.cs | native/windows-node-host via same ProjectReference | Private loopback identity pairing; no Gateway action registration; main validates exact local request/device/role/scope and uses the published devices CLI/local-owner validation | Same retained MIT notice; private auth state is isolated and excluded from Git | Real native Gateway pairing/restart proof passes; no user profile or provider account |

2026-10-15 update: the source host is now production-wired for approved discovery and isolated Chrome/Edge native demo; the historical transfer rows above describe their original introduction. WindowsDemoCapability.cs and OwnedWindowsProcess.cs are NAJD additions; no upstream action source was copied or weakened. UIA3 COM declarations come from exact Interop.UIAutomationClient 10.19041.0, locked with NuGet content hashes and retained MIT Copyright 2019 Roman. Native runtime output copies its full license and the original OpenClaw Foundation license. Full transitive payload audit/notices remain an installer gate.

Phase 06 completion: WindowsAppPaths.cs is another NAJD-owned addition using the Windows registry API (no copied upstream implementation or new package). It restricts App Paths hints to the same fixed protected candidates used for opening. Program.cs adds one bounded concurrent owner read and cooperative cancellation around the original MCP bridge, preserving the upstream bridge unchanged. Active cancellation/EOF and both real app demos pass; no Gateway action commands are advertised.

2026-10-16 Phase 11: electron/personality.cjs and learning.cjs are NAJD-owned implementations inspired by the inspected pinned Hermes persona / USER.md vs MEMORY.md separation. Local literal extraction and keyword retrieval do not copy the upstream background reviewer, execute its tools, or import profiles. No upstream source/pin/license is changed. Original Hermes (Nous Research) and OpenClaw attribution remains in the canonical notice inventory. No full learning-parity claim.
