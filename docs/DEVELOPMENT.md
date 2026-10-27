# Windows development baseline

## Skills/MCP backend

`npm run test:capabilities` runs focused registry/discovery/manager contracts. `npm run smoke:capabilities` builds and exercises actual source Electron IPC plus real core/file/native lifecycle (synthetic model response). Run `build:windows-node` after the NAJD C# notification handler change, then `smoke:windows-node-adapter`, `smoke:windows-node`, `smoke:windows-cancel`. Preserve all failed logs, especially the initial Gateway auth failure versus the successful serial repeat.

APIs are live in the existing sandboxed preload; no src/ or UI driver change was needed for backend proof. Source catalogs are metadata previews; only the three shipped NAJD built-ins can be registered. Do not point the manager at arbitrary commands, npx packages, environments or network URLs.

## Hermes source integration

On native Windows x64 run `npm run setup:hermes`, then `npm run smoke:hermes`, `npm run smoke:hermes-model` and `npm run smoke:hermes-ipc` with canonical Node/npm. Preparation uses upstream PM, exact artifacts and frozen dependency locks. Developer dependencies stay in `.runtimes/hermes`; task profiles belong to userData/najd-data/engines/hermes. Preserve failed/unknown directories and locked previous tool generations.

The initial `/hermes` / `/هيرمس` route is text-only and supports the selected Ollama model. Unsupported providers refuse before credential/inference access. Normal ChatGPT sign-in/chat is preserved and remains the owner's chosen actual setup; local inference is a verification baseline. No installer bundles these Python/core/model dependencies yet. See SPEC-hermes.md.

Backend tests do not need src/ or tests/electron-ui-smoke.cjs changes; the Hermes Electron test uses the existing preload/IPC.

Canonical host: Windows x64, stock Node 24.21.0 (.node-version), npm 11.12.1 (packageManager/CI), committed npm lockfile. Electron remains 44.7.0. No global Node replacement, WSL installation or user-profile migration is performed.

```powershell
npm.cmd ci
npm.cmd run setup:node
npm.cmd run setup:electron
npm.cmd test
npm.cmd run build
npm.cmd run notices
npm.cmd run smoke:desktop
```

setup:node provisions the official Windows x64 archive into ignored .runtimes/, validates its fixed SHA-256, checks node.exe version/hash and preserves an existing invalid installation for review. It extracts with the built-in .NET ZIP API rather than disabling PowerShell security policy. Retain the payload's full LICENSE; it is currently a development resource, not an installer-bundled runtime. Its bundled npm is 11.19.0; the app's canonical npm remains 11.12.1, so use the pinned npm CLI/tool manager rather than assume the Node ZIP bundles the requested npm.

For a shell with older system Node, invoke the verified project node.exe with the existing npm 11.12.1 npm-cli.js, and set child Node resolution to the project runtime. Example on this machine:

```powershell
$najdRuntime = 'C:\NAJD AGENT\.runtimes\node-v24.21.0-win-x64\node.exe'
& $najdRuntime 'C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js' test
```

Electron's package does not install its binary during npm ci at this pin; setup:electron invokes the upstream explicit installer, using its checksum/cache validation. A successful npm ci alone is not a successful Electron install. The npm bundled in the stock Node ZIP may handle nested npm run commands; record its version if using that route. CI explicitly installs npm 11.12.1 and Node 24.21.0 before all checks.

Source checks: TypeScript strict/noUnused checks in tsconfig; node --check for changed CommonJS files; git diff --check for whitespace. There is no separate established formatter/linter; adding one is not necessary for this baseline. Tests are Vitest for renderer utilities and Node tests for services. Desktop smoke uses temporary app/session data, fixture keys/provider HTTP and a temporary debugger port. Never use real chats/accounts as test fixtures.

