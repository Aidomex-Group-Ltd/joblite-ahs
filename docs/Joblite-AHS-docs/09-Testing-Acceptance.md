# Verification and Release Acceptance
## Test strategy
Use unit tests for eligibility, normalization, permissions and stage rules; Worker/D1 integration tests for real persistence and atomicity; adapter contract tests using sanitized fixtures; browser E2E for candidate/employer journeys. Do not substitute static screenshots for functioning workflows.

| Test ID | Requirement | Evidence |
|---|---|---|
| T01 | P01/P07 | Every seeded country resolves; empty country shows honest directory/coverage |
| T02 | P02 | Publish text/image/video; reload from a new session; media remains available |
| T03 | P03/P09 | Public profile serialization omits CV/contact; unauthorized download fails |
| T04 | P04 | Employer creates/edits/publishes/closes job; invalid fields rejected |
| T05 | P05 | Remote-US job excluded from strict Uganda eligibility results; unknown labelled |
| T06 | P06 | Submit snapshot, edit profile, verify old application unchanged |
| T07 | P06 | Concurrent duplicate submit yields one application; retry returns same result |
| T08 | P06/P09 | Different organization cannot read or change application or private notes |
| T09 | P06/P10 | Offer issued ≠ accepted; only candidate responds; hired requires human action |
| T10 | P07 | Source retry deduplicates; failed partial run does not mass-expire |
| T11 | P08 | Alert retry yields one notification; disabled alerts stay disabled |
| T12 | P02/P09 | Upload failure/retry, invalid type, oversize and unauthorized attachment rejected |
| T13 | P09 | CSRF, XSS, SSRF, session expiry and optimistic conflict cases verified |
| T14 | P02/P05/P06 | Keyboard and mobile journeys complete; accessible pipeline alternative |
| T15 | P10 | System actions labelled; no code path automatically rejects/issues offers |

## Performance and resilience
Seed realistic job/feed/application volumes. Measure p50/p95 API latency, query reads and Worker CPU against a documented expected beta load. Proposed target: p95 public list API under 1 second at that load, excluding client network; revise from measured evidence. Test queue re-delivery, dead-letter replay, expired upload intents, webhook duplication and unavailable source APIs.

## Release gates
Typecheck, lint, targeted tests, production build and staging E2E pass. Verify migration from a clean database and prior schema. Restore a backup into staging. Confirm secrets excluded, auth delivery works, private caches disabled, video processing verified, budgets configured and accessibility issues triaged. Record exact commands, results and remaining limitations in release evidence.

## Definition of done
Each feature has functioning UI/API/storage, authorization, loading/error/empty states, appropriate tests and updated docs. No fake success responses, placeholder source coverage, local blob URLs as persisted media or unconfigured production services presented as operational.
