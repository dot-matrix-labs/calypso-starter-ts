# Code Review Analysis Plan

**Date:** 2026-03-23
**Scope:** All commits merged in the last 3 days (PWA, worker, security, ops, studio)
**Analyst:** Claude Code (claude-sonnet-4-6)

---

## Objective

Produce four written reports covering:

1. **Code Quality** — duplications, inefficiencies, incomplete implementations
2. **Blueprint Compliance** — rule-by-rule check against `calypso-blueprint/rules/`
3. **Beyond Blueprint** — what we improved over the spec, and what we discovered/invented
4. **Enterprise Frontier** — gap analysis for COO/CIO/CTO/CISO readiness

---

## Inputs

| Source                                                   | Purpose                                                                                            |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `calypso-blueprint/rules/blueprints/*.yaml`              | Canonical domain blueprints (ARCH, AUTH, DATA, DEPLOY, ENV, PROCESS, TASK-QUEUE, TEST, UX, WORKER) |
| `calypso-blueprint/rules/implementations/ts/*.yaml`      | TypeScript implementation rules                                                                    |
| `apps/server/src/`                                       | Server-side source                                                                                 |
| `apps/web/src/`                                          | Client-side source                                                                                 |
| `apps/server/tests/`                                     | Integration + unit tests                                                                           |
| `apps/web/tests/`                                        | Component + unit tests                                                                             |
| `packages/`                                              | Shared packages                                                                                    |
| `scripts/`                                               | Build, deploy, worker scripts                                                                      |
| `docker-compose.yml`, `Dockerfile*`, `k8s/`, `deploy.sh` | Infra/ops layer                                                                                    |
| `git log --since="3 days ago"`                           | Recent commit scope                                                                                |

---

## Analysis Steps

### Phase 1 — Orientation (done)

- [x] Read repo structure
- [x] Read all blueprint YAML rules
- [x] Identify all source files (140 TS/TSX files)
- [x] Map blueprint domains to implementation directories

### Phase 2 — Code Quality Scan

For each domain (server API, auth, worker, PWA, ops):

- Scan for duplicated logic across files
- Identify TODOs, stubs, commented-out code, placeholder implementations
- Flag inefficient patterns (N+1 queries, unguarded awaits, missing error paths)
- Check for type safety gaps (`any`, non-null assertions, untyped catch)
- Verify each API route has matching validation and test coverage

**Files to inspect:** all `apps/server/src/api/*.ts`, `apps/server/src/policies/*.ts`, `apps/server/src/auth/*.ts`, `apps/web/src/components/**`, `apps/web/src/hooks/`

### Phase 3 — Blueprint Compliance Matrix

Walk every rule in each blueprint YAML. For each rule:

- **COMPLIANT** — implementation exists, matches the rule's intent
- **PARTIAL** — implemented but with gaps noted
- **MISSING** — no implementation found
- **N/A** — rule does not apply to this project scope

Domains to check:

1. `ARCH` / `IMPL-ARCH` — monorepo structure, runtime, dependency discipline
2. `AUTH` / `IMPL-AUTH` — passkey, JWT, CSRF, revocation, delegation
3. `DATA` / `IMPL-DATA` — three-pool DB, migrations, PII scrubbing, encryption
4. `DEPLOY` / `IMPL-DEPLOY` — Dockerfile, k8s, health gates, smoke tests
5. `ENV` / `IMPL-ENV` — secrets management, env var discipline
6. `PROCESS` / `IMPL-PROCESS` — audit logging, trace IDs, rate limiting
7. `TASK-QUEUE` — schema, write boundary, payload validation, worker isolation
8. `TEST` / `IMPL-TEST` — test structure, pg-container, coverage
9. `UX` / `IMPL-UX` — PWA, platform detection, offline, install
10. `WORKER` / `IMPL-WORKER` — LISTEN/NOTIFY, containerised runner, credential isolation

### Phase 4 — Beyond Blueprint

**A. Improvements over spec:**
Where the implementation exceeded, hardened, or refined the blueprint's stated intent.

**B. Unspecified discoveries:**
Features, patterns, or safeguards developed during implementation that the blueprint did not anticipate — candidates for back-porting to the blueprint.

### Phase 5 — Enterprise Frontier Gap Analysis

Assess the current state against the concerns of:

- **COO** — operational visibility, uptime SLAs, runbooks, alerting, cost control
- **CIO** — data governance, compliance (SOC 2, GDPR, ISO 27001 posture), integrations, DR/BCP
- **CTO** — scalability headroom, tech debt index, developer experience, platform extensibility
- **CISO** — threat surface, secret hygiene, audit completeness, incident response, penetration readiness

---

## Outputs

| File                                     | Content                                                                    |
| ---------------------------------------- | -------------------------------------------------------------------------- |
| `docs/review/01-code-quality.md`         | Duplications, inefficiencies, incomplete implementations, type-safety gaps |
| `docs/review/02-blueprint-compliance.md` | Rule-by-rule compliance matrix                                             |
| `docs/review/03-beyond-blueprint.md`     | Improvements over spec; unspecified discoveries                            |
| `docs/review/04-enterprise-frontier.md`  | Gap analysis for COO/CIO/CTO/CISO                                          |

---

## Conventions

- Reference file paths as `apps/server/src/api/foo.ts:42` for traceability.
- Use severity tags: **[CRITICAL]**, **[HIGH]**, **[MEDIUM]**, **[LOW]**, **[INFO]**.
- Blueprint rule references use the form `IMPL-AUTH-003`.
- All findings are factual and traced to specific code or missing code.
