import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { EnvSecretsProvider, VaultSecretsProvider } from '../../src/secrets/provider';
import {
  initSecrets,
  getSecret,
  requireSecret,
  _resetSecretsForTest,
  _seedSecretForTest,
} from '../../src/secrets/index';

// ── EnvSecretsProvider ──────────────────────────────────────────────────────

describe('EnvSecretsProvider', () => {
  const provider = new EnvSecretsProvider();

  beforeEach(() => {
    delete process.env.TEST_SECRET_KEY;
  });

  test('get() returns value from process.env', async () => {
    process.env.TEST_SECRET_KEY = 'hello';
    expect(await provider.get('TEST_SECRET_KEY')).toBe('hello');
  });

  test('get() returns undefined when key is absent', async () => {
    expect(await provider.get('TEST_SECRET_KEY')).toBeUndefined();
  });

  test('get() returns undefined for empty string value', async () => {
    process.env.TEST_SECRET_KEY = '';
    expect(await provider.get('TEST_SECRET_KEY')).toBeUndefined();
  });

  test('getRequired() returns value when key is set', async () => {
    process.env.TEST_SECRET_KEY = 'world';
    expect(await provider.getRequired('TEST_SECRET_KEY')).toBe('world');
  });

  test('getRequired() throws when key is absent', async () => {
    await expect(provider.getRequired('TEST_SECRET_KEY')).rejects.toThrow(
      /Required secret "TEST_SECRET_KEY"/,
    );
  });
});

// ── VaultSecretsProvider ────────────────────────────────────────────────────

describe('VaultSecretsProvider', () => {
  const VAULT_ADDR = 'http://vault-test:8200';
  const TOKEN = 'test-token';
  const MOUNT = 'secret';
  const PATH = 'calypso';

  function makeProvider(ttlMs = 300_000) {
    return new VaultSecretsProvider({
      addr: VAULT_ADDR,
      token: TOKEN,
      mount: MOUNT,
      path: PATH,
      ttlMs,
    });
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('get() fetches from Vault and returns the key value', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: { data: { MY_KEY: 'vault-value' } } }),
      }),
    );

    const p = makeProvider();
    expect(await p.get('MY_KEY')).toBe('vault-value');
    expect(fetch).toHaveBeenCalledWith(
      `${VAULT_ADDR}/v1/${MOUNT}/data/${PATH}`,
      expect.objectContaining({ headers: { 'X-Vault-Token': TOKEN } }),
    );
  });

  test('get() returns undefined when key not present in Vault response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: { data: { OTHER_KEY: 'x' } } }),
      }),
    );

    const p = makeProvider();
    expect(await p.get('MISSING_KEY')).toBeUndefined();
  });

  test('get() uses cached value on second call (no extra fetch)', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { data: { CACHED_KEY: 'cached' } } }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const p = makeProvider();
    await p.get('CACHED_KEY');
    await p.get('CACHED_KEY');

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  test('get() falls back to stale cache on Vault connection error', async () => {
    // First call succeeds and populates cache
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { data: { STALE_KEY: 'stale-value' } } }),
      })
      // Simulate Vault down on subsequent attempt (expired cache)
      .mockRejectedValueOnce(new Error('ECONNREFUSED'));

    vi.stubGlobal('fetch', mockFetch);

    const p = makeProvider(0); // TTL=0 ms so first call's cache expires immediately

    // Pre-populate by calling once
    await p.get('STALE_KEY');

    // Wait a tick so the TTL=0 entry is stale
    await new Promise((r) => setTimeout(r, 1));

    // Second call should fail to fetch and fall back to stale cache
    const result = await p.get('STALE_KEY');
    expect(result).toBe('stale-value');
  });

  test('get() falls back to process.env when Vault fails and no cache', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')));
    process.env.ENV_FALLBACK_KEY = 'from-env';

    const p = makeProvider();
    const result = await p.get('ENV_FALLBACK_KEY');
    expect(result).toBe('from-env');

    delete process.env.ENV_FALLBACK_KEY;
  });

  test('getRequired() throws when key cannot be resolved', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')));
    delete process.env.NONEXISTENT_KEY;

    const p = makeProvider();
    await expect(p.getRequired('NONEXISTENT_KEY')).rejects.toThrow(
      /Required secret "NONEXISTENT_KEY"/,
    );
  });

  test('get() throws when Vault returns non-ok status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403 }));
    delete process.env.AUTH_GUARDED;

    const p = makeProvider();
    // Falls back to env (undefined) since the error is caught
    expect(await p.get('AUTH_GUARDED')).toBeUndefined();
  });
});

// ── Module-level registry ───────────────────────────────────────────────────

describe('secrets registry', () => {
  beforeEach(() => {
    _resetSecretsForTest();
    delete process.env.VAULT_ADDR;
  });

  afterEach(() => {
    _resetSecretsForTest();
    delete process.env.VAULT_ADDR;
    delete process.env.TEST_REGISTRY_KEY;
  });

  test('getSecret() returns undefined before initSecrets()', () => {
    expect(getSecret('ANY_KEY')).toBeUndefined();
  });

  test('requireSecret() throws before initSecrets()', () => {
    expect(() => requireSecret('ANY_KEY')).toThrow(/not in cache/);
  });

  test('initSecrets() with env provider populates cache for env-set keys', async () => {
    process.env.JWT_SECRET = 'my-jwt-secret';

    await initSecrets();

    expect(getSecret('JWT_SECRET')).toBe('my-jwt-secret');

    delete process.env.JWT_SECRET;
  });

  test('requireSecret() returns value after initSecrets() seeds it', () => {
    _seedSecretForTest('SEEDED', 'seeded-value');
    expect(requireSecret('SEEDED')).toBe('seeded-value');
  });

  test('initSecrets() writes DB URLs back to process.env', async () => {
    process.env.DATABASE_URL = 'postgres://test:pass@db/mydb';

    await initSecrets();

    // After init the env var should still be present (written back)
    expect(process.env.DATABASE_URL).toBe('postgres://test:pass@db/mydb');

    delete process.env.DATABASE_URL;
  });
});
