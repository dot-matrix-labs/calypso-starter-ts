# Docker Containerisation

## What it is

Three Dockerfiles covering dev, production, and release scenarios, plus a `docker-compose.yml`
that gives any developer a working local environment with a single command.

## Why it's needed

Without Docker support, every developer must manually install the correct Bun version, run a
local PostgreSQL, configure environment variables, and run migrations. This raises the barrier
to contribution and makes "works on my machine" bugs common. CI also has no reproducible
build artifact.

## Files

### `Dockerfile.dev`

Used by `docker-compose.yml` for local development:

- Installs dependencies.
- Mounts source directory as a volume for hot-reload.
- Entrypoint: `scripts/dev-entrypoint.sh`.

### `Dockerfile`

Production image:

- Two-stage build (deps layer → app layer).
- Uses a digest-pinned Bun base image to prevent silent upstream changes.
- Entrypoint: `bun run bootstrap.ts` (secrets init before server start).

### `Dockerfile.release`

Release image (built by CI):

- Bakes the frontend `apps/web/dist` (Vite build output) into the image.
- Used for the published GHCR image.

### `docker-compose.yml`

```yaml
services:
  app:
    build: { context: ., dockerfile: Dockerfile.dev }
    volumes: ['.:/app']
    depends_on: [postgres]
    environment:
      DATABASE_URL: postgres://app_rw:app_rw_password@postgres:5432/calypso_app

  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
```

`docker compose up` is a zero-config first-run experience.

### `scripts/dev-entrypoint.sh`

Container startup sequence:

1. Wait for PostgreSQL to accept connections (TCP loop).
2. Run `bun run migrate` (idempotent).
3. If a sentinel file does not exist, run seed script and create sentinel.
4. `exec bun --hot run src/index.ts` (hot-reload in dev).

## Digest-pinned base image

The production Dockerfile pins the Bun base image by digest:

```dockerfile
FROM oven/bun:1.1@sha256:<digest> AS base
```

This prevents a silent upstream image change from altering production behaviour between
builds.

## Source reference (rinzler)

`Dockerfile`, `Dockerfile.dev`, `Dockerfile.release`, `scripts/dev-entrypoint.sh` —
copy and adapt. Remove rinzler-specific seed data from the entrypoint.

## Files to create

- `Dockerfile`
- `Dockerfile.dev`
- `Dockerfile.release`
- `docker-compose.yml`
- `scripts/dev-entrypoint.sh`
- `.dockerignore`
