#!/usr/bin/env bun

import {
  getGoogleCredentialInfo,
  getGoogleAccessToken,
  getProjectNumber,
  googleJsonRequest,
  log,
  parseArgs,
  printHelp,
  resolveOption,
  resolveRequiredOption,
} from './common';

type DoctorMode = 'provision' | 'deploy';

interface DoctorConfig {
  mode: DoctorMode;
  projectId: string;
  quiet?: boolean;
}

interface PermissionCheckResponse {
  permissions?: string[];
}

interface ProjectResponse {
  projectId?: string;
  projectNumber?: string;
  lifecycleState?: string;
  name?: string;
}

interface ServiceStateResponse {
  state?: string;
}

interface DoctorResult {
  credential: ReturnType<typeof getGoogleCredentialInfo>;
  disabledServices: string[];
  missingPermissions: string[];
  mode: DoctorMode;
  ok: boolean;
  projectId: string;
  projectNumber: string;
  warnings: string[];
}

const REQUIRED_SERVICES = [
  'compute.googleapis.com',
  'alloydb.googleapis.com',
  'serviceusage.googleapis.com',
  'servicenetworking.googleapis.com',
  'cloudresourcemanager.googleapis.com',
] as const;

const PROVISION_PERMISSIONS = [
  'resourcemanager.projects.get',
  'serviceusage.services.get',
  'serviceusage.services.enable',
  'compute.networks.get',
  'compute.networks.create',
  'compute.subnetworks.get',
  'compute.subnetworks.create',
  'compute.firewalls.get',
  'compute.firewalls.create',
  'compute.globalAddresses.get',
  'compute.globalAddresses.create',
  'compute.instances.get',
  'compute.instances.create',
  'compute.instances.start',
  'compute.images.useReadOnly',
  'compute.subnetworks.use',
  'compute.subnetworks.useExternalIp',
  'compute.globalOperations.get',
  'compute.regionOperations.get',
  'compute.zoneOperations.get',
  'servicenetworking.services.addPeering',
  'alloydb.clusters.get',
  'alloydb.clusters.create',
  'alloydb.instances.get',
  'alloydb.instances.create',
  'alloydb.operations.get',
] as const;

const DEPLOY_PERMISSIONS = [
  'resourcemanager.projects.get',
  'compute.instances.get',
  'alloydb.clusters.get',
  'alloydb.instances.get',
] as const;

const helpText = `
Validate the Google credential, project access, required APIs, and IAM
permissions before running Google Cloud provisioning or deploy checks.

Usage:
  bun run scripts/gcp/doctor.ts --project <project-id> [--mode provision|deploy]

Credential sources, in resolution order:
  1. GCP_ACCESS_TOKEN
  2. GCP_OAUTH_TOKEN_FILE (default: ~/.config/calypso/gcp-oauth-token.json)
  3. GCP_SERVICE_ACCOUNT_JSON
  4. GOOGLE_APPLICATION_CREDENTIALS
  5. GCP_SERVICE_ACCOUNT_FILE
  6. GCP_SERVICE_ACCOUNT_KEY_JSON
  7. GCP_SERVICE_ACCOUNT_KEY_FILE

Default mode: provision
`.trim();

