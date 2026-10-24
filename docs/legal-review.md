# Joblite legal and privacy review notes

**Status:** product-grounded working drafts, versioned 2026-10-24. These are not legal advice, legal approval, regulator approval, or a certification. A Uganda-qualified lawyer and, where relevant, EEA/UK privacy counsel should review before the drafts are treated as final contractual policies.

## Operator and verified contact details

- Platform name: Joblite AHIS
- Operator supplied by the owner: Aidomex Group Ltd
- Location supplied by the owner: Wakiso, Uganda
- Postal address supplied by the owner, preserved exactly: `118472, Uganda`
- Website: <https://joblite.online/>
- No verified company registration number, street address, privacy email, general email, telephone number, appointed DPO, EEA/UK representative, or PDPO registration certificate was found in project configuration. Do not invent or publish one.

## Product data and service map checked in the repository

The product stores verified email identities, hashed short-lived authentication challenges, seven-day sessions, rate-limit hashes, profile fields and visibility, public posts/comments/media, employer organizations and vacancies, imported job/provider records, saved jobs, notifications, native application records and immutable snapshots, and user-entered external-application tracker statuses. Users can upload post images/video and CV-purpose media to R2. Worker APIs run on Cloudflare and persist structured application data in D1. Resend delivers one-time email codes. Server-side job ingestion requests permitted public provider feeds and configured employer boards.

Cloudflare country inference is approximate and is used only to suggest a displayed legal supplement. The product does not request GPS or infer residence. Search-country preferences are user-selected. Browser storage currently includes the essential `joblite_session` cookie, `sessionStorage` for a pending post draft, and `localStorage` for the user-selected legal region and privacy choices. Google Fonts was removed in favor of system fonts. No analytics SDK, ad pixel, marketing SDK, or third-party embed is installed. The Web Share API and clipboard are invoked only after a user action. External employer/provider sites receive a visitor only after the visitor follows a link.

Provider, content, and email delivery configuration can change. The public Privacy Notice describes currently configured providers at a high level and should be rechecked against Cloudflare account settings, Resend’s current data terms, and the enabled ingestion source registry before approval.

## Jurisdiction sources and scope notes

### Uganda

