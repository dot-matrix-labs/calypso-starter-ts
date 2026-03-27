#!/usr/bin/env bash
# Experimental init-host-talos.sh — Provisions Calypso onto a Talos OS cluster
#
# Usage:
#   scripts/init-host-talos.sh <host> <env>
#
# Arguments:
#   <host>              Talos node IP or hostname, or "127.0.0.1" for local docker cluster
#   <env>               Deployment environment label (e.g. "demo", "prod")

set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "Usage: $0 <host> <env>" >&2
  exit 1
fi

HOST="$1"
ENV_LABEL="$2"
NAMESPACE="calypso-${ENV_LABEL}"
REPO="${CALYPSO_IMAGE_REPO:-ghcr.io/dot-matrix-labs/calypso-starter-ts}"

if [[ -z "${CALYPSO_IMAGE_TAG:-}" ]]; then
  if [ -t 0 ]; then
    read -rp "    Calypso image tag (e.g. v1.2.3): " CALYPSO_IMAGE_TAG
  else
    echo "error: CALYPSO_IMAGE_TAG is required" >&2
    exit 1
  fi
fi
IMAGE="${REPO}:${CALYPSO_IMAGE_TAG}"

if ! command -v talosctl &>/dev/null; then
  echo "error: talosctl must be installed" >&2
  exit 1
fi
if ! command -v kubectl &>/dev/null; then
  echo "error: kubectl must be installed" >&2
  exit 1
fi

echo "==> Calypso Talos provisioning"
echo "    Host        : ${HOST}"
echo "    Environment : ${ENV_LABEL}"
echo "    Namespace   : ${NAMESPACE}"
echo "    Image       : ${IMAGE}"
echo ""

# Determine Kubeconfig
export KUBECONFIG="${PWD}/.kube/config-talos"
mkdir -p .kube

if [[ "${HOST}" == "127.0.0.1" || "${HOST}" == "localhost" ]]; then
  echo "==> [1/4] Local Talos testing detected. Using existing kubeconfig."
  export KUBECONFIG="${HOME}/.kube/config"
else
  echo "==> [1/4] Fetching kubeconfig via talosctl"
  talosctl kubeconfig "${KUBECONFIG}" --nodes "${HOST}" --endpoints "${HOST}" --force
fi

if ! kubectl get nodes &>/dev/null; then
  echo "error: unable to reach kubernetes API" >&2
  exit 1
fi

# Credential Collection
echo ""
echo "==> [2/4] Collecting/Generating secrets"

DB_MODE="local"
if [[ -n "${REMOTE_PG_HOST:-}" ]]; then
  DB_MODE="remote"
fi
echo "    DB mode: ${DB_MODE}"

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
  AGENT_CODE_CLEANUP_PASSWORD="$(_decode_secret_key "${NAMESPACE}" calypso-db-secrets AGENT_CODE_CLEANUP_PASSWORD)"
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
  AGENT_CODE_CLEANUP_PASSWORD="$(openssl rand -hex 24)"
  if [[ "${DB_MODE}" == "local" ]]; then
    POSTGRES_SUPERUSER_PASSWORD="$(openssl rand -hex 24)"
  fi
fi

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
  ADMIN_DATABASE_URL="postgres://${REMOTE_PG_ADMIN_USER}:${REMOTE_PG_ADMIN_PASSWORD:-}@${REMOTE_PG_HOST}:${REMOTE_PG_PORT}/${REMOTE_PG_ADMIN_DB}${SSL_SUFFIX}"
fi

if [[ -z "${GITHUB_PAT:-}" ]] && [ -t 0 ]; then
  read -rsp "    GitHub PAT (for GHCR pull): " GITHUB_PAT
  echo ""
fi
if [[ -z "${MNEMONIC:-}" ]] && [[ -z "${SUPERUSER_PASSWORD:-}" ]] && [ -t 0 ]; then
  read -rsp "    Superuser mnemonic (or leave blank to use SUPERUSER_PASSWORD): " MNEMONIC
  echo ""
  if [[ -z "${MNEMONIC:-}" ]]; then
    read -rsp "    Superuser password: " SUPERUSER_PASSWORD
    echo ""
  fi
fi

# Apply Secrets
echo ""
echo "==> [3/4] Creating Kubernetes namespace and secrets"
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
  --from-literal=AGENT_CODE_CLEANUP_PASSWORD="${AGENT_CODE_CLEANUP_PASSWORD}"
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
  --from-literal=AGENT_CODE_CLEANUP_PASSWORD="${AGENT_CODE_CLEANUP_PASSWORD}"
)
[[ -n "${REMOTE_PG_CA_CERT:-}" ]] && DB_INIT_SECRET_ARGS+=(--from-literal=DB_CA_CERT="${REMOTE_PG_CA_CERT}")
kubectl delete secret calypso-db-init-secret --namespace="${NAMESPACE}" --ignore-not-found
kubectl create secret generic calypso-db-init-secret "${DB_INIT_SECRET_ARGS[@]}"

# Apply Workloads
echo ""
echo "==> [4/4] Applying Kubernetes manifests"

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
            - name: AGENT_CODE_CLEANUP_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: calypso-db-init-secret
                  key: AGENT_CODE_CLEANUP_PASSWORD
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
  kubectl logs --namespace="${NAMESPACE}" --selector=app=calypso-db-init --tail=200 >&2 || true
  exit 1
fi

echo "    calypso-db-init job completed."
kubectl delete secret calypso-db-init-secret --namespace="${NAMESPACE}" --ignore-not-found

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
echo "==> Deployment complete! (Talos)"
echo "    Namespace : ${NAMESPACE}"
echo "    Image     : ${IMAGE}"
echo "    DB mode   : ${DB_MODE}"
echo ""
echo "    Use 'kubectl -n ${NAMESPACE} get pods' to verify deployment state."
exit 0
