# Security, Privacy, Accessibility and Moderation
## Authentication and authorization
Default to verified-email passwordless authentication with short-lived single-use hashed challenges and secure HttpOnly SameSite cookies. Confirm outbound email capability before enabling production sign-in. Development-only test login must be impossible in production. Rate-limit challenge creation and verification; use generic responses to prevent account enumeration.

Enforce candidate ownership and organization membership server-side on every resource. Use least-privilege roles (owner, admin, recruiter, viewer) with a written permission matrix. Require stronger reauthentication/MFA for privileged administration where supported. Revoke sessions on logout/security changes; never rely solely on frontend route guards.

## Data visibility
Profile visibility: public, signed-in employers, private. Contact information and CVs are private by default. Applying explicitly shares the submitted snapshot and CV with that hiring organization. Private objects use authenticated download or short-lived scoped access. Log download authorization without logging document contents.

## Upload controls
Proposed configurable defaults: images 10 MB each, PDF CV 10 MB, video 120 seconds; validate actual platform constraints during implementation. Enforce counts, MIME, extension and content signatures; generate opaque storage keys; reject active content and path traversal. Quarantine until checks complete. If safe document scanning is not available within approved compute, keep risky uploads disabled rather than declaring them scanned.

## Browser/API protections
Escape text and sanitize rich content; parameterize SQL; validate URLs; restrict CORS to approved origins. Apply CSRF defense, CSP and secure headers. Prevent SSRF in imports, signed-URL leakage and unrestricted redirects. Do not cache account/application responses in shared CDN caches. Redact secrets, tokens, emails and CV contents from logs.

## Moderation and trust
Report jobs, posts, media, comments and profiles. Review queue supports hide, restore, remove, suspend and appeal with audit history. Distinguish employer verification from job authenticity; verification cannot guarantee a vacancy is safe. Explain application fees or suspicious requests through reporting controls; never imply automated fraud screening is infallible.

## Privacy operations
Provide export, correction and deletion requests, consent/version records and retention configuration. Proposed starting defaults: raw source payloads 7 days, operational logs 30 days, inactive application records 12 months; these are product defaults requiring jurisdiction-specific review before launch. No claim of legal compliance is made by this pack. Track object deletion and downstream copies; employer retention duties need a documented policy.

## Accessible operation
Keyboard paths for composer, upload, filter, application and ATS stage changes; labelled fields; error summaries; screen-reader status updates; sufficient contrast; captions support. Test focus after dialogs and failed requests. All drag interactions have button/menu alternatives.
