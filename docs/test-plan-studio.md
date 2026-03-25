# Studio Test Plan

This document defines the full browser and integration test strategy for both
the `calypso-studio` standalone repo and the `calypso-starter-ts` host repo.
Tests use **Playwright** for all real-browser assertions. Vitest remains the
runner for unit and integration layers.

---

## Principles

- Every test exercises one behaviour and one outcome.
- Browser tests use real Playwright page sessions, not JSDOM.
- Studio browser tests run against a locally-spawned stub server (no k3s
  required).
- Integration tests stub external processes (Claude CLI, kubectl) via test
  doubles — no real cluster needed.
- E2E tests in `calypso-starter-ts` target the full stack: real server, real
  PostgreSQL (Testcontainers), real browser.

---

## Part 1 — `calypso-studio` standalone repo

### 1a. Playwright setup

Before any browser tests can run, the studio repo needs a Playwright
configuration wired to a lightweight fixture server that replaces the real
studio server.

Files to add:

- `studio/playwright.config.ts` — chromium only, headless, baseURL from env
- `studio/tests/browser/fixtures.ts` — `test` extended with `studioPage`
  fixture that starts a minimal HTTP stub before each test and tears it down
  after
- `studio/tests/browser/stubs/server.ts` — in-process Bun HTTP server that
  handles `/`, `/studio/chat/stream`, `/app/*`, `/api/*`, and
  `/studio/cluster/events`

The stub server serves a pre-built copy of the studio web bundle so the real
React component renders in the browser.

---

### 1b. StudioChat browser tests

Each test navigates to `/` and interacts with the chat UI.

| Test                                             | What it asserts                                                     |
| ------------------------------------------------ | ------------------------------------------------------------------- |
| renders chat input and send button on load       | `[data-testid="chat-input"]` and `[data-testid="send-btn"]` visible |
| typing in the input reflects in the DOM          | input value matches typed string                                    |
| clicking send clears the input                   | input is empty after send                                           |
| send button disabled while response is streaming | button has `disabled` attribute until SSE `done` event              |
| first SSE chunk appended to message list         | first text node contains streamed content                           |
| subsequent chunks appended incrementally         | multiple text nodes accumulate                                      |
| `done` event marks message as complete           | message container loses `streaming` class                           |
| error event displays error state                 | error banner visible with SSE error payload                         |
| pressing Enter sends the message                 | same as clicking send — input cleared                               |
| empty input does not send                        | no SSE request initiated                                            |

---

### 1c. Commit history browser tests

Studio shows recent git commits with rollback affordance.

| Test                                                    | What it asserts                        |
| ------------------------------------------------------- | -------------------------------------- |
| commit list renders after page load                     | at least one commit entry visible      |
| each commit shows hash, message, relative time          | text content matches stub data         |
| rollback button present on each commit                  | `[data-testid="rollback-btn"]` per row |
| clicking rollback fires POST to `/studio/rollback/:sha` | request intercepted via `page.route`   |
| rollback response success shows confirmation toast      | toast visible within 2 s               |
| rollback response error shows error toast               | error toast visible                    |

---

### 1d. Cluster events browser tests

The cluster event panel receives SSE from `/studio/cluster/events`.

| Test                                                   | What it asserts                         |
| ------------------------------------------------------ | --------------------------------------- |
| cluster panel visible on load                          | `[data-testid="cluster-panel"]` present |
| first pod event populates a row                        | pod name appears in the table           |
| pod status `Running` shown with green indicator        | status cell has `.status-running`       |
| pod status `Pending` shown with yellow indicator       | status cell has `.status-pending`       |
| pod status `CrashLoopBackOff` shown with red indicator | status cell has `.status-error`         |
| new event appended without full re-render              | existing rows remain, new row added     |
| restart count increments when pod restarts             | restart counter cell updates            |
| SSE connection loss shows disconnected banner          | banner with "reconnecting" text         |

---

### 1e. Studio server SSE integration tests (Vitest, no browser)

These hit the real studio server HTTP layer with a mock Claude CLI subprocess.

| Test                                                    | What it asserts                                |
| ------------------------------------------------------- | ---------------------------------------------- |
| `GET /studio/chat/stream?message=hello` opens SSE       | response has `Content-Type: text/event-stream` |
| Claude stdout chunks arrive as `data:` events           | each line emitted within 100 ms                |
| Claude exit 0 emits `event: done`                       | done event received after stdout closes        |
| Claude exit 1 emits `event: error` with stderr          | error event payload contains stderr text       |
| concurrent requests each get isolated SSE streams       | two simultaneous requests both receive data    |
| request aborted mid-stream terminates Claude subprocess | `ProcessManager` list shrinks                  |

---

### 1f. Studio server routing integration tests (Vitest)

