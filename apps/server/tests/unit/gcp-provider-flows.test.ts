import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import {
  clearGoogleAccessTokenCache,
  clearGoogleHttpFixtureState,
} from '../../../../scripts/gcp/common';
import { runDoctor } from '../../../../scripts/gcp/doctor';
import { createFixtureServer } from '../helpers/msw-fixture-server';

const FIXTURE_BASE = join(process.cwd(), 'tests', 'fixtures', 'cloud-providers', 'gcp');

describe('Google Cloud provider flow replay coverage', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'calypso-gcp-provider-flows-'));
    process.env.GCP_OAUTH_TOKEN_FILE = join(tempDir, 'missing-oauth.json');
    process.env.GCP_SERVICE_ACCOUNT_JSON = makeServiceAccountJson();
    clearGoogleAccessTokenCache();
    clearGoogleHttpFixtureState();
  });

  afterEach(() => {
    clearGoogleAccessTokenCache();
    clearGoogleHttpFixtureState();
    for (const key of [
      'GCP_OAUTH_TOKEN_FILE',
      'GCP_SERVICE_ACCOUNT_JSON',
      'GCP_ACCESS_TOKEN',
    ] as const) {
      delete process.env[key];
    }
    rmSync(tempDir, { recursive: true, force: true });
  });

  test('replays the doctor permission-failure scenario', async () => {
    const { server } = createFixtureServer(join(FIXTURE_BASE, 'doctor-provision-success'));
    server.listen({ onUnhandledRequest: 'error' });

    try {
      const result = await runDoctor({
        mode: 'provision',
        projectId: 'superfield-492115',
      });

      expect(result.ok).toBe(false);
      expect(result.missingPermissions).toContain('serviceusage.services.enable');
    } finally {
      server.close();
    }
  });
});

function makeServiceAccountJson(): string {
  const { privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { format: 'pem', type: 'pkcs8' },
    publicKeyEncoding: { format: 'pem', type: 'spki' },
  });

  return JSON.stringify({
    client_email: 'fixture@example.iam.gserviceaccount.com',
    private_key: privateKey,
    type: 'service_account',
  });
}
