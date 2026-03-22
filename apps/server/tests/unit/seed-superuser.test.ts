import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { _resetSecretsForTest, _seedSecretForTest } from '../../src/secrets/index';
import { seedSuperuser, type SeedSuperuserOptions } from '../../src/seed/superuser';

type MockSql = SeedSuperuserOptions['sql'];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface MakeSqlOptions {
  selectResult?: unknown[];
}

/** Minimal fake SQL tagged-template that records inserts. */
function makeSql(overrides: MakeSqlOptions = {}) {
  const insertedRows: unknown[] = [];

  const fn = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
    const raw = strings.join('?');

    if (raw.trim().toUpperCase().startsWith('SELECT')) {
      return Promise.resolve(overrides.selectResult ?? []);
    }

    // INSERT / other
    insertedRows.push(values);
    return Promise.resolve([]);
  });

  (fn as unknown as Record<string, unknown>).json = (v: unknown) => v;
  (fn as unknown as Record<string, unknown>).insertedRows = insertedRows;

  return fn as unknown as MockSql & { insertedRows: unknown[] };
}

function makeSqlSimple(selectResult: unknown[] = []) {
  const insertedRows: unknown[] = [];
  const fn = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
    const raw = strings.join('');
    if (raw.trim().toUpperCase().startsWith('SELECT')) {
      return Promise.resolve(selectResult);
    }
    insertedRows.push(values);
    return Promise.resolve([]);
  });
  (fn as unknown as Record<string, unknown>).json = (v: unknown) => v;
  (fn as unknown as Record<string, unknown>).insertedRows = insertedRows;
  return fn as unknown as MockSql & { insertedRows: unknown[] };
}

// ---------------------------------------------------------------------------

describe('seedSuperuser()', () => {
  beforeEach(() => {
    _resetSecretsForTest();
  });

  afterEach(() => {
    _resetSecretsForTest();
    vi.restoreAllMocks();
  });

  test('skips seeding when a superuser already exists', async () => {
    const sql = makeSql({ selectResult: [{ id: 'existing-id' }] });
    _seedSecretForTest('SUPERUSER_EMAIL', 'admin@example.com');
    _seedSecretForTest('SUPERUSER_PASSWORD', 'securepassword');

    await seedSuperuser({ sql });

    // No INSERT should have been attempted
    const calls = vi.mocked(sql as unknown as ReturnType<typeof vi.fn>).mock.calls;
    const insertCall = calls.find((c) => {
      const strings = c[0] as TemplateStringsArray;
      return strings?.join?.('').toUpperCase().includes('INSERT');
    });
    expect(insertCall).toBeUndefined();
  });

  test('skips seeding when SUPERUSER_EMAIL is not set', async () => {
    const sql = makeSql({ selectResult: [] });

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await seedSuperuser({ sql });

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('SUPERUSER_EMAIL is not set'));
  });

  test('skips seeding when neither password nor mnemonic is set', async () => {
    const sql = makeSql({ selectResult: [] });
    _seedSecretForTest('SUPERUSER_EMAIL', 'admin@example.com');

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await seedSuperuser({ sql });

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Neither SUPERUSER_PASSWORD nor SUPERUSER_MNEMONIC'),
    );
  });

  test('creates superuser using SUPERUSER_PASSWORD when set', async () => {
    const sql = makeSqlSimple([]);

    _seedSecretForTest('SUPERUSER_EMAIL', 'admin@example.com');
    _seedSecretForTest('SUPERUSER_PASSWORD', 'securepassword');

    await seedSuperuser({ sql });

    expect(sql.insertedRows.length).toBe(1);
  });

  test('creates superuser using SUPERUSER_MNEMONIC when no password is set', async () => {
    const sql = makeSqlSimple([]);

    _seedSecretForTest('SUPERUSER_EMAIL', 'admin@example.com');
    _seedSecretForTest(
      'SUPERUSER_MNEMONIC',
      'word1 word2 word3 word4 word5 word6 word7 word8 word9 word10 word11 word12',
    );

    await seedSuperuser({ sql });

    expect(sql.insertedRows.length).toBe(1);
  });

  test('SUPERUSER_PASSWORD takes precedence over SUPERUSER_MNEMONIC', async () => {
    const hashSpy = vi.spyOn(Bun.password, 'hash');

    const sql = makeSqlSimple([]);

    _seedSecretForTest('SUPERUSER_EMAIL', 'admin@example.com');
    _seedSecretForTest('SUPERUSER_PASSWORD', 'explicit-password');
    _seedSecretForTest('SUPERUSER_MNEMONIC', 'word1 word2 word3');

    await seedSuperuser({ sql });

    // hash() should have been called with the password, not the mnemonic
    expect(hashSpy).toHaveBeenCalledWith('explicit-password');
    expect(hashSpy).not.toHaveBeenCalledWith('word1 word2 word3');
  });
});
