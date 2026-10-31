---
name: najd-computer-control
description: Control Windows apps, inspect windows and screens, and verify desktop actions using NAJD accessibility and optional vision tools. Use for interacting with an installed application, not for building application source code.
---

# Observe, act, verify

Use the user's intended app and task. Load desktop with najd_tools_load. Open the named app with najd_desktop_open when it is not open; its result gives a window id that najd_desktop_read accepts directly (otherwise list windows with najd_desktop_windows). Read its current controls with najd_desktop_read. Use element identifiers from that read in najd_desktop_act. Each action returns after, the window read again: verify the requested change from it and use its element ids for the next action, without another read. A successful dispatch alone does not prove the task finished.

To write in a tabbed editor such as Notepad without touching an open document, press its new-tab control first, then type into the empty document shown in after; never save unless the user asked.

Prefer a ready app integration when it exposes the requested operation. For websites, load browser and use najd_browser's page observations rather than desktop coordinates. Keep one executor responsible for each action; do not also run the same action through a script or another integration.

For visual appearance, load screen and use najd_screen_capture. Images help only when the selected model supports vision; otherwise use accessible text and report missing visual evidence. Never invent coordinates, control ids, screenshots, or an unsupported mouse tool. If a control is absent, inspect another supported view or report precisely what cannot be reached.

A title change of the same window (a new tab, another document name) is followed automatically when its process is the same; a different process is never followed, and the old element ids then stop working. A denied or cancelled action is not success. An uncertain result needs observation before retrying; do not repeat an effect blindly. Preserve the app's unsaved user work. Stop automation when the user stops the task.

Return the observed outcome, any artifact path, and the exact remaining limitation. A saved screenshot proves appearance only, not that a file was saved or a message delivered.
