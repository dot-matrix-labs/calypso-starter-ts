# Beyond Blueprint Report

**Date:** 2026-03-23
**Scope:** All recent commits — PWA, worker, security, ops, studio
**Analyst:** Claude Code (claude-sonnet-4-6)

---

## 1. Executive Summary

The calypso-starter-ts implementation frequently exceeded, hardened, and refined
the blueprint's stated intent. Across the domains examined, 14 significant
improvements over spec were identified, and 12 unspecified discoveries emerged
that the blueprint did not anticipate. Several of these discoveries — the
hash-chained audit log, the startup role-assertion check, the delegated-token
six-check chain, and the task-payload PII denylist — represent genuine security
and reliability advances that should be back-ported to the blueprint as canonical
patterns.

---

## 2. Part A — Improvements Over Spec

This section covers areas where the implementation went beyond what the blueprint
required, either in depth of implementation, additional safeguards, or cleaner
design choices.

---

### A-01 — Hash-Chained Audit Log

**Blueprint intent (PROCESS domain):** Record an append-only audit log of
consequential events.

**What was built:**
`apps/server/src/policies/audit-service.ts` implements a **SHA-256 hash-chained**
audit log using serializable transactions. Each audit row includes a `chain_hash`
field that is computed as `SHA-256(prev_hash || event_type || actor || payload)`.
The previous hash is fetched inside the same serializable transaction, making the
chain tamper-evident and ordering-consistent.

**Why it is better than spec:**
The blueprint specified an append-only log. The implementation adds a
cryptographic hash chain, which:

- Detects gap-insertion (insertion of events between existing rows)
- Detects deletion (any deletion breaks the chain)
- Enables external auditors to verify log integrity without DB access

The `GET /api/audit/verify` endpoint (apps/server/src/api/audit.ts) exposes
chain verification as a first-class API operation.

**Back-port recommendation:** Promote hash-chained audit logs to PROCESS-D-\* as
a design pattern rule, replacing the current generic "append-only" requirement.

---

### A-02 — Worker Startup Role Assertion

**Blueprint intent (WORKER domain):** Worker must use read-only DB credentials.

**What was built:**
`apps/worker/src/startup.ts` implements `assertReadOnlyRole()`, which issues a
`SELECT has_table_privilege(current_user, 'tasks', 'INSERT')` query at startup
and throws if the result is `true`. The runner calls this before entering the
worker loop (runner.ts:192), making the read-only constraint structurally
verified at boot rather than relying solely on provisioning.

**Why it is better than spec:**
The blueprint says "use a read-only role." The implementation adds an active
runtime assertion so a misconfigured credential set causes a fast, loud failure
rather than a silent privilege escalation.

**Back-port recommendation:** Add a rule `WORKER-C-008-ext: assert-readonly-on-boot`
to the WORKER checklist.

---

### A-03 — Six-Check Delegated Token Verification

**Blueprint intent (WORKER-T-005 / TQ-A-006):** Delegated tokens must be
task-scoped and single-use.

**What was built:**
`apps/server/src/auth/delegated-token.ts:verifyDelegatedToken()` performs six
sequential verification steps:

1. Parse and structural validation of JWT claims
2. Signature verification (HMAC-SHA256)
3. Expiry check
4. `token_type` must equal `"delegated"`
5. `task_id` claim must match the URL parameter
6. JTI revocation lookup (`SELECT FROM jti_revocation_log`)
   Immediately after verification, the JTI is revoked via `revokeJti()`.

**Why it is better than spec:**
The blueprint required task-scoped, single-use tokens. The implementation adds
`token_type` claim enforcement (prevents a regular session JWT from being
replayed as a delegated token), ordering the checks cheapest-first for efficiency.

**Back-port recommendation:** Document the six-check chain and JTI-on-verify
revocation pattern in AUTH design patterns.

---

### A-04 — PII Payload Denylist with 16 Forbidden Keys

**Blueprint intent (TQ-D-004):** Task payloads must not contain PII.

