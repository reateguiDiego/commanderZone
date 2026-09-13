#!/usr/bin/env bash
set -euo pipefail
: "${USER_PASSWORD:?Set USER_PASSWORD to a seeded test-account password}"
API_BASE_URL="${API_BASE_URL:-http://127.0.0.1:8000}"
mkdir -p "$(cd "$(dirname "$0")/.." && pwd)/reports/navigation-smoke"
docker run --rm --network host \
  -e K6_NO_USAGE_REPORT=true -e PROFILE=ci -e USERS=5 \
  -e API_BASE_URL="$API_BASE_URL" -e USER_PASSWORD -e FRIEND_SEARCH_TERMS -e NAVIGATION_MIX \
  -v "$(cd "$(dirname "$0")/.." && pwd)/load-tests:/scripts:ro" \
  -v "$(cd "$(dirname "$0")/.." && pwd)/reports/navigation-smoke:/reports" \
  grafana/k6:2.1.0 run /scripts/commanderzone-navigation.k6.js
