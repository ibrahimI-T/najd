---
name: najd-skill-authoring
description: Create a reusable NAJD skill from a completed, verified workflow or an explicit request to remember a procedure. Use for skill creation and improvement, not for saving personal facts as procedures.
---

# Save proven procedures

Look for an existing relevant skill through capability discovery and najd_skills_read before creating another. Reuse or improve the existing procedure when it already fits. A skill is instructions; tools execute operations and MCP supplies connected tool contracts. Saving text does not install scripts, provision dependencies or add vision to a model.

Capture the task trigger, required inputs, actual tools used, minimal working steps, verification and recovery from the observed failure. Prefer parameterized paths and user-provided values over the original task's private data. Omit credentials, account tokens, private screenshots, fabricated command results and external-product tool names. Record prerequisites honestly and name a supported alternative where one exists.

Use a short English name and a precise description saying when the procedure applies. Keep the steps under najd_skill_save's 3000-character limit. Include only detail that changes execution; refer to an existing guide instead of duplicating it. A procedure that has not been run is a draft, not a verified workflow.

Load extensions with najd_tools_load and call najd_skill_save with name, description and steps. NAJD presents the actual procedure for approval; do not claim it was saved before the tool confirms that outcome. Read the saved id with najd_skills_read to confirm it can be retrieved. On later use, check readiness and changed inputs before execution. Update the procedure from demonstrated failures rather than accumulating speculative rules.
