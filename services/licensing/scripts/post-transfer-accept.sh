#!/usr/bin/env bash
set -euo pipefail

BASE_URL=${BASE_URL:-https://dev.api.atropos-video.com}
USER_ID=${USER_ID:-user_123}
TOKEN=${TOKEN:-replace-with-transfer-token}
DEVICE_HASH=${DEVICE_HASH:-new_device_hash_example}

curl -sS -X POST "${BASE_URL}/transfer/accept" \
  -H 'Accept: application/json' \
  -H 'Content-Type: application/json' \
  -d "{\
    \"user_id\": \"${USER_ID}\",\
    \"token\": \"${TOKEN}\",\
    \"device_hash\": \"${DEVICE_HASH}\"\
  }"
