#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/srv/projects/TripMap"
REMOTE="${REMOTE:-baller}"

ssh "$REMOTE" "mkdir -p '$APP_DIR'"
rsync -az --delete \
  --exclude node_modules \
  --exclude .git \
  --exclude dist \
  --exclude .env \
  ./ "$REMOTE:$APP_DIR/"

ssh "$REMOTE" "cd '$APP_DIR' && WEB_ORIGIN=\${WEB_ORIGIN:-https://trip.vvitovec.com} COOKIE_SECURE=\${COOKIE_SECURE:-true} S3_PUBLIC_ENDPOINT=\${S3_PUBLIC_ENDPOINT:-http://localhost:9007} docker compose -f infra/docker-compose.yml up -d --build"
