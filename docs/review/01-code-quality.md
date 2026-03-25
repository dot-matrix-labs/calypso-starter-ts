# Code Quality Report

**Date:** 2026-03-23
**Scope:** Full codebase as of latest main branch
**Analyst:** Claude Code (claude-sonnet-4-6)

---

## 1. Executive Summary

The codebase is in a healthy early-stage condition. It has a clear monorepo structure, meaningful test coverage through integration tests using real Postgres containers, and consistent use of validation schemas. However, several quality issues warrant attention before production hardening:

- **Two overlapping task-queue API handlers** serve the same domain with divergent routing conventions and different auth models — this is the most structurally significant finding.
- **Duplicated JSON helper, CORS, and rate-limit patterns** appear across multiple route handlers without abstraction.
- **Multiple stub/not-implemented functions** in `data-governance.ts` will throw at runtime if called.
- **Auth cookie settings** use `SameSite=Lax` instead of `SameSite=Strict` in violation of the blueprint and inline comments acknowledging the gap.
- **No authorization check on `DELETE /api/users/:id`** — any authenticated user can delete any other user.
- **Studio routes carry no authentication guard** — any unauthenticated caller can POST to `/studio/chat` and trigger `claude --dangerously-skip-permissions`.

---

## 2. Duplicated Logic

### 2.1 Two Task-Queue API Handlers

The single most significant duplication in the codebase is the coexistence of two separate API files that both serve the task-queue domain:

| File                                 | Route prefix                                                                                                             | Auth model             | Purpose                               |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ | ---------------------- | ------------------------------------- |
| `apps/server/src/api/task-queue.ts`  | `POST /api/tasks/:id/result`                                                                                             | Bearer delegated token | Worker result submission only         |
| `apps/server/src/api/tasks-queue.ts` | `POST /api/tasks-queue`, `POST /api/tasks-queue/claim`, `PATCH /api/tasks-queue/:id`, `POST /api/tasks-queue/:id/result` | Session cookie         | Full queue CRUD for human/API clients |

Both files are wired into `index.ts` (lines 15–19, 156–165). The `/api/tasks/:id/result` route in `task-queue.ts` handles delegated-token worker submissions; the `/api/tasks-queue/:id/result` route in `tasks-queue.ts` handles session-cookie-authenticated result submissions. This creates two result submission paths for the same resource with different auth models and different URL prefixes, causing confusion about which route workers should use.

The route collision is particularly subtle: `index.ts:153` matches `/api/tasks` first, then checks `task-queue.ts` before `tasks.ts` on every request to `/api/tasks/*`. The handler in `tasks-queue.ts` is unreachable from the `/api/tasks/*` prefix because that block stops at the result route in `task-queue.ts`.

**References:**

- `apps/server/src/index.ts:15` — imports both handlers
- `apps/server/src/index.ts:153–165` — wires both under overlapping prefixes
- `apps/server/src/api/task-queue.ts:1–92` — delegated-token result handler
- `apps/server/src/api/tasks-queue.ts:1–203` — full queue CRUD handler

### 2.2 JSON Response Helper — Repeated Pattern

Every route handler constructs the same inline `json()` helper:

```ts
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
```

This identical 4-line block appears verbatim in:

- `apps/server/src/api/task-queue.ts:35–39`
- `apps/server/src/api/tasks-queue.ts:37–41`
- `apps/server/src/api/tasks.ts:43–47`
- `apps/server/src/api/audit.ts:38–42`
- `apps/server/src/api/admin.ts:33–37`
- `apps/server/src/api/users.ts:28–32`
- `apps/server/src/api/studio.ts:32–36`

Seven instances of identical copy-paste. A shared utility would eliminate this.

### 2.3 CORS Header Helper — Near-Duplicate

`getCorsHeaders(req)` is defined once in `apps/server/src/api/auth.ts:86–93` and imported broadly. However, `apps/server/src/api/passkey.ts` defines its own local `json()` helper at line 318–322 that does not use the shared helper at all, requiring callers to pass `headers` explicitly. This is an inconsistent pattern compared to every other handler.

### 2.4 `isSuperuser()` Function Duplicated

The same function body appears in two unrelated files:

```ts
function isSuperuser(userId: string): boolean {
  const superuserId = process.env.SUPERUSER_ID;
  if (!superuserId) return false;
  return userId === superuserId;
}
```

- `apps/server/src/api/admin.ts:17–21`
- `apps/server/src/api/audit.ts:22–26`

