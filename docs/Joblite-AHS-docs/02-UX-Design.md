# UX, Information Architecture and Design
## Visual direction
Use the familiarity of an X-style feed without copying brand assets. Desktop has left navigation, central feed and right discovery panel. Mobile has a single column with bottom navigation. Place the composer at the top. Proposed theme: white/slate surfaces, dark readable text, blue primary action, subtle borders; support dark mode through tokens.

Use 16px default body text, generous line height, visible focus rings, at least 44px touch targets and WCAG 2.2 AA as the accessibility target. Never rely on color alone for stage or source identity.

## Routes
| Route | Surface |
|---|---|
| / | Home feed; Following and Discover tabs |
| /jobs | Search, filters, sort and saved search |
| /jobs/:id | Job details, provenance and apply action |
| /boards | Country/industry directory of external boards |
| /countries/:code | Country jobs and directory with coverage summary |
| /posts/:id | Post, comments, media and reporting |
| /people/:handle | Visibility-controlled candidate profile |
| /companies/:slug | Company page and public vacancies |
| /applications | Candidate application tracker |
| /applications/:id | Candidate timeline and submitted snapshot |
| /saved | Saved jobs |
| /hiring | Organization overview |
| /hiring/jobs/new | Structured vacancy composer |
| /hiring/jobs/:id/applicants | Employer pipeline and accessible list alternative |
| /hiring/applications/:id | Applicant review, notes and stage actions |
| /notifications | Notification inbox |
| /settings | Account, privacy, notification and session controls |
| /admin | Restricted integrations and moderation |

## Feed behavior
Composer mode explicitly selects Post or Job. Posts support text, images and video. Jobs use structured fields and may include approved media. Cards display distinct Native job, Imported job or Post labels. Directory entries appear in dedicated results, not as job cards. Support save, share with clipboard fallback, comments, and owner edit/delete. Do not show unsupported actions.

## Search behavior
Keyword, country, city, skill, experience level, employment type, arrangement, salary and applicant eligibility filters are reflected in the URL. Country selection is manual and persistent; coarse location detection is only a suggestion. Include Clear filters and keyboard-accessible searchable selectors. Default sort: newest known publication, with unknown dates labelled.

## ATS visibility
Primary navigation contains My Applications and Hiring for users with the relevant access. Candidate tracker shows status, source, last update and next action. Employer pipeline shows stage counts and a list/table alternative; drag-and-drop must not be the only way to move stages. Confirm rejection and offer actions, then show success or actionable failure.

## Media states
Show selection preview, removal, progress, cancel/retry and accessible captions/alt text. Videos move through uploading, processing, ready or failed; only ready media is published. Provide poster image, controls and captions support; avoid autoplay with sound. Pause offscreen video and respect reduced motion/data preferences.

## Empty, loading and failure states
Every country page exists even without live jobs: explain coverage and offer relevant board links or alerts. Never fabricate listings. Show skeletons during initial load, preserved drafts after errors, session-expiry recovery, upload failure reasons and accessible validation summaries.

## Design deliverables for implementation
Create reusable Button, Field, CountryPicker, JobCard, PostCard, MediaUploader, SourceBadge, EligibilityBadge, ApplicationTimeline, StageMenu, EmptyState and ConfirmationDialog components. Verify mobile widths from 320px, tablet and desktop. General content and application details must never share public caches.
