# Next Prompt

## Context

Root `tsconfig.json` excludes `apps/web/tests/component` so `expect.element()` (a Vitest Browser Mode
API) is only type-checked by the web-specific tsconfig, which runs in the vitest browser context.

Component tests now use Vitest Browser Mode (`@vitest/browser` + playwright provider +
`vitest-browser-react`). All 4 component tests pass in headless Chromium. No server or Postgres
needed for component tests.

- Config: `apps/web/vitest.browser.config.ts`
- Tests: `apps/web/tests/component/task-list.test.tsx`
- CI: `test-component.yml` runs `bun --bun vitest run --config apps/web/vitest.browser.config.ts`
- Old `playwright-component.config.ts` deleted

## Next Task — Phase 3: Kanban View

Add a second view mode to the project board: a Kanban board with status columns.

### 1. Add view toggle to App.tsx

In the board header, add a segmented control (List / Kanban) that switches between
`<TaskListView />` and `<KanbanView />`. Store as `boardView: 'list' | 'kanban'` state.

### 2. Build `apps/web/src/components/KanbanView.tsx`

Three columns: **Todo**, **In Progress**, **Done** — each showing tasks filtered by status.

Each task card shows: name, owner, priority badge, due date.

Clicking a card's status badge cycles it (same `PATCH /api/tasks/:id` call as the list view).

No drag-and-drop yet — clicking the status badge moves the card to the next column.

### 3. Component tests

Add `apps/web/tests/component/kanban.test.tsx` using `vitest-browser-react` + mocked fetch:

- Kanban renders three column headers (Todo, In Progress, Done)
- Task with status "todo" appears in the Todo column
- Cycling status moves the card to In Progress column

### Constraints

TypeScript only. Bun for all scripts. No mocks in implementation code. No forbidden packages.