### 2.5 `readProcStdout` Duplicated Across Studio and Worker

```ts
async function readProcStdout(stdout: number | ReadableStream<Uint8Array> | undefined) {
  if (!stdout || typeof stdout === 'number') return '';
  return new Response(stdout).text();
}
```

- `apps/server/src/studio/agent.ts:8–10`
- `apps/server/src/studio/git.ts:3–6`

### 2.6 `DEFAULT_GENESIS_HASH` Literal Duplicated

The 64-zero string genesis hash is repeated:

- `apps/server/src/api/audit.ts:16`
- `apps/server/src/policies/audit-service.ts:17`

---

## 3. Inefficiencies

### 3.1 AJV Schema Compiled on Every Request

`apps/server/src/api/validation.ts:21–22` calls `ajv.compile(schema)` on each invocation of `validate()`. AJV compilation is expensive and the result should be cached per schema object.

```ts
export function validate<T>(schema: object, data: unknown): ValidationResult<T> {
  const validateFn = ajv.compile(schema);  // compiled fresh on every call
```

### 3.2 `POST /api/tasks` — Missing CSRF Bypass Before Validation

`apps/server/src/api/tasks.ts:52–55` applies `verifyCsrf` for **all methods** including GET:

```ts
const csrfError = verifyCsrf(req, cookies);
if (csrfError) return csrfError;
```

`verifyCsrf` itself is safe-method-aware (`SAFE_METHODS.has(req.method)` returns null for GET), but the cost of an unconditional call adds unnecessary overhead on every read request. More importantly, the CSRF check runs even for unauthenticated requests because it is placed before the `getAuthenticatedUser` guard in the GET path (line 50 checks auth, but the CSRF check at line 54 runs on all paths regardless).

Wait — actually authentication IS checked first at line 50, and the function returns early if not authenticated. However, the order is: auth check → CSRF check → route matching. For GET requests, CSRF returns null immediately, but this is still a no-op cost.

### 3.3 `audit.ts` Loads All Audit Rows Into Memory

`apps/server/src/api/audit.ts:63–67` fetches the entire `audit_events` table with no pagination:

```ts
const rows = await auditSql<AuditRow[]>`
  SELECT id, actor_id, action, ...
  FROM audit_events
  ORDER BY ts ASC, id ASC
`;
```

As the audit log grows (it is append-only), this query will load unbounded data. At 1 million rows this becomes a production availability issue.

### 3.4 WebSocket Client Set — No Authentication After Upgrade

`apps/server/src/websocket.ts` stores all connected clients in a module-level `Set<ServerWebSocket<unknown>>`. Authentication is checked before upgrade in `index.ts:116–127`, but the `open` handler at `websocket.ts:22` does not re-validate the session. If a session is revoked after connection, the WebSocket remains open indefinitely.

### 3.5 Studio Agent — Blocking `proc.exited` With No Timeout

`apps/server/src/studio/agent.ts:29` awaits `proc.exited` after reading stdout:

```ts
const output = await readProcStdout(proc.stdout);
await proc.exited;
```

If the `claude` subprocess hangs, this await has no timeout, blocking the request handler indefinitely. A similar issue exists in `apps/server/src/studio/git.ts:17–19`.

### 3.6 Rate Limiter — In-Memory State Lost on Restart

`apps/server/src/security/rate-limiter.ts` stores all state in a `Map` in process memory. A container restart or HPA scale event resets all windows. For a production deployment with multiple replicas, each replica has independent state — a client can spray requests across replicas and evade per-IP limits.

### 3.7 Worker `claimNextTask` Uses App DB Pool, Not Agent Pool

In `apps/worker/src/runner.ts:132–135`, `claimNextTask` is imported from `db/task-queue` which uses the shared `sql` pool from `packages/db/index.ts`. However, the runner also creates a separate `db = createAgentPool(agentDatabaseUrl)` at line 187. The `claimNextTask` call uses the shared pool (which reads `DATABASE_URL`), not the agent pool (`AGENT_DATABASE_URL`). If `DATABASE_URL` is not set in the worker container (it is only set for the entrypoint provisioning step), the claim call will fail or use the wrong credentials.

---

## 4. Incomplete Implementations

### 4.1 `data-governance.ts` — All Functions Throw

`apps/server/src/policies/data-governance.ts` exports five functions, all of which throw `Error('Not implemented: ...')`:

```ts
export async function appendConsequentialWrite(...) {
  throw new Error('Not implemented: ...');  // line 19
}
export async function writeAuditEvent(...) {
  throw new Error('Not implemented: ...');  // line 24
}
export async function createDigitalTwin(...) {
  throw new Error('Not implemented: ...');  // line 29
}
export async function destroyDigitalTwin(...) {
  throw new Error('Not implemented: ...');  // line 33
}
export async function simulateInDigitalTwin(...) {
  throw new Error('Not implemented: ...');  // line 38
}
```

These are boundary stubs, but if any call path exercises them, the server will crash at runtime.

### 4.2 Auth Cookie `SameSite=Lax` Instead of `Strict`

The blueprint requires `SameSite=Strict` (AUTH-P-002). The actual cookie setting is `SameSite=Lax` in four places:

- `apps/server/src/api/auth.ts:209` — register response
- `apps/server/src/api/auth.ts:307` — login response
- `apps/server/src/api/passkey.ts:305` — passkey login complete

The inline comment at `auth.ts:204–206` acknowledges this gap: "Starter cookie settings are intentionally minimal. The blueprint target is HTTP-only secure cookies with stricter session controls."

### 4.3 Studio Routes — No Authentication

`apps/server/src/api/studio.ts:26` receives all `/studio/*` requests without any authentication check. Any unauthenticated request to `POST /studio/chat` will invoke `claude --dangerously-skip-permissions` as a subprocess with the repo as the working directory. This is a significant security gap for any internet-accessible deployment.

### 4.4 `DELETE /api/users/:id` — No Authorization Check

`apps/server/src/api/users.ts:35–75` checks that the caller is authenticated (line 36–37) but does not verify that the caller is authorized to delete the target. The comment at line 11–12 explicitly acknowledges this: "The endpoint does not currently enforce that only superusers may delete other users — that authorization layer is future work."

### 4.5 Task Write Service — Missing Row-Not-Found Error Path

`apps/server/src/policies/task-write-service.ts:61–67` performs an `UPDATE ... RETURNING` but destructures the first element without checking if the array is empty:

```ts
const [row] = await sql<...[]>`
  UPDATE entities SET ... WHERE id = ${request.payload.taskId} AND type = 'task'
  RETURNING id, properties, created_at
`;
return row;  // row could be undefined if the task was deleted concurrently
```

If a task is deleted between the PATCH request's existence check and the write, `row` will be `undefined` and the caller will receive an `undefined` response that it tries to pass to `rowToTask()`.

### 4.6 `task-queue.ts` Result Handler — No Status Transition Validation

`apps/server/src/api/task-queue.ts:82–90` sets status to `completed` unconditionally:

```ts
await sql`
  UPDATE task_queue
  SET status = 'completed', result = ..., updated_at = NOW()
  WHERE id = ${taskId}
`;
```

There is no check that the task's current status is `running` or `submitting`. A result can be submitted to a `pending`, `dead`, or already-`completed` task. The state machine defined in TQ-D-002 is enforced in `tasks-queue.ts` but not in `task-queue.ts`.

### 4.7 `pwa-demo.tsx` — Placeholder Content

`apps/web/src/pages/pwa-demo.tsx:57` contains a placeholder comment `"Demo cards loading — check back as features are implemented."` The individual demo cards (camera, mic, notifications, storage, install prompt, platform matrix) are implemented in separate files under `apps/web/src/components/pwa/` but are not imported into `pwa-demo.tsx`. The page shows only the placeholder text.

---

## 5. Type Safety Gaps

### 5.1 `sql.json()` Cast to `never`

Multiple database writes use `sql.json(properties as never)` to circumvent TypeScript's type system:

- `apps/server/src/api/auth.ts:193` — `sql.json(properties)`
- `apps/server/src/api/tasks.ts:123` — `sql.json(properties as never)`
- `apps/server/src/policies/task-write-service.ts:63` — `sql.json(request.payload.next as never)`
- `apps/server/src/seed/superuser.ts:82` — `sql.json(properties as never)`

The `as never` cast silences type errors that may indicate real mismatches between the TypeScript interface and what postgres.js expects.

### 5.2 Untyped Catch Blocks Throughout

Multiple catch blocks swallow errors without type narrowing:

- `apps/server/src/api/auth.ts:50` — `catch { return null; }` in `getAuthenticatedUser`
- `apps/server/src/api/auth.ts:77` — `catch { return null; }` in `getAuthenticatedUserOrApiKey`
- `apps/server/src/api/auth.ts:362–364` — empty catch in logout's revocation block
- `apps/server/src/api/passkey.ts:101–104` — bare `catch (err)` with console error only
- `apps/server/src/studio/agent.ts` — no error handling for `proc.exited` failure

