# NAJD 0.10.11 local update

## Changes

- Native computer-control profile, accessibility-first observations and optional vision input.
- Four built-in English instruction guides: code engineering, computer control, evidence-backed research and skill authoring. Arabic strings are UI display translations only.
- Consecutive discovery-loop protection and atomic, truthful toolset loading; on-demand guide suggestions for small models.
- Readable selected-profile styling and a localized observe/act/verify card.
- Model-family guidance from the existing in-progress integration is included in the candidate; it does not import external products' tools or identity.

## Deterministic efficiency measurement

Run `node scripts/benchmark-agent-context.cjs`. These are serialized first-request bytes with fixture-ready services at a 16k context window, not billed token counts, response quality or a before/after monetary benchmark.

| Profile | Full bytes | Adaptive bytes | Reduction |
|---|---:|---:|---:|
| General | 8721 | 4052 | 53.5% |
| Computer | 13231 | 4141 | 68.7% |
| Coding | 14768 | 4533 | 69.3% |
| Research | 9635 | 3764 | 60.9% |
| Design | 11317 | 4051 | 64.2% |
| Office | 13849 | 4051 | 70.7% |

## Actual local-model checks

Pinned Ollama 0.31.1 / Qwen2.5 1.5B, private loopback server and isolated state, verified model hashes. Real two-turn conversation, exact-file proposal, approval and bounded read passed with zero cloud attempts. Local personality, preference/lesson capture, persistence/recall and deletion also passed. This is one small text/tool model, not a test of all providers or visual competence.

## Boundaries

Existing NAJD web/Office/media/browser/MCP integrations remain available according to readiness and permission state. A guide does not provide a missing runtime or media service. Proprietary model weights, private platform features, arbitrary pixel mouse control, universal model correctness and subscription-limit bypass are not included. Desktop controls use the actual implemented accessibility operations. Public distribution is not performed by this local update.

Final packaging/install evidence is recorded in PROGRESS.md after validation.
