# Joblite AHS — Operations Guide

Operational reference for privacy choices, outbox delivery, and data backup/restore.
This document records current behaviour and open questions; it is **not legal advice
and makes no claim of legal compliance**.

Last updated: 2026-10-27

---

## 1. Privacy choices: what the control actually does

### Client behaviour
- `PrivacyChoicesButton` (`src/client/pages/Legal.tsx`) is rendered globally (via `GlobalPageTools`
  in `src/client/App.tsx`) and also reachable from `/settings`.
- The dialog **opens automatically once per launch** while no choice is stored, and stays closed
  after that. It can be reopened any time from the persistent "Privacy choices" control.
- The visitor's choice is stored in `localStorage`:
  - `joblite:privacy-choice` = `accept_optional` | `reject_optional`
  - `joblite:anonymous-choice-id` = a random UUID used only to group a signed-out visitor's records.
- The dialog is keyboard operable (focus is contained, `Escape` dismisses, focus returns to the
  trigger) and renders as a bottom sheet on small viewports. Covered by `e2e/privacy-choices.spec.ts`.

### Server records
| Action | Endpoint | Stored in `legal_records` |
|---|---|---|
| Accept / Reject optional | `POST /api/v1/legal/choices` | `document_id='privacy-choices'`, `document_version='v1-2026-10-24'`, `action='consent_grant'` \| `'consent_refusal'`, `purpose='optional_tracking'` |
| Withdraw (signed in) | `POST /api/v1/me/privacy-consent/withdraw` | same document, `action='withdrawal'` |

Signed-in requests are attributed to `user_id`; signed-out requests store only an HMAC of the
anonymous id (`anonymous_id_hash`) and never the raw id.

### What tracking the choice controls today
**Nothing yet.** There is no analytics, advertising, pixel, marketing SDK, or third-party embed in
the client. The only browser storage in use is:
- an essential `HttpOnly` session cookie (auth, `SameSite=Lax`),
- `localStorage` preferences (privacy choice, legal region),
- `sessionStorage` for an unfinished post draft and a signup challenge.

So the choice is a **recorded preference**, not a gate that currently blocks a tracker. When an
optional tool is added it must read the stored choice *before* loading; the notice text in
`/legal/cookies` already states optional tools must remain blocked until a valid choice applies.

---

## 2. Unresolved legal questions (for counsel — no compliance claimed)

- **Lawful basis / necessity** for storing consent and refusal records (including HMAC'd anonymous
  ids), and the **retention period** for `legal_records`. No retention schedule is published.
- **Consent quality**: freely given, specific and unambiguous consent needs equal prominence for
  accept and reject. The current dialog makes "Accept optional" the primary button and "Reject
  optional" secondary, which may be treated as a dark pattern. Needs review.
- **Is the launch interstitial required at all** while no optional tools are active, or is it a
  needless barrier? If kept, it should not imply tracking that does not exist.
- **Withdrawal must be as easy as giving consent** — currently the same dialog; confirm this holds
  once real optional tools exist.
- **ePrivacy/GDPR device-storage rules**: no non-essential storage is set before consent today;
  ensure this stays true as features are added.
- **Territorial scope**: EEA/UK targeting is not established; a UK/EEA representative may be
  required depending on actual activity, not mere accessibility.
- **Uganda**: operator is Aidomex Group Ltd (Wakiso). PDPO registration, annual reporting, DPO
  designation, and cross-border transfer safeguards require confirmation.
- **Age**: an 18+ product safeguard with no parent/guardian consent flow; jurisdiction-specific
  review needed.
- **Data-subject requests**: `privacy_requests` are recorded with status `received`; a human must
  action them. No universal response deadline is promised.
- **Employer/applicant roles**: controller/processor allocation and retention of immutable
  application snapshots require review.

---

## 3. Outbox delivery: operator visibility and retry policy

### Inspect
```
GET /api/v1/admin/outbox
Authorization: Bearer <INGEST_TOKEN>   # or an organization owner/admin session
```
Returns read-only:
- `counts` — outbox rows by state (`pending`, `dispatching`, `dispatched`, `failed`),
- `backlog` — current pending/dispatching/failed rows with `lease_expired`,
- `deliveries` — delivery-ledger counts by outcome,
- `delivery_failures` — `retrying`/`failed` rows with `attempts` and a redacted `last_error`.

### Delivery outcomes
| Outcome | Meaning |
|---|---|
| `sending` | claimed by a consumer; side effect in flight |
| `retrying` | an attempt failed; the message will be redelivered |
| `handled` | side effect completed |
| `no_handler` | no delivery channel exists for this event type (recorded + logged, not dropped) |
| `failed` | attempt budget exhausted — **needs operator attention** |

Retry policy: 5 attempts, then `failed` (not retried further). Each send carries the event id as a
provider `Idempotency-Key`, and a claim is written before the side effect, so a redelivery cannot
send a duplicate email. Implemented handlers today: `interview.scheduled` (candidate interview
invitation). Everything else is `no_handler`.

### Historical `no_handler` events — do not replay automatically
Production currently holds a handful of `no_handler` rows (all `source.run_completed`; side-effect
free) plus 319 already-`dispatched` outbox rows from before the consumer recorded outcomes. Do **not**
bulk-replay them: replaying `interview.scheduled`, `offer.issued`, etc. would email real people about
events that are already past and would look like spam. If a specific event genuinely needs redelivery,
reset only that row deliberately (`outcome` back to a re-claimable value) as a reviewed, single-event
action — never a bulk job.

---

## 4. Backup and restore

### Capture a recovery point
```
# Logical backup (schema + data) to a file
npx wrangler d1 export joblite-db --remote --config wrangler.toml \
  --output=joblite-backup-YYYYMMDD.sql

# Current Time Travel bookmark (remote only; bookmark window is the last 30 days)
npx wrangler d1 time-travel info joblite-db --config wrangler.toml --json
```
Latest bookmark captured at the time of writing: `000002f6-00000000-00005111-ea98f4836851b70f1bbfebdd6a54d882`.

### Restore (production)
```
npx wrangler d1 time-travel restore joblite-db --bookmark=<bookmark> --config wrangler.toml
# or --timestamp=<RFC3339 | unix seconds>
```
A production restore **overwrites data** and must be treated like a deploy: announce it, capture a
fresh bookmark first, and do it only with explicit approval.

### Testing restoration safely (never over production)
1. Capture a fresh bookmark and a logical export of `joblite-db` first.
2. Create a **scratch database** (never reuse the production binding):
   ```
   npx wrangler d1 create joblite-restore-test
   ```
3. Load the export into the scratch database and run checks against it:
   ```
   npx wrangler d1 execute joblite-restore-test --remote --file=joblite-backup-YYYYMMDD.sql
   ```
   (or apply the export to a local D1 with `--local` for a fully offline rehearsal).
4. Assert row counts and key invariants (users, jobs, applications, outbox/ledger) and that
   migrations are recorded, then delete the scratch database.
5. Only after a successful rehearsal, and with approval, consider a real restore.

### Notes and gaps
- **R2 media is not covered by D1 backups.** Object storage needs its own strategy (R2 versioning /
  object export) — not yet defined.
- **Restore has never been rehearsed end-to-end.** The steps above are the intended procedure and
  are untested; rehearse them in the scratch database before relying on them.
- Time Travel covers roughly the last 30 days; confirm the current Cloudflare limit before relying
  on it as the sole recovery mechanism.
- Recommended cadence (proposal, not yet automated): a scheduled `d1 export` to R2/offsite plus a
  bookmark recorded with each deploy.
