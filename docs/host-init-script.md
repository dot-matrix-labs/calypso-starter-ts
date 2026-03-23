# Host Initialisation Script and GitOps Deploy Runbook

## Overview

`scripts/init-host.sh` provisions a Calypso host entirely from the developer's
local machine over SSH. No files are copied to the remote host before running.
The script drives all phases remotely.

CI/CD deploys use a separate workflow (`.github/workflows/deploy.yml`) that
runs `deploy.sh` on the GitHub Actions runner and connects to the k3s API via
a short-lived SSH tunnel. The host never needs an open k3s API port.

## Security model

- A dedicated `superfield` OS user owns all k3s data and the k3s daemon.
- `superfield` has no sudo rights and no password login. Access is via
  SSH public key only.
- The k3s API binds to `localhost:6443` only. ufw does NOT open port 6443.
- CI/CD connects via an SSH tunnel through `superfield@<host>`.
- ServiceAccount tokens are short-lived (1h TTL via TokenRequest API).
  No static kubeconfig is stored as a GitHub secret.
- Root SSH login is disabled after bootstrap (opt-out via `--keep-root-ssh`).

## Initial provisioning

Run from your local machine (not on the host):

```bash
scripts/init-host.sh <host> <env> --admin-key ~/.ssh/id_ed25519.pub
```

Where:

- `<host>` — IP address or hostname of the target server
- `<env>` — environment label (`demo` or `prod`); namespace will be `calypso-<env>`
- `--admin-key` — path to a public key file to install in `superfield`'s
  `authorized_keys`. Repeat for multiple admin keys.

### Accepted key types

| Type    | Min strength   | Accepted     |
| ------- | -------------- | ------------ |
| Ed25519 | —              | Yes          |
| ECDSA   | P-256 or P-384 | Yes          |
| RSA     | >= 3072 bits   | Yes          |
| RSA     | < 3072 bits    | **Rejected** |
| DSA     | any            | **Rejected** |

To generate a suitable key:

```bash
ssh-keygen -t ed25519 -C "your-name@example.com" -f ~/.ssh/calypso_admin
```

### What the script does

1. **Root bootstrap (SSH as root@host):**
   - Creates `superfield` OS account (no sudo, no wheel/sudo group membership)
   - Locks account with `passwd -l superfield` (password login disabled)
   - Writes supplied public key(s) to `/home/superfield/.ssh/authorized_keys`
     with `600` permissions
   - Validates each key's type and strength; rejects weak keys
   - Hardens sshd globally: `PasswordAuthentication no`, `MaxAuthTries 3`,
     `LoginGraceTime 30`, `AllowUsers superfield`

2. **CIS Benchmark Level 1 host hardening:**
   - Disables unused services: `avahi-daemon`, `cups`, `postfix` (if present)
   - Kernel sysctl: disables IP source routing, enables SYN cookies,
     restricts core dumps
   - Enables `unattended-upgrades` for automatic security patches

3. **Root SSH lockdown:**
   - Sets `PermitRootLogin no` in sshd_config
   - Removes root's `authorized_keys`
   - Pass `--keep-root-ssh` to skip (prints an explicit warning)

4. **k3s installation (systemd, User=superfield):**
   - Installs k3s as a systemd service with `User=superfield`
   - Data directory and kubeconfig owned by `superfield`
   - API server binds to `127.0.0.1:6443` only
   - ufw does NOT open port 6443

5. **Kubernetes ServiceAccount and RBAC:**
   - Creates namespace `calypso-<env>`
   - Creates ServiceAccount `calypso-deployer` in the namespace
   - Creates Role with RBAC limited to `patch` on `deployments` in namespace
   - Binds role to ServiceAccount

6. **Application secrets and manifests:**
   - SSH-es as `superfield` using the just-installed admin key
   - Injects application secrets and applies k8s manifests
   - Polls `/healthz` until the app responds

7. **Bootstrap summary:**
   - Prints the full list of GitHub Actions secrets to configure
   - Prints exact `gh secret set --env <env>` commands for the operator

### Required GitHub Actions secrets (set after bootstrap)

