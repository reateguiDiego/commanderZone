#!/usr/bin/env bash
set -euo pipefail

USERS=100
ALL_PHASES=0
API_BASE_URL="https://api.commanderzone.com"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PRODUCTION_PATH="$REPO_ROOT"
RUNTIME_METRICS_URL=""
USER_PASSWORD="${LOAD_TEST_USER_PASSWORD:-}"
DECK_NAME="Load Test Deck"
DURATION_MINUTES=10
COMMAND_INTERVAL_MS=2000
K6_IMAGE="grafana/k6:latest"
CONFIRM_PRODUCTION=0
ALLOW_NON_PRODUCTION=0
LOCAL_DRY_RUN=0
SKIP_SERVER_METRICS=0

usage() {
  cat <<'USAGE'
CommanderZone production load test for Linux servers.

Required for production:
  export LOAD_TEST_USER_PASSWORD="<seeded-user-password>"
  bash scripts/run-production-load-test.sh \
    --users 100 \
    --api-base-url https://api.commanderzone.com \
    --production-path /opt/commanderZone \
    --confirm-production

Modes:
  --users 100|280|500       Run one phase.
  --all-phases              Run 100, then 280, then 500.
  --local-dry-run           Use 4 users for a short local validation.
  --skip-server-metrics     Do not collect server-side metrics.

Reports:
  reports/load-tests/<run-id>/users-<phase>/
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --users)
      USERS="${2:?--users requires a value}"
      shift 2
      ;;
    --all-phases)
      ALL_PHASES=1
      shift
      ;;
    --api-base-url)
      API_BASE_URL="${2:?--api-base-url requires a value}"
      shift 2
      ;;
    --production-path)
      PRODUCTION_PATH="${2:?--production-path requires a value}"
      shift 2
      ;;
    --runtime-metrics-url)
      RUNTIME_METRICS_URL="${2:?--runtime-metrics-url requires a value}"
      shift 2
      ;;
    --user-password)
      USER_PASSWORD="${2:?--user-password requires a value}"
      shift 2
      ;;
    --deck-name)
      DECK_NAME="${2:?--deck-name requires a value}"
      shift 2
      ;;
    --duration-minutes)
      DURATION_MINUTES="${2:?--duration-minutes requires a value}"
      shift 2
      ;;
    --command-interval-ms)
      COMMAND_INTERVAL_MS="${2:?--command-interval-ms requires a value}"
      shift 2
      ;;
    --k6-image)
      K6_IMAGE="${2:?--k6-image requires a value}"
      shift 2
      ;;
    --confirm-production)
      CONFIRM_PRODUCTION=1
      shift
      ;;
    --allow-non-production)
      ALLOW_NON_PRODUCTION=1
      shift
      ;;
    --local-dry-run)
      LOCAL_DRY_RUN=1
      shift
      ;;
    --skip-server-metrics)
      SKIP_SERVER_METRICS=1
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage
      exit 2
      ;;
  esac
done

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "$1 is required." >&2
    exit 2
  fi
}

is_allowed_users() {
  [[ "$1" == "100" || "$1" == "280" || "$1" == "500" ]]
}

json_number() {
  local file="$1"
  local key="$2"
  if [[ ! -s "$file" ]]; then
    echo 0
    return
  fi
  local value
  value="$(tr -d '\n' < "$file" | sed -n "s/.*\"$key\"[[:space:]]*:[[:space:]]*\\([0-9][0-9]*\\).*/\\1/p" | tail -n 1)"
  if [[ -z "$value" ]]; then
    echo 0
  else
    echo "$value"
  fi
}

collect_restart_counts() {
  local output="$1"
  local compose=(docker compose --env-file .env.prod -f docker-compose.prod.yml)
  (cd "$PRODUCTION_PATH" && "${compose[@]}" ps -q api websocket game-runtime database \
    | xargs -r docker inspect --format '{{ index .Config.Labels "com.docker.compose.service" }}={{ .RestartCount }}') > "$output" || true
}

