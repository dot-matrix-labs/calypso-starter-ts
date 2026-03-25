# Blueprint Compliance Report

**Date:** 2026-03-23
**Scope:** All blueprint domains — base + TypeScript implementation rules
**Analyst:** Claude Code (claude-sonnet-4-6)

---

## 1. Executive Summary

**Overall compliance estimate: ~61%** across all blueprint domains (base + TS implementation).

The codebase has made strong, focused progress on the task-queue and worker domains, which are the most complex to implement correctly. Security fundamentals (passkey, CSRF, HMAC JWT, rate limiting, revocation) are partially or mostly in place. The largest compliance gaps are in the data domain (no field-level encryption, no three-database separation in production, no analytics tier), the auth domain (HS256 instead of ES256, SameSite=Lax, no session rotation), and several deployment/ops checklist items.

**Domain-level summary:**

| Domain               | Compliance                          |
| -------------------- | ----------------------------------- |
| ARCH + IMPL-ARCH     | ~70%                                |
| AUTH + IMPL-AUTH     | ~50%                                |
| DATA + IMPL-DATA     | ~25%                                |
| DEPLOY + IMPL-DEPLOY | ~65%                                |
| ENV                  | ~55%                                |
| PROCESS              | N/A (meta-process, covered by Plan) |
| TASK-QUEUE           | ~80%                                |
| TEST + IMPL-TEST     | ~55%                                |
| UX + IMPL-UX         | ~50%                                |
| WORKER               | ~75%                                |

---

## 2. Per-Domain Compliance Matrix

### 2.1 ARCH — Architecture Blueprint

| Rule       | Name                                        | Status    | Notes                                                                                    |
| ---------- | ------------------------------------------- | --------- | ---------------------------------------------------------------------------------------- |
| ARCH-T-001 | server-code-in-browser-bundle               | COMPLIANT | Separate app directories; Vite build does not pull server modules                        |
| ARCH-T-002 | browser-code-on-server                      | COMPLIANT | Server imports only Node/Bun/DB modules                                                  |
| ARCH-T-003 | agent-places-code-wrong-directory           | COMPLIANT | Clear directory structure enforces placement                                             |
| ARCH-T-004 | shared-types-drift                          | PARTIAL   | `packages/core/types.ts` exists but API responses are not fully typed end-to-end         |
| ARCH-T-005 | trivial-dependency-addition                 | COMPLIANT | Dependency list is lean; JWT built in-house, no bloat                                    |
| ARCH-T-006 | deep-transitive-dependency-tree             | COMPLIANT | No evidence of deep transitive trees; small dep set                                      |
| ARCH-T-007 | unbounded-package-creation                  | COMPLIANT | Fixed package set: core, db, ui                                                          |
| ARCH-T-008 | api-contract-change-without-consumer-update | PARTIAL   | Shared types exist but not all endpoints have matching shared-type shapes                |
| ARCH-T-009 | unnavigable-monorepo-structure              | COMPLIANT | Directory tree is clear and shallow                                                      |
| ARCH-P-001 | boundaries-are-physical-not-conceptual      | COMPLIANT | Separate build pipelines for web and server                                              |
| ARCH-P-002 | directory-tree-is-architecture-diagram      | COMPLIANT | `/apps`, `/packages`, `/docs` layout is clear                                            |
| ARCH-P-003 | dependencies-are-liabilities                | COMPLIANT | JWT, CSRF, rate limiting all built internally                                            |
| ARCH-P-004 | types-shared-logic-not                      | PARTIAL   | `packages/core/types.ts` has types; some logic also in core (schemas, pii scrub)         |
| ARCH-P-005 | simplicity-scales-cleverness-does-not       | COMPLIANT | Boring structure, no clever abstractions                                                 |
| ARCH-D-001 | strict-runtime-separation                   | COMPLIANT | Server and web have separate entry points, no cross-imports detected                     |
| ARCH-D-002 | buy-vs-diy-decision-framework               | PARTIAL   | Applied informally; no `docs/dependencies.md` with formal justifications                 |
| ARCH-D-003 | monorepo-explicit-package-boundaries        | COMPLIANT | `apps/server`, `apps/web`, `apps/worker`, `packages/core`, `packages/db`, `packages/ui`  |
| ARCH-D-004 | type-safe-api-contracts                     | PARTIAL   | Task and auth types in core; no universal contract coverage                              |
| ARCH-A-001 | monorepo-collocated-packages                | COMPLIANT | Structure matches the prescribed layout                                                  |
| ARCH-C-001 | repo-structure-initialized                  | COMPLIANT | All prescribed directories present                                                       |
| ARCH-C-002 | web-no-server-imports                       | COMPLIANT | No server imports in web bundle                                                          |
| ARCH-C-003 | server-no-browser-imports                   | COMPLIANT | No DOM/browser imports in server                                                         |
| ARCH-C-004 | shared-types-in-packages-core               | COMPLIANT | `packages/core/types.ts` present                                                         |
| ARCH-C-005 | dependency-justification-documented         | MISSING   | No `docs/dependencies.md` exists                                                         |
| ARCH-C-006 | ci-separate-build-steps                     | PARTIAL   | GitHub Actions CI exists but details not reviewed; structure implies separation          |
| ARCH-C-007 | typed-rest-endpoint                         | COMPLIANT | Multiple typed endpoints using core types                                                |
| ARCH-C-008 | vitest-configured                           | COMPLIANT | Vitest configs in server and web                                                         |
| ARCH-C-009 | playwright-configured                       | MISSING   | No Playwright config found in repo                                                       |
| ARCH-C-010 | all-endpoints-typed                         | PARTIAL   | Task endpoints typed; queue endpoints use loose Record types                             |
| ARCH-C-011 | integration-tests-validate-types            | PARTIAL   | Integration tests validate behavior but not TypeScript type shapes at runtime            |
| ARCH-C-012 | no-any-in-api-contracts                     | PARTIAL   | Some `as never` and `as unknown` casts in API paths                                      |
| ARCH-C-013 | dependency-tree-audited                     | MISSING   | No audit evidence in docs                                                                |
| ARCH-C-014 | new-package-requires-justification          | MISSING   | No `docs/dependencies.md`                                                                |
| ARCH-C-015 | build-times-under-thirty-seconds            | N/A       | Not measured or documented                                                               |
| ARCH-C-016 | decoupling-test-passed                      | COMPLIANT | Principles are framework-agnostic                                                        |
| ARCH-C-017 | packages-have-documented-responsibilities   | PARTIAL   | Implied by directory names; no formal docs                                               |
| ARCH-C-018 | zero-unused-dependencies                    | PARTIAL   | `forgotPasswordIpLimiter`, `resetPasswordIpLimiter` instantiated for non-existent routes |
| ARCH-C-019 | api-contract-versioning                     | MISSING   | No versioning mechanism; no `/v1/` prefix                                                |
| ARCH-C-020 | repo-structure-documented                   | MISSING   | No `docs/architecture.md`                                                                |

