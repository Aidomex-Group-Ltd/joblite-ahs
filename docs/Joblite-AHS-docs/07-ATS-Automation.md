# Applicant Tracking and Human-Controlled Automation
## Application stages
submitted → in_review → shortlisted → interview → offer → hired.
Terminal alternatives: rejected, withdrawn, closed. Closed means the process ended without a declared hiring outcome; it is not a synonym for rejected. Employers may move backward between active review stages with a recorded reason. Terminal applications do not silently reopen; an explicit audited reopen policy is required.

| Action | Authorized actor | Required condition |
|---|---|---|
| Submit | Candidate | Native open job; no prior application |
| Review/shortlist/interview | Organization hiring member | Same organization; current version |
| Reject | Organization hiring member | Human action with confirmation |
| Withdraw | Candidate | Own active application |
| Issue offer | Authorized organization member | Explicit terms and recorded issuance |
| Accept/decline | Candidate | Own current, nonexpired issued offer |
| Mark hired | Authorized organization member | Accepted offer; explicit final confirmation |
| Close vacancy | Organization hiring member | Close job; resolve applicants explicitly |

Offer lifecycle is separate: draft, issued, accepted, declined, expired, withdrawn, superseded. Issuing an offer does not accept it. Acceptance does not automatically mark hired. A revised offer supersedes its prior version, retaining history.

## Candidate and employer views
Candidates see their submitted snapshot, candidate-visible events, interview details and offers. Employers see the pipeline, snapshot, submitted CV, private notes and permitted contact information. Candidates never see internal notes. External jobs have a separate self-reported tracker; Joblite cannot assert source ATS decisions.

## Automation allowed
Permitted source synchronization, duplicate detection, saved-search alerts, deadline reminders, stale-content warnings and explainable skill/location matching. Display why a suggestion matched and which data was used. Start with deterministic matching; AI is optional and must not block the core release.

## Human control
No automatic rejection, shortlist decision, offer issuance, acceptance or submission on behalf of candidates. Do not score protected traits or infer sensitive characteristics. Matching must disclose unknown eligibility and avoid representing inferred eligibility as fact. Users can dismiss suggestions and disable nonessential alerts.

## Reliability and audit
Use unique application constraints and conditional stage writes. Commit stage change, event and notification outbox atomically. Record human/system actor, action, previous/new value, rule version and time. Notifications are idempotent; retries must never repeat a decision. Reminder schedules cancel after withdrawal, closure or changed preferences.
