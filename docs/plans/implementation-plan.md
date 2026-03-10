# MVP Implementation Plan: Calypso Project Management & Chat

## Goal Description

Rewrite the existing scaffold application into Calypso, a hybrid project management and chat application emphasizing a graceful, high-performance UX, while preserving the strong existing infrastructure (tests, UI foundations, deployment). The system relies on Postgres (over SQLite), deployable via Kubernetes, and features a one-way READ-ONLY sync from public GitHub repositories for issue tracking.

## Phase 1: Infrastructure & Data Model Updates [DONE]

Update the current scaffold stack to align with the enterprise Blueprint requirements for Calypso.

- [x] **Database Migration:** Transition the existing schema and ORM configurations from SQLite to PostgreSQL. Update connection handlers and environment variables.
- [x] **Data Modeling:**
  - `Tasks`: Includes Semantic fields (`Name`, `Description`, `Owner`, `Priority`, `Estimate Start`, `Estimated Deliver`, `Depends On`).
  - `Tags/Taxonomy`: Key-value pairs for organization options and arbitrary tags.
  - `GitHubLink`: To store references between Calypso tasks and mirrored GitHub issues.
  - `ChatMessages`/`Channels`: To support the 1/4 chat pane features.
- [x] **Deployment:** Preliminary Postgres setup.

## Phase 2: Core UX Layout & Foundation [DONE]

Implement the core UI shell according to the PRD's 3/4 and 1/4 split requirement.

- [x] **Fluid Layout Shell:** Build the resizable/collapsible layout with the Project Board taking up the left 75% of the viewport and the Chat context taking up the right 25%.
- [x] **Contextual Presence Navigation:** Implement the foundational state management so that selecting a user avatar or chat context can drive the routing/view state of the main Project Board.
- [x] **Cleanup:** Remove legacy/unrelated scaffold application code.

## Phase 2.5: Test Baseline & CI Green [NEXT]

Establish a green CI baseline before adding features. All four CI workflows must pass on every PR.

### Root Cause Analysis

The E2E workflow fails because:

1. `webServer.command` in `playwright.config.ts` is `bun run dev`, which starts a Vite dev server on port 5173 — but the config waits on port 31415 (the Bun server port), so Playwright times out.
2. The Bun server calls `await migrate()` on startup, which requires a live Postgres connection — not provided in the E2E CI workflow.
3. The E2E test (`tests/e2e/app.spec.ts`) tests the old journalism scaffold app (registration, drafts, SQLite) — incompatible with the current Calypso UI.

### Fixes Required

- [x] **Fix post-commit and pre-push hooks:** Run `bunx prettier --write docs/plans/next-prompt.md` after appending to avoid blocking the next push.
- [x] **Rebase onto starter/main:** Force-rebased `feat/scaffold` onto `dot-matrix-labs/calypso-starter:main` to establish shared history for PR creation.
- [x] **tsconfig excludes for browser tests:** Both root and `apps/web` tsconfigs exclude `tests/component` so `expect.element()` is never seen by standalone `tsc --noEmit`.
- [x] **Playwright CI install:** Use `bunx playwright install --with-deps chromium` (not `install-deps && install`) in both E2E and component workflows to avoid downloading all browser deps.
- [x] **Fix `playwright.config.ts` webServer:** Changed command to `bun run --filter web build && bun run apps/server/src/index.ts`. Uses `url:` (not `port:`) with 60s timeout.
- [x] **Fix `.github/workflows/test-e2e.yml`:** Added `postgres:16` service with `DATABASE_URL`. Fixed branch refs (`master` → `main`) in all four workflow files.
- [x] **E2E console error filter:** Filter out 401/Unauthorized network errors from E2E console error checks — Playwright captures browser-level network failures as console errors; /api/auth/me returning 401 is expected and handled gracefully.
- [x] **Rewrite `tests/e2e/app.spec.ts`:** Two smoke tests — (1) login screen renders, (2) register → Calypso layout shell visible (Main Project + Team Chat). Selectors match actual Login.tsx markup.
- [x] **Verify unit and component tests pass:** All three test stubs are clean (no stale journalism references).

## Phase 3: The Project Board (3/4 View)

Implement the core task management interface with the required views.

- [x] **Task Creation & Editing:** `POST /api/tasks` endpoint + New Task modal with name, owner, priority, due date fields.
- [x] **View 1: List View:** `TaskListView` — Asana-style table with status cycling, priority color, due date. Wired into App.tsx. Blueprint-compliant component tests in headless Chromium (Playwright).
- [x] **Blueprint compliance:** Component tests run in headless Chromium via `playwright-component.config.ts`. API integration tests start server + Postgres in CI. `wait-on` added as dev dep.
- [x] **`apps/web/tsconfig.json`:** Scoped to `src/` and `tests/` with DOM lib — prevents web build from picking up Bun-typed server files.
- [x] **Vitest runtime:** All `bunx vitest` replaced with `bun --bun vitest` so workers run in Bun runtime. Note: Vitest's Vite transform pipeline still intercepts `import.meta.dir` — integration tests must not call `migrate()` directly; the running server handles it on startup.
- [x] **Server static path:** Use `import.meta.dir` for the web/dist path in `apps/server/src/index.ts` so it resolves correctly regardless of cwd (fixes E2E/component webServer startup).
- [x] **Component tests:** Migrate from standalone Playwright config to Vitest Browser Mode (`@vitest/browser` + `playwright` provider + `vitest-browser-react`) for proper React component testing in Chromium. Config: `apps/web/vitest.browser.config.ts`. CI: `test-component.yml` runs `bun --bun vitest run --config apps/web/vitest.browser.config.ts` (no server or Postgres needed). Root `tsconfig.json` excludes `apps/web/tests/component` — no custom `.d.ts` needed.
- [ ] **View 2: Kanban View:** GitHub Projects-style drag-and-drop board based on customizable status columns.
- [ ] **View 3: Gantt Waterfall:** Timeline view visualizing tasks based on `Estimate Start`, `Estimated Deliver`, and `Depends On` relationships.

## Phase 4: The Chat Window (1/4 View)

Implement real-time collaboration features.

- [ ] **Real-Time Infrastructure:** Hook into the existing WebSocket/real-time service (e.g., Supabase/Socket.io) to power live updates.
- [ ] **Chat Interface:** Build the direct messaging and group channel UI in the right pane.
- [ ] **Online Presence:** Show live indicators for active team members.
- [ ] **Slash Commands:** Basic parsing for utility commands (e.g., `/assign`).

## Phase 5: GitHub Integration (Read-Only, Public Repos)

Implement the one-way synchronization for public issue tracking.

- [ ] **GitHub API Service:** Build the server-side service to poll or receive webhooks from designated public GitHub repositories.
- [ ] **Issue Mirroring:** When a new issue is detected, translate it into the Calypso `Task` schema and insert it into the database as a read-only item.
- [ ] **State Updates:** Listen for "Issue Closed" events from GitHub to update the corresponding Calypso task status automatically.