---

### 2.2 AUTH — Authentication Blueprint

| Rule          | Name                                             | Status    | Notes                                                                                                            |
| ------------- | ------------------------------------------------ | --------- | ---------------------------------------------------------------------------------------------------------------- |
| AUTH-T-001    | phished-or-stolen-credentials                    | PARTIAL   | Passkey implemented; password fallback still present                                                             |
| AUTH-T-002    | algorithm-confusion-in-token-verification        | PARTIAL   | HS256 used (not rejected by header); no `alg` header pinning enforcement in `verifyJwt`                          |
| AUTH-T-003    | compromised-admin-account                        | PARTIAL   | Superuser protected by env var; no MFA or dual attribution                                                       |
| AUTH-T-004    | rogue-agent-exceeding-scope                      | COMPLIANT | Delegated tokens with scope='task_result' and task_id binding                                                    |
| AUTH-T-005    | replay-of-intercepted-tokens                     | COMPLIANT | JTI revocation on logout and delegated token use                                                                 |
| AUTH-T-006    | credential-stuffing-brute-force                  | COMPLIANT | Per-IP and per-username rate limiters on login/register                                                          |
| AUTH-T-007    | single-insider-privileged-operation              | MISSING   | No dual-person authorization for privileged operations                                                           |
| AUTH-T-008    | external-auth-provider-outage                    | COMPLIANT | No external auth provider — owned infrastructure                                                                 |
| AUTH-T-009    | session-token-xss-exfiltration                   | PARTIAL   | `HttpOnly` set; but `SameSite=Lax` (should be `Strict`)                                                          |
| AUTH-T-010    | agent-credential-leaked-in-logs                  | COMPLIANT | PII scrub applied to error logs; delegated tokens short-lived                                                    |
| AUTH-P-001    | passkey-first-password-never                     | PARTIAL   | Passkey implemented; password still offered at `POST /api/auth/register` and `login`                             |
| AUTH-P-002    | tokens-opaque-to-browsers                        | PARTIAL   | `HttpOnly` enforced; `SameSite=Lax` instead of `Strict` (`api/auth.ts:209`)                                      |
| AUTH-P-003    | agent-credentials-scoped-and-short-lived         | COMPLIANT | Delegated tokens: 15-minute TTL, task-scoped, single-use                                                         |
| AUTH-P-004    | credential-domains-stay-separate                 | PARTIAL   | Session tokens vs delegated tokens are separate; twin credentials not implemented                                |
| AUTH-P-005    | auth-policy-enforced-through-deterministic-gates | PARTIAL   | Rate limiting and CSRF are deterministic; some routes lack CSRF                                                  |
| IMPL-AUTH-001 | auth-data-in-graph-model                         | PARTIAL   | Users in entities table (graph model); dedicated auth entity types (passkey_credential, agent) partially present |
| IMPL-AUTH-002 | passkey-webauthn-fido2                           | COMPLIANT | Full WebAuthn registration and authentication via `@simplewebauthn/server`                                       |
| IMPL-AUTH-003 | challenge-response-flow                          | COMPLIANT | Challenge stored in DB, deleted on use, single-use enforced                                                      |
| IMPL-AUTH-004 | bip39-recovery-shard                             | PARTIAL   | SUPERUSER_MNEMONIC used as passphrase; no full BIP-39 recovery shard with second factor                          |
| IMPL-AUTH-005 | es256-web-crypto-signing                         | MISSING   | Implementation uses HS256 (HMAC-SHA256), not ES256 (ECDSA) as specified                                          |
| IMPL-AUTH-006 | algorithm-pinning-es256                          | MISSING   | `verifyJwt` does not check the `alg` header; accepts whatever is in the token                                    |
| IMPL-AUTH-007 | token-httponly-cookie                            | PARTIAL   | `HttpOnly` yes; `SameSite=Strict` not enforced (`Lax` used); `Secure` not set on dev cookie                      |
| IMPL-AUTH-008 | token-expiry-1h-rotation                         | MISSING   | Token expiry is 7 days (168 hours), not 1 hour; no refresh rotation mechanism                                    |
| IMPL-AUTH-009 | jti-revocation-table                             | COMPLIANT | `revoked_tokens` table in `packages/db/revocation.ts`; checked on every auth request                             |
| IMPL-AUTH-010 | revocation-cache-ttl-60s                         | MISSING   | No in-memory cache on revocation lookups; every auth request hits the DB                                         |
| IMPL-AUTH-011 | security-revocation-cache-bypass                 | N/A       | No cache to bypass                                                                                               |
| IMPL-AUTH-012 | revocation-entry-expiry-cleanup                  | COMPLIANT | `startRevocationCleanup()` called at startup; cleans expired entries every 24h                                   |

