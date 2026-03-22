# Next Prompt

## Context

The `docs/pwa-platform-limitations.md` reference document has been added and
linked from `docs/README.md`. The pre-push hook has been fixed to unset git
environment variables (GIT_DIR, GIT_WORK_TREE, etc.) before running the test
suite, so studio integration tests no longer fail when git invokes the hook
during `git push`.

## Next Action

Read these files first:

1. `docs/plans/implementation-plan.md`
2. this file

Then do this:

1. Review the remaining unchecked items in the Documentation Review section of
   `implementation-plan.md`.
2. Align any remaining implementation companions to the current workflow YAMLs
   and release-gate model.
3. After editing, update `docs/plans/implementation-plan.md` and overwrite this
   file with the next self-contained prompt.
