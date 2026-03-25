# Enterprise Frontier Gap Analysis

**Date:** 2026-03-23
**Scope:** All domains — server, worker, PWA, ops, security
**Analyst:** Claude Code (claude-sonnet-4-6)
**Audience:** COO, CIO, CTO, CISO

---

## 1. Executive Summary

The calypso-starter-ts platform has crossed the architectural maturity threshold
needed for a focused engineering team to operate it reliably at modest scale
(hundreds of concurrent users, thousands of queued tasks per day). The core
security primitives are in place: passkey authentication, CSRF protection,
rate limiting, delegated tokens, tamper-evident audit log, distroless containers,
and network-isolated workers.

The gaps between the current state and enterprise readiness are real and
prioritised below. The most critical gaps in order of organisational risk are:

1. **Studio API has zero authentication** — any network-reachable party can
   trigger unrestricted AI agent execution and git rollbacks.
2. **JWT algorithm is HS256 (shared secret) not ES256 (asymmetric)** — secret
   rotation requires coordinated downtime; stolen secret = instant token forgery.
3. **Data governance layer is entirely unimplemented** — five stub functions that
   throw "Not implemented" errors block PII compliance, GDPR data export, and
   data retention enforcement.
4. **No distributed secret management** — single `JWT_SECRET` env var is the
   crown jewel; compromise is undetected and unrecoverable without key rotation
   downtime.
5. **Rate limiter is in-process only** — does not survive process restart;
   ineffective against distributed attacks in multi-instance deployments.

The following sections detail the full gap analysis through the lens of each
executive function.

---

## 2. COO — Operational Visibility, Uptime, and Cost

### 2.1 Alerting and Monitoring

**Current state:**
There is no structured metrics emission. Log output is `console.log` / `console.error`
prefixed strings (e.g., `[runner] Claimed task ...`). No OpenTelemetry, no
Prometheus endpoint, no structured JSON log format, no correlation between web
request logs and worker execution logs.

**Gap:**
Without structured logging and a trace ID that flows from the HTTP request
through the task queue row through the worker execution back to the API result
submission, operations staff cannot reconstruct the execution history of a single
task without manually cross-referencing multiple log streams.

**Files affected:** All `console.log` calls across `apps/server/src/`, `apps/worker/src/`.

**Required for SLA operations:**