restart_count() {
  local file="$1"
  local service="$2"
  if [[ ! -s "$file" ]]; then
    echo 0
    return
  fi
  local value
  value="$(grep -E "^${service}=" "$file" | tail -n 1 | cut -d= -f2)"
  if [[ -z "$value" ]]; then
    echo 0
  else
    echo "$value"
  fi
}

collect_server_snapshot() {
  local phase_dir="$1"
  local label="$2"
  local compose=(docker compose --env-file .env.prod -f docker-compose.prod.yml)
  local errors_file="$phase_dir/server-errors-$label.txt"
  : > "$errors_file"

  if [[ "$SKIP_SERVER_METRICS" == "1" ]]; then
    echo "server metrics skipped by --skip-server-metrics" >> "$errors_file"
    return
  fi

  if [[ ! -d "$PRODUCTION_PATH" ]]; then
    echo "production path not found: $PRODUCTION_PATH" >> "$errors_file"
    return
  fi

  (cd "$PRODUCTION_PATH" && "${compose[@]}" ps -q api websocket game-runtime database \
    | xargs -r docker stats --no-stream --format '{{json .}}') \
    > "$phase_dir/docker-stats-$label.ndjson" \
    2>> "$errors_file" || echo "docker stats failed" >> "$errors_file"

  (cd "$PRODUCTION_PATH" && "${compose[@]}" ps -q api websocket game-runtime database \
    | xargs -r docker inspect --format '{{json .}}') \
    > "$phase_dir/docker-inspect-$label.ndjson" \
    2>> "$errors_file" || echo "docker inspect failed" >> "$errors_file"

  collect_restart_counts "$phase_dir/restarts-$label.txt"

  local runtime_url="$RUNTIME_METRICS_URL"
  if [[ -z "$runtime_url" ]]; then
    runtime_url="http://127.0.0.1:8091/metrics"
  fi
  curl -fsS "$runtime_url" > "$phase_dir/runtime-$label.json" \
    2>> "$errors_file" || echo "runtime metrics failed" >> "$errors_file"

  local sql
  sql="select json_build_object('capturedAt', now(), 'database', current_database(), 'activeConnections', (select count(*) from pg_stat_activity), 'waitingConnections', (select count(*) from pg_stat_activity where wait_event is not null), 'locks', (select count(*) from pg_locks), 'waitingLocks', (select count(*) from pg_locks where not granted), 'deadlocks', (select deadlocks from pg_stat_database where datname = current_database()), 'xactCommit', (select xact_commit from pg_stat_database where datname = current_database()), 'xactRollback', (select xact_rollback from pg_stat_database where datname = current_database()), 'tempFiles', (select temp_files from pg_stat_database where datname = current_database()), 'tempBytes', (select temp_bytes from pg_stat_database where datname = current_database()), 'databaseSizeBytes', pg_database_size(current_database()), 'pgStatStatementsAvailable', to_regclass('public.pg_stat_statements') is not null)::text;"
  (cd "$PRODUCTION_PATH" && "${compose[@]}" exec -T -e CZLT_SQL="$sql" database sh -lc 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -c "$CZLT_SQL"') \
    > "$phase_dir/postgres-$label.json" \
    2>> "$errors_file" || echo "postgres metrics failed" >> "$errors_file"

  cat > "$phase_dir/server-metrics-$label.json" <<JSON
{
  "capturedAt": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "label": "$label",
  "productionPath": "$PRODUCTION_PATH",
  "files": {
    "dockerStats": "docker-stats-$label.ndjson",
    "dockerInspect": "docker-inspect-$label.ndjson",
    "runtime": "runtime-$label.json",
    "postgres": "postgres-$label.json",
    "restarts": "restarts-$label.txt",
    "errors": "server-errors-$label.txt"
  }
}
JSON
}

write_server_delta() {
  local phase_dir="$1"
  local failures_file="$phase_dir/server-gate-failures.txt"
  : > "$failures_file"

  local queue_before queue_after unsupported_before unsupported_after ownership_before ownership_after
  queue_before="$(json_number "$phase_dir/runtime-before.json" "actor.queue_full_count")"
  queue_after="$(json_number "$phase_dir/runtime-after.json" "actor.queue_full_count")"
  unsupported_before="$(json_number "$phase_dir/runtime-before.json" "command.unsupported_count")"
  unsupported_after="$(json_number "$phase_dir/runtime-after.json" "command.unsupported_count")"
  ownership_before="$(json_number "$phase_dir/runtime-before.json" "runtime.ownership_reject_count")"
  ownership_after="$(json_number "$phase_dir/runtime-after.json" "runtime.ownership_reject_count")"

  local deadlocks_before deadlocks_after waiting_locks_before waiting_locks_after
  deadlocks_before="$(json_number "$phase_dir/postgres-before.json" "deadlocks")"
  deadlocks_after="$(json_number "$phase_dir/postgres-after.json" "deadlocks")"
  waiting_locks_before="$(json_number "$phase_dir/postgres-before.json" "waitingLocks")"
  waiting_locks_after="$(json_number "$phase_dir/postgres-after.json" "waitingLocks")"

  local queue_delta=$((queue_after - queue_before))
  local unsupported_delta=$((unsupported_after - unsupported_before))
  local ownership_delta=$((ownership_after - ownership_before))
  local deadlocks_delta=$((deadlocks_after - deadlocks_before))
  local waiting_locks_delta=$((waiting_locks_after - waiting_locks_before))

  if (( queue_delta > 0 )); then echo "runtime actor.queue_full_count delta is $queue_delta" >> "$failures_file"; fi
  if (( unsupported_delta > 0 )); then echo "runtime command.unsupported_count delta is $unsupported_delta" >> "$failures_file"; fi
  if (( ownership_delta > 0 )); then echo "runtime ownership reject delta is $ownership_delta" >> "$failures_file"; fi
  if (( deadlocks_delta > 0 )); then echo "postgres deadlocks delta is $deadlocks_delta" >> "$failures_file"; fi
  if (( waiting_locks_delta > 0 )); then echo "postgres waitingLocks delta is $waiting_locks_delta" >> "$failures_file"; fi

  local restart_json=""
  for service in api websocket game-runtime database; do
    local before after delta
    before="$(restart_count "$phase_dir/restarts-before.txt" "$service")"
    after="$(restart_count "$phase_dir/restarts-after.txt" "$service")"
    delta=$((after - before))
    if (( delta > 0 )); then echo "container restart delta for $service is $delta" >> "$failures_file"; fi
    if [[ -n "$restart_json" ]]; then restart_json+=", "; fi
    restart_json+="\"$service\": $delta"
  done

  cat > "$phase_dir/server-metrics-delta.json" <<JSON
{
  "generatedAt": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "runtime": {
    "actor.queue_full_count": $queue_delta,
    "command.unsupported_count": $unsupported_delta,
    "runtime.ownership_reject_count": $ownership_delta
  },
  "postgres": {
    "deadlocks": $deadlocks_delta,
    "waitingLocks": $waiting_locks_delta
  },
  "restartDelta": { $restart_json },
  "failureFile": "server-gate-failures.txt"
}
JSON
}

write_operator_summary() {
  local phase_dir="$1"
  local phase_users="$2"
  local k6_exit_code="$3"
  local failures_file="$phase_dir/server-gate-failures.txt"
  local k6_status="pass"
  local server_status="pass"
  if [[ "$k6_exit_code" != "0" ]]; then k6_status="fail"; fi
  if [[ -s "$failures_file" ]]; then server_status="fail"; fi

  {
    echo "# CommanderZone Production Load Test"
    echo
    echo "- Phase users: $phase_users"
    echo "- API base URL: $API_BASE_URL"
    echo "- k6 status: $k6_status"
    echo "- server status: $server_status"
    echo "- k6 summary JSON: $phase_dir/k6-summary.json"
    echo "- server delta JSON: $phase_dir/server-metrics-delta.json"
    echo
    echo "## Server Gate"
    echo
    if [[ -s "$failures_file" ]]; then
      sed 's/^/- /' "$failures_file"
    else
      echo "- No critical server gate failures detected."
    fi
    echo
    echo "## Metric Collection Errors"
    echo
    cat "$phase_dir/server-errors-before.txt" "$phase_dir/server-errors-after.txt" 2>/dev/null | sed '/^$/d;s/^/- /' || true
  } > "$phase_dir/summary.md"
}

assert_safety() {
  require_command docker
  require_command curl

  if ! is_allowed_users "$USERS"; then
    echo "--users must be one of 100, 280, or 500. Received: $USERS" >&2
    exit 2
  fi
  if [[ -z "$USER_PASSWORD" ]]; then
    echo "Set LOAD_TEST_USER_PASSWORD or pass --user-password. Do not commit seeded user credentials." >&2
    exit 2
  fi

  local is_production=0
  if [[ "$API_BASE_URL" == "https://api.commanderzone.com"* ]]; then
    is_production=1
  fi
  if [[ "$is_production" == "1" && "$CONFIRM_PRODUCTION" != "1" ]]; then
    echo "Production target requires --confirm-production." >&2
    exit 2
  fi
  if [[ "$is_production" != "1" && "$ALLOW_NON_PRODUCTION" != "1" && "$LOCAL_DRY_RUN" != "1" ]]; then
    echo "Non-production target requires --allow-non-production or --local-dry-run." >&2
    exit 2
  fi
  if [[ "$is_production" == "1" && "$SKIP_SERVER_METRICS" != "1" && ! -f "$PRODUCTION_PATH/docker-compose.prod.yml" ]]; then
    echo "Production metrics require docker-compose.prod.yml under --production-path, or explicit --skip-server-metrics." >&2
    exit 2
  fi
}

invoke_phase() {
  local phase_users="$1"
  local run_id="$2"
  local report_root="$3"
  local phase_dir="$report_root/users-$phase_users"
  mkdir -p "$phase_dir"

  echo "Starting CommanderZone load phase: users=$phase_users report=$phase_dir"
  collect_server_snapshot "$phase_dir" before

  local duration="${DURATION_MINUTES}m"
  local dry_run_value=0
  if [[ "$LOCAL_DRY_RUN" == "1" ]]; then
    duration="30s"
    dry_run_value=1
  fi

  local k6_exit_code=0
  USER_PASSWORD="$USER_PASSWORD" docker run \
    --rm \
    --pull=missing \
    -e K6_NO_USAGE_REPORT=true \
    -e API_BASE_URL="$API_BASE_URL" \
    -e USERS="$phase_users" \
    -e USER_PASSWORD \
    -e RUN_ID="$run_id" \
    -e PHASE_NAME="users-$phase_users" \
    -e DECK_NAME="$DECK_NAME" \
    -e DURATION="$duration" \
    -e DRY_RUN="$dry_run_value" \
    -e COMMAND_INTERVAL_MS="$COMMAND_INTERVAL_MS" \
    -v "$REPO_ROOT/load-tests:/scripts:ro" \
    -v "$phase_dir:/reports" \
    "$K6_IMAGE" \
    run /scripts/commanderzone-production.k6.js \
    2>&1 | tee "$phase_dir/k6-output.log" || k6_exit_code="${PIPESTATUS[0]}"

  collect_server_snapshot "$phase_dir" after
  write_server_delta "$phase_dir"
  write_operator_summary "$phase_dir" "$phase_users" "$k6_exit_code"

  if [[ "$k6_exit_code" != "0" || -s "$phase_dir/server-gate-failures.txt" ]]; then
    return 1
  fi
  return 0
}

assert_safety

phases=("$USERS")
if [[ "$ALL_PHASES" == "1" ]]; then
  phases=(100 280 500)
fi

run_id="czlt-$(date -u +"%Y%m%d-%H%M%S")"
if [[ "$LOCAL_DRY_RUN" == "1" ]]; then
  run_id="${run_id}-dryrun"
fi
report_root="$REPO_ROOT/reports/load-tests/$run_id"
mkdir -p "$report_root"

all_passed=0
for phase in "${phases[@]}"; do
  if ! invoke_phase "$phase" "$run_id" "$report_root"; then
    all_passed=1
  fi
done

echo "Load test report root: $report_root"
exit "$all_passed"