---

### 2.3 DATA — Data Blueprint

| Rule       | Name                                  | Status  | Notes                                                                        |
| ---------- | ------------------------------------- | ------- | ---------------------------------------------------------------------------- |
| DATA-T-001 | backup-exfiltration                   | MISSING | No field-level encryption; backups contain plaintext                         |
| DATA-T-002 | compromised-db-credentials            | MISSING | No application-layer encryption on sensitive fields                          |
| DATA-T-003 | server-root-access-key-exposure       | PARTIAL | Vault provider implemented; dev uses env vars                                |
| DATA-T-004 | rogue-admin-raw-access                | PARTIAL | Audit log exists; no role-based DB access on admin queries                   |
| DATA-T-005 | analytics-reidentification            | MISSING | No analytics tier; no pseudonymization                                       |
| DATA-T-006 | agent-raw-data-access                 | PARTIAL | Worker uses read-only DB role; but no analytics tier — only task queue views |
| DATA-T-007 | single-key-compromise-blast-radius    | MISSING | No per-table key separation                                                  |
| DATA-T-008 | key-compromise-no-rotation            | MISSING | No key rotation procedure implemented                                        |
| DATA-T-009 | ransomware-backup-recovery            | MISSING | No backup strategy visible in repo                                           |
| DATA-T-010 | pii-in-application-logs               | PARTIAL | `scrubPii()` called in error handlers; not applied to all log paths          |
| DATA-T-011 | schema-migration-data-loss            | PARTIAL | Migrations are auto-run; no rollback procedure tested                        |
| DATA-P-001 | separate-analytics-from-transactional | MISSING | `ANALYTICS_DATABASE_URL` maps to the same DB as the app in docker-compose    |
| DATA-P-002 | encryption-in-concentric-layers       | MISSING | No application-layer encryption; no field-level encryption                   |
| DATA-P-003 | data-minimization                     | PARTIAL | Password hashes stored in entities JSONB; PII scrub helper present           |

