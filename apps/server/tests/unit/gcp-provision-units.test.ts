import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import {
  clearGoogleAccessTokenCache,
  clearGoogleHttpFixtureState,
} from '../../../../scripts/gcp/common';
import {
  ensureAlloyDb,
  ensureFirewallRule,
  ensureNetwork,
  ensurePrivateServiceAccess,
  ensureRequiredServices,
  ensureSubnetwork,
  ensureVm,
  ensureVmTalos,
} from '../../../../scripts/gcp/provision';

const FIXTURE_BASE = join(process.cwd(), 'tests', 'fixtures', 'cloud-providers', 'gcp');

describe('Provision resource functions (fixture replay)', () => {
  beforeEach(() => {
    clearGoogleAccessTokenCache();
    clearGoogleHttpFixtureState();
    process.env.GCP_ACCESS_TOKEN = 'test-token';
    process.env.CALYPSO_CLOUD_PROVIDER_HTTP_MODE = 'replay';
  });

  afterEach(() => {
    delete process.env.GCP_ACCESS_TOKEN;
    delete process.env.CALYPSO_CLOUD_PROVIDER_HTTP_MODE;
    delete process.env.CALYPSO_CLOUD_PROVIDER_FIXTURE_DIR;
    clearGoogleAccessTokenCache();
    clearGoogleHttpFixtureState();
  });

  // --- ensureNetwork ---

  test('ensureNetwork returns existing network without creating', async () => {
    process.env.CALYPSO_CLOUD_PROVIDER_FIXTURE_DIR = join(FIXTURE_BASE, 'network-exists');
    const result = await ensureNetwork('test-project', 'test-network');
    expect(result.selfLink).toBe(
      'https://www.googleapis.com/compute/v1/projects/test-project/global/networks/test-network',
    );
  });

  test('ensureNetwork creates network when not found', async () => {
    process.env.CALYPSO_CLOUD_PROVIDER_FIXTURE_DIR = join(FIXTURE_BASE, 'network-create');
    const result = await ensureNetwork('test-project', 'test-network');
    expect(result.selfLink).toBe(
      'https://www.googleapis.com/compute/v1/projects/test-project/global/networks/test-network',
    );
  });

  test('ensureNetwork throws when creation returns no operation', async () => {
    process.env.CALYPSO_CLOUD_PROVIDER_FIXTURE_DIR = join(FIXTURE_BASE, 'network-create-no-op');
    await expect(ensureNetwork('test-project', 'test-network')).rejects.toThrow(
      'Network creation did not return an operation',
    );
  });

  // --- ensureSubnetwork ---

  test('ensureSubnetwork creates subnetwork when not found', async () => {
    process.env.CALYPSO_CLOUD_PROVIDER_FIXTURE_DIR = join(FIXTURE_BASE, 'subnetwork-create');
    const result = await ensureSubnetwork(
      'test-project',
      'us-central1',
      'test-subnet',
      'https://www.googleapis.com/compute/v1/projects/test-project/global/networks/test-network',
      '10.42.0.0/24',
    );
    expect(result.selfLink).toBe(
      'https://www.googleapis.com/compute/v1/projects/test-project/regions/us-central1/subnetworks/test-subnet',
    );
  });

  test('ensureSubnetwork throws when creation returns no operation', async () => {
    process.env.CALYPSO_CLOUD_PROVIDER_FIXTURE_DIR = join(FIXTURE_BASE, 'subnetwork-create-no-op');
    await expect(
      ensureSubnetwork(
        'test-project',
        'us-central1',
        'test-subnet',
        'https://www.googleapis.com/compute/v1/projects/test-project/global/networks/test-network',
        '10.42.0.0/24',
      ),
    ).rejects.toThrow('Subnetwork creation did not return an operation');
  });

  // --- ensureFirewallRule ---

  test('ensureFirewallRule returns without action when rule exists', async () => {
    process.env.CALYPSO_CLOUD_PROVIDER_FIXTURE_DIR = join(FIXTURE_BASE, 'firewall-exists');
    await expect(
      ensureFirewallRule('test-project', 'test-fw', 'https://net/self', 'tag', ['22'], '0.0.0.0/0'),
    ).resolves.toBeUndefined();
  });

  test('ensureFirewallRule creates rule when not found', async () => {
    process.env.CALYPSO_CLOUD_PROVIDER_FIXTURE_DIR = join(FIXTURE_BASE, 'firewall-create');
    await expect(
      ensureFirewallRule('test-project', 'test-fw', 'https://net/self', 'tag', ['22'], '0.0.0.0/0'),
    ).resolves.toBeUndefined();
  });

  test('ensureFirewallRule throws when creation returns no operation', async () => {
    process.env.CALYPSO_CLOUD_PROVIDER_FIXTURE_DIR = join(FIXTURE_BASE, 'firewall-create-no-op');
    await expect(
      ensureFirewallRule('test-project', 'test-fw', 'https://net/self', 'tag', ['22'], '0.0.0.0/0'),
    ).rejects.toThrow('Firewall rule creation did not return an operation');
  });

  // --- ensureVm ---

  test('ensureVm creates VM when not found and returns external IP', async () => {
    process.env.CALYPSO_CLOUD_PROVIDER_FIXTURE_DIR = join(FIXTURE_BASE, 'vm-create');
    const ip = await ensureVm({
      projectId: 'test-project',
      zone: 'us-central1-a',
      vmName: 'test-vm',
      vmMachineType: 'e2-standard-4',
      vmDiskSizeGb: 50,
      vmDiskType: 'pd-balanced',
      vmImageProject: 'ubuntu-os-cloud',
      vmImageFamily: 'ubuntu-2404-lts-amd64',
      subnetworkSelfLink: 'https://sub/self',
      targetTag: 'tag',
      publicKey: 'ssh-ed25519 AAAA test@test',
    });
    expect(ip).toBe('34.1.2.3');
  });

  test('ensureVm returns IP for already-running VM', async () => {
    process.env.CALYPSO_CLOUD_PROVIDER_FIXTURE_DIR = join(FIXTURE_BASE, 'vm-exists-running');
    const ip = await ensureVm({
      projectId: 'test-project',
      zone: 'us-central1-a',
      vmName: 'test-vm',
      vmMachineType: 'e2-standard-4',
      vmDiskSizeGb: 50,
      vmDiskType: 'pd-balanced',
      vmImageProject: 'ubuntu-os-cloud',
      vmImageFamily: 'ubuntu-2404-lts-amd64',
      subnetworkSelfLink: 'https://sub/self',
      targetTag: 'tag',
      publicKey: 'ssh-ed25519 AAAA test@test',
    });
    expect(ip).toBe('34.1.2.3');
  });

  test('ensureVm starts a stopped VM', async () => {
    process.env.CALYPSO_CLOUD_PROVIDER_FIXTURE_DIR = join(FIXTURE_BASE, 'vm-exists-stopped');
    const ip = await ensureVm({
      projectId: 'test-project',
      zone: 'us-central1-a',
      vmName: 'test-vm',
      vmMachineType: 'e2-standard-4',
      vmDiskSizeGb: 50,
      vmDiskType: 'pd-balanced',
      vmImageProject: 'ubuntu-os-cloud',
      vmImageFamily: 'ubuntu-2404-lts-amd64',
      subnetworkSelfLink: 'https://sub/self',
      targetTag: 'tag',
      publicKey: 'ssh-ed25519 AAAA test@test',
    });
    expect(ip).toBe('34.1.2.3');
  });

  test('ensureVm throws when VM has no external IP', async () => {
    process.env.CALYPSO_CLOUD_PROVIDER_FIXTURE_DIR = join(FIXTURE_BASE, 'vm-no-ip');
    await expect(
      ensureVm({
        projectId: 'test-project',
        zone: 'us-central1-a',
        vmName: 'test-vm',
        vmMachineType: 'e2-standard-4',
        vmDiskSizeGb: 50,
        vmDiskType: 'pd-balanced',
        vmImageProject: 'ubuntu-os-cloud',
        vmImageFamily: 'ubuntu-2404-lts-amd64',
        subnetworkSelfLink: 'https://sub/self',
        targetTag: 'tag',
        publicKey: 'ssh-ed25519 AAAA test@test',
      }),
    ).rejects.toThrow('No external IP found on VM');
  });

  // --- ensureVmTalos ---

  test('ensureVmTalos returns IP for already-running VM', async () => {
    process.env.CALYPSO_CLOUD_PROVIDER_FIXTURE_DIR = join(FIXTURE_BASE, 'vm-exists-running');
    const ip = await ensureVmTalos({
      projectId: 'test-project',
      zone: 'us-central1-a',
      vmName: 'test-vm',
      vmMachineType: 'e2-standard-4',
      vmDiskSizeGb: 50,
      vmDiskType: 'pd-balanced',
      talosImage: 'projects/test-project/global/images/talos-v1-8-0',
      subnetworkSelfLink: 'https://sub/self',
      targetTag: 'tag',
    });
    expect(ip).toBe('34.1.2.3');
  });

  // --- ensureAlloyDb ---

  test('ensureAlloyDb creates cluster and instance, returns IP', async () => {
    process.env.CALYPSO_CLOUD_PROVIDER_FIXTURE_DIR = join(FIXTURE_BASE, 'alloydb-cluster-create');
    const result = await ensureAlloyDb({
      projectId: 'test-project',
      projectNumber: '123456',
      region: 'us-central1',
      zone: 'us-central1-a',
      networkName: 'test-network',
      alloyCluster: 'test-cluster',
      alloyInstance: 'test-instance',
      alloyDbVersion: 'POSTGRES_15',
      alloyCpuCount: 2,
      alloyAvailabilityType: 'ZONAL',
      postgresUser: 'postgres',
      postgresPassword: 'test-pw',
      psaRangeName: 'test-psa',
    });
    expect(result.ipAddress).toBe('10.0.0.5');
  });

  test('ensureAlloyDb throws when cluster creation returns no operation', async () => {
    process.env.CALYPSO_CLOUD_PROVIDER_FIXTURE_DIR = join(
      FIXTURE_BASE,
      'alloydb-cluster-create-no-op',
    );
    await expect(
      ensureAlloyDb({
        projectId: 'test-project',
        projectNumber: '123456',
        region: 'us-central1',
        zone: 'us-central1-a',
        networkName: 'test-network',
        alloyCluster: 'test-cluster',
        alloyInstance: 'test-instance',
        alloyDbVersion: 'POSTGRES_15',
        alloyCpuCount: 2,
        alloyAvailabilityType: 'ZONAL',
        postgresUser: 'postgres',
        postgresPassword: 'test-pw',
        psaRangeName: 'test-psa',
      }),
    ).rejects.toThrow('AlloyDB cluster creation did not return an operation');
  });

  test('ensureAlloyDb throws when instance creation returns no operation', async () => {
    process.env.CALYPSO_CLOUD_PROVIDER_FIXTURE_DIR = join(
      FIXTURE_BASE,
      'alloydb-instance-create-no-op',
    );
    await expect(
      ensureAlloyDb({
        projectId: 'test-project',
        projectNumber: '123456',
        region: 'us-central1',
        zone: 'us-central1-a',
        networkName: 'test-network',
        alloyCluster: 'test-cluster',
        alloyInstance: 'test-instance',
        alloyDbVersion: 'POSTGRES_15',
        alloyCpuCount: 2,
        alloyAvailabilityType: 'ZONAL',
        postgresUser: 'postgres',
        postgresPassword: 'test-pw',
        psaRangeName: 'test-psa',
      }),
    ).rejects.toThrow('AlloyDB instance creation did not return an operation');
  });

  // --- ensurePrivateServiceAccess ---

  test('ensurePrivateServiceAccess tolerates already-exists error', async () => {
    process.env.CALYPSO_CLOUD_PROVIDER_FIXTURE_DIR = join(FIXTURE_BASE, 'psa-already-exists');
    await expect(
      ensurePrivateServiceAccess(
        'test-project',
        '123456',
        'test-network',
        'https://net/self',
        'test-psa',
        16,
      ),
    ).resolves.toBeUndefined();
  });

  // --- ensureRequiredServices ---

  test('ensureRequiredServices enables a disabled service', async () => {
    process.env.CALYPSO_CLOUD_PROVIDER_FIXTURE_DIR = join(FIXTURE_BASE, 'service-enable');
    await expect(ensureRequiredServices('123456')).resolves.toBeUndefined();
  });
});
