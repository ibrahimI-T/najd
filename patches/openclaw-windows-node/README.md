# Local upstream test adaptation

Baseline: d096d5381c9f6aefdcc5f49ca93bc618eaed9c8b from https://github.com/openclaw/openclaw-windows-node.

The parent gitlink intentionally retains the official public commit. `0001-space-safe-test-fixtures.patch` persists the tested local adaptation without requiring an unpublished submodule commit. The current submodule working tree has this patch applied; its dirty test file is intentional and must not be reset or overwritten.

For a fresh clean baseline, inspect `git status --short`, run `git apply --check --unidiff-zero ../../patches/openclaw-windows-node/0001-space-safe-test-fixtures.patch` inside the submodule, then apply it with `--unidiff-zero`. If the check fails, inspect whether it is already applied (`git apply --reverse --check --unidiff-zero ...`) or conflicts with newer work; do not force application. The zero-context patch avoids treating embedded diff context markers as source whitespace. Retain the upstream MIT LICENSE.

Scope: test-host placement for accepted unquoted command grammar when the checkout path contains spaces, plus bounded executable-handle cleanup retry. No runtime approval, sandbox or command execution behavior changes. Rejected quoted-executable tests remain intact.