**What was built:**
`apps/server/src/api/task-payload-validation.ts` maintains a named constant
`PII_FORBIDDEN_KEYS` array with 16 specific keys (`ssn`, `social_security`,
`credit_card`, `cvv`, `password`, `secret`, `private_key`, `api_key`, `token`,
`auth_token`, `access_token`, `refresh_token`, `passport_number`, `date_of_birth`,
`bank_account`, `routing_number`). The check is case-insensitive and
recursive over nested objects.

**Why it is better than spec:**
The blueprint specified a general prohibition on PII in task payloads. The
implementation provides a concrete enumerated denylist with recursive traversal
and case-insensitive key matching. This is actionable and auditable, not just
a policy statement.

**Back-port recommendation:** Append the 16-key denylist to TQ-D-004 as the
recommended minimum set, noting that operators may extend it.

---

### A-05 — Distroless Container Images with Pinned SHA256 Digests

**Blueprint intent (DEPLOY domain):** Containerise services; minimise attack surface.

**What was built:**
Both `Dockerfile` and `Dockerfile.worker` use `gcr.io/distroless/cc-debian12`
and `gcr.io/distroless/nodejs22-debian12` with fully-pinned `@sha256:` digests
(not just version tags). This prevents tag-mutability supply-chain attacks.

**Why it is better than spec:**
The blueprint specified distroless containers. The implementation adds SHA256
digest pinning, which is a supply-chain hardening practice beyond the blueprint's
stated requirement.

**Back-port recommendation:** Add `DEPLOY-C-*: pin-base-image-digest` to the
DEPLOY checklist.

---

### A-06 — Kubernetes NetworkPolicy Egress Restriction

**Blueprint intent (DEPLOY / WORKER domains):** Worker containers must not have
unnecessary network access.

**What was built:**
`k8s/worker-agents.yaml` defines a `NetworkPolicy` that whitelists only specific
egress destinations (the Kubernetes API server IP and the Calypso API service)
and blocks all other egress. This means a compromised worker cannot exfiltrate
data to arbitrary external hosts.

**Why it is better than spec:**
The blueprint required worker credential isolation but did not specify network-
level egress controls. The implementation adds a Kubernetes NetworkPolicy
layer that enforces network-level isolation.

**Back-port recommendation:** Add `WORKER-C-009-ext: k8s-network-policy-egress`
to the WORKER checklist.

---

### A-07 — Vault Secrets Provider with TTL Cache

**Blueprint intent (ENV domain):** Secrets must not be stored as plaintext env vars.

**What was built:**
`apps/server/src/secrets/provider.ts` implements two providers: `EnvSecretsProvider`
(for development) and `VaultSecretsProvider` (for production). The Vault provider
uses a TTL cache: fetched secrets are cached for `ttlMs` (default: 5 minutes)
and re-fetched on expiry. The provider selection is controlled by
`SECRETS_PROVIDER=vault` in the environment.

**Why it is better than spec:**
The blueprint specified "use a secrets manager." The implementation provides a
pluggable provider interface with automatic TTL-based rotation support, meaning
the application picks up credential rotations without a restart.

**Back-port recommendation:** Document the `SecretsProvider` interface pattern
and TTL re-fetch in ENV design patterns.

---

### A-08 — CSRF Token Scoped to `__Host-` Prefix

**Blueprint intent (AUTH domain):** CSRF protection via double-submit cookie.

**What was built:**
`apps/server/src/auth/csrf.ts` uses the `__Host-csrf-token` cookie name. The
`__Host-` prefix is a browser security primitive that enforces:

- The cookie can only be set by the exact origin (not subdomains)
- The cookie cannot have a `Domain` attribute
- The cookie requires the `Secure` flag

**Why it is better than spec:**
The blueprint required CSRF double-submit cookie. The implementation uses the
stricter `__Host-` prefix, which prevents subdomain CSRF attacks that are
possible with plain named cookies.

**Back-port recommendation:** Update AUTH design patterns to specify `__Host-`
prefix as the canonical CSRF cookie name.

