/**
 * @file secrets/index
 * Module-level secrets registry.
 *
 * Call `initSecrets()` once at server startup (before any module that consumes
 * DB URLs or other env-backed secrets is imported). After init, `getSecret()`
 * and `requireSecret()` are synchronous reads from the in-memory cache.
 *
 * Usage:
 *   await initSecrets();      // pre-loads all known secrets
 *   const val = getSecret('MY_KEY');  // synchronous, no async overhead
 */

export { EnvSecretsProvider, VaultSecretsProvider } from './provider';
export type { SecretsProvider, VaultSecretsProviderOptions } from './provider';

import { EnvSecretsProvider, VaultSecretsProvider } from './provider';
import type { SecretsProvider } from './provider';

/** Keys that are pre-loaded during `initSecrets()` and written back to process.env */
const DB_URL_KEYS = ['DATABASE_URL', 'AUDIT_DATABASE_URL', 'ANALYTICS_DATABASE_URL'] as const;

/** All secret keys that are pre-loaded into the cache at startup */
const KNOWN_KEYS = [
  ...DB_URL_KEYS,
  'JWT_SECRET',
  'VAULT_TOKEN',
  'SUPERUSER_EMAIL',
  'SUPERUSER_PASSWORD',
  'SUPERUSER_MNEMONIC',
] as const;

let provider: SecretsProvider | null = null;
const cache = new Map<string, string>();

/**
 * Initialise the secrets subsystem.
 *
 * - When `VAULT_ADDR` is set, a `VaultSecretsProvider` is created using
 *   `VAULT_TOKEN` and the optional `VAULT_MOUNT` / `VAULT_PATH` env vars.
 * - Otherwise, an `EnvSecretsProvider` is used (backward-compatible default).
 *
 * After pre-loading, DB URL secrets are written back to `process.env` so that
 * any code that reads those env vars at module scope (e.g. the `db` package's
 * `resolveDatabaseUrls()`) will see the correct values.
 */
export async function initSecrets(): Promise<void> {
  if (process.env.VAULT_ADDR) {
    const token = process.env.VAULT_TOKEN ?? '';
    provider = new VaultSecretsProvider({
      addr: process.env.VAULT_ADDR,
      token,
      mount: process.env.VAULT_MOUNT,
      path: process.env.VAULT_PATH,
    });
    console.log(`[secrets] Using VaultSecretsProvider (${process.env.VAULT_ADDR})`);
  } else {
    provider = new EnvSecretsProvider();
    console.log('[secrets] Using EnvSecretsProvider');
  }

  // Pre-load all known keys
  await Promise.all(
    KNOWN_KEYS.map(async (key) => {
      try {
        const value = await provider!.get(key);
        if (value !== undefined) {
          cache.set(key, value);
        }
      } catch {
        // Non-fatal: key may simply not be configured
      }
    }),
  );

  // Write DB URLs back to process.env so module-scope pool constructors see them
  for (const key of DB_URL_KEYS) {
    const value = cache.get(key);
    if (value !== undefined) {
      process.env[key] = value;
    }
  }

  console.log(`[secrets] Initialised with ${cache.size} cached secret(s)`);
}

/**
 * Synchronous read from the in-memory cache. Returns `undefined` if the key
 * was not pre-loaded during `initSecrets()`.
 *
 * This is safe to call on the hot path — no I/O is performed.
 */
export function getSecret(key: string): string | undefined {
  return cache.get(key);
}

/**
 * Synchronous read from the in-memory cache. Throws if the key is absent.
 */
export function requireSecret(key: string): string {
  const value = cache.get(key);
  if (value === undefined) {
    throw new Error(
      `[secrets] Required secret "${key}" is not in cache. Ensure initSecrets() was called before this module.`,
    );
  }
  return value;
}

/** Exposed for testing only — resets internal state. */
export function _resetSecretsForTest(): void {
  provider = null;
  cache.clear();
}

/** Exposed for testing only — seeds a value directly into the cache. */
export function _seedSecretForTest(key: string, value: string): void {
  cache.set(key, value);
}