---

### 2.4 DEPLOY — Deployment Blueprint

| Rule            | Name                                      | Status    | Notes                                                                                            |
| --------------- | ----------------------------------------- | --------- | ------------------------------------------------------------------------------------------------ |
| DEPLOY-T-001    | container-crash-no-restart                | COMPLIANT | `restart: unless-stopped` in docker-compose; k8s Deployment handles restart                      |
| DEPLOY-T-002    | disk-exhaustion-from-unrotated-logs       | PARTIAL   | Logs written to stdout (captured by orchestrator); no explicit log rotation config               |
| DEPLOY-T-003    | invisible-browser-errors                  | MISSING   | No frontend error reporting to server                                                            |
| DEPLOY-T-004    | context-window-filled-by-duplicate-errors | PARTIAL   | `log()` writes to dual files; deduplication not confirmed                                        |
| DEPLOY-T-005    | manual-deploy-steps-block-agent           | COMPLIANT | `deploy.sh` script exists; k8s manifests in repo                                                 |
| DEPLOY-T-006    | secrets-committed-to-repo                 | COMPLIANT | `k8s/secrets.example.yaml` used as template; actual secrets not in repo                          |
| DEPLOY-T-007    | deploy-with-failing-tests                 | PARTIAL   | CI exists; gate enforcement not confirmed in this review                                         |
| DEPLOY-T-008    | unreachable-server-no-diagnosis           | COMPLIANT | `/healthz` and `/health` endpoints; k8s liveness/readiness probes configured                     |
| DEPLOY-T-009    | previous-version-unavailable-for-rollback | PARTIAL   | Git history available; no explicit image tag retention policy                                    |
| DEPLOY-P-001    | containers-are-the-great-unifier          | COMPLIANT | Multi-stage distroless builds for server and worker                                              |
| DEPLOY-P-002    | no-incremental-hot-reloading-dev-servers  | PARTIAL   | `docker-compose.yml` uses `Dockerfile.dev` which may hot-reload; production uses compiled bundle |
| DEPLOY-P-003    | logs-are-for-machines-first               | PARTIAL   | JSON logging in server; some `console.log` strings not structured                                |
| IMPL-DEPLOY-001 | multistage-distroless-container           | COMPLIANT | `Dockerfile` and `Dockerfile.worker` both use builder + distroless pattern                       |
| IMPL-DEPLOY-002 | frozen-lockfile-install                   | COMPLIANT | `bun install --frozen-lockfile` in both Dockerfiles                                              |
| IMPL-DEPLOY-003 | explicit-bun-build                        | COMPLIANT | `bun build apps/server/src/index.ts --target bun --outfile dist/server.js`                       |
| IMPL-DEPLOY-004 | no-process-managers                       | COMPLIANT | No PM2 or systemd; container entrypoint is `bun run dist/server.js`                              |
| IMPL-DEPLOY-005 | production-env-gitignored                 | COMPLIANT | No `.env` committed; secrets example template only                                               |
| IMPL-DEPLOY-006 | test-env-committed                        | MISSING   | No `.env.test` committed (tests use dynamic pg-container URLs)                                   |

---

### 2.5 ENV — Environment Blueprint

| Rule      | Name                                               | Status    | Notes                                                                                             |
| --------- | -------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------- |
| ENV-T-001 | frontend-runtime-build-compromise                  | COMPLIANT | Frontend served as pre-built static files from `web/dist`                                         |
| ENV-T-002 | direct-database-access-by-agent                    | COMPLIANT | Worker has no direct DB write path; claims via API                                                |
| ENV-T-003 | container-immutability-violation                   | COMPLIANT | Distroless images; no package manager in runtime containers                                       |
| ENV-T-004 | topology-parity-divergence                         | PARTIAL   | `docker-compose.yml` uses same images/configs as k8s; all three DBs point to same instance in dev |
| ENV-T-005 | agent-on-local-laptop                              | N/A       | Cloud-host model implied; not enforced by code                                                    |
| ENV-T-006 | state-durability-loss                              | PARTIAL   | Postgres volumes defined; no backup automation                                                    |
| ENV-T-007 | release-gate-bypass                                | PARTIAL   | CI gates exist; enforced at GitHub level (not verified in this review)                            |
| ENV-T-008 | session-continuity-loss                            | N/A       | tmux on host is an ops practice; not code-enforced                                                |
| ENV-T-009 | test-hits-live-database                            | COMPLIANT | Tests use `startPostgres()` ephemeral containers; never hit production DB                         |
| ENV-T-010 | leaked-ephemeral-test-containers                   | COMPLIANT | `afterAll` hook stops containers; pg-container helper handles cleanup                             |
| ENV-P-001 | prototype-is-production                            | PARTIAL   | Same container topology; but three DBs point to one Postgres in dev (not three)                   |
| ENV-P-002 | role-specialized-capability-constrained-containers | COMPLIANT | App, worker, and Postgres are distinct containers with distinct roles                             |
| ENV-P-003 | building-from-source-host-only                     | COMPLIANT | Static build artifacts copied in; runtime images have no build tools                              |