### 5.3 `as unknown as` Double Cast in Audit Service

`apps/server/src/policies/audit-service.ts:40–44` uses a double cast through unknown to suppress type errors with postgres.js's `unsafe()` API:

```ts
const latestRows = (await reserved.unsafe(...)) as unknown as { hash: string }[];
```

This pattern appears 3 times in the same file, each masking a legitimate type incompatibility.

### 5.4 `beforeVal` / `afterVal` Cast Through `unknown as string`

`apps/server/src/policies/audit-service.ts:53–54`:

```ts
const beforeVal = event.before as unknown as string;
const afterVal = event.after as unknown as string;
```

The comment explains the intent (passing JSONB objects without stringification), but the cast through `unknown` bypasses TypeScript entirely. The comment itself acknowledges this is a workaround for postgres.js's parameter type.

### 5.5 `tasks-queue.ts` Body Typed as `Record<string, unknown>` Without Schema

`apps/server/src/api/tasks-queue.ts:48–63` reads the request body as a bare `Record<string, unknown>` without using the AJV `validate()` helper, unlike `tasks.ts` which consistently uses schema validation. The manual field presence checks (`if (!idempotency_key || typeof idempotency_key !== 'string')`) are weaker than schema validation and do not produce consistent error shapes.

### 5.6 `studio.ts` — No Type Validation on Request Bodies

`apps/server/src/api/studio.ts:59` destructures `hash` from `await req.json()` without any type guard:

```ts
const { hash } = await req.json();
```

If the body is not an object or `hash` is not a string, `validateRollbackHash(hash)` returns null and the error is masked. Similarly, `studio/chat` at line 76 has the same pattern.

---

## 6. API/Route Coverage Gaps

### 6.1 Routes Without Authentication

| Route                   | File                               | Issue                                                      |
| ----------------------- | ---------------------------------- | ---------------------------------------------------------- |
| `GET /studio/status`    | `apps/server/src/api/studio.ts:37` | No auth — exposes branch/session info publicly             |
| `POST /studio/chat`     | `apps/server/src/api/studio.ts:74` | No auth — triggers `claude --dangerously-skip-permissions` |
| `POST /studio/rollback` | `apps/server/src/api/studio.ts:58` | No auth — can `git reset --hard` the repo                  |
| `POST /studio/reset`    | `apps/server/src/api/studio.ts:67` | No auth — clears session state                             |
| `GET /studio/commits`   | `apps/server/src/api/studio.ts:52` | No auth — exposes commit hashes                            |

### 6.2 Routes Without CSRF Protection

| Route                              | File                 | Issue         |
| ---------------------------------- | -------------------- | ------------- |
| `POST /api/tasks-queue`            | `tasks-queue.ts:47`  | No CSRF check |
| `POST /api/tasks-queue/claim`      | `tasks-queue.ts:110` | No CSRF check |
| `PATCH /api/tasks-queue/:id`       | `tasks-queue.ts:140` | No CSRF check |
| `POST /api/tasks-queue/:id/result` | `tasks-queue.ts:180` | No CSRF check |
| `POST /api/admin/keys`             | `admin.ts:44`        | No CSRF check |
| `DELETE /api/admin/keys/:id`       | `admin.ts:79`        | No CSRF check |
| `DELETE /api/users/:id`            | `users.ts:35`        | No CSRF check |

### 6.3 Routes Without Integration Test Coverage

| Route                                    | Test file            | Coverage status |
| ---------------------------------------- | -------------------- | --------------- |
| `GET /api/admin/keys`                    | None                 | **MISSING**     |
| `POST /api/admin/keys`                   | None                 | **MISSING**     |
| `DELETE /api/admin/keys/:id`             | None                 | **MISSING**     |
| `DELETE /api/users/:id`                  | None                 | **MISSING**     |
| `GET /api/audit/verify`                  | `audit.test.ts`      | COVERED         |
| `POST /api/auth/passkey/*`               | None                 | **MISSING**     |
| All `/studio/*` routes                   | `studio-api.test.ts` | COVERED         |
| `POST /api/tasks/:id/result` (delegated) | `task-queue.test.ts` | COVERED         |

---

## 7. Prioritized Finding Table

