# Windows installer prototype

## Development baseline 0.6.0 (2026-10-16; published, owner acceptance pending)

release/0.6.0/NAJD-AGENT-Setup-0.6.0.exe: 116,583,698 bytes; SHA-256
DA95317C349CD422917D2E0DBB80133524B6D3FFC227CD4C3600DC36E13C7642.
Windows Authenticode NotSigned. The main update channel authenticates release
metadata/installer bytes with a pinned Ed25519 key; no publisher secret is shipped.

Keeps com.najd.agent, NAJD AGENT, per-user NSIS and retained canonical data. Includes
the latest renderer/personality/memory and in-app updater. Managed runtime bundling
is still a separate unfinished packaging gate; missing components report accurately.

171 Node + 21 Vitest/build; source and packaged update UI and provider regression;
actual isolated 0.6.0 -> 0.6.1 NSIS replacement/relaunch with retained data all pass.
Unique test identity/profile only, not the owner's actual existing installation.
All 80 packaged application inputs match current files; 22 production dependency
notices retained; production npm audit zero. See SPEC-updates.md / TEST_MATRIX.md.

Published and anonymous full-download/signature consumer verification passed; offer owner installation.
The live second release is held until owner confirms baseline installation. This is
not a completed clean Windows/production installer or live-account acceptance.

Updated: 2026-10-14. Version 0.5.0 is a local development artifact, not a public release.

## Latest artifact: 0.5.0

`release/0.5.0/NAJD-AGENT-Setup-0.5.0.exe` was assembled separately (116,210,276 bytes; SHA-256 `E2B13EFDFDD637B9D11B2C98BAE7EE1544A671017249CEA854D3DE222FD58547`; Authenticode `NotSigned`). It adds local chat search and explicit TXT export, with no browser-extension changes. Static JS syntax, TypeScript/Vite, notices, and NSIS packaging completed. No normal-profile install/launch, runtime smoke, real chat access, or account request was run. The user will perform manual acceptance later. Build command: `npm.cmd run dist -- --config.directories.output=release/0.5.0`. Close older NAJD normally before installing; never run two versions with the same profile. `release/` remains ignored by Git.

## Previous artifact: 0.4.0

`release/0.4.0/NAJD-AGENT-Setup-0.4.0.exe` was assembled separately from the running install (116,209,169 bytes; SHA-256 `E15ABFB1EF43B4AEF926C50D59A8D4A65808370279B26464123A2A05954396B1`; Authenticode `NotSigned`). Static JavaScript syntax checks, TypeScript/Vite compilation, notices, and NSIS packaging completed; the packaged extension worker file is present. No personal-profile install, app/browser launch, live action, or account request was performed. The user owns the ordered acceptance steps in `docs/USER-TEST-0.4.0.md`. Build evidence is not runtime evidence.

Build command: `npm.cmd run dist -- --config.directories.output=release/0.4.0`. Close any older NAJD normally before installing; do not run two versions with the same real profile. As before, the unpacked browser extension must be loaded manually in Chrome/Edge. `release/` is ignored by Git; retain this local Setup for the user's test.

## Previous artifact: 0.3.0

`release/0.3.0/NAJD-AGENT-Setup-0.3.0.exe` was assembled without running tests at the user's request. Size: 116,207,055 bytes. SHA-256: `35D58F6F64DC160E15A4D5E41308BDB0D4A5692ECE17810BEAD5927B28C88BC5`. Authenticode: `NotSigned`. The renderer's TypeScript/Vite compilation and NSIS packaging completed; this is build evidence, **not** runtime/browser acceptance. The packaged resources contain `browser-extension/manifest.json` and the unpacked extension. Chrome/Edge still require the user to choose Load unpacked; Setup does not silently install or enable the extension. The user will test it and report results. No installed normal-profile NAJD executable was replaced or launched for this increment. The 0.2.1 artifact below is preserved as historical baseline.

Build command: `npm.cmd run dist -- --config.directories.output=release/0.3.0`. Keep this output separate from any running install. Before installing 0.3.0, close an older NAJD normally; do not run two versions against the same real profile. `release/` remains ignored by Git and the Setup is not remotely backed up.

