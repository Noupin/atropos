#!/usr/bin/env bash
set -euo pipefail

BASE_URL=${BASE_URL:-https://dev.api.atropos-video.com}
DEVICE_HASH=${DEVICE_HASH:-device_hash_example}

curl -sS -X GET "${BASE_URL}/billing/subscription" \
  -H 'Accept: application/json' \
  --get \
  --data-urlencode "device_hash=${DEVICE_HASH}"
