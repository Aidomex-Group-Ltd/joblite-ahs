#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
STATE_DIR="$(mktemp -d /tmp/joblite-e2e.XXXXXX)"
WORKER_PID=""
E2E_PORT="${E2E_PORT:-$((20000 + RANDOM % 20000))}"
cleanup() {
  if [[ -n "$WORKER_PID" ]]; then kill -- "-$WORKER_PID" 2>/dev/null || true; wait "$WORKER_PID" 2>/dev/null || true; fi
  rm -rf "$STATE_DIR"
}
trap cleanup EXIT INT TERM

npm run build
CI=true echo "y" | npx wrangler d1 migrations apply joblite-db --local --config wrangler.toml --persist-to "$STATE_DIR"
npx wrangler d1 execute joblite-db --local --config wrangler.toml --persist-to "$STATE_DIR" --file scripts/e2e-seed.sql --yes
setsid npx wrangler dev --config wrangler.toml --assets ./dist/client --persist-to "$STATE_DIR" --ip 127.0.0.1 --port "$E2E_PORT" \
  --var ENVIRONMENT:test --var APP_URL:"http://127.0.0.1:$E2E_PORT" --var TEST_MAIL_SINK:enabled \
  --var SESSION_SECRET:isolated-e2e-session-secret --var CSRF_SECRET:isolated-e2e-csrf-secret \
  > "$STATE_DIR/worker.log" 2>&1 &
WORKER_PID=$!

READY=0
for _ in $(seq 1 60); do
  if curl --silent --fail "http://127.0.0.1:$E2E_PORT/api/health/ready" >/dev/null; then READY=1; break; fi
  sleep 1
done
if [[ "$READY" != "1" ]]; then cat "$STATE_DIR/worker.log"; exit 1; fi
if ! E2E_BASE_URL="http://127.0.0.1:$E2E_PORT" npx playwright test; then
  cat "$STATE_DIR/worker.log"
  exit 1
fi