---

### 2.6 PROCESS — Process Blueprint

The PROCESS domain governs the plan-driven agent workflow, not the application code. The repository follows the `.agents/` command structure as defined in `CLAUDE.md`. PROCESS rules are largely N/A from a code review perspective.

| Rule                    | Name                          | Status    | Notes                                                    |
| ----------------------- | ----------------------------- | --------- | -------------------------------------------------------- |
| PROCESS-P-001           | commit-is-unit-of-progress    | COMPLIANT | Conventional commits; history shows incremental progress |
| PROCESS-T-012           | merge-without-required-checks | COMPLIANT | Branch protection and PR flow in use                     |
| All other PROCESS rules | (governance/workflow)         | N/A       | Covered by Plan and `.agents/` commands                  |

---

### 2.7 TASK-QUEUE — Task Queue Blueprint

| Rule     | Name                                      | Status    | Notes                                                                                                            |
| -------- | ----------------------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------- | --- | -------------------------------------------------------- |
| TQ-T-001 | stale-claim-allows-duplicate-execution    | COMPLIANT | Stale claim recovery via `startStaleClaimRecovery()` with audit                                                  |
| TQ-T-002 | payload-leaks-business-data               | COMPLIANT | PII denylist validation in `task-payload-validation.ts`                                                          |
| TQ-T-003 | unbounded-retry-amplifies-failure         | COMPLIANT | `max_attempts` enforced; dead-letter transition on exhaustion                                                    |
| TQ-T-004 | notification-missed-causes-stuck-task     | COMPLIANT | LISTEN/NOTIFY implemented; polling fallback in `task-queue-worker.ts`                                            |
| TQ-T-005 | priority-inversion-starves-tasks          | COMPLIANT | Priority-ordered FIFO; age-based escalation deferred by design                                                   |
| TQ-T-006 | duplicate-task-execution                  | COMPLIANT | `idempotency_key` UNIQUE constraint; `ON CONFLICT DO UPDATE SET idempotency_key = excluded.idempotency_key`      |
| TQ-P-001 | atomic-claim-exactly-one-winner           | COMPLIANT | `UPDATE ... WHERE status = 'pending' RETURNING` in `claimNextTask()`                                             |
| TQ-P-002 | opaque-reference-payloads                 | COMPLIANT | PII denylist validated at enqueue time                                                                           |
| TQ-P-003 | idempotent-task-creation                  | COMPLIANT | `ON CONFLICT (idempotency_key)` returns existing row                                                             |
| TQ-P-004 | bounded-retry-with-dead-letter            | COMPLIANT | `max_attempts` with dead-letter promotion                                                                        |
| TQ-P-005 | notification-assists-polling-not-replaces | COMPLIANT | LISTEN/NOTIFY + poll fallback at 5s interval                                                                     |
| TQ-D-001 | postgres-queue-table                      | COMPLIANT | Single `task_queue` table with required columns including `delegated_token`, `claim_expires_at`, `next_retry_at` |
| TQ-D-002 | status-lifecycle-machine                  | PARTIAL   | Status values defined; API in `tasks-queue.ts` allows any status transition without checking current state       |
| TQ-D-003 | stale-claim-recovery                      | COMPLIANT | `recoverStaleClaims()` runs every 60s; handles both pending-reset and dead-letter                                |
| TQ-D-004 | per-type-filtered-views                   | PARTIAL   | `task_queue_view_coding` created by DB init scripts; not all agent types have views; RLS not confirmed           |
| TQ-D-005 | listen-notify-wake                        | COMPLIANT | `pg_notify` trigger on INSERT; worker LISTEN on `task_queue_<agent_type>` channel                                |
| TQ-D-006 | priority-ordered-fifo                     | COMPLIANT | `ORDER BY priority ASC, created_at ASC` in claim query                                                           |
| TQ-A-001 | single-table-postgres-queue               | COMPLIANT | Single `task_queue` table; no external broker                                                                    |
| TQ-C-001 | claim-atomicity-tested                    | PARTIAL   | Test exists (`task-queue.test.ts`) but concurrent claim test with two workers not confirmed                      |
| TQ-C-002 | stale-recovery-tested                     | COMPLIANT | `stale-claim-recovery.test.ts` exists                                                                            |
| TQ-C-003 | dead-letter-threshold-alerted             | MISSING   | No alerting or metrics on dead-letter queue depth                                                                |
| TQ-C-004 | payload-contains-no-pii                   | COMPLIANT | Integration test verifies PII key rejection                                                                      |
| TQ-C-005 | idempotency-key-enforced                  | COMPLIANT | Integration test verifies same key returns existing task                                                         |
| TQ-C-006 | notification-channel-per-type             | COMPLIANT | Trigger uses `'task*queue*'                                                                                      |     | NEW.agent_type`; worker listens on type-specific channel |
| TQ-C-007 | priority-ordering-verified                | COMPLIANT | Integration test verifies priority ordering                                                                      |
| TQ-C-008 | startup-role-verification-tested          | COMPLIANT | `startup.ts` + `assertReadOnlyRole()` — exits non-zero if INSERT privilege detected                              |