---

### A-09 — Stale Claim Recovery Surfaced as Audit-Emitting Service

**Blueprint intent (TQ-X-001):** Recover stale claimed tasks.

**What was built:**
`apps/server/src/policies/stale-claim-recovery-service.ts` wraps the DB-level
recovery in a service that also emits an audit event (`stale_claim_recovered`)
for each recovered task. The stale claim threshold and recovery batch size are
configurable, and the service is invoked on a regular polling interval.

**Why it is better than spec:**
The blueprint required stale claim recovery. The implementation makes every
recovery event visible in the tamper-evident audit log, creating an operational
signal for detecting worker failures.

**Back-port recommendation:** Add audit-event emission to TQ-X-001 as a required
behavior, not just an option.

---

### A-10 — Two-Stage Bootstrap with Secrets Initialization Before Any Import

**Blueprint intent (ENV domain):** Secrets must be available at startup.

**What was built:**
`apps/server/src/bootstrap.ts` uses a two-stage boot: it calls `initSecrets()`
to populate the secrets cache, then dynamically imports `index.js` only after
secrets are ready. This prevents any route handler from running before secrets
are loaded.

**Why it is better than spec:**
The blueprint required secrets to be available at startup, but did not specify
the bootstrap sequence. The dynamic import pattern structurally prevents a race
condition between secret initialization and route handler registration.

**Back-port recommendation:** Add `ENV-D-*: two-stage-secrets-bootstrap` as a
design pattern.

---

### A-11 — Role-Per-Tier DB Connection in Worker

**Blueprint intent (DATA domain):** Separate read and write DB access paths.

**What was built:**
The worker defines `AGENT_DATABASE_URL` as a separate environment variable from
the application's `DATABASE_URL`. The `loadAgentDbConfig()` function (worker/src/db.ts)
loads this separately and creates a dedicated pool. `assertReadOnlyRole()` verifies
it.

**Why it is better than spec:**
The blueprint required read-only credentials for the worker. The implementation
goes further by using a completely separate connection string — not just a
different username on the same DSN — which enables OS-level secret separation
in Kubernetes (separate Secrets objects, separate RBAC).

---

### A-12 — Idempotent Task Enqueue with ON CONFLICT DO NOTHING

**Blueprint intent (TQ-C-003):** Task enqueue must be idempotent.

**What was built:**
`packages/db/task-queue.ts:enqueueTask()` uses `INSERT ... ON CONFLICT (idempotency_key)
DO NOTHING RETURNING *`. If no row is returned (conflict), the function fetches
the existing row by idempotency key and returns it. This creates true
client-observable idempotency: the caller always gets back a task row, whether
it was newly created or already existed.

**Why it is better than spec:**
The blueprint required idempotent enqueue. The implementation makes the
idempotency key-lookup behavior explicit — returning the existing row on
conflict — which lets callers safely retry without custom conflict-handling logic.

---

### A-13 — Atomic Claim Using SELECT ... FOR UPDATE SKIP LOCKED

**Blueprint intent (TQ-C-001):** Claim must be atomic and exclusive.

**What was built:**
`packages/db/task-queue.ts:claimNextTask()` uses a CTE with `SELECT ... FOR UPDATE
SKIP LOCKED` to atomically claim the next pending task in a single database round
trip. The `SKIP LOCKED` clause prevents thundering-herd lock contention when
multiple worker instances compete for tasks.

**Why it is better than spec:**
The blueprint required atomic claim. The implementation uses the PostgreSQL
`SKIP LOCKED` pattern which is the canonical solution to worker-pool claim
contention, preventing one slow worker from blocking all others.

**Back-port recommendation:** Specify `SELECT FOR UPDATE SKIP LOCKED` as the
required atomic claim pattern in TQ-C-001.

---

### A-14 — LISTEN/NOTIFY with Bounded Poll Fallback

**Blueprint intent (TQ-D-005):** Worker should be woken by PostgreSQL notifications.

