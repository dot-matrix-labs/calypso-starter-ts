#!/usr/bin/env bun

import {
  computeGlobalOperationUrl,
  computeRegionalOperationUrl,
  computeZonalOperationUrl,
  createTempFile,
  ensureSshAuthMaterial,
  extractNatIp,
  getProjectNumber,
  googleJsonRequest,
  log,
  operationPollUrl,
  parseArgs,
  printHelp,
  requireCommands,
  resolveBooleanOption,
  resolveOption,
  resolveRequiredOption,
  resolveAdminPublicKey,
  runCommand,
  sleep,
  waitForGoogleOperation,
  waitForTcpPort,
} from './common';
import { runDoctor } from './doctor';

interface ComputeNetwork {
  selfLink: string;
}

interface ComputeSubnetwork {
  selfLink: string;
}

interface ComputeInstance {
  status?: string;
  networkInterfaces?: Array<{ accessConfigs?: Array<{ natIP?: string }> }>;
}

interface AlloyCluster {
  state?: string;
}

interface AlloyInstance {
  state?: string;
  ipAddress?: string;
}

const helpText = `
Create or reuse the Google Cloud infrastructure for a Calypso deployment, then
delegate host initialization to scripts/init-host.sh in remote-Postgres mode.

When --talos-mode is set, host initialization is delegated to
scripts/init-host-talos.sh instead. The Talos path does not use SSH for
bootstrapping; it creates a Talos API firewall rule (port 50000) and waits
for the Talos API port rather than an SSH port.

Required configuration:
  --project / GCP_PROJECT_ID
  --region / GCP_REGION
  --zone / GCP_ZONE
  --environment / CALYPSO_ENV
  --image-tag / CALYPSO_IMAGE_TAG
  SSH_AUTH_SOCK or CALYPSO_SSH_PRIVATE_KEY_FILE (not required in --talos-mode)

Google auth:
  Preferred: GCP_ACCESS_TOKEN or local OAuth cache via GCP_OAUTH_TOKEN_FILE
  (default ~/.config/calypso/gcp-oauth-token.json).
  Migration fallback: GCP_SERVICE_ACCOUNT_KEY_JSON, GCP_SERVICE_ACCOUNT_KEY_FILE,
  or GOOGLE_APPLICATION_CREDENTIALS. Standard API keys are not sufficient for
  IAM-authorized resource provisioning.

Common optional settings:
  --vm-name / GCP_VM_NAME                     default: calypso-<env>-vm
  --network / GCP_NETWORK_NAME               default: calypso-<env>
  --subnetwork / GCP_SUBNETWORK_NAME         default: calypso-<env>-<region>
  --subnetwork-cidr / GCP_SUBNETWORK_CIDR    default: 10.42.0.0/24
  --alloydb-cluster / GCP_ALLOYDB_CLUSTER    default: calypso-<env>-db
  --alloydb-instance / GCP_ALLOYDB_INSTANCE  default: calypso-<env>-primary
  --ssh-source-ranges / CALYPSO_SSH_SOURCE_RANGES  default: 0.0.0.0/0
  --app-source-ranges / CALYPSO_APP_SOURCE_RANGES  default: 0.0.0.0/0
  --non-interactive / CALYPSO_NON_INTERACTIVE default: false
  --skip-doctor / CALYPSO_SKIP_GCP_DOCTOR    default: false
  --talos-mode / CALYPSO_TALOS_MODE          default: false
  --talos-image / GCP_TALOS_IMAGE            Talos custom image URL (required in talos mode)
  --talos-api-source-ranges / CALYPSO_TALOS_API_SOURCE_RANGES  default: 0.0.0.0/0

Example (standard):
  bun run scripts/gcp/provision.ts \\
    --project my-project \\
    --region us-central1 \\
    --zone us-central1-a \\
    --environment demo \\
    --image-tag v1.2.3

Example (Talos):
  bun run scripts/gcp/provision.ts \\
    --project my-project \\
    --region us-central1 \\
    --zone us-central1-a \\
    --environment demo \\
    --image-tag v1.2.3 \\
    --talos-mode \\
    --talos-image projects/my-project/global/images/talos-v1-8-0
`.trim();

