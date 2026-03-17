# Next Prompt

## Context

Branch: feat/1-hot-or-not-core-crm (GitHub issue #1, draft PR #5)

Commit 1 of the CRM feature has just landed. It includes:

- `packages/core/types.ts`: `Person`, `PersonProperties`, `Relationship`, `RelationshipScore`, `RELATIONSHIP_SCORE_LABELS`, biographical entry types, `UpdateTempo`, and `targetPersonId` on `Task`/`TaskProperties`
- `packages/db/schema.sql`: added `person` and `relationship` entity type seeds
- `apps/server/src/api/persons.ts`: full CRUD for `/api/persons` and `/api/relationships`, bidirectional relationship lookup at `/api/persons/:id/relationships`
- `apps/server/src/index.ts`: wired in `handlePersonsRequest`
- `apps/server/src/api/tasks.ts`: `targetPersonId` support in POST and rowToTask
- `apps/web/src/components/TaskListView.tsx`: pt-BR text, Pessoa Alvo column and modal field
- `apps/web/src/components/PersonForm.tsx`: create-person modal
- `apps/web/src/components/RelationshipView.tsx`: relationship list + create form for a person
- `apps/web/src/components/PersonsView.tsx`: people list + detail panel with biographical sections
- `apps/web/src/App.tsx`: People nav item using `Users` icon
- `apps/web/tests/component/fixture-server.ts`: persons/relationships fixture routes
- `apps/web/tests/component/task-list.test.tsx`: updated for pt-BR text and new Task fields
- `apps/server/tests/integration/persons-api.test.ts`: full integration test suite

## Next Action

Read these files first:

1. `docs/plans/implementation-plan.md` (check remaining unchecked items)
2. This file
3. `apps/web/tests/component/task-list.test.tsx` (current component tests)

Then do:

1. Add component tests for `PersonForm` (renders, creates a person, shows error on failure).
2. Add component tests for `PersonsView` (empty state, renders person list).
3. After the component tests are passing, check whether any acceptance criteria remain unchecked in `docs/plans/implementation-plan.md` and address them.
4. Commit and push.

## FAILING TESTS — Must be addressed before next push

Verify the existing suites still pass after the pt-BR text and type changes:

- `bun --bun vitest run apps/server/tests/integration/api.test.ts`
- `bun --bun vitest run apps/server/tests/integration/task-write-boundary.test.ts`
- `bun --bun vitest run apps/server/tests/integration/persons-api.test.ts`
- `bun --bun vitest run --config apps/web/vitest.browser.config.ts`

The task-list component test text was updated to pt-BR and MOCK_TASK now includes `targetPersonId: null`. If those still fail, fix them before pushing.
