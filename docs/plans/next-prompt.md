# Next Prompt

## Context

The git hooks have been refactored: the planning-docs gate (requiring
`implementation-plan.md` and `next-prompt.md` at every commit) has been
removed from `pre-commit`. Test failures are now blocking in `pre-push`
instead of advisory. The `dev` script now routes through
`scripts/dev-start.ts`, which spins up an ephemeral Postgres container,
runs migrations, then starts the API server and Vite in middleware mode as
a single HTTP entry point.

There are known failing Studio API integration tests from the prior push.

## Next Action

Read these files first:

1. `apps/server/tests/integration/studio-api.test.ts`
2. `apps/server/src/api/studio.ts`
3. `apps/server/src/studio/agent.ts`
4. `docs/plans/implementation-plan.md`
5. this file

Then do this:

1. Reproduce the failing Studio API integration tests.
2. Determine whether each failure is in the tests or the implementation.
3. Fix them without weakening coverage.
4. After the Studio API suite is green, align the remaining implementation
   companions to the current workflow YAMLs and release-gate model.

After editing, update `docs/plans/implementation-plan.md` and overwrite this
file with the next self-contained prompt.
