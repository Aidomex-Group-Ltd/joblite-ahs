#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")/.."

BASE_URL="${JOBLITE_URL:-http://localhost:8787}"

if [ ! -f ".dev.vars" ]; then
  echo "Missing .dev.vars. Run scripts/setup-dev-secrets.sh first." >&2
  exit 1
fi

TOKEN="$(grep '^INGEST_TOKEN=' .dev.vars | cut -d= -f2- || true)"
if [ -z "$TOKEN" ]; then
  echo "INGEST_TOKEN is not configured in .dev.vars." >&2
  echo "Run scripts/setup-dev-secrets.sh, then restart npm run dev." >&2
  exit 1
fi

if ! curl -fsS "$BASE_URL/api/health" >/dev/null; then
  echo "Joblite is not responding at $BASE_URL. Start it with 'npm run dev'." >&2
  exit 1
fi

if [ "$#" -gt 0 ]; then
  BODY="$(node -e 'console.log(JSON.stringify({ limit: 20, source_ids: process.argv.slice(1) }))' "$@")"
else
  BODY='{"limit":20}'
fi

echo "Running provider ingestion against $BASE_URL ..."
curl -fsS -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "$BODY" \
  "$BASE_URL/api/v1/admin/sync" \
  | node -e '
let input = "";
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  const payload = JSON.parse(input);
  const data = payload.data || {};
  console.log(`Sources run: ${data.sources_run}, skipped: ${data.sources_skipped}, failed: ${data.sources_failed}`);
  console.log(`Jobs inserted: ${data.jobs_inserted}, updated: ${data.jobs_updated}, duplicates linked: ${data.duplicates_linked}`);
  for (const result of data.results || []) {
    const detail = result.error ? `error: ${result.error}` : result.note || "";
    console.log(`- ${result.name}: ${result.state} (${result.inserted} new, ${result.updated} updated) ${detail}`);
  }
});
'
