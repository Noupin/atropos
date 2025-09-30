#!/usr/bin/env bash
set -euo pipefail

BASE_URL=${BASE_URL:-https://dev.api.atropos-video.com}
USER_ID=${USER_ID:-user_123}
TOKEN=${TOKEN:-replace-with-transfer-token}

curl -sS -X GET "${BASE_URL}/transfer/accept" \
  -H 'Accept: text/html' \
  --get \
  --data-urlencode "user_id=${USER_ID}" \
  --data-urlencode "token=${TOKEN}"
