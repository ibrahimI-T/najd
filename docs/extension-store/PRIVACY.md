# Privacy policy — NAJD AGENT browser extension

Effective: 2026-10-22 (a draft until the owner publishes it at a public address; both stores require a URL).

**Summary:** the extension does not collect, sell or transmit personal data to the developer or to any third party, and it talks only to the NAJD AGENT desktop app running on the same computer. Questions you ask and page details you share are processed by the desktop app, which sends them to the AI provider you selected in the app (see below).

## What the extension handles

- **Link secret and link state**, stored in the browser's extension storage on this device, so the browser stays linked to NAJD.
- **Questions you type** in the side panel, **text you select** and ask about, a **text file you attach**, and, if you leave "Include this page" on, **the address, title and visible text of the current page** (read once, when you send the question; up to 12,000 characters). These go only to the NAJD app at `127.0.0.1` on your computer.
- **The chat in the panel** is kept in the browser's session storage (memory) until the browser closes or you start a new chat; the conversation itself is saved by the NAJD app.
- **Highlight on page**: when you ask, the extension marks text in the current page. Nothing is sent and the page is not changed.
- **Pages NAJD opens for you in its own tab group**: when NAJD asks, the extension reads that tab (visible text and controls) and returns it to the NAJD app at `127.0.0.1`. It does not read your other tabs on its own; only the page you include with a question you send.
- The extension never reads or types card numbers or one-time codes, and refuses password, payment and one-time-code fields in ordinary actions.
- **Saved-account sign-in:** when you ask NAJD to sign in with an account you authorized, the desktop app passes that account's password to the extension over the local link for that single fill. The extension types it into the sign-in form and does not store, log or return it; the AI model never receives it.

## What leaves your computer

The extension itself sends nothing over the internet. Questions you ask from the browser become conversations in the NAJD desktop app, so the question text and any page address, title, page text, selected text or attached file you chose to share can reach the AI provider you selected there (local or remote). That is governed by the provider's terms, not by this extension.

**Voice typing** (the microphone button) uses the browser's built-in speech recognition, which the browser may process with its maker's online speech service (Google for Chrome, Microsoft for Edge). It is used only while you press the button.

## Permissions

See `permissions.md`. Website access is optional and can be revoked in the browser's extension settings.

## Retention and control

Unlink from the panel or from NAJD Settings → Browser; the secret is deleted from the extension storage. Removing the extension deletes all of its data.

## Contact

To be filled in by the owner before submission.