**What was built:**
`packages/db/task-queue-worker.ts:createWorkerWaker()` connects a dedicated
notification client via LISTEN on the `task_queue` channel, but also maintains a
configurable poll interval (default: 30 seconds) as a fallback for notifications
that may be missed during connection drops. The implementation tracks connection
state and re-registers the LISTEN on reconnect.

**Why it is better than spec:**
The blueprint required LISTEN/NOTIFY wake. The implementation adds a resilient
bounded poll fallback that ensures no task is permanently missed even if the
notification connection drops, while the poll interval is high enough to avoid
excessive DB load.

---

## 3. Part B — Unspecified Discoveries

This section covers features, patterns, or safeguards that emerged during
implementation that the blueprint did not anticipate, and which represent
candidates for back-porting.

---

### B-01 — Studio API Without Authentication

**File:** `apps/server/src/api/studio.ts`

**Discovery:**
The studio API (`POST /studio/chat`, `POST /studio/rollback`, `GET /studio/status`)
invokes `claude --dangerously-skip-permissions` as a subprocess. None of these
routes have an authentication check.

**Significance (Negative):**
This is an unspecified discovery in the sense that no blueprint rule explicitly
governs the studio API's authentication requirements, yet the studio API is
clearly a consequential operation surface. The blueprint does not address
AI-assisted development tooling at all.

**Blueprint gap:** The blueprint has no STUDIO domain or rules for AI dev tooling
APIs. This is a governance gap that should be addressed by adding a new domain or
adding studio rules to the AUTH checklist.

**Recommendation:** Add `AUTH-C-*: all-api-routes-require-session-verification`
as a blanket checklist rule, closing the implicit exception.

---

### B-02 — In-Process Rate Limiter with Sliding Window

**File:** `apps/server/src/security/rate-limiter.ts`

**Discovery:**
The implementation provides a full in-process sliding-window rate limiter with
configurable burst, per-key request tracking, automatic cleanup of expired
windows, and a shared interval-based cleanup timer. This was not specified in
any blueprint rule as a concrete implementation pattern.

**Significance (Positive):**
The in-process implementation is appropriate for single-instance deployments and
correctly noted as requiring Redis for multi-instance scenarios (comment at
rate-limiter.ts:12). The sliding window approach is more accurate than a fixed
bucket.

**Blueprint gap:** The blueprint mentions rate limiting as a requirement but does
not specify the implementation strategy, scale boundary, or the in-process vs
distributed distinction.

**Back-port recommendation:** Add `AUTH-D-*: rate-limiter-strategy` design
pattern with `in-process` (single instance) and `distributed` (Redis/cluster)
variants, including the scale trigger criterion.

---

### B-03 — Platform Detection Hook with Feature Matrix

**File:** `apps/web/src/hooks/use-platform.ts`

**Discovery:**
`usePlatform()` detects OS (Windows, macOS, iOS, Android, Linux), browser
(Chrome, Firefox, Safari, Edge, Samsung, Opera), standalone mode, and a full
feature support matrix (camera, microphone, notifications, persistent storage,
screen wake lock, Web Share, Bluetooth, NFC, Geolocation, Battery API). The hook
uses `navigator.userAgentData` (UA-CH) where available and falls back to
`navigator.userAgent` regex parsing.

**Significance (Positive):**
This is a sophisticated capability-detection layer that goes well beyond what the
UX blueprint specified. The UA-CH-first approach future-proofs against
User-Agent string deprecation.

**Blueprint gap:** The UX blueprint specifies platform detection but does not
specify the UA-CH vs UA-string fallback strategy or the feature capability matrix.

**Back-port recommendation:** Add `UX-D-*: ua-client-hints-first-detection`
design pattern specifying the UA-CH-first + regex-fallback approach.

---

### B-04 — Service Worker Cache Strategy Differentiation

**File:** `apps/web/src/sw.ts`

**Discovery:**
The service worker implements three distinct caching strategies with specific
URL-pattern matching:

- Cache-first for the precache manifest (versioned assets)
- Network-first for API requests (`/api/`, `/ws`, `.json`)
- Offline HTML fallback for document navigations (returning `/offline.html`)

These are wired via explicit `fetch` event handler logic, not via a Workbox
configuration. The cache key versioning (`CACHE_VERSION`) enables atomic cache
invalidation on deployment.

**Significance (Positive):**
The three-strategy differentiation is more operationally correct than a single
strategy for all assets. It avoids serving stale API responses from cache while
still serving static assets offline.

**Blueprint gap:** The UX blueprint specifies offline support but does not
distinguish between asset-caching and API-response caching strategies.

**Back-port recommendation:** Add `UX-D-*: sw-cache-strategy-differentiation`
specifying the three-tier strategy as the canonical pattern.

---

### B-05 — Codex Credentials Encrypted in Database

**File:** `apps/worker/src/codex-credentials.ts` (referenced by runner.ts:199)

**Discovery:**
Worker credentials for the Codex AI agent are stored as an encrypted bundle in
the database and decrypted at runtime by `restoreCodexCredentials()`. The
function fails closed if the bundle is missing, expired, or cannot be decrypted.

**Significance (Positive):**
This is a novel pattern for managing AI agent credentials: storing them
encrypted in the database (which the worker can read via its read-only role)
rather than in environment variables or a separate secrets manager. It enables
per-agent credential scoping without requiring a secrets manager API call per
worker instance.

**Blueprint gap:** The WORKER blueprint does not address AI agent credential
management. This is an unspecified discovery in the AI-agent space.

**Back-port recommendation:** Add `WORKER-D-*: ai-agent-credential-bundle`
design pattern describing the encrypted-DB-bundle approach.

---

### B-06 — Dynamic Import Bootstrap Pattern

**File:** `apps/server/src/bootstrap.ts`

**Discovery:**
The server uses a dynamic `import()` to load the main entry point after
completing the synchronous secrets initialization phase. This is a Node.js/Bun
pattern that is unusual in server applications but serves an important purpose:
it prevents module-level code in `index.ts` (route handler registrations that
call `requireSecret()`) from executing before `initSecrets()` completes.

**Significance (Positive):**
The pattern solves a real race condition that is invisible in unit tests (where
secrets are mocked) but would surface in production if the secrets provider
initialization was slow (e.g., Vault with a cold cache).

**Blueprint gap:** No blueprint rule covers the bootstrap sequence.

**Back-port recommendation:** Document as `ENV-D-*: deferred-entry-bootstrap` —
the entry file is a two-stage loader, not the application itself.

---

### B-07 — Superuser Seed with Last-Superuser Guard

**Files:** `apps/server/src/seed/superuser.ts`, `apps/server/src/api/users.ts`

**Discovery:**
The server prevents deletion of the last superuser account. `DELETE /api/users/:id`
checks whether the user is the last superuser and returns HTTP 409 if so
(apps/server/src/api/users.ts:52–66). The superuser seed script is idempotent
and creates the initial superuser only if none exists.

**Significance (Positive):**
This is a safety-critical operational guard that the blueprint does not address.
Without it, a user with admin privileges could lock out an entire installation by
deleting their own account.

**Blueprint gap:** The AUTH blueprint does not address the "last admin" lockout
scenario.

**Back-port recommendation:** Add `AUTH-C-*: last-superuser-deletion-guard` to
the AUTH checklist.

---

### B-08 — WebSocket Broadcast Registry

**File:** `apps/server/src/websocket.ts`

**Discovery:**
A simple `Set<ServerWebSocket>` is maintained as the WebSocket client registry
with a `broadcast()` function. The implementation correctly handles disconnected
client cleanup on `close` events. This is a lightweight pub-sub layer that the
blueprint does not mention.

**Significance (Neutral):**
The pattern is sound for single-instance deployments. At scale, a Redis pub-sub
or similar shared message bus would be required. The same "scale boundary"
limitation applies here as to the in-process rate limiter (B-02).