| Test                                                 | What it asserts                    |
| ---------------------------------------------------- | ---------------------------------- |
| `GET /app/dashboard` proxies to upstream web service | upstream receives `GET /dashboard` |
| `/app` prefix stripped before forwarding             | upstream path has no `/app` prefix |
| `GET /api/tasks` proxied to API service              | upstream receives `GET /tasks`     |
| upstream returns 404 → studio returns 404            | response status preserved          |
| `GET /` serves `index.html` from assets dir          | 200 with `text/html`               |
| unknown path falls through to `index.html`           | SPA routing preserved              |
| upstream connection refused → 502                    | studio returns 502 Bad Gateway     |

---

### 1g. Hot-swap integration tests (Vitest, stub kubectl/bun)

Stub `bun build` and `kubectl delete pod` via child-process interception.

| Test                                                         | What it asserts                     |
| ------------------------------------------------------------ | ----------------------------------- |
| changed file in `apps/server/` maps to `api` service         | build invoked for api               |
| changed file in `apps/web/` maps to `web` service            | build invoked for web               |
| changed file in `packages/` maps to all services             | build invoked for api, web, worker  |
| build failure aborts pod cycling                             | kubectl not called                  |
| pod cycling calls `kubectl delete pod` for each affected pod | correct pod names in args           |
| pod delete failure logs error but does not throw             | hot-swap resolves without rejection |
| migration file change skips pod cycling                      | kubectl not called, warning logged  |

---

### 1h. ProcessManager unit tests (Vitest)

| Test                                  | What it asserts                    |
| ------------------------------------- | ---------------------------------- |
| SIGTERM sent to tracked process       | process receives signal            |
| process exits within 5 s → no SIGKILL | SIGKILL not sent                   |
| process hangs past 5 s → SIGKILL sent | SIGKILL sent after timeout         |
| multiple processes all terminated     | all pids removed from tracked list |
| shutdown idempotent on second call    | no errors on double shutdown       |

---

### 1i. Studio startup sequence integration tests (Vitest)

Stub `kubectl apply`, `bun build`, and the health-wait loop.

| Test                                          | What it asserts                    |
| --------------------------------------------- | ---------------------------------- |
| prerequisites pass → proceeds to build        | build step invoked                 |
| missing `bun` → exits with error              | error message references `bun`     |
| missing `kubectl` → exits with error          | error message references `kubectl` |
| build fails → does not apply kustomize        | kubectl apply not called           |
| kustomize apply fails → exits with non-zero   | process exits 1                    |
| deployments become healthy → banner printed   | stdout includes `Studio Mode`      |
| health wait exceeds 120 s → timeout error     | timeout message in stderr          |
| `STUDIO_OPEN_BROWSER=1` opens browser command | open/xdg-open called               |

---

## Part 2 — `calypso-starter-ts` host repo

### 2a. Studio proxy E2E browser tests (Playwright)

Full stack: studio server + real app server + PostgreSQL + Playwright.
Studio server runs in-process using its HTTP layer; the real app server handles
`/api/*` traffic.

| Test                                                       | What it asserts                 |
| ---------------------------------------------------------- | ------------------------------- |
| `GET http://localhost:7000/` returns studio UI             | page title matches              |
| `/app/` loads the main React app through the proxy         | app shell visible               |
| `/api/healthz` via studio proxy returns 200                | status 200 with JSON body       |
| auth flow works end-to-end through studio proxy            | login succeeds, dashboard loads |
| task creation via `/api/tasks` through proxy persists      | GET returns created task        |
| WebSocket `/ws` through studio proxy delivers task updates | WS message received             |

---

### 2b. Authentication E2E browser tests (Playwright)

| Test                                                          | What it asserts                    |
| ------------------------------------------------------------- | ---------------------------------- |
| register with email/password → redirect to dashboard          | dashboard URL                      |
| register with duplicate email → error message                 | error banner with "already exists" |
| login with correct credentials → JWT cookie set               | cookie present                     |
| login with wrong password → error message                     | error banner with "invalid"        |
| logout → cookie cleared → redirect to login                   | login page                         |
| accessing protected route unauthenticated → redirect to login | login URL                          |
| CSRF token present on all mutation requests                   | request header `X-CSRF-Token`      |
| session expires → next request redirects to login             | login page                         |
| API key authentication → 200 on protected endpoint            | status 200                         |

---

### 2c. Task management E2E browser tests (Playwright)

| Test                                                     | What it asserts              |
| -------------------------------------------------------- | ---------------------------- |
| create task with title and description → appears in list | task title in list           |
| create task with empty title → validation error          | error message visible        |
| click task → detail view opens                           | task title in detail header  |
| edit task title → saved → reflected in list              | updated title in list        |
| delete task → removed from list                          | task no longer in DOM        |
| task status updated by worker → list reflects status     | status badge changes         |
| WebSocket message delivers real-time status update       | badge updates without reload |
| pagination works when more than page-size tasks exist    | second page loads            |