---

### 2.8 TEST — Testing Blueprint

| Rule          | Name                        | Status    | Notes                                                                      |
| ------------- | --------------------------- | --------- | -------------------------------------------------------------------------- |
| TEST-T-001    | environment-parity          | COMPLIANT | Tests run against real Postgres in Docker                                  |
| TEST-T-002    | test-validity               | COMPLIANT | Integration tests hit real server, not mocks                               |
| TEST-T-003    | fixture-accuracy            | N/A       | No external API fixtures needed at this stage                              |
| TEST-T-004    | browser-fidelity            | MISSING   | No Playwright/browser E2E tests; web unit tests use JSDOM                  |
| TEST-T-005    | coverage-completeness       | PARTIAL   | Unit and integration covered; E2E missing; component tests limited         |
| TEST-T-006    | merge-gating                | PARTIAL   | CI exists; gate enforcement assumed                                        |
| TEST-T-007    | test-reliability            | COMPLIANT | Tests use isolated containers; should be deterministic                     |
| TEST-T-008    | test-first-discipline       | PARTIAL   | Some tests exist alongside features; stubs not always written first        |
| TEST-T-009    | failure-diagnosis           | PARTIAL   | Multiple test files; CI workflow separation not confirmed                  |
| TEST-P-001    | prefer-real-systems         | COMPLIANT | Real Postgres containers; no DB mocks                                      |
| TEST-P-002    | fixtures-are-files          | N/A       | No external API fixture recording needed                                   |
| TEST-P-003    | test-on-target              | PARTIAL   | Server tested against real Postgres; browser code tested in JSDOM          |
| TEST-P-004    | tests-before-code           | PARTIAL   | Not consistently evidenced; post-implementation tests appear in some areas |
| IMPL-TEST-001 | vitest-single-driver        | COMPLIANT | Vitest used across all test files                                          |
| IMPL-TEST-002 | playwright-browser-provider | MISSING   | Playwright not configured                                                  |
| IMPL-TEST-003 | bun-runtime-infra-owner     | COMPLIANT | `Bun.spawn` used for server subprocess; pg-container uses Bun APIs         |
| IMPL-TEST-004 | unit-test-location          | COMPLIANT | Unit tests in `tests/unit`                                                 |
| IMPL-TEST-005 | api-integration-location    | COMPLIANT | Integration tests in `tests/integration`                                   |
| IMPL-TEST-006 | component-test-location     | PARTIAL   | Some web unit tests present; no dedicated component test directory         |
| IMPL-TEST-007 | e2e-test-location           | MISSING   | No E2E tests                                                               |
| IMPL-TEST-008 | per-suite-ci-workflows      | PARTIAL   | Not confirmed in this review                                               |

---

### 2.9 UX — UX Blueprint

