#!/usr/bin/env bash
set -euo pipefail

BASE_URL=${BASE_URL:-https://dev.api.atropos-video.com}
DEVICE_HASH=${DEVICE_HASH:-new_device_hash_example}
TOKEN=${TOKEN:-replace-with-transfer-token}

curl -sS -X POST "${BASE_URL}/transfer/accept" \
  -H 'Accept: application/json' \
  -H 'Content-Type: application/json' \
  -d "{\
    \"device_hash\": \"${DEVICE_HASH}\",\
    \"token\": \"${TOKEN}\"\
  }"
