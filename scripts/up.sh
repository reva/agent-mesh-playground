#!/usr/bin/env bash
# Bring the stack up. Idempotent.
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a
: "${KUBE_CONTEXT:?not set in .env}" "${KAGENT_DATABASE_URL:?}" "${OPENROUTER_API_KEY:?}"
k() { kubectl --context "$KUBE_CONTEXT" "$@"; }

k create namespace kagent --dry-run=client -o yaml | k apply -f - >/dev/null
k -n kagent create secret generic kagent-database \
  --from-literal=url="$KAGENT_DATABASE_URL" --dry-run=client -o yaml | k apply -f - >/dev/null
k -n kagent create secret generic kagent-openrouter \
  --from-literal=OPENAI_API_KEY="$OPENROUTER_API_KEY" --dry-run=client -o yaml | k apply -f - >/dev/null

helm upgrade --install kagent-crds oci://ghcr.io/kagent-dev/kagent/helm/kagent-crds \
  --kube-context "$KUBE_CONTEXT" --version 0.10.0 -n kagent --set kmcp.enabled=true --wait --timeout 5m >/dev/null
helm upgrade --install kagent oci://ghcr.io/kagent-dev/kagent/helm/kagent \
  --kube-context "$KUBE_CONTEXT" --version 0.10.0 -n kagent -f helm/kagent-values.yaml --wait --timeout 10m >/dev/null

k apply -f examples/hello-agent.yaml >/dev/null
k -n kagent rollout status deploy/kagent-ui --timeout=5m

pkill -f "port-forward.*kagent-ui" 2>/dev/null || true
nohup kubectl --context "$KUBE_CONTEXT" -n kagent port-forward svc/kagent-ui 8082:8080 \
  >/tmp/kagent-ui-forward.log 2>&1 & disown
sleep 4
echo "UI: http://127.0.0.1:8082"
