# Execution skills and computer profile

The owner's request is implemented as NAJD-native workflows, using actual NAJD tools and the existing instruction-skill loader. No private model instructions, account configuration or proprietary skill scripts were copied.

## Shipped changes

- `computer` profile selects accessible window observations and actions, optional screenshots, process information and relevant skills.
- `desktop-read` groups window listing and reading for small context windows. Existing action tools remain available through on-demand loading and retain their approvals.
- Four short original built-in guides: `najd-code-engineering`, `najd-computer-control`, `najd-research-evidence`, `najd-skill-authoring`. Main's existing guide loader discovers their metadata, verifies their digests and serves content through `najd_skills_read`; existing saved enablement settings do not hide new built-ins.
- Relevant NAJD guides take precedence over generic upstream matches in the bounded six-guide suggestion list. Guide bodies are not automatically injected into every request.

## Reference approach

Official Claude documentation describes metadata-first, on-demand skill loading and a client-executed observe/act/result loop. Its coding pattern pairs editing with command execution; its research pattern pairs search with focused source retrieval. These inform original NAJD guidance, not provider-specific schema copying.

- https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview
- https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-combinations
- https://platform.claude.com/docs/en/agents-and-tools/tool-use/computer-use-tool

Local developer skill practices informed concise procedure writing, evidence-led debugging, focused repository edits and verification. Existing NAJD web-design and Office guides/packs remain in place, with their existing attribution. New guides contain original NAJD-specific procedures rather than copies of third-party skill bodies.

## Evidence boundaries

Routing and temporary-store tests establish discoverability, persistence behavior and tool selection at tiny, small and medium budgets. They do not establish intelligence parity with any model. Models without vision receive accessible text rather than screenshot pixels. NAJD does not gain a coordinate-based mouse implementation merely by describing one. Real computer automation and selected-model quality require their separate runtime acceptance tests. No subscription quota bypass or measured monetary saving is claimed.
