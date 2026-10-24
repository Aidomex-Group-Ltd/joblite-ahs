# Joblite AHS — Joblite Autonomous Hiring System

Cloudflare-native job platform with X-style feed, native jobs + ATS, global country coverage, and permission-governed source ingestion.

## Tech Stack
- TypeScript, React 18, Vite
- Cloudflare Workers (Hono router)
- D1 (SQLite), R2 (storage), Queues, Cron Triggers
- Cloudflare Stream (video, optional)

## Quick Start

```bash
# Install dependencies
npm install

# Apply migrations locally
npm run migrate:local

# Build frontend
npm run build

# Run development server
npm run dev

# In another terminal, perform an authenticated first sync into local D1
npm run sync:local
```

## Routes
- `/` - Home feed with composer
- `/jobs` - Job search with filters
- `/jobs/:id` - Job details
- `/boards` - External boards directory
- `/applications` - My applications
- `/hiring` - Employer hiring dashboard
- `/settings` - Settings

## Environment
Copy `.env.example` to `.env` and configure secrets. Worker bindings are in `wrangler.toml`.

For local Worker development, `scripts/setup-dev-secrets.sh` creates `.dev.vars` with local-only values. The initial sync
requires the Worker running at `http://localhost:8787` and its `INGEST_TOKEN`; it calls the authenticated admin sync route.
The same route is available to signed-in organization administrators. Never expose the ingestion token in client code.

Local setup and deployment require a built frontend because Wrangler serves `dist/client` as Worker assets. Run
`npm run build` before `npm run dev` or `npm run deploy`. `npm run deploy` deploys the Worker and built assets; apply
reviewed production D1 migrations separately with `npx wrangler d1 migrations apply joblite-db --remote --config wrangler.toml`.
Production secrets are `SESSION_SECRET` and `CSRF_SECRET`; set them with `npx wrangler secret put <NAME> --config wrangler.toml`.
For a bearer-authenticated production sync, also set `INGEST_TOKEN` with that command. Organization administrators may
run the same admin sync endpoint with their authenticated session. Optional Stream and email integrations use
`STREAM_ACCOUNT_ID`, `STREAM_API_TOKEN`, and `EMAIL_API_KEY`.

## Documentation
See `docs/Joblite-AHS-docs/` for full product, architecture, and API specifications.

## Features
- All ISO 3166-1 countries/territories selectable
- X-style desktop (3-column) and mobile (single feed + bottom nav)
- Native and imported jobs with proper labeling
- Immutable ATS snapshots, human-controlled hiring
- Secure auth, private CVs, upload validation
- Permission-governed source registry
- Scheduled server-side provider refresh every 30 minutes, respecting each source's configured minimum interval
- Authenticated initial sync via `npm run sync:local`
