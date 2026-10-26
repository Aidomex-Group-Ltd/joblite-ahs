# Implementation Status - Joblite AHS

Last updated: 2026-10-26

## Signup challenge handoff follow-up (2026-10-26)
- [x] Reduced signup account creation to the required Terms of Service / Privacy Policy acknowledgment; age and marketing controls are no longer separate required signup checkboxes.
- [x] Persisted hashed-code challenges before contacting Resend, added email-scoped HMAC idempotency records, and made duplicate retries return the same usable challenge without sending another message.
- [x] Reported provider acceptance separately from unknown delivery outcomes; timeouts/network failures and post-acceptance D1 update failures return recoverable challenge metadata without automatic resend.
- [x] Added redacted request/phase diagnostics, browser retry/refresh recovery, and mocked Resend/idempotency/session regressions.

**Historical incident evidence:** The original production challenge request returned HTTP 500 after the designated inbox received its email, but the historical Worker event/request ID is unavailable. The previous challenge handler had no post-provider D1 state update, so the exact operation that threw cannot be confirmed from retained evidence. The incident's root cause therefore remains unconfirmed; the changes above address response-stage and retry ambiguity without claiming to identify the original exception. No production verification email was sent during this follow-up.

**Verification:** `npm run typecheck`, `npm run lint`, `npm test` (55 tests), `npm run e2e -- --workers=1` (6 tests), `npm run build`, and `git diff --check` passed. A first E2E run hit the default 15-second URL assertion timeout after the onboarding update returned HTTP 200 in 16.2 seconds; the assertion timeout was raised to 45 seconds without changing the expected destination, and the full serial suite passed.

**Migration:** Reviewed and applied additive migration `0009_auth_challenge_idempotency.sql` to production D1. Wrangler reports no pending migrations; remote schema inspection confirms the expected columns, unique constraints, cascading foreign key to `auth_challenges(id)`, and `idx_auth_challenge_requests_email_created`.

**Release:** Signup fix committed as `ccc5f88` (`Fix signup challenge delivery handoff`) and pushed to `origin/main`; deployed with `npm run deploy` to Worker `joblite-ahs`, version `c7796635-9473-4cb8-a044-8806cf344234`. The deployment retained the configured D1, R2, queue, asset, domain, cron, and production-variable bindings; no secrets were rotated. Production `/`, `/signup`, `/api/health`, and `/api/health/ready` returned HTTP 200. `/api/v1/auth/test-mail/latest` returned HTTP 404; production sets `ENVIRONMENT = "production"` and does not enable `TEST_MAIL_SINK`. A bounded post-deploy error-log sample contained no entries. No production verification email was sent. Live email delivery, code entry, and authenticated-session confirmation remain pending explicit authorization.

## Shared Joblite theme and passwordless account flow (2026-10-24)
- [x] Reused the homepage's Joblite AHS mark, blue/navy palette, Inter typography, spacing, and card treatment as shared global theme tokens and responsive navigation.
- [x] Replaced the token-based auth shortcut with six-digit email verification, HMAC-stored challenges, ten-minute expiry, single-use verification, attempt limits, request/resend throttles, session rotation, and honest delivery errors.
- [x] Added one reusable sign-in component for `/sign-in` and the mobile authentication sheet, with a desktop dialog, focus containment/restoration, safe return-path validation, and an explicit server-resolved “Continue to source” link after authentication.
- [x] Gated external “Apply at source” actions from Home, jobs search, and job details; external opens remain separate from application tracking.
- [x] Replaced Saved, Notifications, Settings, and Hiring placeholders with scoped API-backed views/actions. Application navigation appears only for authenticated users with real Joblite application records.
- [x] Kept the media viewer/feed mounted while authentication is displayed and fixed Worker asset fallback so extensionless SPA routes serve the actual index document with mutable response headers.
- [x] Added additive migration `0005_passwordless_auth.sql`, an isolated test-only email sink, auth/security unit tests, Playwright E2E setup, and local screenshot capture.

**Verification:** `npm run e2e` passed 1 Playwright journey (guest feed/job filtering, private API denial, application auth sheet/dismissal, new-account email-code verification through the local mail sink, server-resolved external destination, no external click recorded as a submitted application, real local image upload/post publishing, media-viewer Escape/scroll restoration, and all requested page routes at 390px and 1440px). The run captured screenshots under `artifacts/screenshots/` and used a temporary D1 directory; no production mail was sent. Unit verification is tracked separately below.

**Production email configuration:** configured the Resend credential as the server-side `RESEND_API_KEY` secret and `EMAIL_FROM` as the sender secret. The sender is `noreply@joblite.online`. A user-designated inbox confirmed receipt of a production sign-in code on 2026-10-26, although that challenge request returned HTTP 500 (`INTERNAL`). Delivery succeeded, but the challenge response/handoff was not verified; investigate the production Worker error before treating live signup as fully verified. The local E2E mail sink does not prove provider delivery.

**Migration/deploy status:** migration `0005_passwordless_auth.sql` was applied to isolated E2E D1 and production D1. Production deployment completed on 2026-10-24 as Worker version `40e64667-6573-4da8-95b1-0d1ed55847a3`; homepage, all listed SPA routes, and `/api/health/ready` returned HTTP 200 in live checks.