export async function main(): Promise<void> {
  const args = parseArgs();
  if (args.flags.has('help')) {
    printHelp('scripts/gcp/provision.ts', helpText);
    return;
  }

  const talosMode = resolveBooleanOption(args, 'talos-mode', ['CALYPSO_TALOS_MODE'], false);

  if (talosMode) {
    requireCommands(['talosctl', 'kubectl', 'bash']);
  } else {
    requireCommands(['ssh', 'ssh-add', 'ssh-keygen', 'bash']);
  }

  const projectId = resolveRequiredOption(args, 'project', ['GCP_PROJECT_ID'], 'GCP project');
  const region = resolveRequiredOption(args, 'region', ['GCP_REGION'], 'GCP region');
  const zone = resolveRequiredOption(args, 'zone', ['GCP_ZONE'], 'GCP zone');
  const environment = resolveRequiredOption(args, 'environment', ['CALYPSO_ENV'], 'Environment');
  const imageTag = resolveRequiredOption(args, 'image-tag', ['CALYPSO_IMAGE_TAG'], 'Image tag');
  const networkName = resolveOption(
    args,
    'network',
    ['GCP_NETWORK_NAME'],
    `calypso-${environment}`,
  )!;
  const subnetworkName = resolveOption(
    args,
    'subnetwork',
    ['GCP_SUBNETWORK_NAME'],
    `calypso-${environment}-${region}`,
  )!;
  const subnetworkCidr = resolveOption(
    args,
    'subnetwork-cidr',
    ['GCP_SUBNETWORK_CIDR'],
    '10.42.0.0/24',
  )!;
  const vmName = resolveOption(args, 'vm-name', ['GCP_VM_NAME'], `calypso-${environment}-vm`)!;
  const vmMachineType = resolveOption(
    args,
    'vm-machine-type',
    ['GCP_VM_MACHINE_TYPE'],
    'e2-standard-4',
  )!;
  const vmDiskSizeGb = Number(
    resolveOption(args, 'vm-disk-size-gb', ['GCP_VM_DISK_SIZE_GB'], '50'),
  );
  const vmDiskType = resolveOption(args, 'vm-disk-type', ['GCP_VM_DISK_TYPE'], 'pd-balanced')!;
  const vmImageProject = resolveOption(
    args,
    'vm-image-project',
    ['GCP_VM_IMAGE_PROJECT'],
    'ubuntu-os-cloud',
  )!;
  const vmImageFamily = resolveOption(
    args,
    'vm-image-family',
    ['GCP_VM_IMAGE_FAMILY'],
    'ubuntu-2404-lts-amd64',
  )!;
  const targetTag = resolveOption(
    args,
    'network-tag',
    ['GCP_VM_NETWORK_TAG'],
    `calypso-${environment}`,
  )!;
  const psaRangeName = resolveOption(
    args,
    'psa-range',
    ['GCP_PSA_RANGE_NAME'],
    `calypso-${environment}-psa`,
  )!;
  const psaPrefixLength = Number(
    resolveOption(args, 'psa-prefix-length', ['GCP_PSA_PREFIX_LENGTH'], '16'),
  );
  const alloyCluster = resolveOption(
    args,
    'alloydb-cluster',
    ['GCP_ALLOYDB_CLUSTER'],
    `calypso-${environment}-db`,
  )!;
  const alloyInstance = resolveOption(
    args,
    'alloydb-instance',
    ['GCP_ALLOYDB_INSTANCE'],
    `calypso-${environment}-primary`,
  )!;
  const alloyDbVersion = resolveOption(
    args,
    'alloydb-version',
    ['GCP_ALLOYDB_VERSION'],
    'POSTGRES_15',
  )!;
  const alloyCpuCount = Number(
    resolveOption(args, 'alloydb-cpu-count', ['GCP_ALLOYDB_CPU_COUNT'], '2'),
  );
  const alloyAvailabilityType = resolveOption(
    args,
    'alloydb-availability',
    ['GCP_ALLOYDB_AVAILABILITY'],
    'ZONAL',
  )!;
  const postgresUser = resolveOption(
    args,
    'postgres-user',
    ['GCP_ALLOYDB_POSTGRES_USER'],
    'postgres',
  )!;
  const postgresPassword = resolveRequiredOption(
    args,
    'postgres-password',
    ['GCP_ALLOYDB_POSTGRES_PASSWORD'],
    'AlloyDB postgres password',
  );
  const sshSourceRanges = resolveOption(
    args,
    'ssh-source-ranges',
    ['CALYPSO_SSH_SOURCE_RANGES'],
    '0.0.0.0/0',
  )!;
  const appSourceRanges = resolveOption(
    args,
    'app-source-ranges',
    ['CALYPSO_APP_SOURCE_RANGES'],
    '0.0.0.0/0',
  )!;
  const skipDoctor = resolveBooleanOption(args, 'skip-doctor', ['CALYPSO_SKIP_GCP_DOCTOR'], false);
  const nonInteractive = resolveBooleanOption(
    args,
    'non-interactive',
    ['CALYPSO_NON_INTERACTIVE'],
    false,
  );
  const talosImage = resolveOption(args, 'talos-image', ['GCP_TALOS_IMAGE'], '')!;
  const talosApiSourceRanges = resolveOption(
    args,
    'talos-api-source-ranges',
    ['CALYPSO_TALOS_API_SOURCE_RANGES'],
    '0.0.0.0/0',
  )!;

  const sshAuth = talosMode ? null : ensureSshAuthMaterial();
  const publicKeyFile =
    sshAuth !== null
      ? createTempFile('id_ed25519.pub', `${resolveAdminPublicKey(sshAuth)}\n`, 0o644)
      : null;

  try {
    if (!skipDoctor) {
      const doctor = await runDoctor({
        mode: 'provision',
        projectId,
      });
      if (!doctor.ok) {
        throw new Error(
          `Doctor failed. Missing permissions: ${
            doctor.missingPermissions.join(', ') || 'none'
          }. Disabled APIs: ${doctor.disabledServices.join(', ') || 'none'}`,
        );
      }
    }

    log(`Resolving project number for ${projectId}`);
    const projectNumber = await getProjectNumber(projectId);

    await ensureRequiredServices(projectNumber);

    const network = await ensureNetwork(projectId, networkName);
    const subnetwork = await ensureSubnetwork(
      projectId,
      region,
      subnetworkName,
      network.selfLink,
      subnetworkCidr,
    );

    if (talosMode) {
      await ensureFirewallRule(
        projectId,
        `calypso-${environment}-talos-api`,
        network.selfLink,
        targetTag,
        ['50000'],
        talosApiSourceRanges,
      );
    } else {
      await ensureFirewallRule(
        projectId,
        `calypso-${environment}-ssh`,
        network.selfLink,
        targetTag,
        ['22'],
        sshSourceRanges,
      );
    }
    await ensureFirewallRule(
      projectId,
      `calypso-${environment}-app`,
      network.selfLink,
      targetTag,
      ['31415'],
      appSourceRanges,
    );
    await ensurePrivateServiceAccess(
      projectId,
      projectNumber,
      networkName,
      network.selfLink,
      psaRangeName,
      psaPrefixLength,
    );

    const alloy = await ensureAlloyDb({
      projectId,
      projectNumber,
      region,
      zone,
      networkName,
      alloyCluster,
      alloyInstance,
      alloyDbVersion,
      alloyCpuCount,
      alloyAvailabilityType,
      postgresUser,
      postgresPassword,
      psaRangeName,
    });

    let hostIp: string;
    if (talosMode) {
      if (!talosImage) {
        throw new Error('--talos-image / GCP_TALOS_IMAGE is required in Talos mode');
      }
      hostIp = await ensureVmTalos({
        projectId,
        zone,
        vmName,
        vmMachineType,
        vmDiskSizeGb,
        vmDiskType,
        talosImage,
        subnetworkSelfLink: subnetwork.selfLink,
        targetTag,
      });
    } else {
      hostIp = await ensureVm({
        projectId,
        zone,
        vmName,
        vmMachineType,
        vmDiskSizeGb,
        vmDiskType,
        vmImageProject,
        vmImageFamily,
        subnetworkSelfLink: subnetwork.selfLink,
        targetTag,
        publicKey: readKeyFile(publicKeyFile!.path),
      });
    }

    const initHostEnv: Record<string, string | undefined> = {
      ...process.env,
      CALYPSO_IMAGE_TAG: imageTag,
      REMOTE_PG_HOST: alloy.ipAddress,
      REMOTE_PG_PORT: '5432',
      REMOTE_PG_ADMIN_DB: 'postgres',
      REMOTE_PG_ADMIN_USER: postgresUser,
      REMOTE_PG_ADMIN_PASSWORD: postgresPassword,
      REMOTE_PG_SSL: 'require',
      CALYPSO_NON_INTERACTIVE: nonInteractive ? '1' : process.env.CALYPSO_NON_INTERACTIVE,
    };

    if (talosMode) {
      log(`Waiting for Talos API on ${hostIp}:50000`);
      await waitForTcpPort(hostIp, 50000, 5 * 60_000);

      log(`Delegating host bootstrap to scripts/init-host-talos.sh for ${hostIp}`);
      runCommand(['bash', 'scripts/init-host-talos.sh', hostIp, environment], {
        env: initHostEnv,
      });
    } else {
      log(`Waiting for SSH on ${hostIp}:22`);
      await waitForTcpPort(hostIp, 22, 5 * 60_000);

      log(`Delegating host bootstrap to scripts/init-host.sh for ${hostIp}`);
      const initHostCommand = ['bash', 'scripts/init-host.sh', hostIp, environment, '--admin-key'];
      initHostCommand.push(publicKeyFile!.path);
      if (sshAuth!.privateKeyPath) {
        initHostCommand.push('--root-key', sshAuth!.privateKeyPath);
      }
      runCommand(initHostCommand, {
        env: initHostEnv,
      });
    }

    log('Provisioning complete.');
    console.log('');
    console.log(`Environment:       ${environment}`);
    console.log(`VM:                ${vmName}`);
    console.log(`VM external IP:    ${hostIp}`);
    console.log(`AlloyDB cluster:   ${alloyCluster}`);
    console.log(`AlloyDB instance:  ${alloyInstance}`);
    console.log(`AlloyDB IP:        ${alloy.ipAddress}`);
    console.log(`Namespace:         calypso-${environment}`);
    if (talosMode) {
      console.log(`Bootstrap mode:    talos`);
    }
  } finally {
    sshAuth?.cleanup();
    publicKeyFile?.cleanup();
  }
}

