#!/usr/bin/env bash
set -euo pipefail

BASE_URL=${BASE_URL:-https://dev.api.atropos-video.com}
SIGNATURE=${SIGNATURE:-t=0,v1=replace-with-test-signature}
EVENT_PAYLOAD=${EVENT_PAYLOAD:-./fixtures/checkout.session.completed.json}

if [[ ! -f "${EVENT_PAYLOAD}" ]]; then
  echo "Event payload file '${EVENT_PAYLOAD}' not found." >&2
  exit 1
fi

curl -sS -X POST "${BASE_URL}/billing/webhook" \
  -H 'Accept: application/json' \
  -H 'Content-Type: application/json' \
  -H "Stripe-Signature: ${SIGNATURE}" \
  --data @"${EVENT_PAYLOAD}"