## Feed and provider integration verification (2026-10-24)
- [x] X-style Joblite guest feed with server-side job search, country/remote/source filters, truthful source/date/salary labels, saved jobs, external apply links, and real feed states
- [x] Route-backed multimedia composer with authenticated R2 upload flow, client/server type and size validation, progress, retry, and retained drafts on publish failure
- [x] Full-screen image/video viewer with attachment navigation, zoom, video controls, replies, persisted likes, sharing, Escape/Back/close handling, and focus/scroll restoration while Home remains mounted
- [x] Server-side provider adapters for Remote OK, Remotive, Arbeitnow, configured Greenhouse employer boards, and a configured Lever employer board; 30-minute scheduled refresh honors provider-specific minimum intervals
- [x] Additive D1 provenance/deduplication schema and paginated/searchable jobs API; authenticated local sync command
- [x] Wrangler dev/deploy scripts explicitly serve `dist/client` assets

**Sync evidence:** authenticated local sync ran against the development Worker and D1: 6 provider sources succeeded, 1 was skipped due to Remotive's six-hour interval, 0 failed; 13 jobs inserted and 472 existing records updated. Production D1 has migrations `0003` and `0004` applied. The first live jobs request showed 0 records; after authenticated sync, the live jobs API returned 109 imported jobs from Remote OK and Remotive, with a current successful sync timestamp. The sync POST client timed out waiting for its response, so its per-provider run summary was not captured.

**Empty-feed root cause:** the prior home page only fetched community posts and never requested the existing jobs API. The updated home feed now requests the paginated jobs endpoint and merges real job records with posts; provider sync populates/refreshed its stored catalog.

**Checks:** `npm run typecheck`, `npm run lint`, `npm test` (29 tests), `npm run build`, and `npm run e2e` (one Playwright journey) passed. Screenshots were captured for all requested routes at mobile and desktop sizes, plus auth email/code, application continuation, and the media viewer.

## Phase 0 — Foundation
- [x] Repository audit and structure created
- [x] Package configuration (package.json, tsconfig, vite.config)
- [x] Cloudflare Workers setup (wrangler.toml with D1, R2, Queues, Cron)
- [x] Environment examples (.env.example)
- [x] Health endpoints
- [x] Basic CI workflow
- [x] Documentation in place

**Evidence:** All config files created. Structure follows Cloudflare-native architecture.
**Remaining dependencies:** npm install, wrangler auth for deployment.

## Phase 1 — Identity and geography
- [x] Database schema with users, sessions, auth_challenges
- [x] Passwordless auth (challenges/verify/logout)
- [x] Session middleware
- [x] Countries table with full ISO 3166-1 seed (migrations 0001, 0002)
- [x] Organizations and memberships
- [x] Permission utilities (requireAuth, membership checks)
- [x] Countries API endpoints

**Evidence:** Auth flow implemented, all countries seeded, tenant isolation via memberships.
**Remaining dependencies:** Email delivery for production auth.

## Phase 2 — Profiles and native jobs
- [x] Profile schema and API (get/update)
- [x] Skills, education, experience tables
- [x] Native job composer API (create draft, publish)
- [x] Job search with filters (country, q, arrangement)
- [x] Job detail page with provenance
- [x] Save/unsave jobs
- [x] React UI for jobs search and detail
- [x] X-style layout (3-column desktop, bottom nav mobile)

**Evidence:** Full job posting and search flow implemented.
**Remaining dependencies:** Profile editor UI completion.

## Phase 3 — Applications and ATS
- [x] Applications schema with snapshots
- [x] Native application submission with immutable snapshot
- [x] Duplicate prevention
- [x] Candidate application tracker API
- [x] Employer pipeline API
- [x] Stage transitions with versioning and confirmation
- [x] Private notes table
- [x] Offers (issued/response separate from hired)
- [x] Application events for timeline

**Evidence:** Core ATS workflow implemented.
**Remaining dependencies:** Full UI for ATS pipeline, interview details.

## Phase 4 — Multimedia feed
- [x] Posts schema and API
- [x] Comments
- [x] Media upload intents with validation
- [x] R2 integration structure
- [x] Feed UI with composer
- [x] Post cards

**Evidence:** Feed and post creation implemented.
**Remaining dependencies:** Actual R2 uploads, Stream integration for video playback, media validation completion.

## Phase 5 — Global discovery
- [x] Sources table and registry structure
- [x] Board directory route (basic)
- [x] Imported job support in schema
- [x] External apply labeling
- [x] Manual mark-applied for external jobs

**Evidence:** Structure for sources and external jobs in place.
**Remaining dependencies:** Actual source adapters, permission validation, ingestion pipeline.

## Phase 6 — Alerts and assistance
- [x] Notifications table
- [x] Outbox table
- [x] Saved searches table
- [x] Queue configuration

**Evidence:** Infrastructure for alerts in place.
**Remaining dependencies:** Queue consumers, alert generation logic.

## Phase 7 — Hardening and launch
- [ ] Privacy operations (export/delete)
- [ ] Full moderation UI
- [ ] Accessibility audit
- [ ] Load testing
- [ ] Backup procedures
- [x] Production deployment

**Evidence:** Security measures implemented (auth, CSRF headers, validation).
**Remaining dependencies:** Full hardening checklist.

## Overall Status
**Core functionality implemented.** Working vertical slices for auth, jobs, applications, feed. All countries seeded. X-style UI implemented. ATS with human-controlled decisions. Media structure with quarantine. Source registry framework.

## Next Steps
1. Run `npm install`
2. Build with `npm run build`
3. Test locally with `npm run dev`
4. Apply migrations
