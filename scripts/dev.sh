#!/bin/bash
set -e
cd "$(dirname "$0")/.."
./scripts/setup-dev-secrets.sh
./scripts/apply-migrations-local.sh
npm run build
npm run dev
