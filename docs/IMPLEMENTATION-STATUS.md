# Implementation Status - Joblite AHS

Last updated: 2026-10-26

## ATS, feed typography, and support chatbot requirement checklist (2026-10-26)

Each row records the requirement, UI/API location, verification evidence, and remaining limitation or correction. UI = React route/component; API = Worker route; T = automated test; M = migration.

| Requirement | UI / API location | Verification | Remaining correction or limitation |
|---|---|---|---|
| Employer overview uses persisted active jobs, applications, screening, interviews, and offers | UI `/hiring`; API `GET /organizations/:id/overview` | `tests/ats.test.ts` persisted-metrics test | Live authenticated employer view requires an authorized test account |
| Authorized job creation, editing, publishing, closing, and archiving | UI `/hiring`; API `/jobs`, `/jobs/:id`, `/jobs/:id/publish`, `/jobs/:id/status`, `/jobs/:id/close`, `/jobs/:id/archive` | `tests/ats.test.ts` job lifecycle, role, optimistic-version, and archive tests | None in the implemented lifecycle |
| Search/filter/pagination and a stage-grouped pipeline board | UI `/hiring`; API `GET /organizations/:id/applications` | API filters/pagination in `tests/ats.test.ts`; board groups current filtered page and pagination controls | Board is keyboard-accessible, not drag-and-drop; it represents the current page |
| Applied, Screening, Shortlisted, Interview, Offer, Hired, Rejected, Withdrawn, Closed | UI stage labels in `src/client/lib/format.ts`; API stage values in `applications.stage` | `tests/ats.test.ts` valid/invalid transition tests | Internal values `submitted` and `in_review` display as Applied and Screening |
| Explicit, version-checked stage transitions with keyboard controls | UI `/applications/:id`; API `POST /applications/:id/transitions` and `/applications/bulk` | `tests/ats.test.ts` invalid, stale-version, terminal, offer-backtracking, and partial bulk cases | No drag-and-drop interaction is provided |
| Immutable submission snapshots, submitted answers/CVs, history, and protected CV downloads | UI `/applications/:id`, `/jobs/:id`; API application and media routes; M 0010/0012 | `tests/ats.test.ts` answer/snapshot, CV access, replacement, and deletion-preservation cases | Snapshot CV is retained while any application references it; no hard-delete operation is offered |
| Private notes, scorecards, reviewer assignment, and audit records | UI `/applications/:id`; API notes/reviewers/scorecards | `tests/ats.test.ts` candidate exclusion, cross-organization assignment, and assigned-reviewer cases | No candidate-visible note or scorecard fields |
| Timezone-aware interview scheduling, invitations, responses, and calendar files | UI `/applications/:id`; API interview create/respond/cancel and `GET .../calendar.ics` | `tests/ats.test.ts` IANA timezone, response authorization, duplicate response, and calendar cases | Notifications are in-app/outbox; no email invitation was sent or enabled by this review |
| Offer drafting, issue, candidate accept/decline, and separate explicit hire | UI `/applications/:id`; API offers and `POST /applications/:id/hire` | `tests/ats.test.ts` full workflow, offer/hire separation, safe backtracking, and single stage-history event | Offer notices are in-app; no real offer email was sent |
| Bulk actions authorize each item, require terminal-action confirmation, and report partial failures | UI `/hiring`; API `POST /applications/bulk` | `tests/ats.test.ts` per-item authorization and partial-result test | None known |
| Candidate applications, snapshot details, current status, next steps, interviews/offers, confirmed withdrawal | UI `/applications`, `/applications/:id`; API `/me/applications`, `/applications/:id`, withdrawal/interview/offer routes | `tests/ats.test.ts` candidate workflow and private-data exclusion | Live authenticated candidate browser check requires an authorized test account |
| Candidate responses exclude private notes, reviewer scores/assignments, and internal event metadata | API `GET /applications/:id` | `tests/ats.test.ts` asserts confidential fields absent from serialized candidate payload | None known |
| Candidate/organization isolation, CSRF, validated fields, concurrency, duplicate submission, and atomic writes | ATS routes, session middleware, D1 batches, M 0010/0012 | `npm run typecheck`, `npm run lint`, `npm test` (79 tests), and full Playwright suite (8 tests) passed; production health endpoints returned HTTP 200 | Live authenticated candidate/employer workflows require authorized test accounts |
| Native and imported jobs remain distinct; imported applications are not represented as submitted Joblite applications | UI job provenance/application method; API `POST /applications` | `tests/jobs-api.test.ts`, `tests/ingestion.test.ts`, and ATS native-only submission test | None known |
| Reports derive from persisted events with UTC filters, repeat-stage/missing/out-of-order handling, and documented definitions | UI `/hiring`; API `GET /organizations/:id/reports` | `tests/ats.test.ts` report authorization and edge-case tests | Empty samples display as unavailable rather than zero |
| CSV exports are authorized, omit private review data, and neutralize spreadsheet formulas | UI `/hiring`; API `GET /organizations/:id/applications/export.csv` | `tests/ats.test.ts` export-role/formula/private-field cases | Export capped at 5,000 records |
| Feed body/comments/job previews are 1rem; metadata remains readable; inputs, wrapping, contrast, and mobile zoom are accessible | UI feed/job detail; `index.css`, `JobliteHome.css`, `FeedReadability.css` | Playwright computed-style, contrast, URL-wrap, mobile, and 200%-zoom checks in `e2e/feed-media.spec.ts`; production health endpoints returned HTTP 200 | Live visual/computed-style checks were not run against production |
| Support chatbot uses the configured DeepSeek API credentials with a support-only, no-tools prompt | Global UI widget; `POST /api/v1/support/chat`; M 0011; Worker-side `DEEPSEEK_API_KEY` and `DEEPSEEK_MODEL_ID` secrets | `tests/support-chat.test.ts`, `e2e/support-chat.spec.ts`; production request reached DeepSeek, which returned HTTP 402 | Provider account/payment status must be resolved before live chat can answer |
| Migration/recovery readiness | `wrangler.toml`; M 0010–0012 | Additive SQL reviewed; pre-migration Time Travel bookmark `0000025b-00000002-00005110-0a2d63952ee1ee4db9cfb4b56c45d41d` recorded at `2026-10-26T15:22:05Z`; Wrangler captured its migration backup; remote list confirms no pending migrations | Restore procedure was not exercised |