export async function ensureRequiredServices(projectNumber: string): Promise<void> {
  const services = [
    'compute.googleapis.com',
    'alloydb.googleapis.com',
    'serviceusage.googleapis.com',
    'servicenetworking.googleapis.com',
    'cloudresourcemanager.googleapis.com',
  ];

  for (const service of services) {
    const state = await googleJsonRequest<{ state?: string }>(
      `https://serviceusage.googleapis.com/v1/projects/${projectNumber}/services/${service}`,
    );
    if (state?.state === 'ENABLED') continue;

    log(`Enabling ${service}`);
    const operation = await googleJsonRequest<{ name?: string }>(
      `https://serviceusage.googleapis.com/v1/projects/${projectNumber}/services/${service}:enable`,
      {
        method: 'POST',
      },
    );
    if (operation?.name) {
      await waitForGoogleOperation(
        `enable ${service}`,
        operationPollUrl(operation, 'https://serviceusage.googleapis.com/v1'),
      );
    }
  }
}

export async function ensureNetwork(
  projectId: string,
  networkName: string,
): Promise<ComputeNetwork> {
  const existing = await googleJsonRequest<ComputeNetwork>(
    `https://compute.googleapis.com/compute/v1/projects/${projectId}/global/networks/${networkName}`,
    {},
    { allow404: true },
  );
  if (existing) return existing;

  log(`Creating VPC network ${networkName}`);
  const operation = await googleJsonRequest<{ name?: string }>(
    `https://compute.googleapis.com/compute/v1/projects/${projectId}/global/networks`,
    {
      method: 'POST',
      body: JSON.stringify({
        name: networkName,
        autoCreateSubnetworks: false,
        routingConfig: { routingMode: 'REGIONAL' },
      }),
    },
  );
  if (!operation?.name) throw new Error('Network creation did not return an operation');
  await waitForGoogleOperation(
    `create network ${networkName}`,
    computeGlobalOperationUrl(projectId, operation.name),
  );

  const created = await googleJsonRequest<ComputeNetwork>(
    `https://compute.googleapis.com/compute/v1/projects/${projectId}/global/networks/${networkName}`,
  );
  if (!created) throw new Error(`Failed to read back network ${networkName}`);
  return created;
}

