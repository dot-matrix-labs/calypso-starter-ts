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

- [ ] **Fix `playwright.config.ts` webServer:** Change command to build the web app then start the Bun server: `bun run --filter web build && bun run apps/server/src/index.ts`. Set `url` (not `port`) to `http://localhost:31415` and set `timeout` to 30000.
- [ ] **Fix `.github/workflows/test-e2e.yml`:** Add a Postgres service container (`postgres:16`) with `DATABASE_URL` env var. Add a `bun run --filter web build` step before running Playwright.
- [ ] **Rewrite `tests/e2e/app.spec.ts`:** Replace the old journalism test with a sanity smoke test for the current Calypso UI — verify the app loads, the 3/4 + 1/4 resizable layout is visible, and no console errors appear.
- [ ] **Verify unit and component tests pass:** Check `tests/unit/` and `apps/web/tests/` for any stale references to the old scaffold app and update them.

## Phase 3: The Project Board (3/4 View)

Implement the core task management interface with the required views.

- [ ] **Task Creation & Editing:** Forms/modals to create tasks with the required semantic fields.
- [ ] **View 1: List View:** Asana-style data table with inline editing and checkboxes.
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
