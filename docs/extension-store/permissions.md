# Permission justifications (paste into the store dashboards)

| Permission | Why it is needed |
|---|---|
| `storage` | Keeps the link to the local NAJD app and the panel state on this device. |
| `scripting` | Reads and acts on pages only inside the tab group NAJD opened, when NAJD asks (self-contained functions, no remote code). |
| `tabGroups` | Keeps NAJD's work in its own visibly separate "NAJD" tab group. |
| `alarms` | Keeps the service worker's connection to the local app alive and retries after the app restarts. |
| `sidePanel` | The assistant's interface (ask, progress, answer). |
| `webRequest` | Read-only: learns which network address a page in NAJD's own tab was actually loaded from, so a page fetched from this computer or a private network is never read (it observes only; it blocks and changes nothing, and sees only sites the user allowed). |
| `contextMenus` | "Ask NAJD about …" on selected text and pages. |
| Host `http://127.0.0.1/*` | The only network target: the NAJD app on this computer. |
| Optional hosts `https://*/*`, `http://*/*` | Lets NAJD browse the sites it opens for the user. Requested by the user from the panel; revocable at any time. |

Remote code: none. Data sold or shared: none.