.github/workflows/windows.yml pins official checkout/setup-node action SHAs and runs install, explicit Electron setup, tests, build, notices, isolated desktop smoke and production audit. It is configured locally; no hosted CI run or push was performed. Packaging and clean-Windows acceptance are separate Phase 15/16 gates.

Recovery: keep scoped commits and checkpoint/master-plan-phase00-20261014; inspect rather than reset a dirty tree. Generated binaries, runtime downloads, caches, secrets and user state stay out of Git.

## Windows companion source

`npm run setup:dotnet` prepares checksum-pinned .NET SDK 10.0.400 locally. It suppresses development-certificate generation and telemetry and isolates CLI state. For companion builds/tests, set PATH and DOTNET_ROOT to `.runtimes/dotnet-sdk-10.0.400`, DOTNET_CLI_HOME to `.runtimes/dotnet-home`, NUGET_PACKAGES to `.runtimes/nuget-packages`, OPENCLAW_TRAY_DATA_DIR to an isolated test directory, and OPENCLAW_REPO_ROOT to the absolute `third_party/openclaw-windows-node` path. Run the source's build/shared/tray validation sequentially to avoid races in shared test-support output. Retain full source history for GitVersion. See WINDOWS-CAPABILITIES.md for actual evidence and unfinished permissions/runtime gates.

The managed OpenClaw dependency lock is explicitly LF in `.gitattributes`; its byte hash must remain stable on Windows checkout.

After SDK/source setup, `npm run build:windows-node` compiles the internal headless helper into ignored `.runtimes/windows-node-host`; `npm run smoke:windows-node` runs its real restricted MCP proof with temporary state and a fresh token. It is not yet an Electron production feature or an installer payload. The full upstream MXC proof is slower and provisions/removes a fresh fixture-owned WSL distro; never substitute a user's existing distro/profile.

2026-10-15: the helper is now wired into the source Electron app, but is not yet an installer payload. `build:windows-node` enforces the NuGet lock; do not update it implicitly. `smoke:windows-node-adapter` checks real pairing/restart. `smoke:desktop` proves real approved Chrome/Edge UIA operations and bilingual refusal. `smoke:windows-demo` is a stricter standalone interactive diagnostic; a background CLI can legitimately fail Windows foreground selection. Never weaken foreground/security rules or count a partial result as success.

`npm run smoke:windows-cancel` proves active real-browser cancellation, owner-EOF, queued-action refusal, job/profile cleanup and worker restart. Run UI-affecting native smokes sequentially with desktop smoke to avoid foreground contention. The normal unit suite and isolated pairing/HTTP tests may run independently. Phase 06 source/native checks pass; Phase 07 is the next milestone.

`npm run smoke:ux` builds, regenerates notices and runs the isolated source desktop regression with native zoom, legal attribution and language/theme/viewport checks. Screenshots in ignored release/qa-phase07/ contain only an empty fixture UI. CDP disconnect/timeouts and missing completion now fail the harness; Page.close completion uses normal OS process exit. Native real app tests remain sequential inside this smoke. New source controls do not constitute installer acceptance.

`npm run smoke:provider-settings` is a provider-focused isolated desktop regression. It explicitly skips interactive native app demos; full smoke:desktop/UX retain those strict tests. This separation does not certify a failed foreground-dependent replay. See TEST_MATRIX.md for current failures and prior passing native evidence. Request policy uses fake credentials only in tests; do not inspect real profiles or send an unapproved paid request.

`npm run smoke:local-model` performs genuine model inference plus source UI proof using the exact signed installed Ollama binary recorded in build/local-model-test-pins.json. It starts a separate random loopback server/private HOME, downloads/verifies a marked private Qwen cache if needed, and shuts down its owned tree. No normal Ollama/Hermes/account state is imported. The test requires PowerShell 7 for signature verification. Optional --diagnose logs only synthetic fixture responses. See MODEL-CONTRACTS.md for limits, model quality failures and cleanup/cache boundaries. Neither runtime nor model has been added to an installer.
