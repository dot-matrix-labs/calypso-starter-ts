import { createServer } from 'node:http';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import {
  clearGoogleAccessTokenCache,
  clearGoogleHttpFixtureState,
  getGoogleAccessToken,
  googleJsonRequest,
} from '../../../../scripts/gcp/common';
import { runDoctor } from '../../../../scripts/gcp/doctor';

const ENV_KEYS = [
  'CALYPSO_CLOUD_PROVIDER_FIXTURE_DIR',
  'CALYPSO_CLOUD_PROVIDER_HTTP_MODE',
  'GCP_ACCESS_TOKEN',
  'GCP_SERVICE_ACCOUNT_JSON',
  'GCP_OAUTH_TOKEN_FILE',
] as const;

describe('Google cloud-provider fixture transport', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'calypso-gcp-fixtures-'));
    process.env.GCP_OAUTH_TOKEN_FILE = join(tempDir, 'missing-oauth.json');
    clearGoogleAccessTokenCache();
    clearGoogleHttpFixtureState();
  });

  afterEach(() => {
    clearGoogleAccessTokenCache();
    clearGoogleHttpFixtureState();
    for (const key of ENV_KEYS) {
      delete process.env[key];
    }
    rmSync(tempDir, { recursive: true, force: true });
  });

  test('record mode writes sanitized Google token fixtures via real HTTP server', async () => {
    // Stand up a local HTTP server that mimics the Google token endpoint
    const tokenServer = createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ access_token: 'live-token', expires_in: 3600 }));
    });

    await new Promise<void>((resolve) => tokenServer.listen(0, '127.0.0.1', () => resolve()));
    const addr = tokenServer.address() as { port: number };
    const localTokenUri = `http://127.0.0.1:${addr.port}/token`;

    try {
      process.env.CALYPSO_CLOUD_PROVIDER_HTTP_MODE = 'record';
      process.env.CALYPSO_CLOUD_PROVIDER_FIXTURE_DIR = tempDir;
      // Use a service account key that points at our local token server
      process.env.GCP_SERVICE_ACCOUNT_JSON = makeServiceAccountJson(localTokenUri);

      await expect(getGoogleAccessToken()).resolves.toBe('live-token');

      const [fixtureFile] = readdirSync(tempDir).filter((entry) => entry.endsWith('.json'));
      expect(fixtureFile).toBeTruthy();

      const fixture = JSON.parse(readFileSync(join(tempDir, fixtureFile!), 'utf8')) as {
        request: { body?: { assertion?: string; grant_type?: string } };
        response: { body?: { access_token?: string } };
      };

      expect(fixture.request.body?.grant_type).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer');
      expect(fixture.request.body?.assertion).toBe('<redacted-jwt>');
      expect(fixture.response.body?.access_token).toBe('<redacted-access-token>');
    } finally {
      tokenServer.close();
    }
  });

  test('replay mode fails fast when a fixture is missing', async () => {
    process.env.CALYPSO_CLOUD_PROVIDER_HTTP_MODE = 'replay';
    process.env.CALYPSO_CLOUD_PROVIDER_FIXTURE_DIR = tempDir;
    process.env.GCP_ACCESS_TOKEN = 'replay-token';

    await expect(
      googleJsonRequest('https://cloudresourcemanager.googleapis.com/v1/projects/example'),
    ).rejects.toThrow(/No replay fixtures were found/);
  });

  test('replays the recorded doctor permission-failure scenario', async () => {
    process.env.CALYPSO_CLOUD_PROVIDER_HTTP_MODE = 'replay';
    process.env.CALYPSO_CLOUD_PROVIDER_FIXTURE_DIR = join(
      process.cwd(),
      'tests',
      'fixtures',
      'cloud-providers',
      'gcp',
      'doctor-provision-success',
    );
    process.env.GCP_SERVICE_ACCOUNT_JSON = makeServiceAccountJson();

    const result = await runDoctor({
      mode: 'provision',
      projectId: 'superfield-492115',
      quiet: true,
    });

    expect(result.ok).toBe(false);
    expect(result.disabledServices).toEqual([
      'compute.googleapis.com',
      'alloydb.googleapis.com',
      'servicenetworking.googleapis.com',
    ]);
    expect(result.missingPermissions).toEqual([
      'serviceusage.services.enable',
      'servicenetworking.services.addPeering',
    ]);
  });
});

function makeServiceAccountJson(tokenUri?: string): string {
  const { privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { format: 'pem', type: 'pkcs8' },
    publicKeyEncoding: { format: 'pem', type: 'spki' },
  });

  return JSON.stringify({
    client_email: 'fixture@example.iam.gserviceaccount.com',
    private_key: privateKey,
    type: 'service_account',
    ...(tokenUri ? { token_uri: tokenUri } : {}),
  });
}
