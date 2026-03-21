# Secrets Management

## What it is

A provider abstraction for loading secrets at startup, with two backends: environment
variables (default) and HashiCorp Vault KV v2. A `bootstrap.ts` entrypoint ensures secrets
are loaded before any module that reads them at import time.

## Why it's needed

The server currently reads secrets directly from `process.env` at module load time. This
creates two problems:

1. **Ordering fragility** — `packages/db/index.ts` creates connection pools at module scope.
   If any other module imports it before secrets are populated, the pools connect to wrong
   URLs. The order of imports becomes a hidden correctness constraint.

2. **No Vault path** — there is no way to load secrets from Vault or another provider without
   restructuring the entire startup sequence.

## Provider interface

```ts
interface SecretsProvider {
  get(key: string): Promise<string | undefined>;
  getRequired(key: string): Promise<string>;
}
```

Two implementations:

- **`EnvSecretsProvider`** — reads from `process.env`. Backward-compatible default.
- **`VaultSecretsProvider`** — fetches from Vault KV v2 via `fetch`. Caches results with a
  configurable TTL (default: 5 minutes). Falls back to stale cache or env on connection
  error.

## Startup sequence

`bootstrap.ts` is the new server entrypoint:

```ts
await initSecrets(); // loads all known secrets into synchronous cache
const server = await import('./index.js'); // DB pools created here — env vars are ready
export default server.default;
```

`initSecrets()` pre-loads all known secrets and writes DB URL secrets back to `process.env`
so that module-scope `postgres()` calls see the correct values.

After `initSecrets()`, `getSecret(key)` and `requireSecret(key)` are synchronous reads from
the in-memory cache — no async overhead on the hot path.

## Configuration

| Env var             | Purpose                                                |
| ------------------- | ------------------------------------------------------ |
| `VAULT_ADDR`        | Vault server URL. If unset, uses `EnvSecretsProvider`. |
| `VAULT_TOKEN`       | Vault token. Required if `VAULT_ADDR` is set.          |
| `VAULT_SECRET_PATH` | KV v2 path (default: `secret/data/calypso`)            |
| `VAULT_TTL_MS`      | Cache TTL in milliseconds (default: 300000)            |

## Source reference (rinzler)

`packages/db/secrets.ts` — copy verbatim, remove rinzler-specific secret names from
`KNOWN_SECRETS`.
`apps/server/src/bootstrap.ts` — copy verbatim.
`packages/db/tests/secrets.test.ts` — unit tests for both providers.

## Files to create / modify

- `packages/db/secrets.ts`
- `apps/server/src/bootstrap.ts`
- `packages/db/tests/secrets.test.ts`
- `package.json` — update `start` script to run `bootstrap.ts` instead of `index.ts`
