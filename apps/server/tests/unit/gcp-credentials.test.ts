import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import {
  clearGoogleAccessTokenCache,
  clearGoogleHttpFixtureState,
  getGoogleAccessToken,
  getGoogleCredentialInfo,
} from '../../../../scripts/gcp/common';

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

describe('Google credential resolution', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'calypso-gcp-tests-'));
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

  test('prefers explicit GCP_ACCESS_TOKEN over all other credential sources', async () => {
    const tokenFile = join(tempDir, 'oauth.json');
    writeFileSync(
      tokenFile,
      JSON.stringify({
        access_token: 'oauth-access',
        client_id: 'client-id',
        expires_at_ms: Date.now() + 60_000,
        refresh_token: 'refresh-token',
      }),
    );
    process.env.GCP_OAUTH_TOKEN_FILE = tokenFile;
    process.env.GCP_SERVICE_ACCOUNT_JSON = JSON.stringify({
      client_email: 'svc@example.iam.gserviceaccount.com',
      private_key: 'private-key',
      type: 'service_account',
    });
    process.env.GCP_ACCESS_TOKEN = 'wif-issued-token';

    const token = await getGoogleAccessToken();
    const info = getGoogleCredentialInfo();

    expect(token).toBe('wif-issued-token');
    expect(info.source).toBe('GCP_ACCESS_TOKEN');
    expect(info.type).toBe('access-token');
  });

  test('prefers local OAuth token file over service-account JSON fallback', () => {
    const tokenFile = join(tempDir, 'oauth.json');
    writeFileSync(
      tokenFile,
      JSON.stringify({
        access_token: 'oauth-access',
        client_id: 'client-id',
        expires_at_ms: Date.now() + 3600_000,
        refresh_token: 'refresh-token',
      }),
    );
    process.env.GCP_OAUTH_TOKEN_FILE = tokenFile;
    process.env.GCP_SERVICE_ACCOUNT_JSON = 'not-json';

    const info = getGoogleCredentialInfo();
    expect(info.source).toBe(tokenFile);
    expect(info.type).toBe('oauth-token-file');
  });

  test('falls back to service-account JSON when access token and OAuth file are unavailable', () => {
    process.env.GCP_OAUTH_TOKEN_FILE = join(tempDir, 'missing.json');
    process.env.GCP_SERVICE_ACCOUNT_JSON = JSON.stringify({
      client_email: 'svc@example.iam.gserviceaccount.com',
      private_key: '-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----\\n',
      project_id: 'proj-123',
      type: 'service_account',
    });

    const info = getGoogleCredentialInfo();
    expect(info.source).toBe('GCP_SERVICE_ACCOUNT_JSON');
    expect(info.type).toBe('service-account-json');
    expect(info.principal).toBe('svc@example.iam.gserviceaccount.com');
    expect(info.projectId).toBe('proj-123');
  });

  test('refreshes expired local OAuth token and persists updated material', async () => {
    const tokenFile = join(tempDir, 'oauth.json');
    writeFileSync(
      tokenFile,
      JSON.stringify({
        access_token: 'expired-token',
        client_id: 'client-id',
        expires_at_ms: Date.now() - 5_000,
        refresh_token: 'refresh-token',
        token_uri: 'https://oauth2.googleapis.com/token',
      }),
    );
    process.env.GCP_OAUTH_TOKEN_FILE = tokenFile;

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () =>
        JSON.stringify({
          access_token: 'fresh-token',
          expires_in: 3600,
          scope: 'https://www.googleapis.com/auth/cloud-platform',
          token_type: 'Bearer',
        }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const token = await getGoogleAccessToken();
    expect(token).toBe('fresh-token');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const persisted = JSON.parse(readFileSync(tokenFile, 'utf8')) as {
      access_token?: string;
      expires_at_ms?: number;
      refresh_token?: string;
    };
    expect(persisted.access_token).toBe('fresh-token');
    expect(persisted.refresh_token).toBe('refresh-token');
    expect(typeof persisted.expires_at_ms).toBe('number');
    expect((persisted.expires_at_ms ?? 0) > Date.now()).toBe(true);
  });
});
