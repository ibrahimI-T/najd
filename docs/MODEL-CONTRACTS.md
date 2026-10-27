# Verified model boundary

Phase 08, 2026-10-15. Preserve the 13 existing route IDs and explicit provider/model/account choice. No automatic provider fallback or retry is enabled.

| Concern | Enforced contract |
|---|---|
| Requests | Main-owned concurrency (1-3), bounded timeout, current-policy input character cap, optional per-run cloud-attempt cap |
| Output | Optional validated output-token cap mapped per protocol; zero preserves each connector's prior default. Reasoning may count toward it; no exact currency guarantee |
| Context | Core/renderer bound message count/characters. Exact cloud token windows remain provider/model managed rather than guessed. Verified Ollama requests disable silent truncate/shift and reject incomplete output |
| Model-specific support | Existing effort mappings remain explicit; unknown models use defaults. Ollama probes actual tool capability before proposals; unsupported routes fail before inference |
| File proposal | Explicit named intent only; one no-argument function bound to that exact target in code, then existing root/sensitive-file/allow-once checks. Unknown arguments/tools/multiple calls refuse |
| Privacy | Only the current explicit proposal prompt is sent for that scoped operation. Its resulting preview body is temporary/local and excluded from chat/model history. Ordinary chat retains existing behavior |
| Connection proof | Complete valid inference; saved keys/catalogs alone do not verify. Replacement/auth rejection/cancel preserve existing invalidation and encrypted storage rules |

Real local baseline: signed Ollama 0.31.1 and content-addressed Qwen2.5:1.5b, declared model context 32768 tokens, tools capability present. Declared model maximum is not the daemon's allocated window. Private home/models/loopback PID and every blob/license hash were checked. A real two-turn conversation, real model proposal/core file read and actual source UI selection/test/chat/deny/allow/local preview pass. Cloud requests are fixture-tested; no live cloud account or fee was used.

Reproduce with `npm run smoke:local-model` after the reviewed signed Ollama binary is available. `NAJD_OLLAMA_EXE` selects its location but not its trusted hash. First run downloads about 986 MB of pinned model data into a marked ignored project cache; an unrelated existing directory is refused. Private profiles and owned process trees are cleaned, caches retained. This is development evidence, not automatic installer provisioning. Other versions/model quality require their own proof.

Failures retained: Qwen0.5B arithmetic continuation; Qwen1.5B path regeneration; stochastic/history-related proposal variation; an initial UI fixture polled its session file before creation. Scope binding, deterministic local proposal sampling and current-intent-only context corrected the protocol path without normalizing guessed paths or weakening validation. No model quality beyond these representative tests is promised.
