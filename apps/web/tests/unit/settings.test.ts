import { describe, test, expect, vi } from 'vitest';
import {
  SettingsPage,
  truncateCredentialId,
  formatPasskeyDate,
  fetchPasskeyCredentials,
  removePasskeyCredential,
} from '../../src/pages/settings';

describe('SettingsPage module exports', () => {
  test('SettingsPage is exported from the module', () => {
    expect(typeof SettingsPage).toBe('function');
  });
});

describe('passkey formatting helpers', () => {
  test('truncates credential IDs to 16 chars', () => {
    expect(truncateCredentialId('abcdefghijklmnopqrstuvwxyz')).toBe('abcdefghijklmnop');
    expect(truncateCredentialId('short-id')).toBe('short-id');
  });

  test('formats passkey timestamps', () => {
    expect(formatPasskeyDate(null)).toBe('Never');
    expect(formatPasskeyDate('not-a-date')).toBe('Unknown');
    expect(formatPasskeyDate('2026-03-01T12:00:00.000Z')).not.toBe('Unknown');
  });
});

describe('passkey API helpers', () => {
  test('fetchPasskeyCredentials returns parsed rows', async () => {
    const rows = [
      {
        id: 'cred-1',
        credential_id: 'abcdefghijklmnop0123',
        created_at: '2026-03-01T12:00:00.000Z',
        last_used_at: null,
      },
    ];
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(rows), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await expect(fetchPasskeyCredentials(fetchMock as unknown as typeof fetch)).resolves.toEqual(
      rows,
    );
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/passkey/credentials', {
      method: 'GET',
      credentials: 'include',
    });
  });

  test('removePasskeyCredential calls DELETE endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));

    await expect(
      removePasskeyCredential('cred-1', fetchMock as unknown as typeof fetch),
    ).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/passkey/credentials/cred-1', {
      method: 'DELETE',
      credentials: 'include',
    });
  });

  test('removePasskeyCredential throws when delete fails', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response('{"error":"Not found"}', { status: 404 }));
    await expect(
      removePasskeyCredential('missing', fetchMock as unknown as typeof fetch),
    ).rejects.toThrow('Failed to remove passkey');
  });
});
