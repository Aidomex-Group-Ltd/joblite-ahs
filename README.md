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
npx wrangler d1 migrations apply joblite-db --local

# Build frontend
npm run build

# Run development server
npm run dev
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

## Documentation
See `docs/Joblite-AHS-docs/` for full product, architecture, and API specifications.

## Features
- All ISO 3166-1 countries/territories selectable
- X-style desktop (3-column) and mobile (single feed + bottom nav)
- Native and imported jobs with proper labeling
- Immutable ATS snapshots, human-controlled hiring
- Secure auth, private CVs, upload validation
- Permission-governed source registry
