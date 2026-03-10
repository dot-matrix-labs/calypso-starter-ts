# Next Prompt

## Context

Phase 1 (Infrastructure) and Phase 2 (Core UX Layout) are complete. Git hooks are enforced on every commit.

Before adding features, we need a green CI baseline (Phase 2.5). The E2E browser smoke test is failing in CI.

## Root Cause of E2E Failure

See: https://github.com/lucky-tensor/calypso-weekly/actions/runs/22922746003/job/66525213625

Three problems:

1. **`playwright.config.ts` `webServer` is wrong.** It runs `bun run dev` (starts Vite on 5173) but waits on port 31415 (the Bun server). These are two different processes. In production/E2E mode the Bun server at `apps/server/src/index.ts` serves the pre-built `apps/web/dist/` — so the correct E2E approach is: build web first, then start only the Bun server.

2. **`.github/workflows/test-e2e.yml` has no Postgres.** The Bun server calls `await migrate()` on startup, which requires a live Postgres connection. The workflow must add a `postgres:16` service container with `DATABASE_URL` set.

3. **`tests/e2e/app.spec.ts` tests the old journalism scaffold app.** It clicks "Need an account? Register", fills "KaraSwisher" username, calls `/api/auth/register`, checks for "Weekly Recap Draft" heading — none of this exists in the current Calypso UI.

## Task: Fix CI and Establish Test Baseline

### 1. Fix `playwright.config.ts`

Change `webServer` to:

```ts
webServer: {
  command: 'bun run --filter web build && bun apps/server/src/index.ts',
  url: 'http://localhost:31415',
  timeout: 60000,
  reuseExistingServer: !process.env.CI,
},
```

### 2. Fix `.github/workflows/test-e2e.yml`

Add Postgres service and DATABASE_URL:

```yaml
services:
  postgres:
    image: postgres:16
    env:
      POSTGRES_USER: calypso
      POSTGRES_PASSWORD: calypso
      POSTGRES_DB: calypso_test
    ports:
      - 5432:5432
    options: >-
      --health-cmd pg_isready
      --health-interval 10s
      --health-timeout 5s
      --health-retries 5
env:
  DATABASE_URL: postgres://calypso:calypso@localhost:5432/calypso_test
```

### 3. Rewrite `tests/e2e/app.spec.ts`

Replace with a minimal smoke test that:

- Navigates to `http://localhost:31415`
- Verifies the page loads (no crash, HTTP 200)
- Verifies the Calypso layout shell is visible (the resizable panel container rendered by `apps/web/src/App.tsx`)
- Verifies no uncaught JS errors in the browser console

Do NOT test auth or drafts — those are stale. Keep the test small and focused on "does the app render?"

### 4. Check other test suites for staleness

- `apps/web/tests/component/App.test.tsx` — verify it tests the current `App.tsx` (resizable layout), not the old scaffold
- `apps/server/tests/unit/index.test.ts` and `apps/server/tests/integration/api.test.ts` — verify they don't reference old journalism endpoints (`/api/drafts`, SQLite, etc.)

Update any stale tests to match the current codebase.

## Success Criteria

All four CI workflows green on the next PR:

- `test-unit.yml` ✅
- `test-component.yml` ✅
- `test-api.yml` ✅
- `test-e2e.yml` ✅

Only then proceed to Phase 3 (Project Board).

---

## FAILING TESTS — Must be addressed before next push

The following tests were failing at the time of the last push.
They must be **checked, fixed, or rewritten. Never ignore or skip them.**

```

```

For each failure: determine whether the test is wrong (fix the test to match
correct behaviour) or the implementation is wrong (fix the code). Do not
disable, comment out, or add skip/todo markers to avoid addressing failures.
