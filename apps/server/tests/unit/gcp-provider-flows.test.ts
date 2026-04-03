import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const commonMocks = vi.hoisted(() => ({
  spawnSync: vi.fn((command: string[]) => {
    if (command[0] === 'which') {
      return {
        exitCode: 0,
        stderr: new Uint8Array(),
        stdout: new Uint8Array(),
      };
    }

    if (command[0] === 'ssh-keygen') {
      return {
        exitCode: 0,
        stderr: new Uint8Array(),
        stdout: new TextEncoder().encode(
          'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFixturePublicKey fixture@test\n',
        ),
      };
    }

    if (command[0] === 'cat' && command[1]) {
      return {
        exitCode: 0,
        stderr: new Uint8Array(),
        stdout: new TextEncoder().encode(readFileSync(String(command[1]), 'utf8')),
      };
    }

    if (command[0] === 'ssh' && command.some((part) => part.includes('kubectl create token'))) {
      return {
        exitCode: 0,
        stderr: new Uint8Array(),
        stdout: new TextEncoder().encode('fixture-deploy-token\n'),
      };
    }

    if (command[0] === 'ssh' && command.some((part) => part.includes('kubectl config view'))) {
      return {
        exitCode: 0,
        stderr: new Uint8Array(),
        stdout: new TextEncoder().encode('fixture-ca-data\n'),
      };
    }

    return {
      exitCode: 0,
      stderr: new Uint8Array(),
      stdout: new Uint8Array(),
    };
  }),
  waitForTcpPort: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../../scripts/gcp/common', async () => {
  const actual = await vi.importActual<typeof import('../../../../scripts/gcp/common')>(
    '../../../../scripts/gcp/common',
  );
  return {
    ...actual,
    waitForTcpPort: commonMocks.waitForTcpPort,
  };
});

import * as common from '../../../../scripts/gcp/common';
import * as doctorModule from '../../../../scripts/gcp/doctor';
import { main as runDeployMain } from '../../../../scripts/gcp/deploy';
import { main as runProvisionMain } from '../../../../scripts/gcp/provision';

describe('Google Cloud provider flow replay coverage', () => {
  let tempDir: string;
  let privateKeyFile: string;
  let originalArgv: string[];

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    tempDir = mkdtempSync(join(tmpdir(), 'calypso-gcp-provider-flows-'));
    privateKeyFile = join(tempDir, 'id_ed25519');
    writeFileSync(
      privateKeyFile,
      '-----BEGIN PRIVATE KEY-----\nfixture\n-----END PRIVATE KEY-----\n',
    );
    originalArgv = [...process.argv];
    process.env.CALYPSO_CLOUD_PROVIDER_FIXTURE_DIR = join(
      process.cwd(),
      'tests',
      'fixtures',
      'cloud-providers',
      'gcp',
      'ready-infra',
    );
    process.env.CALYPSO_CLOUD_PROVIDER_HTTP_MODE = 'replay';
    process.env.GCP_OAUTH_TOKEN_FILE = join(tempDir, 'missing-oauth.json');
    process.env.CALYPSO_SSH_PRIVATE_KEY_FILE = privateKeyFile;
    process.env.GCP_SERVICE_ACCOUNT_JSON = makeServiceAccountJson();
    process.env.GCP_PROJECT_ID = 'superfield-492115';
    process.env.GCP_REGION = 'us-central1';
    process.env.GCP_ZONE = 'us-central1-a';
    process.env.CALYPSO_ENV = 'demo';
    process.env.CALYPSO_IMAGE_TAG = 'v1.2.3';
    process.env.GCP_NETWORK_NAME = 'calypso-demo';
    process.env.GCP_SUBNETWORK_NAME = 'calypso-demo-us-central1';
    process.env.GCP_SUBNETWORK_CIDR = '10.42.0.0/24';
    process.env.GCP_VM_NAME = 'calypso-demo-vm';
    process.env.GCP_VM_MACHINE_TYPE = 'e2-standard-4';
    process.env.GCP_VM_DISK_SIZE_GB = '50';
    process.env.GCP_VM_DISK_TYPE = 'pd-balanced';
    process.env.GCP_VM_IMAGE_PROJECT = 'ubuntu-os-cloud';
    process.env.GCP_VM_IMAGE_FAMILY = 'ubuntu-2404-lts-amd64';
    process.env.GCP_VM_NETWORK_TAG = 'calypso-demo';
    process.env.GCP_PSA_RANGE_NAME = 'calypso-demo-psa';
    process.env.GCP_PSA_PREFIX_LENGTH = '16';
    process.env.GCP_ALLOYDB_CLUSTER = 'calypso-demo-db';
    process.env.GCP_ALLOYDB_INSTANCE = 'calypso-demo-primary';
    process.env.GCP_ALLOYDB_VERSION = 'POSTGRES_15';
    process.env.GCP_ALLOYDB_CPU_COUNT = '2';
    process.env.GCP_ALLOYDB_AVAILABILITY = 'ZONAL';
    process.env.GCP_ALLOYDB_POSTGRES_USER = 'postgres';
    process.env.GCP_ALLOYDB_POSTGRES_PASSWORD = 'secret-password';
    process.env.CALYPSO_SSH_SOURCE_RANGES = '0.0.0.0/0';
    process.env.CALYPSO_APP_SOURCE_RANGES = '0.0.0.0/0';
    process.env.CALYPSO_SSH_PRIVATE_KEY =
      '-----BEGIN PRIVATE KEY-----\nfixture\n-----END PRIVATE KEY-----\n';
    vi.spyOn(Bun, 'spawnSync').mockImplementation(commonMocks.spawnSync as never);
    vi.spyOn(common, 'waitForTcpPort').mockResolvedValue(undefined);
    common.clearGoogleAccessTokenCache();
    common.clearGoogleHttpFixtureState();
  });

  afterEach(() => {
    common.clearGoogleAccessTokenCache();
    common.clearGoogleHttpFixtureState();
    process.argv = originalArgv;
    for (const key of [
      'CALYPSO_CLOUD_PROVIDER_FIXTURE_DIR',
      'CALYPSO_CLOUD_PROVIDER_HTTP_MODE',
      'GCP_OAUTH_TOKEN_FILE',
      'CALYPSO_SSH_PRIVATE_KEY_FILE',
      'GCP_SERVICE_ACCOUNT_JSON',
      'CALYPSO_SSH_PRIVATE_KEY',
      'GCP_ACCESS_TOKEN',
      'GCP_PROJECT_ID',
      'GCP_REGION',
      'GCP_ZONE',
      'CALYPSO_ENV',
      'CALYPSO_IMAGE_TAG',
      'GCP_NETWORK_NAME',
      'GCP_SUBNETWORK_NAME',
      'GCP_SUBNETWORK_CIDR',
      'GCP_VM_NAME',
      'GCP_VM_MACHINE_TYPE',
      'GCP_VM_DISK_SIZE_GB',
      'GCP_VM_DISK_TYPE',
      'GCP_VM_IMAGE_PROJECT',
      'GCP_VM_IMAGE_FAMILY',
      'GCP_VM_NETWORK_TAG',
      'GCP_PSA_RANGE_NAME',
      'GCP_PSA_PREFIX_LENGTH',
      'GCP_ALLOYDB_CLUSTER',
      'GCP_ALLOYDB_INSTANCE',
      'GCP_ALLOYDB_VERSION',
      'GCP_ALLOYDB_CPU_COUNT',
      'GCP_ALLOYDB_AVAILABILITY',
      'GCP_ALLOYDB_POSTGRES_USER',
      'GCP_ALLOYDB_POSTGRES_PASSWORD',
      'CALYPSO_SSH_SOURCE_RANGES',
      'CALYPSO_APP_SOURCE_RANGES',
    ] as const) {
      delete process.env[key];
    }
    rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  test('replays the recorded provision happy path end to end', async () => {
    process.argv = ['bun', 'scripts/gcp/provision.ts'];

    await expect(runProvisionMain()).resolves.toBeUndefined();
  });

  test('replays the recorded deploy check-only path and skips deploy.sh', async () => {
    vi.spyOn(Bun, 'spawn').mockReturnValue({
      exited: Promise.resolve(0),
      kill: vi.fn(),
    } as never);
    vi.spyOn(doctorModule, 'runDoctor').mockResolvedValue({
      credential: {
        source: 'mock',
        type: 'access-token',
      },
      disabledServices: [],
      missingPermissions: [],
      mode: 'deploy',
      ok: true,
      projectId: 'superfield-492115',
      projectNumber: '914441959143',
      warnings: [],
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), {
          headers: { 'Content-Type': 'application/json' },
          status: 200,
          statusText: 'OK',
        }),
      ),
    );
    process.env.GCP_ACCESS_TOKEN = 'fixture-access-token';
    common.clearGoogleAccessTokenCache();
    process.env.CALYPSO_CLOUD_PROVIDER_FIXTURE_DIR = join(
      process.cwd(),
      'tests',
      'fixtures',
      'cloud-providers',
      'gcp',
      'deploy-check-only',
    );
    common.clearGoogleHttpFixtureState();
    process.argv = ['bun', 'scripts/gcp/deploy.ts', '--check-only'];

    await expect(runDeployMain()).resolves.toBeUndefined();
  });

  test('replays the doctor permission-failure scenario', async () => {
    process.env.CALYPSO_CLOUD_PROVIDER_FIXTURE_DIR = join(
      process.cwd(),
      'tests',
      'fixtures',
      'cloud-providers',
      'gcp',
      'doctor-provision-success',
    );

    const result = await doctorModule.runDoctor({
      mode: 'provision',
      projectId: 'superfield-492115',
    });

    expect(result.ok).toBe(false);
    expect(result.missingPermissions).toContain('serviceusage.services.enable');
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
