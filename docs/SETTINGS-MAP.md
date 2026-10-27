# NAJD settings map

Reviewed: 2026-10-15. This distinguishes implemented controls from intended capabilities.

| Section | Purpose | Current implementation |
|---|---|---|
| General | Language, direction, appearance, accent, legal notices | Saved Arabic/English, four themes, 100/115/125% interface sizing and full bounded legal notice display |
| Models | Providers, credentials, model selection | Three plan routes, nine APIs, Ollama; protected credentials, model/effort selectors and inference-bound proof; real-account gates remain |
| Connections | Messaging channels and linked services | In development |
| Browser | Chrome/Edge linking and disconnection | Named page controls, manual click/type with native confirmation, read-only refresh, local practice page, stop/clear; live action acceptance pending |
| Tools | Files, commands, search, MCP | Read-file, bounded document name search and fixed approved Windows demos are available through chat/Permissions; generic tools/MCP page remains pending |
| Skills | Installed skills and requirements | In development |
| Permissions | Allowed folders, approvals, activity | Folder picker/revoke, read/search approvals, native capability help and request preparation, metadata log; folder grants reset on restart |
| Memory | Context and long-term memory | Bounded recent chat context only; long-term controls pending |
| Data | Storage, export, deletion | Local sessions/search, selected-chat TXT export and per-chat deletion; global deletion/retention controls pending |
| Voice | Speech input/output | In development |
| Advanced | Local primary service status | Real managed Gateway status/retry/stop; future update/diagnostic export controls remain absent |

File reads accept UTF-8 text up to 64 KiB and show a bounded preview. Sensitive filenames and paths outside granted roots are rejected. A pending approval stays attached to its chat; Settings can still manage folder grants.

Section organization was informed by pinned Hermes source and official upstream documentation. NAJD owns the current UI/core; genuine OpenClaw Gateway and Windows shared-library integration are now implemented in the source application with original authorship retained. Hermes runtime acceptance remains Phase 09. SOURCE-REUSE.md records exact pins/transfers and ownership; no existing Hermes installation profile is consumed.

Phase 08 source increment: Models now includes guided setup plus persisted concurrency/timeout/input-character/optional cloud-attempt limits. The per-run attempts display excludes local calls and resets on restart. Dollar budgets, per-protocol token caps, real configured conversation/tool acceptance and automatic fallback are not claimed.
