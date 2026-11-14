# NAJD AGENT — Browser extension

Connects Chrome or Edge to the NAJD AGENT desktop app. The side panel is a chat with NAJD beside the page you are reading, and NAJD can browse for you in its own "NAJD" tab group (search, open, read, follow links). Typing, choosing options and pressing buttons need your approval in NAJD; passwords and payment details are never typed by the extension.

## NAJD Browser 2.x (this folder)

- Pages are driven through the Chrome DevTools Protocol: observations from the accessibility tree, real mouse and text input, owned ("NAJD" group) and attached tabs; a stale or changed target is refused.
- 2.1.0: signing in with an account the owner authorized in NAJD (Settings → Accounts). NAJD fills the saved password itself; the extension checks the approved page, password field and form against its observation, then fills the fields in an isolated world with the same rules as 1.x (one visible password field, a sign-in form sending to the account's own site over https, no registration, reset, change or verification-code field). The password is never returned. Verification codes, CAPTCHAs and payments stay with the owner.
- Tests: `npm.cmd run smoke:browser-v2` and `npm.cmd run smoke:browser-login-v2` (Edge, temporary profile, fixture site).

## Side panel (1.1.0)

- **Chat**: your messages on the right, NAJD's on the left; follow-up questions continue the same NAJD conversation. Answers appear as soon as NAJD has them, with a collapsible **Tool calls** section that updates live (Reasoning, Read page, Reading, Browsing, Working, Waiting for your approval).
- **Page awareness**: the panel follows the active tab. With **Include this page** ticked, the page's address, title and visible text (Arabic kept intact, up to 12,000 characters) go with the question as untrusted data. Nothing is read from a page until you send a question.
- **Quick actions**: Summarize this page, Translate, Explain.
- **Composer**: model selector (the models set up in NAJD, or NAJD's own choice), a text-file attachment (up to 500 KB), voice typing (the browser's own speech service) and send/stop.
- **Highlight on page**: text NAJD quotes in an answer (and any words you select in an answer) can be highlighted on the page.
- **Banner**: while NAJD works in this browser, the panel and NAJD's tab show "NAJD started debugging this browser" with **Cancel**, which stops that task in NAJD.
- **Approvals** are decided only in the NAJD app; **Review in NAJD** brings the app forward.
- **Fallback**: when NAJD is not running the panel says so, keeps the chat and reconnects by itself.
- The toolbar icon opens the panel and closes it again. Arabic and English interface, right-to-left in Arabic.

## Build and load (development, unpacked)

1. Start NAJD AGENT.
2. Open `edge://extensions` or `chrome://extensions`, turn on Developer mode, choose **Load unpacked** and select this folder (`browser-extension`). After an update, press **Reload** on the extension card.
3. Click the NAJD icon and press **Connect**. A NAJD window shows a six-digit code; allow only if it matches the one in the panel. Fallback: Settings → Browser shows a one-time code to paste into the panel.

## Store package

`npm.cmd run extension:pack` builds `release/extension/najd-agent-browser-<version>.zip` (+ `.sha256`) for the Chrome Web Store and Edge Add-ons (store manifest: website access is optional). Listing text, privacy policy and permission justifications are in docs/extension-store/. Specification: docs/SPEC-extension-and-toolbox.md.

## Test

- `npm.cmd test` — unit tests (bridge protocol, page text, tool-call steps, banner, store checks).
- `npm.cmd run smoke:browser` — real Microsoft Edge with a temporary profile and fixture pages on this computer: pairing, NAJD's tab commands, and the side panel chat (page text in Arabic, follow-ups, live tool calls, highlight, model choice, Stop, banner Cancel, offline fallback). It never uses your browser profile or real accounts.
- `npm.cmd run smoke:extension-store`, `npm.cmd run smoke:browser-login` — store build and sign-in checks.

## Boundaries

- NAJD acts only in its own tab group. Your other tabs are read only when you send a question from the panel with "Include this page" ticked (the active tab, once, for that question).
- The extension talks only to NAJD on 127.0.0.1 with its link secret; no remote code, no analytics. Voice typing, when used, goes through the browser's speech service.
- Page text and attached files are untrusted data: they never authorize an action. Password, card, CVV, IBAN and one-time-code fields are refused by the page script.
- Pages change after a snapshot; an element that disappeared is refused and NAJD reads the page again.
- A timed-out action has an unknown effect and is recorded as such in NAJD.

Tested with Microsoft Edge and a temporary profile. Acceptance in the owner's own browser and on real sites is pending.
