# Security policy

## Reporting a vulnerability

Please do not open a public issue for a security problem. Use GitHub's private vulnerability reporting on the repository (Security tab, "Report a vulnerability").
Include the NAJD version (Settings > About), what you did, what happened and what you expected. A diagnostics file (Settings > About > Save diagnostics file) is
helpful and contains no chats, memory or keys. You will get an acknowledgement; fixes ship in the next release and are credited if you wish.

Owner action still needed before the source is public: enable private vulnerability reporting in the repository settings.

## Supported versions

Only the latest published release receives security fixes. NAJD is a development build channel until a Windows code-signing certificate and a rotated update-signing
key are in place (see docs/PRODUCT-READINESS-PLAN.md); Windows may show an unknown-publisher warning.

## What NAJD protects, and how

| Threat | Boundary |
|---|---|
| Web pages, files, tool results or MCP output that contain instructions | Treated as data. Only the owner's chat messages authorize actions; effects run through core approvals, not through the model's wording. |
| A model or skill that tries to change files, run commands or use the browser | Scoped file roots, per-action approval (or the owner's chosen access mode), immutable approval details, cancellation checks, an action journal that never replays an uncertain effect. |
| Passwords and keys | Provider keys and account passwords live in Windows protected storage (Credential Manager / OS encryption), are never shown to the model, never written to Git, logs or the renderer, and never imported from other applications. |
| Payments, verification codes, CAPTCHAs, password changes, account deletion | Always left to the owner. |
| The renderer process | Electron sandbox, context isolation, no Node integration, narrow IPC that validates the sender frame; external links open only as http(s) or as web pages inside the NAJD workspace. |
| Local services (Gateway, browser bridge) | Loopback only, authenticated per run with a random token, pairing confirmed natively with a matching code. |
| MCP servers and skills | Added only after a native confirmation that shows the exact command; environment secrets are stored encrypted; skill files are guidance and their scripts never run. |
| Updates | Signature-verified update manifests; the update channel stays off until the signing key is rotated from a clean device. |
| Logs and diagnostics | Secret-masked, profile paths shortened, size-capped; nothing is uploaded; crash dumps stay on the computer. |

## Known limits

- Full access mode lets NAJD act without asking for most actions; payments, verification codes and similar always still ask.
- The installer is not code-signed yet; compare the published SHA-256 before running it.
- A clean-Windows installation test and the owner's acceptance with real accounts are still pending (docs/PROGRESS.md).
