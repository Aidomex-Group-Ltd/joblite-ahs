# Product Requirements Document
## Problem and outcome
Candidates struggle to locate fresh jobs they can actually apply for from their country. Employers need a simple way to publish vacancies and manage applicants. Joblite combines regional discovery, professional profiles, social distribution and a transparent hiring workflow.

## Users and permissions
Guests browse public posts, jobs, company pages and board directories without signing up. Candidates manage their own profile, CV, saved jobs and applications. Employer members operate only within their organization. Organization owners manage memberships. Moderators handle reports; platform administrators manage approved integrations. One account can be both candidate and employer.

## Mandatory requirements
| ID | Requirement | Release |
|---|---|---|
| P01 | Every ISO 3166-1 country/territory selectable; searchable selector and global option | Core |
| P02 | X-style responsive feed with text, image and video posts | Core |
| P03 | Skills, education, experience, links, CV, availability and location preferences | Core |
| P04 | Structured native job composer and company profile | Core |
| P05 | Search from primary navigation with location and eligibility filters | Core |
| P06 | Native applications, profile snapshot and candidate/employer ATS | Core |
| P07 | Permitted imports and separately labelled external board directory | Core |
| P08 | Saved jobs, in-app alerts, reminders and notification preferences | Core |
| P09 | Privacy settings, reporting, moderation and audit events | Core |
| P10 | Human-controlled hiring decisions and visible automation provenance | Core |

## Job fields and discovery
Require title, organization, description, employment type, workplace arrangement and application method. Support multiple workplace locations, explicit eligible countries, timezone overlap, work authorization, skills, seniority, deadline and salary range with currency and period. Salary may be undisclosed; do not invent a range. Date filters use source publication dates when known.

Keep remote/hybrid/on-site separate from applicant eligibility. Eligibility is worldwide, specified countries/regions, or unknown. Unknown must remain visible as unknown and must never satisfy a strict eligible-only filter.

## Candidate journey
Browse anonymously → filter jobs → inspect source and eligibility → sign in → complete or choose profile/CV → review application snapshot → submit → track progress. External application clicks never automatically mean submission; the candidate explicitly marks an external job applied.

## Employer journey
Create organization → invite members → draft and publish vacancy → review incoming applications → shortlist or move stages → schedule interview details → issue offer → record candidate response → close job. Employer notes are private.

## Scope boundaries
No unauthorized scraping, fake global coverage, automatic applications, automated rejection, payroll, background checks or automatic job-offer acceptance. Payments, private messaging, semantic ranking, subscriptions and advanced interview scheduling are later extensions.

## Success measures
Measure search-to-job-detail rate, source apply clicks, completed native applications, employer response time, stale-listing rate, duplicate rate and country coverage by source type. External clicks are not completed applications. Establish baselines in beta before setting business targets.

## Release acceptance
All P01–P10 work end to end; no dead controls; an unauthorized organization member cannot access applications; private CVs are inaccessible publicly; imports preserve attribution; retries do not duplicate applications or notifications; all production integrations are explicitly configured or honestly disabled.
