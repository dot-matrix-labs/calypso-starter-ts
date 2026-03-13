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

The Vitest-driven E2E workflow fails because:

1. The previous Playwright runner (`playwright.config.ts`) could not coordinate building the web assets and launching the Bun API server with a PostgreSQL container in the same process.
2. The Bun server calls `await migrate()` on startup, which requires a live Postgres connection — the old workflow did not spawn the container that the API expected.
3. `tests/e2e/full.spec.ts` now exercises the Calypso login, registration, and StudioChat flows through the Vitest harness.

### Fixes Required

- [x] **Fix post-commit and pre-push hooks:** Run `bunx prettier --write docs/plans/next-prompt.md` after appending to avoid blocking the next push.
- [x] **Rebase onto starter/main:** Force-rebased `feat/scaffold` onto `dot-matrix-labs/calypso-starter:main` to establish shared history for PR creation.
- [x] **tsconfig excludes for browser tests:** Both root and `apps/web` tsconfigs exclude `tests/component` so `expect.element()` is never seen by standalone `tsc --noEmit`.
- [x] **Vitest E2E orchestration:** The suite now lives under `tests/e2e/vitest.config.ts` and uses `tests/e2e/environment.ts` to build the frontend, spin up a dockerized Postgres container, and host the Bun API/server process while Playwright drives the browser.
- [x] **Fix `.github/workflows/test-e2e.yml`:** Moved E2E to Vitest-driven execution and removed fixed Postgres service wiring from CI. E2E infrastructure is provisioned by Bun-side Vitest setup. Fixed branch refs (`master` → `main`) in workflow files.
- [x] **E2E console error filter:** Filter out 401/Unauthorized network errors from E2E console error checks — Playwright captures browser-level network failures as console errors; /api/auth/me returning 401 is expected and handled gracefully.
- [x] **Rewrite `tests/e2e/full.spec.ts`:** Combined Calypso login, registration, and StudioChat tests, exercising the real `/studio` endpoints with the Claude CLI fixture.
- [x] **Verify unit and component tests pass:** All three test stubs are clean (no stale journalism references).

## Phase 3: The Project Board (3/4 View)

Implement the core task management interface with the required views.

- [x] **Task Creation & Editing:** `POST /api/tasks` endpoint + New Task modal with name, owner, priority, due date fields.
- [x] **View 1: List View:** `TaskListView` — Asana-style table with status cycling, priority color, due date. Wired into App.tsx. Blueprint-compliant component tests in headless Chromium (Playwright).
- [x] **Blueprint compliance:** Component tests run in headless Chromium via `playwright-component.config.ts`. API integration tests start server + Postgres in CI. `wait-on` added as dev dep.
- [x] **Self-contained integration tests:** Each test suite spins up its own postgres:16 Docker container and server subprocess via `apps/server/tests/helpers/pg-container.ts` (DIY testcontainers). CI workflow simplified — no postgres service, no manual server start needed.
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

## Documentation Review

- [x] Review v3 blueprint docs against prior revisions and add top-of-file editorial recommendations
- [x] Review v3 `implementation-ts` docs against prior revisions and add top-of-file editorial recommendations
- [x] Capture hook-driven formatting normalization and branch-size warnings after the review-note commit
- [x] Reconcile the review-note commit onto the existing remote `docs-workflows-v2-v3-refactors` branch
- [x] Re-review the post-rebase `v3` docs and correct stale review notes where current content is no longer equivalent to `v2`
- [x] Convert repeated v3 review notes into concrete document edits so v3 is materially distinct from v2
- [x] Add first-pass Calypso feature and deployment workflow YAMLs under `agent-context/workflows/`
- [x] Add the Calypso CLI product specification and thread its core concepts back into process/deployment docs
- [x] Add merge-queue role and queue-head merge execution to the feature workflow and Calypso CLI product spec
- [x] Promote the retained v3 GitHub workflow YAMLs into `.github/workflows/` and delete duplicate workflow/archive trees
- [x] Delete the working-only `docs/calypso-cli-product-spec.md` and `docs/plans/implementation-plan-v2.md` artifacts
- [x] Fix CI workflow drift by pointing API tests at the real command and removing the nonexistent migration workflow
- [x] Preserve hook-generated planning notices and formatting normalization after the workflow-spec commit
- [x] Make `calypso-blueprint/` the canonical final v3 doc set and deprecate the v1/v2 versioned predecessors
- [ ] Align the remaining implementation companions to the new workflow YAMLs, task catalog, and deployment gate model