The script prints these at the end. Set them manually:

```bash
# Replace <env> with demo or prod, <host> with your host address
gh secret set DEPLOY_SSH_KEY --env <env> < ~/.ssh/calypso_admin
gh secret set DEPLOY_HOST --env <env> --body "<host>"
gh secret set DEPLOY_SA_NAME --env <env> --body "calypso-deployer"
gh secret set DEPLOY_NAMESPACE --env <env> --body "calypso-<env>"
# K3S_CA_CERT is printed by the script after bootstrap — copy and paste:
gh secret set K3S_CA_CERT --env <env> --body "<paste CA cert here>"
```

All secrets are per-environment so `demo` and `prod` use separate credentials.

## Adding admin keys (after initial bootstrap)

```bash
scripts/init-host.sh <host> <env> --admin-key ~/.ssh/new_admin_key.pub
```

Re-running with a new key appends it to `authorized_keys` without removing
existing keys. This is idempotent — safe to run multiple times.

## Revoking admin keys

```bash
scripts/init-host.sh <host> <env> --revoke-key ~/.ssh/departing_admin_key.pub
```

The script removes the matching key from `authorized_keys`. It refuses to
revoke the last remaining key (exits non-zero with a clear error).

### Last-admin-standing scenario

If you are the last admin and need to rotate your key:

1. First, add the new key: `--admin-key ~/.ssh/new_key.pub`
2. Verify SSH access with the new key: `ssh -i ~/.ssh/new_key superfield@<host>`
3. Then revoke the old key: `--revoke-key ~/.ssh/old_key.pub`

Never revoke a key before verifying the replacement works.

## GitHub Environment protection (prod)

The `prod` environment must have required reviewers configured:

1. Go to **Settings > Environments > prod** in the repository.
2. Under **Required reviewers**, add at least one reviewer.
3. Enable **Prevent self-review** for production deploys.

The `demo` environment may be configured without reviewers for faster iteration.

## CI/CD deploy workflow

Deploys are always a human action via `workflow_dispatch`:

```
GitHub Actions UI → Actions tab → Deploy → Run workflow
  → image-tag: v1.2.3 (or sha-abc1234)
  → environment: demo (or prod)
```

### What the workflow does

1. Validates image tag format (semver or `sha-` prefix)
2. Checks out the repository (to access `deploy.sh`)
3. Installs `kubectl`
4. Configures SSH with the `DEPLOY_SSH_KEY` secret
5. Opens an SSH tunnel: `superfield@<host>` → `localhost:6443`
6. Generates a short-lived (1h) ServiceAccount token via
   `kubectl create token calypso-deployer --duration=1h` over SSH
7. Writes a kubeconfig with TLS verification (`certificate-authority-data`)
   — never uses `insecure-skip-tls-verify: true`
8. Creates a GitHub deployment event (pending)
9. Runs `./deploy.sh <image-tag>` on the runner
10. Annotates the Kubernetes deployment with actor, run ID, tag, timestamp
11. Updates the GitHub deployment status (success or failure)
12. Cleans up: removes kubeconfig, SSH key file, and kills the tunnel

The ServiceAccount token is masked in logs with `::add-mask::`.

### Concurrency

```yaml
concurrency:
  group: deploy-${{ inputs.environment }}
  cancel-in-progress: false
```

`cancel-in-progress: false` means concurrent deploys queue rather than cancel.
A deploy in flight always completes before the next one starts.

### Release vs deploy separation

`release.yml` builds and pushes the container image when a version tag is
pushed. It does NOT automatically trigger a deploy. This is intentional:

- Release and deploy are separate concerns.
- Production deploys require reviewer approval.
- Operators can deploy an older tag or re-deploy the same tag (rollback)
  without creating a new release.

## WireGuard alternative

Teams that prefer a persistent tunnel over the per-deploy SSH tunnel can use
WireGuard:

1. Install WireGuard on the host and runner (or self-hosted runner).
2. Configure a WireGuard interface on the host that allows the runner's WireGuard
   peer to reach `127.0.0.1:6443`.