**ATS release (2026-10-26):** Production D1 migrations `0010_ats_workflows.sql`, `0011_support_chat_rate_limits.sql`, and `0012_ats_job_applications.sql` applied. Worker version `558b111a-8e68-4404-930c-98105b0b2270` deployed to `joblite.online`; `/`, `/api/health`, and `/api/health/ready` returned HTTP 200.

## Mobile authentication and DeepSeek support follow-up (2026-10-26)
- [x] Kept public job discovery available while verifying ATS application and organization endpoints remain authentication-protected.
- [x] Changed the session cookie to `SameSite=Lax` and delayed sign-in routing until the existing-session probe completes; focused the mobile sign-in sheet on the email field.
- [x] Replaced Workers AI inference with a server-side DeepSeek chat-completions request using the configured Worker secrets; provider errors and chat responses are not cached or exposed to the browser.

**Verification:** `npm run typecheck`, `npm run lint`, `npm test` (81 tests), and the targeted mobile-auth/support-chat Playwright suites passed. Mobile email-code verification established a session and returned HTTP 200 from `/api/v1/me`. No production verification email was sent; production `/api/v1/me` without a session returned the expected HTTP 401. After deployment, `/`, `/api/health`, and `/api/health/ready` returned HTTP 200. The anonymous production chat reached DeepSeek, which returned HTTP 402; the Worker correctly returned a generic HTTP 503. The configured secret names were confirmed without reading their values.

**Release:** Worker version `6a1a7beb-bdb0-4faf-80f2-898e9b549b92` deployed to `joblite.online`. Live chat remains unavailable until the DeepSeek account-side 402 response is resolved.

