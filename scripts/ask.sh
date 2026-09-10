#!/usr/bin/env bash
# Send one message to an agent and print its answer.
# Usage: scripts/ask.sh "your question" [agent-name]
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a
: "${KUBE_CONTEXT:?not set in .env}"
TEXT=${1:?usage: scripts/ask.sh "your question" [agent-name]}
AGENT=${2:-hello}
PORT=18083

kubectl --context "$KUBE_CONTEXT" -n kagent port-forward svc/kagent-controller "$PORT:8083" >/dev/null 2>&1 &
PF=$!
trap 'kill $PF 2>/dev/null || true' EXIT
for _ in $(seq 1 20); do curl -sf "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 && break; sleep 0.5; done

jq -n --arg t "$TEXT" '{jsonrpc:"2.0",id:"1",method:"message/send",
  params:{message:{role:"user",messageId:("m"+(now|tostring)),parts:[{kind:"text",text:$t}]}}}' \
| curl -s --max-time 180 -X POST "http://127.0.0.1:$PORT/api/a2a/kagent/$AGENT" \
    -H 'Content-Type: application/json' --data-binary @- \
| jq -r '.result.artifacts[]?.parts[]?.text // .result.status.message.parts[]?.text // .error.message // "no answer in response"'
