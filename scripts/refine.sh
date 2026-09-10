#!/usr/bin/env bash
# Run the refiner poll from a laptop. The cluster does the same thing on a
# schedule; this is for rehearsing and for one-off runs.
# Usage: scripts/refine.sh [--issue N] [--dry-run]
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a
: "${KUBE_CONTEXT:?not set in .env}" "${GITHUB_REPO:?not set in .env}" "${GITHUB_TOKEN:?not set in .env}"
PORT=18084

kubectl --context "$KUBE_CONTEXT" -n kagent port-forward svc/kagent-controller "$PORT:8083" >/dev/null 2>&1 &
PF=$!
trap 'kill $PF 2>/dev/null || true' EXIT
for _ in $(seq 1 20); do curl -sf "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 && break; sleep 0.5; done

REFINER_AGENT_URL="http://127.0.0.1:$PORT" node scripts/refiner-poll.mjs "$@"
