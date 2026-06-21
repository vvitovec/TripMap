#!/usr/bin/env bash
set -euo pipefail

URLS=(
  "${WEB_URL:-https://trip.vvitovec.com}"
  "${API_HEALTH_URL:-https://trip-api.vvitovec.com/health}"
)

for url in "${URLS[@]}"; do
  code="$(curl -fsS -o /dev/null -w '%{http_code}' --max-time 20 "$url")"

  if [[ "$code" != 2* && "$code" != 3* ]]; then
    echo "Production check failed for $url: HTTP $code" >&2
    exit 1
  fi

  echo "$url -> HTTP $code"
done