---

### 2d. Passkey (WebAuthn) browser tests (Playwright)

Uses Playwright's WebAuthn virtual authenticator API.

| Test                                                | What it asserts                          |
| --------------------------------------------------- | ---------------------------------------- |
| passkey registration flow completes                 | credential stored, redirect to dashboard |
| passkey authentication flow completes               | JWT cookie set                           |
| passkey with unrecognised credential → error        | error banner                             |
| passkey UI fallback shown when WebAuthn unavailable | password fallback visible                |

---

### 2e. PWA browser tests (Playwright, multi-device)

Devices: Desktop Chrome, Pixel 7 (Android), iPhone 14 (iOS).

| Test                                              | What it asserts                          |
| ------------------------------------------------- | ---------------------------------------- |
| install prompt visible on supported browser       | install button present                   |
| service worker registered                         | `navigator.serviceWorker.ready` resolves |
| app loads offline after first visit               | page visible with no network             |
| push notification permission prompt shown         | browser permission dialog (fake UA)      |
| camera permission prompt shown on camera feature  | `getUserMedia` called                    |
| microphone permission prompt shown on mic feature | `getUserMedia` called                    |
| PWA manifest linked in `<head>`                   | `<link rel="manifest">` present          |
| theme-color meta matches design token             | meta content value                       |

---

### 2f. Audit log integration tests (Vitest)

| Test                                         | What it asserts                        |
| -------------------------------------------- | -------------------------------------- |
| task creation generates audit entry          | audit DB row with `action=create`      |
| task update generates audit entry            | audit DB row with `action=update`      |
| task deletion generates audit entry          | audit DB row with `action=delete`      |
| login generates audit entry                  | audit DB row with `action=auth.login`  |
| logout generates audit entry                 | audit DB row with `action=auth.logout` |
| audit log endpoint returns entries paginated | 200 with array and cursor              |

---

### 2g. Data governance integration tests (Vitest)

| Test                                       | What it asserts              |
| ------------------------------------------ | ---------------------------- |
| task older than retention window flagged   | task status set to `expired` |
| PII fields scrubbed after retention period | scrubbed fields null in DB   |
| stale worker claim recovered after timeout | task re-queued               |
| recovered task claimable by new worker     | second worker receives task  |

---

## Test execution matrix

| Suite                                           | Runner     | Where       | Real browser | Real DB  | Real cluster     |
| ----------------------------------------------- | ---------- | ----------- | ------------ | -------- | ---------------- |
| Studio unit                                     | Vitest     | studio repo | No           | No       | No               |
| Studio integration (server, routing, hot-swap)  | Vitest     | studio repo | No           | No       | No (stubs)       |
| Studio browser (chat, commits, cluster panel)   | Playwright | studio repo | Yes          | No       | No (stub server) |
| Starter-ts unit                                 | Vitest     | host repo   | No           | No       | No               |
| Starter-ts integration (audit, data governance) | Vitest     | host repo   | No           | Yes (TC) | No               |
| Starter-ts proxy E2E                            | Playwright | host repo   | Yes          | Yes (TC) | No (in-process)  |
| Starter-ts auth E2E                             | Playwright | host repo   | Yes          | Yes (TC) | No               |
| Starter-ts task E2E                             | Playwright | host repo   | Yes          | Yes (TC) | No               |
| Starter-ts passkey                              | Playwright | host repo   | Yes          | Yes (TC) | No               |
| Starter-ts PWA                                  | Playwright | host repo   | Yes          | Yes (TC) | No               |

TC = Testcontainers (Docker PostgreSQL)

---

## Issues to create

Each issue below maps to one work unit in the Plan.

1. **[studio] Playwright config, fixture server, and StudioChat browser tests**
   — Sets up Playwright in the studio repo with a stub server fixture; adds all
   StudioChat tests (1a + 1b).

2. **[studio] Commit history and cluster-events browser tests**
   — Adds rollback UI and cluster events panel browser tests (1c + 1d).

3. **[studio] SSE, routing, and hot-swap integration tests**
   — Vitest integration layer: SSE streaming, proxy routing, hot-swap engine,
   ProcessManager, startup sequence (1e–1i).

4. **[starter-ts] Studio proxy E2E browser tests**
   — Full-stack Playwright tests routed through the studio server proxy (2a).

5. **[starter-ts] Auth, passkey, and session E2E browser tests**
   — Authentication and WebAuthn flows in real browser (2b + 2d).

6. **[starter-ts] Task management E2E browser tests**
   — CRUD, WebSocket updates, pagination in real browser (2c).

7. **[starter-ts] PWA Playwright tests (multi-device)**
   — Install, offline, permissions, manifest across three device profiles (2e).

8. **[starter-ts] Audit log and data governance integration tests**
   — Vitest integration tests for audit DB entries and data retention (2f + 2g).
