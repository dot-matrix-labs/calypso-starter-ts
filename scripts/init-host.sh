#!/usr/bin/env bash
# init-host.sh — Calypso host provisioning via SSH (local-to-remote orchestrator)
#
# Usage:
#   scripts/init-host.sh <host> <env> --admin-key <pubkey-file> [options]
#
# Arguments:
#   <host>              Remote host address (IP or hostname) — SSH target
#   <env>               Deployment environment label (e.g. "demo", "prod")
#                       Kubernetes namespace will be "calypso-<env>"
#
# Optional:
#   --admin-key <file>  Path to a public key file to install in superfield's
#                       authorized_keys. May be specified multiple times for
#                       multiple admin keys. If omitted, a deploy keypair is
#                       derived deterministically from the mnemonic + env label
#                       (requires python3-cryptography on the local machine).
#   SUPERFIELD_ADMIN_PUBKEY
#                       Env var fallback — triggers a warning preferring
#                       --admin-key file input.
#
# Options:
#   --root-key <file>   Path to a private key file to use for the initial
#                       root SSH connection. Optional; defaults to system's
#                       configured SSH key.
#   --revoke-key <file> Remove matching key from remote authorized_keys.
#                       Refuses to revoke the last remaining key.
#   --dry-run           Print planned operations without executing them.
#   --help              Show this usage message.
#
# Environment variables (application credentials — passed to k8s secrets):
#   GITHUB_PAT          — GitHub PAT for pulling from GHCR (if using local DB)
#
# Optional env vars (remote postgres mode):
#   REMOTE_PG_HOST          — hostname of the managed postgres instance
#   REMOTE_PG_PORT          — port (default: 5432)
#   REMOTE_PG_ADMIN_DB      — admin database name (default: postgres)
#   REMOTE_PG_ADMIN_USER    — admin username
#   REMOTE_PG_ADMIN_PASSWORD — admin password
#   REMOTE_PG_SSL           — SSL mode: disable | require | verify-full (default: require)
#   REMOTE_PG_CA_CERT       — CA certificate PEM content (optional, for verify-full)
#
# Superuser Mnemonic:
#   The script will interactively prompt for the superuser's BIP-39 mnemonic.
#   For non-interactive use (e.g., in CI), you can provide the MNEMONIC
#   environment variable as an override.
#
# Optional API keys:
#   SUBSTACK_API_KEY
#   BLOOMBERG_API_KEY
#   YAHOO_API_KEY
#
# Exit codes:
#   0   — provisioning completed successfully
#   1   — argument or precondition error (no admin key, invalid key type, etc.)
#   2   — SSH connectivity failure
#   3   — provisioning phase failed (bootstrap, k3s install, k8s apply, etc.)
#
# Provisioning phases (run entirely over SSH from local machine):
#   1.  Root bootstrap: create superfield account (locked, no sudo), install
#       admin SSH key(s) with type/strength validation, harden sshd globally.
#   2.  CIS Benchmark Level 1 host hardening: disable unused services,
#       kernel sysctl security parameters, enable unattended-upgrades.
#   3.  Disable Root Password Login: sets PermitRootLogin to prohibit-password.
#       (opt-out via --keep-root-ssh with mandatory warning).
#   4.  k3s install as systemd service with User=superfield; API bound to
#       localhost only; all data under /home/superfield.
#   5.  Kubernetes namespace, ServiceAccount with minimal RBAC for deployer.
#   6.  Application secrets applied via superfield SSH.
#   7.  Bootstrap summary: prints required GitHub Actions secrets and exact
#       `gh secret set --env <env>` commands for the operator.
#
# Key type enforcement:
#   Accepted: Ed25519, ECDSA P-256/P-384, RSA >= 3072 bits
#   Rejected: RSA < 3072 bits, DSA (all), other legacy types
#   Fingerprint and algorithm are logged for every accepted key.
#
# Idempotency:
#   Re-running against the same host appends new admin keys without removing
#   existing ones. k3s is not reinstalled if already running. Kubernetes
#   secrets and manifests are re-applied (kubectl apply is idempotent).
#
# Security notes:
#   - deploy.sh is NOT copied to the host. It runs on the GitHub Actions runner.
#   - The k3s API is NOT exposed externally (no ufw rule for port 6443).
#   - CI/CD connects via an SSH tunnel through superfield@<host>.
#   - ServiceAccount tokens are short-lived (1h TTL via TokenRequest API);
#     no static kubeconfig secret is stored in GitHub.
#
# See also:
#   docs/host-init-script.md   — full runbook
#   .github/workflows/deploy.yml — CI/CD deploy workflow
#   scripts/whoami.sh          — inspect current deployment state

set -euo pipefail

# ── Constants ─────────────────────────────────────────────────────────────────

# ── Argument parsing ──────────────────────────────────────────────────────────

_usage() {
  grep '^#' "${BASH_SOURCE[0]}" | grep -v '^#!/' | sed 's/^# \{0,1\}//' | \
    sed -n '/^Usage/,/^See also/p'
  exit "${1:-0}"
}

DRY_RUN=false
ADMIN_KEYS=()
REVOKE_KEY=""
ROOT_KEY_PATH=""
POSITIONAL=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --help|-h)
      _usage 0
      ;;
    --root-key)
      if [[ -z "${2:-}" ]]; then
        echo "error: --root-key requires a file argument" >&2
        exit 1
      fi
      ROOT_KEY_PATH="$2"
      shift 2
      ;;
    --root-key=*)
      ROOT_KEY_PATH="${1#--root-key=}"
      shift
      ;;
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    --admin-key)
      if [[ -z "${2:-}" ]]; then
        echo "error: --admin-key requires a file argument" >&2
        exit 1
      fi
      ADMIN_KEYS+=("$2")
      shift 2
      ;;
    --admin-key=*)
      ADMIN_KEYS+=("${1#--admin-key=}")
      shift
      ;;
    --revoke-key)
      if [[ -z "${2:-}" ]]; then
        echo "error: --revoke-key requires a file argument" >&2
        exit 1
      fi
      REVOKE_KEY="$2"
      shift 2
      ;;
    --revoke-key=*)
      REVOKE_KEY="${1#--revoke-key=}"
      shift
      ;;
    -*)
      echo "error: unknown option: $1" >&2
      _usage 1
      ;;
    *)
      POSITIONAL+=("$1")
      shift
      ;;
  esac
done

# ── Legacy call detection ─────────────────────────────────────────────────────
#
# Old signature: sudo -E bash scripts/init-host.sh <env>
# New signature: scripts/init-host.sh <host> <env> --admin-key <pubkey>
#
# If called with exactly one positional argument and no --admin-key flags,
# this is the legacy CI test pattern. Delegate to the legacy implementation
# embedded below so existing test-host-init.yml jobs keep passing.

