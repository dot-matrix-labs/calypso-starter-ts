/**
 * @file provider
 * Core secrets provider abstraction.
 *
 * `SecretsProvider` is the interface every backend must implement. The two
 * concrete implementations are:
 *  - EnvSecretsProvider  — reads directly from process.env (default/dev)
 *  - VaultSecretsProvider — fetches from Vault KV v2 with a TTL cache
 */

export interface SecretsProvider {
  /**
   * Returns the value for `key`, or `undefined` if not set.
   */
  get(key: string): Promise<string | undefined>;

  /**
   * Returns the value for `key`. Throws if the key is absent or empty.
   */
  getRequired(key: string): Promise<string>;
}

/**
 * Reads secrets directly from `process.env`. This is the backward-compatible
 * default used when `VAULT_ADDR` is not set.
 */
export class EnvSecretsProvider implements SecretsProvider {
  async get(key: string): Promise<string | undefined> {
    const value = process.env[key];
    return value === '' ? undefined : value;
  }

  async getRequired(key: string): Promise<string> {
    const value = await this.get(key);
    if (value === undefined) {
      throw new Error(`[secrets] Required secret "${key}" is not set in environment`);
    }
    return value;
  }
}

export interface VaultSecretsProviderOptions {
  /** Vault address, e.g. http://vault:8200 */
  addr: string;
  /** Vault token for authentication */
  token: string;
  /** KV v2 mount path (default: "secret") */
  mount?: string;
  /** Secret path within the mount (default: "calypso") */
  path?: string;
  /** Cache TTL in milliseconds (default: 300_000 = 5 minutes) */
  ttlMs?: number;
}

interface CacheEntry {
  value: string;
  expiresAt: number;
}

/**
 * Fetches secrets from Vault KV v2, caches results per key with a configurable
 * TTL, and falls back to stale cache or `process.env` on connection errors.
 */
export class VaultSecretsProvider implements SecretsProvider {
  private readonly addr: string;
  private readonly token: string;
  private readonly mount: string;
  private readonly path: string;
  private readonly ttlMs: number;
  private readonly cache = new Map<string, CacheEntry>();

  constructor(opts: VaultSecretsProviderOptions) {
    this.addr = opts.addr.replace(/\/$/, '');
    this.token = opts.token;
    this.mount = opts.mount ?? 'secret';
    this.path = opts.path ?? 'calypso';
    this.ttlMs = opts.ttlMs ?? 300_000;
  }

  private isFresh(entry: CacheEntry): boolean {
    return Date.now() < entry.expiresAt;
  }

  async get(key: string): Promise<string | undefined> {
    // Return fresh cache hit immediately
    const cached = this.cache.get(key);
    if (cached && this.isFresh(cached)) {
      return cached.value;
    }

    try {
      const url = `${this.addr}/v1/${this.mount}/data/${this.path}`;
      const res = await fetch(url, {
        headers: { 'X-Vault-Token': this.token },
      });

      if (!res.ok) {
        throw new Error(`Vault returned HTTP ${res.status}`);
      }

      const body = (await res.json()) as { data?: { data?: Record<string, string> } };
      const data = body?.data?.data ?? {};

      // Repopulate the cache for all returned keys
      const now = Date.now();
      for (const [k, v] of Object.entries(data)) {
        if (typeof v === 'string') {
          this.cache.set(k, { value: v, expiresAt: now + this.ttlMs });
        }
      }

      const fresh = this.cache.get(key);
      return fresh ? fresh.value : undefined;
    } catch (err) {
      console.warn(`[secrets] Vault fetch failed for key "${key}":`, (err as Error).message);

      // Fall back to stale cache if available
      if (cached) {
        console.warn(`[secrets] Using stale cache for key "${key}"`);
        return cached.value;
      }

      // Last resort: process.env
      const envValue = process.env[key];
      return envValue === '' ? undefined : envValue;
    }
  }

  async getRequired(key: string): Promise<string> {
    const value = await this.get(key);
    if (value === undefined) {
      throw new Error(`[secrets] Required secret "${key}" could not be resolved from Vault or env`);
    }
    return value;
  }
}
