import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import {
  clearGoogleAccessTokenCache,
  clearGoogleHttpFixtureState,
  getGoogleAccessToken,
  writeLocalOAuthCredentialFile,
} from '../../../../scripts/gcp/common';
import { pollDeviceCodeToken, runDeviceCodeFlow } from '../../../../scripts/gcp/login';

const ENV_KEYS = [
  'CALYPSO_CLOUD_PROVIDER_FIXTURE_DIR',
  'CALYPSO_CLOUD_PROVIDER_HTTP_MODE',
  'GCP_ACCESS_TOKEN',
  'GCP_OAUTH_TOKEN_FILE',
  'GCP_SERVICE_ACCOUNT_JSON',
  'GOOGLE_APPLICATION_CREDENTIALS',
  'GCP_SERVICE_ACCOUNT_FILE',
  'GCP_SERVICE_ACCOUNT_KEY_JSON',
  'GCP_SERVICE_ACCOUNT_KEY_FILE',
] as const;

describe('Google device code login flow', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'calypso-gcp-device-code-tests-'));
    process.env.GCP_OAUTH_TOKEN_FILE = join(tempDir, 'missing-oauth.json');
    clearGoogleAccessTokenCache();
    clearGoogleHttpFixtureState();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    clearGoogleAccessTokenCache();
    clearGoogleHttpFixtureState();
    for (const key of ENV_KEYS) {
      delete process.env[key];
    }
    rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  describe('pollDeviceCodeToken', () => {
    test('returns token on first successful poll response', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        text: async () =>
          JSON.stringify({
            access_token: 'device-access-token',
            expires_in: 3600,
            refresh_token: 'device-refresh-token',
            scope: 'https://www.googleapis.com/auth/cloud-platform',
            token_type: 'Bearer',
          }),
      });
      vi.stubGlobal('fetch', fetchMock);
      vi.spyOn(Bun, 'sleep').mockResolvedValue(undefined);

      const result = await pollDeviceCodeToken({
        clientId: 'test-client-id',
        deviceCode: 'test-device-code',
        intervalMs: 5_000,
        timeoutMs: 60_000,
      });

      expect(result.access_token).toBe('device-access-token');
      expect(result.refresh_token).toBe('device-refresh-token');
      expect(result.expires_in).toBe(3600);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledWith(
        'https://oauth2.googleapis.com/token',
        expect.objectContaining({
          method: 'POST',
          body: expect.any(URLSearchParams),
        }),
      );
    });

    test('retries on authorization_pending and succeeds on second poll', async () => {
      let callCount = 0;
      const fetchMock = vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          return {
            ok: false,
            text: async () => JSON.stringify({ error: 'authorization_pending' }),
          };
        }
        return {
          ok: true,
          text: async () =>
            JSON.stringify({
              access_token: 'device-access-token',
              expires_in: 3600,
              refresh_token: 'device-refresh-token',
            }),
        };
      });
      vi.stubGlobal('fetch', fetchMock);
      vi.spyOn(Bun, 'sleep').mockResolvedValue(undefined);

      const result = await pollDeviceCodeToken({
        clientId: 'test-client-id',
        deviceCode: 'test-device-code',
        intervalMs: 5_000,
        timeoutMs: 60_000,
      });

      expect(result.access_token).toBe('device-access-token');
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    test('increases interval by 5 s on slow_down response', async () => {
      let callCount = 0;
      const sleepMock = vi.spyOn(Bun, 'sleep').mockResolvedValue(undefined);
      const fetchMock = vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          return {
            ok: false,
            text: async () => JSON.stringify({ error: 'slow_down' }),
          };
        }
        return {
          ok: true,
          text: async () =>
            JSON.stringify({
              access_token: 'device-access-token',
              expires_in: 3600,
              refresh_token: 'device-refresh-token',
            }),
        };
      });
      vi.stubGlobal('fetch', fetchMock);

      await pollDeviceCodeToken({
        clientId: 'test-client-id',
        deviceCode: 'test-device-code',
        intervalMs: 5_000,
        timeoutMs: 60_000,
      });

      // First sleep: original 5 s; second sleep: 5 s + 5 s = 10 s
      expect(sleepMock).toHaveBeenNthCalledWith(1, 5_000);
      expect(sleepMock).toHaveBeenNthCalledWith(2, 10_000);
    });

    test('throws immediately on access_denied error', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        text: async () => JSON.stringify({ error: 'access_denied' }),
      });
      vi.stubGlobal('fetch', fetchMock);
      vi.spyOn(Bun, 'sleep').mockResolvedValue(undefined);

      await expect(
        pollDeviceCodeToken({
          clientId: 'test-client-id',
          deviceCode: 'test-device-code',
          intervalMs: 5_000,
          timeoutMs: 60_000,
        }),
      ).rejects.toThrow('denied by the user');
    });

    test('throws immediately on expired_token error', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        text: async () => JSON.stringify({ error: 'expired_token' }),
      });
      vi.stubGlobal('fetch', fetchMock);
      vi.spyOn(Bun, 'sleep').mockResolvedValue(undefined);

      await expect(
        pollDeviceCodeToken({
          clientId: 'test-client-id',
          deviceCode: 'test-device-code',
          intervalMs: 5_000,
          timeoutMs: 60_000,
        }),
      ).rejects.toThrow('Device code has expired');
    });

    test('throws after timeout expires', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        text: async () => JSON.stringify({ error: 'authorization_pending' }),
      });
      vi.stubGlobal('fetch', fetchMock);

      // Use a real very short timeout to trigger expiry quickly
      vi.spyOn(Bun, 'sleep').mockImplementation(async () => {
        // Advance mocked time by sleeping longer than the deadline
        await new Promise((r) => setTimeout(r, 0));
      });

      // timeoutMs=0 means the deadline is already past before we even start
      await expect(
        pollDeviceCodeToken({
          clientId: 'test-client-id',
          deviceCode: 'test-device-code',
          intervalMs: 5_000,
          timeoutMs: 0,
        }),
      ).rejects.toThrow('Timed out waiting for device code authorization');
    });

    test('throws when token response is missing refresh_token', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        text: async () =>
          JSON.stringify({
            access_token: 'device-access-token',
            expires_in: 3600,
            // refresh_token intentionally absent
          }),
      });
      vi.stubGlobal('fetch', fetchMock);
      vi.spyOn(Bun, 'sleep').mockResolvedValue(undefined);

      await expect(
        pollDeviceCodeToken({
          clientId: 'test-client-id',
          deviceCode: 'test-device-code',
          intervalMs: 5_000,
          timeoutMs: 60_000,
        }),
      ).rejects.toThrow('refresh_token');
    });

    test('includes client_secret in token request when provided', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        text: async () =>
          JSON.stringify({
            access_token: 'device-access-token',
            expires_in: 3600,
            refresh_token: 'device-refresh-token',
          }),
      });
      vi.stubGlobal('fetch', fetchMock);
      vi.spyOn(Bun, 'sleep').mockResolvedValue(undefined);

      await pollDeviceCodeToken({
        clientId: 'test-client-id',
        clientSecret: 'test-secret',
        deviceCode: 'test-device-code',
        intervalMs: 5_000,
        timeoutMs: 60_000,
      });

      const [[, init]] = (fetchMock as ReturnType<typeof vi.fn>).mock.calls as [
        [string, { body: URLSearchParams }],
      ];
      const body = init.body as URLSearchParams;
      expect(body.get('client_secret')).toBe('test-secret');
    });
  });

  describe('runDeviceCodeFlow', () => {
    test('requests device code and polls for token', async () => {
      let fetchCallCount = 0;
      const fetchMock = vi.fn().mockImplementation(async (url: string) => {
        fetchCallCount++;
        if (url === 'https://oauth2.googleapis.com/device/code') {
          return {
            ok: true,
            text: async () =>
              JSON.stringify({
                device_code: 'test-device-code',
                user_code: 'ABCD-EFGH',
                verification_url: 'https://www.google.com/device',
                expires_in: 1800,
                interval: 5,
              }),
          };
        }
        // Token endpoint
        return {
          ok: true,
          text: async () =>
            JSON.stringify({
              access_token: 'device-access-token',
              expires_in: 3600,
              refresh_token: 'device-refresh-token',
              scope: 'https://www.googleapis.com/auth/cloud-platform',
              token_type: 'Bearer',
            }),
        };
      });
      vi.stubGlobal('fetch', fetchMock);
      vi.spyOn(Bun, 'sleep').mockResolvedValue(undefined);

      const result = await runDeviceCodeFlow({
        clientId: 'test-client-id',
        scope: 'https://www.googleapis.com/auth/cloud-platform',
        timeoutMs: 60_000,
      });

      expect(result.access_token).toBe('device-access-token');
      expect(result.refresh_token).toBe('device-refresh-token');
      expect(fetchCallCount).toBe(2);
    });
  });

  describe('device code token persistence and credential loading', () => {
    test('persists device code token to token file and is loadable by getGoogleAccessToken', async () => {
      const tokenFile = join(tempDir, 'oauth.json');
      process.env.GCP_OAUTH_TOKEN_FILE = tokenFile;

      // Simulate what the device code login flow does after receiving the token
      writeLocalOAuthCredentialFile(
        {
          access_token: 'device-initial-access',
          client_id: 'test-client-id',
          expires_at_ms: Date.now() + 3_600_000,
          refresh_token: 'device-refresh-token',
          scope: 'https://www.googleapis.com/auth/cloud-platform',
          token_uri: 'https://oauth2.googleapis.com/token',
          type: 'Bearer',
        },
        tokenFile,
      );

      clearGoogleAccessTokenCache();
      const token = await getGoogleAccessToken();
      expect(token).toBe('device-initial-access');

      // Verify the file is readable and contains the expected fields
      const persisted = JSON.parse(readFileSync(tokenFile, 'utf8')) as {
        access_token?: string;
        refresh_token?: string;
        client_id?: string;
        expires_at_ms?: number;
      };
      expect(persisted.access_token).toBe('device-initial-access');
      expect(persisted.refresh_token).toBe('device-refresh-token');
      expect(persisted.client_id).toBe('test-client-id');
      expect(typeof persisted.expires_at_ms).toBe('number');
    });

    test('auto-refreshes expired device code token using refresh_token', async () => {
      const tokenFile = join(tempDir, 'oauth.json');
      process.env.GCP_OAUTH_TOKEN_FILE = tokenFile;

      // Write an expired device code token
      writeLocalOAuthCredentialFile(
        {
          access_token: 'expired-device-access',
          client_id: 'test-client-id',
          expires_at_ms: Date.now() - 5_000,
          refresh_token: 'device-refresh-token',
          scope: 'https://www.googleapis.com/auth/cloud-platform',
          token_uri: 'https://oauth2.googleapis.com/token',
          type: 'Bearer',
        },
        tokenFile,
      );

      clearGoogleAccessTokenCache();

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        text: async () =>
          JSON.stringify({
            access_token: 'refreshed-device-access',
            expires_in: 3600,
            refresh_token: 'device-refresh-token',
            scope: 'https://www.googleapis.com/auth/cloud-platform',
            token_type: 'Bearer',
          }),
      });
      vi.stubGlobal('fetch', fetchMock);

      const token = await getGoogleAccessToken();
      expect(token).toBe('refreshed-device-access');

      // Verify the token was persisted after refresh
      const persisted = JSON.parse(readFileSync(tokenFile, 'utf8')) as {
        access_token?: string;
        refresh_token?: string;
        expires_at_ms?: number;
      };
      expect(persisted.access_token).toBe('refreshed-device-access');
      expect((persisted.expires_at_ms ?? 0) > Date.now()).toBe(true);
    });

    test('token file uses 0o600 permissions for security', () => {
      const tokenFile = join(tempDir, 'oauth.json');

      writeLocalOAuthCredentialFile(
        {
          access_token: 'test-access',
          client_id: 'test-client-id',
          expires_at_ms: Date.now() + 3_600_000,
          refresh_token: 'test-refresh',
          scope: 'https://www.googleapis.com/auth/cloud-platform',
          token_uri: 'https://oauth2.googleapis.com/token',
          type: 'Bearer',
        },
        tokenFile,
      );

      const stats = statSync(tokenFile);
      // Check that only owner can read/write (0o600)
      const mode = stats.mode & 0o777;
      expect(mode).toBe(0o600);
    });
  });
});