**Blueprint gap:** No blueprint rule governs real-time push notification
architecture.

---

### B-09 — Worker Pool Heterogeneity via Agent Type

**File:** `k8s/worker-agents.yaml`

**Discovery:**
Two separate Kubernetes Deployments are defined (`calypso-worker-coding` and
`calypso-worker-analysis`), each with a different `AGENT_TYPE` environment
variable. The task claim query filters by `agent_type`, so the two pools can
be scaled independently.

**Significance (Positive):**
This enables per-capability worker scaling — more coding workers when there is a
coding workload surge, more analysis workers otherwise — without any application
code changes.

**Blueprint gap:** The WORKER blueprint defines worker type as a concept but does
not specify how heterogeneous worker pools should be deployed.

**Back-port recommendation:** Add `WORKER-D-*: heterogeneous-worker-deployments`
pattern specifying per-agent-type Deployment objects.

---

### B-10 — API Result Submission Endpoint Decoupled from Queue CRUD

**Files:** `apps/server/src/api/task-queue.ts`, `apps/server/src/api/tasks-queue.ts`

**Discovery:**
There are two separate API handlers for task-queue operations:

- `task-queue.ts`: `POST /api/tasks/:id/result` — worker result submission via
  delegated Bearer token
- `tasks-queue.ts`: full queue CRUD via session cookie (`GET`, `POST`, `DELETE`,
  `PATCH`)

The decoupling means the result submission path uses a different authentication
mechanism (delegated token) and a different URL namespace than the queue
management path (session cookie), making it harder to accidentally mix the two.

**Significance (Positive):**
This is architecturally sound: the worker-facing surface and the user-facing
surface have different trust levels and different auth mechanisms, so separating
them into different files and URL prefixes is the right call.

**Blueprint gap:** The TASK-QUEUE blueprint does not explicitly distinguish the
worker result submission surface from the queue management surface.

**Back-port recommendation:** Clarify in TQ architecture that the result submission
endpoint is a separate security boundary from queue management.

---

### B-11 — Admin API Key Management

**File:** `apps/server/src/api/admin.ts`

**Discovery:**
A dedicated admin API (`POST /api/admin/api-keys`, `DELETE /api/admin/api-keys/:id`,
`GET /api/admin/api-keys`) manages API keys for programmatic access. This is
separate from the passkey/session auth path. The admin routes are guarded by
`requireSuperuser` middleware.

**Significance (Positive):**
Providing API key management as a first-class admin feature enables integrations
(CI pipelines, external services) without exposing user sessions to non-human
callers.

**Blueprint gap:** The AUTH blueprint covers passkey and session flows but does
not define an API key management subsystem for programmatic access.

**Back-port recommendation:** Add `AUTH-D-*: api-key-management` covering key
creation, revocation, and least-privilege scoping.

---

### B-12 — Task Write Service as Consequential Write Boundary

**File:** `apps/server/src/policies/task-write-service.ts`

**Discovery:**
All task status transitions go through `task-write-service.ts`, which enforces
allowed transition pairs (e.g., `pending → claimed`, `claimed → completed`,
`claimed → failed`) and emits an audit event for each transition. This makes the
task status machine explicit and auditable.

**Significance (Positive):**
The blueprint defines a write boundary concept but does not describe state-machine
enforcement. The implementation adds transition validation as part of the write
boundary, preventing invalid state transitions at the application layer before
they reach the database.

**Back-port recommendation:** Add `TQ-D-*: task-status-machine` design pattern
defining allowed transitions and the write-boundary's role in enforcing them.

---

## 4. Innovation Index

Ranked by estimated impact on security, reliability, and operational value:

