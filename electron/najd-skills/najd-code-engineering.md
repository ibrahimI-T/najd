---
name: najd-code-engineering
description: Implement, debug, review and test changes in an existing code repository using focused reads, exact edits and real command results. Use for software engineering rather than ordinary document writing.
---

# Complete an engineering change

Load files and terminal with najd_tools_load. Find the real repository and its instructions; inspect Git status before editing. Search symbols and callers with najd_files_search or najd_toolbox, then read only the relevant ranges. Preserve unrelated edits and existing architecture. Establish the project's actual test/build commands from its manifests; do not assume every repository uses npm.

For a defect, reproduce the reported path, identify the failing boundary and test one explanation at a time. Record whether a failure existed before the change. Fix the cause with a small complete change through najd_files_edit or najd_files_write. Avoid replacing the project or adding a dependency when its existing stack suffices.

Use najd_terminal_run for short commands. Load process for longer builds, installations or servers; run najd_process_start and read najd_process_output until a terminal state. A running process is not a successful test. Inspect nonzero exits and fix issues introduced by the change. Do not weaken assertions to get a green result.

Verify behavior at the changed boundary: a regression test for logic, a production build for integration, and a rendered preview for visual changes when supported. Reuse successful checks until new code or evidence requires rerunning them. Inspect the final diff for accidental edits, secrets and missing files. Do not commit unrelated work or publish without task authority.

Report the implemented behavior and exact checks with results. Distinguish mock/provider fixtures from a real selected-model test. If a check fails, retain its error and narrow the claim; never claim the whole product passed from one path.
