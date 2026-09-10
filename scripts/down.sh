#!/usr/bin/env bash
# Remove the stack from the cluster. Leaves the Supabase databases untouched.
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a
: "${KUBE_CONTEXT:?not set in .env}"

pkill -f "port-forward.*kagent-ui" 2>/dev/null || true
helm uninstall kagent --kube-context "$KUBE_CONTEXT" -n kagent --ignore-not-found --wait >/dev/null 2>&1 || true
helm uninstall kagent-crds --kube-context "$KUBE_CONTEXT" -n kagent --ignore-not-found --wait >/dev/null 2>&1 || true
kubectl --context "$KUBE_CONTEXT" delete namespace kagent --ignore-not-found --wait >/dev/null
echo "Down. Databases kept; 'npm run db:provision -- --drop' removes those."