| Rank | Item                                      | Domain       | Type        | Impact                                        |
| ---- | ----------------------------------------- | ------------ | ----------- | --------------------------------------------- |
| 1    | Hash-chained audit log                    | PROCESS      | Improvement | HIGH — tamper-evidence beyond spec            |
| 2    | Delegated token six-check chain           | AUTH         | Improvement | HIGH — prevents cross-task token replay       |
| 3    | PII payload denylist (16 keys, recursive) | TASK-QUEUE   | Improvement | HIGH — concrete, auditable PII guard          |
| 4    | Worker startup role assertion             | WORKER       | Improvement | HIGH — fail-fast on misconfigured credentials |
| 5    | Distroless + SHA256 pinned images         | DEPLOY       | Improvement | HIGH — supply-chain hardening                 |
| 6    | Kubernetes NetworkPolicy egress           | DEPLOY       | Improvement | HIGH — network-level worker isolation         |
| 7    | Task write service + state machine        | TASK-QUEUE   | Discovery   | MEDIUM-HIGH — invalid transition prevention   |
| 8    | In-process sliding-window rate limiter    | AUTH/PROCESS | Discovery   | MEDIUM — well-designed, clear scale boundary  |
| 9    | LISTEN/NOTIFY + poll fallback             | TASK-QUEUE   | Improvement | MEDIUM — no missed tasks on reconnect         |
| 10   | Platform detection with UA-CH-first       | UX           | Discovery   | MEDIUM — future-proof UA detection            |
| 11   | Vault provider with TTL cache             | ENV          | Improvement | MEDIUM — credential rotation without restart  |
| 12   | Encrypted Codex credential bundle         | WORKER       | Discovery   | MEDIUM — novel AI agent credential pattern    |
| 13   | Two-stage deferred bootstrap              | ENV          | Discovery   | LOW-MEDIUM — prevents secret race at startup  |
| 14   | Last-superuser deletion guard             | AUTH         | Discovery   | LOW-MEDIUM — lockout prevention               |
| 15   | Heterogeneous worker deployments          | WORKER       | Discovery   | LOW-MEDIUM — per-capability scaling           |

---

## 5. Back-Porting Summary

The following new rules are recommended for addition to the blueprint:

| Proposed Rule ID                         | Description                                                                    |
| ---------------------------------------- | ------------------------------------------------------------------------------ |
| PROCESS-D-new: hash-chained-audit        | Audit log rows include SHA-256 chain hash; API endpoint for chain verification |
| AUTH-D-new: delegated-token-six-check    | Six-check chain in order; JTI revocation on successful verify                  |
| TQ-D-004-ext                             | PII denylist: minimum 16 keys, case-insensitive, recursive object traversal    |
| WORKER-C-new: assert-readonly-on-boot    | Worker asserts DB role is read-only before entering loop                       |
| DEPLOY-C-new: pin-base-image-digest      | Base images pinned by SHA256 digest, not tag                                   |
| WORKER-C-new: k8s-network-policy-egress  | NetworkPolicy restricts egress to API server only                              |
| TQ-D-new: task-status-machine            | Write boundary enforces allowed state transitions                              |
| AUTH-D-new: rate-limiter-strategy        | In-process vs distributed strategy with scale trigger                          |
| TQ-C-001-ext                             | Claim uses SELECT FOR UPDATE SKIP LOCKED                                       |
| UX-D-new: ua-ch-first-detection          | Platform detection uses UA-CH API, falls back to UA string                     |
| ENV-D-new: vault-ttl-cache               | Secrets provider caches with TTL for rotation without restart                  |
| WORKER-D-new: ai-agent-credential-bundle | AI agent credentials stored as encrypted DB bundle                             |
| ENV-D-new: deferred-entry-bootstrap      | Entry file is a two-stage loader: secrets init then dynamic import             |
| AUTH-C-new: last-superuser-guard         | Prevent deletion of last superuser account                                     |
| WORKER-D-new: heterogeneous-deployments  | Per-agent-type Kubernetes Deployments for independent scaling                  |
| AUTH-C-new: all-routes-require-auth      | All non-public API routes must have explicit auth check                        |
| UX-D-new: sw-cache-strategy-diff         | Service worker uses three cache strategies differentiated by URL pattern       |
