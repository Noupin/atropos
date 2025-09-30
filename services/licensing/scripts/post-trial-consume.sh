#!/usr/bin/env bash
set -euo pipefail

BASE_URL=${BASE_URL:-https://dev.api.atropos-video.com}
USER_ID=${USER_ID:-user_123}
DEVICE_HASH=${DEVICE_HASH:-device_hash_example}
TOKEN=${TOKEN:-replace-with-trial-token}

curl -sS -X POST "${BASE_URL}/trial/consume" \
  -H 'Accept: application/json' \
  -H 'Content-Type: application/json' \
  -d "{\
    \"user_id\": \"${USER_ID}\",\
    \"device_hash\": \"${DEVICE_HASH}\",\
    \"token\": \"${TOKEN}\"\
  }"
