# Global Coverage, Source Governance and Ingestion
## Country coverage
Seed the full maintained ISO 3166-1 country/territory list with searchable names. Provide a global option and optional region grouping. Country existence and listing coverage are separate: each country page displays imported-job count, native-job count, directory links and last source check. Do not seed fictitious boards to fill gaps.

## Source registry
Every source records official name, URL, API/feed method, permitted fields, attribution, caching/retention limits, redistribution conditions, rate limits, countries, industries, review date and disable reason. Permission states: pending_review, import_allowed, link_only, suspended. Only import_allowed sources run ingestion. Publicly reachable endpoints do not by themselves establish republication permission.

Employer ATS sources such as Greenhouse and Lever may be candidates for adapters, subject to current endpoint documentation and permission review. An employer/board discovery registry is required; an ATS endpoint is not a worldwide employer directory. Do not claim either adapter is approved until documented.

## Adapter contract
Each adapter implements discover/configure, fetchPage(cursor), normalize(record), canonicalUrl(record), checkAvailability(record) and health(). Use fixtures and schema validation. Preserve source IDs and country/eligibility evidence. Strip unsafe markup without changing meaning.

## Pipeline
Schedule → source permission check → bounded fetch with checkpoint → normalize → validate → deduplicate → upsert → update search fields → emit alerts → record run. Respect retry headers and source limits. Persist cursors so failures resume. Restrict request destinations to approved origins; block internal and metadata addresses and recheck redirects.

## Freshness and expiration
Store published_at, discovered_at, last_seen_at, checked_at and expires_at separately. Unknown publication dates remain null. Close explicit expired/removed jobs. For absence from feeds, require a complete successful reconciliation or configured grace policy before closing; failed or partial fetches must not mass-expire jobs. Initial policy default: daily source checks where permitted, flag stale after 7 days without successful confirmation; tune per source.

## Deduplication
First use source ID; then canonical employer application URL; then a normalized company/title/location fingerprint as a potential duplicate signal. Do not merge different locations or employment terms automatically on fuzzy similarity. Preserve multiple provenance references and avoid counting the same vacancy twice in alerts.

## Link-only behavior
Display official board name, country/region, industry and external link. Do not copy restricted descriptions, salaries, logos or counts. Label links as external directories; avoid suggesting Joblite verified every vacancy on the linked site.

## Acceptance
An unapproved adapter cannot fetch; a rate-limited source backs off; a schema change quarantines bad records; duplicate ingestion is idempotent; a partial run cannot expire all jobs; every imported job displays original source, application destination and freshness.