export async function ensureSubnetwork(
  projectId: string,
  region: string,
  subnetworkName: string,
  networkSelfLink: string,
  cidr: string,
): Promise<ComputeSubnetwork> {
  const existing = await googleJsonRequest<ComputeSubnetwork>(
    `https://compute.googleapis.com/compute/v1/projects/${projectId}/regions/${region}/subnetworks/${subnetworkName}`,
    {},
    { allow404: true },
  );
  if (existing) return existing;

  log(`Creating subnetwork ${subnetworkName}`);
  const operation = await googleJsonRequest<{ name?: string }>(
    `https://compute.googleapis.com/compute/v1/projects/${projectId}/regions/${region}/subnetworks`,
    {
      method: 'POST',
      body: JSON.stringify({
        name: subnetworkName,
        ipCidrRange: cidr,
        network: networkSelfLink,
      }),
    },
  );
  if (!operation?.name) throw new Error('Subnetwork creation did not return an operation');
  await waitForGoogleOperation(
    `create subnetwork ${subnetworkName}`,
    computeRegionalOperationUrl(projectId, region, operation.name),
  );

  const created = await googleJsonRequest<ComputeSubnetwork>(
    `https://compute.googleapis.com/compute/v1/projects/${projectId}/regions/${region}/subnetworks/${subnetworkName}`,
  );
  if (!created) throw new Error(`Failed to read back subnetwork ${subnetworkName}`);
  return created;
}

