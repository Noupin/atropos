#!/usr/bin/env bash
set -euo pipefail

BASE_URL=${BASE_URL:-https://dev.api.atropos-video.com}
USER_ID=${USER_ID:-user_123}
EMAIL=${EMAIL:-user@example.com}
PRICE_ID=${PRICE_ID:-price_dev_monthly}
SUCCESS_URL=${SUCCESS_URL:-https://app.atropos.dev/billing/success}
CANCEL_URL=${CANCEL_URL:-https://app.atropos.dev/billing/cancel}

curl -sS -X POST "${BASE_URL}/billing/checkout" \
  -H 'Accept: application/json' \
  -H 'Content-Type: application/json' \
  -d "{\
    \"user_id\": \"${USER_ID}\",\
    \"email\": \"${EMAIL}\",\
    \"price_id\": \"${PRICE_ID}\",\
    \"success_url\": \"${SUCCESS_URL}\",\
    \"cancel_url\": \"${CANCEL_URL}\"\
  }"
