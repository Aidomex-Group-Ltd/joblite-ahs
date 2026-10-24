# Phased Atomic Implementation Backlog
Work in small reviewable commits. Each phase ends with a working vertical slice, checks and an updated progress record. Preserve existing user work; inspect the repository before scaffolding.

| Phase | Deliverables | Exit gate |
|---|---|---|
| 0 — Foundation | Repository audit, package choices, environment examples, Worker/assets setup, local D1/R2, CI | Local frontend/API and health endpoint run |
| 1 — Identity and geography | Sessions, verified sign-in, country seed, organizations/memberships, permission utilities | Two tenants isolated; all countries selectable |
| 2 — Profiles and native jobs | Profile editor/privacy, skills/history, job composer/search/details/save | Employer publishes; guest finds eligible job |
| 3 — Applications and ATS | Immutable snapshots, candidate tracker, employer pipeline, notes/interviews/offers | Full native hiring journey; concurrency tests pass |
| 4 — Multimedia feed | Post/comment/share/follow, R2 validation, Stream upload/playback, reports | Text/images/video survive reload and failures recover |
| 5 — Global discovery | Source registry, reviewed adapters, board directory, ingestion/dedup/freshness | Permitted source works; link-only sources never import |
| 6 — Alerts and assistance | Outbox/queues, saved search, reminders, transparent matching | Retries deduplicate; opt-outs honored |
| 7 — Hardening and launch | Privacy operations, moderation, accessibility, load checks, backups, deployment | Release gates in document 09 pass |

All phases are required for the agreed first complete release. Intermediate previews may omit unfinished phases only when clearly labelled.

## Example atomic tasks
1. Add country schema and maintained seed with integrity validation.
2. Add membership authorization with cross-tenant denial tests.
3. Implement native job write API, then connect composer.
4. Implement filtered job query and URL-synced search.
5. Implement unique application submission plus snapshot/outbox transaction.
6. Implement candidate timeline and employer stage transition.
7. Implement versioned offers and candidate response.
8. Implement upload intent → validation → publish lifecycle.
9. Implement source registry, one approved adapter and fixture contract.
10. Implement queue retry/dead-letter observability and runbook.

## Dependency rules
Do not implement ATS before ownership boundaries. Do not publish media before validation/playback works. Do not enable ingestion before permissions and source attribution exist. Do not enable AI ranking before deterministic search and eligibility behavior pass. Do not deploy unconfigured email/video paths as if they work.