export async function ensureFirewallRule(
  projectId: string,
  name: string,
  networkSelfLink: string,
  targetTag: string,
  ports: string[],
  sourceRangesCsv: string,
): Promise<void> {
  const existing = await googleJsonRequest(
    `https://compute.googleapis.com/compute/v1/projects/${projectId}/global/firewalls/${name}`,
    {},
    { allow404: true },
  );
  if (existing) return;

  log(`Creating firewall rule ${name}`);
  const operation = await googleJsonRequest<{ name?: string }>(
    `https://compute.googleapis.com/compute/v1/projects/${projectId}/global/firewalls`,
    {
      method: 'POST',
      body: JSON.stringify({
        name,
        network: networkSelfLink,
        direction: 'INGRESS',
        allowed: [{ IPProtocol: 'tcp', ports }],
        sourceRanges: sourceRangesCsv
          .split(',')
          .map((entry) => entry.trim())
          .filter(Boolean),
        targetTags: [targetTag],
      }),
    },
  );
  if (!operation?.name)
    throw new Error(`Firewall rule creation did not return an operation for ${name}`);
  await waitForGoogleOperation(
    `create firewall rule ${name}`,
    computeGlobalOperationUrl(projectId, operation.name),
  );
}

export async function ensurePrivateServiceAccess(
  projectId: string,
  projectNumber: string,
  networkName: string,
  networkSelfLink: string,
  psaRangeName: string,
  prefixLength: number,
): Promise<void> {
  const existingRange = await googleJsonRequest(
    `https://compute.googleapis.com/compute/v1/projects/${projectId}/global/addresses/${psaRangeName}`,
    {},
    { allow404: true },
  );
  if (!existingRange) {
    log(`Creating private services access range ${psaRangeName}`);
    const rangeOperation = await googleJsonRequest<{ name?: string }>(
      `https://compute.googleapis.com/compute/v1/projects/${projectId}/global/addresses`,
      {
        method: 'POST',
        body: JSON.stringify({
          name: psaRangeName,
          addressType: 'INTERNAL',
          purpose: 'VPC_PEERING',
          prefixLength,
          network: networkSelfLink,
        }),
      },
    );
    if (!rangeOperation?.name) {
      throw new Error(`Address reservation did not return an operation for ${psaRangeName}`);
    }
    await waitForGoogleOperation(
      `reserve PSA range ${psaRangeName}`,
      computeGlobalOperationUrl(projectId, rangeOperation.name),
    );
  }

  const connectionBody = {
    network: `projects/${projectNumber}/global/networks/${networkName}`,
    reservedPeeringRanges: [psaRangeName],
  };

  try {
    log(`Ensuring private services access connection for ${networkName}`);
    const operation = await googleJsonRequest<{ name?: string }>(
      'https://servicenetworking.googleapis.com/v1/services/servicenetworking.googleapis.com/connections',
      {
        method: 'POST',
        body: JSON.stringify(connectionBody),
      },
    );
    if (operation?.name) {
      await waitForGoogleOperation(
        `create private services access connection for ${networkName}`,
        operationPollUrl(operation, 'https://servicenetworking.googleapis.com/v1'),
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (
      message.includes('Cannot modify allocated ranges in CreateConnection') ||
      message.includes('already exists') ||
      message.includes('Cannot create connection') ||
      (message.includes('peering') && message.includes('exists'))
    ) {
      log(`Private services access connection already exists for ${networkName}`);
      return;
    }
    throw error;
  }
}

export async function ensureAlloyDb(config: {
  projectId: string;
  projectNumber: string;
  region: string;
  zone: string;
  networkName: string;
  alloyCluster: string;
  alloyInstance: string;
  alloyDbVersion: string;
  alloyCpuCount: number;
  alloyAvailabilityType: string;
  postgresUser: string;
  postgresPassword: string;
  psaRangeName: string;
}): Promise<{ ipAddress: string }> {
  const clusterUrl = `https://alloydb.googleapis.com/v1/projects/${config.projectId}/locations/${config.region}/clusters/${config.alloyCluster}`;
  let cluster = await googleJsonRequest<AlloyCluster>(clusterUrl, {}, { allow404: true });

  if (!cluster) {
    log(`Creating AlloyDB cluster ${config.alloyCluster}`);
    const operation = await googleJsonRequest<{ name?: string }>(
      `https://alloydb.googleapis.com/v1/projects/${config.projectId}/locations/${config.region}/clusters?clusterId=${encodeURIComponent(config.alloyCluster)}`,
      {
        method: 'POST',
        body: JSON.stringify({
          databaseVersion: config.alloyDbVersion,
          initialUser: {
            user: config.postgresUser,
            password: config.postgresPassword,
          },
          networkConfig: {
            network: `projects/${config.projectNumber}/global/networks/${config.networkName}`,
            allocatedIpRange: config.psaRangeName,
          },
          labels: {
            app: 'calypso',
            env: config.alloyCluster,
          },
        }),
      },
    );
    if (!operation?.name) throw new Error(`AlloyDB cluster creation did not return an operation`);
    await waitForGoogleOperation(
      `create AlloyDB cluster ${config.alloyCluster}`,
      operationPollUrl(operation, 'https://alloydb.googleapis.com/v1'),
      30 * 60_000,
    );
    cluster = await googleJsonRequest<AlloyCluster>(clusterUrl);
  }

  if (cluster?.state && cluster.state !== 'READY') {
    await waitUntilClusterReady(clusterUrl, config.alloyCluster);
  }

  const instanceUrl = `${clusterUrl}/instances/${config.alloyInstance}`;
  let instance = await googleJsonRequest<AlloyInstance>(instanceUrl, {}, { allow404: true });
  if (!instance) {
    log(`Creating AlloyDB primary instance ${config.alloyInstance}`);
    const operation = await googleJsonRequest<{ name?: string }>(
      `${clusterUrl}/instances?instanceId=${encodeURIComponent(config.alloyInstance)}`,
      {
        method: 'POST',
        body: JSON.stringify({
          instanceType: 'PRIMARY',
          machineConfig: {
            cpuCount: config.alloyCpuCount,
          },
          availabilityType: config.alloyAvailabilityType,
          gceZone: config.alloyAvailabilityType === 'ZONAL' ? config.zone : undefined,
        }),
      },
    );
    if (!operation?.name) {
      throw new Error(`AlloyDB instance creation did not return an operation`);
    }
    await waitForGoogleOperation(
      `create AlloyDB instance ${config.alloyInstance}`,
      operationPollUrl(operation, 'https://alloydb.googleapis.com/v1'),
      45 * 60_000,
    );
    instance = await googleJsonRequest<AlloyInstance>(instanceUrl);
  }

  if (!instance?.state || instance.state !== 'READY' || !instance.ipAddress) {
    instance = await waitUntilInstanceReady(instanceUrl, config.alloyInstance);
  }

  return { ipAddress: instance.ipAddress! };
}

async function waitUntilClusterReady(clusterUrl: string, clusterName: string): Promise<void> {
  log(`Waiting for AlloyDB cluster ${clusterName} to become READY`);
  const startedAt = Date.now();
  while (Date.now() - startedAt < 30 * 60_000) {
    const cluster = await googleJsonRequest<AlloyCluster>(clusterUrl);
    if (cluster?.state === 'READY') return;
    if (cluster?.state === 'FAILED') {
      throw new Error(`AlloyDB cluster ${clusterName} entered FAILED state`);
    }
    await sleep(5_000);
  }
  throw new Error(`Timed out waiting for AlloyDB cluster ${clusterName}`);
}

async function waitUntilInstanceReady(
  instanceUrl: string,
  instanceName: string,
): Promise<AlloyInstance> {
  log(`Waiting for AlloyDB instance ${instanceName} to become READY`);
  const startedAt = Date.now();
  while (Date.now() - startedAt < 45 * 60_000) {
    const instance = await googleJsonRequest<AlloyInstance>(instanceUrl);
    if (instance?.state === 'READY' && instance.ipAddress) return instance;
    if (instance?.state === 'FAILED') {
      throw new Error(`AlloyDB instance ${instanceName} entered FAILED state`);
    }
    await sleep(5_000);
  }
  throw new Error(`Timed out waiting for AlloyDB instance ${instanceName}`);
}

export async function ensureVm(config: {
  projectId: string;
  zone: string;
  vmName: string;
  vmMachineType: string;
  vmDiskSizeGb: number;
  vmDiskType: string;
  vmImageProject: string;
  vmImageFamily: string;
  subnetworkSelfLink: string;
  targetTag: string;
  publicKey: string;
}): Promise<string> {
  const instanceUrl = `https://compute.googleapis.com/compute/v1/projects/${config.projectId}/zones/${config.zone}/instances/${config.vmName}`;
  let instance = await googleJsonRequest<ComputeInstance>(instanceUrl, {}, { allow404: true });

  if (!instance) {
    log(`Creating Compute Engine VM ${config.vmName}`);
    const startupScript = buildRootSshStartupScript(config.publicKey);
    const operation = await googleJsonRequest<{ name?: string }>(
      `https://compute.googleapis.com/compute/v1/projects/${config.projectId}/zones/${config.zone}/instances`,
      {
        method: 'POST',
        body: JSON.stringify({
          name: config.vmName,
          machineType: `zones/${config.zone}/machineTypes/${config.vmMachineType}`,
          tags: { items: [config.targetTag] },
          metadata: {
            items: [
              { key: 'enable-oslogin', value: 'FALSE' },
              { key: 'startup-script', value: startupScript },
            ],
          },
          disks: [
            {
              boot: true,
              autoDelete: true,
              initializeParams: {
                sourceImage: `projects/${config.vmImageProject}/global/images/family/${config.vmImageFamily}`,
                diskSizeGb: String(config.vmDiskSizeGb),
                diskType: `zones/${config.zone}/diskTypes/${config.vmDiskType}`,
              },
            },
          ],
          networkInterfaces: [
            {
              subnetwork: config.subnetworkSelfLink,
              accessConfigs: [
                {
                  name: 'External NAT',
                  type: 'ONE_TO_ONE_NAT',
                },
              ],
            },
          ],
        }),
      },
    );
    if (!operation?.name) throw new Error('Compute instance creation did not return an operation');
    await waitForGoogleOperation(
      `create Compute Engine VM ${config.vmName}`,
      computeZonalOperationUrl(config.projectId, config.zone, operation.name),
      15 * 60_000,
    );
    instance = await googleJsonRequest<ComputeInstance>(instanceUrl);
  }

  if (instance?.status !== 'RUNNING') {
    log(`Starting Compute Engine VM ${config.vmName}`);
    const operation = await googleJsonRequest<{ name?: string }>(`${instanceUrl}/start`, {
      method: 'POST',
    });
    if (operation?.name) {
      await waitForGoogleOperation(
        `start Compute Engine VM ${config.vmName}`,
        computeZonalOperationUrl(config.projectId, config.zone, operation.name),
      );
    }
    instance = await googleJsonRequest<ComputeInstance>(instanceUrl);
  }

  const natIp = instance ? extractNatIp(instance) : undefined;
  if (!natIp) {
    throw new Error(`No external IP found on VM ${config.vmName}`);
  }
  return natIp;
}

export async function ensureVmTalos(config: {
  projectId: string;
  zone: string;
  vmName: string;
  vmMachineType: string;
  vmDiskSizeGb: number;
  vmDiskType: string;
  talosImage: string;
  subnetworkSelfLink: string;
  targetTag: string;
}): Promise<string> {
  const instanceUrl = `https://compute.googleapis.com/compute/v1/projects/${config.projectId}/zones/${config.zone}/instances/${config.vmName}`;
  let instance = await googleJsonRequest<ComputeInstance>(instanceUrl, {}, { allow404: true });

  if (!instance) {
    log(`Creating Compute Engine VM ${config.vmName} with Talos image`);
    const operation = await googleJsonRequest<{ name?: string }>(
      `https://compute.googleapis.com/compute/v1/projects/${config.projectId}/zones/${config.zone}/instances`,
      {
        method: 'POST',
        body: JSON.stringify({
          name: config.vmName,
          machineType: `zones/${config.zone}/machineTypes/${config.vmMachineType}`,
          tags: { items: [config.targetTag] },
          metadata: {
            items: [{ key: 'enable-oslogin', value: 'FALSE' }],
          },
          disks: [
            {
              boot: true,
              autoDelete: true,
              initializeParams: {
                sourceImage: config.talosImage,
                diskSizeGb: String(config.vmDiskSizeGb),
                diskType: `zones/${config.zone}/diskTypes/${config.vmDiskType}`,
              },
            },
          ],
          networkInterfaces: [
            {
              subnetwork: config.subnetworkSelfLink,
              accessConfigs: [
                {
                  name: 'External NAT',
                  type: 'ONE_TO_ONE_NAT',
                },
              ],
            },
          ],
        }),
      },
    );
    if (!operation?.name) throw new Error('Compute instance creation did not return an operation');
    await waitForGoogleOperation(
      `create Compute Engine VM ${config.vmName}`,
      computeZonalOperationUrl(config.projectId, config.zone, operation.name),
      15 * 60_000,
    );
    instance = await googleJsonRequest<ComputeInstance>(instanceUrl);
  }

  if (instance?.status !== 'RUNNING') {
    log(`Starting Compute Engine VM ${config.vmName}`);
    const operation = await googleJsonRequest<{ name?: string }>(`${instanceUrl}/start`, {
      method: 'POST',
    });
    if (operation?.name) {
      await waitForGoogleOperation(
        `start Compute Engine VM ${config.vmName}`,
        computeZonalOperationUrl(config.projectId, config.zone, operation.name),
      );
    }
    instance = await googleJsonRequest<ComputeInstance>(instanceUrl);
  }

  const natIp = instance ? extractNatIp(instance) : undefined;
  if (!natIp) {
    throw new Error(`No external IP found on VM ${config.vmName}`);
  }
  return natIp;
}

function buildRootSshStartupScript(publicKey: string): string {
  return `#!/usr/bin/env bash
set -euo pipefail
install -d -m 700 /root/.ssh
cat >/root/.ssh/authorized_keys <<'EOF'
${publicKey}
EOF
chmod 600 /root/.ssh/authorized_keys
`;
}

function readKeyFile(path: string): string {
  return runCommand(['cat', path]).stdout;
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(`\n❌ ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
