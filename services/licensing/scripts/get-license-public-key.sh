#!/usr/bin/env bash
set -euo pipefail

BASE_URL=${BASE_URL:-https://dev.api.atropos-video.com}

curl -sS -X GET "${BASE_URL}/license/public-key" \
  -H 'Accept: application/json'
