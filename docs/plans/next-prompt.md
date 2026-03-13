# Next Prompt

## Context

The repo now sources the canonical blueprint docs from the `./calypso-blueprint`
git submodule while `.github/workflows/` and `agent-context/workflows/` remain
localized workflow trees. CI workflow drift has already been corrected, and
the flaky StudioChat component test no longer depends on one shared
fixture-state reset across files.

The remaining next priority is the failing Studio API integration suite
reported by the push hooks.

## Next Action

Read these files first:

1. `apps/server/tests/integration/studio-api.test.ts`
2. `apps/server/src/api/studio.ts`
3. `apps/server/src/studio/agent.ts`
4. `docs/plans/implementation-plan.md`
5. this file

Then do this next:

1. Reproduce the failing Studio API integration tests.
2. Determine whether each failure is in the tests or the implementation.
3. Fix them without weakening coverage.
4. After the Studio API suite is green, reconcile the remaining implementation companions to the current workflow YAMLs and release-gate model.

After editing, update `docs/plans/implementation-plan.md` and overwrite this file with the next self-contained prompt.
