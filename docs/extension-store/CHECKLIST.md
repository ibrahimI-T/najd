# Submission checklist (owner steps; nothing below has been done)

Build: `npm.cmd run extension:pack` → `release/extension/najd-agent-browser-<version>.zip` (check the printed SHA-256).

1. Developer accounts: Chrome Web Store (one-time fee) and Microsoft Partner Center / Edge Add-ons, created and paid by the owner.
2. Publish the privacy policy (`PRIVACY.md`) at a public URL and fill in a contact address.
3. Upload the zip. Paste the listing text (`listing-en.md`, `listing-ar.md`) and the permission justifications (`permissions.md`).
4. Screenshots: 1280×800 from `npm.cmd run smoke:extension-store` (`release/extension/screenshots/{en,ar}-*.png`). A 440×280 promo tile is optional.
5. Data-use declaration: handles "website content" and "user activity" locally only; nothing sold, nothing used outside the single purpose.
6. The listing says that the NAJD AGENT desktop app is required (done in the text).
7. Reviewer instructions: the extension needs the desktop app; supply a reviewer installer link or a short video (the app is private until the owner decides).
8. Bump `version` in `browser-extension/manifest.json` for every submission.
9. Chrome and Edge assign different extension ids; the app pairs per extension origin, so no allow-list change is needed, but check pairing once on each store build.
