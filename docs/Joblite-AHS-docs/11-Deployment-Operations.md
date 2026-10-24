# Cloudflare Deployment and Operations Runbook
## Environments
Local, staging and production use distinct D1 databases, R2 buckets, Queues and secrets. Use environment-specific Worker bindings and domain configuration. Never point local tests at production resources.

## Required configuration
Worker/assets application; D1 binding DB; private R2 binding MEDIA; ingestion and notification queues plus dead-letter queues; Cron schedules; Stream account/token or supported binding; session/auth secrets; allowed origin; public application URL. Add outbound email configuration only after selecting a supported delivery method. Optional Durable Objects, KV, Turnstile and AI are not mandatory dependencies.

## Setup sequence
1. Verify current Cloudflare service availability, plan limits and pricing from official docs.
2. Install pinned dependencies, authenticate Wrangler and select account.
3. Create staging resources; record nonsecret identifiers in environment config.
4. Set secrets through supported secret tooling; never commit tokens.
5. Apply reviewed migrations to staging and load countries plus explicitly labelled demo fixtures.
6. Build assets/Worker, run checks, deploy staging and verify bindings.
7. Exercise sign-in delivery, job posting, application/ATS, private CV access, video processing and ingestion.
8. Create production resources, backup/rollback plan and budget controls; apply production migrations deliberately.
9. Deploy the tested commit to production, check health/smoke tests and watch error/queue metrics.

Implementation must supply exact commands matching the chosen package versions, scripts and resource names. Avoid copying invented account/database IDs into deployment instructions.

## Monitoring
Structured request IDs; Worker error/latency/CPU; D1 query failures and volume; queue age/retries/dead letters; source freshness/rate limiting; upload failures; Stream processing failures; auth delivery and challenge abuse. Redact personal data. Expose liveness and limited readiness endpoints without secrets.

## Recovery
Failed deploy: redeploy last known good Worker/assets version, checking schema compatibility. Prefer additive migrations; rollback code is not a database rollback. Failed import: disable source, preserve checkpoints and replay after fix. Queue backlog: inspect representative errors and replay idempotently. Media event loss: reconcile provider status. Credential exposure: rotate, revoke affected sessions and inspect access logs.

## Backup and restoration
Review current D1 recovery/export capabilities and retention for the chosen plan. Schedule verified database exports and R2 object inventory/retention appropriate to privacy obligations. Keep recovery copies encrypted with restricted access; decide durable backup location explicitly. Restore into staging and verify job/application/snapshot consistency before claiming recovery readiness.

## Cost controls
Set per-user upload quotas, bounded video duration, pagination, API rate limits, source fetch budgets and alert frequency caps. Track monthly forecast for compute/database/storage/operations/Stream minutes/queues and any email or AI usage. Establish thresholds with the owner; disable noncritical work gracefully before uncontrolled spend. Do not advertise the full stack as free.
