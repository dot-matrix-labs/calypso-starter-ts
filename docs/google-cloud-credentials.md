# Google Cloud Credentials

This repository supports two Google Cloud auth modes:

- Local provisioning from a developer terminal via repository-owned OAuth login
  (`scripts/gcp/login.ts`) and token refresh.
- GitHub deploy via Workload Identity Federation (WIF) and short-lived access
  tokens.

The scripts call Google APIs directly over REST and do not require the `gcloud`
binary.

## Credential resolution order

All Google Cloud scripts (`doctor`, `provision`, `deploy`) resolve credentials in
this order:

1. `GCP_ACCESS_TOKEN`
2. `GCP_OAUTH_TOKEN_FILE` (default `~/.config/calypso/gcp-oauth-token.json`)
3. `GCP_SERVICE_ACCOUNT_JSON`
4. `GOOGLE_APPLICATION_CREDENTIALS`
5. `GCP_SERVICE_ACCOUNT_FILE`
6. `GCP_SERVICE_ACCOUNT_KEY_JSON`
7. `GCP_SERVICE_ACCOUNT_KEY_FILE`

`GCP_ACCESS_TOKEN` is the common runtime input and works for both local and CI.

## Local developer auth (OAuth)

Create or refresh local terminal credentials:

```sh
bun run gcp:login --client-id "$GCP_OAUTH_CLIENT_ID"
```

Optional flags:

- `--client-secret` or `GCP_OAUTH_CLIENT_SECRET`
- `--token-file` or `GCP_OAUTH_TOKEN_FILE`
- `--scopes` or `GCP_OAUTH_SCOPES`
- `--no-browser` to copy/paste URL manually

The login script:

- starts a localhost callback server
- runs OAuth authorization code flow with PKCE
- stores refreshable token material in the token file

At runtime, scripts refresh access tokens automatically from that local token
file when needed.

## GitHub deploy auth (WIF)

Deploy workflow uses:

- `google-github-actions/auth@v3`
- GitHub OIDC (`id-token: write`)
- Google Workload Identity Provider + service account impersonation

That action mints a short-lived access token and exports it as
`GCP_ACCESS_TOKEN` to `scripts/gcp/deploy.ts`.

Required GitHub secrets for deploy:

- `GCP_WORKLOAD_IDENTITY_PROVIDER` (provider resource name)
- `GCP_WIF_SERVICE_ACCOUNT` (service account email)
- existing deploy secrets (`GCP_PROJECT_ID`, `GCP_REGION`, `GCP_ZONE`, SSH key, etc.)

GitOps deploy does not provision infrastructure.

## Service-account JSON fallback (migration path)

Service-account JSON credentials remain supported as fallback while migrating
existing environments. Preferred model is OAuth local + WIF in GitHub.

## Doctor and permissions checks

Run doctor before provisioning:

```sh
bun run gcp:doctor --project "$GCP_PROJECT_ID" --mode provision
```

Doctor validates:

- credential validity
- project readability
- required APIs enabled state
- permission coverage using `projects.testIamPermissions`

Provisioning role bundle guidance:

- `roles/serviceusage.serviceUsageAdmin`
- `roles/compute.instanceAdmin.v1`
- `roles/compute.networkAdmin`
- `roles/compute.securityAdmin`
- `roles/alloydb.admin`

Add `roles/compute.imageUser` if using private custom VM images.
