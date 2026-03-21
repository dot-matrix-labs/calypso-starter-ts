# CI Release Pipeline Hardening

## What it is

Improvements to the release workflow that add a migration gate, container smoke test,
parallel test stages, idempotent asset upload, and a health endpoint — ensuring a published
release is known-good before it reaches users.

## Why it's needed

The current release workflow creates a GitHub release and runs tests, but:

- A broken migration is not caught until the container starts in production.
- The container is not tested after it is built.
- Re-running the workflow on the same tag fails due to duplicate asset upload errors.
- Test stages run sequentially, extending CI time unnecessarily.

## Changes

### `GET /healthz` endpoint

```json
{ "status": "ok", "version": "1.2.3" }
```

Added to `apps/server/src/index.ts`. Used by k8s liveness/readiness probes and the CI
smoke test.

### Parallel test stages

Unit, API, E2E, component, and migration test stages run in parallel (no shared resources):

```yaml
jobs:
  test-unit: ...
  test-api: ...
  test-e2e: ...
  test-component: ...
  test-migration: ...

  build-container:
    needs: [test-unit, test-api, test-e2e, test-component, test-migration]
```

### Migration gate

The `test-migration` job (see `docs/migration-smoke-tests.md`) must pass before
`build-container` begins. A migration syntax error fails the release before any container
is built.

### Container smoke test

After `docker build`, before publishing to GHCR:

```yaml
- name: Start container
  run: docker compose -f docker-compose.ci.yml up -d
- name: Health check
  run: |
    for i in $(seq 1 30); do
      curl -sf http://localhost:3000/healthz && break
      sleep 1
    done
- name: Push to GHCR
  run: docker push ghcr.io/${{ github.repository }}:${{ github.ref_name }}
```

If the container fails the health check, the workflow fails before publishing.

### Idempotent release asset upload

Replace the existing upload action with a delete-then-create pattern:

```yaml
- name: Delete existing release assets
  run: gh release delete-asset $TAG web-dist.tar.gz 2>/dev/null || true
- name: Upload release asset
  run: gh release upload $TAG web-dist.tar.gz
```

Re-running the workflow on the same tag (e.g. after a flaky test) no longer fails due to
duplicate assets.

### Digest-pinned base image

The Dockerfile uses a digest-pinned Bun base image:

```dockerfile
FROM oven/bun:1.1@sha256:<digest>
```

Prevents silent upstream base image changes from altering production behaviour.

## Source reference (rinzler)

`.github/workflows/release.yml` PR #76 changes — extract the structural improvements,
discard rinzler-specific build steps (frontend bundle, etc.).
