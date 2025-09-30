#!/usr/bin/env bash
set -euo pipefail

BASE_URL=${BASE_URL:-https://dev.api.atropos-video.com}
USER_ID=${USER_ID:-user_123}
RETURN_URL=${RETURN_URL:-https://app.atropos.dev/settings}

curl -sS -X POST "${BASE_URL}/billing/portal" \
  -H 'Accept: application/json' \
  -H 'Content-Type: application/json' \
  -d "{\
    \"user_id\": \"${USER_ID}\",\
    \"return_url\": \"${RETURN_URL}\"\
  }"
