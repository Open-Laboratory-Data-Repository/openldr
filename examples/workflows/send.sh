#!/usr/bin/env sh
# Posts payload.json to the example workflow's webhook.
# Set OPENLDR_URL to your OpenLDR address, for example http://localhost:3000.
# Set OPENLDR_WEBHOOK_SECRET to the secret you put on the workflow's webhook step.
set -eu

if [ -z "${OPENLDR_URL:-}" ]; then
  echo "Set OPENLDR_URL to your OpenLDR address first." >&2
  exit 1
fi
if [ -z "${OPENLDR_WEBHOOK_SECRET:-}" ]; then
  echo "Set OPENLDR_WEBHOOK_SECRET to the secret on the webhook step first." >&2
  exit 1
fi

DIR=$(cd "$(dirname "$0")" && pwd)

curl --fail-with-body -sS -X POST "$OPENLDR_URL/api/workflows/hooks/examples/lab-rows" \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Token: $OPENLDR_WEBHOOK_SECRET" \
  --data-binary "@$DIR/payload.json"
echo