- [Data Protection and Privacy Act, Cap. 97 (ULII current consolidated text)](https://ulii.org/en/akn/ug/act/2019/9/eng%402023-12-31)
- [NITA-U laws and regulations index](https://nita.go.ug/laws-and-regulations)
- [Data Protection and Privacy Regulations, 2021 (NITA-U publication)](https://oldsite.nita.go.ug/nita-u-publication/data-protection-and-privacy-regulations-2021)
- [Personal Data Protection Office (PDPO)](https://pdpo.go.ug/)
- [PDPO registration notice](https://pdpo.go.ug/media/2022/11/Press-Release-Requirement-to-register-with-PDPO.pdf)
- [PDPO knowledge center and current operational notices](https://pdpo.go.ug/knowledge-center)

The Act states territorial application for processing in Uganda and for processing outside Uganda relating to Ugandan citizens. The operating company is supplied as located in Wakiso, so Uganda is the clear baseline for review. The Act/Regulations include registration, data-subject information, data quality/minimality, security, correction/deletion, child-data, and cross-border processing requirements. PDPO currently publishes registration and annual-report information. The project has no evidence that Aidomex Group Ltd has registered, designated a DPO where required, completed a transfer undertaking, or filed reports; these are urgent operator confirmations, not claims made by this product.

### EEA

- [GDPR Article 3 territorial scope and Article 27 representative requirement (EUR-Lex)](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX%3A32016R0679)
- [ePrivacy Directive Article 5(3) (EUR-Lex)](https://eur-lex.europa.eu/eli/dir/2002/58/art_5/par_3/oj/eng)

The operator is not identified as established in the EEA. An EEA user’s ability to reach a global website alone does not establish Article 3(2) targeting or monitoring. Joblite exposes global jobs/countries, but the owner has not supplied marketing, user, or monitoring facts demonstrating an EEA-directed offer. Actual promotion, language/currency, employer targeting, and monitoring behavior need review. If Article 3(2) applies, counsel should assess Article 27’s written EEA representative requirement and its exception. National ePrivacy implementation can separately apply to device storage/access; optional tracking is not currently deployed.

### United Kingdom

- [UK Data Protection Act 2018, section 207 territorial application (legislation.gov.uk)](https://www.legislation.gov.uk/ukpga/2018/12/body/enacted?timeline=false)
- [ICO: Who does UK GDPR apply to?](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/personal-information-what-is-it/who-does-the-uk-gdpr-apply-to/)
- [ICO: PECR rules and overseas services](https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/guidance-on-the-use-of-storage-and-access-technologies/what-are-the-pecr-rules/)

No UK establishment or UK-targeted activity was established from the repository. The UK supplement is informative, not an assertion that the law applies. ICO notes that global availability alone is not automatically conclusive; actual offer/monitoring and device-storage behavior matter. Check current ICO guidance again because its territorial guidance is marked as under review following statutory changes.

### Other regions

No broad review of all countries is represented by the selector. The common privacy-protective baseline is shown when region is unknown. Counsel should prioritize jurisdictions where the operator actively markets, employers recruit, or users are systematically monitored, based on actual activity rather than internet reachability alone.

## Draft and implementation notes

- Legal routes are explicitly labelled “Draft for legal review,” versioned, printable, and public. The region selector stores a deliberate local selection and otherwise uses approximate Cloudflare country inference; it never requests GPS and does not change contract terms.
- New account creation records an unchecked Terms acceptance and an age affirmation after mailbox verification. Optional marketing consent is separate and unchecked; refusal is stored separately. Existing users authenticate without being prompted to accept the current version again. The mechanism records the currently deployed draft version; legal review must approve the text/version before production acceptance is relied upon.
- The age threshold is a product rule (18+) because the Uganda Act treats child data specially and the product has no guardian workflow. Email verification does not verify age. It is not asserted to be globally sufficient; assess target ages and guardian requirements before launch.
- Privacy requests require a verified signed-in session and are visible only to that user. Export is implemented. Access/correction/deletion/objection/withdrawal requests are recorded as `received`; no staff case-management, identity escalation, deletion orchestration, or jurisdiction-specific SLA timer exists yet. Manual request fulfillment remains an operational blocker.
- The media content endpoint serves anonymously only media linked to a published public post. Other ready media requires its owner’s authenticated session and receives `private, no-store`.
- No universal retention schedule is claimed. Known timers are the ten-minute auth challenge and seven-day session. Other legal-record, account, application snapshot, post, provider, object-storage, and infrastructure log periods require operator decisions and review.

## Matters requiring operator/legal confirmation before calling the drafts final

1. Aidomex Group Ltd’s exact registered legal name, jurisdiction/entity documents, verified registration number (if it should be published), statutory address and public support/privacy contact channel.
2. PDPO registration category/status, annual compliance reports, responsible privacy officer/DPO designation, and applicable breach reporting/complaint process.
3. Cross-border processing basis/safeguards and documented Cloudflare/Resend regional configuration, processing agreements, subprocessors, and transfer mechanisms.
4. Actual user/employer targeting and marketing in Uganda, EEA, UK, and other countries; Article 27 or UK representative assessment where scope is met.
5. Data retention and deletion schedule, backup expiration, source/provider payload retention, applicant/employer controller roles, and a staffed privacy-request process with jurisdiction-specific deadlines.
6. Minor access policy, reliable age assurance proportional to risks, and guardian consent path if minors may lawfully be served.
7. Final contract terms, employer obligations, acceptable-use/removal/appeal process, consumer-law obligations, and region/language versions.

## Share preview notes

The public default preview is the static versioned image `/share-card.v1.png`; public metadata has short CDN freshness windows and private pages use `private, no-store` plus `noindex`. Public preview text only comes from published public jobs/posts. Public media URLs are stable media-ID paths and have a short cache lifetime so deletion can take effect; private media cannot be used as a preview image. Social platforms may retain their own copies after Joblite changes or deletion. The official Open Graph property conventions are documented at [ogp.me](https://ogp.me/); X uses the `summary_large_image` card metadata. LinkedIn documents a [Post Inspector refresh flow](https://www.linkedin.com/help/linkedin/answer/a6269011), though this tool was not used to test the deployed preview in this implementation.

## Operations and verification

- Local setup: `npm ci`, `npm run migrate:local`, then `npm run dev`.
- Local browser suite: `npm run e2e` (uses a temporary D1 state directory and test-only mail sink); unit suite: `npm test`; type checks/build: `npm run typecheck`, `npm run lint`, `npm run build`.
- Passwordless delivery reads the existing server-only `EMAIL_API_KEY` secret first, then `RESEND_API_KEY`, and the `EMAIL_FROM` setting. The `RESEND_API_KEY` binding name is already occupied in the Cloudflare production Worker, so adding a same-named secret was rejected; the configured `EMAIL_API_KEY` secret is the supported Resend credential in production. Production sender is `noreply@joblite.online`. Never put these credentials in client code or commit local development secrets.
- The stable public preview image is `https://joblite.online/share-card.v1.png` (1200 × 630 PNG). Its `v1` URL is immutable; publish a new versioned filename when the artwork changes. Social services keep independent preview caches and may need manual refresh with their own inspection tools.
- Additive production schema changes are applied with `npx wrangler d1 migrations apply joblite-db --remote --config wrangler.toml`; deployments use `npm run build && npm run deploy` after production migration review.
