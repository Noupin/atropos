#!/usr/bin/env bash
set -euo pipefail

BASE_URL=${BASE_URL:-https://dev.api.atropos-video.com}
DEVICE_HASH=${DEVICE_HASH:-device_hash_example}
RETURN_URL=${RETURN_URL:-https://app.atropos.dev/settings}

curl -sS -X POST "${BASE_URL}/billing/portal" \
  -H 'Accept: application/json' \
  -H 'Content-Type: application/json' \
  -d "{\
    \"device_hash\": \"${DEVICE_HASH}\",\
    \"return_url\": \"${RETURN_URL}\"\
  }"
