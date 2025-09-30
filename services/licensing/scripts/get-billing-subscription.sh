#!/usr/bin/env bash
set -euo pipefail

BASE_URL=${BASE_URL:-https://dev.api.atropos-video.com}
USER_ID=${USER_ID:-user_123}

curl -sS -X GET "${BASE_URL}/billing/subscription" \
  -H 'Accept: application/json' \
  --get \
  --data-urlencode "user_id=${USER_ID}"