| Rule        | Name                                       | Status    | Notes                                                                   |
| ----------- | ------------------------------------------ | --------- | ----------------------------------------------------------------------- |
| UX-T-001    | interface-before-service-design            | COMPLIANT | Service APIs defined before UI                                          |
| UX-T-002    | multiple-paths-same-action                 | PARTIAL   | Two task-queue result submission paths exist (code quality issue)       |
| UX-T-003    | admin-ui-afterthought                      | PARTIAL   | Admin API exists; no admin UI beyond raw API calls                      |
| UX-T-004    | agent-no-specified-ux                      | PARTIAL   | Studio API provides structured agent interface; no task-agent UX        |
| UX-T-005    | agent-presence-invisible                   | MISSING   | No user-visible display of agent participation in account               |
| UX-T-006    | beautiful-prototype-replaced               | PARTIAL   | Login component has polished styling; PWA demo page is placeholder only |
| UX-T-007    | design-coupled-to-framework                | PARTIAL   | Tailwind used throughout; component abstractions are thin               |
| UX-T-008    | complexity-exposed-by-default              | COMPLIANT | Simple task list as default view                                        |
| UX-T-009    | agent-scope-undefined                      | MISSING   | No scope UI for agent authorization                                     |
| UX-P-001    | service-delivery-precedes-surface-design   | COMPLIANT | REST API-first; UI maps to API endpoints                                |
| UX-P-002    | one-obvious-path-per-task                  | PARTIAL   | Two task result submission paths violates this                          |
| UX-P-003    | medium-appropriate-interface-per-user-type | PARTIAL   | Human UI and Studio API present; agent UI absent                        |
| IMPL-UX-PWA | pwa-manifest                               | COMPLIANT | `manifest.json` with icons, theme colors, display mode                  |
| IMPL-UX-PWA | service-worker                             | COMPLIANT | `sw.ts` with cache-first/network-first strategy and offline fallback    |
| IMPL-UX-PWA | install-prompt                             | COMPLIANT | Android native banner + iOS guided overlay implemented                  |
| IMPL-UX-PWA | platform-detection                         | COMPLIANT | `usePlatform()` hook with OS/browser/standalone detection               |
| IMPL-UX-PWA | demo-page                                  | PARTIAL   | Cards implemented in components but not imported into `pwa-demo.tsx`    |

---

### 2.10 WORKER — Worker Blueprint

| Rule         | Name                                   | Status    | Notes                                                                                                   |
| ------------ | -------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------- |
| WORKER-T-001 | direct-db-write-bypasses-validation    | COMPLIANT | Worker has no DB write path; results via API                                                            |
| WORKER-T-002 | compromised-credential-grants-db-write | COMPLIANT | Agent DB role is read-only; `assertReadOnlyRole()` verified at startup                                  |
| WORKER-T-003 | agent-reads-unauthorized-data          | PARTIAL   | Read-only DB role; per-type views exist for `coding`; not confirmed for all agent types                 |
| WORKER-T-004 | stale-task-claim                       | COMPLIANT | Atomic claim; delegated token single-use prevents duplicate submission                                  |
| WORKER-T-005 | delegated-token-outlives-task          | COMPLIANT | JTI revocation on use; 15-minute TTL                                                                    |
| WORKER-T-006 | agent-impersonates-different-user      | COMPLIANT | Token's `sub` matched against `task.created_by` in `verifyDelegatedToken`                               |
| WORKER-T-007 | container-shell-access                 | COMPLIANT | Distroless production image; no shell                                                                   |
| WORKER-T-008 | cross-agent-type-access                | COMPLIANT | Token's `agent_type` matched against task row; per-type DB views                                        |
| WORKER-T-009 | vendor-api-key-leak                    | PARTIAL   | API keys in Kubernetes Secrets; rotation schedule not documented                                        |
| WORKER-T-010 | vendor-cli-data-exfiltration           | PARTIAL   | Network policies restrict outbound; no audit log of CLI calls                                           |
| WORKER-P-001 | read-only-database-access              | COMPLIANT | Read-only DB role; startup check enforced                                                               |
| WORKER-P-002 | writes-through-authenticated-api       | COMPLIANT | Worker submits results via `POST /api/tasks/:id/result` with Bearer token                               |
| WORKER-P-003 | deployment-time-capability-declaration | COMPLIANT | `AGENT_TYPE`, `AGENT_DATABASE_URL` declared in k8s Deployment spec                                      |
| WORKER-P-004 | distroless-with-explicit-allowances    | COMPLIANT | Distroless runtime; no shell, no package manager                                                        |
| WORKER-P-005 | deterministic-policy-gates             | COMPLIANT | `assertReadOnlyRole()` is deterministic gate on startup                                                 |
| WORKER-P-006 | single-use-task-scoped-tokens          | COMPLIANT | JTI revoked on first use; 15-min TTL                                                                    |
| WORKER-P-007 | simulation-in-digital-twins            | MISSING   | No digital twin implementation                                                                          |
| WORKER-P-008 | agent-type-isolation                   | COMPLIANT | Per-type DB roles, views, k8s Secrets                                                                   |
| WORKER-D-001 | task-queue-read-only-view              | PARTIAL   | View `task_queue_view_coding` exists in init scripts; dynamic agent type support not confirmed          |
| WORKER-D-002 | delegated-user-token                   | COMPLIANT | Full implementation in `auth/delegated-token.ts`                                                        |
| WORKER-D-003 | signed-transaction-intent              | MISSING   | Not implemented; `data-governance.ts` stub throws                                                       |
| WORKER-D-004 | vendor-binary-process-spawn            | COMPLIANT | `spawn(CODEX_PATH, ['--json-result'], { shell: false })`                                                |
| WORKER-D-005 | worker-credential-encryption           | PARTIAL   | `worker-credentials.ts` in db package implements encryption; key management via `ENCRYPTION_MASTER_KEY` |