3. Update the deploy workflow to skip the SSH tunnel step and instead use the
   WireGuard interface address as the k3s API server in the kubeconfig.

WireGuard is not required. The default SSH tunnel approach reuses the existing
`DEPLOY_SSH_KEY` secret and requires no additional infrastructure.

## SSH tunnel troubleshooting

**Tunnel fails to open:**

```bash
# Test SSH connectivity manually
ssh -i ~/.ssh/calypso_admin superfield@<host> echo ok

# Test tunnel manually
ssh -v -L 6443:localhost:6443 superfield@<host> -N
```

**Port collision (6443 already in use on runner):**
The tunnel step will fail with "bind: Address already in use". This usually
means a previous workflow run did not clean up. The `Cleanup` step (which runs
`if: always()`) kills the tunnel process. If the port is still bound after a
run, check for orphaned processes:

```bash
lsof -i :6443
```

**ServiceAccount token expired:**
Tokens have a 1h TTL. Each deploy run generates a fresh token. If you see
401 Unauthorized after 1 hour, trigger a new workflow run — the token will be
regenerated automatically.

**k3s API connection refused:**
Verify k3s is running as superfield:

```bash
ssh superfield@<host> systemctl status k3s
ssh superfield@<host> "ss -tlnp | grep 6443"
```

The API should show `127.0.0.1:6443`.

## k3s and superfield ownership verification

After provisioning, verify the setup:

```bash
# k3s service runs as superfield
ssh superfield@<host> systemctl status k3s
# Should show: User=superfield in the service unit

# Data directory owned by superfield
ssh superfield@<host> ls -la /home/superfield

# API bound to localhost only
ssh superfield@<host> "ss -tlnp | grep 6443"
# Should show: 127.0.0.1:6443 only

# superfield has no sudo
ssh superfield@<host> sudo -l
# Should return: permission denied

# Account is locked (password login disabled)
ssh superfield@<host> passwd --status superfield
# Should show: L (locked)

# sshd hardening
ssh superfield@<host> sshd -T | grep -E 'passwordauthentication|maxauthtries|logingracetime|allowusers'
```

## CIS hardening verification

```bash
# Unused services disabled
ssh superfield@<host> systemctl is-active avahi-daemon cups postfix 2>&1
# All should show: inactive or not-found

# Kernel sysctl
ssh superfield@<host> sysctl net.ipv4.conf.all.accept_source_route
# Should be 0

# Unattended upgrades enabled
ssh superfield@<host> systemctl is-active unattended-upgrades
# Should show: active
```

## Re-provisioning a failed host

If provisioning fails mid-way:

1. Identify the phase that failed from the error output.
2. Re-run `scripts/init-host.sh` — all phases are idempotent.
3. If k3s is in a bad state: `ssh superfield@<host> sudo k3s-uninstall.sh` then re-run.
4. If the `superfield` account is corrupted: SSH as root (if root login is still
   enabled) and run `userdel -r superfield` then re-run.

For catastrophic failures, re-image the host and start fresh.

## Common failure modes

| Symptom                                                | Cause                                 | Fix                                            |
| ------------------------------------------------------ | ------------------------------------- | ---------------------------------------------- |
| `ssh: connect to host ... port 22: Connection refused` | Host not reachable or SSH not running | Check host network / security group            |
| `Permission denied (publickey)`                        | Wrong key file                        | Verify `--admin-key` matches the installed key |
| `RSA key is too weak`                                  | Key < 3072 bits                       | Generate Ed25519: `ssh-keygen -t ed25519`      |
| `k3s not starting`                                     | Port conflict or resource limit       | Check `journalctl -u k3s` on host              |
| `kubeconfig: permission denied`                        | File mode wrong                       | `chmod 600 /home/superfield/.kube/config`      |
| `403 Forbidden` on deploy                              | ServiceAccount RBAC too narrow        | Verify Role binds to correct SA and namespace  |
| `Token expired`                                        | 1h TTL elapsed                        | Trigger new workflow run                       |
| `tunnel port collision`                                | Previous run not cleaned up           | Kill stale ssh process on runner               |
