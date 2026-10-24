# Paste this into OpenCode and attach the mockup

Work in ~/workspaces/joblite. Integrate the attached Joblite UI source kit into the actual application and closely match the supplied mobile mockup. Implement, verify, and deploy the changes rather than stopping at a plan.

Read AGENTS.md, README, docs/Joblite-AHS-docs/, implementation status, package scripts, API handlers, auth middleware, frontend routing, migrations and Wrangler configuration first. Preserve unrelated working changes and the Cloudflare Workers/Hono/D1/R2/Queues/React/Vite architecture.

The kit contains JobliteHome.tsx and JobliteHome.css. Use it as a typed visual foundation, adapting it to the repository instead of overwriting the app or inventing a parallel backend. Its callback props are integration contracts, not implemented API services. Scope all styles to the Joblite UI so other pages are not accidentally restyled.

VISUAL MATCH
- Compact white header, blue Joblite mark, notification action and user avatar.
- Discover and Following tabs with blue active underline.
- Opportunity composer, image/video buttons, Post/Job selector and publish action.
- Search field and country, Remote and Eligible for me filters.
- Real application summary for signed-in candidates.
- Mixed feed with native/imported job labels, company identity, dates, locations, skill chips, real salary when supplied, summaries and Apply/Save/Share actions.
- Professional posts with real author data, images or video with playback controls and actual engagement counts.
- Mobile bottom navigation: Home, Jobs, Applications, Saved, Profile.
- White/light-slate palette, navy text, blue actions, soft blue surfaces, restrained borders, consistent rounded cards.
- Preserve readable 16px body/form text; metadata may be smaller. Do not put a phone frame or simulated status bar in the real UI.
- Keep the layout usable at 360px, 390px, tablet and desktop widths. Provide appropriate desktop columns and mobile safe-area padding.

REAL DATA ADAPTER
- Inspect API response shapes and map them to FeedItem, User, Board and applications props. Never assume the example UI types equal existing API schemas.
- Preserve API pagination and fetch additional pages intentionally; prevent duplicate records.
- Debounce search, cancel outdated requests and avoid out-of-order results.
- Separate loading, errors and truly empty results. Never convert API or database failures into an empty feed.
- Do not fabricate accounts, company logos, jobs, salary, notifications or engagement counts to reproduce the mockup.
- Use authenticated state from a shared session layer. Treat a /me 401 as signed out; do not call private applications/saved APIs until authenticated.

GUEST EXPERIENCE
- Allow immediate browsing, search, public job details, board directory, public sharing and verified external application links.
- Ask for sign-in only for protected actions: posting, saving, following, native applications, private profile and private notifications.
- Carry the intended path and safe draft through sign-in, without automatically applying or publishing afterward. Never place session tokens or private draft contents in URL parameters.
- Provide a public discovery strip instead of a private applications summary for guests.
- Following and personalised eligibility should explain or request the required sign-in/profile information.

WIRE EVERY ACTION
- onNavigate: map paths to the actual router. The kit's Home navigation is active only because this component represents the home page; other pages must calculate active state from the current route.
- onApply: native jobs open the documented application flow after auth. Imported jobs open only validated http/https canonical application destinations.
- onToggleSave and likes: persist with the real API, include required session/CSRF credentials, update state only after success or roll back optimistic changes. Catch failures and show actionable feedback.
- onPublish: real post creation. Preserve drafts on failed requests; clear only after confirmed success. Job mode opens the real structured job form.
- onAddMedia: accessible file picker, upload progress, accepted-type and size guidance, cancel/remove controls, secure existing R2 upload flow and server validation. Extend the component props for attachments as needed; its initial callback only exposes the user intent.
- onShare: Web Share API with clipboard fallback using the real public canonical URL. Handle user cancellation quietly.
- onItemMenu: implement actual supported menu options with accessibility and ownership checks; do not leave an inert menu.
- onPostAction: real comments view and like/unlike operations.
- onNotifications: real private notifications. Show unread badges only from actual counts.
- onEligibility: genuine documented profile-based filtering, respecting missing-profile states.
- All visible controls need functional outcomes. Never remove authorisation checks to make an action appear successful.

MEDIA
Fetch appropriate licensed images/video from Unsplash, Pexels or Pixabay via supported methods. Inspect source licences, preserve required credits and create an image/video source manifest. Keep API keys server-side. Use stock media only in clearly labelled editorial/demo areas; never attach it to an actual user's post or imply endorsement. Keep demo fixtures isolated from production data. Use responsive images, lazy loading, video poster frames, playback controls, playsinline and captions where available. No autoplay audio. Use initials fallbacks for missing identity images.

JOB BOARDS AND 30-MINUTE UPDATES
- Replace hardcoded empty board handlers with the documented, database-backed source registry.
- Populate verified board links and permitted API/RSS integrations. A directory link is not evidence of a working imported-job feed.
- Refresh permitted sources server-side every 30 minutes using Cloudflare scheduled events and existing queue infrastructure.
- Preserve unrelated five-minute scheduled tasks; avoid duplicate dispatch where schedules overlap.
- Use bounded work, deduplication, idempotent upserts, expiry handling, rate limits, controlled retries and overlap protection.
- Store last attempt, last success and actual error states; preserve good data on temporary failures.
- Display truthful source freshness and revalidate the directory in the client, including on focus. Do not expose unlimited unauthenticated ingestion triggers.
- Sources needing unavailable credentials must show honest configuration status. Do not bypass source restrictions or invent refresh timestamps.

PRODUCTION SAFETY AND VERIFICATION
- Preserve the production D1 UUID, bucket and queue bindings, existing records and secrets.
- Use reviewed additive migrations only where needed. Do not reset databases or delete .wrangler/state.
- Use same-origin /api requests; no hardcoded production localhost.
- Preserve CSRF, session, ownership, tenant and private-CV protections. Validate external URLs and sanitise imported content.
- Frontend deep links must reload correctly; unknown /api endpoints return JSON 404 rather than SPA HTML.
- Run type checking, production build and meaningful tests of guest discovery, auth boundaries, filters, save/apply, publishing, media and ingestion deduplication.
- Inspect the actual rendered interface at mobile and desktop sizes and fix overflow, obstructed controls and console errors.
- Deploy through the existing Cloudflare workflow once checks pass. Verify health and public pages at https://joblite-ahs.aidomexgroupltd.workers.dev/.

Finish with changed files, working flows, actual test results, refresh scheduling evidence, the live URL and any specific missing credentials or remaining limitations. Do not claim complete implementation based only on a successful frontend build.
