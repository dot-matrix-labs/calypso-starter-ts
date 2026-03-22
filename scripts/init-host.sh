#!/usr/bin/env bash
# init-host.sh — full host provisioning for Calypso on k3s
#
# Usage:
#   sudo -E bash scripts/init-host.sh <env>
#
# <env> is the deployment environment label (e.g. "demo", "prod").
# The Kubernetes namespace will be "calypso-<env>".
#
# Credential input (non-interactive / CI):
#   All prompts are TTY-guarded. In non-interactive mode supply via env vars.
#
# Required env vars:
#   CALYPSO_IMAGE_TAG   — image tag to deploy (e.g. "v1.2.3" or "sha-abc1234")
#   GITHUB_PAT          — GitHub PAT for pulling from GHCR
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
# Superuser credential (provide one):
#   MNEMONIC            — BIP-39 mnemonic phrase
#   SUPERUSER_PASSWORD  — password for superuser account (alternative to MNEMONIC)
#
# Optional API keys:
#   SUBSTACK_API_KEY
#   BLOOMBERG_API_KEY
#   YAHOO_API_KEY
#
# Idempotent: safe to run multiple times. Existing secrets and resources are
# updated; existing k3s installation is not reinstalled.

set -euo pipefail

# ── Argument validation ───────────────────────────────────────────────────────

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <env>" >&2
  echo "  <env> is the deployment environment (e.g. demo, prod)" >&2
  exit 1
fi

ENV_LABEL="$1"
NAMESPACE="calypso-${ENV_LABEL}"
REPO="ghcr.io/dot-matrix-labs/calypso-starter-ts"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

echo "==> Calypso host initialisation"
echo "    Environment : ${ENV_LABEL}"
echo "    Namespace   : ${NAMESPACE}"
echo ""

# ── 1. k3s installation ───────────────────────────────────────────────────────

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

# ── 2. Credential collection ──────────────────────────────────────────────────

echo ""
echo "==> [2/8] Collecting credentials"

# Detect database mode
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
  # Remote PG host
  if [[ -z "${REMOTE_PG_HOST:-}" ]] && [ -t 0 ]; then
    read -rp "    Remote PG host: " REMOTE_PG_HOST
  fi
  : "${REMOTE_PG_HOST:?Remote PG host is required for remote mode}"

  # Remote PG port
  if [[ -z "${REMOTE_PG_PORT:-}" ]] && [ -t 0 ]; then
    read -rp "    Remote PG port [5432]: " input_pg_port
    REMOTE_PG_PORT="${input_pg_port:-5432}"
  fi
  REMOTE_PG_PORT="${REMOTE_PG_PORT:-5432}"

  # Admin DB
  if [[ -z "${REMOTE_PG_ADMIN_DB:-}" ]] && [ -t 0 ]; then
    read -rp "    Remote PG admin database [postgres]: " input_admin_db
    REMOTE_PG_ADMIN_DB="${input_admin_db:-postgres}"
  fi
  REMOTE_PG_ADMIN_DB="${REMOTE_PG_ADMIN_DB:-postgres}"

  # Admin user
  if [[ -z "${REMOTE_PG_ADMIN_USER:-}" ]] && [ -t 0 ]; then
    read -rp "    Remote PG admin user [postgres]: " input_admin_user
    REMOTE_PG_ADMIN_USER="${input_admin_user:-postgres}"
  fi
  REMOTE_PG_ADMIN_USER="${REMOTE_PG_ADMIN_USER:-postgres}"

  # Admin password
  if [[ -z "${REMOTE_PG_ADMIN_PASSWORD:-}" ]] && [ -t 0 ]; then
    read -rsp "    Remote PG admin password: " REMOTE_PG_ADMIN_PASSWORD
    echo ""
  fi
  : "${REMOTE_PG_ADMIN_PASSWORD:?Remote PG admin password is required for remote mode}"

  # SSL mode
  REMOTE_PG_SSL="${REMOTE_PG_SSL:-require}"
  if [[ "${REMOTE_PG_SSL}" == "require" ]] && [ -t 0 ]; then
    read -rp "    SSL mode (require|verify-full|disable) [require]: " input_ssl
    REMOTE_PG_SSL="${input_ssl:-require}"
  fi
fi

# Image tag
if [[ -z "${CALYPSO_IMAGE_TAG:-}" ]] && [ -t 0 ]; then
  read -rp "    Calypso image tag (e.g. v1.2.3): " CALYPSO_IMAGE_TAG
fi
: "${CALYPSO_IMAGE_TAG:?CALYPSO_IMAGE_TAG is required}"
IMAGE="${REPO}:${CALYPSO_IMAGE_TAG}"

