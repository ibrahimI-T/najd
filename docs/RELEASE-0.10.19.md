# NAJD 0.10.19

A fix release (2026-11-01). Published as an unsigned installer; in-app update notices stay off until the update key is
rotated.

## Fixed

- **One bad tool call no longer ends the task.** Some models (Kimi) send empty arguments for a tool that takes none, such
  as listing the desktop windows. NAJD refused the call and then sent it back to the model unchanged, which made the
  next request fail with INVALID_INPUT, so the whole task stopped after a single mistake. Empty arguments now count as
  no arguments, and a call that cannot be read is sent back in a readable form while NAJD still tells the model exactly
  what was wrong. The model can correct itself within the normal repair limit.

## Verification

- Automated: Vitest 127, Node 1043 tests, including two new regression tests. Both failed on 0.10.18 and pass now; they
  replay the call through the Chat Completions, Ollama, Claude and Gemini request formats.
- Packaged desktop smoke passes.

## Not done

- Not retried live with Kimi after the fix.
- The installer is not code-signed, so Windows SmartScreen may warn.
- No clean-Windows installation test of the published file.