- Structured JSON logs (Winston, Pino, or Bun's built-in)
- Trace ID injection at HTTP request ingress, propagated to task queue row and worker
- Prometheus `/metrics` endpoint (or OTLP push) exposing: active tasks, claim latency, worker failures, API error rate, auth failure rate

**Severity:** [HIGH]

---

### 2.2 Runbooks and Operational Procedures

**Current state:**
No runbook documentation exists. There is a `REVIEW-PLAN.md` and blueprint YAML,
but no operational procedures for:

- What to do when all workers are stale (stale claim recovery is automatic, but
  the threshold and alert trigger are undocumented for operators)
- How to rotate the `JWT_SECRET` without invalidating all active sessions
- How to scale workers on demand
- How to enable/disable features (no feature flag system)

**Gap:**
COO cannot commit to an uptime SLA without documented incident response procedures.

**Severity:** [HIGH]

---

### 2.3 Health Probe Coverage

**Current state:**
`GET /health` returns `{ ok: true }` (apps/server/src/index.ts). The Kubernetes
liveness and readiness probes both point to `/health`. The health probe does not
check:

- Database connectivity
- Secrets availability
- Queue backlog depth (a readiness concern)

**Gap:**
A pod that has lost its DB connection will pass health checks and continue
receiving traffic, returning 500 errors to users.

**Recommendation:** Add a `liveness` probe that checks DB ping, and a `readiness`
probe that additionally checks queue backlog depth against a configurable
threshold.

**Severity:** [HIGH]

---

### 2.4 Cost Visibility

**Current state:**
No cost tagging or resource request/limit tuning guidance. `k8s/app.yaml` has no
`resources.requests` or `resources.limits` defined. `k8s/worker-agents.yaml` also
has no resource constraints.

**Gap:**
Without resource limits, a single runaway Codex subprocess (potentially
running for minutes on a large codebase) can exhaust node resources and starve
other pods. Without cost tagging, cloud billing cannot be attributed to
specific tenants or workloads.

**Severity:** [MEDIUM]

---

### 2.5 Backup and Recovery

**Current state:**
No backup or recovery procedures are documented or scripted. The docker-compose
configuration does not define a backup volume. The Kubernetes configuration does
not reference a PersistentVolumeClaim with backup annotations.

**Gap:**
For a COO to sign off on a production deployment, there must be a documented RPO
(Recovery Point Objective) and RTO (Recovery Time Objective) with tested recovery
procedures.

**Severity:** [HIGH]

---

## 3. CIO — Data Governance, Compliance, and Integrations

### 3.1 Data Governance Layer (CRITICAL)

**Current state:**
`apps/server/src/policies/data-governance.ts` exports five functions, all of which
throw `new Error('Not implemented: ...')`:

- `exportUserData()` — GDPR Article 20 (data portability)
- `deleteUserData()` — GDPR Article 17 (right to erasure)
- `enforceRetentionPolicy()` — data retention enforcement
- `classifyData()` — data classification
- `auditDataAccess()` — data access audit

Without these implementations, the platform cannot make any GDPR compliance
claims. Deploying this system to process EU personal data without implementing
these functions would expose the organisation to regulatory risk.

**File:** `apps/server/src/policies/data-governance.ts:1–46`

**Severity:** [CRITICAL]

---

### 3.2 Three-Database Architecture

**Current state:**
The blueprint specifies three separate databases: transactional (OLTP), audit,
and analytics. In practice:

- `docker-compose.yml` maps `DATABASE_URL`, `AUDIT_DATABASE_URL`, and
  `ANALYTICS_DATABASE_URL` all to the same PostgreSQL instance and database
- The server code uses `DATABASE_URL` only; `AUDIT_DATABASE_URL` and
  `ANALYTICS_DATABASE_URL` are not consumed

**Gap:**
The audit log is in the same database as the operational data. An attacker with
write access to the operational database can also tamper with the audit log,
defeating the tamper-evident chain. For compliance purposes, the audit log must
be in a write-once or append-only storage medium that is physically isolated from
the primary database.

**Severity:** [HIGH]

---

### 3.3 Field-Level Encryption

**Current state:**
The DATA blueprint requires field-level encryption for PII fields (AUTH-T-003,
DATA-T-003). No field-level encryption is implemented. User credentials (passkey
public keys, credential IDs) are stored as plaintext in the database.

**Gap:**
A full database backup or a SQL injection vulnerability directly exposes all
stored credentials. Field-level encryption would limit the blast radius to a
single compromised column's encryption key.

**Severity:** [HIGH]

---

### 3.4 GDPR/CCPA Compliance Posture

**Current state:**
Beyond the unimplemented data governance functions, the platform lacks:

- A cookie consent mechanism (the PWA sets cookies without consent prompts)
- A privacy policy linkage in the UI
- A data processing register or inventory

**Gap:**
The platform cannot be lawfully deployed to EU users without implementing at
minimum the right-to-erasure and data-portability functions, a cookie consent
mechanism, and a privacy notice.

**Severity:** [CRITICAL]

---

### 3.5 SOC 2 / ISO 27001 Posture

**Current state:**
The platform has several SOC 2 Trust Services Criteria-aligned controls already
in place:

- CC6.1 (Logical access controls): Passkey auth, CSRF, rate limiting — PARTIAL
- CC6.2 (Authentication): Passkey, HMAC JWT — PARTIAL (HS256 not ES256)
- CC6.7 (Transmission encryption): HTTPS required (assumed infra) — N/A verifiable from code
- CC7.2 (Security events): Hash-chained audit log — PARTIAL (audit DB not isolated)
- CC9.2 (Third-party risk): Distroless pinned images — COMPLIANT

**Gap:**
A SOC 2 Type II audit would currently fail on:

- Change management (no deployment approval workflow documented)
- Incident response (no documented procedures)
- Vulnerability management (no CVE scanning configured in CI)
- Access review (no periodic access review process)

**Severity:** [HIGH]

---

### 3.6 External Integrations

**Current state:**
No integration layer is defined (no webhook outbox, no event bus, no API gateway
policy). The studio API calls `claude --dangerously-skip-permissions` as a
subprocess, which is an undocumented dependency on the Anthropic CLI being present
in the container image.

**Gap:**
Integrating with external systems (SIEM, ITSM, identity provider, analytics
platform) requires a documented event schema and a stable integration surface.

**Severity:** [MEDIUM]

---

## 4. CTO — Scalability, Tech Debt, and Developer Experience

### 4.1 JWT Algorithm: HS256 vs ES256

**Current state:**
`apps/server/src/auth/jwt.ts` implements HS256 HMAC-SHA256. The blueprint
specifies ES256 ECDSA (IMPL-AUTH-006). Both the session JWT and delegated token
use the same shared secret (`JWT_SECRET`).

**Gap:**
HS256 requires the secret to be known by both the signing party (server) and any
verifying party. If the worker needs to verify tokens independently (not via the
API server), it would need access to the same secret, widening the blast radius.
ES256 allows the public key to be distributed for verification without exposing
the private key.

Additionally, HS256 rotation requires all tokens signed with the old secret to be
immediately invalidated (no key overlap window), causing a logout-all event.

**File:** `apps/server/src/auth/jwt.ts`

**Severity:** [HIGH]

---

### 4.2 AJV Schema Compiled on Every Validation Call

**Current state:**
`apps/server/src/api/validation.ts:validate()` calls `ajv.compile(schema)` on
every invocation. AJV compilation is an expensive operation that generates a
closure-based validation function. This means every request to a validated
endpoint re-compiles the schema from scratch.

**File:** `apps/server/src/api/validation.ts:17`

**Impact:** Measurable latency on high-throughput endpoints. Under load testing,
this will appear as CPU-bound latency on API routes.

**Fix:** Cache compiled validators by schema object reference (a `WeakMap<Schema, ValidateFunction>`
or module-level `Map<string, ValidateFunction>` keyed on schema hash).

**Severity:** [MEDIUM]

---

### 4.3 Seven Duplicated `json()` Helper Blocks

**Current state:**
Seven separate API route files each define their own local `json()` helper
function:

- `apps/server/src/api/auth.ts`
- `apps/server/src/api/admin.ts`
- `apps/server/src/api/audit.ts`
- `apps/server/src/api/passkey.ts`
- `apps/server/src/api/tasks.ts`
- `apps/server/src/api/tasks-queue.ts`
- `apps/server/src/api/users.ts`

Each helper is substantively identical: it creates a `new Response(JSON.stringify(data), { headers: {'Content-Type': 'application/json'}, status })`.

**Gap:**
Any change to the response format (e.g., adding a `request-id` header, changing
the content-type charset) must be applied in seven places.

**Severity:** [MEDIUM]

---

### 4.4 In-Process Rate Limiter — Scale Boundary

**Current state:**
`apps/server/src/security/rate-limiter.ts` is an in-process, non-persistent
sliding-window rate limiter. On process restart, all window state is lost. In a
multi-instance deployment behind a load balancer, each instance maintains its own
window — an attacker can distribute requests across instances to bypass the limit.

**File:** `apps/server/src/security/rate-limiter.ts:1–175`

**Gap:**
For a production deployment with multiple server replicas, the rate limiter
provides no protection against distributed attacks.

**Recommendation:** Replace with Redis `INCR` + TTL window, or use an upstream
rate limiter at the load balancer/API gateway layer.

**Severity:** [HIGH]

---

### 4.5 Test Coverage Gaps

**Current state:**

- No end-to-end tests for the passkey registration and authentication flow
- No tests for the worker runner (`apps/worker/src/runner.ts`) — the most complex
  execution path in the system
- No tests for CSRF token verification
- No Playwright or browser-automation tests for the PWA install flow
- No contract tests between the worker result submission format and the API handler

**File references:**

- `apps/server/tests/integration/api.test.ts` — covers basic auth cookie flow
- `apps/server/tests/integration/task-queue.test.ts` — covers enqueue/claim

**Severity:** [HIGH]

---

### 4.6 PWA Demo Cards Not Connected

**Current state:**
`apps/web/src/pages/pwa-demo.tsx` renders a placeholder: "Demo cards loading —
check back as features are implemented." The `usePlatform()` hook is wired and
the platform badge row is working, but no demo card components (storage, camera,
microphone, notifications, install prompt) are imported or rendered.

**Gap:**
Issues #16–#20 (referenced in the file comment) are the downstream card
implementations. Until these are complete, the PWA demo page provides no
interactive value.

**Severity:** [LOW]

---

### 4.7 Tech Debt Index

| Item                           | File                          | Debt Type         | Estimated Remediation |
| ------------------------------ | ----------------------------- | ----------------- | --------------------- |
| HS256 → ES256 migration        | `auth/jwt.ts`                 | Algorithm upgrade | 2–3 days              |
| Data governance stubs          | `policies/data-governance.ts` | CRITICAL stub     | 5–10 days             |
| AJV schema caching             | `api/validation.ts`           | Performance       | 0.5 days              |
| `json()` helper deduplication  | 7 API files                   | DRY               | 0.5 days              |
| Distributed rate limiter       | `security/rate-limiter.ts`    | Scale             | 2–3 days              |
| Studio auth                    | `api/studio.ts`               | Security          | 1 day                 |
| Three-DB separation            | `docker-compose.yml`, app     | Architecture      | 3–5 days              |
| Structured logging + trace IDs | All log calls                 | Observability     | 2–3 days              |
| Worker test coverage           | `apps/worker/`                | Testing           | 2–3 days              |
| GDPR consent mechanism         | `apps/web/`                   | Compliance        | 3–5 days              |

**Total estimated remediation:** 21–34 engineering days (4–7 engineering weeks)

---

### 4.8 Developer Experience

**Current state:**

- `pnpm install && pnpm dev` is the described local setup path (inferred from monorepo structure)
- No `CONTRIBUTING.md` or developer setup guide
- No pre-commit hooks for linting or type checking (no `.husky/`, no `lint-staged` config)
- TypeScript strict mode configuration not verified
- Blueprint YAML files serve as the architecture documentation

**Gap:**
New engineers joining the project have no written onboarding path, no enforced
code quality gate at commit time, and must infer the development workflow from
the blueprint YAML files.

**Severity:** [MEDIUM]

---

## 5. CISO — Threat Surface, Secret Hygiene, Incident Response

### 5.1 Studio API — Unauthenticated AI Agent Execution (CRITICAL)

**Current state:**
`apps/server/src/api/studio.ts` exposes three routes with no authentication check:

- `POST /studio/chat` — invokes `claude -p <userPrompt> --dangerously-skip-permissions`
- `POST /studio/rollback` — invokes `git reset --hard <commitHash>`
- `GET /studio/status` — returns current branch and recent commits

Any party who can send HTTP requests to the server can:

1. Execute arbitrary AI agent sessions against the codebase
2. Roll back the git repository to any previous commit
3. Enumerate the git commit history

The `--dangerously-skip-permissions` flag explicitly bypasses all file permission
restrictions in the Claude CLI.

**File:** `apps/server/src/api/studio.ts:1–90`

**Severity:** [CRITICAL]

---

### 5.2 Shared HS256 Secret as Single Crown Jewel

**Current state:**
`JWT_SECRET` is the single secret used to sign all session JWTs and all delegated
tokens. If this secret is compromised:

- An attacker can forge arbitrary session tokens for any user, including superusers
- An attacker can forge delegated tokens for any task ID
- There is no rotation mechanism that does not immediately invalidate all sessions

**File:** `apps/server/src/auth/jwt.ts`

**Severity:** [CRITICAL]

---

### 5.3 No Token Binding or Device Binding

**Current state:**
Session JWTs are bearer tokens. Once issued, they are valid from any IP address
and any device until expiry (7 days by default). There is no IP binding, no
device fingerprint binding, and no session anomaly detection.

**Gap:**
A stolen session cookie is valid for 7 days from anywhere on the internet.

**Recommendation:** Add `jti` to session tokens and maintain a session table with
last-seen IP. Flag token reuse from a different IP family (IPv4 vs IPv6) as
suspicious and trigger step-up authentication.

**Severity:** [HIGH]

---

### 5.4 Cookie SameSite=Lax (Not Strict)

**Current state:**
The session cookie is set with `SameSite=Lax` (apps/server/src/api/auth.ts:~210).
`Lax` allows the cookie to be sent on top-level cross-site navigations (e.g.,
following a link from an attacker's website).

**Gap:**
CSRF protection via double-submit cookie is in place, but `SameSite=Strict` would
provide an additional defense-in-depth layer. The blueprint requires `Strict`
(IMPL-AUTH-007).

**Severity:** [MEDIUM]

---

### 5.5 Audit Log Colocation with Operational Database

**Current state:**
The audit log is stored in the same PostgreSQL instance as the operational data.
An attacker with write access to the `tasks` table likely also has write access
to the `audit_events` table, making the hash chain only a detection mechanism
(not a prevention mechanism) for an insider threat.

**Gap:**
For the audit log to be forensically credible under regulatory scrutiny, it must
be stored in a physically isolated medium: a separate database instance with write
access restricted to the application user and no read-write access for application
administrators.

**Severity:** [HIGH]

---

### 5.6 No Secret Rotation Detection

**Current state:**
`initSecrets()` loads secrets once at startup. `VaultSecretsProvider` has a TTL
cache (default 5 minutes) that re-fetches from Vault on expiry. However, there is
no mechanism to detect that a secret has been rotated and proactively invalidate
dependent state (e.g., all active JWTs signed with the old `JWT_SECRET`).

**Severity:** [HIGH]

---

### 5.7 Missing Rate Limiting on Passkey Registration

**Current state:**
The rate limiter is applied to login (`POST /api/auth/login`) and passkey
authentication (`POST /api/passkey/authenticate-complete`), but registration
endpoints (`POST /api/auth/register`, `POST /api/passkey/register-begin`,
`POST /api/passkey/register-complete`) are not rate-limited.

**File:** `apps/server/src/api/passkey.ts`, `apps/server/src/api/auth.ts`

**Gap:**
An attacker can enumerate the passkey registration flow to probe user existence
or perform account enumeration without triggering rate limits.

**Severity:** [MEDIUM]

---

### 5.8 No Intrusion Detection or Anomaly Alerting

**Current state:**
Auth failures are logged via `console.error` but there is no aggregation,
threshold alerting, or automated response. An attacker attempting a credential
stuffing attack (even against a rate-limited endpoint) would generate logs but
no alert.

**Gap:**
For a CISO to sign off on the platform, there must be a documented process for
detecting and responding to authentication anomalies within a defined SLA.

**Severity:** [HIGH]

---

### 5.9 No CVE Scanning in CI

**Current state:**
No `trivy`, `grype`, or `snyk` scan is configured in the CI pipeline or in the
Dockerfile build process. The pinned SHA256 base image digests mitigate
supply-chain attacks on the base image itself, but application-layer dependency
vulnerabilities are not scanned.

**Gap:**
A known CVE in `postgres` (the npm client), `ajv`, or any other application
dependency would not be detected until a manual audit.

**Severity:** [HIGH]

---

### 5.10 Worker Code Execution Boundary

**Current state:**
The Codex binary is invoked as a subprocess with `shell: false` and no shell
expansion. However:

- There is no timeout on the subprocess execution (apps/worker/src/runner.ts:56–89)
- There is no output size cap on stdout accumulation (runner.ts:61–66)
- The subprocess inherits the worker process environment, which may include
  `AGENT_DATABASE_URL`

**Gap:**
A malicious or buggy Codex response could cause unbounded memory growth in the
stdout accumulator. A long-running Codex task blocks the worker until completion,
preventing other tasks from being processed (the worker processes one task at a time).

**Recommendation:**

- Add a configurable subprocess timeout (e.g., 5 minutes)
- Cap stdout accumulation at a configurable byte limit (e.g., 10 MB)
- Clear `AGENT_DATABASE_URL` from the subprocess environment

**Severity:** [HIGH]

---

### 5.11 No Penetration Testing or Threat Model Document

**Current state:**
No threat model document, no penetration test record, no STRIDE analysis.

**Gap:**
For a CISO to accept risk on this platform, there must be a documented threat
model and a record of security testing.

**Severity:** [HIGH]

---

## 6. Prioritised Remediation Roadmap

### Tier 1 — Must-Fix Before Production (0–30 days)

| ID    | Item                                          | Owner      | Effort    | Risk Mitigated                         |
| ----- | --------------------------------------------- | ---------- | --------- | -------------------------------------- |
| T1-01 | Add auth to all studio API routes             | CISO / CTO | 1 day     | Unauthenticated AI agent execution     |
| T1-02 | Implement data-governance.ts functions        | CIO / CTO  | 5–10 days | GDPR non-compliance                    |
| T1-03 | Migrate JWT from HS256 to ES256               | CISO / CTO | 2–3 days  | Secret compromise = full token forgery |
| T1-04 | Add subprocess timeout + output cap in worker | CISO / CTO | 0.5 days  | Unbounded memory / stuck workers       |
| T1-05 | Add GDPR cookie consent mechanism             | CIO        | 3–5 days  | Regulatory risk in EU                  |

### Tier 2 — Must-Fix Before Scale (30–90 days)

| ID    | Item                                         | Owner      | Effort   | Risk Mitigated                        |
| ----- | -------------------------------------------- | ---------- | -------- | ------------------------------------- |
| T2-01 | Replace in-process rate limiter with Redis   | CISO / CTO | 2–3 days | Distributed credential stuffing       |
| T2-02 | Separate audit database from operational DB  | CIO / CISO | 3–5 days | Insider threat; audit credibility     |
| T2-03 | Add structured logging + trace IDs           | COO        | 2–3 days | Undiagnosable incidents               |
| T2-04 | Add DB health check to readiness probe       | COO        | 0.5 days | Silent DB failures receiving traffic  |
| T2-05 | Add resource limits to Kubernetes manifests  | COO        | 0.5 days | Runaway pod resource exhaustion       |
| T2-06 | Add CVE scanning to CI pipeline              | CISO       | 1 day    | Undetected dependency vulnerabilities |
| T2-07 | Implement worker unit and integration tests  | CTO        | 2–3 days | Undetected worker regression          |
| T2-08 | Cache AJV compiled validators                | CTO        | 0.5 days | CPU-bound request latency             |
| T2-09 | Deduplicate `json()` helper into shared util | CTO        | 0.5 days | Inconsistent response format drift    |

### Tier 3 — Hardening and Compliance (90–180 days)

| ID    | Item                                                    | Owner      | Effort    | Risk Mitigated                       |
| ----- | ------------------------------------------------------- | ---------- | --------- | ------------------------------------ |
| T3-01 | Implement field-level encryption for PII                | CIO / CISO | 5–10 days | Database dump exposure               |
| T3-02 | Add SameSite=Strict to session cookie                   | CISO       | 0.25 days | Cross-site navigation cookie leakage |
| T3-03 | Add rate limiting to registration endpoints             | CISO       | 1 day     | Account enumeration                  |
| T3-04 | Document runbooks (stale claim, JWT rotation, scale-up) | COO        | 3–5 days  | Undocumented incident response       |
| T3-05 | Commission penetration test                             | CISO       | External  | Unknown attack surface               |
| T3-06 | Add auth anomaly alerting (SIEM integration)            | CISO       | 3–5 days  | Undetected credential attacks        |
| T3-07 | Separate analytics database tier                        | CIO        | 5–7 days  | Reporting workloads impacting OLTP   |
| T3-08 | Implement SOC 2 change management workflow              | CIO / COO  | 5 days    | SOC 2 CC6.8 control gap              |
| T3-09 | Add session anomaly detection (IP binding)              | CISO       | 2–3 days  | Stolen session cookie abuse          |
| T3-10 | Write developer onboarding guide + pre-commit hooks     | CTO        | 1–2 days  | Developer experience / code quality  |

---

## 7. Quick Wins (≤ 1 day each, high signal)

These items can be completed by any developer in under a day and immediately
improve the security or operational posture:

1. **Add session check to studio routes** (`apps/server/src/api/studio.ts`) —
   import `requireSession` and add it to all three handlers. One afternoon.

2. **Add subprocess timeout to worker** (`apps/worker/src/runner.ts`) —
   pass `timeout` option to `spawn` or add a `setTimeout`/`AbortController`
   wrapper. Two hours.

3. **Add DB health check to readiness probe** — add a `SELECT 1` to the
   `/health` handler and split the Kubernetes probes into `/health/live` and
   `/health/ready`. One hour.

4. **Cache AJV validators** (`apps/server/src/api/validation.ts`) —
   add a module-level `Map` and return cached validator on cache hit. Thirty minutes.

5. **Add `SameSite=Strict`** (`apps/server/src/api/auth.ts:~210`) —
   change one string. Five minutes.

6. **Add resource limits to k8s/app.yaml and k8s/worker-agents.yaml** —
   add `resources.requests` and `resources.limits` blocks. Thirty minutes.

7. **Add CVE scan step to CI** — add `trivy image` step to the GitHub Actions
   workflow. One hour.

---

## 8. Compliance Status Summary

| Framework      | Current Posture          | Blocking Gaps                                                     |
| -------------- | ------------------------ | ----------------------------------------------------------------- |
| GDPR           | Non-compliant            | Data governance stubs, no right-to-erasure, no cookie consent     |
| SOC 2 Type I   | Partial                  | Missing: change management, incident response, access review docs |
| SOC 2 Type II  | Not ready                | All Type I gaps plus no audit history yet                         |
| ISO 27001      | Pre-scope                | No ISMS documentation, no risk register                           |
| FIDO2/WebAuthn | Compliant                | Passkey registration and authentication correctly implemented     |
| PCI-DSS        | N/A (no cardholder data) | PII denylist covers card data keys                                |
| CCPA           | Non-compliant            | No data export, no deletion workflow                              |

---

## 9. Appendix — Files Examined

| File                                          | Relevance                                           |
| --------------------------------------------- | --------------------------------------------------- |
| `apps/server/src/api/studio.ts`               | Unauthenticated AI agent execution surface          |
| `apps/server/src/auth/jwt.ts`                 | HS256 algorithm; 7-day TTL; no alg header check     |
| `apps/server/src/policies/data-governance.ts` | All functions throw "Not implemented"               |
| `apps/server/src/security/rate-limiter.ts`    | In-process only; no persistence                     |
| `apps/server/src/api/auth.ts`                 | SameSite=Lax; no registration rate limit            |
| `apps/server/src/api/validation.ts`           | AJV compiled on every call                          |
| `apps/worker/src/runner.ts`                   | No subprocess timeout; no stdout cap                |
| `apps/server/src/index.ts`                    | Health probe returns static OK; no DB check         |
| `k8s/app.yaml`                                | No resource limits; placeholder image tag           |
| `k8s/worker-agents.yaml`                      | No resource limits; NetworkPolicy correctly defined |
| `docker-compose.yml`                          | All three DB URLs point to same instance            |
| `packages/db/task-queue-worker.ts`            | LISTEN/NOTIFY + poll fallback — well implemented    |
| `apps/server/src/policies/audit-service.ts`   | Hash-chained audit — correctly implemented          |
