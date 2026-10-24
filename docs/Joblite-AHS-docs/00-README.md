# Joblite AHS — Design and Development Pack
Joblite Autonomous Hiring System • Version 1.0 • 24 October 2026

## Agreed direction
Build a global jobs marketplace with an X-style multimedia feed, candidate profiles, employer posting and a visible applicant tracking system. Use TypeScript and React with Cloudflare-native application compute. This replaces the earlier Erikot name and Phoenix/LiveView proposal.

Every country must be selectable from the first release. Coverage means honest source availability, not a promise of imported vacancies in every country. Import only permitted content; otherwise provide clearly labelled external job-board links.

## Reading order
1. [Product requirements](01-PRD.md)
2. [UX and design specification](02-UX-Design.md)
3. [Architecture and decisions](03-Architecture.md)
4. [Data model](04-Data-Model.md)
5. [API contracts](05-API-Contracts.md)
6. [Global sources and ingestion](06-Global-Sources.md)
7. [ATS and automation](07-ATS-Automation.md)
8. [Security, privacy and moderation](08-Security-Privacy.md)
9. [Testing and acceptance](09-Testing-Acceptance.md)
10. [Phased backlog](10-Implementation-Plan.md)
11. [Deployment and operations](11-Deployment-Operations.md)
12. [OpenCode implementation prompt](12-OpenCode-Prompt.md)
13. [Decisions and unresolved configuration](13-Decisions-Risks.md)
14. [Technical references](14-References.md)

## How to use
Copy this directory into the repository as docs/. Give OpenCode document 12 and require it to read the entire pack before editing. These are implementation specifications, not a claim that an application or integration is already deployed. Defaults below can be changed explicitly; product requirements remain the source of truth.

## Definitions
Native job: an employer vacancy posted on Joblite with in-app applications.
Imported job: a permitted third-party vacancy with application at its source.
Board directory entry: an external platform link, never a simulated vacancy.
General post: social content which does not enter job search or ATS.
Automation: explainable assistance, with hiring decisions made by people.
