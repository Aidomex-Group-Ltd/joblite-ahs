# Joblite AHS - Agent Instructions

## Project Overview
Cloudflare-native job platform implementing Joblite Autonomous Hiring System per docs/Joblite-AHS-docs/.

## Architecture
- Frontend: React + Vite in src/client/
- Backend: Hono on Cloudflare Workers in src/worker/
- Database: D1 (SQLite)
- Storage: R2 for media, Cloudflare Stream for video
- Queues: Outbox pattern for async events
- Cron: Scheduled jobs

## Key Conventions
- Use TypeScript strict mode
- All mutations require auth/authorization
- Native jobs vs imported jobs must be clearly labeled
- Application snapshots are immutable
- Offers != accepted offers; hiring requires explicit human action
- Never persist blob URLs as media
- All countries from ISO 3166-1 must be selectable

## Testing
Run `npm run typecheck && npm run lint && npm test`

## Migrations
Apply with `npx wrangler d1 migrations apply joblite-db --local`

## Commands
- `npm run dev` - Development
- `npm run build` - Build
- `npm run typecheck` - Type check