## Build

Node.js 24 and npm 11.12.1 are development requirements. With the committed lockfile installed, run npm.cmd run dist. The script builds the renderer, generates full dependency notices, and packages Electron into an x64 assisted NSIS Setup. Its application ID remains com.najd.agent.

Output for this increment: release/0.2.1/NAJD-AGENT-Setup-0.2.1.exe (116,198,289 bytes; SHA-256 2A8349B89273B00DFCBBC0259BC42952A2E69FDB9A0D5EF019E884532A72339A). The 0.1.x and 0.2.0 installers are preserved. The 0.2.0 Setup predates T40; 0.2.1 includes its credential-recovery change. A separate output directory avoided closing the running installed app or touching its data. Icon sources are tracked in build/; generated binaries and notices are ignored. The installer offers English/Arabic, a current-user installation path, and shortcuts. Users do not need Node.js or Git to run the installed desktop app. Ollama and local model downloads remain optional, separate setup; cloud models require the user's own connection. Authenticode status is NotSigned.

Exact build and archive verification:

```powershell
npm.cmd run dist -- --config.directories.output=release/0.2.1
$env:NAJD_TEST_PACKAGE_DIR='C:\NAJD AGENT\release\0.2.1'
npm.cmd run smoke:package
```

The default package smoke still uses release/win-unpacked and may exercise an older archive. Set the override above for 0.2.1. Close an older app normally before installing the new Setup; do not run two versions against the same real profile. This run did not perform a real-profile upgrade or installation.

## Data and lifecycle

Application data lives beneath Electron userData/najd-data. The existing app name uses the Windows roaming najd-agent directory. Removal is configured to retain chats and other app data. Folder grants reset when the app restarts.

A recorded session tested 0.1.0 installation, launch, same-version reinstall/repair, and uninstall on this Windows account. Uninstall removed the program while retaining session/activity data. This is historical evidence, not a clean-machine or cross-version upgrade test.

The 0.2.1 archive passed the isolated Electron harness using its actual packaged main/preload/renderer files: grouped menus, Escape/focus, encrypted Kimi/API keys, ChatGPT callback/model/test/chat, API model/test/chat, automatic/manual reasoning payloads, read approval, and normal-close restart of API/ChatGPT connection proof and chats. T40's separate source kill-recovery smoke passed with temporary Windows app data. No real account consent/key was used. Notices in resources/THIRD-PARTY-NOTICES.txt, LICENSE.electron.txt, and LICENSES.chromium.html were verified. Source Arabic/English and narrow settings captures and Arabic composer controls were inspected in the preceding 0.2.0 increment; they were not rerun for 0.2.1. The installed normal-profile app was not modified.

Normal restart is verified. T40 additionally tested real Windows safeStorage with isolated app data: a forced kill inside the roughly ten-second initial OS key-flush window leaves encrypted records intact but temporarily unreadable. NAJD fails closed; a new ChatGPT sign-in moves its unreadable record aside and a user-entered key can be saved again. Once the OS wrapping key has reached disk, the kill fixture confirms credentials survive a forced stop. The old ciphertext cannot be decrypted after the key is lost. The fixture does not establish clean-Windows or real-profile acceptance, and no corrupt record is silently deleted.

## Remaining release acceptance

- Clean Windows account/VM install and launch with no development tools.
- Both installer languages and both app languages.
- Cross-version upgrade and repair without losing chats.
- Uninstall/reinstall and explicit app-data retention behavior.
- Signing certificate, update delivery, and first-run provider setup.

latest.yml and blockmap files are build metadata only. NAJD does not yet implement automatic updates.

## Dependency audit

The 2026-10-14 npm audit reports eight moderate entries arising from one sprintf-js advisory through the optional build-time proxy/logger chain of electron-builder. No high/critical entries were reported. No patched sprintf-js release is published, and automatic remediation suggests a builder downgrade outside the selected version.

This dependency is not part of the packaged runtime and does not process NAJD user input. Keep the builder pinned, do not pass untrusted format strings into the build logger, and recheck by 2026-10-21 or before external release. Advisory: https://github.com/advisories/GHSA-hp3w-g68c-fv3c.
