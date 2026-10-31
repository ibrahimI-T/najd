# NAJD 0.10.18

Covers 0.10.17 and 0.10.18 (2026-10-31). NAJD now owns more of the execution guarantees itself instead of relying on the
model to remember them: page interactions need the right approval, invalid tool calls have a repair limit, and an
action whose outcome is unknown is never sent twice. Published as an unsigned installer (the signing key stays out of
use until it is rotated on a clean device); in-app update notices stay off until the update key is rotated.

## Safety and reliability

- **Page interactions in the preview.** Clicks and typing on a page served by a local server (localhost) now wait for
  the owner's approval of that exact address and those exact steps, through the normal access modes. Each step first
  checks the page is still on the approved origin; a redirect elsewhere stops the steps. A denial loads nothing. Pages
  from local HTML files stay contained (they can read only their own folder and reach no server), so testing a counter
  page needs no approval and still costs one call. Steps on public sites stay refused.
- **Bounded repair of invalid tool calls.** Unknown tools, broken JSON, oversized or wrong arguments are answered with
  the exact problem and how to correct it. The same invalid call a third time, or six invalid calls in a row, ends the
  task with NAJD's own account of what was done, without another model call. Discovery, guide reads and tool loading
  are not counted as progress (0.10.18: an unknown tool alternating with a capability search used 17 model calls; it now
  stops after 5). Real work between failures keeps a long task going.
- **Uncertain effects are never sent twice.** When an action may or may not have happened (a timeout after it was
  sent), the identical request is refused. Only evidence about the same target clears it: a read of the same file that
  shows the change is in place (refused as already done) or that it did not happen (the retry asks for approval again).
  Unrelated reads, capability metadata and skill reads change nothing. Commands, desktop actions, page interactions and
  process starts stay blocked for the rest of the task. A preview failure after clicks were sent (picture, page text,
  cancel or deadline) is reported as uncertain too.
- **Empty replies.** A reply with no text and no tool call (some thinking models do this after finishing) is asked for
  its answer once; if it is empty again, NAJD lists what ran instead of failing a task whose work is done.

## Smaller fixes

- A message sent with Enter while NAJD is still opening waits and is sent once NAJD is ready ("Sends when NAJD is
  ready"), instead of doing nothing.
- Skills can be read by their display name; the empty NAJD workspace lists as empty; a `file:///` address of a local
  file previews that file.

## Verification

- Automated: Vitest 127, Node 1041 tests; 39 new regression tests, which fail on the earlier code where they cover a
  reported defect.
- Real Electron and app checks in isolated profiles: preview (no click reached a local server without approval, exactly
  three with it), desktop recovery on a test-owned window, durable recovery, abrupt termination, first message after
  launch, desktop UI and the packaged app.
- Real models (0.10.17, isolated profiles, test-owned windows only): Kimi Code passed file, counter (real clicks),
  research and skill reuse (4 calls instead of 6); qwen3-vl:4b passed file, counter, research and reading a value from
  a screenshot; qwen3.5:4b no longer fails a finished file task. Remaining small-model failures are model limits
  (claiming a test or a skill it did not run). Provider-reported tokens include cached input and are not billed amounts.

## Not done

- The installer is not code-signed, so Windows SmartScreen may warn.
- No clean-Windows installation test of the published file.
- Only Kimi among cloud providers was tested for this release.
