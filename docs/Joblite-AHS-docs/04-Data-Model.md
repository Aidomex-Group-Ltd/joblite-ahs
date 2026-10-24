# Logical Data Model
## Conventions
Use opaque IDs, UTC timestamps, explicit foreign keys, indexed access paths and version columns for contested writes. Validate enumerations at both API and storage boundaries. Store money as minor units with currency and period, never floating-point amounts. Store date-only deadlines separately from instants where appropriate.

| Entity | Key fields / relationships |
|---|---|
| users | id, email_normalized unique, verified_at, display_name, state |
| sessions | token_hash unique, user_id, expires_at, revoked_at |
| auth_challenges | token_hash, purpose, expiry, attempts, consumed_at |
| profiles | user_id unique, handle unique, headline, bio, country_code, visibility |
| skills / profile_skills | normalized label; profile_id + skill_id unique |
| education / experience | profile_id, dates, organization, role/qualification |
| profile_links / preferences | profile_id, validated URL; locations, availability |
| organizations | id, slug unique, name, verification_state |
| memberships | organization_id + user_id unique, role |
| countries | ISO code, display name, region |
| jobs | origin, organization/source, source_job_id, title, body, arrangement, status, published_at, discovered_at, checked_at, deadline, version |
| job_locations | job_id, country_code, city, optional region |
| job_eligibility | job_id, mode worldwide/countries/unknown, evidence |
| job_eligible_countries / job_skills | normalized join records |
| salary_ranges | job_id unique, min_minor, max_minor, currency, period |
| posts | author_id, optional organization_id/job_id, body, visibility, state |
| media | owner_id, object_key/provider_id, purpose, type, size, state |
| post_media | post_id, media_id, ordering, alt_text/caption |
| comments / follows | scoped target references, author, visibility/state |
| saved_jobs | user_id + job_id unique |
| applications | candidate_id + job_id unique, stage, version, submitted_at |
| application_snapshots | application_id unique, profile_json, job_json, CV media reference, schema_version |
| application_events | application_id, actor, old/new stage, candidate_visible, timestamp |
| employer_notes | application_id, author membership, private body |
| interviews | application_id, scheduled_at, timezone, status, details |
| offers | application_id, version, issued_at, expires_at, response, responded_at |
| external_application_trackers | user_id + job_id unique, self_reported_status, marked_at |
| sources | kind, base_url, permission_state, policy_url, reviewed_at, enabled |
| source_coverage | source_id + country_code, industry, import/link mode |
| source_runs / source_cursors | source_id, state, checkpoint, counts, errors |
| saved_searches / alerts | user_id, normalized filters, frequency, active |
| notifications | user_id, event_key unique per recipient, read_at |
| reports / moderation_actions | target, reporter, reason, resolution, actor |
| audit_events | actor, organization, action, target, redacted metadata |
| outbox / processed_events | unique event key, payload version, attempts, delivery state |

## Required constraints
Native jobs require an owning organization and in-app application mode. Imported jobs require a source, canonical URL and external application mode. Source/source_job_id is unique when present. A general post cannot create an application. A board directory entry has no invented job identifier.

Application snapshots are immutable after submission. Updating a profile cannot rewrite an earlier application. CV objects referenced by snapshots need retention rules; replacing a CV cannot silently replace a previously submitted file. Candidate contact details and CV references are excluded from public profile serializers.

## Index plan
Index published jobs by status/publication/id; source and source job ID; location country/job; eligibility country/job; applications by candidate/submission and job/stage; posts by state/creation/id; memberships by user/organization; due outbox rows by state/next_attempt. Verify performance with realistic data rather than adding speculative indexes.

## Deletion
Separate visibility removal from erasure. Document retention by data class; purge object bytes and derived records as required. Preserve only justified, minimized audit evidence. Never use soft delete as a claim that personal data was erased.
