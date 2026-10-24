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
- `/applications` - Private Joblite-submitted applications (shown in navigation when records exist)
- `/saved` - Saved jobs
- `/notifications` - Private account notifications
- `/sign-in` - Shared passwordless email-code flow
- `/compose` - Multimedia post composer (requires sign-in to publish)
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
`STREAM_ACCOUNT_ID` and `STREAM_API_TOKEN`. Passwordless production email delivery requires the server-side secrets
`RESEND_API_KEY` and `EMAIL_FROM` (the verified sender identity accepted by Resend). `EMAIL_API_KEY` is also accepted
as a compatibility alias. The current Cloudflare Worker already has a binding named `RESEND_API_KEY`, so the supplied
Resend credential is stored as the server-side `EMAIL_API_KEY` secret and `EMAIL_FROM` is configured as a secret.
Missing delivery configuration returns an explicit error and never claims that an email was sent. Never put these
values in Vite variables or frontend code.

### Passwordless authentication

Users request a six-digit email code at `POST /api/v1/auth/challenges`, then verify the returned challenge ID and code
at `POST /api/v1/auth/verify`. Codes expire after ten minutes, are HMAC-protected in D1, are single-use, and have bounded
attempt, resend, email, and network limits. Successful verification rotates the opaque session token. `POST
/api/v1/auth/logout` revokes it. The code is not returned by production APIs or logged. `EMAIL_FROM` and
`RESEND_API_KEY` must be configured before passwordless sign-in can be offered in production.

Migration `0005_passwordless_auth.sql` adds the rate-limit storage and an isolated local test-mail table. The latter is
readable only when both `ENVIRONMENT=test` and `TEST_MAIL_SINK=enabled`; the E2E runner uses a fresh temporary D1 store
and test-only credentials, not the development or production database.

### End-to-end checks

Install the matching Playwright browser once with `npx playwright install chromium`, then run:

```bash
npm run e2e
```

The runner builds the app, applies all migrations to an isolated temporary D1 database, seeds one deterministic job
fixture, starts a local Worker with the test mail sink, and removes only its temporary directory on exit. It covers
guest entry and job filtering, private API rejection, guest Apply sign-in, email-code account creation, server-resolved
external continuation, tracking behavior, authenticated image upload and post publishing, media viewer close/scroll
restoration, and mobile/desktop rendering of the listed routes. Screenshots are written to `artifacts/screenshots/`;
failure traces and the HTML report are under `artifacts/playwright-results/` and `artifacts/playwright-report/`.

Unit tests include authentication challenge lifecycle and safe internal-return-path checks:

```bash
npm run typecheck && npm run lint && npm test && npm run build
```

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