## Documentation and Workflow Refactors [DONE]

- [x] Consolidate the repo so the canonical reference docs live under `calypso-blueprint/` while `.github/workflows/` and `agent-context/workflows/` remain the repo-specific workflow trees.
- [x] Import canonical blueprint docs via the `./calypso-blueprint` git submodule while preserving local `agent-context/workflows/`
- [x] Exclude the imported `./calypso-blueprint` submodule from root Prettier checks so push gates do not lint external vendored content
- [x] Resolve merge conflict with main (calypso-blueprint submodule + next-prompt.md)

## Studio Mode

- [x] `bun run studio` script — proven working end-to-end
- [x] Studio mode server detection via `.studio` file
- [x] `StudioChat.tsx` — chat panel with commit list and rollback
- [x] `POST /studio/chat` endpoint with claude CLI subprocess
- [x] Agent system prompt and `changes.md` maintenance
- [x] Shared `packages/db/pg-container.ts` + test suite + CI job
- [x] Fix: run migrate as subprocess to avoid early db pool initialisation
- [x] Fix: exclude component tests from regular vitest run (vite.config.ts test.exclude)
- [x] Fix: pre-push hook uses bun --bun vitest run instead of bun test
- [x] Resolve pg-container.ts conflict with main (identical code, formatting only)
- [x] Fix E2E test: use getByRole for Studio heading to avoid strict mode violation
- [x] Hardening: require a pre-created `studio/session-*` branch, run migrations against container DB, retry docker port detection, avoid overwriting changes.md, and scope initial commit
- [x] Tests: studio branch parsing + docker port parsing helpers
- [x] Fix: studio runs Vite dev server and proxies `/studio` to the Bun API in dev
- [x] Fix: studio uses dedicated web port via `STUDIO_PORT`, with API expected on `STUDIO_API_PORT`
- [x] Fix: `bun run studio` now fails immediately outside a `studio/session-*` branch instead of creating one
- [x] E2E: studio chat workflow with fixture Claude CLI and server prompt assertion
- [x] Component: StudioChat UI states + send flow coverage
- [x] CI topology: quality gate is a separate workflow from suite test workflows
- [x] Unit: Studio helper parsing, prompt construction, and validation coverage
- [x] Integration: `/studio/status`, `/studio/chat`, `/studio/reset`, and `/studio/rollback` contract coverage
- [x] Integration: `bun run studio` bootstrap coverage on a pre-created `studio/session-*` branch plus failure coverage on `main`
- [x] Integration: successful `/studio/rollback` against a real isolated git checkout
- [x] E2E: multi-turn Studio context, rollback cancel, and rollback success through the browser UI
- [x] Fix: strict null checks for Bun subprocess `stdout`/`stderr` reads in isolated Studio tests and E2E harness
- [x] Fix: component-test fixture state is isolated per StudioChat test namespace so shared fixture resets cannot race across files
- [x] Fix: Studio commit-list resolution no longer assumes a local `main` ref on GitHub PR merge checkouts
- [x] Fix: Studio bootstrap integration test now provisions git identity and a checked-out `main` branch in its disposable clone
- [x] Fix: `scripts/studio-start.ts` now probes `origin/main` / `main` fallback refs without exiting on the first missing ref
- [x] Fix: Studio commit-list E2E uses an isolated checkout with real session commits instead of depending on PR checkout history
- [x] Fix: Studio bootstrap force-adds the ignored `.studio` sentinel so disposable clones can commit session metadata during CI
- [x] Fix: Studio bootstrap integration clone skips `git apply --index` when the working tree already matches `HEAD`, so CI clones do not fail on empty patches
- [x] Fix: Studio component tests reset shared fixture state and run sequentially to avoid browser-mode races around `/studio/status`
