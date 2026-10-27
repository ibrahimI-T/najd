# Third-party licenses

Phase 09 developer runtime: upstream pm/lock.json pins Windows x64 CPython 3.14.7+20260901 (archive SHA-256 5d9242012dded591d723a3a572dda265173ad58d8a3e6fdbc6dac8f94f36c80a; full LICENSE.txt retained in extracted runtime) and uv 0.12.3 (b23350c79e8ad0192b8124af13a0f17e8d4e4549524785e1aef389ae5a06990e). Hermes core dependencies come only from frozen uv.lock through PM, including openai 2.24.0; no NAJD npm production dependency was added. These private development artifacts are not shipped. Before installer inclusion, inventory every Python/native/transitive license and retain full uv/upstream/dependency notices; source acceptance is not packaging acceptance.

Canonical Phase 02 provenance/notice inventory (equivalent role to the master plan's THIRD_PARTY_NOTICES.md). Reviewed 2026-10-14 against committed pins, installed LICENSE files, lockfile and package configuration. Do not duplicate this inventory under another filename.

NAJD's own source license remains undecided. This document covers external components and does not assign a license to NAJD.

| Component | License | Distributed notice |
|---|---|---|
| Electron | MIT | LICENSE.electron.txt beside the executable |
| Chromium and its dependencies | BSD and component licenses | LICENSES.chromium.html beside the executable |
| React / React DOM | MIT | resources/THIRD-PARTY-NOTICES.txt |
| scheduler (React DOM dependency) | MIT | resources/THIRD-PARTY-NOTICES.txt |
| lucide-react icons | ISC | resources/THIRD-PARTY-NOTICES.txt |
| DM Sans and IBM Plex Sans Arabic | SIL OFL-1.1 | resources/THIRD-PARTY-NOTICES.txt |
| Vite / React build plugin | MIT, build tools | Installed dependency license files |
| TypeScript | Apache-2.0, build tool | Installed dependency license file |
| electron-builder / NSIS | MIT / zlib and tool-component licenses | Installed build-tool notices; not app runtime code |
| Ollama 0.31.1 | MIT, Copyright (c) Ollama | Development proof reuses a valid signed installed binary with an exact SHA-256; full text docs/third-party-notices/OLLAMA-0.31.1-LICENSE.txt; not bundled |
| Qwen2.5 1.5B test model | Apache-2.0 | Full registry notice hash verified and retained in docs/third-party-notices/QWEN2.5-1.5B-LICENSE.txt; private developer cache, not distributed or selected as the user's default |

scripts/generate-notices.cjs reads full notices from the pinned installed runtime packages and fails the distribution build if a required license is missing. The generated notices are explicitly included as an installer resource. Generated notice/build files are ignored; the generator and icon sources are tracked.

OpenClaw and Hermes committed source baselines are pinned in third_party/ with their original MIT LICENSE files retained; see SOURCE-REUSE.md for exact revisions. They are not yet part of the distributed installer. Runtime packaging must include these full notices and applicable transitive dependency notices before bundling either engine.

## Deterministic dependency / artifact inventory

| Scope | Exact version / pin | Provenance / boundary |
|---|---|---|
| React, React DOM | 19.3.0 | package-lock.json + installed MIT LICENSE |
| scheduler | 0.28.0 | Only non-direct production transitive npm dependency; installed MIT LICENSE |
| lucide-react | 1.56.0 | ISC code/icon notice |
| DM Sans, IBM Plex Sans Arabic | 5.3.0 each | Fontsource package LICENSE (OFL-1.1); bundled fonts |
| Electron / Chromium | 44.7.0 / 152.0.7977.130 | Installed binary version probe; electron/Chromium notices supplied by packager |
| Electron embedded Node | 24.21.0, module ABI 149 | Satisfies OpenClaw version range numerically; Electron ABI does not establish stock-Node native addon compatibility |
| Host Node / npm | 24.15.0 / 11.12.1 | Existing development tools; host Node fails OpenClaw engine constraint |
| Builder / Vite / TypeScript / Vitest | 26.15.3 / 8.3.4 / 7.0.2 / 5.0.4 | Lockfile pins (372 package records); build-only dependencies not copied wholesale into app.asar |
| OpenClaw | 9ad5e98edb514da1ceb4d98af1b8a2817d6eb8aa; manifest 2026.10.3 | Clean source submodule; MIT Copyright 2026 OpenClaw Foundation; pnpm lock retained |
| Hermes | c70332f88886932337619a1e57029bd885c28b9d; manifest 0.0.0 | Clean source submodule; MIT Copyright 2025 Nous Research; uv/npm locks retained |
| OpenClaw Windows companion | Baseline d096d5381c9f6aefdcc5f49ca93bc618eaed9c8b | MIT Copyright 2025 OpenClaw Foundation; full notice retained; test-only local adaptation recorded in SOURCE-REUSE.md; not installer-bundled |
| Interop.UIAutomationClient | 10.19041.0 | NuGet official feed, no package dependencies; MIT Copyright 2019 Roman; full installed LICENSE.txt reviewed and retained in native/windows-node-host/licenses; native lock records content hash; not installer-bundled |
| NAJD icon / extension | build/icon-src.html, browser-extension/ | Existing tracked local source; no upstream logo or remote assets introduced; original creator history retained |
| Models / weights / Windows companion | None bundled | No weight redistribution or third-party installer introduced |

package.json currently packages dist/, electron/, package.json, generated renderer notices and browser-extension/. It does not package third_party/, node_modules/, personal profiles, standalone Hermes binaries, private keys or model downloads. Existing archived installers are historical artifacts; current generator changes require a future installer build before distribution acceptance.

## Compatibility and security boundaries

- OpenClaw's exact manifest requires Node >=24.16.0 <25 or >=26.1.0. Source compilation uses upstream pnpm tooling. Phase 05 proves the separately pinned published Gateway on stock Node 24.21.0/native Windows; this does not prove source compilation or installer packaging.
- Hermes's pyproject metadata admits >=3.11,<3.15 for old updater compatibility; its inline support contract says only 3.14 is supported. Provision an isolated NAJD-owned Python 3.14 environment for acceptance, rather than infer support from the metadata minimum. No personal Hermes environment/configuration is consumed.
- The pinned OpenClaw Windows document links the official [Windows companion repository](https://github.com/openclaw/openclaw-windows-node). Its first-run local Gateway uses WSL; therefore it cannot be silently substituted for NAJD's unverified native-runtime route. It is not vendored/shipped; pin and audit it separately if Phase 06 selects components.
- [Hermesclaw](https://github.com/ZY-LI-F/Hermesclaw) remains engineering reference only; no code, license obligation or dependency is added from it.
- Live npm audit on 2026-10-14: 8 moderate, 0 high, 0 critical entries, all in the existing builder proxy/logger chain. The [sprintf-js advisory](https://github.com/advisories/GHSA-hp3w-g68c-fv3c) is tracked in INSTALLER.md. Do not force an unrelated builder downgrade; build inputs must remain trusted. This scan does not certify uninstalled upstream dependency trees.
- Every future runtime payload must carry its own full upstream and transitive notices, native-binary hashes/provenance and vulnerability audit. Unknown runtime/asset terms are a distribution gate, not an excuse to claim the current source submodules are already integrated or release-ready.

Verification: npm.cmd run notices reads six full license files and fails if one is missing; production lockfile closure is these six packages; upstream gitlinks match clean checkout SHAs; official companion relationship and current builder advisory were checked from primary repositories. NAJD's own source license and public release remain separate owner gates in Phase 17.

## 0.6.0 updater distribution (2026-10-16)

Pinned electron-updater 6.8.9 (MIT, original electron-builder authors) and complete installed production closure: 22 renderer/main runtime packages. generate-notices.cjs now walks exact installed production dependencies and retains full license/notice texts in the shipped notices. lazy-val 1.0.5 declares MIT/Vladimir Krivosheev in npm metadata but upstream/tarball omit a standalone notice; docs/third-party-notices/lazy-val-1.0.5-NOTICE.txt transparently records that provenance and the standard declared terms without fabricating an original copyright notice. Existing upstream/Chromium/Electron attribution remains. Production npm audit reports zero advisories; the older build-only advisory baseline remains separate. No newly managed engine payload/model is redistributed in this development installer.

## Design skill packs (2026-10-28)

Shipped under resources/skill-packs, vendored byte for byte at pinned commits by scripts/vendor-skill-packs.cjs
(skill-packs/manifest.json records every file's SHA-256; `node scripts/vendor-skill-packs.cjs --check` verifies them).
Each pack keeps its LICENSE (and NOTICE where present) beside it, and the texts are added to THIRD-PARTY-NOTICES.txt.

| Pack | Source and pin | License |
|---|---|---|
| Taste Skill | Leonxlnx/taste-skill @ 12af471f627f866411b4bd785b19646d3672784c (skills/taste-skill) | MIT |
| Impeccable | pbakaus/impeccable @ d34c87e1a00989ae8dbdd7f6b30b70f23319e860 (.agents/skills/impeccable) | Apache-2.0, NOTICE.md kept |
| GSAP Skills | greensock/gsap-skills @ aed9cfd3277740755f6bfc1155c7aa645403b760 (skills) | MIT |
| Playwright CLI skill | microsoft/playwright-cli @ b1a5903c5b633b8c9f843ad7b629c2a78437040c (skills/playwright-cli) | Apache-2.0 |
| Designlang skill | Manavarya09/design-extract @ d2c28da8aae3098a7f7dc02fb4355f3f803edb6c (skills/extract-design) | MIT |

Not shipped: React Bits (MIT + Commons Clause) and Transitions.dev (own license) forbid redistributing the libraries
themselves. The web builder guide fetches them into the user's own project when used, which both licenses allow.
