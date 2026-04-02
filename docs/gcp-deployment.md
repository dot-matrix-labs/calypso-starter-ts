# Google Cloud Deployment

Calypso now includes three Bun scripts for Google Cloud deployment automation without
`gcloud`:

- `scripts/gcp/doctor.ts`
- `scripts/gcp/provision.ts`
- `scripts/gcp/deploy.ts`

## Authentication

These scripts call Google Cloud REST APIs directly. The canonical credential inputs are:

- `GCP_SERVICE_ACCOUNT_JSON`
- `GOOGLE_APPLICATION_CREDENTIALS`

Supported legacy fallbacks are:

- `GCP_SERVICE_ACCOUNT_FILE`
- `GCP_SERVICE_ACCOUNT_KEY_JSON`
- `GCP_SERVICE_ACCOUNT_KEY_FILE`
- `GCP_ACCESS_TOKEN`

Standard API keys are not sufficient for IAM-authorized provisioning calls.

Recommended default:

- CLI: `export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json`
- GitHub Actions: store the raw JSON in `GCP_SERVICE_ACCOUNT_JSON`

## Required permissions

For provisioning, the doctor checks this exact permission set:

- `resourcemanager.projects.get`
- `serviceusage.services.get`
- `serviceusage.services.enable`
- `compute.networks.get`
- `compute.networks.create`
- `compute.subnetworks.get`
- `compute.subnetworks.create`
- `compute.firewalls.get`
- `compute.firewalls.create`
- `compute.globalAddresses.get`
- `compute.globalAddresses.create`
- `compute.instances.get`
- `compute.instances.create`
- `compute.instances.start`
- `compute.images.useReadOnly`
- `compute.subnetworks.use`
- `compute.subnetworks.useExternalIp`
- `compute.globalOperations.get`
- `compute.regionOperations.get`
- `compute.zoneOperations.get`
- `servicenetworking.services.addPeering`
- `alloydb.clusters.get`
- `alloydb.clusters.create`
- `alloydb.instances.get`
- `alloydb.instances.create`
- `alloydb.operations.get`

The simplest role bundle that matches that scope is:

- `roles/serviceusage.serviceUsageAdmin`
- `roles/compute.instanceAdmin.v1`
- `roles/compute.networkAdmin`
- `roles/compute.securityAdmin`
- `roles/alloydb.admin`

If you switch the VM boot image to a private custom image, also grant
`roles/compute.imageUser` on the image project.

For deploy-only checks, the doctor only requires:

- `resourcemanager.projects.get`
- `compute.instances.get`
- `alloydb.clusters.get`
- `alloydb.instances.get`

## Doctor

Run the preflight explicitly with:

```sh
bun run gcp:doctor --project my-project --mode provision
```

`scripts/gcp/provision.ts` runs this doctor automatically unless
`--skip-doctor` or `CALYPSO_SKIP_GCP_DOCTOR=1` is set.

## Provisioning

`scripts/gcp/provision.ts` creates or reuses:

- a VPC and subnetwork
- firewall rules for SSH and the app port
- private services access for AlloyDB
- an AlloyDB cluster and primary instance
- a Compute Engine VM

After the infrastructure is ready, it invokes `scripts/init-host.sh` in remote
Postgres mode so the VM gets k3s, secrets, deploy RBAC, and the initial Calypso
deployment.

Example:

```sh
bun run scripts/gcp/provision.ts \
  --project my-project \
  --region us-central1 \
  --zone us-central1-a \
  --environment demo \
  --image-tag v1.2.3
```

Required env:

- `CALYPSO_SSH_PRIVATE_KEY` or `CALYPSO_SSH_PRIVATE_KEY_FILE`
- `GCP_ALLOYDB_POSTGRES_PASSWORD`
- `MNEMONIC` or interactive input for the superuser bootstrap

## Deploy

`scripts/gcp/deploy.ts` checks:

- Compute Engine VM is `RUNNING`
- AlloyDB cluster and instance are `READY`
- SSH can reach the host
- the host can reach AlloyDB on port `5432`
- Kubernetes namespace, secrets, and `deployment/calypso-app` are healthy

If checks pass, it prepares a temporary kubeconfig over an SSH tunnel and runs
`./deploy.sh <tag>`.

Example:

```sh
bun run scripts/gcp/deploy.ts \
  --project my-project \
  --region us-central1 \
  --zone us-central1-a \
  --environment demo \
  --vm-name calypso-demo-vm \
  --alloydb-cluster calypso-demo-db \
  --alloydb-instance calypso-demo-primary \
  --tag v1.2.4
```

Use `--check-only` to stop after liveness validation.