---

## 3. Critical Gaps (MISSING Rules That Are High-Risk)

1. **IMPL-AUTH-005/006 — ES256 algorithm not implemented; `alg` header not pinned.**
   Implementation uses HS256 (HMAC-SHA256). The blueprint specifies ES256 (ECDSA P-256). The `verifyJwt` function in `apps/server/src/auth/jwt.ts:68` does not validate the `alg` header at all, meaning a token with `alg: none` or `alg: HS512` would pass signature verification or fail with an unhelpful error, not a security rejection. This is AUTH-T-002 partially unmitigated.

2. **IMPL-AUTH-007/008 — SameSite=Lax, 7-day TTL, no session rotation.**
   Cookie is `SameSite=Lax` (should be `Strict`). Token TTL is 7 days (168h) rather than 1 hour. No refresh rotation mechanism. This exposes long-lived sessions to CSRF attacks on cross-origin navigations and reduces the blast radius of token exfiltration to 7 days instead of 1 hour.

3. **DATA-P-001/002 — No three-database separation; no field-level encryption.**
   All three DB URLs (`DATABASE_URL`, `AUDIT_DATABASE_URL`, `ANALYTICS_DATABASE_URL`) point to the same Postgres instance in docker-compose. No application-layer encryption on any sensitive fields. Backup exfiltration yields plaintext.

4. **WORKER-D-003 / WORKER-P-007 — Signed transaction intent and digital twins not implemented.**
   `data-governance.ts` stubs throw at runtime. Consequential writes flow through the `task-write-service.ts` helper (which does write to the DB through the API boundary) but without the signed intent layer.

5. **TQ-C-003 — Dead-letter alerting absent.**
   No metrics collection or alerting on `task_queue WHERE status = 'dead'`. Silent dead-letter accumulation is undetectable without manual queries.

6. **ARCH-C-009 / IMPL-TEST-002 — Playwright not configured.**
   No browser E2E tests; web components tested only in JSDOM (vitest-environment: jsdom). Browser-specific behavior (PWA install prompt, camera, notifications) cannot be verified.

---

## 4. Partial Implementations Needing Completion

1. **Auth cookie hardening** (`api/auth.ts:209`, `api/passkey.ts:305`) — Change `SameSite=Lax` to `SameSite=Strict`; reduce TTL from 168h to 1h; implement token refresh rotation.

2. **JWT algorithm pinning** (`auth/jwt.ts:68`) — Add `alg` header check in `verifyJwt`; reject anything other than `HS256` (or migrate to ES256 per spec).

3. **pwa-demo.tsx card injection** (`pages/pwa-demo.tsx:57`) — Import the six implemented demo card components into the page grid.

4. **tasks-queue.ts schema validation** (`api/tasks-queue.ts:55`) — Replace manual field checks with AJV `validate()` and a proper JSON Schema, consistent with `tasks.ts`.

5. **Three-DB separation** (`docker-compose.yml`) — Separate Postgres instances for transactional, audit, and analytics tiers, even in dev, to catch cross-tier access issues early.

6. **Studio route authentication** (`api/studio.ts:26`) — All `/studio/*` routes require an authenticated session; currently entirely open.

7. **Task status transition validation** (`api/task-queue.ts:82`) — Validate that the task is in an acceptable state before writing `completed`.

8. **`isSuperuser()` deduplication** — Extract to shared location in `core` or a new `auth` module.
