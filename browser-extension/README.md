# NAJD AGENT — Browser extension

Connects Chrome or Edge to the NAJD AGENT desktop app. NAJD browses for the user in its own "NAJD" tab group (search, open, read, follow links), and the user can ask NAJD from any page through the side panel or the context menu. Typing, choosing options and pressing buttons need the user's approval in NAJD; passwords and payment details are never typed by the extension.

## Setup (development, unpacked)

1. Start NAJD AGENT.
2. Open chrome://extensions or edge://extensions, turn on Developer mode, choose Load unpacked and select this folder.
3. Click the NAJD icon and press Connect. A NAJD window shows a six-digit code; allow only if it matches the one in the panel. Fallback: Settings -> Browser shows a one-time code to paste into the panel.

## Store package

`npm run extension:pack` builds the zip for the Chrome Web Store and Edge Add-ons (store manifest: website access is optional). Listing text, privacy policy and permission justifications are in docs/extension-store/. Specification: docs/SPEC-extension-and-toolbox.md.

## Boundaries

- NAJD acts only in its own tab group; it does not read other tabs.
- The extension talks only to NAJD on 127.0.0.1 with its link secret; no remote code, no analytics.
- Password, card, CVV, IBAN and one-time-code fields are refused by the page script.
- Pages change after a snapshot; an element that disappeared is refused and NAJD reads the page again.
- A timed-out action has an unknown effect and is recorded as such in NAJD.

Tested with Microsoft Edge and a temporary profile (`npm run smoke:browser`, `smoke:extension-store`). Acceptance in the owner's own browser and on real sites is pending.
