# Google Cloud Deployment

Calypso now includes two Bun scripts for Google Cloud deployment automation without
`gcloud`:

- `scripts/gcp/provision.ts`
- `scripts/gcp/deploy.ts`

## Authentication

These scripts call Google Cloud REST APIs directly. Use one of:

- `GCP_ACCESS_TOKEN`
- `GCP_SERVICE_ACCOUNT_KEY_JSON`
- `GCP_SERVICE_ACCOUNT_KEY_FILE`
- `GOOGLE_APPLICATION_CREDENTIALS`

Standard API keys are not sufficient for IAM-authorized provisioning calls.

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
