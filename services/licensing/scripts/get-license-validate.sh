#!/usr/bin/env bash
set -euo pipefail

BASE_URL=${BASE_URL:-https://dev.api.atropos-video.com}
TOKEN=${TOKEN:-replace-with-license-token}

curl -sS -X GET "${BASE_URL}/license/validate" \
  -H 'Accept: application/json' \
  -H "Authorization: Bearer ${TOKEN}"
