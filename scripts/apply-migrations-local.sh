#!/bin/bash
set -e
cd "$(dirname "$0")/.."
npx wrangler d1 migrations apply joblite-db --local
