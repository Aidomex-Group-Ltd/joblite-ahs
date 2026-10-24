# API and Event Contracts
## Conventions
Use same-origin /api/v1 routes, JSON, secure session cookies and CSRF protection on mutations. Server-side validation and authorization are mandatory. Return {data, meta} on success and {error:{code,message,fields,request_id}} on failure. Use 400 invalid requests, 401 unauthenticated, 403 unauthorized, 404 absent/inaccessible resources, 409 conflicts, 413 oversize and 429 rate limiting. Do not leak resource existence across tenants.

Cursor lists return next_cursor and accept a bounded limit (default 20, maximum 100). Mutation requests that create applications, offers or upload intents accept Idempotency-Key. Scope keys to actor and operation, persist request hash/result, and reject key reuse with a different payload.

| Method and path | Purpose / guard |
|---|---|
| POST /auth/challenges; POST /auth/verify | Issue and consume verification challenge with rate limits |
| POST /auth/logout; GET /me | Revoke session; private account state |
| GET /countries; GET /boards | Public geography and directory |
| GET /jobs; GET /jobs/:id | Published jobs and provenance |
| POST /organizations/:id/jobs | Authorized employer creates draft |
| PATCH /jobs/:id | Owner organization; expected version |
| POST /jobs/:id/publish; POST /jobs/:id/close | Validated state transition |
| GET /profiles/:handle | Public visibility-filtered serializer |
| PATCH /me/profile | Candidate edits own profile |
| POST /media/intents; POST /media/:id/complete | Authorize upload; validate completion |
| GET /feed; POST /posts; PATCH /posts/:id; DELETE /posts/:id | Public reads; owner mutations |
| POST /posts/:id/comments | Authenticated comment with moderation |
| POST /jobs/:id/save; DELETE /jobs/:id/save | Idempotent own save |
| POST /jobs/:id/applications | Native open job only; snapshot and uniqueness |
| GET /me/applications; GET /applications/:id | Candidate or authorized employer view |
| GET /organizations/:id/applications | Organization member scope |
| POST /applications/:id/transitions | Expected version; role and transition check |
| POST /applications/:id/notes | Private employer notes |
| POST /applications/:id/offers | Authorized human-issued offer |
| POST /offers/:id/respond | Candidate accepts/declines current valid offer |
| PUT /me/external-applications/:jobId | Explicit self-reported external status |
| GET /me/notifications; PATCH /me/notifications/:id | Own notification inbox |
| POST /reports | Authenticated abuse report |
| POST /admin/sources/:id/run | Administrator schedules approved source |
| POST /webhooks/stream | Authenticate callback and deduplicate provider event |

## Application creation example
Request: {profile_version: 4, cv_media_id: "opaque-id", answers: [], consent_version: "v1"}. The server rechecks job state/deadline, CV ownership/readiness and candidate identity, then atomically writes application, immutable snapshot, audit event and outbox record. Return 201 with the created application; repeated idempotent request returns the same result.

## Transition example
Request: {to: "interview", expected_version: 2, candidate_message: "Interview details will follow"}. Return updated version and visible timeline. Reject stale versions with 409 and expose a safe refresh action.

## Event envelope
{event_id, type, schema_version, occurred_at, actor_id, organization_id, subject_id, payload}. Events include job.published, application.submitted, application.stage_changed, offer.issued, offer.responded, media.ready and source.run_completed. Minimize payloads; queue references instead of CV contents. Consumers deduplicate event IDs.
