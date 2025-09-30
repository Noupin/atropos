#!/usr/bin/env bash
set -euo pipefail

BASE_URL=${BASE_URL:-https://dev.api.atropos-video.com}
USER_ID=${USER_ID:-user_123}
DEVICE_HASH=${DEVICE_HASH:-device_hash_example}

curl -sS -X POST "${BASE_URL}/trial/start" \
  -H 'Accept: application/json' \
  -H 'Content-Type: application/json' \
  -d "{\
    \"user_id\": \"${USER_ID}\",\
    \"device_hash\": \"${DEVICE_HASH}\"\
  }"