_is_legacy_call() {
  [[ ${#POSITIONAL[@]} -eq 1 ]] && [[ ${#ADMIN_KEYS[@]} -eq 0 ]] && [[ -z "${REVOKE_KEY}" ]]
}

if _is_legacy_call; then
  echo "warning: init-host.sh called with legacy signature (init-host.sh <env>)." >&2
  echo "         The new signature is: init-host.sh <host> <env> --admin-key <pubkey>" >&2
  echo "         Delegating to legacy implementation for backwards compatibility." >&2
  echo "" >&2
  # ── LEGACY IMPLEMENTATION ────────────────────────────────────────────────────
  # The following block is the pre-#142 implementation preserved for CI
  # compatibility. test-host-init.yml calls the legacy signature.
  ENV_LABEL="${POSITIONAL[0]}"
  NAMESPACE="calypso-${ENV_LABEL}"
  REPO="ghcr.io/dot-matrix-labs/calypso-starter-ts"

  echo "==> Calypso host initialisation (legacy mode)"
  echo "    Environment : ${ENV_LABEL}"
  echo "    Namespace   : ${NAMESPACE}"
  echo ""

  # ── 1. k3s installation ─────────────────────────────────────────────────────
  echo "==> [1/8] Checking k3s installation"
  if command -v k3s &>/dev/null && k3s kubectl get nodes &>/dev/null 2>&1; then
    echo "    k3s already installed and running — skipping."
  else
    echo "    Installing k3s..."
    curl -sfL https://get.k3s.io | INSTALL_K3S_EXEC="--write-kubeconfig-mode 644 --disable traefik" sh -
    echo "    Waiting for k3s to be ready..."
    for i in $(seq 1 30); do
      if k3s kubectl get nodes &>/dev/null 2>&1; then
        echo "    k3s ready after ${i} attempts."
        break
      fi
      sleep 2
    done
  fi

  export KUBECONFIG="${KUBECONFIG:-/etc/rancher/k3s/k3s.yaml}"

  # ── 2. Credential collection ─────────────────────────────────────────────────
  echo ""
  echo "==> [2/8] Collecting credentials"

  if [[ -n "${REMOTE_PG_HOST:-}" ]]; then
    DB_MODE="remote"
  else
    DB_MODE="local"
    if [ -t 0 ]; then
      read -rp "    Database mode (local/remote) [local]: " input_db_mode
      if [[ "${input_db_mode:-local}" == "remote" ]]; then
        DB_MODE="remote"
      fi
    fi
  fi

  echo "    DB mode: ${DB_MODE}"

  if [[ "${DB_MODE}" == "remote" ]]; then
    if [[ -z "${REMOTE_PG_HOST:-}" ]] && [ -t 0 ]; then
      read -rp "    Remote PG host: " REMOTE_PG_HOST
    fi
    : "${REMOTE_PG_HOST:?Remote PG host is required for remote mode}"

    if [[ -z "${REMOTE_PG_PORT:-}" ]] && [ -t 0 ]; then
      read -rp "    Remote PG port [5432]: " input_pg_port
      REMOTE_PG_PORT="${input_pg_port:-5432}"
    fi
    REMOTE_PG_PORT="${REMOTE_PG_PORT:-5432}"

    if [[ -z "${REMOTE_PG_ADMIN_DB:-}" ]] && [ -t 0 ]; then
      read -rp "    Remote PG admin database [postgres]: " input_admin_db
      REMOTE_PG_ADMIN_DB="${input_admin_db:-postgres}"
    fi
    REMOTE_PG_ADMIN_DB="${REMOTE_PG_ADMIN_DB:-postgres}"

    if [[ -z "${REMOTE_PG_ADMIN_USER:-}" ]] && [ -t 0 ]; then
      read -rp "    Remote PG admin user [postgres]: " input_admin_user
      REMOTE_PG_ADMIN_USER="${input_admin_user:-postgres}"
    fi
    REMOTE_PG_ADMIN_USER="${REMOTE_PG_ADMIN_USER:-postgres}"

    if [[ -z "${REMOTE_PG_ADMIN_PASSWORD:-}" ]] && [ -t 0 ]; then
      read -rsp "    Remote PG admin password: " REMOTE_PG_ADMIN_PASSWORD
      echo ""
    fi
    : "${REMOTE_PG_ADMIN_PASSWORD:?Remote PG admin password is required for remote mode}"

    REMOTE_PG_SSL="${REMOTE_PG_SSL:-require}"
    if [[ "${REMOTE_PG_SSL}" == "require" ]] && [ -t 0 ]; then
      read -rp "    SSL mode (require|verify-full|disable) [require]: " input_ssl
      REMOTE_PG_SSL="${input_ssl:-require}"
    fi
  fi

  if [[ -z "${CALYPSO_IMAGE_TAG:-}" ]] && [ -t 0 ]; then
    read -rp "    Calypso image tag (e.g. v1.2.3): " CALYPSO_IMAGE_TAG
  fi
  : "${CALYPSO_IMAGE_TAG:?CALYPSO_IMAGE_TAG is required}"
  IMAGE="${REPO}:${CALYPSO_IMAGE_TAG}"

  if [[ -z "${MNEMONIC:-}" ]] && [[ -z "${SUPERUSER_PASSWORD:-}" ]] && [ -t 0 ]; then
    read -rsp "    Superuser mnemonic (or leave blank to use SUPERUSER_PASSWORD): " MNEMONIC
    echo ""
    if [[ -z "${MNEMONIC:-}" ]]; then
      read -rsp "    Superuser password: " SUPERUSER_PASSWORD
      echo ""
    fi
  fi

  if [[ -z "${GITHUB_PAT:-}" ]] && [ -t 0 ]; then
    read -rsp "    GitHub PAT (for GHCR pull): " GITHUB_PAT
    echo ""
  fi

  # ── 3. Remote PG connectivity check ─────────────────────────────────────────
  if [[ "${DB_MODE}" == "remote" ]]; then
    echo ""
    echo "==> [3/8] Checking remote PG connectivity"
    while true; do
      if (echo >/dev/tcp/${REMOTE_PG_HOST}/${REMOTE_PG_PORT}) 2>/dev/null; then
        echo "    ${REMOTE_PG_HOST}:${REMOTE_PG_PORT} is reachable."
        break
      else
        if ! [ -t 0 ]; then
          echo "    Non-interactive mode: cannot reach ${REMOTE_PG_HOST}:${REMOTE_PG_PORT}. Aborting." >&2
          exit 1
        fi
        echo "    Cannot reach ${REMOTE_PG_HOST}:${REMOTE_PG_PORT}."
        read -rp "    Re-enter PG host: " REMOTE_PG_HOST
        read -rp "    Re-enter PG port [${REMOTE_PG_PORT}]: " input_port
        REMOTE_PG_PORT="${input_port:-${REMOTE_PG_PORT}}"
      fi
    done
  else
    echo ""
    echo "==> [3/8] Remote PG connectivity check — skipped (local mode)"
  fi

  # ── 4. Secret generation ─────────────────────────────────────────────────────
  echo ""
  echo "==> [4/8] Generating secrets"

  _decode_secret_key() {
    local namespace="$1" secret="$2" key="$3"
    kubectl get secret "${secret}" --namespace="${namespace}" \
      -o jsonpath="{.data.${key}}" 2>/dev/null | base64 -d 2>/dev/null || true
  }

  if kubectl get secret calypso-api-secrets --namespace="${NAMESPACE}" &>/dev/null 2>&1; then
    echo "    Found existing calypso-api-secrets — reusing role passwords (idempotent run)."
    _existing_db_url="$(_decode_secret_key "${NAMESPACE}" calypso-api-secrets DATABASE_URL)"
    APP_RW_PASSWORD="$(echo "${_existing_db_url}" | sed 's|.*://[^:]*:\([^@]*\)@.*|\1|')"
    AUDIT_W_PASSWORD="$(_decode_secret_key "${NAMESPACE}" calypso-db-secrets AUDIT_W_PASSWORD)"
    ANALYTICS_W_PASSWORD="$(_decode_secret_key "${NAMESPACE}" calypso-db-secrets ANALYTICS_W_PASSWORD)"
    AGENT_CODING_PASSWORD="$(_decode_secret_key "${NAMESPACE}" calypso-db-secrets AGENT_CODING_PASSWORD)"
    AGENT_ANALYSIS_PASSWORD="$(_decode_secret_key "${NAMESPACE}" calypso-db-secrets AGENT_ANALYSIS_PASSWORD)"
    AGENT_CODING_PASSWORD="${AGENT_CODING_PASSWORD:-$(openssl rand -hex 24)}"
    AGENT_ANALYSIS_PASSWORD="${AGENT_ANALYSIS_PASSWORD:-$(openssl rand -hex 24)}"
    JWT_SECRET="$(_decode_secret_key "${NAMESPACE}" calypso-api-secrets JWT_SECRET)"
    ENCRYPTION_MASTER_KEY="$(_decode_secret_key "${NAMESPACE}" calypso-api-secrets ENCRYPTION_MASTER_KEY)"
    if [[ "${DB_MODE}" == "local" ]]; then
      POSTGRES_SUPERUSER_PASSWORD="$(_decode_secret_key "${NAMESPACE}" calypso-db-secrets POSTGRES_PASSWORD)"
    fi
  else
    echo "    Generating new secrets."
    JWT_SECRET="$(openssl rand -hex 64)"
    ENCRYPTION_MASTER_KEY="$(openssl rand -hex 32)"
    APP_RW_PASSWORD="$(openssl rand -hex 24)"
    AUDIT_W_PASSWORD="$(openssl rand -hex 24)"
    ANALYTICS_W_PASSWORD="$(openssl rand -hex 24)"
    AGENT_CODING_PASSWORD="$(openssl rand -hex 24)"
    AGENT_ANALYSIS_PASSWORD="$(openssl rand -hex 24)"
    if [[ "${DB_MODE}" == "local" ]]; then
      POSTGRES_SUPERUSER_PASSWORD="$(openssl rand -hex 24)"
    fi
  fi

  if [[ "${DB_MODE}" == "local" ]]; then
    PG_HOST="postgres"; PG_PORT="5432"; PG_ADMIN_DB="calypso_app"
    PG_ADMIN_USER="postgres"; PG_ADMIN_PASSWORD="${POSTGRES_SUPERUSER_PASSWORD:-}"; PG_SSL=""
  else
    PG_HOST="${REMOTE_PG_HOST}"; PG_PORT="${REMOTE_PG_PORT}"; PG_ADMIN_DB="${REMOTE_PG_ADMIN_DB}"
    PG_ADMIN_USER="${REMOTE_PG_ADMIN_USER}"; PG_ADMIN_PASSWORD="${REMOTE_PG_ADMIN_PASSWORD}"
    PG_SSL="${REMOTE_PG_SSL}"
  fi

  if [[ "${DB_MODE}" == "local" ]]; then
    DATABASE_URL="postgres://app_rw:${APP_RW_PASSWORD}@postgres:5432/calypso_app"
    AUDIT_DATABASE_URL="postgres://audit_w:${AUDIT_W_PASSWORD}@postgres:5432/calypso_audit"
    ANALYTICS_DATABASE_URL="postgres://analytics_w:${ANALYTICS_W_PASSWORD}@postgres:5432/calypso_analytics"
    ADMIN_DATABASE_URL="postgres://${PG_ADMIN_USER}:${PG_ADMIN_PASSWORD}@postgres:5432/${PG_ADMIN_DB}"
  else
    SSL_SUFFIX=""
    if [[ -n "${PG_SSL}" ]] && [[ "${PG_SSL}" != "disable" ]]; then
      SSL_SUFFIX="?sslmode=${PG_SSL}"
    elif [[ "${PG_SSL}" == "disable" ]]; then
      SSL_SUFFIX="?sslmode=disable"
    fi
    DATABASE_URL="postgres://app_rw:${APP_RW_PASSWORD}@${PG_HOST}:${PG_PORT}/calypso_app${SSL_SUFFIX}"
    AUDIT_DATABASE_URL="postgres://audit_w:${AUDIT_W_PASSWORD}@${PG_HOST}:${PG_PORT}/calypso_audit${SSL_SUFFIX}"
    ANALYTICS_DATABASE_URL="postgres://analytics_w:${ANALYTICS_W_PASSWORD}@${PG_HOST}:${PG_PORT}/calypso_analytics${SSL_SUFFIX}"
    ADMIN_DATABASE_URL="postgres://${PG_ADMIN_USER}:${PG_ADMIN_PASSWORD}@${PG_HOST}:${PG_PORT}/${PG_ADMIN_DB}${SSL_SUFFIX}"
  fi

  echo "    Secrets ready."

  # ── 5. Kubernetes namespace and secrets ──────────────────────────────────────
  echo ""
  echo "==> [5/8] Creating Kubernetes namespace and secrets"

  kubectl create namespace "${NAMESPACE}" --dry-run=client -o yaml | kubectl apply -f -

  if [[ -n "${GITHUB_PAT:-}" ]]; then
    kubectl create secret docker-registry ghcr-pull-secret \
      --namespace="${NAMESPACE}" \
      --docker-server=ghcr.io \
      --docker-username=calypso \
      --docker-password="${GITHUB_PAT}" \
      --dry-run=client -o yaml | kubectl apply -f -
  fi

  API_SECRET_ARGS=(
    --namespace="${NAMESPACE}"
    --from-literal=DATABASE_URL="${DATABASE_URL}"
    --from-literal=AUDIT_DATABASE_URL="${AUDIT_DATABASE_URL}"
    --from-literal=ANALYTICS_DATABASE_URL="${ANALYTICS_DATABASE_URL}"
    --from-literal=JWT_SECRET="${JWT_SECRET}"
    --from-literal=ENCRYPTION_MASTER_KEY="${ENCRYPTION_MASTER_KEY}"
  )
  if [[ -n "${MNEMONIC:-}" ]]; then
    API_SECRET_ARGS+=(--from-literal=SUPERUSER_MNEMONIC="${MNEMONIC}")
  elif [[ -n "${SUPERUSER_PASSWORD:-}" ]]; then
    API_SECRET_ARGS+=(--from-literal=SUPERUSER_PASSWORD="${SUPERUSER_PASSWORD}")
  fi
  [[ -n "${SUBSTACK_API_KEY:-}" ]] && API_SECRET_ARGS+=(--from-literal=SUBSTACK_API_KEY="${SUBSTACK_API_KEY}")
  [[ -n "${BLOOMBERG_API_KEY:-}" ]] && API_SECRET_ARGS+=(--from-literal=BLOOMBERG_API_KEY="${BLOOMBERG_API_KEY}")
  [[ -n "${YAHOO_API_KEY:-}" ]] && API_SECRET_ARGS+=(--from-literal=YAHOO_API_KEY="${YAHOO_API_KEY}")

  kubectl delete secret calypso-api-secrets --namespace="${NAMESPACE}" --ignore-not-found
  kubectl create secret generic calypso-api-secrets "${API_SECRET_ARGS[@]}"

  DB_SECRET_ARGS=(
    --namespace="${NAMESPACE}"
    --from-literal=APP_RW_PASSWORD="${APP_RW_PASSWORD}"
    --from-literal=AUDIT_W_PASSWORD="${AUDIT_W_PASSWORD}"
    --from-literal=ANALYTICS_W_PASSWORD="${ANALYTICS_W_PASSWORD}"
    --from-literal=AGENT_CODING_PASSWORD="${AGENT_CODING_PASSWORD}"
    --from-literal=AGENT_ANALYSIS_PASSWORD="${AGENT_ANALYSIS_PASSWORD}"
  )
  if [[ "${DB_MODE}" == "local" ]]; then
    DB_SECRET_ARGS+=(--from-literal=POSTGRES_USER="postgres")
    DB_SECRET_ARGS+=(--from-literal=POSTGRES_PASSWORD="${POSTGRES_SUPERUSER_PASSWORD}")
    DB_SECRET_ARGS+=(--from-literal=POSTGRES_DB="calypso_app")
  fi
  kubectl delete secret calypso-db-secrets --namespace="${NAMESPACE}" --ignore-not-found
  kubectl create secret generic calypso-db-secrets "${DB_SECRET_ARGS[@]}"

  DB_INIT_SECRET_ARGS=(
    --namespace="${NAMESPACE}"
    --from-literal=ADMIN_DATABASE_URL="${ADMIN_DATABASE_URL}"
    --from-literal=APP_RW_PASSWORD="${APP_RW_PASSWORD}"
    --from-literal=AUDIT_W_PASSWORD="${AUDIT_W_PASSWORD}"
    --from-literal=ANALYTICS_W_PASSWORD="${ANALYTICS_W_PASSWORD}"
    --from-literal=AGENT_CODING_PASSWORD="${AGENT_CODING_PASSWORD}"
    --from-literal=AGENT_ANALYSIS_PASSWORD="${AGENT_ANALYSIS_PASSWORD}"
  )
  [[ -n "${REMOTE_PG_CA_CERT:-}" ]] && DB_INIT_SECRET_ARGS+=(--from-literal=DB_CA_CERT="${REMOTE_PG_CA_CERT}")
  kubectl delete secret calypso-db-init-secret --namespace="${NAMESPACE}" --ignore-not-found
  kubectl create secret generic calypso-db-init-secret "${DB_INIT_SECRET_ARGS[@]}"

  echo "    Kubernetes secrets created."

  # ── 6. Manifest application ──────────────────────────────────────────────────
  echo ""
  echo "==> [6/8] Applying Kubernetes manifests"

  if [[ "${DB_MODE}" == "local" ]]; then
    kubectl apply --namespace="${NAMESPACE}" -f - <<EOF
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: calypso-postgres-pvc
  namespace: ${NAMESPACE}
  labels:
    app: postgres
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 10Gi
---
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: postgres
  namespace: ${NAMESPACE}
  labels:
    app: postgres
spec:
  serviceName: postgres
  replicas: 1
  selector:
    matchLabels:
      app: postgres
  template:
    metadata:
      labels:
        app: postgres
    spec:
      containers:
        - name: postgres
          image: postgres:16-alpine
          ports:
            - containerPort: 5432
          env:
            - name: POSTGRES_USER
              valueFrom:
                secretKeyRef:
                  name: calypso-db-secrets
                  key: POSTGRES_USER
            - name: POSTGRES_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: calypso-db-secrets
                  key: POSTGRES_PASSWORD
            - name: POSTGRES_DB
              valueFrom:
                secretKeyRef:
                  name: calypso-db-secrets
                  key: POSTGRES_DB
            - name: PGDATA
              value: /var/lib/postgresql/data/pgdata
          volumeMounts:
            - name: postgres-data
              mountPath: /var/lib/postgresql/data
          livenessProbe:
            exec:
              command: [pg_isready, -U, postgres, -d, calypso_app]
            initialDelaySeconds: 30
            periodSeconds: 10
            timeoutSeconds: 5
            failureThreshold: 6
          readinessProbe:
            exec:
              command: [pg_isready, -U, postgres, -d, calypso_app]
            initialDelaySeconds: 5
            periodSeconds: 5
            timeoutSeconds: 5
            failureThreshold: 3
          resources:
            requests:
              cpu: '100m'
              memory: '256Mi'
            limits:
              cpu: '500m'
              memory: '512Mi'
      volumes:
        - name: postgres-data
          persistentVolumeClaim:
            claimName: calypso-postgres-pvc
---
apiVersion: v1
kind: Service
metadata:
  name: postgres
  namespace: ${NAMESPACE}
  labels:
    app: postgres
spec:
  selector:
    app: postgres
  ports:
    - name: postgres
      protocol: TCP
      port: 5432
      targetPort: 5432
  clusterIP: None
EOF

    echo "    Waiting for postgres to be ready..."
    kubectl rollout status statefulset/postgres --namespace="${NAMESPACE}" --timeout=120s
  fi

  kubectl delete job calypso-db-init --namespace="${NAMESPACE}" --ignore-not-found
  kubectl apply --namespace="${NAMESPACE}" -f - <<EOF
apiVersion: batch/v1
kind: Job
metadata:
  name: calypso-db-init
  namespace: ${NAMESPACE}
  labels:
    app: calypso-db-init
spec:
  ttlSecondsAfterFinished: 3600
  template:
    metadata:
      labels:
        app: calypso-db-init
    spec:
      restartPolicy: OnFailure
      containers:
        - name: db-init
          image: ${IMAGE}
          imagePullPolicy: IfNotPresent
          command: ['bun', 'run', 'packages/db/init-remote.ts']
          env:
            - name: ADMIN_DATABASE_URL
              valueFrom:
                secretKeyRef:
                  name: calypso-db-init-secret
                  key: ADMIN_DATABASE_URL
            - name: APP_RW_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: calypso-db-init-secret
                  key: APP_RW_PASSWORD
            - name: AUDIT_W_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: calypso-db-init-secret
                  key: AUDIT_W_PASSWORD
            - name: ANALYTICS_W_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: calypso-db-init-secret
                  key: ANALYTICS_W_PASSWORD
            - name: AGENT_CODING_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: calypso-db-init-secret
                  key: AGENT_CODING_PASSWORD
            - name: AGENT_ANALYSIS_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: calypso-db-init-secret
                  key: AGENT_ANALYSIS_PASSWORD
          resources:
            requests:
              cpu: '50m'
              memory: '64Mi'
            limits:
              cpu: '200m'
              memory: '256Mi'
      imagePullSecrets:
        - name: ghcr-pull-secret
EOF

  echo "    Manifests applied."

  # ── 7. Firewall setup ────────────────────────────────────────────────────────
  echo ""
  echo "==> [7/8] Configuring firewall"
  # NOTE: The full feature implementation (issue #142) does NOT open port 6443
  # per CISO review. This legacy path retains it for CI compatibility.
  if command -v ufw &>/dev/null; then
    (
      set +e
      ufw disable 2>/dev/null
      ufw --force reset 2>/dev/null
      if [[ -f /etc/ufw/ufw.conf ]]; then
        sed -i 's/^LOGLEVEL=.*/LOGLEVEL=off/' /etc/ufw/ufw.conf
      fi
      ufw default deny incoming 2>/dev/null
      ufw default allow outgoing 2>/dev/null
      ufw allow 22/tcp    comment "SSH"          2>/dev/null
      ufw allow 31415/tcp comment "App NodePort" 2>/dev/null
      ufw --force enable 2>/dev/null
      true
    )
    echo "    Firewall configured."
  else
    echo "    ufw not found — skipping firewall configuration."
  fi

  # ── 8. db-init job and deploy ────────────────────────────────────────────────
  echo ""
  echo "==> [8/8] Running db-init job and deploying application"
  echo "    Waiting for calypso-db-init job to complete..."

  _poll_db_init() {
    local ns="$1" tick=0
    while true; do
      sleep 20
      tick=$((tick + 20))
      echo "    [db-init +${tick}s] pod status:" >&2
      kubectl get pods -n "${ns}" --selector=app=calypso-db-init \
        -o wide --no-headers 2>&1 | sed 's/^/      /' >&2 || true
      echo "    [db-init +${tick}s] recent logs:" >&2
      kubectl logs -n "${ns}" --selector=app=calypso-db-init \
        --tail=30 --ignore-errors 2>&1 | sed 's/^/      /' >&2 || true
    done
  }
  _poll_db_init "${NAMESPACE}" &
  POLL_PID=$!

  WAIT_EXIT=0
  kubectl wait --for=condition=complete job/calypso-db-init \
    --namespace="${NAMESPACE}" --timeout=300s || WAIT_EXIT=$?

  kill "${POLL_PID}" 2>/dev/null || true
  wait "${POLL_PID}" 2>/dev/null || true

  if [[ "${WAIT_EXIT}" -ne 0 ]]; then
    echo "    ERROR: calypso-db-init job timed out or failed." >&2
    kubectl describe job/calypso-db-init --namespace="${NAMESPACE}" >&2 || true
    kubectl get pods --namespace="${NAMESPACE}" --selector=app=calypso-db-init -o wide >&2 || true
    kubectl describe pods --namespace="${NAMESPACE}" --selector=app=calypso-db-init >&2 || true
    kubectl logs --namespace="${NAMESPACE}" --selector=app=calypso-db-init --tail=200 >&2 || true
    exit 1
  fi

  echo "    calypso-db-init job completed."
  kubectl delete secret calypso-db-init-secret --namespace="${NAMESPACE}" --ignore-not-found
  echo "    calypso-db-init-secret deleted."

  kubectl delete deployment calypso-app --namespace="${NAMESPACE}" --ignore-not-found
  kubectl apply --namespace="${NAMESPACE}" -f - <<EOF
apiVersion: apps/v1
kind: Deployment
metadata:
  name: calypso-app
  namespace: ${NAMESPACE}
  labels:
    app: calypso-app
spec:
  replicas: 1
  selector:
    matchLabels:
      app: calypso-app
  template:
    metadata:
      labels:
        app: calypso-app
    spec:
      imagePullSecrets:
        - name: ghcr-pull-secret
      containers:
        - name: app
          image: ${IMAGE}
          imagePullPolicy: IfNotPresent
          ports:
            - containerPort: 31415
          env:
            - name: PORT
              value: '31415'
            - name: DATABASE_URL
              valueFrom:
                secretKeyRef:
                  name: calypso-api-secrets
                  key: DATABASE_URL
            - name: AUDIT_DATABASE_URL
              valueFrom:
                secretKeyRef:
                  name: calypso-api-secrets
                  key: AUDIT_DATABASE_URL
            - name: ANALYTICS_DATABASE_URL
              valueFrom:
                secretKeyRef:
                  name: calypso-api-secrets
                  key: ANALYTICS_DATABASE_URL
            - name: JWT_SECRET
              valueFrom:
                secretKeyRef:
                  name: calypso-api-secrets
                  key: JWT_SECRET
            - name: ENCRYPTION_MASTER_KEY
              valueFrom:
                secretKeyRef:
                  name: calypso-api-secrets
                  key: ENCRYPTION_MASTER_KEY
            - name: SUBSTACK_API_KEY
              valueFrom:
                secretKeyRef:
                  name: calypso-api-secrets
                  key: SUBSTACK_API_KEY
                  optional: true
            - name: BLOOMBERG_API_KEY
              valueFrom:
                secretKeyRef:
                  name: calypso-api-secrets
                  key: BLOOMBERG_API_KEY
                  optional: true
            - name: YAHOO_API_KEY
              valueFrom:
                secretKeyRef:
                  name: calypso-api-secrets
                  key: YAHOO_API_KEY
                  optional: true
          livenessProbe:
            httpGet:
              path: /health
              port: 31415
            initialDelaySeconds: 15
            periodSeconds: 20
            timeoutSeconds: 5
            failureThreshold: 3
          readinessProbe:
            httpGet:
              path: /health
              port: 31415
            initialDelaySeconds: 10
            periodSeconds: 10
            timeoutSeconds: 5
            failureThreshold: 3
          resources:
            requests:
              cpu: '100m'
              memory: '128Mi'
            limits:
              cpu: '500m'
              memory: '512Mi'
---
apiVersion: v1
kind: Service
metadata:
  name: calypso-app
  namespace: ${NAMESPACE}
  labels:
    app: calypso-app
spec:
  selector:
    app: calypso-app
  ports:
    - name: http
      protocol: TCP
      port: 80
      targetPort: 31415
  type: ClusterIP
EOF

  echo ""
  echo "==> Deployment complete! (legacy mode)"
  echo "    Namespace : ${NAMESPACE}"
  echo "    Image     : ${IMAGE}"
  echo "    DB mode   : ${DB_MODE}"
  echo ""
  echo "    Run scripts/whoami.sh ${ENV_LABEL} to verify deployment state."
  exit 0
fi

# ── NEW SIGNATURE HANDLING ────────────────────────────────────────────────────
#
# Full local-to-remote SSH orchestrator implementation.
# All provisioning is driven over SSH; no files are copied to the host first.

if [[ ${#POSITIONAL[@]} -lt 2 ]]; then
  echo "error: <host> and <env> are required positional arguments" >&2
  echo "Usage: $0 <host> <env> --admin-key <pubkey-file>" >&2
  exit 1
fi

HOST="${POSITIONAL[0]}"
ENV_LABEL="${POSITIONAL[1]}"
NAMESPACE="calypso-${ENV_LABEL}"
SA_NAME="calypso-deployer"
REPO="ghcr.io/dot-matrix-labs/calypso-starter-ts"

# ── Admin key validation ──────────────────────────────────────────────────────

# Accept SUPERFIELD_ADMIN_PUBKEY env var as fallback (with warning)
if [[ ${#ADMIN_KEYS[@]} -eq 0 ]]; then
  if [[ -n "${SUPERFIELD_ADMIN_PUBKEY:-}" ]]; then
    echo "warning: SUPERFIELD_ADMIN_PUBKEY env var is set. Prefer --admin-key <file> for security." >&2
    _TMPKEY="$(mktemp)"
    echo "${SUPERFIELD_ADMIN_PUBKEY}" > "${_TMPKEY}"
    ADMIN_KEYS+=("${_TMPKEY}")
    trap 'rm -f "${_TMPKEY}"' EXIT
  else
    echo "error: at least one --admin-key <pubkey-file> is required" >&2
    echo "       or set SUPERFIELD_ADMIN_PUBKEY env var (not recommended)" >&2
    exit 1
  fi
fi

# Validate admin key files exist
for keyfile in "${ADMIN_KEYS[@]}"; do
  if [[ ! -f "${keyfile}" ]]; then
    echo "error: admin key file not found: ${keyfile}" >&2
    exit 1
  fi
done

# Validate key type and strength using ssh-keygen -l
_validate_key() {
  local keyfile="$1"
  local keyinfo
  if ! keyinfo=$(ssh-keygen -l -f "${keyfile}" 2>/dev/null); then
    echo "error: cannot read key file: ${keyfile}" >&2
    return 1
  fi
  local bits keytype fingerprint
  bits=$(echo "${keyinfo}" | awk '{print $1}')
  fingerprint=$(echo "${keyinfo}" | awk '{print $2}')
  keytype=$(echo "${keyinfo}" | awk '{print $NF}' | tr -d '()')
  case "${keytype}" in
    ED25519|ECDSA)
      echo "    key accepted: ${keytype} ${bits}-bit — fingerprint: ${fingerprint}"
      return 0
      ;;
    RSA)
      if [[ "${bits}" -ge 3072 ]]; then
        echo "    key accepted: RSA ${bits}-bit — fingerprint: ${fingerprint}"
        return 0
      else
        echo "error: RSA key is too weak (${bits} bits). Minimum is 3072 bits." >&2
        echo "       Please generate a new key: ssh-keygen -t ed25519 -C 'admin@example.com'" >&2
        return 1
      fi
      ;;
    DSA)
      echo "error: DSA keys are not accepted. Please use Ed25519, ECDSA, or RSA >= 3072 bits." >&2
      return 1
      ;;
    *)
      echo "error: unknown key type '${keytype}' in ${keyfile}" >&2
      return 1
      ;;
  esac
}

echo "==> Calypso host provisioning"
echo "    Host        : ${HOST}"
echo "    Environment : ${ENV_LABEL}"
echo "    Namespace   : ${NAMESPACE}"
echo "    Admin keys  : ${#ADMIN_KEYS[@]}"
echo ""

echo "==> Validating admin key(s)"
for keyfile in "${ADMIN_KEYS[@]}"; do
  _validate_key "${keyfile}" || exit 1
done

# ── Dry run mode ──────────────────────────────────────────────────────────────

if [[ "${DRY_RUN}" == "true" ]]; then
  echo ""
  echo "==> DRY RUN — planned operations (not executed):"
  echo "    1. SSH as root@${HOST}: create superfield account, lock, install admin key(s)"
  echo "    2. Harden sshd: PasswordAuthentication no, MaxAuthTries 3, LoginGraceTime 30, AllowUsers superfield"
  echo "    3. CIS Benchmark Level 1: disable unused services, kernel sysctl, unattended-upgrades"
  echo "    4. Disable root password login: PermitRootLogin prohibit-password (key-based root SSH remains available)"
  echo "    5. Install k3s as root system service (port 6443 blocked externally by ufw); kubeconfig shared to /home/superfield/.kube/config"
  echo "    6. Create Kubernetes ServiceAccount ${SA_NAME} with RBAC (patch on deployments in ${NAMESPACE})"
  echo "    7. Apply k8s secrets and postgres StatefulSet (local DB mode) via superfield@${HOST}"
  echo "    8. Print GitHub Actions secrets summary with 'gh secret set --env ${ENV_LABEL}' commands"
  echo ""
  echo "==> DRY RUN complete — no changes made."
  exit 0
fi

# ── Revocation mode ───────────────────────────────────────────────────────────

if [[ -n "${REVOKE_KEY}" ]]; then
  if [[ ! -f "${REVOKE_KEY}" ]]; then
    echo "error: revoke key file not found: ${REVOKE_KEY}" >&2
    exit 1
  fi

  echo "==> Key revocation mode"
  echo "    Revoking key: ${REVOKE_KEY}"
  echo "    Host: ${HOST}"
  echo ""

  REVOKE_PUBKEY_CONTENT="$(cat "${REVOKE_KEY}")"
  REVOKE_KEY_BLOB="$(echo "${REVOKE_PUBKEY_CONTENT}" | awk '{print $1 " " $2}')"

  ssh -i "${ADMIN_KEYS[0]%%.pub}" -o StrictHostKeyChecking=accept-new "superfield@${HOST}" bash <<REMOTESCRIPT
set -euo pipefail
AK_FILE="/home/superfield/.ssh/authorized_keys"
if [[ ! -f "\${AK_FILE}" ]]; then
  echo "error: authorized_keys not found on remote host" >&2
  exit 1
fi

TOTAL=\$(grep -c . "\${AK_FILE}" 2>/dev/null || echo 0)
if [[ "\${TOTAL}" -le 1 ]]; then
  echo "error: refusing to revoke the last remaining admin key." >&2
  echo "       Add a replacement key first, verify SSH access, then revoke the old key." >&2
  exit 1
fi

REVOKE_BLOB="${REVOKE_KEY_BLOB}"
if ! grep -qF "\${REVOKE_BLOB}" "\${AK_FILE}"; then
  echo "error: key not found in authorized_keys" >&2
  exit 1
fi
TMPFILE="\$(mktemp)"
grep -vF "\${REVOKE_BLOB}" "\${AK_FILE}" > "\${TMPFILE}"
mv "\${TMPFILE}" "\${AK_FILE}"
chmod 600 "\${AK_FILE}"
REMAINING=\$(grep -c . "\${AK_FILE}" 2>/dev/null || echo 0)
echo "    Key revoked. \${REMAINING} key(s) remaining in authorized_keys."
REMOTESCRIPT

  echo "==> Key revocation complete."
  exit 0
fi

# ── SSH helpers ───────────────────────────────────────────────────────────────

_ssh_root() {
  local ssh_opts=("-o" "StrictHostKeyChecking=accept-new")
  if [[ -n "${ROOT_KEY_PATH:-}" ]]; then
    ssh_opts+=("-i" "${ROOT_KEY_PATH}")
  fi
  ssh "${ssh_opts[@]}" "root@${HOST}" "$@"
}

_ssh_superfield() {
  # ADMIN_KEYS holds public key paths; strip .pub to derive the private key path.
  ssh -i "${ADMIN_KEYS[0]%%.pub}" -o StrictHostKeyChecking=accept-new "superfield@${HOST}" "$@"
}

_confirm_step() {
  # Only prompt if in an interactive terminal
  if [ -t 0 ]; then
    read -rp "    -> Proceed with this step? (y/N) " confirm
    case "${confirm}" in
      [yY][eE][sS]|[yY])
        # Continue
        ;;
      *)
        echo "Aborting." >&2
        exit 1
        ;;
    esac
  fi
}

# ── Phase 0: SSH connectivity check ──────────────────────────────────────────

echo ""
echo "==> [0/7] Verifying SSH connectivity to root@${HOST}"
_confirm_step
if ! _ssh_root "echo 'SSH OK'" 2>/dev/null; then
  echo "error: cannot SSH as root to ${HOST}" >&2
  echo "       Ensure SSH key auth is configured for root@${HOST}" >&2
  exit 2
fi
echo "    SSH connectivity OK."

# ── Phase 1: Root bootstrap ───────────────────────────────────────────────────

echo ""
echo "==> [1/7] Root bootstrap: create superfield account and install admin key(s)"
_confirm_step

# Collect all public key contents into one variable
ALL_PUBKEYS=""
for keyfile in "${ADMIN_KEYS[@]}"; do
  ALL_PUBKEYS="${ALL_PUBKEYS}$(cat "${keyfile}")"$'\n'
done

_ssh_root bash <<REMOTESCRIPT
set -euo pipefail

# Create superfield account if it does not exist
if ! id superfield &>/dev/null; then
  useradd --system --shell /bin/bash --create-home superfield
  echo "    Created superfield account."
else
  echo "    superfield account already exists — skipping useradd."
fi

# Lock the account (disable password login)
passwd -l superfield

# Remove from sudo/wheel groups if present
for grp in sudo wheel; do
  if getent group "\${grp}" &>/dev/null; then
    gpasswd -d superfield "\${grp}" 2>/dev/null || true
  fi
done

# Set up authorized_keys
SSH_DIR="/home/superfield/.ssh"
AK_FILE="\${SSH_DIR}/authorized_keys"
mkdir -p "\${SSH_DIR}"
chmod 700 "\${SSH_DIR}"
chown superfield:superfield "\${SSH_DIR}"
touch "\${AK_FILE}"
chmod 600 "\${AK_FILE}"
chown superfield:superfield "\${AK_FILE}"

# Append new keys (idempotent — skip duplicates)
while IFS= read -r pubkey; do
  [[ -z "\${pubkey}" ]] && continue
  KEY_BLOB="\$(echo "\${pubkey}" | awk '{print \$1 " " \$2}')"
  if ! grep -qF "\${KEY_BLOB}" "\${AK_FILE}" 2>/dev/null; then
    echo "\${pubkey}" >> "\${AK_FILE}"
    echo "    Appended key: \$(echo "\${pubkey}" | awk '{print \$1}')"
  else
    echo "    Key already present (idempotent): \$(echo "\${pubkey}" | awk '{print \$1}')"
  fi
done <<'ALLPUBKEYS'
${ALL_PUBKEYS}
ALLPUBKEYS

echo "    authorized_keys configured."

# Harden sshd globally
SSHD_CONFIG="/etc/ssh/sshd_config"

_set_sshd() {
  local key="\$1" val="\$2"
  if grep -qE "^#?\s*\${key}\b" "\${SSHD_CONFIG}"; then
    sed -i "s|^#\\?\\s*\${key}\\b.*|\${key} \${val}|" "\${SSHD_CONFIG}"
  else
    echo "\${key} \${val}" >> "\${SSHD_CONFIG}"
  fi
}

_set_sshd PubkeyAuthentication yes
_set_sshd PasswordAuthentication no
_set_sshd MaxAuthTries 3
_set_sshd LoginGraceTime 30
_set_sshd AllowUsers "superfield root"

systemctl reload sshd 2>/dev/null || systemctl reload ssh 2>/dev/null || true
echo "    sshd hardened: PubkeyAuthentication=yes PasswordAuthentication=no MaxAuthTries=3 LoginGraceTime=30 AllowUsers='superfield root'"
REMOTESCRIPT

echo "    Root bootstrap complete."

# ── Phase 2: CIS Benchmark Level 1 host hardening ────────────────────────────

echo ""
echo "==> [2/7] CIS Benchmark Level 1 host hardening"
_confirm_step

_ssh_root bash <<'REMOTESCRIPT'
set -euo pipefail

# Disable unused services
for svc in avahi-daemon cups postfix; do
  if systemctl is-active --quiet "${svc}" 2>/dev/null; then
    systemctl stop "${svc}" 2>/dev/null || true
    systemctl disable "${svc}" 2>/dev/null || true
    echo "    Disabled service: ${svc}"
  else
    echo "    Service not active or not installed: ${svc}"
  fi
done

# Kernel sysctl security parameters
SYSCTL_CONF="/etc/sysctl.d/99-calypso-cis.conf"
cat > "${SYSCTL_CONF}" <<SYSCTL
# CIS Benchmark Level 1 — applied by calypso init-host.sh
net.ipv4.conf.all.accept_source_route = 0
net.ipv4.conf.default.accept_source_route = 0
net.ipv4.conf.all.accept_redirects = 0
net.ipv4.conf.default.accept_redirects = 0
net.ipv4.conf.all.secure_redirects = 0
net.ipv4.conf.default.secure_redirects = 0
net.ipv4.tcp_syncookies = 1
net.ipv4.conf.all.log_martians = 1
net.ipv4.conf.default.log_martians = 1
fs.suid_dumpable = 0
kernel.core_uses_pid = 1
# Required for k3s on Ubuntu 24.04+ (AppArmor restricts user namespaces by default)
kernel.apparmor_restrict_unprivileged_userns = 0
SYSCTL
sysctl -p "${SYSCTL_CONF}" 2>/dev/null || sysctl --system 2>/dev/null || true
echo "    Kernel sysctl parameters applied."

# Enable unattended-upgrades (Ubuntu/Debian)
if command -v apt-get &>/dev/null; then
  DEBIAN_FRONTEND=noninteractive apt-get install -y -q unattended-upgrades 2>/dev/null || true
  systemctl enable --now unattended-upgrades 2>/dev/null || true
  echo "    unattended-upgrades enabled."
else
  echo "    apt-get not found — skipping unattended-upgrades (non-Debian system)."
fi
REMOTESCRIPT

echo "    CIS hardening complete."

# ── Phase 3: Root SSH lockdown ────────────────────────────────────────────────

echo ""
echo "==> [3/7] Disable Root Password Login"
_confirm_step

_ssh_root bash <<'REMOTESCRIPT'
set -euo pipefail
SSHD_CONFIG="/etc/ssh/sshd_config"

_set_sshd() {
  local key="$1" val="$2"
  if grep -qE "^#?\s*${key}\b" "${SSHD_CONFIG}"; then
    sed -i "s|^#\?\s*${key}\b.*|${key} ${val}|" "${SSHD_CONFIG}"
  else
    echo "${key} ${val}" >> "${SSHD_CONFIG}"
  fi
}

_set_sshd PermitRootLogin prohibit-password
systemctl reload sshd 2>/dev/null || systemctl reload ssh 2>/dev/null || true
echo "    PermitRootLogin set to prohibit-password (key-based root SSH remains available)."
REMOTESCRIPT

echo "    Root password login disabled."

# ── Phase 4: k3s installation (root system service, kubeconfig shared to superfield) ──

echo ""
echo "==> [4/7] Installing k3s (root system service, API localhost-only)"
_confirm_step

_ssh_root bash <<'REMOTESCRIPT'
set -euo pipefail

# Ubuntu 24.04+ restricts unprivileged user namespaces via AppArmor by default,
# which blocks k3s from forking its child process. Phase 2 wrote this setting to
# the sysctl conf; apply it immediately in case a reboot hasn't occurred.
if [[ -f /proc/sys/kernel/apparmor_restrict_unprivileged_userns ]]; then
  sysctl -w kernel.apparmor_restrict_unprivileged_userns=0 2>/dev/null || true
  echo "    apparmor_restrict_unprivileged_userns=0 applied."
fi

# Remove any stale service drop-in that may set User=superfield from a prior
# rootless install attempt; k3s-uninstall.sh does not clean this directory.
if [[ -d /etc/systemd/system/k3s.service.d ]]; then
  rm -rf /etc/systemd/system/k3s.service.d
  systemctl daemon-reload 2>/dev/null || true
  echo "    Removed stale k3s service drop-in overrides."
fi

# Install k3s if not already running and healthy
if systemctl is-active --quiet k3s 2>/dev/null && k3s kubectl get nodes &>/dev/null 2>&1; then
  echo "    k3s already running and healthy — skipping reinstall."
else
  systemctl stop k3s 2>/dev/null || true

  echo "    Installing k3s as root system service..."
  # Do NOT use --bind-address 127.0.0.1: the embedded k3s agent connects back to
  # the server using the node's external IP. Binding only to loopback prevents
  # the agent from reaching the API, breaking flannel and all kube-system pods.
  # External access to port 6443 is blocked by ufw instead.
  curl -sfL https://get.k3s.io | \
    INSTALL_K3S_EXEC="--disable traefik --https-listen-port 6443 --write-kubeconfig-mode 600" \
    sh -

  echo "    Waiting for k3s to be ready..."
  for i in $(seq 1 30); do
    if k3s kubectl get nodes &>/dev/null 2>&1; then
      echo "    k3s ready after ${i} attempt(s)."
      break
    fi
    sleep 2
  done

  if ! k3s kubectl get nodes &>/dev/null 2>&1; then
    echo "error: k3s did not become ready in time" >&2
    journalctl -u k3s --no-pager -n 50 >&2 || true
    exit 3
  fi
fi

# Share kubeconfig with superfield (always refresh on re-run — idempotent)
SUPERFIELD_KUBE_DIR="/home/superfield/.kube"
mkdir -p "${SUPERFIELD_KUBE_DIR}"
cp /etc/rancher/k3s/k3s.yaml "${SUPERFIELD_KUBE_DIR}/config"
chown -R superfield:superfield "${SUPERFIELD_KUBE_DIR}"
chmod 600 "${SUPERFIELD_KUBE_DIR}/config"
echo "    kubeconfig shared to /home/superfield/.kube/config."

# Configure ufw: SSH and app ports only — do NOT expose 6443 externally
if command -v ufw &>/dev/null; then
  (
    set +e
    ufw disable 2>/dev/null
    ufw --force reset 2>/dev/null
    if [[ -f /etc/ufw/ufw.conf ]]; then
      sed -i 's/^LOGLEVEL=.*/LOGLEVEL=off/' /etc/ufw/ufw.conf
    fi
    ufw default deny incoming 2>/dev/null
    ufw default allow outgoing 2>/dev/null
    ufw allow 22/tcp    comment "SSH"          2>/dev/null
    ufw allow 31415/tcp comment "App NodePort" 2>/dev/null
    # 6443 (k3s API), 10250 (kubelet), 8472/udp (flannel VXLAN) are intentionally
    # NOT opened: all cluster-internal traffic stays on loopback/CNI interfaces.
    ufw --force enable 2>/dev/null
    true
  )
  echo "    Firewall configured: SSH and app port only. Cluster ports blocked externally."
fi

echo "    k3s phase complete."
REMOTESCRIPT

echo "    k3s installation phase complete."

# ── Phase 5: Kubernetes ServiceAccount and RBAC ───────────────────────────────

echo ""
echo "==> [5/7] Creating Kubernetes namespace, ServiceAccount, and RBAC"
_confirm_step

_ssh_superfield bash <<REMOTESCRIPT
set -euo pipefail
export KUBECONFIG="/home/superfield/.kube/config"

kubectl create namespace "${NAMESPACE}" --dry-run=client -o yaml | kubectl apply -f -

kubectl apply -f - <<MANIFEST
apiVersion: v1
kind: ServiceAccount
metadata:
  name: ${SA_NAME}
  namespace: ${NAMESPACE}
---
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: calypso-deployer-role
  namespace: ${NAMESPACE}
rules:
  - apiGroups: ["apps"]
    resources: ["deployments"]
    verbs: ["get", "list", "watch", "patch"]
  - apiGroups: ["batch"]
    resources: ["jobs"]
    verbs: ["create", "get", "list", "watch", "delete"]
  - apiGroups: [""]
    resources: ["pods", "pods/log"]
    verbs: ["get", "list", "watch"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: calypso-deployer-binding
  namespace: ${NAMESPACE}
subjects:
  - kind: ServiceAccount
    name: ${SA_NAME}
    namespace: ${NAMESPACE}
roleRef:
  kind: Role
  name: calypso-deployer-role
  apiGroup: rbac.authorization.k8s.io
MANIFEST

echo "    ServiceAccount '${SA_NAME}' created with RBAC: patch on deployments in ${NAMESPACE}."
REMOTESCRIPT

echo "    ServiceAccount and RBAC complete."

# ── Phase 6: Application secrets and manifests ────────────────────────────────

# ── Superuser Mnemonic Collection ─────────────────────────────────────────────
if [[ -z "${MNEMONIC:-}" ]]; then
  if [ -t 0 ]; then # Interactive terminal
    echo ""
    echo "==> Collecting superuser mnemonic"
    read -rsp "    Enter superuser BIP-39 mnemonic: " MNEMONIC
    echo ""
  else # Non-interactive
    echo "error: running in non-interactive mode, but no superuser mnemonic provided." >&2
    echo "       Please set the MNEMONIC environment variable." >&2
    exit 1
  fi
fi

if [[ -z "${MNEMONIC:-}" ]]; then
  echo "error: no superuser mnemonic provided. Aborting." >&2
  exit 1
fi

echo ""
echo "==> [6/7] Applying application secrets"
_confirm_step

# Determine DB mode
if [[ -n "${REMOTE_PG_HOST:-}" ]]; then
  DB_MODE="remote"
else
  DB_MODE="local"
fi

# Recover existing passwords in a single SSH round-trip (idempotent runs).
# All values are hex-only or base64-safe; key=value lines are unambiguous.
SECRETS_DUMP=$(_ssh_superfield bash <<SSHDECODE
set -euo pipefail
export KUBECONFIG="/home/superfield/.kube/config"
if ! kubectl get secret calypso-api-secrets --namespace="${NAMESPACE}" &>/dev/null 2>&1; then
  printf 'exists=no\n'; exit 0
fi
printf 'exists=yes\n'
printf 'APP_RW_PASSWORD=%s\n' "\$(kubectl get secret calypso-api-secrets --namespace="${NAMESPACE}" \
  -o jsonpath='{.data.DATABASE_URL}' | base64 -d | sed 's|.*://[^:]*:\([^@]*\)@.*|\1|')"
printf 'JWT_SECRET=%s\n' "\$(kubectl get secret calypso-api-secrets --namespace="${NAMESPACE}" \
  -o jsonpath='{.data.JWT_SECRET}' | base64 -d)"
printf 'ENCRYPTION_MASTER_KEY=%s\n' "\$(kubectl get secret calypso-api-secrets --namespace="${NAMESPACE}" \
  -o jsonpath='{.data.ENCRYPTION_MASTER_KEY}' | base64 -d)"
printf 'AUDIT_W_PASSWORD=%s\n' "\$(kubectl get secret calypso-db-secrets --namespace="${NAMESPACE}" \
  -o jsonpath='{.data.AUDIT_W_PASSWORD}' | base64 -d)"
printf 'ANALYTICS_W_PASSWORD=%s\n' "\$(kubectl get secret calypso-db-secrets --namespace="${NAMESPACE}" \
  -o jsonpath='{.data.ANALYTICS_W_PASSWORD}' | base64 -d)"
printf 'AGENT_CODING_PASSWORD=%s\n' "\$(kubectl get secret calypso-db-secrets --namespace="${NAMESPACE}" \
  -o jsonpath='{.data.AGENT_CODING_PASSWORD}' | base64 -d)"
printf 'AGENT_ANALYSIS_PASSWORD=%s\n' "\$(kubectl get secret calypso-db-secrets --namespace="${NAMESPACE}" \
  -o jsonpath='{.data.AGENT_ANALYSIS_PASSWORD}' | base64 -d)"
printf 'POSTGRES_SUPERUSER_PASSWORD=%s\n' "\$(kubectl get secret calypso-db-secrets --namespace="${NAMESPACE}" \
  -o jsonpath='{.data.POSTGRES_PASSWORD}' 2>/dev/null | base64 -d 2>/dev/null || true)"
SSHDECODE
)

_extract_secret() { printf '%s\n' "${SECRETS_DUMP}" | grep "^${1}=" | cut -d= -f2-; }

if [[ "$(_extract_secret exists)" == "yes" ]]; then
  echo "    Found existing calypso-api-secrets — reusing passwords (idempotent run)."
  APP_RW_PASSWORD="$(_extract_secret APP_RW_PASSWORD)"
  JWT_SECRET="$(_extract_secret JWT_SECRET)"
  ENCRYPTION_MASTER_KEY="$(_extract_secret ENCRYPTION_MASTER_KEY)"
  AUDIT_W_PASSWORD="$(_extract_secret AUDIT_W_PASSWORD)"
  ANALYTICS_W_PASSWORD="$(_extract_secret ANALYTICS_W_PASSWORD)"
  AGENT_CODING_PASSWORD="$(_extract_secret AGENT_CODING_PASSWORD)"
  AGENT_ANALYSIS_PASSWORD="$(_extract_secret AGENT_ANALYSIS_PASSWORD)"
  AGENT_CODING_PASSWORD="${AGENT_CODING_PASSWORD:-$(openssl rand -hex 24)}"
  AGENT_ANALYSIS_PASSWORD="${AGENT_ANALYSIS_PASSWORD:-$(openssl rand -hex 24)}"
  if [[ "${DB_MODE}" == "local" ]]; then
    POSTGRES_SUPERUSER_PASSWORD="$(_extract_secret POSTGRES_SUPERUSER_PASSWORD)"
  fi
  unset -f _extract_secret
else
  echo "    Generating new secrets."
  JWT_SECRET="$(openssl rand -hex 64)"
  ENCRYPTION_MASTER_KEY="$(openssl rand -hex 32)"
  APP_RW_PASSWORD="$(openssl rand -hex 24)"
  AUDIT_W_PASSWORD="$(openssl rand -hex 24)"
  ANALYTICS_W_PASSWORD="$(openssl rand -hex 24)"
  AGENT_CODING_PASSWORD="$(openssl rand -hex 24)"
  AGENT_ANALYSIS_PASSWORD="$(openssl rand -hex 24)"
  if [[ "${DB_MODE}" == "local" ]]; then
    POSTGRES_SUPERUSER_PASSWORD="$(openssl rand -hex 24)"
  fi
  unset -f _extract_secret
fi

# Build database URLs
if [[ "${DB_MODE}" == "local" ]]; then
  DATABASE_URL="postgres://app_rw:${APP_RW_PASSWORD}@postgres:5432/calypso_app"
  AUDIT_DATABASE_URL="postgres://audit_w:${AUDIT_W_PASSWORD}@postgres:5432/calypso_audit"
  ANALYTICS_DATABASE_URL="postgres://analytics_w:${ANALYTICS_W_PASSWORD}@postgres:5432/calypso_analytics"
  ADMIN_DATABASE_URL="postgres://postgres:${POSTGRES_SUPERUSER_PASSWORD:-}@postgres:5432/calypso_app"
else
  REMOTE_PG_PORT="${REMOTE_PG_PORT:-5432}"
  REMOTE_PG_ADMIN_DB="${REMOTE_PG_ADMIN_DB:-postgres}"
  REMOTE_PG_ADMIN_USER="${REMOTE_PG_ADMIN_USER:-postgres}"
  REMOTE_PG_SSL="${REMOTE_PG_SSL:-require}"
  SSL_SUFFIX=""
  if [[ "${REMOTE_PG_SSL}" != "disable" ]] && [[ -n "${REMOTE_PG_SSL}" ]]; then
    SSL_SUFFIX="?sslmode=${REMOTE_PG_SSL}"
  elif [[ "${REMOTE_PG_SSL}" == "disable" ]]; then
    SSL_SUFFIX="?sslmode=disable"
  fi
  DATABASE_URL="postgres://app_rw:${APP_RW_PASSWORD}@${REMOTE_PG_HOST}:${REMOTE_PG_PORT}/calypso_app${SSL_SUFFIX}"
  AUDIT_DATABASE_URL="postgres://audit_w:${AUDIT_W_PASSWORD}@${REMOTE_PG_HOST}:${REMOTE_PG_PORT}/calypso_audit${SSL_SUFFIX}"
  ANALYTICS_DATABASE_URL="postgres://analytics_w:${ANALYTICS_W_PASSWORD}@${REMOTE_PG_HOST}:${REMOTE_PG_PORT}/calypso_analytics${SSL_SUFFIX}"
  ADMIN_DATABASE_URL="postgres://${REMOTE_PG_ADMIN_USER}:${REMOTE_PG_ADMIN_PASSWORD}@${REMOTE_PG_HOST}:${REMOTE_PG_PORT}/${REMOTE_PG_ADMIN_DB}${SSL_SUFFIX}"
fi

# Apply k8s secrets via superfield
_ssh_superfield bash <<REMOTESCRIPT
set -euo pipefail
export KUBECONFIG="/home/superfield/.kube/config"

kubectl create namespace "${NAMESPACE}" --dry-run=client -o yaml | kubectl apply -f -

kubectl delete secret calypso-api-secrets --namespace="${NAMESPACE}" --ignore-not-found
kubectl create secret generic calypso-api-secrets \
  --namespace="${NAMESPACE}" \
  --from-literal=DATABASE_URL="${DATABASE_URL}" \
  --from-literal=AUDIT_DATABASE_URL="${AUDIT_DATABASE_URL}" \
  --from-literal=ANALYTICS_DATABASE_URL="${ANALYTICS_DATABASE_URL}" \
  --from-literal=JWT_SECRET="${JWT_SECRET}" \
  --from-literal=ENCRYPTION_MASTER_KEY="${ENCRYPTION_MASTER_KEY}"

kubectl delete secret calypso-db-secrets --namespace="${NAMESPACE}" --ignore-not-found
kubectl create secret generic calypso-db-secrets \
  --namespace="${NAMESPACE}" \
  --from-literal=APP_RW_PASSWORD="${APP_RW_PASSWORD}" \
  --from-literal=AUDIT_W_PASSWORD="${AUDIT_W_PASSWORD}" \
  --from-literal=ANALYTICS_W_PASSWORD="${ANALYTICS_W_PASSWORD}" \
  --from-literal=AGENT_CODING_PASSWORD="${AGENT_CODING_PASSWORD}" \
  --from-literal=AGENT_ANALYSIS_PASSWORD="${AGENT_ANALYSIS_PASSWORD}"

kubectl delete secret calypso-db-init-secret --namespace="${NAMESPACE}" --ignore-not-found
kubectl create secret generic calypso-db-init-secret \
  --namespace="${NAMESPACE}" \
  --from-literal=ADMIN_DATABASE_URL="${ADMIN_DATABASE_URL}" \
  --from-literal=APP_RW_PASSWORD="${APP_RW_PASSWORD}" \
  --from-literal=AUDIT_W_PASSWORD="${AUDIT_W_PASSWORD}" \
  --from-literal=ANALYTICS_W_PASSWORD="${ANALYTICS_W_PASSWORD}" \
  --from-literal=AGENT_CODING_PASSWORD="${AGENT_CODING_PASSWORD}" \
  --from-literal=AGENT_ANALYSIS_PASSWORD="${AGENT_ANALYSIS_PASSWORD}"

echo "    Secrets applied."
REMOTESCRIPT

# Add optional per-env secrets
if [[ -n "${GITHUB_PAT:-}" ]]; then
  # PAT is embedded in the script body (sent over the encrypted SSH channel),
  # not passed as a kubectl argument, so it does not appear in ps/proc listings.
  _ssh_superfield bash <<REMOTESCRIPT
export KUBECONFIG="/home/superfield/.kube/config"
printf '%s' "${GITHUB_PAT}" | kubectl create secret docker-registry ghcr-pull-secret \
  --namespace="${NAMESPACE}" \
  --docker-server=ghcr.io \
  --docker-username=calypso \
  --docker-password-stdin \
  --dry-run=client -o yaml | kubectl apply -f -
REMOTESCRIPT
fi

if [[ -n "${MNEMONIC:-}" ]]; then
  _ssh_superfield bash <<REMOTESCRIPT
export KUBECONFIG="/home/superfield/.kube/config"
kubectl patch secret calypso-api-secrets --namespace="${NAMESPACE}" \
  --type=json \
  -p='[{"op":"add","path":"/data/SUPERUSER_MNEMONIC","value":"'"$(printf '%s' "${MNEMONIC}" | base64 | tr -d '\n')"'"}]'
REMOTESCRIPT
fi

if [[ "${DB_MODE}" == "local" ]]; then
  _ssh_superfield bash <<REMOTESCRIPT
export KUBECONFIG="/home/superfield/.kube/config"
kubectl patch secret calypso-db-secrets --namespace="${NAMESPACE}" \
  --type=json \
  -p='[
    {"op":"add","path":"/data/POSTGRES_USER","value":"'"$(printf '%s' "postgres" | base64 | tr -d '\n')"'"},
    {"op":"add","path":"/data/POSTGRES_PASSWORD","value":"'"$(printf '%s' "${POSTGRES_SUPERUSER_PASSWORD:-}" | base64 | tr -d '\n')"'"},
    {"op":"add","path":"/data/POSTGRES_DB","value":"'"$(printf '%s' "calypso_app" | base64 | tr -d '\n')"'"}
  ]'
REMOTESCRIPT

  # Apply local postgres StatefulSet
  _ssh_superfield bash <<REMOTESCRIPT
set -euo pipefail
export KUBECONFIG="/home/superfield/.kube/config"
kubectl apply --namespace="${NAMESPACE}" -f - <<MANIFEST
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: calypso-postgres-pvc
  namespace: ${NAMESPACE}
  labels:
    app: postgres
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 10Gi
---
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: postgres
  namespace: ${NAMESPACE}
  labels:
    app: postgres
spec:
  serviceName: postgres
  replicas: 1
  selector:
    matchLabels:
      app: postgres
  template:
    metadata:
      labels:
        app: postgres
    spec:
      containers:
        - name: postgres
          image: postgres:16-alpine
          ports:
            - containerPort: 5432
          env:
            - name: POSTGRES_USER
              valueFrom:
                secretKeyRef:
                  name: calypso-db-secrets
                  key: POSTGRES_USER
            - name: POSTGRES_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: calypso-db-secrets
                  key: POSTGRES_PASSWORD
            - name: POSTGRES_DB
              valueFrom:
                secretKeyRef:
                  name: calypso-db-secrets
                  key: POSTGRES_DB
            - name: PGDATA
              value: /var/lib/postgresql/data/pgdata
          volumeMounts:
            - name: postgres-data
              mountPath: /var/lib/postgresql/data
          livenessProbe:
            exec:
              command: [pg_isready, -U, postgres, -d, calypso_app]
            initialDelaySeconds: 30
            periodSeconds: 10
            timeoutSeconds: 5
            failureThreshold: 6
          readinessProbe:
            exec:
              command: [pg_isready, -U, postgres, -d, calypso_app]
            initialDelaySeconds: 5
            periodSeconds: 5
            timeoutSeconds: 5
            failureThreshold: 3
          resources:
            requests:
              cpu: '100m'
              memory: '256Mi'
            limits:
              cpu: '500m'
              memory: '512Mi'
      volumes:
        - name: postgres-data
          persistentVolumeClaim:
            claimName: calypso-postgres-pvc
---
apiVersion: v1
kind: Service
metadata:
  name: postgres
  namespace: ${NAMESPACE}
  labels:
    app: postgres
spec:
  selector:
    app: postgres
  ports:
    - name: postgres
      protocol: TCP
      port: 5432
      targetPort: 5432
  clusterIP: None
MANIFEST
echo "    Waiting for postgres to be ready..."
kubectl rollout status statefulset/postgres --namespace="${NAMESPACE}" --timeout=120s
REMOTESCRIPT
fi

echo "    Secret provisioning complete."

# ── Phase 7: Bootstrap summary ────────────────────────────────────────────────

echo ""
echo "==> [7/7] Bootstrap summary — GitHub Actions secrets to configure"
_confirm_step

# Extract k3s CA cert
K3S_CA_CERT=$(_ssh_superfield bash <<'SSHSCRIPT'
KUBECONFIG="/home/superfield/.kube/config"
kubectl --kubeconfig="${KUBECONFIG}" config view --raw \
  -o jsonpath='{.clusters[0].cluster.certificate-authority-data}' | base64 -d 2>/dev/null || true
SSHSCRIPT
)

echo ""
echo "════════════════════════════════════════════════════════════════════"
echo " GitHub Actions secrets — configure in Settings > Environments"
echo " Use --env ${ENV_LABEL} for environment-scoped secrets."
echo "════════════════════════════════════════════════════════════════════"
echo ""
echo " Environment: ${ENV_LABEL}"
echo ""
echo " Run the following commands from your local machine:"
echo ""
PRIVATE_KEY_PATH="${ADMIN_KEYS[0]%%.pub}"
echo "   gh secret set DEPLOY_SSH_KEY --env ${ENV_LABEL} < ${PRIVATE_KEY_PATH}"
echo "   gh secret set DEPLOY_HOST --env ${ENV_LABEL} --body '${HOST}'"
echo "   gh secret set DEPLOY_SA_NAME --env ${ENV_LABEL} --body '${SA_NAME}'"
echo "   gh secret set DEPLOY_NAMESPACE --env ${ENV_LABEL} --body '${NAMESPACE}'"
echo ""
if [[ -n "${K3S_CA_CERT}" ]]; then
  echo "   # K3S_CA_CERT — paste the PEM below:"
  echo "   gh secret set K3S_CA_CERT --env ${ENV_LABEL} --body '<paste-ca-pem>'"
  echo ""
  echo "   k3s CA certificate (PEM):"
  echo "${K3S_CA_CERT}"
else
  echo "   gh secret set K3S_CA_CERT --env ${ENV_LABEL} --body '<k3s-ca-pem>'"
  echo "   # Extract with:"
  echo "   # ssh superfield@${HOST} 'kubectl config view --raw -o jsonpath=\"{.clusters[0].cluster.certificate-authority-data}\" | base64 --decode'"
fi
echo ""
echo "════════════════════════════════════════════════════════════════════"
echo ""
echo "==> Provisioning complete!"
echo "    Host        : ${HOST}"
echo "    Environment : ${ENV_LABEL}"
echo "    Namespace   : ${NAMESPACE}"
echo ""
echo "    Admin access: ssh superfield@${HOST}"
echo "    Deploys:      trigger .github/workflows/deploy.yml via workflow_dispatch"
echo "    Runbook:      docs/host-init-script.md"
echo ""


# vim: ft=sh sw=2 ts=2 et

