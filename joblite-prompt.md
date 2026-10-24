# Master OpenCode Implementation Prompt
Copy the following instruction into OpenCode with this documentation directory in the repository.

---

You are implementing **Joblite AHS — Joblite Autonomous Hiring System**. Read every document in docs/Joblite-AHS-docs/ (or the supplied equivalent path) before changing code. Treat 01-PRD.md as product scope and 13-Decisions-Risks.md as the decision log. Inspect the existing repository and AGENTS.md instructions, preserve unrelated changes, and reuse working code where appropriate.

Build the functioning product, not a static mockup or a plan. Use TypeScript, React and Cloudflare Workers-native APIs with D1, R2, Queues, Cron and Cloudflare Stream for video. Use optional Durable Objects only with a concrete need. Do not scaffold Phoenix/LiveView or require application compute on another host.

Implement the X-style desktop three-column and mobile single-feed interface with top composer and mobile bottom navigation. Provide persistent text/image/video posts and a separate structured job composer. Support searchable candidate skills, education, experience, links, availability and private CVs with profile visibility controls.

Provide organization-owned job posting and management, global job search from primary navigation, all ISO countries/territories selectable, location and eligibility as separate concepts, guest browsing, saved jobs and honest empty states. Native jobs apply inside Joblite. Imported jobs apply at source and can only be manually marked applied. External board links remain visibly separate from vacancies.

Implement an authorized, tenant-isolated ATS with immutable submitted profile/job snapshots, candidate timeline, employer pipeline/list, private notes, interview details, versioned offers and candidate acceptance. Issued offers are not accepted offers; accepted offers are not automatically hired. Humans explicitly control shortlist/rejection/offer decisions.

Build a permission-governed source registry and ingestion framework with idempotency, deduplication, checkpoints, freshness, expiration protection, attribution and link-only fallback. Add real sources only after current permission/endpoint validation. Never scrape restricted sources or invent worldwide coverage.

Implement secure authentication, server-side ownership/membership checks, upload validation/quarantine, private document access, CSRF/XSS/SSRF protections, moderation, audit trails and privacy operations. Never persist browser blob URLs as media. Stream videos require actual successful processing and playback. If credentials or paid services are unavailable, make that dependency explicit and the feature safely disabled; do not fake success.

Follow phases in 10-Implementation-Plan.md. For each phase, implement a vertical slice, run relevant checks, update docs/IMPLEMENTATION-STATUS.md with evidence and remaining dependencies, then continue. Use atomic commits if repository policy allows; do not push or deploy production unless authorized in the active session.

Supply migrations, country seeds, clearly labelled demo fixtures, .env.example without secrets, Worker environment/binding configuration, CI, targeted tests, setup/deploy/rollback commands and operational runbooks. Validate against 09-Testing-Acceptance.md. Record exact commands and failures honestly.

Autonomous assistance covers imports, matching explanations, alerts and reminders. Do not automatically apply, reject, issue offers or accept offers. Keep all first-party application compute on Cloudflare; flag service constraints rather than quietly changing the architecture.

Finish with working-state summary, verification results, setup commands, remaining configuration and known limitations. Do not declare completion while required UI actions are placeholders or agreed workflows fail.
