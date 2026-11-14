# R-072: context cost and capability execution audit

Date: 2026-11-07. Source increment; not yet packaged or installed.

## Evidence

The owner's Superpowers conversation used 31,635 tokens across six calls. Its definition question alone used 23,597 tokens: 23,230 input and 367 output over four calls. Final request sizes were 11,394 instruction bytes and 8,569 tool-schema bytes. The UI displayed conversation aggregates, not just the last answer.

`node scripts/benchmark-context.cjs` compares the same deterministic fixture without provider requests: instructions plus schemas fall from 16,788 bytes to 7,514 bytes (55%). This does not establish a provider-token reduction or real-task acceptance.

## Implemented

Normal conversations default to the existing lean context path, retaining explicit context preferences and custom personality text. The runtime loads additional toolsets through existing readiness and schema checks. Session details now distinguish input, output, cached input, and cumulative totals.

The broken `windowsNode.available()` probe is replaced with the actual `installed()` method. Web and media health are queried from their services; GitHub detection requires a connected MCP tool bearing that server name. This is connection discovery, not independent OAuth verification. Optional checks fail independently. The 3D and mobile toolchains remain unimplemented health integrations and must not be marked ready.

## Reference comparison and outstanding work

REA selected-source static analysis of Kimi app.asar (SHA-256 7b050b909b48b76e369769b17f6605ae2b2499d2aee0ec44b1bb65cc0396fd45) examined 15 selected JavaScript files. Parent evidence: ev_db597b59c416e7b6694be6f8cc03637396e823bcbe1328ffadbdbb518f526674. Coverage is partial; eight unpacked native integrity contradictions were recorded. No target code was executed.

Shipped inventory includes gateway.asar, WebBridge executable and CRX, Node runtime, desktop native modules and a model-step worker. The current compatible-package importer copies declared skill files and replaces computer/browser instructions with NAJD adapters. It does not install or connect declared foreign MCP servers, agents, hooks or runtime executables. Consequently the same package names do not establish execution parity.

Official documentation confirms that plugins can supply Skills, MCP, agents and session-start instructions:
- https://www.kimi.com/code/docs/en/kimi-code-cli/customization/plugins.html
- https://www.kimi.com/code/docs/en/kimi-code-desktop/settings-and-extensions.html
- https://github.com/modelcontextprotocol/registry/blob/main/docs/reference/api/official-registry-api.md

Next: preserve and expose supported MCP declarations during package planning, connect through NAJD's existing MCP manager with lifecycle ownership, implement per-service readiness and actual sample calls, then compare real-provider success/calls/tokens. Package and install only after those checks. Full Kimi parity is not complete.
