# Global Coverage, Source Governance and Ingestion
## Country coverage
Seed the full maintained ISO 3166-1 country/territory list with searchable names. Provide a global option and optional region grouping. Country existence and listing coverage are separate: each country page displays imported-job count, native-job count, directory links and last source check. Do not seed fictitious boards to fill gaps.

## Source registry
Every source records official name, URL, API/feed method, permitted fields, attribution, caching/retention limits, redistribution conditions, rate limits, countries, industries, review date and disable reason. Permission states: pending_review, import_allowed, link_only, suspended. Only import_allowed sources run ingestion. Publicly reachable endpoints do not by themselves establish republication permission.

### Configured providers and conditions
The additive `0004_real_job_ingestion.sql` migration enables the following specific sources; it does not imply a global search API:

| Provider | Configured scope | Access and display conditions |
| --- | --- | --- |
| Remote OK | Its published remote jobs feed | Public JSON/RSS feed; credit Remote OK and link every listing to its original post. |
| Remotive | Its active remote jobs feed | Public API; mention Remotive and link to each Remotive listing. Refresh no more than four times per day (configured six-hour minimum); API jobs are delayed by 24 hours. |
| Arbeitnow | Public API jobs (Europe-focused feed) | Public API requires a link back to Arbeitnow; permission may be revoked. Preserve provider destination and regional/location restrictions. |
| Greenhouse | Explicit Vercel, Figma, and Discord board tokens | Public GET access to the Job Board API; restricted to configured employer boards, with a link to each posting. |
| Lever | Explicit Spotify board token | The Postings API exposes published postings for a company; this configured board is not global search. |

Review provider terms and configured boards periodically. Disable a source if permission is withdrawn or terms change. Official references: [Remote OK API FAQ](https://remoteok.com/faq), [Remotive API documentation](https://github.com/remotive-com/remote-jobs-api/blob/main/README.md), [Arbeitnow API terms](https://www.arbeitnow.com/terms), [Greenhouse Job Board API](https://docs.greenhouse.io/job-board), and [Lever Postings API](https://github.com/lever/postings-api).

An ATS endpoint is not a worldwide employer directory. Only explicitly configured board tokens are queried; no employer discovery or global search is assumed.

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
