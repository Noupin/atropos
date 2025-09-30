#!/usr/bin/env bash
set -euo pipefail

BASE_URL=${BASE_URL:-https://dev.api.atropos-video.com}
DEVICE_HASH=${DEVICE_HASH:-device_hash_example}
TOKEN=${TOKEN:-replace-with-transfer-token}

curl -sS -X GET "${BASE_URL}/transfer/accept" \
  -H 'Accept: text/html' \
  --get \
  --data-urlencode "device_hash=${DEVICE_HASH}" \
  --data-urlencode "token=${TOKEN}"
