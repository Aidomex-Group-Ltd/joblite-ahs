# Decisions, Defaults and Risks
## Confirmed decisions
| Decision | Result |
|---|---|
| Product name | Joblite AHS; replaces Erikot |
| Hosting/compute | Cloudflare-native first-party compute |
| Earlier Phoenix proposal | Replaced by TypeScript/React/Workers |
| Coverage | Every country selectable from launch |
| Source access | Permitted import; otherwise official external board link |
| UX | X-style feed with text, images and videos |
| Marketplace | Candidates and employers; direct posting and in-app ATS |
| Candidate profile | Skills, education, experience, links, CV, preferences |
| Hiring autonomy | Assistance with human-controlled decisions |

## Proposed implementation defaults
React/Vite, Hono-style router, verified-email sign-in, D1, R2, Stream, Queues, English-first interface, ISO country/territory coverage, rules-based matching and in-app notifications. These are reasonable build defaults, not previously approved vendor purchases. Candidate job search remains global, without narrowing launch to a few countries.

## Configuration to resolve during implementation
Existing repository and domain; Cloudflare account/plan; approved budget and service limits; outbound email method; initial source permissions; moderation owners; retention requirements; employer verification procedure; brand assets and final colors; supported interface languages. None blocks building local interfaces and deterministic workflows; production integrations must remain explicit.

## Risks and responses
| Risk | Response |
|---|---|
| No live listings for a country | Show true coverage, directory links and alerts |
| Source permission changes | Registry review dates and immediate disable switch |
| Database throughput/capacity | Indexed bounded queries, load checks, measured scaling |
| Video/storage costs | Stream budget, per-user quotas and duration limits |
| Recruitment scams | Reporting, moderation, provenance and cautious verification labels |
| Eligibility ambiguity | Explicit unknown state and evidence |
| Tenant data leakage | Central authorization, private serializers and denial tests |
| Async duplicate delivery | Unique keys, outbox and idempotent consumers |
| AI bias/overreach | Deterministic baseline, explanations and human decisions |
| Authentication delivery unavailable | Configure verified provider; no production bypass |

## Change control
Keep a dated decision record for changes to scope, auth, database layout, source policy or hiring automation. Update affected requirements, API contracts and acceptance tests together. This pack describes design intent as of 24 October 2026; implementation must verify current service behavior.