# Superuser credential
if [[ -z "${MNEMONIC:-}" ]] && [[ -z "${SUPERUSER_PASSWORD:-}" ]] && [ -t 0 ]; then
  read -rsp "    Superuser mnemonic (or leave blank to use SUPERUSER_PASSWORD): " MNEMONIC
  echo ""
  if [[ -z "${MNEMONIC:-}" ]]; then
    read -rsp "    Superuser password: " SUPERUSER_PASSWORD
    echo ""
  fi
fi

# GitHub PAT for GHCR
if [[ -z "${GITHUB_PAT:-}" ]] && [ -t 0 ]; then
  read -rsp "    GitHub PAT (for GHCR pull): " GITHUB_PAT
  echo ""
fi

# ── 3. Remote PG connectivity check ──────────────────────────────────────────

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

# ── 4. Secret generation ──────────────────────────────────────────────────────

echo ""
echo "==> [4/8] Generating secrets"

# On repeated runs, reuse existing role passwords from calypso-api-secrets so
# the application connections remain valid (postgres roles keep the same password).
_decode_secret_key() {
  local namespace="$1" secret="$2" key="$3"
  kubectl get secret "${secret}" --namespace="${namespace}" \
    -o jsonpath="{.data.${key}}" 2>/dev/null | base64 -d 2>/dev/null || true
}

if kubectl get secret calypso-api-secrets --namespace="${NAMESPACE}" &>/dev/null 2>&1; then
  echo "    Found existing calypso-api-secrets — reusing role passwords (idempotent run)."
  _existing_db_url="$(_decode_secret_key "${NAMESPACE}" calypso-api-secrets DATABASE_URL)"
  # Extract app_rw password from the existing DATABASE_URL (postgres://user:PASS@host/db)
  APP_RW_PASSWORD="$(echo "${_existing_db_url}" | sed 's|.*://[^:]*:\([^@]*\)@.*|\1|')"
  AUDIT_W_PASSWORD="$(_decode_secret_key "${NAMESPACE}" calypso-db-secrets AUDIT_W_PASSWORD)"
  ANALYTICS_W_PASSWORD="$(_decode_secret_key "${NAMESPACE}" calypso-db-secrets ANALYTICS_W_PASSWORD)"
  AGENT_CODING_PASSWORD="$(_decode_secret_key "${NAMESPACE}" calypso-db-secrets AGENT_CODING_PASSWORD)"
  AGENT_ANALYSIS_PASSWORD="$(_decode_secret_key "${NAMESPACE}" calypso-db-secrets AGENT_ANALYSIS_PASSWORD)"
  # Fall back to generating agent passwords if they were not stored (upgrade path)
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
  PG_HOST="postgres"
  PG_PORT="5432"
  PG_ADMIN_DB="calypso_app"
  PG_ADMIN_USER="postgres"
  PG_ADMIN_PASSWORD="${POSTGRES_SUPERUSER_PASSWORD:-}"
  PG_SSL=""
else
  PG_HOST="${REMOTE_PG_HOST}"
  PG_PORT="${REMOTE_PG_PORT}"
  PG_ADMIN_DB="${REMOTE_PG_ADMIN_DB}"
  PG_ADMIN_USER="${REMOTE_PG_ADMIN_USER}"
  PG_ADMIN_PASSWORD="${REMOTE_PG_ADMIN_PASSWORD}"
  PG_SSL="${REMOTE_PG_SSL}"
fi

# Build connection URLs
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

# ── 5. Kubernetes namespace and secrets ───────────────────────────────────────

echo ""
echo "==> [5/8] Creating Kubernetes namespace and secrets"

kubectl create namespace "${NAMESPACE}" --dry-run=client -o yaml | kubectl apply -f -

# GHCR image pull secret
if [[ -n "${GITHUB_PAT:-}" ]]; then
  kubectl create secret docker-registry ghcr-pull-secret \
    --namespace="${NAMESPACE}" \
    --docker-server=ghcr.io \
    --docker-username=calypso \
    --docker-password="${GITHUB_PAT}" \
    --dry-run=client -o yaml | kubectl apply -f -
fi

# calypso-api-secrets — used by the app at runtime (never contains admin creds)
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
if [[ -n "${SUBSTACK_API_KEY:-}" ]]; then
  API_SECRET_ARGS+=(--from-literal=SUBSTACK_API_KEY="${SUBSTACK_API_KEY}")
fi
if [[ -n "${BLOOMBERG_API_KEY:-}" ]]; then
  API_SECRET_ARGS+=(--from-literal=BLOOMBERG_API_KEY="${BLOOMBERG_API_KEY}")
fi
if [[ -n "${YAHOO_API_KEY:-}" ]]; then
  API_SECRET_ARGS+=(--from-literal=YAHOO_API_KEY="${YAHOO_API_KEY}")
fi

# Delete existing secret so we can recreate it cleanly (idempotent)
kubectl delete secret calypso-api-secrets --namespace="${NAMESPACE}" --ignore-not-found
kubectl create secret generic calypso-api-secrets "${API_SECRET_ARGS[@]}"