| #   | Finding                                                                                            | File:Line                                         | Severity       | Category         |
| --- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------- | -------------- | ---------------- |
| 1   | Studio routes accessible without authentication — triggers `claude --dangerously-skip-permissions` | `api/studio.ts:26`                                | **[CRITICAL]** | Auth gap         |
| 2   | `DELETE /api/users/:id` — any authenticated user can delete any user                               | `api/users.ts:35`                                 | **[CRITICAL]** | Auth gap         |
| 3   | Two task-queue result paths with different auth models and URL prefixes                            | `api/task-queue.ts`, `api/tasks-queue.ts`         | **[HIGH]**     | Duplication      |
| 4   | `data-governance.ts` — 5 public functions throw at runtime                                         | `policies/data-governance.ts:15–44`               | **[HIGH]**     | Incomplete stub  |
| 5   | Auth cookie `SameSite=Lax` — blueprint requires `Strict`                                           | `api/auth.ts:209,307`, `api/passkey.ts:305`       | **[HIGH]**     | Security posture |
| 6   | No CSRF protection on `/api/tasks-queue/*`, `/api/admin/*`, `/api/users/*`                         | multiple                                          | **[HIGH]**     | Security posture |
| 7   | `task-queue.ts` result handler does not validate task status before writing `completed`            | `api/task-queue.ts:82`                            | **[HIGH]**     | State machine    |
| 8   | Audit verify query loads entire table into memory — unbounded                                      | `api/audit.ts:63–67`                              | **[HIGH]**     | Scalability      |
| 9   | Worker `claimNextTask` uses app DB pool instead of agent pool                                      | `apps/worker/src/runner.ts:132`                   | **[HIGH]**     | Correctness      |
| 10  | `task-write-service.ts` — undefined row from concurrent DELETE not handled                         | `policies/task-write-service.ts:61`               | **[MEDIUM]**   | Error path       |
| 11  | `isSuperuser()` duplicated in admin.ts and audit.ts                                                | `api/admin.ts:17`, `api/audit.ts:22`              | **[MEDIUM]**   | Duplication      |
| 12  | `DEFAULT_GENESIS_HASH` literal duplicated                                                          | `api/audit.ts:16`, `policies/audit-service.ts:17` | **[MEDIUM]**   | Duplication      |
| 13  | `readProcStdout` duplicated in studio/agent.ts and studio/git.ts                                   | `studio/agent.ts:8`, `studio/git.ts:3`            | **[MEDIUM]**   | Duplication      |
| 14  | JSON response helper duplicated 7 times across route handlers                                      | all handler files                                 | **[MEDIUM]**   | Duplication      |
| 15  | AJV schema compiled on every `validate()` call — not cached                                        | `api/validation.ts:22`                            | **[MEDIUM]**   | Performance      |
| 16  | `tasks-queue.ts` request body uses manual type checks instead of AJV `validate()`                  | `api/tasks-queue.ts:55–73`                        | **[MEDIUM]**   | Type safety      |
| 17  | Studio agent — no timeout on `proc.exited`                                                         | `studio/agent.ts:29`, `studio/git.ts:17`          | **[MEDIUM]**   | Reliability      |
| 18  | Rate limiter in-memory — resets on restart, not shared across replicas                             | `security/rate-limiter.ts`                        | **[MEDIUM]**   | Ops risk         |
| 19  | `pwa-demo.tsx` — demo cards implemented but not imported into page                                 | `pages/pwa-demo.tsx:57`                           | **[MEDIUM]**   | Incomplete       |
| 20  | `sql.json(x as never)` casts throughout — suppresses type errors                                   | multiple files                                    | **[LOW]**      | Type safety      |
| 21  | `audit-service.ts` double-cast through `unknown` for postgres.js JSONB                             | `policies/audit-service.ts:40–54`                 | **[LOW]**      | Type safety      |
| 22  | WebSocket session not re-validated after token revocation                                          | `websocket.ts`                                    | **[LOW]**      | Auth gap         |
| 23  | `forgotPasswordIpLimiter` and `resetPasswordIpLimiter` instantiated but routes do not exist        | `security/rate-limiter.ts:131–138`                | **[LOW]**      | Dead code        |
| 24  | `k8s/app.yaml:32` — image tag hardcoded as `latest` (placeholder)                                  | `k8s/app.yaml:32`                                 | **[LOW]**      | Ops risk         |
| 25  | `k8s/app.yaml:110` — worker image tag also uses `<owner>` placeholder                              | `k8s/worker-agents.yaml:110,164`                  | **[LOW]**      | Ops risk         |
