#!/usr/bin/env bash
set -euo pipefail

BASE_URL=${BASE_URL:-https://dev.api.atropos-video.com}
TOKEN=${TOKEN:-replace-with-paid-license-token}
DEVICE_HASH=${DEVICE_HASH:-device_hash_example}

curl -sS -X POST "${BASE_URL}/transfer/initiate" \
  -H 'Accept: application/json' \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "X-Atropos-Device-Hash: ${DEVICE_HASH}" \
  -d '{}'