# calypso-db-secrets — DB role passwords for migration tooling (no admin creds)
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

# calypso-db-init-secret — TEMPORARY, deleted after db-init job completes
DB_INIT_SECRET_ARGS=(
  --namespace="${NAMESPACE}"
  --from-literal=ADMIN_DATABASE_URL="${ADMIN_DATABASE_URL}"
  --from-literal=APP_RW_PASSWORD="${APP_RW_PASSWORD}"
  --from-literal=AUDIT_W_PASSWORD="${AUDIT_W_PASSWORD}"
  --from-literal=ANALYTICS_W_PASSWORD="${ANALYTICS_W_PASSWORD}"
  --from-literal=AGENT_CODING_PASSWORD="${AGENT_CODING_PASSWORD}"
  --from-literal=AGENT_ANALYSIS_PASSWORD="${AGENT_ANALYSIS_PASSWORD}"
)
if [[ -n "${REMOTE_PG_CA_CERT:-}" ]]; then
  DB_INIT_SECRET_ARGS+=(--from-literal=DB_CA_CERT="${REMOTE_PG_CA_CERT}")
fi
kubectl delete secret calypso-db-init-secret --namespace="${NAMESPACE}" --ignore-not-found
kubectl create secret generic calypso-db-init-secret "${DB_INIT_SECRET_ARGS[@]}"

echo "    Kubernetes secrets created."

# ── 6. Manifest application ───────────────────────────────────────────────────

echo ""
echo "==> [6/8] Applying Kubernetes manifests"

# Generate and apply manifests with correct namespace and image
# Local mode: deploy the postgres StatefulSet; remote mode: skip it

apply_with_namespace() {
  local file="$1"
  # Inject namespace into manifest and apply
  kubectl apply -f "${file}" --namespace="${NAMESPACE}"
}

if [[ "${DB_MODE}" == "local" ]]; then
  # Apply postgres StatefulSet with namespace and updated secret references
  # We generate an inline manifest to use correct namespace and secret names
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

# Apply db-init job with namespace and correct image
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

# ── 7. Firewall setup ─────────────────────────────────────────────────────────

echo ""
echo "==> [7/8] Configuring firewall"

if command -v ufw &>/dev/null; then
  # Configure UFW. Run in a subshell so ufw warnings/errors on repeat runs
  # (known Ubuntu bug: "Could not load logging rules" after --force reset) do
  # not abort the main script. Firewall rules are best-effort — k3s works without
  # them and they can be re-applied manually if needed.
  (
    set +e
    ufw disable 2>/dev/null
    ufw --force reset 2>/dev/null
    # Disable logging to avoid iptables logging-rules load failures on repeat runs
    if [[ -f /etc/ufw/ufw.conf ]]; then
      sed -i 's/^LOGLEVEL=.*/LOGLEVEL=off/' /etc/ufw/ufw.conf
    fi
    ufw default deny incoming 2>/dev/null
    ufw default allow outgoing 2>/dev/null
    ufw allow 22/tcp     comment "SSH"   2>/dev/null
    ufw allow 6443/tcp   comment "K8s API"  2>/dev/null
    ufw allow 10250/tcp  comment "kubelet"  2>/dev/null
    ufw allow 31415/tcp  comment "App NodePort"  2>/dev/null
    ufw allow 8472/udp   comment "Flannel VXLAN" 2>/dev/null
    ufw --force enable 2>/dev/null
    true  # ensure subshell exits with 0
  )
  echo "    Firewall configured."
else
  echo "    ufw not found — skipping firewall configuration."
fi

# ── 8. Wait for db-init-job, then clean up and deploy app ─────────────────────

echo ""
echo "==> [8/8] Running db-init job and deploying application"

echo "    Waiting for calypso-db-init job to complete..."
if ! kubectl wait --for=condition=complete job/calypso-db-init \
  --namespace="${NAMESPACE}" \
  --timeout=300s; then
  echo "    ERROR: calypso-db-init job timed out or failed. Dumping pod logs:" >&2
  kubectl get pods --namespace="${NAMESPACE}" --selector=app=calypso-db-init >&2 || true
  kubectl logs --namespace="${NAMESPACE}" --selector=app=calypso-db-init --tail=100 >&2 || true
  kubectl describe job/calypso-db-init --namespace="${NAMESPACE}" >&2 || true
  exit 1
fi

echo "    calypso-db-init job completed."

# Delete the db-init-secret immediately after the job completes (security: admin creds)
kubectl delete secret calypso-db-init-secret --namespace="${NAMESPACE}" --ignore-not-found
echo "    calypso-db-init-secret deleted."

# Deploy the application
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
echo "==> Deployment complete!"
echo "    Namespace : ${NAMESPACE}"
echo "    Image     : ${IMAGE}"
echo "    DB mode   : ${DB_MODE}"
echo ""
echo "    Run scripts/whoami.sh ${ENV_LABEL} to verify deployment state."