export async function runDoctor(config: DoctorConfig): Promise<DoctorResult> {
  const credential = getGoogleCredentialInfo();
  const permissions =
    config.mode === 'provision' ? [...PROVISION_PERMISSIONS] : [...DEPLOY_PERMISSIONS];

  if (!config.quiet) {
    log(`Doctor: validating ${config.mode} credential for project ${config.projectId}`);
    log(`Doctor: credential source ${credential.source}`);
    if (credential.principal) {
      log(`Doctor: service account ${credential.principal}`);
    }
  }

  await getGoogleAccessToken();

  const project = await googleJsonRequest<ProjectResponse>(
    `https://cloudresourcemanager.googleapis.com/v1/projects/${config.projectId}`,
  );
  if (!project?.projectId || !project.projectNumber) {
    throw new Error(`Unable to read project metadata for ${config.projectId}`);
  }
  if (project.lifecycleState && project.lifecycleState !== 'ACTIVE') {
    throw new Error(
      `Project ${config.projectId} is ${project.lifecycleState}; expected ACTIVE before provisioning`,
    );
  }

  const grantedPermissions = await testProjectPermissions(config.projectId, permissions);
  const missingPermissions = permissions.filter(
    (permission) => !grantedPermissions.has(permission),
  );

  const projectNumber = await getProjectNumber(config.projectId);
  const disabledServices: string[] = [];
  for (const service of REQUIRED_SERVICES) {
    const state = await googleJsonRequest<ServiceStateResponse>(
      `https://serviceusage.googleapis.com/v1/projects/${projectNumber}/services/${service}`,
    );
    if (state?.state !== 'ENABLED') {
      disabledServices.push(service);
    }
  }

  const warnings: string[] = [];
  if (
    disabledServices.length > 0 &&
    !grantedPermissions.has('serviceusage.services.enable') &&
    config.mode === 'provision'
  ) {
    warnings.push(
      `Required APIs are disabled but the credential cannot enable them: ${disabledServices.join(', ')}`,
    );
  }

  const ok =
    missingPermissions.length === 0 &&
    (config.mode !== 'provision' ||
      disabledServices.length === 0 ||
      grantedPermissions.has('serviceusage.services.enable'));

  return {
    credential,
    disabledServices,
    missingPermissions,
    mode: config.mode,
    ok,
    projectId: config.projectId,
    projectNumber,
    warnings,
  };
}

function printDoctorResult(result: DoctorResult): void {
  console.log('');
  console.log(`Mode:              ${result.mode}`);
  console.log(`Project:           ${result.projectId}`);
  console.log(`Project number:    ${result.projectNumber}`);
  console.log(`Credential source: ${result.credential.source}`);
  console.log(
    `Principal:         ${result.credential.principal ?? '(not derivable from access token env)'}`,
  );
  console.log(
    `Missing perms:     ${result.missingPermissions.length === 0 ? 'none' : result.missingPermissions.join(', ')}`,
  );
  console.log(
    `Disabled APIs:     ${result.disabledServices.length === 0 ? 'none' : result.disabledServices.join(', ')}`,
  );

  if (result.mode === 'provision') {
    console.log('');
    console.log('Recommended role set for this tool:');
    console.log('  - roles/serviceusage.serviceUsageAdmin');
    console.log('  - roles/compute.instanceAdmin.v1');
    console.log('  - roles/compute.networkAdmin');
    console.log('  - roles/compute.securityAdmin');
    console.log('  - roles/alloydb.admin');
    console.log('  - roles/compute.imageUser only if you switch to a non-public custom image');
  }

  for (const warning of result.warnings) {
    console.log(`Warning: ${warning}`);
  }
}

async function testProjectPermissions(
  projectId: string,
  permissions: readonly string[],
): Promise<Set<string>> {
  const response = await googleJsonRequest<PermissionCheckResponse>(
    `https://cloudresourcemanager.googleapis.com/v1/projects/${projectId}:testIamPermissions`,
    {
      method: 'POST',
      body: JSON.stringify({ permissions }),
    },
  );
  return new Set(response?.permissions ?? []);
}

async function main(): Promise<void> {
  const args = parseArgs();
  if (args.flags.has('help')) {
    printHelp('scripts/gcp/doctor.ts', helpText);
    return;
  }

  const projectId = resolveRequiredOption(args, 'project', ['GCP_PROJECT_ID'], 'GCP project');
  const modeValue = resolveOption(args, 'mode', ['CALYPSO_GCP_DOCTOR_MODE'], 'provision');
  if (modeValue !== 'provision' && modeValue !== 'deploy') {
    throw new Error(`--mode must be "provision" or "deploy", got "${modeValue}"`);
  }

  const result = await runDoctor({
    mode: modeValue,
    projectId,
  });
  printDoctorResult(result);

  if (!result.ok) {
    process.exit(1);
  }
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(`\n❌ ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