## Signup challenge handoff follow-up (2026-10-26)
- [x] Reduced signup account creation to the required Terms of Service / Privacy Policy acknowledgment; age and marketing controls are no longer separate required signup checkboxes.
- [x] Persisted hashed-code challenges before contacting Resend, added email-scoped HMAC idempotency records, and made duplicate retries return the same usable challenge without sending another message.
- [x] Reported provider acceptance separately from unknown delivery outcomes; timeouts/network failures and post-acceptance D1 update failures return recoverable challenge metadata without automatic resend.
- [x] Added redacted request/phase diagnostics, browser retry/refresh recovery, and mocked Resend/idempotency/session regressions.

**Historical incident evidence:** The original production challenge request returned HTTP 500 after the designated inbox received its email, but the historical Worker event/request ID is unavailable. The previous challenge handler had no post-provider D1 state update, so the exact operation that threw cannot be confirmed from retained evidence. The incident's root cause therefore remains unconfirmed; the changes above address response-stage and retry ambiguity without claiming to identify the original exception. No production verification email was sent during this follow-up.

**Verification:** `npm run typecheck`, `npm run lint`, `npm test` (55 tests), `npm run e2e -- --workers=1` (6 tests), `npm run build`, and `git diff --check` passed. A first E2E run hit the default 15-second URL assertion timeout after the onboarding update returned HTTP 200 in 16.2 seconds; the assertion timeout was raised to 45 seconds without changing the expected destination, and the full serial suite passed.

**Migration:** Reviewed and applied additive migration `0009_auth_challenge_idempotency.sql` to production D1. Wrangler reports no pending migrations; remote schema inspection confirms the expected columns, unique constraints, cascading foreign key to `auth_challenges(id)`, and `idx_auth_challenge_requests_email_created`.

**Release:** Signup fix committed as `ccc5f88` (`Fix signup challenge delivery handoff`) and pushed to `origin/main`. Initial source deployment used Worker version `c7796635-9473-4cb8-a044-8806cf344234`; subsequent secret changes created newer versions, with `ad94568a-da21-4914-86df-33b1989e9368` shown as the latest active version. The source was not redeployed because it was unchanged. The configured Worker name is `joblite-ahs`, and `wrangler.toml` routes the `joblite.online` custom domain to it.

**Email configuration follow-up (2026-10-26):** The observed production provider rejection was HTTP 400, reason `provider_rejected`, detail `sender_domain_unverified`, sender domain `joblite.online`. This is separate from the earlier HTTP 500 whose root cause remains unconfirmed. The user reports that Resend marks the supplied DKIM/sending records verified and that the published DNS matches; `EMAIL_API_KEY` and `EMAIL_FROM` were uploaded to `joblite-ahs`. Wrangler confirms those secret names exist (along with the legacy `RESEND_API_KEY`); secret values were not read or recorded. The Worker code calls `https://api.resend.com/emails` and selects `EMAIL_API_KEY` before `RESEND_API_KEY`. No email was sent after this configuration change, so whether the provider rejection is resolved and whether the effective key is authorized for the Resend domain remain unverified. No DNS changes or source redeployment were made.

**Production checks:** Migration 0009 remains applied with no pending migrations. Production `/`, `/signup`, `/api/health`, and `/api/health/ready` returned HTTP 200; `/api/v1/auth/test-mail/latest` returned HTTP 404. Production sets `ENVIRONMENT = "production"` and does not enable `TEST_MAIL_SINK`. A bounded Worker tail captured alongside these checks contained no matching auth/error diagnostic events.

**Live signup status:** No explicitly authorized test inbox address was present in the available session history, so no signup request or verification email was initiated. Full live verification remains pending: in a browser, open `https://joblite.online/signup`, enter a name and the user-designated test inbox, accept the Terms/Privacy checkbox, and click **Create account** once. Confirm the verification screen and inbox receipt; enter that fresh code and submit **Verify and continue**, then confirm onboarding and that `/api/v1/me` returns the authenticated user. Do not repeat the request or resend unless the UI cooldown permits and the delivery outcome is understood.

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
