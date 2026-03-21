# Migration Smoke Tests

## What it is

A dedicated vitest configuration that runs the database schema migration against a fresh
PostgreSQL container and asserts idempotence. Runs as a required CI gate before the container
build step.

## Why it's needed

`migrate()` runs at server startup. Without a dedicated test, a SQL syntax error or broken
constraint is not caught until the container starts in production — potentially after a
release has been tagged and published. Catching migration failures before the container is
built prevents deploying dead-on-arrival releases.

## What the test does

```
vitest.migration.config.ts
└── tests/migration/migrate.test.ts
    1. Spin up a fresh Postgres via pg-container.ts
    2. Call migrate()
    3. Assert all expected tables exist in information_schema
    4. Call migrate() a second time — assert no errors (idempotence)
    5. Tear down the container
```

The table list to assert is maintained alongside the test and should be updated whenever
`schema.sql` changes.

## `package.json` script

```json
"test:migration": "vitest run --config vitest.migration.config.ts"
```

## CI gate

In `.github/workflows/release.yml`, a `migration-test` job runs before the container build:

```yaml
jobs:
  migration-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: bun install
      - run: bun run test:migration

  build-container:
    needs: [migration-test, unit-tests, api-tests]
    ...
```

If `migration-test` fails, the release workflow stops before building or publishing the
container.

## What it catches

- SQL syntax errors in `schema.sql`
- Duplicate column definitions
- Missing `IF NOT EXISTS` guards (non-idempotent migrations)
- Broken foreign key references
- Missing extensions (e.g. `pgcrypto`)

## What it does NOT test

- Data migrations (row transformations between schema versions)
- Rollback behaviour
- Performance of queries against a populated database

## Source reference (rinzler)

`vitest.migration.config.ts` and the migration test suite — adapt for the starter's schema.
